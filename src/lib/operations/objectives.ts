import { BoardObjectiveService } from "../services/board-objective-service";
import { failed, ok, type OperationResult } from "./types";

export interface ObjectiveInput {
  id?: string | null;
  careerId?: string;
  seasonNumber?: number;
  category?: string;
  priority?: number;
  title?: string;
  status?: string;
  notes?: string | null;
}

/**
 * The manager's board-objective tracker.
 *
 * USER provenance end to end: nothing here is read from the save, so nothing here is computed. The
 * save holds one numeric objective code with no wording, which is precisely why the manager has to
 * record what he was actually given.
 */
export async function readObjectives(
  careerId: string | null,
  seasonParam: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  const seasonNumber = seasonParam === null ? null : Number(seasonParam);
  if (seasonNumber !== null && !Number.isFinite(seasonNumber)) {
    return failed(400, "season must be a number.");
  }

  try {
    return ok({
      success: true,
      objectives: await new BoardObjectiveService().list(careerId, seasonNumber),
    });
  } catch (error) {
    console.error("[api/objectives] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your objectives.");
  }
}

export async function saveObjective(body: ObjectiveInput): Promise<OperationResult<unknown>> {
  try {
    if (!body.careerId || typeof body.seasonNumber !== "number" || !body.category || !body.title) {
      return failed(400, "careerId, seasonNumber, category and title are required.");
    }

    return ok({
      success: true,
      objectives: await new BoardObjectiveService().save({
        id: body.id ?? null,
        careerId: body.careerId,
        seasonNumber: body.seasonNumber,
        category: body.category,
        priority: body.priority,
        title: body.title,
        status: body.status,
        notes: body.notes,
      }),
    });
  } catch (error) {
    console.error("[api/objectives] save failed:", error);
    return failed(500, (error as Error).message ?? "Could not save that objective.");
  }
}

export async function deleteObjective(input: {
  careerId: string | null;
  id: string | null;
  season: string | null;
}): Promise<OperationResult<unknown>> {
  const seasonNumber = Number(input.season);
  if (!input.careerId || !input.id || !Number.isFinite(seasonNumber)) {
    return failed(
      400,
      "careerId, id and season are required - the season is needed to return the fresh list."
    );
  }

  try {
    return ok({
      success: true,
      objectives: await new BoardObjectiveService().remove(input.careerId, input.id, seasonNumber),
    });
  } catch (error) {
    console.error("[api/objectives] delete failed:", error);
    return failed(500, (error as Error).message ?? "Could not remove that objective.");
  }
}
