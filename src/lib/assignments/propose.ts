/**
 * Turning a review into the three things a manager can actually take on.
 *
 * The arithmetic is deliberately dull and stated. A points target that came out of nowhere would be worse than no
 * target at all, so every number here is either computed from two named blocks or clamped by a rule that can be
 * pointed at.
 */
import { ordinal } from "../ui/format";
import type { ReviewMatch } from "../review/types";
import type {
  AssignmentProposal,
  BlockBandInput,
  PointsTargetProposal,
  PlayerWatchProposal,
  TacticalExperimentProposal,
} from "./types";

/** The most points a five match block can produce, which is the ceiling a target may never exceed. */
export const MAX_BLOCK_POINTS = 15;

/** How many matches an experiment or a watch runs for by default. */
export const DEFAULT_MATCHES_TARGET = 5;

/** Points per game above or below the baseline that counts as a result rather than noise. */
export const EXPERIMENT_EDGE = 0.4;

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The points target for the next block.
 *
 * THE MEAN OF THE LAST TWO BLOCKS' ACTUAL POINTS, adjusted three ways and no more:
 * 1. never below the concern line of either block, because a target under the line a manager already called a
 *    concern would be asking him to fail;
 * 2. rounded, because a target of 7.5 points is not a thing a block can produce;
 * 3. clamped to 0 to 15, because five matches cannot return more.
 *
 * The objective gap is returned as context and deliberately not added into the figure: a position objective and a
 * points total are different currencies, and converting one into the other would be inventing an exchange rate.
 */
export function proposePointsTarget(input: {
  blocks: BlockBandInput[];
  targetPosition: number | null;
  currentPosition: number | null;
}): PointsTargetProposal | null {
  const finished = [...input.blocks]
    .filter((block) => block.matchesPlayed > 0)
    .sort((left, right) => right.seasonNumber - left.seasonNumber || right.blockIndex - left.blockIndex)
    .slice(0, 2);
  if (finished.length === 0) return null;

  const points = finished.map((block) => block.points);
  const concernFloor = Math.max(...finished.map((block) => block.concernPoints));
  const raw = mean(points);
  const value = clamp(Math.max(Math.round(raw), concernFloor), 0, MAX_BLOCK_POINTS);

  const gap =
    input.targetPosition !== null && input.currentPosition !== null
      ? input.currentPosition - input.targetPosition
      : null;

  return {
    type: "POINTS_TARGET",
    value,
    stretch: gap !== null && gap > 0 ? clamp(value + 1, 0, MAX_BLOCK_POINTS) : null,
    concernedBelow: concernFloor,
    fromBlocks: finished.map((block) => ({
      blockIndex: block.blockIndex,
      points: block.points,
      concernPoints: block.concernPoints,
    })),
    positionGap: gap,
    rationale:
      finished.length === 1
        ? `Block ${finished[0].blockIndex} returned ${finished[0].points}. The target holds that line and never drops below the concern of ${concernFloor}.`
        : `The last two blocks returned ${points.join(" and ")}. The mean is ${raw.toFixed(1)}, and the target never drops below the concern of ${concernFloor}.`,
  };
}

/**
 * A tactical experiment, when one shape has clearly done better than another.
 *
 * The baseline is the worse shape's own points per game, not the window's, so the comparison the verdict makes later
 * is against the thing being replaced.
 */
export function proposeExperiment(matches: ReviewMatch[], matchesTarget = DEFAULT_MATCHES_TARGET): TacticalExperimentProposal | null {
  const byShape = new Map<string, { label: string; matches: ReviewMatch[] }>();
  for (const match of matches) {
    if (match.formation === null || match.points === null) continue;
    const entry = byShape.get(match.formation.label) ?? { label: match.formation.label, matches: [] };
    entry.matches.push(match);
    byShape.set(match.formation.label, entry);
  }
  if (byShape.size < 2) return null;
  const ranked = [...byShape.values()]
    .map((group) => ({
      ...group,
      ppg: group.matches.reduce((total, match) => total + (match.points ?? 0), 0) / group.matches.length,
      points: group.matches.reduce((total, match) => total + (match.points ?? 0), 0),
    }))
    .sort((left, right) => right.ppg - left.ppg);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  // The worse shape has to have played twice before the comparison means anything: one bad afternoon is a mood, not
  // a pattern, and an experiment proposed off it would waste five matches.
  if (worst.matches.length < 2 || best.ppg - worst.ppg < EXPERIMENT_EDGE) return null;
  return {
    type: "TACTICAL_EXPERIMENT",
    formationLabel: best.label,
    matchesTarget,
    baselinePointsPerGame: Math.round(worst.ppg * 10) / 10,
    rationale: `${worst.label} has returned ${worst.points} points from ${worst.matches.length}. ${best.label} has returned ${best.points} from ${best.matches.length}.`,
  };
}

/** A player watch, when one name keeps coming up and no watch is already running. */
export function proposePlayerWatch(matches: ReviewMatch[]): PlayerWatchProposal | null {
  const counted = new Map<string, number>();
  for (const match of matches) {
    for (const name of match.standouts) counted.set(name, (counted.get(name) ?? 0) + 1);
  }
  const top = [...counted.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!top || top[1] < 2) return null;
  return {
    type: "PLAYER_WATCH",
    playerName: top[0],
    matchesTarget: DEFAULT_MATCHES_TARGET,
    rationale: `You named ${top[0]} in ${top[1]} of the ${matches.length} matches in this window.`,
  };
}

/** Every proposal this window supports, in the order they are offered. */
export function proposeAssignments(input: {
  matches: ReviewMatch[];
  blocks: BlockBandInput[];
  targetPosition: number | null;
  currentPosition: number | null;
  active: Array<{ type: string; formationLabel: string | null; playerId: string | null }>;
}): AssignmentProposal[] {
  const out: AssignmentProposal[] = [];
  const hasActive = (type: string): boolean => input.active.some((entry) => entry.type === type);

  if (!hasActive("POINTS_TARGET")) {
    const points = proposePointsTarget({
      blocks: input.blocks,
      targetPosition: input.targetPosition,
      currentPosition: input.currentPosition,
    });
    if (points !== null) out.push(points);
  }

  if (!hasActive("TACTICAL_EXPERIMENT")) {
    const experiment = proposeExperiment(input.matches);
    if (experiment !== null) out.push(experiment);
  }

  if (!hasActive("PLAYER_WATCH")) {
    const watch = proposePlayerWatch(input.matches);
    if (watch !== null) out.push(watch);
  }

  return out;
}

/** The gap to the objective, as a sentence, or null when there is no figure behind it. */
export function positionContextLine(targetPosition: number | null, currentPosition: number | null): string | null {
  if (targetPosition === null) return null;
  if (currentPosition === null) {
    return `The target of ${ordinal(targetPosition)} has no table position behind it yet.`;
  }
  const gap = currentPosition - targetPosition;
  if (gap === 0) return `You are ${ordinal(currentPosition)}, level with the target.`;
  if (gap > 0) return `You are ${ordinal(currentPosition)}, ${gap} place${gap === 1 ? "" : "s"} short of ${ordinal(targetPosition)}.`;
  return `You are ${ordinal(currentPosition)}, ${Math.abs(gap)} place${Math.abs(gap) === 1 ? "" : "s"} clear of ${ordinal(targetPosition)}.`;
}
