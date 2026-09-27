import { NextResponse } from "next/server";
import { SeasonService } from "@/lib/services/season-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SeasonRequest {
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
 * POST /api/season
 *
 * Records the two things the save cannot supply for the manager's own division: where the club
 * currently sits, and what the board has asked for. Both are USER provenance and are stored as
 * such - the position is cross-checked against the save's own points record and a disagreement is
 * returned as a flag rather than silently correcting what was entered.
 */
export async function POST(request: Request) {
  let body: SeasonRequest;
  try {
    body = (await request.json()) as SeasonRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.careerId) {
    return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
  }

  if (body.leaguePosition !== undefined) {
    if (
      typeof body.leaguePosition !== "number" ||
      !Number.isInteger(body.leaguePosition) ||
      body.leaguePosition < 1 ||
      body.leaguePosition > 200
    ) {
      return NextResponse.json(
        { success: false, error: "leaguePosition must be a whole number between 1 and 200." },
        { status: 400 }
      );
    }
  }

  if (body.targetPosition !== undefined && body.targetPosition !== null) {
    if (
      typeof body.targetPosition !== "number" ||
      !Number.isInteger(body.targetPosition) ||
      body.targetPosition < 1 ||
      body.targetPosition > 200
    ) {
      return NextResponse.json(
        { success: false, error: "targetPosition must be a whole number between 1 and 200." },
        { status: 400 }
      );
    }
  }

  if (body.leaguePosition === undefined && body.objectiveText === undefined) {
    return NextResponse.json(
      { success: false, error: "Nothing to record: pass leaguePosition or objectiveText." },
      { status: 400 }
    );
  }

  try {
    const seasonService = new SeasonService();
    const history = await seasonService.getSeasonHistory(body.careerId);
    if (history.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "NO_SEASON_HISTORY",
          message: "This career has no season history yet. Sync the save first.",
        },
        { status: 409 }
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
    return NextResponse.json({
      success: true,
      disputed: positionResult?.disputed ?? false,
      note: positionResult?.note ?? null,
      seasonState,
    });
  } catch (error) {
    console.error("[api/season] save failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not record season data." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/season?careerId=...
 * The season state on its own, for a panel that wants it without a full hydration.
 */
export async function GET(request: Request) {
  const careerId = new URL(request.url).searchParams.get("careerId");
  if (!careerId) {
    return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
  }
  try {
    const seasonState = await new SeasonService().getState(careerId);
    return NextResponse.json({ success: true, seasonState });
  } catch (error) {
    console.error("[api/season] read failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read season data." },
      { status: 500 }
    );
  }
}
