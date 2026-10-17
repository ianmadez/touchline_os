import { NextResponse } from "next/server";
import { readRulesProfile, saveRulesProfile } from "@/lib/operations/rules-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thin HTTP adapter over `@/lib/operations/rules-profile`. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await readRulesProfile(params.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await saveRulesProfile(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
