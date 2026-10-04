import { NextResponse } from "next/server";
import { patchSettings, readSettings } from "@/lib/operations/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/settings`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out,
 * so the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET() {
  const outcome = await readSettings();
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const outcome = await patchSettings(body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
