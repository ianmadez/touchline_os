import { CareerService } from "../services/career-service";
import { UserProfileService } from "../services/user-profile-service";
import { KNOWN_POSITION_ROLES } from "../parser/interface";
import { TacticsService, type PitchSlotAssignment } from "../services/tactics-service";
import { at, failed, ok, type OperationResult } from "./types";

interface PatchCareerRequest {
  careerId?: string;
  tactics?: {
    formationId?: string;
    slots?: PitchSlotAssignment[];
    /** Which saved formation these slots belong to. Omitted means the manager's current XI. */
    label?: string;
  };
  /** Formation lifecycle: a manager may keep as many formations as they like. */
  formations?: {
    action: "CREATE" | "RENAME" | "DELETE" | "SET_DEFAULT";
    label?: string;
    nextLabel?: string;
    formationId?: string;
  };
  playerProfile?: {
    eaPlayerId?: number;
    assignedRole?: string;
    trustLevel?: "HIGH" | "MEDIUM" | "LOW";
    importanceMarker?: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS";
    userNotes?: string;
    /** Manual position override for players whose save position is UNKNOWN. */
    primaryPosition?: string | null;
  };
}

const NO_CAREER = () =>
  failed(404, "NO_CAREER", "No synced career found yet.");

/**
 * Re-hydrates a stored career without re-reading the save file — this is what a browser refresh
 * uses. With no `careerId` the most recently updated career is returned.
 */
export async function readCareer(requestedId: string | null): Promise<OperationResult<unknown>> {
  try {
    const careerService = new CareerService();

    const career = requestedId
      ? await careerService.getCareerRow(requestedId)
      : await careerService.getLatestCareerRow();

    if (!career) return NO_CAREER();

    const payload = await careerService.hydrate(career.id);
    if (!payload) return NO_CAREER();

    return ok({ success: true, ...payload });
  } catch (error) {
    console.error("[api/career] hydration failed:", error);
    return failed(500, (error as Error).message ?? "Hydration failed.");
  }
}

/**
 * Persists user intent (2D pitch layout / player annotations) so it survives refresh.
 *
 * `body` is `unknown` on purpose: a body that is literal `null` throws on its first property read,
 * inside the `try`, which is what the route did before this moved here.
 */
export async function patchCareer(body: unknown): Promise<OperationResult<unknown>> {
  try {
    const request = body as PatchCareerRequest;

    if (!request.careerId) {
      return at(400, { success: false, error: "careerId is required." });
    }

    const careerService = new CareerService();
    const career = await careerService.getCareerRow(request.careerId);
    if (!career) {
      return at(404, { success: false, error: `Unknown career ${request.careerId}.` });
    }

    if (request.formations) {
      const tactics = new TacticsService();
      const { action, formationId } = request.formations;
      const label = request.formations.label?.trim();
      if (action === "CREATE" && formationId) {
        await tactics.createFormation(request.careerId, { formationName: formationId, label });
      } else if (action === "RENAME" && label && request.formations.nextLabel) {
        await tactics.renameFormation(request.careerId, label, request.formations.nextLabel);
      } else if (action === "DELETE" && label) {
        await tactics.deleteFormation(request.careerId, label);
      } else if (action === "SET_DEFAULT" && label) {
        await tactics.setDefaultFormation(request.careerId, label);
      }
    }

    if (request.tactics?.slots && request.tactics.formationId) {
      await careerService.saveTactics(
        request.careerId,
        request.tactics.formationId,
        request.tactics.slots,
        request.tactics.label
      );
    }

    if (request.playerProfile && typeof request.playerProfile.eaPlayerId === "number") {
      // Only accept a known role vocabulary, so a typo cannot poison the derived position.
      const requestedPosition = request.playerProfile.primaryPosition;
      const primaryPosition =
        requestedPosition === null || requestedPosition === ""
          ? null
          : typeof requestedPosition === "string" &&
              KNOWN_POSITION_ROLES.includes(requestedPosition.trim().toUpperCase())
            ? requestedPosition.trim().toUpperCase()
            : undefined;

      await new UserProfileService().setPlayerProfile({
        careerId: request.careerId,
        eaPlayerId: request.playerProfile.eaPlayerId,
        assignedRole: request.playerProfile.assignedRole,
        trustLevel: request.playerProfile.trustLevel,
        importanceMarker: request.playerProfile.importanceMarker,
        userNotes: request.playerProfile.userNotes,
        primaryPosition,
      });
    }

    const payload = await careerService.hydrate(request.careerId);
    return ok({ success: true, ...payload });
  } catch (error) {
    console.error("[api/career] update failed:", error);
    return failed(500, (error as Error).message ?? "Update failed.");
  }
}

/** Purges a career and all associated snapshots, events, and tactical systems. */
export async function deleteCareer(careerId: string | null): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) {
      return at(400, { success: false, error: "careerId parameter is required." });
    }

    const careerService = new CareerService();
    const career = await careerService.getCareerRow(careerId);
    if (!career) {
      return at(404, { success: false, error: `Career ${careerId} not found.` });
    }

    await careerService.deleteCareer(careerId);
    return ok({ success: true, message: `Career ${careerId} successfully deleted.` });
  } catch (error) {
    console.error("[api/career] delete failed:", error);
    return failed(500, (error as Error).message ?? "Delete failed.");
  }
}
