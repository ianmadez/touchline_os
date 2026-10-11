/**
 * What a manager can see for themselves after a match, and the two things TouchlineOS works out from it.
 *
 * Everything here rests on figures the manager observes and enters. The save carries no match events at
 * all, so there is nothing to reconcile against and nothing here may be presented as save data. The
 * inputs are USER; the outputs are DERIVED, and the screen says so.
 *
 * The expected goals model is deliberately simple and is TouchlineOS's own benchmark, on the same
 * footing as the wage-to-turnover line in the finance tab. It is not an xG feed and it does not claim to
 * be one: two terms, each with a weight, and both weights live here rather than being scattered.
 *
 * One honest limitation, stated where the numbers are shown: a big chance is usually also a shot from
 * inside the box, so the two terms overlap and the total reads slightly high. Counting only the big
 * chances would understate a team that creates a lot of ordinary box shots, which is the more common
 * manager, so the overlap is the smaller error of the two.
 */

/** The observable inputs. Every field is optional: a manager who tracks shots but not passes is normal. */
export interface MatchStats {
  shots?: number | null;
  shotsInsideBox?: number | null;
  bigChances?: number | null;
  /** Percentage, 0 to 100. */
  possession?: number | null;
  passesCompleted?: number | null;
}

/**
 * The model.
 *
 * A shot from inside the box is worth this much, and a big chance this much, on top. Both are rounded
 * benchmarks rather than fitted values, which is exactly why they are named constants in one place.
 */
export const GOALS_PER_SHOT_INSIDE_BOX = 0.15;
export const GOALS_PER_BIG_CHANCE = 0.38;

/**
 * Sanity bounds, not football claims.
 *
 * A value outside its bound is discarded rather than clamped, because clamping a mistyped 700 passes
 * into 1500 would invent an observation the manager never made.
 */
export const MATCH_STAT_LIMITS = {
  shots: 60,
  shotsInsideBox: 60,
  bigChances: 30,
  possession: 100,
  passesCompleted: 1500,
} as const;

/** Below this the finishing reads as about par; this far above it, clinical; this far below, wasteful. */
export const FINISHING_PAR_BAND = 0.5;

function clean(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return parsed;
}

/**
 * Validates raw input.
 *
 * Returns null when nothing usable was entered at all, so an untouched block stores nothing rather than
 * a row of nulls that would look like recorded data.
 */
