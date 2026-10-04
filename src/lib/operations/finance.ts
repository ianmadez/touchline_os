import { FinanceService } from "../services/finance-service";
import { failed, ok, type OperationResult } from "./types";

export interface FinanceInput {
  careerId?: string;
  transferBudget?: number | string | null;
  wageBudget?: number | string | null;
  notes?: string | null;
}

/** A blank field clears the figure; a typed 0 is a deliberate zero and is kept. */
function asAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The read-only finance report for a career.
 *
 * GET computes everything on demand and writes nothing. A 200 with `report: null` means the career
 * does not exist, which the UI shows as an empty state rather than an error.
 */
export async function readFinanceReport(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const report = await new FinanceService().getReport(careerId);
    return ok({ success: true, report });
  } catch (error) {
    console.error("[api/finance] report failed:", error);
    return failed(500, (error as Error).message ?? "Could not build the finance report.");
  }
}

/**
 * Records the two budgets the save does not carry.
 *
 * The only write in this module, and deliberately narrow: it stores what the manager states and
 * nothing else. A blank field clears the figure (null), while a typed 0 is kept as a real zero -
 * "I have nothing left" is a fact worth being able to record.
 */
export async function saveFinanceInputs(
  body: FinanceInput
): Promise<OperationResult<unknown>> {
  try {
    if (!body.careerId) {
      return failed(400, "careerId is required.");
    }

    const service = new FinanceService();
    // Build the patch from the keys that were ACTUALLY sent. Passing both unconditionally would
    // send `null` for the field the caller did not mention, which the service reads as "clear it" -
    // so saving one budget silently wiped the other.
    const patch: {
      transferBudget?: number | null;
      wageBudget?: number | null;
      notes?: string | null;
    } = {};
    if ("transferBudget" in body) patch.transferBudget = asAmount(body.transferBudget);
    if ("wageBudget" in body) patch.wageBudget = asAmount(body.wageBudget);
    if ("notes" in body) patch.notes = body.notes?.trim() || null;

    await service.saveInputs(body.careerId, patch);

    return ok({ success: true, report: await service.getReport(body.careerId) });
  } catch (error) {
    console.error("[api/finance] inputs failed:", error);
    return failed(500, (error as Error).message ?? "Could not save those figures.");
  }
}
