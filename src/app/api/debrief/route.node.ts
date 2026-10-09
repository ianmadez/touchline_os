import { NextResponse } from "next/server";
import { deleteDebrief, logMatchDebrief, updateDebrief } from "@/lib/operations/debrief";

export const runtime = "nodejs";

export type { MatchDebriefPayload } from "@/lib/operations/debrief";

/**
 * Thin HTTP adapter over `@/lib/operations/debrief`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between. The body is
 * handed over as text because the operation owns JSON parsing - it always has, which is why a body
 * that is not JSON answers with a 500 rather than a 400.
 */
export async function POST(request: Request) {
  const outcome = await logMatchDebrief(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/**
 * Edits one debrief. The id travels in the query string, the new values in the body, matching the
 * delete's shape so the two cannot drift.
 */
export async function PATCH(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await updateDebrief(params.get("id"), await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await deleteDebrief(params.get("id"), params.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}