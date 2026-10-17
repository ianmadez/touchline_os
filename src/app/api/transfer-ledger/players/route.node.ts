import { NextResponse } from "next/server";
import { searchLedgerPlayers } from "@/lib/operations/transfer-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `searchLedgerPlayers`.
 *
 * The deal form asks who the deal is about, and this answers with the players in the save whose name matches
 * what he has typed so far. It is its own URL rather than a flag on the ledger's own GET, so a read of the
 * ledger stays a read of the ledger.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await searchLedgerPlayers(params.get("careerId"), params.get("query"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
