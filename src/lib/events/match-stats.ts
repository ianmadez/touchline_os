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

/**
 * The observable inputs. Every field is optional: a manager who tracks shots but not passes is normal.
 */
export interface MatchStats {
  shots?: number | null;
  shotsInsideBox?: number | null;
  bigChances?: number | null;
  /** Percentage, 0 to 100. */
  possession?: number | null;
  passesCompleted?: number | null;
  /**
   * The figure the game reports for itself, which is a decimal and is NOT the model's figure.
   *
   * Named for what it is rather than simply `expectedGoals`, because `expectedGoals()` is already an exported
   * function in this module and a stored key of the same name would make every read of it ambiguous at a glance.
   */
  expectedGoalsReported?: number | null;
  /**
   * How the scanned figures got here. Small and flat on purpose: which layout read them, and whether the manager
   * changed each one afterwards. No images, no per word confidences, nothing that grows with the screen.
   *
   * ABSENCE MEANS THE MANAGER TYPED IT, which is what every debrief stored before the scanner existed already
   * implies, so nothing has to be rewritten and both builds read old rows unchanged. This records METHOD, not
   * ownership: the event's source stays USER, because a figure the manager read off the game and let the scanner
   * prefill is still the manager's record of what he saw.
   */
  capture?: {
    /** The layout profile that read it, e.g. "fc25-plus". Internal, never shown to the manager. */
    layout: string;
    /** Only the figures a scan filled. */
    figures: Record<string, CaptureMethod>;
  } | null;
}

/** One figure's journey: read from a screenshot, or read and then changed by hand. */
export type CaptureMethod = "SCAN" | "EDITED";

/**
 * The figures a row of the table can feed, and the name to show for each.
 *
 * One list, so the capture marker, the scan review pane and the manual boxes cannot disagree about what a field
 * is called or which keys exist. A capture entry naming anything outside this list is discarded on the way in.
 */
export const STAT_FIELD_LABELS = {
  shots: "Shots",
  shotsInsideBox: "Inside box",
  bigChances: "Big chances",
  possession: "Possession %",
  passesCompleted: "Passes",
  expectedGoalsReported: "Expected goals",
} as const;

/** Every figure key, in the order the panel shows them. */
export const MATCH_STAT_FIELDS = Object.keys(STAT_FIELD_LABELS) as Array<keyof typeof STAT_FIELD_LABELS>;

export type StatFieldKey = keyof typeof STAT_FIELD_LABELS;

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
  /**
   * Reported expected goals. Far above anything a capture shows: the highest seen on the two captures is 4.9, and
   * a match worth more than ten is not a match. A value past it is a misread rather than a real figure.
   */
  expectedGoalsReported: 10,
} as const;

/**
 * Below this the finishing reads as about par; this far above it, clinical; this far below, wasteful.
 *
 * Denominated in GOALS, which is why it survives the switch to the game's own figure untouched. Half a goal of
 * difference between what was scored and what the chances were worth means the same thing whatever produced the
 * second number, so this band is not a tuned parameter and does not need re-tuning.
 */
export const FINISHING_PAR_BAND = 0.5;

/**
 * How far goals must beat expected goals before the finishing story is worth printing.
 *
 * Lifted out of the news engine, where it was a bare `1` inside a condition, and it keeps its value. Same unit as
 * the par band above and for the same reason: it is goals, so it does not move when the source of the expected
 * figure changes. It lives here rather than there so the trigger and the wording that goes with it cannot drift.
 */
export const FINISHING_STORY_EDGE = 1;

function clean(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  return parsed;
}

/**
 * The same sanity check for a figure that is genuinely a decimal.
 *
 * A sibling rather than a change to `clean`, so every existing integer field keeps its exact behaviour: `clean`
 * truncates, and truncating the game's own expected goals would turn 0.8 into 0 and quietly report a figure the
 * manager never saw.
 */
function cleanDecimal(value: unknown, max: number, places: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
  const factor = 10 ** places;
  return Math.round(parsed * factor) / factor;
}

/**
 * The capture marker, or null.
 *
 * Discards an unknown figure key or an unknown method rather than storing it, so a crafted request cannot put
 * arbitrary keys into a payload every reader would then have to tolerate. A marker naming no figures at all is
 * dropped too, because an empty map says nothing.
 */
function cleanCapture(raw: unknown): MatchStats["capture"] {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const layout = typeof input.layout === "string" ? input.layout.trim() : "";
  const figures: Record<string, CaptureMethod> = {};
  const source = input.figures;
  if (source !== null && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (!(key in STAT_FIELD_LABELS)) continue;
      if (value !== "SCAN" && value !== "EDITED") continue;
      figures[key] = value;
    }
  }
  if (layout === "" || Object.keys(figures).length === 0) return null;
  return { layout, figures };
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
  const capture = cleanCapture(input.capture);
  const stats: MatchStats = {
    shots: clean(input.shots, MATCH_STAT_LIMITS.shots),
    shotsInsideBox: clean(input.shotsInsideBox, MATCH_STAT_LIMITS.shotsInsideBox),
    bigChances: clean(input.bigChances, MATCH_STAT_LIMITS.bigChances),
    possession: clean(input.possession, MATCH_STAT_LIMITS.possession),
    passesCompleted: clean(input.passesCompleted, MATCH_STAT_LIMITS.passesCompleted),
    expectedGoalsReported: cleanDecimal(
      input.expectedGoalsReported,
      MATCH_STAT_LIMITS.expectedGoalsReported,
      2
    ),
    capture,
  };
  const anyFigure = MATCH_STAT_FIELDS.some(
    (key) => stats[key] !== null && stats[key] !== undefined
  );
  return anyFigure ? stats : null;
}

