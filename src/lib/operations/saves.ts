import { saveSource } from "../platform/save-source";
import { failed, ok, type OperationResult } from "./types";

/**
 * Scans the known FC career-save locations and returns the candidates the onboarding wizard can
 * offer, plus the locations that were probed.
 *
 * The scan itself lives behind the `SaveSource` port: the local build walks this machine's disk,
 * while the browser build asks the user to pick a file.
 */
export async function listSaveCandidates(): Promise<OperationResult<unknown>> {
  try {
    const detected = await saveSource.detectSaves();

    // The wizard only cares about career saves; `database` slots (storageInfo.bin, ...) cannot be
    // parsed into a squad and would only produce a broken onboarding step.
    const seen = new Set<string>();
    const saves = detected
      .filter((save) => save.slotKind !== "database")
      .filter((save) => {
        const key = `${save.fileName}|${save.fileSizeBytes}|${save.lastModified.getTime()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((save) => ({
        ...save,
        // Dates do not survive JSON, so publish a stable ISO contract.
        lastModified: save.lastModified.toISOString(),
      }));

    return ok({
      success: true,
      saves,
      scannedLocations: saveSource.lastScan(),
      // How this runtime gets a save at all, so the UI can describe the action honestly: "re-scan
      // folders" is true on the desktop and meaningless in a page.
      saveSourceMode: saveSource.mode,
      // Null on the local build, which can always enumerate its own save folders. The browser build
      // reports the sentence the wizard shows on browsers with no File System Access API, so a
      // picker that cannot work says so instead of looking like a folder with nothing in it.
      unavailableReason: saveSource.unavailableReason(),
      // Whether the browser is still allowed to read a save it was given earlier, so the wizard can
      // offer one click to re-confirm access instead of the whole choose-a-file flow again.
      rememberedSave: await saveSource.rememberedSave(),
    });
  } catch (error) {
    console.error("[api/saves] save detection failed:", error);
    return failed(500, (error as Error).message ?? "Save detection failed.");
  }
}

/**
 * Re-establishes access to the save this browser already remembers, from a click.
 *
 * Deliberately separate from `listSaveCandidates`, and deliberately a POST: asking a browser for
 * access to a file requires a user gesture behind the call, so it can never be folded into the scan
 * that runs on load. A refusal is reported as a conflict with the reason, not as a server fault -
 * the manager said no, and nothing here has gone wrong.
 */
export async function reconnectRememberedSave(): Promise<OperationResult<unknown>> {
  try {
    const candidate = await saveSource.reconnectRememberedSave();
    if (!candidate) {
      return failed(
        409,
        "Access to the remembered save was not granted. Choose the save file to continue."
      );
    }

    return ok({
      success: true,
      save: { ...candidate, lastModified: candidate.lastModified.toISOString() },
    });
  } catch (error) {
    console.error("[api/saves] reconnect failed:", error);
    return failed(500, (error as Error).message ?? "Reconnecting to the save failed.");
  }
}

/**
 * Forgets the remembered save, so the next scan asks for a file.
 *
 * The escape hatch for "use a different save": without it, a browser holding a granted handle would
 * keep handing back that same save and there would be no way to point the app at another one.
 */
export async function forgetRememberedSave(): Promise<OperationResult<unknown>> {
  try {
    await saveSource.forgetRememberedSave();
    return ok({ success: true });
  } catch (error) {
    console.error("[api/saves] forget failed:", error);
    return failed(500, (error as Error).message ?? "Forgetting the saved file failed.");
  }
}
