/**
 * Which club the manager is about to play, and why we think so.
 *
 * THE SAVE DOES NOT SAY. There is no upcoming-fixture list anywhere in the file: the two blob sections
 * that would carry one (`mlop`, `mrni`) read in no save we hold, and `leagueteamlinks` is a table, not a
 * calendar. Anything here is therefore a HEURISTIC built from what the manager has told us, and it is
 * offered as a suggestion that the next debrief can overwrite - never as a stated fixture.
 *
 * The rule: a league season is played home and away, so a division of twenty-four clubs means every
 * opponent is faced TWICE. The club faced fewest times is the most likely next one, and once every club
 * has been faced once the suggestion RESETS and starts offering the reverse fixtures rather than going
 * permanently empty. That reset is the difference between a suggestion that stays useful all season and
 * one that quietly stops working in October.
 *
 * Deterministic throughout: no clock, no randomness. Two managers in the same position are told the same
 * thing.
 */
import type { LeagueTeamSummary } from "@/lib/services/career-service";

export interface OpponentSuggestion {
  teamId: number;
  name: string;
  /**
   * Which meeting this would be: 1 for the first, 2 for the reverse fixture, 3 and up only when a
   * competition has been played more than twice.
   */
  cycle: number;
  /** How many times this opponent has been faced this season, from the manager's own debriefs. */
  faced: number;
  /** One deterministic sentence explaining the pick, for the field's help text. */
  reason: string;
}

/**
 * The most likely next opponent, or null when there is nothing to choose between.
 *
 * `faced` is the opponents the manager has already logged THIS SEASON, in the order they were logged,
 * so the order is what decides between two clubs faced the same number of times: the one he has not seen
 * for longest comes round again first.
 */
export function suggestNextOpponent(
  teams: LeagueTeamSummary[],
  faced: number[]
): OpponentSuggestion | null {
  const candidates = teams.filter((team) => !team.isOwnClub);
  if (candidates.length === 0) return null;

  const counts = new Map<number, number>();
  const lastFacedAt = new Map<number, number>();
  faced.forEach((teamId, index) => {
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    lastFacedAt.set(teamId, index);
  });

  let best: LeagueTeamSummary | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  let bestLastFaced = Number.POSITIVE_INFINITY;

  for (const team of candidates) {
    const count = counts.get(team.teamId) ?? 0;
    // Not faced at all sorts ahead of anything faced, because -1 is older than any real position.
    const last = lastFacedAt.get(team.teamId) ?? -1;
    const better =
      count < bestCount ||
      (count === bestCount && last < bestLastFaced) ||
      (count === bestCount &&
        last === bestLastFaced &&
        best !== null &&
        team.name.localeCompare(best.name) < 0);
    if (better || best === null) {
      best = team;
      bestCount = count;
      bestLastFaced = last;
    }
  }

  if (best === null) return null;

  const cycle = bestCount + 1;
  // A phrase, not a sentence: the screen that shows it owns the sentence, so the same reasoning is not
  // written twice and the test asserts one short string instead of a paragraph.
  const reason =
    bestCount === 0
      ? "not faced yet this season"
      : bestCount === 1
        ? "faced once already, so this would be the reverse fixture"
        : `already faced ${bestCount} times this season`;

  return {
    teamId: best.teamId,
    name: best.name,
    cycle,
    faced: bestCount,
    reason,
  };
}
