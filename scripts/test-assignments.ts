/**
 * The gate for the three proposals and the points arithmetic.
 *
 * Pure: no database. Run with `npx tsx scripts/test-assignments.ts`.
 *
 * What it proves:
 * 1. A points target is the mean of the last two blocks' ACTUAL points, rounded, never below either concern line, and
 *    clamped to what five matches can return.
 * 2. The position gap is context: it changes the sentence and the stretch, never the figure.
 * 3. A stretch is offered only when the manager is behind their target place, and it is one point.
 * 4. An experiment is only proposed when one shape is clearly better, and its verdicts are retain, revert,
 *    inconclusive and extend for the four situations that produce them.
 * 5. A player watch needs a name that keeps coming up.
 */
import { progressOf } from "../src/lib/assignments/store";
import {
  EXPERIMENT_EDGE,
  MAX_BLOCK_POINTS,
  proposeAssignments,
  proposePlayerWatch,
  proposePointsTarget,
  positionContextLine,
} from "../src/lib/assignments/propose";
import type { Assignment, BlockBandInput } from "../src/lib/assignments/types";
import type { ReviewMatch } from "../src/lib/review/types";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function block(index: number, points: number, concern: number, season = 3): BlockBandInput {
  return {
    id: `blk_${index}`,
    seasonNumber: season,
    blockIndex: index,
    points,
    possible: 15,
    targetMin: 8,
    targetMax: 10,
    concernPoints: concern,
    dreamPoints: 12,
    matchesPlayed: 5,
  };
}

function match(id: string, points: 0 | 1 | 3, label: string | null, standouts: string[] = []): ReviewMatch {
  return {
    id,
    date: "2026-03-01",
    opponent: "Opponent",
    foldedOpponent: "opponent",
    venue: "HOME",
    competition: "League Match",
    goalsFor: points === 3 ? 2 : points === 1 ? 1 : 0,
    goalsAgainst: points === 3 ? 0 : points === 1 ? 1 : 2,
    points,
    formation:
      label === null ? null : { label, formationName: "4-4-2-flat", source: "DEFAULT" },
    figures: {
      expectedGoals: null,
      shots: null,
      shotsInsideBox: null,
      possession: null,
      passesCompleted: null,
    },
    hasFigures: false,
    goalMinutes: [],
    concededMinutes: [],
    weakness: null,
    standouts,
    contributions: [],
    source: "DEBRIEF",
  };
}

