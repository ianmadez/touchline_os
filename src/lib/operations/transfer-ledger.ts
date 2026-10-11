import { TransferLedgerService, type LedgerDirection } from "../services/transfer-ledger-service";
import { at, failed, ok, type OperationResult } from "./types";

/**
 * The request body, parsed.
 *
 * Every operation in this app is handed the RAW TEXT of the request, because the same function answers both
 * a real HTTP route and the browser build's in-page dispatch. Casting that text to an object compiles and
 * then reads every field as undefined, which is exactly the bug that made both of these endpoints answer
 * "careerId is required" to a perfectly good request.
 */
function parseBody(rawBody: unknown): { value: Record<string, unknown> } | { error: OperationResult<unknown> } {
  if (typeof rawBody !== "string") {
    return { value: (rawBody ?? {}) as Record<string, unknown> };
  }
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed === null || typeof parsed !== "object") return { error: at(400, { success: false, error: "Request body must be a JSON object." }) };
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { error: at(400, { success: false, error: "Request body must be valid JSON." }) };
  }
}

/** A calendar day, or null. Anything that is not one is rejected rather than stored as text. */
function cleanDay(
  value: string | null | undefined,
  label: string
): { day: string | null } | { error: OperationResult<unknown> } {
  if (value === null || value === undefined || value.trim() === "") return { day: null };
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? { day: trimmed }
    : { error: failed(400, `The ${label} has to be a calendar day, or left blank.`) };
}

/**
 * The transfer ledger.
 *
 * Two sources, which the screen keeps apart: fees the save carries, and deals the manager typed in. Nothing
 * here estimates a fee the save does not have, and no player is followed to a third club.
 */
export async function readTransferLedger(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const ledger = await new TransferLedgerService().getLedger(careerId);
    if (!ledger) return failed(404, "Career not found.");
    return ok({ success: true, ledger });
  } catch (error) {
    console.error("[api/transfer-ledger] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read the transfer ledger.");
  }
}

interface AddBody {
  careerId?: string;
  direction?: string;
  playerName?: string;
  counterparty?: string | null;
  fee?: number | string;
  agreedOn?: string | null;
  completedOn?: string | null;
  season?: number | string | null;
  note?: string | null;
}

/** Adds one handwritten deal. The whole ledger comes back, so the screen never predicts the totals. */
export async function addTransferEntry(rawBody: unknown): Promise<OperationResult<unknown>> {
  const parsedBody = parseBody(rawBody);
  if ("error" in parsedBody) return parsedBody.error;
  const body = parsedBody.value as AddBody;
  const careerId = typeof body.careerId === "string" ? body.careerId.trim() : "";
  if (!careerId) return failed(400, "careerId is required.");

  const direction: LedgerDirection = body.direction === "OUT" ? "OUT" : "IN";
  const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
  if (!playerName) return failed(400, "A player name is needed, because it is what the ledger groups on.");

  const fee = typeof body.fee === "string" ? Number(body.fee) : body.fee;
  if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
    return failed(400, "Enter the fee in whole units of your currency. Zero is allowed for a free transfer.");
  }

  const season =
    body.season === null || body.season === undefined || body.season === ""
      ? null
      : Number(body.season);
  if (season !== null && !Number.isFinite(season)) {
    return failed(400, "The season has to be a year, or left blank.");
  }

  const agreed = cleanDay(body.agreedOn, "agreement date");
  if ("error" in agreed) return agreed.error;
  const completed = cleanDay(body.completedOn, "completion date");
  if ("error" in completed) return completed.error;

  try {
    const ledger = await new TransferLedgerService().addEntry({
      careerId,
      direction,
      playerName,
      counterparty: typeof body.counterparty === "string" ? body.counterparty : null,
      fee,
      agreedOn: agreed.day,
      completedOn: completed.day,
      season,
      note: typeof body.note === "string" ? body.note : null,
    });
    if (!ledger) return failed(404, "Career not found.");
    return ok({ success: true, ledger });
  } catch (error) {
    console.error("[api/transfer-ledger] add failed:", error);
    return failed(500, (error as Error).message ?? "Could not record the deal.");
  }
}

/** Removes one handwritten deal. A fee the save carries is never deletable, and cannot reach this. */
export async function removeTransferEntry(
  careerId: string | null,
  id: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) return failed(400, "careerId is required.");
  if (!id) return failed(400, "id is required.");

  try {
    const ledger = await new TransferLedgerService().removeEntry(careerId, id);
    if (!ledger) return failed(404, "Career not found.");
    return ok({ success: true, ledger });
  } catch (error) {
    console.error("[api/transfer-ledger] remove failed:", error);
    return failed(500, (error as Error).message ?? "Could not remove the deal.");
  }
}

/**
 * Names a club the save cannot name.
 *
 * The save holds no club table, so a deal with anybody outside the manager's own division comes back with an
 * id and nothing else. Rather than a paragraph explaining that, the ledger asks him once: this stores what he
 * types, badged as his own. An empty name clears it and the row goes back to what the file says.
 */
export async function nameTransferCounterparty(
  rawBody: unknown
): Promise<OperationResult<unknown>> {
  const parsedBody = parseBody(rawBody);
  if ("error" in parsedBody) return parsedBody.error;
  const body = parsedBody.value as { careerId?: string; dealId?: string; name?: string };
  const careerId = typeof body.careerId === "string" ? body.careerId.trim() : "";
  const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
  if (!careerId) return failed(400, "careerId is required.");
  if (!dealId) return failed(400, "dealId is required.");

  try {
    const ledger = await new TransferLedgerService().nameCounterparty(
      careerId,
      dealId,
      typeof body.name === "string" ? body.name : ""
    );
    if (!ledger) return failed(404, "Career not found.");
    return ok({ success: true, ledger });
  } catch (error) {
    console.error("[api/transfer-ledger] naming failed:", error);
    return failed(500, (error as Error).message ?? "Could not save that name.");
  }
}
