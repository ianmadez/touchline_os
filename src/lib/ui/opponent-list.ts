/**
 * Ordering for the club pickers.
 *
 * Two pickers offer the manager's own division: the single Match Debrief and the Group Debrief. They
 * have to offer the same clubs in the same order, so both call this file rather than each keeping its
 * own rule and slowly disagreeing.
 *
 * A league position is deliberately not offered here, and not shown beside a club name either.
 *
 * The save does carry a placing per club on `leagueteamlinks`, but it is not a real table. Measured on
 * one career of 24 clubs it produced only 19 distinct places: 4th, 8th, 15th, 18th and 20th each held
 * by two clubs, while 12th, 16th, 17th, 19th and 23rd were never used. The other columns that would
 * let a table be recomputed, points and results, are zeroed by the save for the manager's division.
 * The placing is therefore a stale value the game refreshes only for some clubs, and printing it would
 * be a guess dressed as a fact. The list is ordered by name instead.
 */
import type { LeagueTeamSummary } from "@/lib/services/career-service";

/** How the opponent list is ordered. `A-Z` is the default. */
export type OpponentSortOrder = "A-Z" | "Z-A";

export const OPPONENT_SORT_ORDERS: ReadonlyArray<{ id: OpponentSortOrder; label: string }> = [
  { id: "A-Z", label: "A to Z" },
  { id: "Z-A", label: "Z to A" },
];

/**
 * The division in the requested order.
 *
 * Callers filter the manager's own club out before this, so the order here is the whole rule. Names
 * compare case insensitively, so a club written in lower case still files where the eye expects.
 */
export function orderTeams(
  teams: LeagueTeamSummary[],
  order: OpponentSortOrder
): LeagueTeamSummary[] {
  return teams.slice().sort((a, b) => {
    const compared = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return order === "Z-A" ? -compared : compared;
  });
}