function assignment(type: Assignment["type"], overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "asg_1",
    careerId: "career",
    seasonNumber: 3,
    type,
    status: "ACTIVE",
    targetPoints: null,
    formationLabel: null,
    matchesTarget: 5,
    playerId: null,
    blockIndex: null,
    verdict: null,
    reviewKey: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function main(): void {
  console.log("the points target");

  const twoBlocks = proposePointsTarget({
    blocks: [block(1, 9, 6), block(2, 7, 5)],
    targetPosition: null,
    currentPosition: null,
  });
  equal("the mean of the last two blocks, rounded", twoBlocks?.value, 8);
  equal("no stretch without a position to compare with", twoBlocks?.stretch, null);
  equal(
    "the blocks it came from are named",
    twoBlocks?.fromBlocks.map((entry) => entry.points),
    [7, 9]
  );
  equal(
    "the concern line it must never drop below",
    twoBlocks?.concernedBelow,
    6
  );

  const floorAtConcern = proposePointsTarget({
    blocks: [block(1, 4, 9), block(2, 3, 8)],
    targetPosition: null,
    currentPosition: null,
  });
  equal(
    "a mean below the concern line is lifted to it",
    floorAtConcern?.value,
    9
  );

  const clamped = proposePointsTarget({
    blocks: [block(1, 15, 6), block(2, 15, 6)],
    targetPosition: null,
    currentPosition: null,
  });
  equal("the target never exceeds what five matches can return", clamped?.value, MAX_BLOCK_POINTS);

  const behind = proposePointsTarget({
    blocks: [block(1, 9, 6), block(2, 7, 5)],
    targetPosition: 4,
    currentPosition: 7,
  });
  equal("being behind the target place offers a stretch", behind?.stretch, 9);
  equal("the position gap is carried as context", behind?.positionGap, 3);
  check(
    "and the gap does not move the figure itself",
    behind?.value === twoBlocks?.value,
    `${behind?.value} vs ${twoBlocks?.value}`
  );

  const ahead = proposePointsTarget({
    blocks: [block(1, 9, 6), block(2, 7, 5)],
    targetPosition: 8,
    currentPosition: 4,
  });
  equal("being ahead of the target place offers no stretch", ahead?.stretch, null);

  const noBlocks = proposePointsTarget({ blocks: [], targetPosition: 4, currentPosition: 7 });
  equal("no finished block means no proposal", noBlocks, null);

  console.log("the position sentence");

  equal(
    "short of the target",
    positionContextLine(4, 7),
    "You are 7th, 3 places short of 4th."
  );
  equal("level with it", positionContextLine(4, 4), "You are 4th, level with the target.");
  equal(
    "clear of it",
    positionContextLine(10, 4),
    "You are 4th, 6 places clear of 10th."
  );
  check(
    "a target with no position says so",
    (positionContextLine(4, null) ?? "").includes("no table position"),
    String(positionContextLine(4, null))
  );
  equal("no target means no line", positionContextLine(null, 4), null);

  console.log("the experiment");

  const experiments = proposeAssignments({
    matches: [
      match("m1", 3, "Primary"),
      match("m2", 3, "Primary"),
      match("m3", 0, "Secondary"),
      match("m4", 0, "Secondary"),
      match("m5", 1, "Secondary"),
    ],
    blocks: [block(1, 9, 6), block(2, 7, 5)],
    targetPosition: null,
    currentPosition: null,
    active: [],
  });
  const proposal = experiments.find((entry) => entry.type === "TACTICAL_EXPERIMENT");
  check("one clear shape wins an experiment proposal", proposal !== undefined);
  equal(
    "the experiment names the better shape",
    proposal && proposal.type === "TACTICAL_EXPERIMENT" ? proposal.formationLabel : null,
    "Primary"
  );
  equal(
    "and the baseline it must beat",
    proposal && proposal.type === "TACTICAL_EXPERIMENT" ? proposal.baselinePointsPerGame : null,
    0.3
  );

  const noExperiment = proposeAssignments({
    matches: [match("m1", 1, "Primary"), match("m2", 1, "Secondary")],
    blocks: [],
    targetPosition: null,
    currentPosition: null,
    active: [],
  });
  check(
    "no gap means no experiment",
    !noExperiment.some((entry) => entry.type === "TACTICAL_EXPERIMENT")
  );

  console.log("the player watch");

  const watch = proposePlayerWatch([
    match("m1", 3, null, ["J. Koroma"]),
    match("m2", 1, null, ["J. Koroma"]),
    match("m3", 0, null, []),
  ]);
  equal("a name that keeps coming up is offered", watch?.playerName, "J. Koroma");
  equal(
    "one mention is not enough",
    proposePlayerWatch([match("m1", 3, null, ["J. Koroma"])]),
    null
  );

  console.log("the experiment verdicts");

  const running = assignment("TACTICAL_EXPERIMENT", {
    formationLabel: "Primary",
    matchesTarget: 3,
    verdict: "baseline:1.0",
  });
  const retained = progressOf(
    running,
    [match("a", 3, "Primary"), match("b", 3, "Primary"), match("c", 1, "Primary")],
    1.0
  );
  equal("ahead of the baseline is RETAIN", retained.offer, "RETAIN");

  const reverted = progressOf(
    running,
    [match("a", 0, "Primary"), match("b", 0, "Primary"), match("c", 0, "Primary")],
    1.0
  );
  equal("behind the baseline is REVERT", reverted.offer, "REVERT");

  const inconclusive = progressOf(
    running,
    [match("a", 1, "Primary"), match("b", 1, "Primary"), match("c", 1, "Primary")],
    1.0
  );
  equal("level with the baseline is INCONCLUSIVE", inconclusive.offer, "INCONCLUSIVE");

  const extended = progressOf(assignment("TACTICAL_EXPERIMENT", { formationLabel: "Primary", matchesTarget: 5, verdict: "baseline:0.5" }), [
    match("a", 3, "Primary"),
    match("b", 3, "Primary"),
  ], 0.5);
  equal("short of the target but ahead of the baseline is EXTEND", extended.offer, "EXTEND");

  check(
    "the threshold is the one the engine declares",
    EXPERIMENT_EDGE > 0,
    String(EXPERIMENT_EDGE)
  );

  console.log("the points target progress");

  const target = assignment("POINTS_TARGET", { targetPoints: 8 });
  const met = progressOf(target, [match("a", 3, null), match("b", 3, null), match("c", 3, null), match("d", 0, null), match("e", 0, null)]);
  equal("eight points from five matches meets the target", met.offer, "RETAIN");
  const missed = progressOf(target, [match("a", 1, null), match("b", 1, null), match("c", 1, null)]);
  equal("an unfinished block offers nothing yet", missed.offer, null);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
