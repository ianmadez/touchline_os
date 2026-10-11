import { NextResponse } from "next/server";
import { readCompetitions } from "@/lib/operations/competitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/competitions`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out, so the
 * browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const outcome = await readCompetitions(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
