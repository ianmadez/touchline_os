import { NextResponse } from "next/server";
import { createHypothesis, deleteHypothesis, readHypotheses, updateHypothesis } from "@/lib/operations/hypotheses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/hypotheses`.
 *
 * The operation owns every rule about what a question is and when evidence counts; this file only moves a query
 * string and a body in and out.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readHypotheses(params.get("careerId"), {
    blockId: params.get("blockId"),
    from: params.get("from"),
    to: params.get("to"),
    count: params.get("count"),
    eventIds: params.get("eventIds"),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function POST(request: Request) {
  const outcome = await createHypothesis(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await updateHypothesis(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await deleteHypothesis(params.get("careerId"), params.get("id"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
