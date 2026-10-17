import { NextResponse } from "next/server";
import { readReview, recordReviewDecision } from "@/lib/operations/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/review`.
 *
 * The engine is pure and the operation gathers its input, so this file only turns a query string into options and
 * a body into a decision. Nothing here decides what a review says.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readReview(params.get("careerId"), {
    blockId: params.get("blockId"),
    from: params.get("from"),
    to: params.get("to"),
    count: params.get("count"),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function POST(request: Request) {
  const outcome = await recordReviewDecision(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
