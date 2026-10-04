import { NextResponse } from "next/server";
import {
  deleteObjective,
  readObjectives,
  saveObjective,
  type ObjectiveInput,
} from "@/lib/operations/objectives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/objectives`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readObjectives(params.get("careerId"), params.get("season"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  let body: ObjectiveInput;
  try {
    body = (await request.json()) as ObjectiveInput;
  } catch (error) {
    console.error("[api/objectives] save failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that objective." },
      { status: 500 }
    );
  }

  const outcome = await saveObjective(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await deleteObjective({
    careerId: params.get("careerId"),
    id: params.get("id"),
    season: params.get("season"),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
