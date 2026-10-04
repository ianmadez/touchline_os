import { SeasonService } from "../services/season-service";
import { failed, ok, type OperationResult } from "./types";

export interface SeasonInput {
  careerId?: string;
  /** The manager's own league position. USER provenance - the save holds no live table for it. */
  leaguePosition?: number;
  /** Free-text objective for the current season, e.g. "Win promotion". */
  objectiveText?: string;
  /**
   * Optional finishing position the objective demands. Supplying it is what makes the objective
   * machine-judgeable at season end; without it nothing ever claims pass or fail.
   */
  targetPosition?: number | null;
}

/**
 * Records the two things the save cannot supply for the manager's own division: where the club
 * currently sits, and what the board has asked for. Both are USER provenance and are stored as
 * such - the position is cross-checked against the save's own points record and a disagreement is
 * returned as a flag rather than silently correcting what was entered.
 */
export async function recordSeason(body: SeasonInput): Promise<OperationResult<unknown>> {
  if (!body.careerId) {
    return failed(400, "careerId is required.");
  }

  if (body.leaguePosition !== undefined) {
    if (
      typeof body.leaguePosition !== "number" ||
      !Number.isInteger(body.leaguePosition) ||
      body.leaguePosition < 1 ||
      body.leaguePosition > 200
    ) {
      return failed(400, "leaguePosition must be a whole number between 1 and 200.");
    }
  }

  if (body.targetPosition !== undefined && body.targetPosition !== null) {
    if (
      typeof body.targetPosition !== "number" ||
      !Number.isInteger(body.targetPosition) ||
      body.targetPosition < 1 ||
      body.targetPosition > 200
    ) {
      return failed(400, "targetPosition must be a whole number between 1 and 200.");
    }
  }

  if (body.leaguePosition === undefined && body.objectiveText === undefined) {
    return failed(400, "Nothing to record: pass leaguePosition or objectiveText.");
  }

  try {
    const seasonService = new SeasonService();
    const history = await seasonService.getSeasonHistory(body.careerId);
    if (history.length === 0) {
      return failed(
        409,
        "NO_SEASON_HISTORY",
        "This career has no season history yet. Sync the save first."
      );
    }

    let positionResult: { disputed: boolean; note: string | null } | null = null;
    if (body.leaguePosition !== undefined) {
      positionResult = await seasonService.logUserPosition(body.careerId, body.leaguePosition);
    }

    if (body.objectiveText !== undefined && body.objectiveText.trim()) {
      await seasonService.setUserObjective(
        body.careerId,
        body.objectiveText.trim(),
        body.targetPosition ?? null
      );
    }

    const seasonState = await seasonService.getState(body.careerId);
    return ok({
      success: true,
      disputed: positionResult?.disputed ?? false,
      note: positionResult?.note ?? null,
      seasonState,
    });
  } catch (error) {
    console.error("[api/season] save failed:", error);
    return failed(500, (error as Error).message ?? "Could not record season data.");
  }
}

/** The season state on its own, for a panel that wants it without a full hydration. */
export async function readSeasonState(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }
  try {
    const seasonState = await new SeasonService().getState(careerId);
    return ok({ success: true, seasonState });
  } catch (error) {
    console.error("[api/season] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read season data.");
  }
}
