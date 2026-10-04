import { NextResponse } from "next/server";
import {
  deleteTargetBlock,
  readTargetBlocks,
  saveTargetBlock,
} from "@/lib/operations/season-blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/season-blocks`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between. The body is
 * handed over as text because the operation owns JSON parsing - it always has, which is why a body
 * that is not JSON answers with a 500 rather than a 400.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readTargetBlocks(params.get("careerId"), params.get("season"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await saveTargetBlock(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await deleteTargetBlock(params.get("careerId"), params.get("id"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}