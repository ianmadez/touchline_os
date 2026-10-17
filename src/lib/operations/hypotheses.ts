/**
 * The hypothesis operation.
 *
 * Proposals are recomputed on every read from the same window the Review tab is showing, so the inbox can never
 * offer a question about matches the manager is not looking at. The store is only touched when he accepts, amends,
 * confirms or drops.
 *
 * THE POST-SAVE PASS IS ONE CALL. After a debrief or a block is saved the client PUTs the ids it just wrote; this
 * reads the open questions against the current window, adds any evidence that is missing (idempotent by derived id),
 * and answers with what those ids now speak to plus the single question worth asking. If there is nothing to confirm,
 * the row the client would render is empty and it hides itself.
 */
import { HypothesisStore } from "../hypotheses/store";
import { managerKey, proposeFromReview } from "../hypotheses/proposals";
import { nextQuestion, questionsThisSaveAnswers } from "../hypotheses/verdict";
import type { HypothesisKind } from "../db/schema";
import { buildReview, type ReadReviewOptions } from "./review";
import { at, failed, ok, type OperationResult } from "./types";

const KINDS: HypothesisKind[] = ["PERFORMANCE", "TACTICAL", "PLAYER", "SET_PIECE", "DISCIPLINE"];

function kindOf(value: unknown): HypothesisKind {
  return KINDS.includes(value as HypothesisKind) ? (value as HypothesisKind) : "PERFORMANCE";
}

function int(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Everything the Review tab needs about questions: what is tracked, what is being proposed, and the one extra
 * question worth asking after a save.
 */
export async function readHypotheses(
  careerId: string | null,
  options: ReadReviewOptions & { eventIds?: string | null }
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });

    const store = new HypothesisStore();
    const { review } = await buildReview(careerId, options);
    const tracked = await store.list(careerId);
    const proposals = proposeFromReview(
      review,
      tracked.filter((entry) => entry.ruleKey !== null).map((entry) => entry.ruleKey as string)
    );

    const eventIds = (options.eventIds ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");

    return ok({
      success: true,
      hypotheses: tracked,
      proposals,
      nextQuestion: nextQuestion(tracked),
      speaksTo: eventIds.length === 0 ? [] : questionsThisSaveAnswers(tracked, eventIds),
      reviewKey: review.key,
    });
  } catch (error) {
    console.error("[api/hypotheses] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your questions.");
  }
}

/**
 * Creates a question: either from a proposal the manager accepted, or one he wrote himself.
 *
 * A proposal is taken as the proposal rather than as an id, because proposals are not stored - they are recomputed.
 * The key inside it is what makes the accept idempotent, so a double click adopts rather than duplicates.
 */
export async function createHypothesis(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    seasonNumber?: number | null;
    proposal?: {
      key?: string;
      kind?: string;
      claim?: string;
      question?: string | null;
      reviewAfterMatches?: number;
      formationLabel?: string | null;
    };
    claim?: string;
    question?: string | null;
    reviewAfterMatches?: number;
    /** True when the manager is turning a proposal down, so it is remembered and not offered again. */
    decline?: boolean;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    if (careerId === "") return at(400, { success: false, error: "careerId is required." });

    const store = new HypothesisStore();
    const proposal = body.proposal;

    if (proposal && typeof proposal.key === "string" && typeof proposal.claim === "string") {
      const created = await store.accept(careerId, {
        key: proposal.key,
        kind: kindOf(proposal.kind),
        claim: proposal.claim,
        question: proposal.question ?? null,
        ruleKey: proposal.key,
        seasonNumber: body.seasonNumber ?? null,
        formationLabel: proposal.formationLabel ?? null,
        reviewAfterMatches: int(proposal.reviewAfterMatches, 5),
        origin: "ACCEPTED",
      });
      // A declined proposal is recorded and closed rather than forgotten, because a proposal is recomputed on every
      // read: without a row the same question would be offered again on the next visit.
      if (body.decline === true) {
        await store.drop(created.id);
        return ok({ success: true, declined: true, hypotheses: await store.list(careerId) });
      }
      return ok({ success: true, hypothesis: created, hypotheses: await store.list(careerId) });
    }

    const claim = (body.claim ?? "").trim();
    if (claim === "") {
      return at(400, { success: false, error: "A question needs a claim." });
    }
    const created = await store.accept(careerId, {
      key: managerKey(claim),
      kind: "PERFORMANCE",
      claim,
      question: body.question ?? null,
      ruleKey: null,
      seasonNumber: body.seasonNumber ?? null,
      formationLabel: null,
      reviewAfterMatches: int(body.reviewAfterMatches, 5),
      origin: "MANAGER",
    });
    return ok({ success: true, hypothesis: created, hypotheses: await store.list(careerId) });
  } catch (error) {
    console.error("[api/hypotheses] create failed:", error);
    return failed(500, (error as Error).message ?? "Could not open that question.");
  }
}

