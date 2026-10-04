import { NextResponse } from "next/server";
import { scoutArchiveReasons, type ScoutArchiveReason } from "@/lib/db/schema";
import { ScoutingMemoryService, ARCHIVE_REASON_LABELS } from "@/lib/services/scouting-memory-service";
import { FinanceService } from "@/lib/services/finance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isReason(value: unknown): value is ScoutArchiveReason {
  return (
    typeof value === "string" && (scoutArchiveReasons as readonly string[]).includes(value)
  );
}

/**
 * GET - the memories, each re-tested against today's numbers.
 *
 * `budget` arrives as a query parameter because the caller already holds it. Reading settings here as
 * well would give the panel and the search two independent sources for one figure.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const careerId = params.get("careerId");
    if (!careerId) {
      return NextResponse.json(
        { success: false, error: "careerId is required." },
        { status: 400 }
      );
    }

    const rawBudget = params.get("budget");
    const budget =
      rawBudget === null || rawBudget === "" ? null : Number.parseInt(rawBudget, 10);
    if (budget !== null && !Number.isFinite(budget)) {
      return NextResponse.json(
        { success: false, error: "budget must be a whole number of pounds, or omitted." },
        { status: 400 }
      );
    }

    const service = new ScoutingMemoryService();
    const assessments = await service.assess(careerId, budget);
    const inGameDate = await service.inGameDate(careerId);

    return NextResponse.json({
      success: true,
      inGameDate,
      assessments,
      labels: ARCHIVE_REASON_LABELS,
      resurfacing: assessments.filter((row) => row.shouldResurface).length,
    });
  } catch (error) {
    console.error("[api/scouting/memory] read failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read scouting memory." },
      { status: 500 }
    );
  }
}

/** PUT - set a target aside with a reason and the figures that were true at the time. */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      careerId?: string;
      targetId?: string;
      reason?: string;
      valueAtArchive?: number | null;
      budgetAtArchive?: number | null;
    };

    if (!body.careerId || !body.targetId) {
      return NextResponse.json(
        { success: false, error: "careerId and targetId are required." },
        { status: 400 }
      );
    }
    if (!isReason(body.reason)) {
      return NextResponse.json(
        {
          success: false,
          error: `reason must be one of: ${scoutArchiveReasons.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    await new ScoutingMemoryService().archive({
      careerId: body.careerId,
      targetId: body.targetId,
      reason: body.reason,
      valueAtArchive:
        typeof body.valueAtArchive === "number" && Number.isFinite(body.valueAtArchive)
          ? body.valueAtArchive
          : null,
      // The budget he could not afford at the time, read here rather than sent from the browser, so
      // the stored figure is the same one the Finances screen shows.
      budgetAtArchive:
        typeof body.budgetAtArchive === "number" && Number.isFinite(body.budgetAtArchive)
          ? body.budgetAtArchive
          : await new FinanceService()
              .getReport(body.careerId)
              .then((report) => report?.transferBudget ?? null)
              .catch(() => null),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/scouting/memory] archive failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not archive that target." },
      { status: 500 }
    );
  }
}

/** DELETE - bring a target back to the board and clear its memory. */
export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const careerId = params.get("careerId");
    const targetId = params.get("targetId");
    if (!careerId || !targetId) {
      return NextResponse.json(
        { success: false, error: "careerId and targetId are required." },
        { status: 400 }
      );
    }

    await new ScoutingMemoryService().restore(careerId, targetId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/scouting/memory] restore failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not restore that target." },
      { status: 500 }
    );
  }
}
