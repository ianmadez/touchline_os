/**
 * Every division's table, as the save actually states it.
 *
 * The app has always been able to name the manager's own division and nothing else, because the
 * manager's own division is the one `leagueteamlinks` ZEROES: its points and result columns read 0 for
 * every club, which is why his own position can only ever be inferred. Every other division in the same
 * save is written out in full - and none of it was ever read.
 *
 * TWO THINGS THIS SERVICE IS CAREFUL ABOUT, and both are properties of the file rather than of the code:
 *
 *   1. The order. `currenttableposition` is the save's own placing, but it is not always a table: on the
 *      reference career it produced 19 distinct places for 24 clubs, with 4th, 8th, 15th, 18th and 20th
 *      each held by two clubs. So the sync records HOW the order was arrived at, and this service
 *      passes that through. A division ordered by the save's own 1..N says SAVE; one that had to be
 *      ordered by points says DERIVED. Neither is presented as the other.
 *
 *   2. Whether there is a record at all. Measured on the reference save, the result columns are zero
 *      for every club in 39 of the 40 divisions it holds, and populated in exactly one. Printing
 *      "0 0 0 0 0 0 0" beside twenty clubs would look like a table and be a lie, so `hasRecord` says
 *      whether there is anything to print, and the screen shows the order on its own when there is not.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "../db/client";
import { competitionTeams, leagues } from "../db/schema";

export type OrderBasis = "SAVE" | "DERIVED";

export interface DivisionSummary {
  leagueId: number;
  /** The save's own competition name, or null when the catalogue does not name it. */
  name: string | null;
  countryName: string | null;
  level: number | null;
  clubs: number;
  orderBasis: OrderBasis;
  /** True for the division the manager is actually in, whose record columns the save zeroes. */
  isOwnLeague: boolean;
  /**
   * True when the save carries a real record for this division - any goals, results or points beyond
   * zero. False means the division is stored for its ORDER alone.
   */
  hasRecord: boolean;
}

export interface DivisionRow {
  teamId: number;
  name: string;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  points: number | null;
  /** The save's own placing, or null. Not a rank: it repeats and has gaps. */
  position: number | null;
}

export interface DivisionTable {
  division: DivisionSummary;
  rows: DivisionRow[];
}

export class CompetitionTableService {
  /** Every division the save carries a table for, biggest first, the manager's own first of all. */
  async listDivisions(careerId: string): Promise<DivisionSummary[]> {
    const [rows, catalogue] = await Promise.all([
      db.select().from(competitionTeams).where(eq(competitionTeams.careerId, careerId)),
      db.select().from(leagues).where(eq(leagues.careerId, careerId)),
    ]);

    const nameByLeague = new Map(catalogue.map((row) => [row.leagueId, row]));
    const grouped = new Map<number, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.leagueId) ?? [];
      list.push(row);
      grouped.set(row.leagueId, list);
    }

    const divisions: DivisionSummary[] = [];
    for (const [leagueId, clubs] of grouped) {
      const league = nameByLeague.get(leagueId);
      divisions.push({
        leagueId,
        name: league?.name ?? null,
        countryName: league?.countryName ?? null,
        level: league?.level ?? null,
        clubs: clubs.length,
        orderBasis: clubs.some((club) => club.orderBasis === "DERIVED") ? "DERIVED" : "SAVE",
        isOwnLeague: clubs.some((club) => club.isOwnLeague),
        hasRecord: clubs.some(hasRealRecord),
      });
    }

    return divisions.sort((left, right) => {
      if (left.isOwnLeague !== right.isOwnLeague) return left.isOwnLeague ? -1 : 1;
      // By the tier the save records, so the list reads like a football pyramid rather than
      // alphabetically. A division the save gives no level is filed last rather than first.
      const byLevel = compareNullable(left.level, right.level, "ASC");
      if (byLevel !== 0) return byLevel;
      return (left.name ?? `Division ${left.leagueId}`).localeCompare(
        right.name ?? `Division ${right.leagueId}`
      );
    });
  }

  /** One division's table, ordered the way the sync recorded. Null when the save holds no such division. */
  async getDivisionTable(careerId: string, leagueId: number): Promise<DivisionTable | null> {
    const rows = await db
      .select()
      .from(competitionTeams)
      .where(eq(competitionTeams.careerId, careerId))
      .orderBy(asc(competitionTeams.name));
    const clubs = rows.filter((row) => row.leagueId === leagueId);
    if (clubs.length === 0) return null;

    const league = await db
      .select()
      .from(leagues)
      .where(eq(leagues.careerId, careerId))
      .then((all) => all.find((row) => row.leagueId === leagueId) ?? null);

    const orderBasis: OrderBasis = clubs.some((club) => club.orderBasis === "DERIVED")
      ? "DERIVED"
      : "SAVE";

    /**
     * The order, in the shape the save justified.
     *
     * A clean 1..N `currenttableposition` IS the table, so it is used as-is. Anything else has to be
     * derived from the record, and the only record there is - when there is one - is points, then goal
     * difference, then goals scored: the same tiebreak a real table uses. Where the record is zero as
     * well, the derived order collapses to the name, and the screen says the division has no record
     * rather than presenting that as a standing.
     */
    const ordered = orderCompetitionRows(clubs, orderBasis);

    return {
      division: {
        leagueId,
        name: league?.name ?? null,
        countryName: league?.countryName ?? null,
        level: league?.level ?? null,
        clubs: clubs.length,
        orderBasis,
        isOwnLeague: clubs.some((club) => club.isOwnLeague),
        hasRecord: clubs.some(hasRealRecord),
      },
      rows: ordered.map((row) => ({
        teamId: row.teamId,
        name: row.name,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference:
          row.goalsFor !== null && row.goalsAgainst !== null
            ? row.goalsFor - row.goalsAgainst
            : null,
        points: row.points,
        position: row.position,
      })),
    };
  }
}

