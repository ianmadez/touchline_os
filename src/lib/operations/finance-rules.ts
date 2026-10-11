import { FinanceRulesService } from "../services/finance-rules-service";
import { failed, ok, type OperationResult } from "./types";

/**
 * League rules, checked against what is on file.
 *
 * The rules themselves are authored reference data rather than save data, and the report carries the lines
 * that say so. Verdicts only read as verdicts when the career is set to strict realism.
 */
export async function readFinanceRules(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const report = await new FinanceRulesService().getReport(careerId);
    if (!report) return failed(404, "Career not found.");
    return ok({ success: true, report });
  } catch (error) {
    console.error("[api/finance-rules] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not check the league rules.");
  }
}
