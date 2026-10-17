/**
 * What the manager took out of a review, and what it turned into.
 *
 * An assignment is the only object in the reasoning engine that asks him to DO something, so it is also the only one
 * with a lifecycle that ends. The engine proposes; accepting creates an ACTIVE row; the data then reports progress
 * against it; the manager closes it. Nothing here writes a verdict on its own, for the same reason a hypothesis
 * verdict is his: the app can count, it cannot decide what the count means for him.
 */
import type { AssignmentStatus, AssignmentType } from "../db/schema";

/** The band and totals a block is measured by, as the points arithmetic needs them. */
export interface BlockBandInput {
  id: string;
  seasonNumber: number;
  blockIndex: number;
  points: number;
  possible: number;
  targetMin: number;
  targetMax: number;
  concernPoints: number;
  dreamPoints: number;
  matchesPlayed: number;
}

/** A stored assignment. */
export interface Assignment {
  id: string;
  careerId: string;
  seasonNumber: number | null;
  type: AssignmentType;
  status: AssignmentStatus;
  targetPoints: number | null;
  formationLabel: string | null;
  matchesTarget: number | null;
  playerId: string | null;
  blockIndex: number | null;
  verdict: string | null;
  reviewKey: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** How an active assignment is going, computed on read from the review window. */
export interface AssignmentProgress {
  /** Matches read since it was taken, from the window the caller supplied. */
  matchesSince: number;
  pointsSince: number;
  pointsPerGame: number | null;
  /** The sentence a reader needs, with the figures in it. */
  line: string;
  /** What the engine would suggest now: keep, revert, extend, or nothing yet. */
  offer: "RETAIN" | "REVERT" | "EXTEND" | "INCONCLUSIVE" | null;
  offerReason: string | null;
}

/**
 * A points target, worked out from the two blocks before it.
 *
 * The figure is the mean of the last two blocks' ACTUAL points, rounded, never below the concern line of either
 * block, and clamped to the range a five match block can produce. The position gap is carried as context and never
 * converted into points: a league place and a points total are different currencies.
 */
export interface PointsTargetProposal {
  type: "POINTS_TARGET";
  value: number;
  /** One more than the target, offered only when the manager is behind their objective position. */
  stretch: number | null;
  concernedBelow: number;
  fromBlocks: Array<{ blockIndex: number; points: number; concernPoints: number }>;
  positionGap: number | null;
  rationale: string;
}

/** A tactical experiment: one shape, for a number of matches, against the block before it. */
export interface TacticalExperimentProposal {
  type: "TACTICAL_EXPERIMENT";
  formationLabel: string;
  matchesTarget: number;
  baselinePointsPerGame: number;
  rationale: string;
}

/** A player watch: one name, followed through the next block. */
export interface PlayerWatchProposal {
  type: "PLAYER_WATCH";
  playerName: string;
  matchesTarget: number;
  rationale: string;
}

export type AssignmentProposal =
  | PointsTargetProposal
  | TacticalExperimentProposal
  | PlayerWatchProposal;
