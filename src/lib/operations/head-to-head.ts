import { HeadToHeadService } from "../services/h2h-service";
import { failed, ok, type OperationResult } from "./types";

/**
 * The head-to-head record.
 *
 * Built entirely from the manager's own debriefs, because the save records no fixtures and no results for
 * his division. That is stated on the screen as well as here: a table like this looks like save data, and it
 * is not.
 */
export async function readHeadToHead(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const record = await new HeadToHeadService().getRecord(careerId);
    return ok({ success: true, record });
  } catch (error) {
    console.error("[api/h2h] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not build the head-to-head record.");
  }
}
