/**
 * The assignment store.
 *
 * An assignment's progress is COMPUTED, never stored. The row holds the commitment - a target, a shape, a name, and
 * how many matches it runs for - and every read works out where it stands from the matches in the window. Storing a
 * running total would make it wrong the first time a match was edited or deleted.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { assignments, type AssignmentStatus, type AssignmentType } from "../db/schema";
import { sha1Hex } from "../parser/sha";
import type { ReviewMatch } from "../review/types";
import { EXPERIMENT_EDGE } from "./propose";
import type { Assignment, AssignmentProgress } from "./types";

function now(): string {
  return new Date().toISOString();
}

type Row = typeof assignments.$inferSelect;

function toAssignment(row: Row): Assignment {
  return {
    id: row.id,
    careerId: row.careerId,
    seasonNumber: row.seasonNumber,
    type: row.type as AssignmentType,
    status: row.status as AssignmentStatus,
    targetPoints: row.targetPoints,
    formationLabel: row.formationLabel,
    matchesTarget: row.matchesTarget,
    playerId: row.playerId,
    blockIndex: row.blockIndex,
    verdict: row.verdict,
    reviewKey: row.reviewKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}

function idFor(careerId: string, type: AssignmentType, suffix: string): string {
  return `asg_${sha1Hex([careerId, type, suffix].join("|")).slice(0, 24)}`;
}

function pointsIn(matches: ReviewMatch[]): number {
  return matches.reduce((total, match) => total + (match.points ?? 0), 0);
}

export class AssignmentStore {
  async list(careerId: string): Promise<Assignment[]> {
    const rows = await db.select().from(assignments).where(eq(assignments.careerId, careerId));
    return rows
      .map(toAssignment)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async active(careerId: string): Promise<Assignment[]> {
    return (await this.list(careerId)).filter((assignment) => assignment.status === "ACTIVE");
  }

  /**
   * Records what the manager took on.
   *
   * Idempotent on (type, subject): taking the same points target twice from the same review returns the row that is
   * already there. A different shape or a different player is a different assignment, because it is a different
   * commitment.
   */
  async create(
    careerId: string,
    input: {
      type: AssignmentType;
      seasonNumber: number | null;
      targetPoints?: number | null;
      formationLabel?: string | null;
      matchesTarget?: number | null;
      playerId?: string | null;
      blockIndex?: number | null;
      reviewKey: string | null;
    }
  ): Promise<Assignment> {
    const suffix =
      input.type === "POINTS_TARGET"
        ? String(input.targetPoints ?? "")
        : input.type === "TACTICAL_EXPERIMENT"
          ? String(input.formationLabel ?? "")
          : String(input.playerId ?? "");
    const id = idFor(careerId, input.type, `${input.reviewKey ?? ""}:${suffix}`);

    const existing = await db.select().from(assignments).where(eq(assignments.id, id)).get();
    if (existing) {
      await db
        .update(assignments)
        .set({ status: "ACTIVE", closedAt: null, updatedAt: now() })
        .where(eq(assignments.id, id));
      const refreshed = await db.select().from(assignments).where(eq(assignments.id, id)).get();
      return toAssignment(refreshed ?? existing);
    }

    const stamp = now();
    await db.insert(assignments).values({
      id,
      careerId,
      seasonNumber: input.seasonNumber,
      type: input.type,
      status: "ACTIVE",
      targetPoints: input.targetPoints ?? null,
      formationLabel: input.formationLabel ?? null,
      matchesTarget: input.matchesTarget ?? null,
      playerId: input.playerId ?? null,
      blockIndex: input.blockIndex ?? null,
      verdict: null,
      reviewKey: input.reviewKey,
      createdAt: stamp,
      updatedAt: stamp,
      closedAt: null,
    });
    const created = await db.select().from(assignments).where(eq(assignments.id, id)).get();
    return toAssignment(created as Row);
  }

  /** Closes an assignment. The manager's decision, with the reason kept. */
  async close(
    careerId: string,
    assignmentId: string,
    status: Extract<AssignmentStatus, "MET" | "MISSED" | "CONCLUDED" | "DROPPED">,
    verdict: string | null
  ): Promise<Assignment | null> {
    const row = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.careerId, careerId), eq(assignments.id, assignmentId)))
      .get();
    if (!row) return null;
    const stamp = now();
    await db
      .update(assignments)
      .set({ status, verdict, closedAt: stamp, updatedAt: stamp })
      .where(eq(assignments.id, assignmentId));
    const refreshed = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).get();
    return refreshed ? toAssignment(refreshed) : null;
  }

  /** Writes the baseline an experiment will be judged against, without closing it. */
  async setBaseline(careerId: string, assignmentId: string, baseline: string): Promise<void> {
    await db
      .update(assignments)
      .set({ verdict: baseline, updatedAt: now() })
      .where(and(eq(assignments.careerId, careerId), eq(assignments.id, assignmentId)));
  }

  async remove(careerId: string, assignmentId: string): Promise<boolean> {    const row = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.careerId, careerId), eq(assignments.id, assignmentId)))
      .get();
    if (!row) return false;
    await db.delete(assignments).where(eq(assignments.id, assignmentId));
    return true;
  }
}

