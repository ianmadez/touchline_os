import { NextResponse } from "next/server";
import { readDebriefMarks, setDebriefStar } from "@/lib/operations/debrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over the starring half of `@/lib/operations/debrief`.
 *
 * Its own route rather than a verb on /api/debrief because it is a different thing: a debrief is a record of
 * a match, and a star is the manager's opinion of it. Keeping them apart means the record itself is never
 * rewritten just because he changed his mind about it.
 */
export async function GET(request: Request) {
  const outcome = await readDebriefMarks(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await setDebriefStar(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
