import { NextResponse } from "next/server";
import { ScoutingService } from "@/lib/services/scouting-service";
import { FinanceService } from "@/lib/services/finance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scouting board.
 *
 * The transfer budget is read here, once, and handed to the assessment - the board and the Finances
 * screen must never disagree about the same number, so there is a single place it comes from.
 */
async function boardFor(careerId: string) {
  const [targets, report] = await Promise.all([
    new ScoutingService().listTargets(careerId),
    new FinanceService().getReport(careerId),
  ]);
  return new ScoutingService().build(targets, report?.transferBudget ?? null);
}

export async function GET(request: Request) {
  try {
    const careerId = new URL(request.url).searchParams.get("careerId");
    if (!careerId) {
      return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
    }
    return NextResponse.json({ success: true, board: await boardFor(careerId) });
  } catch (error) {
    console.error("[api/scouting] read failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read the scouting board." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { careerId?: string; name?: string };
    if (!body.careerId || !body.name?.trim()) {
      return NextResponse.json(
        { success: false, error: "careerId and name are required." },
        { status: 400 }
      );
    }
    const service = new ScoutingService();
    await service.saveTarget({
      ...(body as Parameters<ScoutingService["saveTarget"]>[0]),
      careerId: body.careerId,
      name: body.name,
    });
    return NextResponse.json({ success: true, board: await boardFor(body.careerId) });
  } catch (error) {
    console.error("[api/scouting] save failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that target." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const careerId = url.searchParams.get("careerId");
    const id = url.searchParams.get("id");
    if (!careerId || !id) {
      return NextResponse.json(
        { success: false, error: "careerId and id are required." },
        { status: 400 }
      );
    }
    await new ScoutingService().deleteTarget(careerId, id);
    return NextResponse.json({ success: true, board: await boardFor(careerId) });
  } catch (error) {
    console.error("[api/scouting] delete failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not remove that target." },
      { status: 500 }
    );
  }
}
