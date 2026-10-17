/**
 * The review operation: gather what the engine needs, compose, and hand back the decisions.
 *
 * This is the only place that reads the database for a review. The engine itself never touches it, which is what
 * makes the review testable without a career and reproducible from stored data alone.
 *
 * WHAT IS DELIBERATELY NOT READ. Nothing here reads today's formations to fill in a missing stamp: a stamp is what
 * the manager said at the time, and filling one from the Tactics tab would attribute today's shape to an old match.
 * Nothing here reads the news desk either, so a review never repeats a storyline as if it were its own finding.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import { careerEvents, reviewDecisions } from "../db/schema";
import { composeReview } from "../review";
import { readProfile } from "../review/profile";
import {
  type Review,
  type ReviewBlockBand,
  type ReviewContext,
  type ReviewRequest,
  type RulesProfile,
} from "../review/types";
import type { WindowEvent } from "../review/window";
import { SeasonService } from "../services/season-service";
import { SquadService } from "../services/squad-service";
import { TacticsService } from "../services/tactics-service";
import { TargetBlockService, type TargetBlock } from "../services/target-block-service";
import { at, failed, ok, type OperationResult } from "./types";

/** The decisions recorded for one review, so the screen can show what was already answered. */
export interface ReviewDecisionRecord {
  optionId: string;
  decision: "ACCEPTED" | "DROPPED" | "PENDING";
  note: string | null;
}

const KEY_PLAYER_MARKERS = new Set(["UNTOUCHABLE", "KEY_PLAYER"]);

/** The band a block was judged against, from the service's own summary so the two cannot disagree. */
function bandOf(block: TargetBlock, summary: { points: number; verdict: string }): ReviewBlockBand {
  return {
    id: block.id,
    seasonNumber: block.seasonNumber,
    blockIndex: block.blockIndex,
    verdict: summary.verdict,
    points: summary.points,
    possible: block.matches.filter((match) => match.actualPoints !== null).length * 3,
    targetMin: block.targetMin,
    targetMax: block.targetMax,
    dreamPoints: block.dreamPoints,
    concernPoints: block.concernPoints,
    tablePosition: block.tablePosition,
    formationLabel: dominantFormation(block),
  };
}

/**
 * The shape most of a block's matches were played in, or null when none recorded one.
 *
 * A block can hold more than one shape, so a season summary needs one label per block to add up. The
 * most-used shape is the honest pick: it describes the block better than the last one entered, and a tie
 * falls back to whichever was recorded first rather than to a guess.
 */
function dominantFormation(block: TargetBlock): string | null {
  const counts = new Map<string, number>();
  for (const match of block.matches) {
    if (match.formation === null) continue;
    counts.set(match.formation.label, (counts.get(match.formation.label) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? null;
}

async function eventsFor(careerId: string): Promise<WindowEvent[]> {
  const rows = await db
    .select()
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")))
    .orderBy(desc(careerEvents.timestamp));

  return rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(row.payloadJson);
      if (typeof parsed === "object" && parsed !== null) payload = parsed as Record<string, unknown>;
    } catch {
      /* an unreadable payload costs that match, not the review */
    }
    return {
      id: row.id,
      timestamp: row.timestamp,
      entityType: row.entityType,
      payload,
    };
  });
}

/**
 * The career state a review may read.
 *
 * Every value here is either the save's or the manager's, and every one of them may be null. A null is passed
 * through rather than defaulted, because "no league position recorded" and "eighth" are different claims.
 */
async function contextFor(
  careerId: string,
  previousBlock: ReviewBlockBand | null,
  profile: RulesProfile
): Promise<ReviewContext> {
  const seasonService = new SeasonService();
  const [objectives, outlook, squad, tactics] = await Promise.all([
    seasonService.getObjectives(careerId),
    seasonService.getOutlook(careerId),
    new SquadService().getCurrentSquad(careerId),
    new TacticsService().listFormations(careerId),
  ]);

  const userObjective = objectives
    .filter((objective) => objective.source === "USER" && objective.targetPosition !== null)
    .at(-1);

  const keyPlayerNames = squad
    .filter((player) => {
      const marker = player.userProfile?.importanceMarker ?? null;
      return marker !== null && KEY_PLAYER_MARKERS.has(marker);
    })
    .map((player) => player.name);

  const playerAges: Record<string, number | null> = {};
  for (const player of squad) playerAges[player.name] = player.age ?? null;

  return {
    objective: userObjective ? { targetPosition: userObjective.targetPosition } : null,
    currentPosition: outlook?.loggedPosition ?? null,
    previousBlock,
    keyPlayerNames,
    playerAges,
    savedFormationCount: tactics.length,
    profile,
  };
}

/** The rules profile for a career. Absent means every toggle is off, which blocks nothing. */
async function profileFor(careerId: string): Promise<RulesProfile> {
  return readProfile(careerId);
}

export interface ReadReviewOptions {
  blockId?: string | null;
  from?: string | null;
  to?: string | null;
  count?: string | number | null;
}

/** Everything the rest of the engine needs from one read, so the tab, the inbox and the panel share one window. */
export interface BuiltReview {
  review: Review;
  blocks: TargetBlock[];
  /** Every block's band, newest first, for the points target arithmetic. */
  bands: ReviewBlockBand[];
  preferences: RulesProfile;
}

