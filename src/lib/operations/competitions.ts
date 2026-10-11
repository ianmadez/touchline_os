import { CompetitionService } from "../services/competition-service";
import { failed, ok, at, type OperationResult } from "./types";

/**
 * Which competitions this career can be in.
 *
 * Read by the debrief form, so a match is filed under the competition it was actually played in rather than
 * under "League Match". Read-only, and cheap: it is two catalogue lookups and the authored cup table.
 */
export async function readCompetitions(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const context = await new CompetitionService().getContext(careerId);
    if (!context) {
      return at(404, { success: false, error: "That career is not in the database." });
    }
    return ok({ success: true, context });
  } catch (error) {
    console.error("[api/competitions] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read this career's competitions.");
  }
}
