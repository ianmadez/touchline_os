import { NextResponse } from "next/server";
import {
  forgetLocalBridge,
  forgetRememberedSave,
  listSaveCandidates,
  pairLocalBridge,
  reconnectRememberedSave,
} from "@/lib/operations/saves";
import type { OperationResult } from "@/lib/operations/types";

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

  const input = payload as { action?: unknown } | null;

  // A switch rather than nested ternaries, now that there are four actions: the ternary form had
  // already stopped being readable at two, and the error message has to name every one of them.
  let outcome: OperationResult<unknown>;
  switch (input?.action) {
    case "reconnect":
      outcome = await reconnectRememberedSave();
      break;
    case "forget":
      outcome = await forgetRememberedSave();
      break;
    case "bridge-pair":
      outcome = await pairLocalBridge(payload);
      break;
    case "bridge-forget":
      outcome = await forgetLocalBridge();
      break;
    default:
      outcome = {
        status: 400,
        body: {
          success: false,
          error: 'action must be one of "reconnect", "forget", "bridge-pair", "bridge-forget".',
        },
      };
  }

  return NextResponse.json(outcome.body, { status: outcome.status });
}
