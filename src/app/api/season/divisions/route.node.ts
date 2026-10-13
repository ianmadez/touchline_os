import { NextResponse } from "next/server";
import { readDivisionTables } from "@/lib/operations/season-divisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/season-divisions`, so the browser build can call the
 * operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readDivisionTables(params.get("careerId"), params.get("leagueId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
