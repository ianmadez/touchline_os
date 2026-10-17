import { NextResponse } from "next/server";
import {
  createAssignment,
  deleteAssignment,
  readAssignments,
  updateAssignment,
} from "@/lib/operations/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin HTTP adapter over `@/lib/operations/assignments`. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readAssignments(params.get("careerId"), {
    blockId: params.get("blockId"),
    from: params.get("from"),
    to: params.get("to"),
    count: params.get("count"),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function POST(request: Request) {
  const outcome = await createAssignment(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await updateAssignment(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await deleteAssignment(params.get("careerId"), params.get("id"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
