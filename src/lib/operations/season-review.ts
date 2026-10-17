/**
 * The season review operation.
 *
 * It assembles the closing page for a season and the carry-over list that follows it, and it stores the manager's
 * keep or drop answers in the same decisions table a review uses - one place for "what did he decide about this
 * evidence", whether the evidence is a window of matches or a season.
 *
 * NOTHING HERE BLOCKS A TRANSITION. The season end pass (`evaluateSeasonTransition`) runs on hydration and is
 * idempotent; this operation only reads its result and offers rows. A manager who never opens the page loses nothing:
 * every carry-over row defaults to keep.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { reviewDecisions } from "../db/schema";
import { AssignmentStore } from "../assignments/store";
import { HypothesisStore } from "../hypotheses/store";
import { carryOverOptionId, carryOverReviewKey, composeSeasonReview, type CarryOverKind } from "../season/handover";
import { SeasonArchiveService } from "../services/season-archive-service";
import { SeasonService } from "../services/season-service";
import { TargetBlockService } from "../services/target-block-service";
import { at, failed, ok, type OperationResult } from "./types";

const KINDS: CarryOverKind[] = ["OBJECTIVE", "HYPOTHESIS", "ASSIGNMENT", "FORMATION"];

export interface CarryOverRecord {
  optionId: string;
  decision: "ACCEPTED" | "DROPPED" | "PENDING";
}

/**
 * The season review for one season, plus the answers already given.
 *
 * With no season named it reads the season the career is in, so opening the Vault mid-season shows "so far" rather
 * than last year's page. A named season reads that one, which is what the Vault's season list needs.
 */
export async function readSeasonReview(
  careerId: string | null,
  seasonParam: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });

    const seasonService = new SeasonService();
    const history = await seasonService.getSeasonHistory(careerId);
    if (history.length === 0) {
      return ok({ success: true, review: null, decisions: [], seasons: [] });
    }

    const requested = Number(seasonParam);
    const season = Number.isFinite(requested) && requested > 0 ? requested : (history.at(-1)?.season ?? 1);

    const [dossier, blocks, hypotheses, assignments] = await Promise.all([
      new SeasonArchiveService().getSeasonDossier(careerId, season),
      new TargetBlockService().listBlocks(careerId, season),
      new HypothesisStore().list(careerId),
      new AssignmentStore().list(careerId),
    ]);

    if (dossier === null) {
      return ok({
        success: true,
        review: null,
        decisions: [],
        seasons: history.map((entry) => ({
          season: entry.season,
          complete: entry.complete,
        })),
      });
    }

    const service = new TargetBlockService();
    const bands = blocks.map((block) => {
      const summary = service.summarise(block, dossier.fromSave.tablePosition);
      const formations = new Map<string, number>();
      for (const match of block.matches) {
        if (match.formation === null) continue;
        formations.set(match.formation.label, (formations.get(match.formation.label) ?? 0) + 1);
      }
      const label = [...formations.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
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
        formationLabel: label,
      };
    });

    const review = composeSeasonReview({
      dossier,
      blocks: bands,
      hypotheses,
      assignments,
    });

    const decisions = await readCarryOver(careerId, season);
    return ok({
      success: true,
      review,
      decisions,
      /** True once the manager has said he has seen this handover, so the banner stops asking. */
      handoverDone: decisions.some((entry) => entry.optionId === "HANDOVER"),
      seasons: history.map((entry) => ({ season: entry.season, complete: entry.complete })),
    });
  } catch (error) {
    console.error("[api/season/review] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read the season back.");
  }
}

async function readCarryOver(careerId: string, season: number): Promise<CarryOverRecord[]> {
  const rows = await db
    .select()
    .from(reviewDecisions)
    .where(
      and(eq(reviewDecisions.careerId, careerId), eq(reviewDecisions.reviewKey, carryOverReviewKey(season)))
    );
  return rows.map((row) => ({
    optionId: row.optionId,
    decision: row.decision as CarryOverRecord["decision"],
  }));
}

/**
 * Records the keep or drop answers for a season.
 *
 * An answer is an upsert on (career, season, object), so changing his mind rewrites a row rather than stacking a
 * second one. KEEP is stored as ACCEPTED and DROP as DROPPED, reusing the decisions table's vocabulary so there is
 * one way to read "he said yes" across the whole app.
 */
export async function recordCarryOver(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    season?: number;
    items?: Array<{ kind?: string; refId?: string; decision?: string }>;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    const season = Math.trunc(Number(body.season));
    if (careerId === "" || !Number.isFinite(season) || season <= 0) {
      return at(400, { success: false, error: "careerId and season are required." });
    }
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return ok({ success: true, decisions: await readCarryOver(careerId, season) });

    const reviewKey = carryOverReviewKey(season);
    const keys: string[] = [];
    for (const item of items) {
      // "HANDOVER" is not a carry-over item: it is the manager saying he has seen the handover at all, which is what
      // stops the banner asking. It lives in the same table so there is one place to look for what he decided.
      if (item.kind === "HANDOVER") {
        const optionId = "HANDOVER";
        keys.push(optionId);
        await db
          .insert(reviewDecisions)
          .values({
            id: `rev_${reviewKey}_${optionId}`,
            careerId,
            reviewKey,
            optionId,
            decision: "ACCEPTED",
            note: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: reviewDecisions.id,
            set: { decision: "ACCEPTED", updatedAt: new Date().toISOString() },
          });
        continue;
      }
      const kind = KINDS.includes(item.kind as CarryOverKind) ? (item.kind as CarryOverKind) : null;
      const refId = typeof item.refId === "string" ? item.refId : "";
      if (kind === null || refId === "") continue;
      const decision =
        item.decision === "DROPPED" ? "DROPPED" : item.decision === "PENDING" ? "PENDING" : "ACCEPTED";
      const optionId = carryOverOptionId(kind, refId);
      keys.push(optionId);
      await db
        .insert(reviewDecisions)
        .values({
          id: `rev_${reviewKey}_${optionId}`.replace(/[^A-Za-z0-9_:-]/g, "_"),
          careerId,
          reviewKey,
          optionId,
          decision,
          note: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: reviewDecisions.id,
          set: { decision, updatedAt: new Date().toISOString() },
        });
    }

    return ok({ success: true, decisions: await readCarryOver(careerId, season), keys });
  } catch (error) {
    console.error("[api/season/review] carry-over failed:", error);
    return failed(500, (error as Error).message ?? "Could not record that answer.");
  }
}

/**
 * Runs the season-end pass and reports what moved.
 *
 * The pass itself lives in `SeasonService` and runs on every hydration; this exists so the Vault can offer it as an
 * explicit action that says what changed, rather than a manager wondering whether a season has been closed out.
 */
export async function runSeasonTransition(careerId: string | null): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });
    const changes = await new SeasonService().evaluateSeasonTransition(careerId);
    const history = await new SeasonService().getSeasonHistory(careerId);
    return ok({
      success: true,
      changes,
      seasons: history.map((entry) => ({ season: entry.season, complete: entry.complete })),
    });
  } catch (error) {
    console.error("[api/season/review] transition failed:", error);
    return failed(500, (error as Error).message ?? "Could not run the season transition.");
  }
}

/** Removes every carry-over answer for a season, used when a season is removed or re-imported. */
export async function clearCarryOver(careerId: string, season: number): Promise<void> {
  await db
    .delete(reviewDecisions)
    .where(and(eq(reviewDecisions.careerId, careerId), eq(reviewDecisions.reviewKey, carryOverReviewKey(season))));
}
