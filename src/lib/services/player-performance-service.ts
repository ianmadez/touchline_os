/**
 * What each player has actually done this season, for the squad's match-stats table and the dossier.
 *
 * Read once per hydration rather than per player: the whole save holds 282 rating rows on the reference
 * career, so one query beats one per row in the table.
 *
 * The two halves have different provenance and are labelled separately wherever they are shown:
 *
 *   - appearances, minutes and the average rating come from the SAVE's own rating history;
 *   - goals and assists come from the manager's LOGGED debriefs, because the save records no scorer for
 *     anything. They are USER data, so a season with nothing logged reads as nothing logged rather than
 *     as zero goals scored.
 *
 * Scope: the season in progress, by the save's own in-game dates. See `season-scope.ts` for why an
 * in-game boundary is used rather than the Season Vault's real-time observation window.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/client";
import { careerEvents, playerMatchRatings } from "../db/schema";
import {
  RECENT_MATCH_LIMIT,
  countsTowardForm,
  type PlayerPerformance,
  type PlayerPerformancePayload,
  type PlayerRatingPoint,
  type PlayerRecentMatch,
} from "../squad/performance";
import { seasonStartFor } from "../squad/season-scope";

/** `20261125` -> `2026-11-25`. Anything that is not a plain YYYYMMDD integer returns null. */
function isoFromSaveDate(value: number): string | null {
  const text = String(value);
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/** What a logged debrief knows about the match itself, keyed by the day it was played. */
interface LoggedMatch {
  opponent: string | null;
  venue: string | null;
  scoreline: string | null;
}
export class PlayerPerformanceService {
  async load(careerId: string, inGameDate: string | null): Promise<PlayerPerformancePayload> {
    const seasonStart = seasonStartFor(inGameDate);

    const [ratingRows, debriefRows] = await Promise.all([
      db.select().from(playerMatchRatings).where(eq(playerMatchRatings.careerId, careerId)),
      db
        .select({ payloadJson: careerEvents.payloadJson })
        .from(careerEvents)
        .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")))
        .orderBy(desc(careerEvents.timestamp)),
    ]);

    const totals = new Map<
      string,
      {
        appearances: number;
        minutes: number;
        ratingSum: number;
        goals: number;
        assists: number;
        loggedMatches: number;
        ratings: PlayerRatingPoint[];
      }
    >();
    const entryFor = (playerId: string) => {
      const existing = totals.get(playerId);
      if (existing) return existing;
      const created = {
        appearances: 0,
        minutes: 0,
        ratingSum: 0,
        goals: 0,
        assists: 0,
        loggedMatches: 0,
        ratings: [] as PlayerRatingPoint[],
      };
      totals.set(playerId, created);
      return created;
    };

    // The match context a rating can be joined to: opponent, venue and scoreline live only in the
    // debrief the manager logged, so a rating on a day he never logged has none of the three.
    const loggedByDate = new Map<string, LoggedMatch>();

    for (const row of debriefRows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      } catch {
        continue;
      }

      const matchDate = typeof payload.matchDate === "string" ? payload.matchDate : null;
      if (seasonStart !== null && (matchDate === null || matchDate < seasonStart)) continue;

      if (matchDate !== null && !loggedByDate.has(matchDate)) {
        loggedByDate.set(matchDate, {
          opponent: typeof payload.opponent === "string" && payload.opponent.trim() ? payload.opponent.trim() : null,
          venue: typeof payload.venue === "string" && payload.venue.trim() ? payload.venue.trim() : null,
          scoreline:
            typeof payload.scoreline === "string" && payload.scoreline.trim() ? payload.scoreline.trim() : null,
        });
      }

      const contributions = Array.isArray(payload.contributions) ? payload.contributions : [];
      for (const raw of contributions) {
        const contribution = raw as { playerId?: unknown; goals?: unknown; assists?: unknown };
        if (typeof contribution.playerId !== "string" || contribution.playerId.length === 0) continue;
        const entry = entryFor(contribution.playerId);
        entry.goals += typeof contribution.goals === "number" ? contribution.goals : 0;
        entry.assists += typeof contribution.assists === "number" ? contribution.assists : 0;
        entry.loggedMatches += 1;
      }
    }

    for (const row of ratingRows) {
      const date = isoFromSaveDate(row.date);
      if (date === null) continue;
      if (seasonStart !== null && date < seasonStart) continue;
      if (!countsTowardForm(row.minutes)) continue;

      // Keyed by `players.id` so a caller can look the row up straight from an `EnrichedPlayer`.
      const entry = entryFor(`${careerId}_${row.playerId}`);
      entry.appearances += 1;
      entry.minutes += row.minutes;
      entry.ratingSum += row.rating;
      entry.ratings.push({ date, rating: row.rating, minutes: row.minutes, position: row.position });
    }

    const byPlayer: Record<string, PlayerPerformance> = {};
    for (const [playerId, entry] of totals) {
      const ratings = entry.ratings.sort((left, right) => right.date.localeCompare(left.date));
      /**
       * The matches he has a RATING for AND the manager logged. Both halves are needed: the save says how
       * he played, the debrief says who against and what the score was, and a point with only the first
       * half is a number with no match attached to it.
       */
      const logged = ratings
        .map((point) => ({ point, match: loggedByDate.get(point.date) ?? null }))
        .filter((row): row is { point: PlayerRatingPoint; match: LoggedMatch } => row.match !== null);
      const recentMatches: PlayerRecentMatch[] = logged
        .slice(0, RECENT_MATCH_LIMIT)
        .map(({ point, match }) => ({
          date: point.date,
          rating: point.rating,
          opponent: match.opponent ?? "Opponent not recorded",
          venue: match.venue,
          scoreline: match.scoreline,
        }));

      byPlayer[playerId] = {
        playerId,
        appearances: entry.appearances,
        minutes: entry.minutes,
        // Null rather than 0 when nothing counted: "no rating" and "rated zero" are not the same claim,
        // and zero is not even on this scale.
        averageRating:
          entry.appearances > 0
            ? Math.round((entry.ratingSum / entry.appearances) * 100) / 100
            : null,
        goals: entry.goals,
        assists: entry.assists,
        loggedMatches: entry.loggedMatches,
        ratings,
        recentMatches,
        loggedMatchCount: logged.length,
      };
    }

    return { seasonStart, seasonScoped: seasonStart !== null, byPlayer };
  }
}
