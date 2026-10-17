import type { DealKind } from "../db/schema";
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

/**
 * Players a handwritten deal can be named against.
 *
 * A name typed from memory is how a player ends up on the ledger under a spelling that appears nowhere else in
 * the app, and the app has known every player in the save all along. So the form searches instead: the manager
 * types a few letters and picks him. An empty search is answered with an empty list rather than the first
 * eight players in the save, which would look like a suggestion and is not one.
 */
export async function searchLedgerPlayers(
  careerId: string | null,
  query: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) return failed(400, "careerId is required.");

  try {
    const players = await new TransferLedgerService().searchPlayers(careerId, query ?? "");
    return ok({ success: true, players });
  } catch (error) {
    console.error("[api/transfer-ledger] player search failed:", error);
    return failed(500, (error as Error).message ?? "Could not search the players in this save.");
  }
}

interface AddBody {
  careerId?: string;
  direction?: string;
  playerName?: string;
  counterparty?: string | null;
  fee?: number | string;
  kind?: string;
  salary?: number | string | null;
  wageSharePct?: number | string | null;
  agreedOn?: string | null;
  completedOn?: string | null;
  season?: number | string | null;
  note?: string | null;
}

/** A number from a form field, where an empty string is an absence rather than a zero. */
function optionalAmount(value: number | string | null | undefined): number | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return "invalid";
  return parsed;
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

  // Any value that is not exactly LOAN is a transfer, which is also what every row already on file is.
  const kind: DealKind = body.kind === "LOAN" ? "LOAN" : "TRANSFER";

  const feeValue = optionalAmount(body.fee);
  // A loan fee is normally nothing at all, so a blank box is read as a free loan rather than refused.
  const fee = feeValue === null && kind === "LOAN" ? 0 : feeValue;
  if (fee === "invalid" || fee === null || fee < 0) {
    return failed(
      400,
      kind === "LOAN"
        ? "Enter the loan fee in whole units of your currency, or leave it blank for a free loan."
        : "Enter the fee in whole units of your currency. Zero is allowed for a free transfer."
    );
  }

  let salary: number | null = null;
  let wageSharePct: number | null = null;
  if (kind === "LOAN") {
    const wage = optionalAmount(body.salary);
    if (wage === "invalid" || wage === null || wage < 0) {
      return failed(400, "A loan needs his wage, in whole units per week. It is most of what the deal costs.");
    }
    salary = Math.round(wage);

    const share = optionalAmount(body.wageSharePct);
    if (share === "invalid") {
      return failed(400, "The wage split has to be a percentage of his wage, or left blank.");
    }
    if (share !== null) {
      if (share < 0 || share > 100) {
        return failed(
          400,
          "The split is the share of his wage this club pays, so it runs from 0 to 100. Leave it blank if you did not agree one."
        );
      }
      wageSharePct = Math.round(share);
    }
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
      kind,
      salary,
      wageSharePct,
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
