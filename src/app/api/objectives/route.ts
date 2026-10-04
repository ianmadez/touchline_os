import { NextResponse } from "next/server";
import { BoardObjectiveService } from "@/lib/services/board-objective-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manager's board-objective tracker.
 *
 * USER provenance end to end: nothing here is read from the save, so nothing here is computed. The
 * save holds one numeric objective code with no wording, which is precisely why the manager has to
 * record what he was actually given.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const careerId = params.get("careerId");
    if (!careerId) {
      return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
    }
    const seasonParam = params.get("season");
    const seasonNumber = seasonParam === null ? null : Number(seasonParam);
    if (seasonNumber !== null && !Number.isFinite(seasonNumber)) {
      return NextResponse.json({ success: false, error: "season must be a number." }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      objectives: await new BoardObjectiveService().list(careerId, seasonNumber),
    });
  } catch (error) {
    console.error("[api/objectives] read failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read your objectives." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string | null;
      careerId?: string;
      seasonNumber?: number;
      category?: string;
      priority?: number;
      title?: string;
      status?: string;
      notes?: string | null;
    };
    if (!body.careerId || typeof body.seasonNumber !== "number" || !body.category || !body.title) {
      return NextResponse.json(
        { success: false, error: "careerId, seasonNumber, category and title are required." },
        { status: 400 }
      );
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that objective." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const careerId = params.get("careerId");
    const id = params.get("id");
    const seasonNumber = Number(params.get("season"));
    if (!careerId || !id || !Number.isFinite(seasonNumber)) {
      return NextResponse.json(
        {
          success: false,
          error: "careerId, id and season are required - the season is needed to return the fresh list.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      objectives: await new BoardObjectiveService().remove(careerId, id, seasonNumber),
    });
  } catch (error) {
    console.error("[api/objectives] delete failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not remove that objective." },
      { status: 500 }
    );
  }
}
