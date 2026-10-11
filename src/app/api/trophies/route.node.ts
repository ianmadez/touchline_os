import { NextResponse } from "next/server";
import { readTrophyCabinet, recordTrophyWin, removeTrophyWin } from "@/lib/operations/trophies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/trophies`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out, so
 * the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const outcome = await readTrophyCabinet(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await recordTrophyWin(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const outcome = await removeTrophyWin(new URL(request.url).searchParams);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
