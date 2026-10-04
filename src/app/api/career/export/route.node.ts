import { NextResponse } from "next/server";
import { exportCareerToFile } from "@/lib/operations/career-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/career-transfer`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out.
 */
export async function GET(request: Request) {
  const outcome = await exportCareerToFile(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
