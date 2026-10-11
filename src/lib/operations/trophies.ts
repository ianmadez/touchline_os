import { TrophyService } from "../services/trophy-service";
import type { TrophyKind } from "../trophies/catalogue";
import { at, failed, ok, type OperationResult } from "./types";

/**
 * The honours cabinet.
 *
 * The read is the whole feature: it returns every competition the manager's country offers, marked with
 * what is open to his division and what he has actually won. The two writes exist because a cup win is
 * something only the manager can report - the save cannot name a cup, so nothing can detect one.
 */

export async function readTrophyCabinet(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const cabinet = await new TrophyService().getCabinet(careerId);
    if (!cabinet) {
      return at(404, { success: false, error: "That career is not in the database." });
    }
    return ok({ success: true, cabinet });
  } catch (error) {
    console.error("[api/trophies] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your honours.");
  }
}

interface RecordRequest {
  careerId?: string;
  key?: string;
  name?: string;
  kind?: TrophyKind;
  countryId?: number | null;
  level?: number | null;
  season?: number;
}

const KINDS: readonly TrophyKind[] = ["LEAGUE", "DOMESTIC_CUP", "CONTINENTAL"];

/**
 * Records one win.
 *
 * Takes the raw body text because the JSON is parsed in its own guard, BEFORE the main `try`, so a body
 * that is not JSON is the caller's 400 rather than a 500 - the same arrangement `parseAndSyncSave` uses.
 */
export async function recordTrophyWin(rawBody: string): Promise<OperationResult<unknown>> {
  let body: RecordRequest;
  try {
    body = JSON.parse(rawBody) as RecordRequest;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const { careerId, key, name, kind, season } = body;
    if (!careerId || !key || !name || !kind || typeof season !== "number") {
      return at(400, {
        success: false,
        error: "careerId, key, name, kind and season are required.",
      });
    }
    if (!KINDS.includes(kind)) {
      return at(400, { success: false, error: `kind must be one of ${KINDS.join(", ")}.` });
    }

    const service = new TrophyService();
    await service.recordTrophy(careerId, {
      key,
      name,
      kind,
      countryId: body.countryId ?? null,
      level: body.level ?? null,
      season,
    });

    // The updated cabinet comes back with the write, so the screen never has to guess what changed.
    return ok({ success: true, cabinet: await service.getCabinet(careerId) });
  } catch (error) {
    console.error("[api/trophies] write failed:", error);
    return failed(500, (error as Error).message ?? "Could not record that trophy.");
  }
}

export async function removeTrophyWin(
  params: URLSearchParams
): Promise<OperationResult<unknown>> {
  try {
    const careerId = params.get("careerId");
    const key = params.get("key");
    const season = Number(params.get("season"));
    if (!careerId || !key || !Number.isFinite(season)) {
      return at(400, { success: false, error: "careerId, key and season are required." });
    }

    const service = new TrophyService();
    await service.removeTrophy(careerId, key, season);
    return ok({ success: true, cabinet: await service.getCabinet(careerId) });
  } catch (error) {
    console.error("[api/trophies] delete failed:", error);
    return failed(500, (error as Error).message ?? "Could not remove that trophy.");
  }
}
