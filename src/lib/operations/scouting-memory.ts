import { scoutArchiveReasons, type ScoutArchiveReason } from "../db/schema";
import { FinanceService } from "../services/finance-service";
import {
  ScoutingMemoryService,
  ARCHIVE_REASON_LABELS,
} from "../services/scouting-memory-service";
import { failed, ok, type OperationResult } from "./types";

export interface ArchiveTargetInput {
  careerId?: string;
  targetId?: string;
  reason?: string;
  valueAtArchive?: number | null;
  budgetAtArchive?: number | null;
}

function isReason(value: unknown): value is ScoutArchiveReason {
  return typeof value === "string" && (scoutArchiveReasons as readonly string[]).includes(value);
}

/**
 * GET - the memories, each re-tested against today's numbers.
 *
 * `budget` arrives as a query parameter because the caller already holds it. Reading settings here as
 * well would give the panel and the search two independent sources for one figure.
 */
export async function readScoutingMemory(
  careerId: string | null,
  rawBudget: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) {
      return failed(400, "careerId is required.");
    }

    const budget = rawBudget === null || rawBudget === "" ? null : Number.parseInt(rawBudget, 10);
    if (budget !== null && !Number.isFinite(budget)) {
      return failed(400, "budget must be a whole number of pounds, or omitted.");
    }

    const service = new ScoutingMemoryService();
    const assessments = await service.assess(careerId, budget);
    const inGameDate = await service.inGameDate(careerId);

    return ok({
      success: true,
      inGameDate,
      assessments,
      labels: ARCHIVE_REASON_LABELS,
      resurfacing: assessments.filter((row) => row.shouldResurface).length,
    });
  } catch (error) {
    console.error("[api/scouting/memory] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read scouting memory.");
  }
}

/** PUT - set a target aside with a reason and the figures that were true at the time. */
export async function archiveScoutTarget(
  body: ArchiveTargetInput
): Promise<OperationResult<unknown>> {
  try {
    if (!body.careerId || !body.targetId) {
      return failed(400, "careerId and targetId are required.");
    }
    if (!isReason(body.reason)) {
      return failed(400, `reason must be one of: ${scoutArchiveReasons.join(", ")}.`);
    }

    await new ScoutingMemoryService().archive({
      careerId: body.careerId,
      targetId: body.targetId,
      reason: body.reason,
      valueAtArchive:
        typeof body.valueAtArchive === "number" && Number.isFinite(body.valueAtArchive)
          ? body.valueAtArchive
          : null,
      // The budget he could not afford at the time, read here rather than sent from the browser, so
      // the stored figure is the same one the Finances screen shows.
      budgetAtArchive:
        typeof body.budgetAtArchive === "number" && Number.isFinite(body.budgetAtArchive)
          ? body.budgetAtArchive
          : await new FinanceService()
              .getReport(body.careerId)
              .then((report) => report?.transferBudget ?? null)
              .catch(() => null),
    });

    return ok({ success: true });
  } catch (error) {
    console.error("[api/scouting/memory] archive failed:", error);
    return failed(500, (error as Error).message ?? "Could not archive that target.");
  }
}

/** DELETE - bring a target back to the board and clear its memory. */
export async function restoreScoutTarget(
  params: URLSearchParams
): Promise<OperationResult<unknown>> {
  try {
    const careerId = params.get("careerId");
    const targetId = params.get("targetId");
    if (!careerId || !targetId) {
      return failed(400, "careerId and targetId are required.");
    }

    await new ScoutingMemoryService().restore(careerId, targetId);
    return ok({ success: true });
  } catch (error) {
    console.error("[api/scouting/memory] restore failed:", error);
    return failed(500, (error as Error).message ?? "Could not restore that target.");
  }
}
