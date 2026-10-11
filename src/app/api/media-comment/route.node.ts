import { NextResponse } from "next/server";
import { recordMediaComment } from "@/lib/operations/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/news`, the news desk's own route.
 *
 * It lives beside /api/news rather than on /api/debrief because what it records is a separate event: the
 * debrief is the record of the match, and this is what was said to the press afterwards.
 */
export async function POST(request: Request) {
  const outcome = await recordMediaComment(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}