/**
 * True when nothing at all was entered.
 *
 * The capture marker is deliberately NOT a figure. A debrief whose only content is a marker saying a scan ran and
 * filled nothing is not recorded data, and counting it as one would store an empty row that looks like a match.
 */
export function isMatchStatsEmpty(stats: MatchStats | null | undefined): boolean {
  if (stats === null || stats === undefined) return true;
  return MATCH_STAT_FIELDS.every((key) => stats[key] === null || stats[key] === undefined);
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

/** The game's own figure, or null. */
export function reportedExpectedGoals(stats: MatchStats | null | undefined): number | null {
  const value = stats?.expectedGoalsReported;
  return value === null || value === undefined ? null : value;
}

/** Which of the two produced a match's expected goals figure, or null when it has neither. */
export function expectedGoalsSource(
  stats: MatchStats | null | undefined
): "REPORTED" | "ESTIMATE" | null {
  if (reportedExpectedGoals(stats) !== null) return "REPORTED";
  return expectedGoals(stats) === null ? null : "ESTIMATE";
}

/**
 * The figure to use, preferring the game's own.
 *
 * Everywhere the estimate was used, this is what should be asked instead. A real figure beats a two weight model,
 * and it is available on a capture whether or not the manager ever counted a shot from inside the box, which is
 * most managers: two of the app's five manual boxes are not on the screen the scanner reads.
 */
export function effectiveExpectedGoals(stats: MatchStats | null | undefined): number | null {
  const reported = reportedExpectedGoals(stats);
  return reported !== null ? reported : expectedGoals(stats);
}

/** Whether the figure in use came from the game rather than from the model. */
export function reportedXgUsed(stats: MatchStats | null | undefined): boolean {
  return reportedExpectedGoals(stats) !== null;
}

/** How a figure got here, or "TYPED" for one the manager entered himself. */
export function captureMethodOf(
  stats: MatchStats | null | undefined,
  key: StatFieldKey
): CaptureMethod | "TYPED" {
  return stats?.capture?.figures[key] ?? "TYPED";
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
  const expected = effectiveExpectedGoals(stats);
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
 *
 * Two bars, one per source, because the two figures are not on the same scale. The model counts a big
 * chance and the box shot it usually also was, so it reads high by design; the game's own figure does not
 * double count. `expectedGoalsPerMatch` was tuned against the model and stays as it was.
 */
export const OVERPERFORMANCE = {
  /** Consecutive league matches that must each clear the bar below. */
  matches: 3,
  /** Expected goals in a single match at or above this counts as creating enough, when the figure is the model's. */
  expectedGoalsPerMatch: 1.5,
  /**
   * The same bar for the game's own figure.
   *
   * PROVISIONAL, and the reason it is provisional is worth keeping: it was set from four sampled sides, not from
   * a run of the manager's own matches. Three of those four cleared it, which is roughly the rate the model's bar
   * produced on the same four, so it is a reasonable starting point and nothing more. It should be revisited after
   * about ten real matches, at which point the honest thing is to look at the goals minus expected goals spread
   * rather than the raw rate. It is not a football claim and it should not be quoted as one.
   */
  reportedXgPerMatch: 2.5,
  /** Points at or below this across those matches counts as not being rewarded. */
  maxPoints: 3,
} as const;

/** The bar a single figure has to clear, which depends on what produced it. */
function overperformanceBar(stats: MatchStats | null | undefined): number {
  return reportedXgUsed(stats)
    ? OVERPERFORMANCE.reportedXgPerMatch
    : OVERPERFORMANCE.expectedGoalsPerMatch;
}

/**
 * Reads the most recent matches, newest first.
 *
 * A match with no stats, or fewer than three league matches with stats, cannot support the claim, so this
 * returns null rather than a weaker version of it. Each match is judged against the bar for its own kind of
 * figure, so a manager who scanned the game's own number is not held to a threshold built for a model that
 * reads high, and one who estimated is not let through on a threshold built for the real thing.
 */
export function overperformanceAlert(history: AlertInput[]): OverperformanceAlert | null {
  const leagueWithStats = history.filter(
    (entry) => isLeagueMatch(entry.competition) && effectiveExpectedGoals(entry.matchStats) !== null
  );
  if (leagueWithStats.length < OVERPERFORMANCE.matches) return null;

  const window = leagueWithStats.slice(0, OVERPERFORMANCE.matches);
  const eachClearsBar = window.every(
    (entry) => (effectiveExpectedGoals(entry.matchStats) ?? 0) >= overperformanceBar(entry.matchStats)
  );
  if (!eachClearsBar) return null;

  const expected = window.reduce((sum, entry) => sum + (effectiveExpectedGoals(entry.matchStats) ?? 0), 0);
  const points = window.reduce((sum, entry) => sum + pointsForResult(entry.result), 0);
  if (points > OVERPERFORMANCE.maxPoints) return null;

  const roundedExpected = Math.round(expected * 10) / 10;
  const reportedCount = window.filter((entry) => reportedXgUsed(entry.matchStats)).length;
  const mixed = reportedCount > 0 && reportedCount < window.length;
  return {
    matches: OVERPERFORMANCE.matches,
    expectedGoals: roundedExpected,
    points,
    title: `Overperformance alert`,
    text: `Your setup is creating chances and the results are not following. The last ${OVERPERFORMANCE.matches} league matches were worth ${roundedExpected} expected goals and returned ${points} ${
      points === 1 ? "point" : "points"
    }.${mixed ? " Some of those figures come from the game and some are our own estimate, so they are not on one scale." : ""}`,
  };
}
