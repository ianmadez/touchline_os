/**
 * The honours cabinet: what this manager could win, and what he has won.
 *
 * THREE SOURCES, kept apart on purpose.
 *
 * WHICH LEAGUES EXIST comes from the save's own catalogue (`leagues`), filtered to the manager's
 * country. Nothing here is a hardcoded list of competitions, so a league the game adds shows up on its
 * own. The women's competitions are filtered out with the save's own flag rather than by name, and the
 * synthetic pools (a "Rest of World" or "Free Agents" league) are filtered out by requiring the
 * country id to resolve to a nation.
 *
 * WHICH CUPS EXIST comes from `@/lib/trophies/catalogue`, because the save cannot name a cup. See that
 * file for why.
 *
 * WHAT HAS BEEN WON comes from two places and they are deliberately different in kind. A LEAGUE title
 * is derived on read from `season_history`: a completed season whose final position is 1st is a title,
 * and deriving it means nothing to store and nothing to go stale after a re-sync. A CUP is a row in
 * `career_trophies`, written by the manager, because the save has no way to tell us he won one.
 *
 * A trophy is never hidden for having not been won. The whole point of a cabinet is the empty space
 * beside the ones you have, so an unwon competition is greyed out and counted as "possible".
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerTrophies, careers, leagues } from "../db/schema";
import { SeasonService } from "./season-service";
import {
  continentalFor,
  domesticCupsFor,
  isOpenToTier,
  trophyArtworkPath,
  type TrophyKind,
} from "../trophies/catalogue";
import { leagueLabel } from "../ui/leagues";

export interface CabinetTrophyView {
  key: string;
  name: string;
  kind: TrophyKind;
  /** League tier, for a league trophy. Null for a cup. */
  level: number | null;
  /** Where the artwork would live, whether or not it is there. */
  artwork: string;
  won: boolean;
  /** How many times it has been won across the career. 1 is shown plainly, 2+ as "x2". */
  count: number;
  /** Seasons it was won in, ascending. */
  seasonsWon: number[];
  /** The subset the SAVE itself records, as opposed to the manager reporting it. */
  seasonsFromSave: number[];
  /** True when a club in the manager's current division could enter it. */
  openToCurrentTier: boolean;
  /** True for the competition the manager is in right now. */
  isCurrentDivision: boolean;
}

export interface TrophyCabinetView {
  careerId: string;
  countryId: number | null;
  countryName: string | null;
  currentLeagueId: number | null;
  currentLeagueName: string | null;
  currentLevel: number | null;
  /** Every league title the manager's country offers, lowest tier first. */
  leagues: CabinetTrophyView[];
  /** Every cup, domestic first then continental. */
  cups: CabinetTrophyView[];
  /** Seasons a win can be attributed to, from the save's own history. Ascending, newest last. */
  seasons: number[];
  totals: {
    won: number;
    /** How many the country offers at all, which is what the "whole country" view counts. */
    possible: number;
    /** How many are open to the manager's current division, which is the default view. */
    possibleRelevant: number;
    wonRelevant: number;
  };
}

interface WinRecord {
  key: string;
  season: number;
  fromSave: boolean;
}

export class TrophyService {
  /**
   * Builds the cabinet for one career.
   *
   * Read-only and derived: the only stored data it reads is the manager's own cup rows.
   */
  async getCabinet(careerId: string): Promise<TrophyCabinetView | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const catalogue = await db
      .select()
      .from(leagues)
      .where(eq(leagues.careerId, careerId));

    // The manager's own division decides the country, so there is no second setting to keep in step.
    const currentLeagueId = career.leagueId ?? null;
    const current = catalogue.find((row) => row.leagueId === currentLeagueId) ?? null;
    const countryId = current?.countryId ?? null;
    const currentLevel = current?.level ?? null;

    const seasons = await new SeasonService().getSeasonHistory(careerId);

    // ---- what has been won ----------------------------------------------------------------
    const wins = new Map<string, WinRecord[]>();

    // A completed season that finished 1st is a league title the SAVE states, not a claim of ours.
    for (const season of seasons) {
      if (!season.complete || season.leagueId === null) continue;
      if (season.tablePosition !== 1) continue;
      addWin(wins, { key: `league-${season.leagueId}`, season: season.season, fromSave: true });
    }

    const reported = await db
      .select()
      .from(careerTrophies)
      .where(eq(careerTrophies.careerId, careerId));
    for (const row of reported) {
      addWin(wins, { key: row.key, season: row.season, fromSave: false });
    }

