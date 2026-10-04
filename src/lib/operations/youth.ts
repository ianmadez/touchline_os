import { YouthService } from "../services/youth-service";
import { failed, ok, type OperationResult } from "./types";

/**
 * The academy.
 *
 * An empty list is a valid answer, not an error: a save whose academy table is missing or holds no
 * rows has no promoted prospects to show, and the UI says so rather than implying the app is broken.
 */
export async function readYouthAcademy(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const service = new YouthService();
    const prospects = await service.list(careerId);

    return ok({
      success: true,
      prospects,
      summary: service.summarise(prospects),
    });
  } catch (error) {
    console.error("[api/youth] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your academy.");
  }
}
