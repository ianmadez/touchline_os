import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { careers } from "@/lib/db/schema";
import { CareerService } from "@/lib/services/career-service";
import { UserProfileService } from "@/lib/services/user-profile-service";
import { KNOWN_POSITION_ROLES } from "@/lib/parser/interface";
import { TacticsService, type PitchSlotAssignment } from "@/lib/services/tactics-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * GET /api/career?careerId=...
 * Re-hydrates a stored career without re-reading the save file — this is what a browser
 * refresh uses. With no `careerId` the most recently updated career is returned.
 */
export async function GET(request: Request) {
  try {
    const careerService = new CareerService();
    const requestedId = new URL(request.url).searchParams.get("careerId");

    const career = requestedId
      ? await careerService.getCareerRow(requestedId)
      : await careerService.getLatestCareerRow();

    if (!career) {
      return NextResponse.json(
        { success: false, error: "NO_CAREER", message: "No synced career found yet." },
        { status: 404 }
      );
    }

    const payload = await careerService.hydrate(career.id);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "NO_CAREER", message: "No synced career found yet." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    console.error("[api/career] hydration failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Hydration failed." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/career
 * Body: { careerId, tactics?, playerProfile? }
 * Persists user intent (2D pitch layout / player annotations) so it survives refresh.
 */
export async function PATCH(request: Request) {
  let body: PatchCareerRequest;
  try {
    body = (await request.json()) as PatchCareerRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (!body.careerId) {
    return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
  }

  try {
    const careerService = new CareerService();
    const career = await careerService.getCareerRow(body.careerId);
    if (!career) {
      return NextResponse.json(
        { success: false, error: `Unknown career ${body.careerId}.` },
        { status: 404 }
      );
    }

    if (body.formations) {
      const tactics = new TacticsService();
      const { action, formationId } = body.formations;
      const label = body.formations.label?.trim();
      if (action === "CREATE" && formationId) {
        await tactics.createFormation(body.careerId, { formationName: formationId, label });
      } else if (action === "RENAME" && label && body.formations.nextLabel) {
        await tactics.renameFormation(body.careerId, label, body.formations.nextLabel);
      } else if (action === "DELETE" && label) {
        await tactics.deleteFormation(body.careerId, label);
      } else if (action === "SET_DEFAULT" && label) {
        await tactics.setDefaultFormation(body.careerId, label);
      }
    }

    if (body.tactics?.slots && body.tactics.formationId) {
      await careerService.saveTactics(
        body.careerId,
        body.tactics.formationId,
        body.tactics.slots,
        body.tactics.label
      );
    }

    if (body.playerProfile && typeof body.playerProfile.eaPlayerId === "number") {
      // Only accept a known role vocabulary, so a typo cannot poison the derived position.
      const requestedPosition = body.playerProfile.primaryPosition;
      const primaryPosition =
        requestedPosition === null || requestedPosition === ""
          ? null
          : typeof requestedPosition === "string" &&
              KNOWN_POSITION_ROLES.includes(requestedPosition.trim().toUpperCase())
            ? requestedPosition.trim().toUpperCase()
            : undefined;

      await new UserProfileService().setPlayerProfile({
        careerId: body.careerId,
        eaPlayerId: body.playerProfile.eaPlayerId,
        assignedRole: body.playerProfile.assignedRole,
        trustLevel: body.playerProfile.trustLevel,
        importanceMarker: body.playerProfile.importanceMarker,
        userNotes: body.playerProfile.userNotes,
        primaryPosition,
      });
    }

    const payload = await careerService.hydrate(body.careerId);
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    console.error("[api/career] update failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Update failed." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/career?careerId=...
 * Purges a career and all associated snapshots, events, and tactical systems from SQLite.
 */
export async function DELETE(request: Request) {
  try {
    const careerId = new URL(request.url).searchParams.get("careerId");
    if (!careerId) {
      return NextResponse.json({ success: false, error: "careerId parameter is required." }, { status: 400 });
    }

    const careerService = new CareerService();
    const career = await careerService.getCareerRow(careerId);
    if (!career) {
      return NextResponse.json({ success: false, error: `Career ${careerId} not found.` }, { status: 404 });
    }

    await db.delete(careers).where(eq(careers.id, careerId));
    return NextResponse.json({ success: true, message: `Career ${careerId} successfully deleted.` });
  } catch (error) {
    console.error("[api/career] delete failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Delete failed." },
      { status: 500 }
    );
  }
}
