import { NextResponse } from "next/server";
import { readSeasonDossier } from "@/lib/operations/season-dossier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/season-dossier`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readSeasonDossier(params.get("careerId"), params.get("season"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
