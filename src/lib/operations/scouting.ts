import { FinanceService } from "../services/finance-service";
import { ScoutingService } from "../services/scouting-service";
import { failed, ok, type OperationResult } from "./types";

type ScoutTargetRecord = Parameters<ScoutingService["saveTarget"]>[0];

export interface ScoutTargetInput {
  careerId?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * The scouting board.
 *
 * The transfer budget is read here, once, and handed to the assessment - the board and the Finances
 * screen must never disagree about the same number, so there is a single place it comes from.
 */
async function boardFor(careerId: string) {
  const [targets, report] = await Promise.all([
    new ScoutingService().listTargets(careerId),
    new FinanceService().getReport(careerId),
  ]);
  return new ScoutingService().build(targets, report?.transferBudget ?? null);
}

export async function readScoutingBoard(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) {
      return failed(400, "careerId is required.");
    }
    return ok({ success: true, board: await boardFor(careerId) });
  } catch (error) {
    console.error("[api/scouting] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read the scouting board.");
  }
}

export async function saveScoutTarget(
  body: ScoutTargetInput
): Promise<OperationResult<unknown>> {
  try {
    if (!body.careerId || !body.name?.trim()) {
      return failed(400, "careerId and name are required.");
    }
    const service = new ScoutingService();
    await service.saveTarget({
      ...(body as unknown as ScoutTargetRecord),
      careerId: body.careerId,
      name: body.name,
    });
    return ok({ success: true, board: await boardFor(body.careerId) });
  } catch (error) {
    console.error("[api/scouting] save failed:", error);
    return failed(500, (error as Error).message ?? "Could not save that target.");
  }
}

export async function deleteScoutTarget(
  params: URLSearchParams
): Promise<OperationResult<unknown>> {
  try {
    const careerId = params.get("careerId");
    const id = params.get("id");
    if (!careerId || !id) {
      return failed(400, "careerId and id are required.");
    }
    await new ScoutingService().deleteTarget(careerId, id);
    return ok({ success: true, board: await boardFor(careerId) });
  } catch (error) {
    console.error("[api/scouting] delete failed:", error);
    return failed(500, (error as Error).message ?? "Could not remove that target.");
  }
}