    // ---- what could be won ----------------------------------------------------------------
    // Leagues: the manager's country, tier 1-7, men's only, and only rows that name a country. That
    // last test is what excludes the pools (a "Free Agents League" carries a country id the reference
    // table does not know), so no id list has to be maintained here.
    const countryLeagues = catalogue
      .filter(
        (row) =>
          row.countryId !== null &&
          row.countryId === countryId &&
          !row.isWomenCompetition &&
          row.level !== null &&
          row.level >= 1 &&
          row.level <= 7
      )
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.leagueId - b.leagueId)
      .map((row) =>
        toView({
          key: `league-${row.leagueId}`,
          // The ONE place that knows what a competition is called on screen, shared with the season
          // table and the vault, so a trophy cannot be labelled one thing here and another there.
          name: leagueLabel(row.name, row.leagueId),
          kind: "LEAGUE" as const,
          level: row.level,
          wins: wins.get(`league-${row.leagueId}`) ?? [],
          openToCurrentTier: currentLevel !== null && row.level === currentLevel,
          isCurrentDivision: row.leagueId === currentLeagueId,
        })
      );

    const domestic = domesticCupsFor(countryId).map((cup) =>
      toView({
        key: cup.key,
        name: cup.name,
        kind: "DOMESTIC_CUP" as const,
        level: null,
        wins: wins.get(cup.key) ?? [],
        openToCurrentTier: isOpenToTier(cup, currentLevel),
        isCurrentDivision: false,
      })
    );
    const continental = continentalFor(countryId).map((cup) =>
      toView({
        key: cup.key,
        name: cup.name,
        kind: "CONTINENTAL" as const,
        level: null,
        wins: wins.get(cup.key) ?? [],
        openToCurrentTier: isOpenToTier(cup, currentLevel),
        isCurrentDivision: false,
      })
    );

    const cups = [...domestic, ...continental];
    const all = [...countryLeagues, ...cups];

    return {
      careerId,
      countryId,
      countryName: current?.countryName ?? null,
      currentLeagueId,
      currentLeagueName: current ? leagueLabel(current.name, current.leagueId) : null,
      currentLevel,
      leagues: countryLeagues,
      cups,
      // A win can only be attributed to a season the save has a row for, and those rows are ORDINALS
      // (1, 2, 3...). `careers.currentSeason` is deliberately NOT used as a fallback: it holds a CALENDAR
      // YEAR (2026) on a real career, so offering it would let a manager record a win in "season 2026".
      // A career with no history yet offers season 1, which is where its first season is.
      seasons:
        seasons.length > 0 ? [...new Set(seasons.map((s) => s.season))].sort((a, b) => a - b) : [1],
      totals: {
        won: all.filter((trophy) => trophy.won).length,
        possible: all.length,
        possibleRelevant: all.filter((trophy) => trophy.openToCurrentTier).length,
        wonRelevant: all.filter((trophy) => trophy.won && trophy.openToCurrentTier).length,
      },
    };
  }

  /**
   * Records one win, or refreshes what was already recorded for that season.
   *
   * Upsert rather than insert: the unique index is (career, key, season), so recording the same win
   * twice cannot inflate the cabinet, and a corrected season is an update rather than a duplicate row.
   */
  async recordTrophy(
    careerId: string,
    input: { key: string; name: string; kind: TrophyKind; countryId: number | null; level: number | null; season: number }
  ): Promise<void> {
    const season = Math.max(1, Math.round(input.season));
    await db
      .insert(careerTrophies)
      .values({
        id: `${careerId}_${input.key}_${season}`,
        careerId,
        key: input.key,
        name: input.name,
        kind: input.kind,
        countryId: input.countryId,
        level: input.level,
        season,
        provenance: "USER",
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [careerTrophies.careerId, careerTrophies.key, careerTrophies.season],
        set: { name: input.name, kind: input.kind, updatedAt: new Date().toISOString() },
      });
  }

  /** Removes one recorded win. A season with nothing recorded for that key is a no-op. */
  async removeTrophy(careerId: string, key: string, season: number): Promise<void> {
    await db
      .delete(careerTrophies)
      .where(
        and(
          eq(careerTrophies.careerId, careerId),
          eq(careerTrophies.key, key),
          eq(careerTrophies.season, season)
        )
      );
  }
}

/**
 * Records a win, keeping every season separate.
 *
 * The SAVE's reading and the manager's are merged BY SEASON, never added together: a league title the
 * save already reports and the manager also reports is one win, not two. The row is marked as the
 * save's when either party saw it there, which is what lets the cabinet say where a win came from.
 * Because each row is one season, the total IS the number of rows, which is what makes "x2" mean two
 * separate seasons rather than one double-counted one.
 */
function addWin(into: Map<string, WinRecord[]>, win: WinRecord): void {
  const existing = into.get(win.key) ?? [];
  const sameSeason = existing.find((entry) => entry.season === win.season);
  if (!sameSeason) {
    existing.push(win);
  } else {
    sameSeason.fromSave = sameSeason.fromSave || win.fromSave;
  }
  into.set(win.key, existing);
}

function toView(input: {
  key: string;
  name: string;
  kind: TrophyKind;
  level: number | null;
  wins: WinRecord[];
  openToCurrentTier: boolean;
  isCurrentDivision: boolean;
}): CabinetTrophyView {
  const ordered = [...input.wins].sort((a, b) => a.season - b.season);
  const count = ordered.length;
  return {
    key: input.key,
    name: input.name,
    kind: input.kind,
    level: input.level,
    artwork: trophyArtworkPath(input.key),
    won: count > 0,
    count,
    seasonsWon: ordered.map((entry) => entry.season),
    seasonsFromSave: ordered.filter((entry) => entry.fromSave).map((entry) => entry.season),
    openToCurrentTier: input.openToCurrentTier,
    isCurrentDivision: input.isCurrentDivision,
  };
}
