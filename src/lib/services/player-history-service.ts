/**
 * Every player's record at the club, every season and every match, for the Squad → Stats tab.
 *
 * Built from three permanent sources:
 *   - `player_match_archive`: the save's match ratings, kept after the save drops a season;
 *   - MATCH_DEBRIEF events: goals, assists and match context the manager logged;
 *   - `player_snapshots` via `SquadService.getPlayerGrowthHistory`: OVR/POT at every sync.
 *
 * The archive is topped up from `player_match_ratings` on every load as well as on sync. A career whose
 * ratings were synced before the archive existed therefore has its current season captured on the
 * first load, without waiting for the next save.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/client";
import {
  careerEvents,
  playerMatchArchive,
  playerMatchRatings,
  playerSnapshots,
  playerUserProfiles,
  players,
} from "../db/schema";
import { countsTowardForm } from "../squad/performance";
import { seasonStartFor } from "../squad/season-scope";
import {
  seasonLabel,
  type HistoryMatch,
  type HistorySeason,
  type PlayerHistory,
  type PlayerHistoryPayload,
} from "../squad/history";
import { SquadService } from "./squad-service";

const ARCHIVE_CHUNK = 50;

/** `20261125` -> `2026-11-25`, or null for anything that is not a plain YYYYMMDD integer. */
function isoFromSaveDate(value: number): string | null {
  const text = String(value);
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface LoggedContext {
  opponent: string | null;
  venue: string | null;
  scoreline: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export class PlayerHistoryService {
  private squadService = new SquadService();

  /** Copies any rating the archive does not hold yet. Existing archive rows are left alone. */
  private async topUpArchive(careerId: string): Promise<void> {
    const ratings = await db
      .select()
      .from(playerMatchRatings)
      .where(eq(playerMatchRatings.careerId, careerId));
    for (let at = 0; at < ratings.length; at += ARCHIVE_CHUNK) {
      const chunk = ratings.slice(at, at + ARCHIVE_CHUNK).map((row) => ({
        id: `${careerId}_${row.playerId}_${row.date}`,
        careerId,
        playerId: row.playerId,
        date: row.date,
        rating: row.rating,
        minutes: row.minutes,
        position: row.position,
      }));
      if (chunk.length > 0) await db.insert(playerMatchArchive).values(chunk).onConflictDoNothing();
    }
  }

  async load(careerId: string): Promise<PlayerHistoryPayload> {
    await this.topUpArchive(careerId);

    const [archiveRows, debriefRows, squadRows, profileRows, snapshotNames] = await Promise.all([
      db.select().from(playerMatchArchive).where(eq(playerMatchArchive.careerId, careerId)),
      db
        .select({ payloadJson: careerEvents.payloadJson })
        .from(careerEvents)
        .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")))
        .orderBy(desc(careerEvents.timestamp)),
      db
        .select({
          eaPlayerId: players.eaPlayerId,
          name: players.name,
          primaryPosition: players.primaryPosition,
        })
        .from(players)
        .where(eq(players.careerId, careerId)),
      db
        .select({ playerId: playerUserProfiles.playerId, displayName: playerUserProfiles.displayName })
        .from(playerUserProfiles)
        .where(eq(playerUserProfiles.careerId, careerId)),
      db
        .select({
          eaPlayerId: playerSnapshots.eaPlayerId,
          name: playerSnapshots.name,
          primaryPosition: playerSnapshots.primaryPosition,
          createdAt: playerSnapshots.createdAt,
        })
        .from(playerSnapshots)
        .where(eq(playerSnapshots.careerId, careerId)),
    ]);

    // ---- Who is in the record --------------------------------------------------------------------
    const displayNameByKey = new Map<string, string>();
    for (const row of profileRows) if (row.displayName) displayNameByKey.set(row.playerId, row.displayName);

    const identity = new Map<number, { name: string; primaryPosition: string | null; current: boolean }>();
    // Former players are named from their most recent snapshot.
    const latestSnapshot = new Map<number, { name: string; primaryPosition: string | null; createdAt: string }>();
    for (const row of snapshotNames) {
      const previous = latestSnapshot.get(row.eaPlayerId);
      if (!previous || row.createdAt > previous.createdAt) {
        latestSnapshot.set(row.eaPlayerId, {
          name: row.name,
          primaryPosition: row.primaryPosition,
          createdAt: row.createdAt,
        });
      }
    }
    for (const row of squadRows) {
      identity.set(row.eaPlayerId, { name: row.name, primaryPosition: row.primaryPosition, current: true });
    }
    const ensure = (eaPlayerId: number) => {
      if (identity.has(eaPlayerId)) return;
      const snap = latestSnapshot.get(eaPlayerId);
      identity.set(eaPlayerId, {
        name: snap?.name ?? `#${eaPlayerId}`,
        primaryPosition: snap?.primaryPosition ?? null,
        current: false,
      });
    };

    // ---- Logged debriefs: per match day, context and each player's goals/assists -------------------
    const contextByDate = new Map<string, LoggedContext>();
    const loggedByPlayer = new Map<number, Map<string, { goals: number; assists: number }>>();
    const keyPrefix = `${careerId}_`;
    for (const row of debriefRows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      } catch {
        continue;
      }
      const matchDate = text(payload.matchDate);
      if (matchDate === null) continue;
      if (!contextByDate.has(matchDate)) {
        contextByDate.set(matchDate, {
          opponent: text(payload.opponent),
          venue: text(payload.venue),
          scoreline: text(payload.scoreline),
        });
      }
      const contributions = Array.isArray(payload.contributions) ? payload.contributions : [];
      for (const raw of contributions) {
        const contribution = raw as { playerId?: unknown; goals?: unknown; assists?: unknown };
        if (typeof contribution.playerId !== "string" || !contribution.playerId.startsWith(keyPrefix)) continue;
        const eaPlayerId = Number(contribution.playerId.slice(keyPrefix.length));
        if (!Number.isInteger(eaPlayerId)) continue;
        const goals = typeof contribution.goals === "number" ? contribution.goals : 0;
        const assists = typeof contribution.assists === "number" ? contribution.assists : 0;
        const byDate = loggedByPlayer.get(eaPlayerId) ?? new Map<string, { goals: number; assists: number }>();
        const day = byDate.get(matchDate) ?? { goals: 0, assists: 0 };
        day.goals += goals;
        day.assists += assists;
        byDate.set(matchDate, day);
        loggedByPlayer.set(eaPlayerId, byDate);
        ensure(eaPlayerId);
      }
    }

    // ---- Matches per player ------------------------------------------------------------------------
    const matchesByPlayer = new Map<number, Map<string, HistoryMatch>>();
    const matchFor = (eaPlayerId: number, date: string): HistoryMatch => {
      const byDate = matchesByPlayer.get(eaPlayerId) ?? new Map<string, HistoryMatch>();
      matchesByPlayer.set(eaPlayerId, byDate);
      const existing = byDate.get(date);
      if (existing) return existing;
      const context = contextByDate.get(date);
      const created: HistoryMatch = {
        date,
        rating: null,
        minutes: null,
        position: null,
        opponent: context?.opponent ?? null,
        venue: context?.venue ?? null,
        scoreline: context?.scoreline ?? null,
        goals: 0,
        assists: 0,
      };
      byDate.set(date, created);
      return created;
    };
    for (const row of archiveRows) {
      const date = isoFromSaveDate(row.date);
      if (date === null) continue;
      ensure(row.playerId);
      const match = matchFor(row.playerId, date);
      match.rating = row.rating;
      match.minutes = row.minutes >= 0 ? row.minutes : null;
      match.position = row.position;
    }
    for (const [eaPlayerId, byDate] of loggedByPlayer) {
      for (const [date, logged] of byDate) {
        const match = matchFor(eaPlayerId, date);
        match.goals += logged.goals;
        match.assists += logged.assists;
      }
    }

    // ---- Growth, through the squad service --------------------------------------------------------
    const ids = [...identity.keys()];
    const growthLists = await Promise.all(
      ids.map((eaPlayerId) => this.squadService.getPlayerGrowthHistory(careerId, eaPlayerId))
    );
    const growthById = new Map(ids.map((id, index) => [id, growthLists[index]]));

    // ---- Assemble ---------------------------------------------------------------------------------
    const result: PlayerHistory[] = [];
    for (const [eaPlayerId, who] of identity) {
      const matches = [...(matchesByPlayer.get(eaPlayerId)?.values() ?? [])];
      const growth = (growthById.get(eaPlayerId) ?? []).map((point) => ({
        snapshotNumber: point.snapshotNumber,
        inGameDate: point.inGameDate ?? null,
        overallRating: point.overallRating,
        potentialRating: point.potentialRating,
      }));
      if (matches.length === 0 && !who.current) continue;

      const seasons = new Map<string, HistoryMatch[]>();
      for (const match of matches) {
        const start = seasonStartFor(match.date);
        if (start === null) continue;
        const list = seasons.get(start) ?? [];
        list.push(match);
        seasons.set(start, list);
      }

      const seasonRows: HistorySeason[] = [...seasons.entries()]
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([seasonStart, list]) => {
          list.sort((left, right) => right.date.localeCompare(left.date));
          let appearances = 0;
          let minutes = 0;
          let ratingSum = 0;
          let best: number | null = null;
          let goals = 0;
          let assists = 0;
          for (const match of list) {
            goals += match.goals;
            assists += match.assists;
            if (match.rating !== null && match.minutes !== null && countsTowardForm(match.minutes)) {
              appearances += 1;
              minutes += match.minutes;
              ratingSum += match.rating;
              best = best === null ? match.rating : Math.max(best, match.rating);
            }
          }
          const seasonEnd = `${Number(seasonStart.slice(0, 4)) + 1}-07-01`;
          const inSeason = growth.filter(
            (point) => point.inGameDate !== null && point.inGameDate >= seasonStart && point.inGameDate < seasonEnd
          );
          return {
            seasonStart,
            label: seasonLabel(seasonStart),
            appearances,
            minutes,
            averageRating: appearances > 0 ? round2(ratingSum / appearances) : null,
            bestRating: best,
            goals,
            assists,
            overallStart: inSeason[0]?.overallRating ?? null,
            overallEnd: inSeason[inSeason.length - 1]?.overallRating ?? null,
            potentialEnd: inSeason[inSeason.length - 1]?.potentialRating ?? null,
            matches: list,
          };
        });

      const totalApps = seasonRows.reduce((sum, season) => sum + season.appearances, 0);
      const weighted = seasonRows.reduce(
        (sum, season) => sum + (season.averageRating ?? 0) * season.appearances,
        0
      );
      const key = `${careerId}_${eaPlayerId}`;
      result.push({
        eaPlayerId,
        playerKey: key,
        name: displayNameByKey.get(key) ?? who.name,
        currentSquad: who.current,
        primaryPosition: who.primaryPosition,
        seasons: seasonRows,
        totals: {
          seasons: seasonRows.length,
          appearances: totalApps,
          minutes: seasonRows.reduce((sum, season) => sum + season.minutes, 0),
          averageRating: totalApps > 0 ? round2(weighted / totalApps) : null,
          goals: seasonRows.reduce((sum, season) => sum + season.goals, 0),
          assists: seasonRows.reduce((sum, season) => sum + season.assists, 0),
        },
        growth,
      });
    }

    result.sort(
      (left, right) =>
        Number(right.currentSquad) - Number(left.currentSquad) ||
        right.totals.appearances - left.totals.appearances ||
        left.name.localeCompare(right.name)
    );
    return { players: result };
  }
}
