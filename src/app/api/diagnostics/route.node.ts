import { NextResponse } from "next/server";
import { readDiagnostics } from "@/lib/operations/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/diagnostics`.
 *
 * The operation holds the behaviour; this file only translates `NextResponse` out, so the browser
 * build can call the operation directly with no HTTP hop in between.
 */
export async function GET() {
  const outcome = await readDiagnostics();
  return NextResponse.json(outcome.body, { status: outcome.status });
}
