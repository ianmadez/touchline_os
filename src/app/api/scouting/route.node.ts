import { NextResponse } from "next/server";
import {
  deleteScoutTarget,
  readScoutingBoard,
  saveScoutTarget,
  type ScoutTargetInput,
} from "@/lib/operations/scouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/scouting`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const outcome = await readScoutingBoard(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  let body: ScoutTargetInput;
  try {
    body = (await request.json()) as ScoutTargetInput;
  } catch (error) {
    console.error("[api/scouting] save failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that target." },
      { status: 500 }
    );
  }

  const outcome = await saveScoutTarget(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const outcome = await deleteScoutTarget(new URL(request.url).searchParams);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
