import { NextResponse } from "next/server";
import {
  addTransferEntry,
  nameTransferCounterparty,
  readTransferLedger,
  removeTransferEntry,
} from "@/lib/operations/transfer-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/transfer-ledger`.
 *
 * GET reads the whole ledger: the fees the save carries for this club plus every deal the manager has typed
 * in. POST records one handwritten deal and returns the rebuilt ledger. PUT names a club the save cannot name.
 * DELETE removes a handwritten deal only, which is what keeps a saved fee from being editable.
 */
export async function GET(request: Request) {
  const outcome = await readTransferLedger(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function POST(request: Request) {
  const outcome = await addTransferEntry(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await removeTransferEntry(params.get("careerId"), params.get("id"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function PUT(request: Request) {
  const outcome = await nameTransferCounterparty(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}
