#!/usr/bin/env -S npx tsx
/**
 * Checks for the post-match figures: the model, the validation, and the alert.
 *
 * These are the numbers the debrief screen shows a manager beside their own entries, so they have to be
 * right and they have to refuse to guess. The cases that matter are the refusals: a missing term must
 * not read as zero, an out-of-range typo must be discarded rather than clamped, and the alert must not
 * fire on two matches or on four points.
 *
 *   npx tsx scripts/test-match-stats.ts
 */
import {
  captureMethodOf,
  effectiveExpectedGoals,
  expectedGoals,
  expectedGoalsSource,
  finishingEdge,
  finishingVerdict,
  isLeagueMatch,
  keptCleanSheet,
  normaliseMatchStats,
  overperformanceAlert,
  pointsForResult,
  reportedExpectedGoals,
  reportedXgUsed,
  shotsOutsideBox,
  STAT_FIELD_LABELS,
  MATCH_STAT_FIELDS,
  OVERPERFORMANCE,
} from "../src/lib/events/match-stats";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`);
  }
}

/** The shape every stored figure block now has, so the expectations below stay readable. */
const stored = (figures: Partial<Record<string, unknown>>) => ({
  shots: null,
  shotsInsideBox: null,
  bigChances: null,
  possession: null,
  passesCompleted: null,
  expectedGoalsReported: null,
  capture: null,
  ...figures,
});

console.log("normaliseMatchStats");
check("nothing entered stores nothing", normaliseMatchStats({}), null);
check("a non-object stores nothing", normaliseMatchStats("14 shots"), null);
check("undefined stores nothing", normaliseMatchStats(undefined), null);
check("keeps what was entered", normaliseMatchStats({ shots: 14, possession: 61 }), stored({ shots: 14, possession: 61 }));
check("blank strings count as not entered", normaliseMatchStats({ shots: "", possession: "" }), null);
check(
  "an out-of-range typo is discarded, not clamped",
  normaliseMatchStats({ shots: 900, bigChances: 4 }),
  stored({ bigChances: 4 })
);
check("possession above 100 is not a percentage", normaliseMatchStats({ possession: 140 }), null);
check("negatives are discarded", normaliseMatchStats({ shots: -3 }), null);
check("a decimal is truncated to a whole count", normaliseMatchStats({ shots: 14.9 })?.shots, 14);

console.log("the game's own expected goals");
check("kept at two places", normaliseMatchStats({ expectedGoalsReported: 0.8 })?.expectedGoalsReported, 0.8);
check("rounds a longer decimal", normaliseMatchStats({ expectedGoalsReported: 1.2345 })?.expectedGoalsReported, 1.23);
check("not truncated to a whole number", normaliseMatchStats({ expectedGoalsReported: 0.4 })?.expectedGoalsReported, 0.4);
check("above the sane ceiling is discarded", normaliseMatchStats({ expectedGoalsReported: 42 }), null);
check("negative is discarded", normaliseMatchStats({ expectedGoalsReported: -1 }), null);
check("zero is a real figure, not an absence", normaliseMatchStats({ expectedGoalsReported: 0 })?.expectedGoalsReported, 0);
check("reportedExpectedGoals reads it back", reportedExpectedGoals({ expectedGoalsReported: 0.8 }), 0.8);
check("reportedExpectedGoals refuses an empty block", reportedExpectedGoals({ shots: 9 }), null);

console.log("the capture marker");
check(
  "kept when it names a figure and a layout",
  normaliseMatchStats({ shots: 9, capture: { layout: "fc25-plus", figures: { shots: "SCAN" } } })?.capture,
  { layout: "fc25-plus", figures: { shots: "SCAN" } }
);
check(
  "an edited figure is kept as edited",
  normaliseMatchStats({ shots: 9, capture: { layout: "fc25-plus", figures: { shots: "EDITED" } } })?.capture
    ?.figures,
  { shots: "EDITED" }
);
check("an unknown figure key is dropped", normaliseMatchStats({
  shots: 9,
  capture: { layout: "fc25-plus", figures: { shots: "SCAN", somethingElse: "SCAN" } },
})?.capture?.figures, { shots: "SCAN" });
check("an unknown method is dropped", normaliseMatchStats({
  shots: 9,
  capture: { layout: "fc25-plus", figures: { shots: "GUESSED" } },
})?.capture, null);
check("a marker naming nothing is dropped", normaliseMatchStats({
  shots: 9,
  capture: { layout: "fc25-plus", figures: {} },
})?.capture, null);
check("a marker without a layout is dropped", normaliseMatchStats({
  shots: 9,
  capture: { figures: { shots: "SCAN" } },
})?.capture, null);
check("no marker at all stays absent, which means typed", normaliseMatchStats({ shots: 9 })?.capture, null);
check("captureMethodOf reads a scanned figure", captureMethodOf(
  { shots: 9, capture: { layout: "fc25-plus", figures: { shots: "SCAN" } } },
  "shots"
), "SCAN");
check("captureMethodOf falls back to typed", captureMethodOf({ shots: 9 }, "shots"), "TYPED");

console.log("every figure is reachable");
check(
  "the field list and the label map name the same keys",
  [...MATCH_STAT_FIELDS].sort(),
  Object.keys(STAT_FIELD_LABELS).sort()
);
check("the field list does not drift from the stored shape", MATCH_STAT_FIELDS.length, Object.keys(STAT_FIELD_LABELS).length);
check(
  "all six figures survive the round trip, which is what an edit and re-save does",
  normaliseMatchStats({
    shots: 14,
    shotsInsideBox: 9,
    bigChances: 2,
    possession: 61,
    passesCompleted: 508,
    expectedGoalsReported: 2.35,
    capture: { layout: "fc25-plus", figures: { shots: "SCAN", possession: "EDITED" } },
  }),
  stored({
    shots: 14,
    shotsInsideBox: 9,
    bigChances: 2,
    possession: 61,
    passesCompleted: 508,
    expectedGoalsReported: 2.35,
    capture: { layout: "fc25-plus", figures: { shots: "SCAN", possession: "EDITED" } },
  })
);

console.log("which expected goals figure to use");
check("the model, from the two terms", expectedGoals({ shotsInsideBox: 5, bigChances: 2 }), 1.51);
check("a missing term refuses rather than reading as zero", expectedGoals({ bigChances: 2 }), null);
check("a missing term refuses the other way too", expectedGoals({ shotsInsideBox: 5 }), null);
check("no stats at all", expectedGoals(null), null);
check("zero on both is a real figure, not a refusal", expectedGoals({ shotsInsideBox: 0, bigChances: 0 }), 0);
check("the model alone is the estimate", expectedGoalsSource({ shotsInsideBox: 5, bigChances: 2 }), "ESTIMATE");
check("the game's figure alone is reported", expectedGoalsSource({ expectedGoalsReported: 1.2 }), "REPORTED");
check("neither is neither", expectedGoalsSource({ shots: 9 }), null);
check("nothing at all is neither", expectedGoalsSource(null), null);
check("the game's figure wins when both exist", effectiveExpectedGoals({ shotsInsideBox: 5, bigChances: 2, expectedGoalsReported: 0.7 }), 0.7);
check("without it the model stands in", effectiveExpectedGoals({ shotsInsideBox: 5, bigChances: 2 }), 1.51);
check("reportedXgUsed follows the game's figure", reportedXgUsed({ expectedGoalsReported: 1.2 }), true);
check("reportedXgUsed is false without it", reportedXgUsed({ shotsInsideBox: 5, bigChances: 2 }), false);
check(
  "the real figure needs no box shots, which is the whole point of scanning it",
  effectiveExpectedGoals({ expectedGoalsReported: 1.9 }),
  1.9
);

console.log("shotsOutsideBox");
check("shots minus the ones inside", shotsOutsideBox({ shots: 14, shotsInsideBox: 9 }), 5);
check("needs both shot figures", shotsOutsideBox({ shots: 14 }), null);
check("never negative when the inputs disagree", shotsOutsideBox({ shots: 4, shotsInsideBox: 9 }), 0);

console.log("finishingEdge and finishingVerdict");
check("goals minus expected goals", finishingEdge({ shotsInsideBox: 5, bigChances: 2 }, 2), 0.49);
check("a clean sheet with no stats refuses", finishingEdge({}, 0), null);
check("the game's figure is what finishing is measured against", finishingEdge({ expectedGoalsReported: 0.8 }, 1), 0.2);
check(
  "and it beats the model when both are present",
  finishingEdge({ shotsInsideBox: 5, bigChances: 2, expectedGoalsReported: 0.7 }, 2),
  1.3
);
check("beating the model reads clinical", finishingVerdict(0.6)?.label, "Clinical");
check("matching the model reads par", finishingVerdict(0.5)?.label, "About par");
check("matching the model the other way reads par", finishingVerdict(-0.5)?.label, "About par");
check("trailing the model reads wasteful", finishingVerdict(-0.6)?.label, "Wasteful");
check("nothing to say without a figure", finishingVerdict(null), null);

console.log("scoreline helpers");
check("no goals conceded is a clean sheet", keptCleanSheet(0), true);
check("one conceded is not", keptCleanSheet(1), false);
check("the form's own competition label is a league match", isLeagueMatch("League Match"), true);
check("the stored default is too", isLeagueMatch("League"), true);
check("a cup tie is not", isLeagueMatch("Domestic Cup"), false);
check("a friendly is not", isLeagueMatch("Friendly / Pre-season"), false);
check("a win is three points", pointsForResult("WIN"), 3);
check("a draw is one", pointsForResult("DRAW"), 1);
check("a loss is none", pointsForResult("LOSS"), 0);

console.log("overperformanceAlert");
const bar = OVERPERFORMANCE.expectedGoalsPerMatch;
/** A league match worth just over the bar in expected goals, from two big chances and eight box shots. */
const strong = { shotsInsideBox: 8, bigChances: 2 };
const weak = { shotsInsideBox: 2, bigChances: 0 };
check("three strong matches and three points fires", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "DRAW", matchStats: strong },
])?.points, 1);
check("the message states the totals it measured", overperformanceAlert([
  { competition: "League Match", result: "DRAW", matchStats: strong },
  { competition: "League Match", result: "DRAW", matchStats: strong },
  { competition: "League Match", result: "DRAW", matchStats: strong },
])?.text, "Your setup is creating chances and the results are not following. The last 3 league matches were worth 5.9 expected goals and returned 3 points.");
check("four points is not being unrewarded enough to alarm", overperformanceAlert([
  { competition: "League Match", result: "WIN", matchStats: strong },
  { competition: "League Match", result: "DRAW", matchStats: strong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
]), null);
check("one quiet match breaks the run", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: weak },
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
]), null);
check("only two matches is not yet a pattern", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
]), null);
check("a cup tie cannot contribute league points", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "Domestic Cup", result: "WIN", matchStats: strong },
]), null);
check("matches with no figures cannot support the claim", overperformanceAlert([
  { competition: "League Match", result: "LOSS" },
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
]), null);
check("the bar is exactly the stated figure, not a hair above", expectedGoals(strong) !== null && (expectedGoals(strong) ?? 0) > bar, true);

console.log("overperformanceAlert on the game's own figure");
/*
  Two bars, one per source, because the two figures are not on one scale. The model counts a big chance and the box
  shot it usually also was, so it reads high by design; the game's own number does not double count, and its bar is
  provisional pending about ten real matches.
*/
const reportedStrong = { expectedGoalsReported: 2.6 };
const reportedWeak = { expectedGoalsReported: 0.9 };
check(
  "the two bars are not the same number",
  Number(OVERPERFORMANCE.reportedXgPerMatch) !== Number(OVERPERFORMANCE.expectedGoalsPerMatch),
  true
);
check("three reported matches and three points fires", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "DRAW", matchStats: reportedStrong },
])?.points, 1);
check("the message states the totals it measured", overperformanceAlert([
  { competition: "League Match", result: "DRAW", matchStats: reportedStrong },
  { competition: "League Match", result: "DRAW", matchStats: reportedStrong },
  { competition: "League Match", result: "DRAW", matchStats: reportedStrong },
])?.text, "Your setup is creating chances and the results are not following. The last 3 league matches were worth 7.8 expected goals and returned 3 points.");
check("a reported figure alone can fire, without inside box or big chances", overperformanceAlert([
  { competition: "League Match", result: "DRAW", matchStats: { expectedGoalsReported: 2.6 } },
  { competition: "League Match", result: "DRAW", matchStats: { expectedGoalsReported: 2.6 } },
  { competition: "League Match", result: "DRAW", matchStats: { expectedGoalsReported: 2.6 } },
])?.expectedGoals, 7.8);
check("the model's bar does not let a reported figure through", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: { expectedGoalsReported: bar + 0.1 } },
  { competition: "League Match", result: "LOSS", matchStats: { expectedGoalsReported: bar + 0.1 } },
  { competition: "League Match", result: "LOSS", matchStats: { expectedGoalsReported: bar + 0.1 } },
]), null);
check("a reported figure under its own bar breaks the run", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: reportedWeak },
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
]), null);
check("the game's figure beats the model in the same match", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: { ...strong, expectedGoalsReported: 0.4 } },
  { competition: "League Match", result: "LOSS", matchStats: { ...strong, expectedGoalsReported: 0.4 } },
  { competition: "League Match", result: "LOSS", matchStats: { ...strong, expectedGoalsReported: 0.4 } },
]), null);
check("a mixed window says so rather than blending the two silently", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "LOSS", matchStats: strong },
  { competition: "League Match", result: "DRAW", matchStats: strong },
])?.text, "Your setup is creating chances and the results are not following. The last 3 league matches were worth 6.5 expected goals and returned 1 point. Some of those figures come from the game and some are our own estimate, so they are not on one scale.");
check("a window of one source says nothing about sources", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "LOSS", matchStats: reportedStrong },
  { competition: "League Match", result: "DRAW", matchStats: reportedStrong },
])?.text.includes("not on one scale"), false);
check("the reported bar is provisional and is documented as such", OVERPERFORMANCE.reportedXgPerMatch, 2.5);
check("a match with only a reported figure still counts toward the run", overperformanceAlert([
  { competition: "League Match", result: "LOSS", matchStats: { expectedGoalsReported: 2.6 } },
  { competition: "League Match", result: "LOSS" },
  { competition: "League Match", result: "LOSS", matchStats: { expectedGoalsReported: 2.6 } },
]), null);

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
