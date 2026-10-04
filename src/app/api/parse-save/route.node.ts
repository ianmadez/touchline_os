import { NextResponse } from "next/server";
import { parseAndSyncSave } from "@/lib/operations/parse-save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/parse-save`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between. The body is
 * handed over as text because the operation owns JSON parsing - it always has, which is why a body
 * that is not JSON answers with a 500 rather than a 400.
 */
export async function POST(request: Request) {
  const outcome = await parseAndSyncSave(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}