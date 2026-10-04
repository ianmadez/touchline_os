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
    });
  } catch (error) {
    console.error("[api/saves] save detection failed:", error);
    return failed(500, (error as Error).message ?? "Save detection failed.");
  }
}
