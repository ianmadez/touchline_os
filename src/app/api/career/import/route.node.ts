import { NextResponse } from "next/server";
import { importCareerFromFile } from "@/lib/operations/career-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/career/import
 *
 * Applies a career backup the user picked, in the format `/api/career/export` writes. One-time and
 * user-initiated: nothing here reads a path it was not given and nothing transfers automatically.
 * The browser build calls the same operation with the file the user chose.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const outcome = await importCareerFromFile(payload);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
