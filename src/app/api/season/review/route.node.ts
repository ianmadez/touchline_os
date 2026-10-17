import { NextResponse } from "next/server";
import { readSeasonReview, recordCarryOver, runSeasonTransition } from "@/lib/operations/season-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/season-review`.
 *
 *   GET  /api/season/review?careerId=&season=            the closing page and the carry-over answers
 *   GET  /api/season/review?careerId=&action=transition   run the season-end pass and report it
 *   POST /api/season/review                               record keep or drop answers
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome =
    params.get("action") === "transition"
      ? await runSeasonTransition(params.get("careerId"))
      : await readSeasonReview(params.get("careerId"), params.get("season"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function POST(request: Request) {
  const outcome = await recordCarryOver(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
