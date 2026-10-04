import { NextResponse } from "next/server";
import {
  readFinanceReport,
  saveFinanceInputs,
  type FinanceInput,
} from "@/lib/operations/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/finance`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const outcome = await readFinanceReport(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  let body: FinanceInput;
  try {
    body = (await request.json()) as FinanceInput;
  } catch (error) {
    console.error("[api/finance] inputs failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save those figures." },
      { status: 500 }
    );
  }

  const outcome = await saveFinanceInputs(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
