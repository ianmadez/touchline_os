import { NextResponse } from "next/server";
import { readSeasonState, recordSeason, type SeasonInput } from "@/lib/operations/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/season`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function POST(request: Request) {
  let body: SeasonInput;
  try {
    body = (await request.json()) as SeasonInput;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const outcome = await recordSeason(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function GET(request: Request) {
  const outcome = await readSeasonState(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
