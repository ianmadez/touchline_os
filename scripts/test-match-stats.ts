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
  expectedGoals,
  finishingEdge,
  finishingVerdict,
  isLeagueMatch,
  keptCleanSheet,
  normaliseMatchStats,
  overperformanceAlert,
  pointsForResult,
  shotsOutsideBox,
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

console.log("normaliseMatchStats");
check("nothing entered stores nothing", normaliseMatchStats({}), null);
check("a non-object stores nothing", normaliseMatchStats("14 shots"), null);
check("undefined stores nothing", normaliseMatchStats(undefined), null);
check("keeps what was entered", normaliseMatchStats({ shots: 14, possession: 61 }), {
  shots: 14,
  shotsInsideBox: null,
  bigChances: null,
  possession: 61,
  passesCompleted: null,
});
check("blank strings count as not entered", normaliseMatchStats({ shots: "", possession: "" }), null);
check("an out-of-range typo is discarded, not clamped", normaliseMatchStats({ shots: 900, bigChances: 4 }), {
  shots: null,
  shotsInsideBox: null,
  bigChances: 4,
  possession: null,
  passesCompleted: null,
});
check("possession above 100 is not a percentage", normaliseMatchStats({ possession: 140 }), null);
check("negatives are discarded", normaliseMatchStats({ shots: -3 }), null);
check("a decimal is truncated to a whole count", normaliseMatchStats({ shots: 14.9 })?.shots, 14);

console.log("expectedGoals");
check("with both terms, the model adds up", expectedGoals({ shotsInsideBox: 5, bigChances: 2 }), 1.51);
check("a missing term refuses rather than reading as zero", expectedGoals({ bigChances: 2 }), null);
check("a missing term refuses the other way too", expectedGoals({ shotsInsideBox: 5 }), null);
check("no stats at all", expectedGoals(null), null);
check("zero on both is a real figure, not a refusal", expectedGoals({ shotsInsideBox: 0, bigChances: 0 }), 0);

console.log("shotsOutsideBox");
check("shots minus the ones inside", shotsOutsideBox({ shots: 14, shotsInsideBox: 9 }), 5);
check("needs both shot figures", shotsOutsideBox({ shots: 14 }), null);
check("never negative when the inputs disagree", shotsOutsideBox({ shots: 4, shotsInsideBox: 9 }), 0);

console.log("finishingEdge and finishingVerdict");
check("goals minus expected goals", finishingEdge({ shotsInsideBox: 5, bigChances: 2 }, 2), 0.49);
check("a clean sheet with no stats refuses", finishingEdge({}, 0), null);
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

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