export function normaliseMatchStats(raw: unknown): MatchStats | null {
  if (raw === null || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const stats: MatchStats = {
    shots: clean(input.shots, MATCH_STAT_LIMITS.shots),
    shotsInsideBox: clean(input.shotsInsideBox, MATCH_STAT_LIMITS.shotsInsideBox),
    bigChances: clean(input.bigChances, MATCH_STAT_LIMITS.bigChances),
    possession: clean(input.possession, MATCH_STAT_LIMITS.possession),
    passesCompleted: clean(input.passesCompleted, MATCH_STAT_LIMITS.passesCompleted),
  };
  const anyRecorded = Object.values(stats).some((value) => value !== null);
  return anyRecorded ? stats : null;
}

/** True when nothing at all was entered. */
export function isMatchStatsEmpty(stats: MatchStats | null | undefined): boolean {
  return stats === null || stats === undefined || Object.values(stats).every((value) => value === null || value === undefined);
}

/**
 * Expected goals, or null.
 *
 * Both terms are required. The model has a weight for each, so a missing term would be silently read as
 * zero and quietly understate the figure, which is worse than saying nothing.
 */
export function expectedGoals(stats: MatchStats | null | undefined): number | null {
  if (!stats || stats.shotsInsideBox === null || stats.shotsInsideBox === undefined) return null;
  if (stats.bigChances === null || stats.bigChances === undefined) return null;
  const total = stats.shotsInsideBox * GOALS_PER_SHOT_INSIDE_BOX + stats.bigChances * GOALS_PER_BIG_CHANCE;
  return Math.round(total * 100) / 100;
}

/** Shots taken from outside the box, when both shot figures are known and consistent. */
export function shotsOutsideBox(stats: MatchStats | null | undefined): number | null {
  if (!stats || stats.shots === null || stats.shots === undefined) return null;
  if (stats.shotsInsideBox === null || stats.shotsInsideBox === undefined) return null;
  return Math.max(0, stats.shots - stats.shotsInsideBox);
}

/**
 * Goals minus expected goals.
 *
 * Positive means the chances were finished better than the model expected, negative means the opposite.
 * Named for what it is in the UI, which is "Finishing", rather than after a percentage or an index that
 * would imply more precision than two rounded weights can carry.
 */
export function finishingEdge(stats: MatchStats | null | undefined, goalsFor: number): number | null {
  const expected = expectedGoals(stats);
  if (expected === null) return null;
  return Math.round((goalsFor - expected) * 100) / 100;
}

/** The one word that goes beside the finishing figure. */
export function finishingVerdict(edge: number | null): { label: string; tone: "emerald" | "slate" | "rose" } | null {
  if (edge === null) return null;
  if (edge > FINISHING_PAR_BAND) return { label: "Clinical", tone: "emerald" };
  if (edge < -FINISHING_PAR_BAND) return { label: "Wasteful", tone: "rose" };
  return { label: "About par", tone: "slate" };
}

/** A clean sheet, worked out from the scoreline rather than asked for and contradicted. */
export function keptCleanSheet(goalsAgainst: number): boolean {
  return goalsAgainst === 0;
}

/** League matches are the only place points exist, so the alert below reasons about those alone. */
export function isLeagueMatch(competition: string | null | undefined): boolean {
  return /league/i.test(competition ?? "");
}

/** Points a logged result is worth in a league. */
export function pointsForResult(result: string | null | undefined): number {
  if (result === "WIN") return 3;
  if (result === "DRAW") return 1;
  return 0;
}

export interface AlertInput {
  competition?: string | null;
  result?: string | null;
  matchStats?: MatchStats | null;
}

export interface OverperformanceAlert {
  matches: number;
  expectedGoals: number;
  points: number;
  title: string;
  text: string;
}

/**
 * The pattern the alert is for: chances created, results not following.
 *
 * The thresholds live here so the wording and the trigger cannot drift apart. The alert states the two
 * totals it actually measured rather than a percentage it would have to invent, and it disappears on its
 * own as soon as a result goes the manager's way, which is why it needs no dismissal.
 */
export const OVERPERFORMANCE = {
  /** Consecutive league matches that must each clear the bar below. */
  matches: 3,
  /** Expected goals in a single match at or above this counts as creating enough. */
  expectedGoalsPerMatch: 1.5,
  /** Points at or below this across those matches counts as not being rewarded. */
  maxPoints: 3,
} as const;

/**
 * Reads the most recent matches, newest first.
 *
 * A match with no stats, or fewer than three league matches with stats, cannot support the claim, so this
 * returns null rather than a weaker version of it.
 */
export function overperformanceAlert(history: AlertInput[]): OverperformanceAlert | null {
  const leagueWithStats = history.filter(
    (entry) => isLeagueMatch(entry.competition) && expectedGoals(entry.matchStats) !== null
  );
  if (leagueWithStats.length < OVERPERFORMANCE.matches) return null;

  const window = leagueWithStats.slice(0, OVERPERFORMANCE.matches);
  const eachClearsBar = window.every(
    (entry) => (expectedGoals(entry.matchStats) ?? 0) >= OVERPERFORMANCE.expectedGoalsPerMatch
  );
  if (!eachClearsBar) return null;

  const expected = window.reduce((sum, entry) => sum + (expectedGoals(entry.matchStats) ?? 0), 0);
  const points = window.reduce((sum, entry) => sum + pointsForResult(entry.result), 0);
  if (points > OVERPERFORMANCE.maxPoints) return null;

  const roundedExpected = Math.round(expected * 10) / 10;
  return {
    matches: OVERPERFORMANCE.matches,
    expectedGoals: roundedExpected,
    points,
    title: `Overperformance alert`,
    text: `Your setup is creating chances and the results are not following. The last ${OVERPERFORMANCE.matches} league matches were worth ${roundedExpected} expected goals and returned ${points} ${
      points === 1 ? "point" : "points"
    }.`,
  };
}
