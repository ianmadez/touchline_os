import { NextResponse } from "next/server";
import {
  archiveScoutTarget,
  readScoutingMemory,
  restoreScoutTarget,
  type ArchiveTargetInput,
} from "@/lib/operations/scouting-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/scouting-memory`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readScoutingMemory(params.get("careerId"), params.get("budget"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  let body: ArchiveTargetInput;
  try {
    body = (await request.json()) as ArchiveTargetInput;
  } catch (error) {
    console.error("[api/scouting/memory] archive failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not archive that target." },
      { status: 500 }
    );
  }

  const outcome = await archiveScoutTarget(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const outcome = await restoreScoutTarget(new URL(request.url).searchParams);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