/**
 * Everything that moves a question: reading a save against it, confirming a verdict, amending the wording, dropping.
 *
 * `sync` is the post-save pass and is safe to call repeatedly: it only writes evidence that is missing.
 */
export async function updateHypothesis(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    id?: string;
    action?: string;
    eventIds?: string[];
    stance?: string;
    note?: string | null;
    claim?: string;
    question?: string | null;
    managerNote?: string | null;
    reviewAfterMatches?: number;
    blockId?: string | null;
    count?: number | null;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    if (careerId === "") return at(400, { success: false, error: "careerId is required." });

    const store = new HypothesisStore();
    const action = body.action ?? "";

    if (action === "sync") {
      const { review } = await buildReview(careerId, {
        blockId: body.blockId ?? null,
        count: body.count ?? null,
      });
      const synced = await store.syncForMatches(careerId, review.matches);
      const tracked = await store.list(careerId);
      const eventIds = (body.eventIds ?? []).filter((entry) => typeof entry === "string");
      return ok({
        success: true,
        added: synced.added,
        hypotheses: tracked,
        speaksTo: questionsThisSaveAnswers(tracked, eventIds),
        nextQuestion: nextQuestion(tracked),
      });
    }

    const id = body.id ?? "";
    if (id === "") return at(400, { success: false, error: "id is required." });

    if (action === "verdict") {
      const outcome = await store.confirmVerdict(id);
      return ok({
        success: true,
        closed: outcome.closed,
        reason: outcome.reason,
        hypothesis: outcome.hypothesis,
        hypotheses: await store.list(careerId),
      });
    }

    if (action === "evidence") {
      const eventId = (body.eventIds ?? [])[0] ?? "";
      if (eventId === "") return at(400, { success: false, error: "An eventId is required." });
      const stance = body.stance === "AGAINST" ? "AGAINST" : "FOR";
      const hypothesis = await store.confirmEvidence(id, eventId, stance, body.note ?? null);
      return ok({ success: true, hypothesis, hypotheses: await store.list(careerId) });
    }

    if (action === "amend") {
      const hypothesis = await store.amend(id, {
        claim: body.claim,
        question: body.question,
        managerNote: body.managerNote,
        reviewAfterMatches: body.reviewAfterMatches,
      });
      return ok({ success: true, hypothesis, hypotheses: await store.list(careerId) });
    }

    if (action === "drop") {
      const hypothesis = await store.drop(id);
      return ok({ success: true, hypothesis, hypotheses: await store.list(careerId) });
    }

    return at(400, { success: false, error: `Unknown action ${action}.` });
  } catch (error) {
    console.error("[api/hypotheses] update failed:", error);
    return failed(500, (error as Error).message ?? "Could not update that question.");
  }
}

/** Deletes a question outright. Only for one the manager wrote; a rule's question is dropped, not deleted. */
export async function deleteHypothesis(
  careerId: string | null,
  id: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId || !id) return at(400, { success: false, error: "careerId and id are required." });
    const store = new HypothesisStore();
    const removed = await store.remove(id);
    return ok({ success: removed, hypotheses: await store.list(careerId) });
  } catch (error) {
    console.error("[api/hypotheses] delete failed:", error);
    return failed(500, (error as Error).message ?? "Could not delete that question.");
  }
}
