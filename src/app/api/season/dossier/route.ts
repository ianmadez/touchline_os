import { NextResponse } from "next/server";
import { SeasonArchiveService } from "@/lib/services/season-archive-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/season/dossier?careerId=...&season=3
 *
 * One season's full record, in two halves that are never blended: what the save itself recorded
 * (available for every season, including ones that finished before TouchlineOS was installed) and
 * what TouchlineOS observed while it was running. The observed half is `null` for a season we were
 * not present for - that is the answer, not an error, which is why this route does not pad it.
 *
 * Fetched per season rather than folded into `/api/season`: a dossier reads snapshots, the squad
 * diff, finance, threads and events for its window, and doing that for every season on every load
 * would cost the whole history to show one.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const careerId = searchParams.get("careerId");
  const seasonParam = searchParams.get("season");

  if (!careerId) {
    return NextResponse.json(
      { success: false, error: "careerId is required." },
      { status: 400 }
    );
  }

  const season = Number(seasonParam);
  if (!Number.isInteger(season) || season < 1) {
    return NextResponse.json(
      { success: false, error: "season must be a positive whole number (the season ordinal, not a calendar year)." },
      { status: 400 }
    );
  }

  try {
    const dossier = await new SeasonArchiveService().getSeasonDossier(careerId, season);
    if (!dossier) {
      return NextResponse.json(
        { success: false, error: "NO_SEASON", message: `This save has no record of season ${season}.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, dossier });
  } catch (error) {
    console.error("Season dossier failed:", error);
    return NextResponse.json(
      { success: false, error: "DOSSIER_FAILED", message: String(error) },
      { status: 500 }
    );
  }
}
