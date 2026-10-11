import { NextResponse } from "next/server";
import { readFinanceRules } from "@/lib/operations/finance-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/finance-rules`: the league's rules, checked against what is on
 * file, with the caveats attached to each verdict.
 */
export async function GET(request: Request) {
  const outcome = await readFinanceRules(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