/** Anything the ordering needs. Kept structural so a test needs no database row. */
export interface OrderableClub {
  position: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  name: string;
}

/**
 * Orders one division the way its `orderBasis` says it may be ordered.
 *
 * Exported and pure so the rule can be tested without a database: this is the part that decides
 * whether the screen is showing the save's own table or one we worked out, and getting it wrong is
 * the difference between a fact and a guess.
 */
export function orderCompetitionRows<T extends OrderableClub>(
  clubs: T[],
  orderBasis: OrderBasis
): T[] {
  return [...clubs].sort((left, right) => {
    if (orderBasis === "SAVE") {
      const byPosition = compareNullable(left.position, right.position, "ASC");
      if (byPosition !== 0) return byPosition;
      return left.name.localeCompare(right.name);
    }
    const byPoints = compareNullable(left.points, right.points, "DESC");
    if (byPoints !== 0) return byPoints;
    const leftDiff = left.goalsFor !== null && left.goalsAgainst !== null ? left.goalsFor - left.goalsAgainst : null;
    const rightDiff =
      right.goalsFor !== null && right.goalsAgainst !== null ? right.goalsFor - right.goalsAgainst : null;
    const byDifference = compareNullable(leftDiff, rightDiff, "DESC");
    if (byDifference !== 0) return byDifference;
    const byGoals = compareNullable(left.goalsFor, right.goalsFor, "DESC");
    if (byGoals !== 0) return byGoals;
    return left.name.localeCompare(right.name);
  });
}

/**
 * Whether a club's row carries anything beyond a name.
 *
 * A division is only worth printing as a table when at least one club has a real figure, so this is
 * measured on the whole row rather than assumed from `points`: the reference save holds divisions whose
 * points are zero but whose goals are not, and national-team rows whose points are enormous while their
 * win columns are zero.
 */
function hasRealRecord(row: {
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  points: number | null;
}): boolean {
  return (
    (row.won ?? 0) > 0 ||
    (row.drawn ?? 0) > 0 ||
    (row.lost ?? 0) > 0 ||
    (row.goalsFor ?? 0) > 0 ||
    (row.goalsAgainst ?? 0) > 0 ||
    (row.points ?? 0) > 0
  );
}

/** Nulls last in both directions: an absent placing is not a placing. */
function compareNullable(
  left: number | null,
  right: number | null,
  direction: "ASC" | "DESC"
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const compared = left - right;
  return direction === "ASC" ? compared : -compared;
}
