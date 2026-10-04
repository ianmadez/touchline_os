import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { SeasonService } from "@/lib/services/season-service";
import { TargetBlockService, type TargetBlock } from "@/lib/services/target-block-service";
import { db } from "@/lib/db/client";
import { careerEvents } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mirrors a group debrief's reported matches into the diary as ordinary match events.
 *
 * This is what makes a group debrief first-class rather than a side note. The record reconciliation,
 * the season vault and the timeline all read `MATCH_DEBRIEF` rows, so a manager who reports their
 * season in blocks of five gets the same downstream behaviour as one who logs every match on its
 * own. The events are keyed to the block (`entityType`/`entityId`) and rewritten on each save, so
 * editing a block updates its matches instead of stacking duplicates behind it.
 *
 * The scoreline is written OURS-FIRST, because that is the orientation the reconciliation parses.
 *
 * One caveat worth knowing: a match that is ALSO logged as an individual debrief is counted twice.
 * The two routes are meant as alternatives, and nothing in the save can tell us that two reported
 * rows describe the same fixture.
 */
async function syncGroupDebriefEvents(block: TargetBlock): Promise<void> {
  await db
    .delete(careerEvents)
    .where(
      and(
        eq(careerEvents.careerId, block.careerId),
        eq(careerEvents.entityType, "TARGET_BLOCK"),
        eq(careerEvents.entityId, block.id)
      )
    );

  // Only a match with a reported scoreline becomes a diary entry: a target with no result is a
  // plan, not a result, and inventing an event for it would put a fixture in the record that was
  // never played.
  const reported = block.matches.filter(
    (match) => match.actualPoints !== null && match.goalsFor !== null && match.goalsAgainst !== null
  );
  if (reported.length === 0) return;

  await db.insert(careerEvents).values(
    reported.map((match) => ({
      id: `grp_${block.id}_${match.matchday}`,
      careerId: block.careerId,
      eventType: "MATCH_DEBRIEF",
      source: "USER" as const,
      entityType: "TARGET_BLOCK",
      entityId: block.id,
      payloadJson: JSON.stringify({
        opponent: match.opponent,
        scoreline: `${match.goalsFor}-${match.goalsAgainst}`,
        result: match.actualPoints === 3 ? "WIN" : match.actualPoints === 1 ? "DRAW" : "LOSS",
        competition: "League Match",
        managerReflection: match.note ?? "",
        standoutPlayerIds: [],
        // Kept under its own key so a reader can see these came from a block, not a one-off log.
        groupDebrief: {
          blockId: block.id,
          blockIndex: block.blockIndex,
          matchday: match.matchday,
          opponentPosition: match.opponentPosition,
          targetPoints: match.targetPoints,
          targetMaxPoints: match.targetMaxPoints,
        },
      }),
      timestamp: new Date().toISOString(),
    }))
  );
}

/**
 * The manager's own objective for the current season, used for the block's "gap to target place".
 *
 * USER only: the SAVE objective is an unmapped code and is never treated as a numeric target, so a
 * gap computed from it would be a number with no meaning behind it.
 */
async function targetPositionFor(careerId: string): Promise<number | null> {
  const objectives = await new SeasonService().getObjectives(careerId);
  const withTarget = objectives.filter(
    (objective) => objective.source === "USER" && objective.targetPosition !== null
  );
  return withTarget.at(-1)?.targetPosition ?? null;
}

/** GET /api/season/blocks?careerId=&season= - every block for a season, each with its summary. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const careerId = url.searchParams.get("careerId");
    if (!careerId) {
      return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
    }
    const seasonParam = Number(url.searchParams.get("season"));
    const seasonNumber = Number.isFinite(seasonParam) ? seasonParam : undefined;

    const service = new TargetBlockService();
    const [blocks, targetPosition] = await Promise.all([
      service.listBlocks(careerId, seasonNumber),
      targetPositionFor(careerId),
    ]);

    return NextResponse.json({
      success: true,
      targetPosition,
      blocks: blocks.map((block) => ({
        block,
        summary: service.summarise(block, targetPosition),
      })),
    });
  } catch (error) {
    console.error("[api/season/blocks] list failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read target blocks." },
      { status: 500 }
    );
  }
}

/** PUT /api/season/blocks - create or update one block (keyed by career + season + block index). */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      careerId?: string;
      seasonNumber?: number;
      blockIndex?: number;
    };
    if (
      !body.careerId ||
      typeof body.seasonNumber !== "number" ||
      typeof body.blockIndex !== "number"
    ) {
      return NextResponse.json(
        { success: false, error: "careerId, seasonNumber and blockIndex are required." },
        { status: 400 }
      );
    }

    const service = new TargetBlockService();
    const block = await service.saveBlock({
      ...(body as Parameters<TargetBlockService["saveBlock"]>[0]),
      careerId: body.careerId,
    });
    await syncGroupDebriefEvents(block);
    const targetPosition = await targetPositionFor(body.careerId);

    return NextResponse.json({
      success: true,
      block,
      summary: service.summarise(block, targetPosition),
    });
  } catch (error) {
    console.error("[api/season/blocks] save failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save the target block." },
      { status: 500 }
    );
  }
}

/** DELETE /api/season/blocks?careerId=&id= - removes one block. */
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
    await new TargetBlockService().deleteBlock(careerId, id);
    // The mirrored diary entries go with the block - a deleted block must not leave five results
    // behind it in the record.
    await db
      .delete(careerEvents)
      .where(
        and(
          eq(careerEvents.careerId, careerId),
          eq(careerEvents.entityType, "TARGET_BLOCK"),
          eq(careerEvents.entityId, id)
        )
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/season/blocks] delete failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not delete the target block." },
      { status: 500 }
    );
  }
}