/**
 * Composes the review for a block or a window.
 *
 * The request is resolved here rather than in the UI: when no block and no window is named, the newest block is read
 * if there is one, and the newest matches otherwise. That is the "just show me the block" case, which is what a
 * manager arriving at the tab almost always means.
 *
 * Shared by the review route, the hypothesis inbox and the assignments panel, so all three argue from the same
 * window - two surfaces disagreeing about which matches they are talking about would be the worst kind of bug here.
 */
export async function buildReview(
  careerId: string,
  options: ReadReviewOptions
): Promise<BuiltReview> {
  const blocks = await new TargetBlockService().listBlocks(careerId);
  const sortedBlocks = [...blocks].sort(
    (left, right) => right.seasonNumber - left.seasonNumber || right.blockIndex - left.blockIndex
  );

  const requestedBlock =
    typeof options.blockId === "string" && options.blockId !== ""
      ? blocks.find((block) => block.id === options.blockId) ?? null
      : null;

  const request: ReviewRequest = requestedBlock !== null
    ? { kind: "BLOCK", blockId: requestedBlock.id }
    : options.from || options.to || options.count
      ? {
          kind: "WINDOW",
          from: options.from ?? null,
          to: options.to ?? null,
          count: options.count === null || options.count === undefined ? null : Number(options.count),
        }
      : sortedBlocks.length > 0
        ? { kind: "BLOCK", blockId: sortedBlocks[0].id }
        : { kind: "WINDOW", count: 5 };

  const block = request.kind === "BLOCK"
    ? blocks.find((candidate) => candidate.id === request.blockId) ?? null
    : null;

  const previousBlock = block === null
    ? null
    : blocks
        .filter(
          (candidate) =>
            candidate.seasonNumber === block.seasonNumber && candidate.blockIndex < block.blockIndex
        )
        .sort((left, right) => right.blockIndex - left.blockIndex)
        .map((candidate) => bandOf(candidate, new TargetBlockService().summarise(candidate, null)))[0] ?? null;

  const preferences = await profileFor(careerId);
  const [events, context] = await Promise.all([
    eventsFor(careerId),
    contextFor(careerId, previousBlock, preferences),
  ]);

  const band =
    block === null
      ? null
      : bandOf(block, new TargetBlockService().summarise(block, context.currentPosition));

  const review: Review = composeReview({ request, events, blocks, context, band });

  const bands = sortedBlocks.map((candidate) =>
    bandOf(candidate, new TargetBlockService().summarise(candidate, context.currentPosition))
  );

  return { review, blocks, bands, preferences };
}

/** The review for a career, with the decisions already recorded against it. */
export async function readReview(
  careerId: string | null,
  options: ReadReviewOptions
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });

    const { review } = await buildReview(careerId, options);
    const decisions = await readReviewDecisions(careerId, review.key);
    return ok({ success: true, review, decisions });
  } catch (error) {
    console.error("[api/review] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not build the review.");
  }
}

/** The decisions against one review key. */
export async function readReviewDecisions(
  careerId: string,
  reviewKey: string
): Promise<ReviewDecisionRecord[]> {
  const rows = await db
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.careerId, careerId), eq(reviewDecisions.reviewKey, reviewKey)));

  return rows.map((row) => ({
    optionId: row.optionId,
    decision: row.decision as ReviewDecisionRecord["decision"],
    note: row.note,
  }));
}

/**
 * Records what the manager did with one option.
 *
 * An upsert on (career, review, option): taking the same option twice updates the row rather than adding a second
 * one, and changing his mind is a update rather than a delete. Pending is a real answer - it is what the row holds
 * when he has seen the option and not decided.
 */
export async function recordReviewDecision(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    reviewKey?: string;
    optionId?: string;
    decision?: string;
    note?: string | null;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    const reviewKey = body.reviewKey ?? "";
    const optionId = body.optionId ?? "";
    if (careerId === "" || reviewKey === "" || optionId === "") {
      return at(400, { success: false, error: "careerId, reviewKey and optionId are required." });
    }
    const decision =
      body.decision === "ACCEPTED" || body.decision === "DROPPED" || body.decision === "PENDING"
        ? body.decision
        : "PENDING";

    const existing = await db
      .select()
      .from(reviewDecisions)
      .where(
        and(
          eq(reviewDecisions.careerId, careerId),
          eq(reviewDecisions.reviewKey, reviewKey),
          eq(reviewDecisions.optionId, optionId)
        )
      )
      .get();

    const now = new Date().toISOString();
    if (existing) {
      await db
        .update(reviewDecisions)
        .set({ decision, note: body.note ?? null, updatedAt: now })
        .where(eq(reviewDecisions.id, existing.id));
    } else {
      await db.insert(reviewDecisions).values({
        id: `rev_${reviewKey}_${optionId}`.replace(/[^A-Za-z0-9_:-]/g, "_"),
        careerId,
        reviewKey,
        optionId,
        decision,
        note: body.note ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const decisions = await readReviewDecisions(careerId, reviewKey);
    return ok({ success: true, decisions });
  } catch (error) {
    console.error("[api/review] decision failed:", error);
    return failed(500, (error as Error).message ?? "Could not record the decision.");
  }
}

/**
 * Deletes every decision attached to a set of review keys.
 *
 * Used when a block is deleted: its decisions described evidence that no longer exists. The keys are passed in
 * rather than derived, so this stays a plain delete with no opinion about what a key means.
 */
export async function deleteReviewDecisions(careerId: string, reviewKeys: string[]): Promise<void> {
  if (reviewKeys.length === 0) return;
  await db
    .delete(reviewDecisions)
    .where(and(eq(reviewDecisions.careerId, careerId), inArray(reviewDecisions.reviewKey, reviewKeys)));
}
