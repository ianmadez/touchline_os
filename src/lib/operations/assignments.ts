/**
 * The assignments operation.
 *
 * Proposals come from the same window the Review tab is showing, and progress is computed against the matches in that
 * window. Nothing here stores a running total: an assignment holds the commitment, and every read works out where it
 * stands. That is what keeps an edited or deleted match from leaving a wrong total behind.
 */
import { AssignmentStore, progressOf } from "../assignments/store";
import { positionContextLine, proposeAssignments } from "../assignments/propose";
import type { AssignmentProposal } from "../assignments/types";
import { TargetBlockService } from "../services/target-block-service";
import { SeasonService } from "../services/season-service";
import { buildReview, type ReadReviewOptions } from "./review";
import { at, failed, ok, type OperationResult } from "./types";

const BASELINE_PREFIX = "baseline:";

/**
 * The baseline an experiment is judged against, kept in the verdict column as `baseline:1.4`.
 *
 * The column is otherwise the manager's closing words, and an active row has none - so writing the baseline there is
 * the smallest honest place for it. `baselineFrom` reads it back, and anything that is not a baseline reads as null.
 */
export function baselineFrom(verdict: string | null): number | null {
  if (verdict === null || !verdict.startsWith(BASELINE_PREFIX)) return null;
  const parsed = Number(verdict.slice(BASELINE_PREFIX.length));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Everything the panel needs: what is active with its progress, what is proposed, and the position context.
 *
 * The position line is carried separately from the proposals on purpose. It is context for a points target, never an
 * input into one: a league place and a points total are different currencies.
 */
export async function readAssignments(
  careerId: string | null,
  options: ReadReviewOptions
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });

    const store = new AssignmentStore();
    const { review, bands } = await buildReview(careerId, options);
    const [list, objectives, outlook] = await Promise.all([
      store.list(careerId),
      new SeasonService().getObjectives(careerId),
      new SeasonService().getOutlook(careerId),
    ]);

    const targetPosition =
      objectives.filter((objective) => objective.source === "USER" && objective.targetPosition !== null).at(-1)
        ?.targetPosition ?? null;
    const currentPosition = outlook?.loggedPosition ?? null;

    const activeList = list.filter((assignment) => assignment.status === "ACTIVE");
    const progress = activeList.map((assignment) => ({
      assignment,
      progress: progressOf(assignment, review.matches, baselineFrom(assignment.verdict)),
    }));

    const proposals = proposeAssignments({
      matches: review.matches,
      blocks: bands.map((band) => ({
        id: band.id,
        seasonNumber: band.seasonNumber,
        blockIndex: band.blockIndex,
        points: band.points,
        possible: band.possible,
        targetMin: band.targetMin,
        targetMax: band.targetMax,
        concernPoints: band.concernPoints,
        dreamPoints: band.dreamPoints,
        matchesPlayed: Math.round(band.possible / 3),
      })),
      targetPosition,
      currentPosition,
      active: activeList.map((assignment) => ({
        type: assignment.type,
        formationLabel: assignment.formationLabel,
        playerId: assignment.playerId,
      })),
    });

    return ok({
      success: true,
      assignments: list,
      active: progress,
      proposals,
      positionLine: positionContextLine(targetPosition, currentPosition),
      reviewKey: review.key,
      nextBlockIndex: await nextBlockIndex(careerId),
    });
  } catch (error) {
    console.error("[api/assignments] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your assignments.");
  }
}

/** The block a points target would pre-fill, so the panel can name it before the manager accepts. */
async function nextBlockIndex(careerId: string): Promise<number> {
  const blocks = await new TargetBlockService().listBlocks(careerId);
  const season = blocks.reduce((highest, block) => Math.max(highest, block.seasonNumber), 0);
  const inSeason = blocks.filter((block) => block.seasonNumber === season);
  return inSeason.reduce((highest, block) => Math.max(highest, block.blockIndex), 0) + 1;
}

/** Accepts a proposal, recording the baseline an experiment will be judged against. */
export async function createAssignment(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    seasonNumber?: number | null;
    reviewKey?: string | null;
    proposal?: AssignmentProposal;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    const proposal = body.proposal;
    if (careerId === "") return at(400, { success: false, error: "careerId is required." });
    if (!proposal || typeof proposal !== "object") {
      return at(400, { success: false, error: "A proposal is required." });
    }

    const store = new AssignmentStore();
    const blockIndex = await nextBlockIndex(careerId);

    if (proposal.type === "POINTS_TARGET") {
      const created = await store.create(careerId, {
        type: "POINTS_TARGET",
        seasonNumber: body.seasonNumber ?? null,
        targetPoints: Math.max(0, Math.min(15, Math.trunc(proposal.value))),
        matchesTarget: 5,
        blockIndex,
        reviewKey: body.reviewKey ?? null,
      });
      return ok({ success: true, assignment: created, assignments: await store.list(careerId), blockIndex });
    }

    if (proposal.type === "TACTICAL_EXPERIMENT") {
      const created = await store.create(careerId, {
        type: "TACTICAL_EXPERIMENT",
        seasonNumber: body.seasonNumber ?? null,
        formationLabel: proposal.formationLabel,
        matchesTarget: Math.max(1, Math.trunc(proposal.matchesTarget)),
        reviewKey: body.reviewKey ?? null,
      });
      const baseline = `${BASELINE_PREFIX}${proposal.baselinePointsPerGame}`;
      await store.setBaseline(careerId, created.id, baseline);
      return ok({
        success: true,
        assignment: { ...created, verdict: baseline },
        assignments: await store.list(careerId),
      });
    }

    const created = await store.create(careerId, {
      type: "PLAYER_WATCH",
      seasonNumber: body.seasonNumber ?? null,
      playerId: proposal.playerName,
      matchesTarget: Math.max(1, Math.trunc(proposal.matchesTarget)),
      reviewKey: body.reviewKey ?? null,
    });
    return ok({ success: true, assignment: created, assignments: await store.list(careerId) });
  } catch (error) {
    console.error("[api/assignments] create failed:", error);
    return failed(500, (error as Error).message ?? "Could not record that assignment.");
  }
}

/** Closes an assignment the manager has finished with. */
export async function updateAssignment(rawBody: string): Promise<OperationResult<unknown>> {
  let body: { careerId?: string; id?: string; status?: string; verdict?: string | null };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    const id = body.id ?? "";
    if (careerId === "" || id === "") {
      return at(400, { success: false, error: "careerId and id are required." });
    }
    const status =
      body.status === "MET" || body.status === "MISSED" || body.status === "CONCLUDED" || body.status === "DROPPED"
        ? body.status
        : null;
    if (status === null) {
      return at(400, { success: false, error: "status must be MET, MISSED, CONCLUDED or DROPPED." });
    }
    const store = new AssignmentStore();
    const updated = await store.close(careerId, id, status, body.verdict ?? null);
    if (updated === null) return at(404, { success: false, error: "No such assignment." });
    return ok({ success: true, assignment: updated, assignments: await store.list(careerId) });
  } catch (error) {
    console.error("[api/assignments] update failed:", error);
    return failed(500, (error as Error).message ?? "Could not update that assignment.");
  }
}

/** Removes an assignment. */
export async function deleteAssignment(
  careerId: string | null,
  id: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId || !id) return at(400, { success: false, error: "careerId and id are required." });
    const store = new AssignmentStore();
    const removed = await store.remove(careerId, id);
    return ok({ success: removed, assignments: await store.list(careerId) });
  } catch (error) {
    console.error("[api/assignments] delete failed:", error);
    return failed(500, (error as Error).message ?? "Could not delete that assignment.");
  }
}
