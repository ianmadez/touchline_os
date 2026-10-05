import { CareerService, OnboardingInput } from "../services/career-service";
import { SyncService } from "../sync/sync-service";
import { saveSource } from "../platform/save-source";
import { saveUnreadableMessage } from "../ui/save-source-copy";
import { at, failed, ok, type OperationResult } from "./types";

interface ParseSaveRequest {
  savePath?: string;
  saveId?: string;
  onboarding?: OnboardingInput;
}

/**
 * Reads a career save, runs the parser + deterministic diff sync, persists the snapshot/cache, then
 * returns the full hydrated career payload (squad + tactics).
 *
 * Takes the raw body text because the route parsed it inside its own `try`, so a body that is not
 * JSON produced a 500 rather than a 400. Parsing here keeps that.
 */
export async function parseAndSyncSave(rawBody: string): Promise<OperationResult<unknown>> {
  // Parsed in its own guard, BEFORE the main `try`, so a body that is not JSON is the caller's 400.
  // See `logMatchDebrief` for why this is not done with `instanceof SyntaxError` in the outer catch.
  let body: ParseSaveRequest;
  try {
    body = JSON.parse(rawBody) as ParseSaveRequest;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const candidate = await saveSource.resolveCandidate(body);
    if (!candidate) {
      // Wording comes from the mode-aware vocabulary rather than being hardcoded here. It used to tell
      // every runtime to "re-scan saves and select one of the detected files", which in a browser names a
      // folder list that does not exist and a control that is not on the screen. This module returns a
      // sentence the manager reads, so it has to speak the same vocabulary as the screens do.
      return at(404, { success: false, error: saveUnreadableMessage(saveSource.mode) });
    }

    const syncResult = await new SyncService().syncCandidate(candidate);

    const careerService = new CareerService();
    if (body.onboarding && typeof body.onboarding === "object") {
      await careerService.upsertOnboarding(syncResult.careerId, body.onboarding);
      await careerService.ensureInitialTactics(syncResult.careerId, body.onboarding.favFormations);
    }

    const payload = await careerService.hydrate(syncResult.careerId);
    if (!payload) {
      return failed(500, `Career ${syncResult.careerId} could not be hydrated.`);
    }

    return ok({
      success: true,
      syncStatus: syncResult.status,
      snapshotNumber: syncResult.snapshotNumber ?? payload.latestSnapshotNumber,
      eventsEmitted: syncResult.eventsEmittedCount,
      // The events this sync actually emitted (not the whole timeline), so a sync prompt can show
      // the manager a plain "what changed" list.
      syncEvents: syncResult.events,
      warnings: syncResult.warnings,
      savePath: candidate.filePath,
      saveFileName: candidate.fileName,
      ...payload,
    });
  } catch (error) {
    console.error("[api/parse-save] parsing failed:", error);
    return failed(500, (error as Error).message ?? "Save parsing failed.");
  }
}
