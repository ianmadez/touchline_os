/**
 * Ordering and labelling for the club pickers.
 *
 * Two pickers offer the manager's own division: the single Match Debrief and the Group Debrief. They
 * have to offer the same clubs in the same order, so both call this file rather than each keeping its
 * own rule and slowly disagreeing.
 *
 * A placing is only ever the save's own `currenttableposition`. It is sparse: some clubs carry no
 * position at all and a few share one. A club the save says nothing about therefore shows no number,
 * and the placing sort settles those clubs by name rather than inventing an order for them.
 */
import type { LeagueTeamSummary } from "@/lib/services/career-service";
import { ordinal } from "@/lib/ui/format";

/** How the opponent list is ordered. `A-Z` is the default. */
export type OpponentSortOrder = "A-Z" | "Z-A" | "POSITION";

export const OPPONENT_SORT_ORDERS: ReadonlyArray<{ id: OpponentSortOrder; label: string }> = [
  { id: "A-Z", label: "A to Z" },
  { id: "Z-A", label: "Z to A" },
  { id: "POSITION", label: "League position" },
];

/**
 * The save's placing for a club, or null when it states none.
 *
 * 0 is the value the save writes while a season is still running, so it counts as no placing. A club
 * is never given a number it did not come with.
 */
export function placingOf(team: LeagueTeamSummary): number | null {
  return team.tablePosition !== null && team.tablePosition > 0 ? team.tablePosition : null;
}

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
    if (order === "POSITION") {
      const aPlacing = placingOf(a) ?? Number.MAX_SAFE_INTEGER;
      const bPlacing = placingOf(b) ?? Number.MAX_SAFE_INTEGER;
      if (aPlacing !== bPlacing) return aPlacing - bPlacing;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    const compared = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return order === "Z-A" ? -compared : compared;
  });
}

/** "Wigan Athletic 12th", or just the club name when the save states no placing. */
export function teamOptionLabel(team: LeagueTeamSummary): string {
  const placing = placingOf(team);
  return placing === null ? team.name : `${team.name} ${ordinal(placing)}`;
}
