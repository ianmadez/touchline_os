import { NextResponse } from "next/server";
import {
  forgetRememberedSave,
  listSaveCandidates,
  reconnectRememberedSave,
} from "@/lib/operations/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/saves`.
 *
 * The operation holds the behaviour; this file only translates `NextResponse` out, so the browser
 * build can call the operation directly with no HTTP hop in between.
 */
export async function GET() {
  const outcome = await listSaveCandidates();
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/**
 * POST /api/saves
 *
 * Re-establishes, or drops, the save this browser remembers. A body is required because this is the
 * only verb here that changes something, and the action it takes has to be stated rather than
 * implied by the URL: `reconnect` is called from a click and must stay that way.
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

  const action = (payload as { action?: unknown } | null)?.action;
  const outcome =
    action === "reconnect"
      ? await reconnectRememberedSave()
      : action === "forget"
        ? await forgetRememberedSave()
        : {
            status: 400,
            body: { success: false, error: 'action must be "reconnect" or "forget".' },
          };

  return NextResponse.json(outcome.body, { status: outcome.status });
}