/**
 * Where an assignment stands, from the matches in the window.
 *
 * A points target is measured against the block it is FOR, so progress reads the matches since it was taken and
 * compares the total to the target. An experiment compares the stamped matches with the baseline it recorded when it
 * was accepted, so the comparison is against the thing being replaced rather than against the window average.
 */
export function progressOf(assignment: Assignment, matches: ReviewMatch[], baselinePpg?: number | null): AssignmentProgress {
  if (assignment.type === "POINTS_TARGET") {
    const block = matches.filter((match) => match.points !== null);
    const points = pointsIn(block);
    const target = assignment.targetPoints ?? 0;
    const done = block.length >= 5;
    return {
      matchesSince: block.length,
      pointsSince: points,
      pointsPerGame: block.length === 0 ? null : Math.round((points / block.length) * 10) / 10,
      line:
        block.length === 0
          ? `Target ${target} points. No match reported yet.`
          : `${points} of ${target} points from ${block.length} match${block.length === 1 ? "" : "es"}.`,
      offer: done ? (points >= target ? "RETAIN" : "REVERT") : null,
      offerReason: done
        ? points >= target
          ? `The block met the target of ${target}.`
          : `The block finished ${target - points} short of ${target}.`
        : null,
    };
  }

  if (assignment.type === "TACTICAL_EXPERIMENT") {
    const stamped = matches.filter(
      (match) => match.points !== null && assignment.formationLabel !== null && match.formation?.label === assignment.formationLabel
    );
    const target = assignment.matchesTarget ?? 5;
    const base = baselinePpg ?? null;
    if (stamped.length === 0) {
      return {
        matchesSince: 0,
        pointsSince: 0,
        pointsPerGame: null,
        line: `No match played in ${assignment.formationLabel ?? "the shape"} since the experiment started.`,
        offer: null,
        offerReason: null,
      };
    }
    const ppg = Math.round((pointsIn(stamped) / stamped.length) * 10) / 10;
    const enough = stamped.length >= target;
    const offer = !enough
      ? aheadOfBaseline(ppg, base)
        ? "EXTEND"
        : "INCONCLUSIVE"
      : base === null
        ? "INCONCLUSIVE"
        : ppg - base >= EXPERIMENT_EDGE
          ? "RETAIN"
          : base - ppg >= EXPERIMENT_EDGE
            ? "REVERT"
            : "INCONCLUSIVE";
    return {
      matchesSince: stamped.length,
      pointsSince: pointsIn(stamped),
      pointsPerGame: ppg,
      line:
        base === null
          ? `${stamped.length} of ${target} matches in ${assignment.formationLabel ?? "the shape"}, ${ppg} points a game.`
          : `${stamped.length} of ${target} matches in ${assignment.formationLabel ?? "the shape"} at ${ppg} a game, against ${base} before it.`,
      offer,
      offerReason:
        offer === "RETAIN"
          ? `The shape is ahead of the baseline of ${base} by ${Math.round((ppg - (base ?? 0)) * 10) / 10} points a game.`
          : offer === "REVERT"
            ? `The shape is behind the baseline of ${base} by ${Math.round(((base ?? 0) - ppg) * 10) / 10} points a game.`
            : offer === "EXTEND"
              ? `Only ${stamped.length} of ${target} matches have been played in it.`
              : `The two are too close to call on this many matches.`,
    };
  }

  const named = matches.filter((match) => match.standouts.some((name) => name === assignment.playerId));
  const target = assignment.matchesTarget ?? 5;
  return {
    matchesSince: named.length,
    pointsSince: pointsIn(named),
    pointsPerGame: named.length === 0 ? null : Math.round((pointsIn(named) / named.length) * 10) / 10,
    line:
      named.length === 0
        ? `${assignment.playerId ?? "The player"} has not been named since the watch started.`
        : `${assignment.playerId ?? "The player"} has been named in ${named.length} of ${target} matches.`,
    offer: null,
    offerReason: null,
  };
}

/** True when an experiment is running ahead of its baseline, which is a reason to extend rather than close it. */
function aheadOfBaseline(ppg: number, base: number | null): boolean {
  if (base === null) return false;
  return ppg - base >= EXPERIMENT_EDGE;
}
