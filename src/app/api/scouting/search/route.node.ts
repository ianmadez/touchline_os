import { NextResponse } from "next/server";
import {
  saveFootOverride,
  searchScoutPool,
  type FootOverrideInput,
} from "@/lib/operations/scouting-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/scouting-search`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function PUT(request: Request) {
  let body: FootOverrideInput;
  try {
    body = (await request.json()) as FootOverrideInput;
  } catch (error) {
    console.error("[api/scouting/search] foot override failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that foot." },
      { status: 500 }
    );
  }

  const outcome = await saveFootOverride(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function GET(request: Request) {
  const outcome = await searchScoutPool(new URL(request.url).searchParams);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
