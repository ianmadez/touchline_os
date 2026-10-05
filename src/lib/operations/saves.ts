import { saveSource } from "../platform/save-source";
import { DEFAULT_BRIDGE_PORT } from "../platform/types";
import { SettingsService } from "../services/settings-service";
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
    // The manager's configured folder, so the setting actually constrains the scan.
    //
    // It did not before. `detectSaves` has always accepted a directory, the setting has always existed
    // end to end, and nothing ever read it here - so anyone who typed a folder into Settings got the
    // built-in list anyway and no indication that their choice was being ignored. A setting that is
    // visible in the UI and silently does nothing is worse than not offering it at all.
    //
    // Read defensively: an unreadable settings row must not take the whole scan down with it, because
    // finding a save is the thing the app needs most. The folder is an override, not a dependency.
    let saveDirectory: string | undefined;
    try {
      saveDirectory = (await new SettingsService().getSettings()).saveDirectory || undefined;
    } catch {
      saveDirectory = undefined;
    }

    const detected = await saveSource.detectSaves(saveDirectory);

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
      // What the optional local bridge is doing. `unsupported` on the desktop build, which has no bridge
      // and needs none - it already scans this machine directly - so the UI hides the feature there
      // rather than offering a control that could never work.
      bridge: saveSource.bridgeStatus ? await saveSource.bridgeStatus() : "unsupported",
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

/**
 * Switches the local bridge on and checks a pairing code.
 *
 * The code is the only thing that authorises reading the save, so a wrong or unaccepted one is a
 * conflict with the reason - the manager typed something wrong, and nothing here has broken. Reported as
 * a 409 rather than a 500 so the distinction survives all the way to the screen.
 */
export async function pairLocalBridge(payload: unknown): Promise<OperationResult<unknown>> {
  if (!saveSource.pairBridge) {
    return failed(400, "This build has no local bridge to pair with.");
  }

  const input = payload as { port?: unknown; code?: unknown } | null;
  const code = typeof input?.code === "string" ? input.code.trim() : "";
  if (!code) return failed(400, "A pairing code is required.");

  const requested = typeof input?.port === "number" ? input.port : Number(input?.port);
  const port = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_BRIDGE_PORT;

  try {
    const state = await saveSource.pairBridge(port, code);

    if (state === "unsupported") {
      return failed(
        400,
        "This browser will not let the app remember a pairing, so the bridge cannot be used here."
      );
    }
    if (state !== "paired") {
      return failed(
        409,
        state === "unreachable"
          ? "No bridge answered on that port. Check the bridge window is still open."
          : "That pairing code was not accepted. Check the code shown in the bridge window."
      );
    }

    return ok({ success: true, bridge: state });
  } catch (error) {
    console.error("[api/saves] bridge pairing failed:", error);
    return failed(500, (error as Error).message ?? "Pairing with the local bridge failed.");
  }
}

/**
 * Switches the bridge off and forgets the code, so no future visit requests anything.
 *
 * Never fails in a way worth reporting: the effect is that nothing is remembered, and a store that could
 * not be written has already achieved that.
 */
export async function forgetLocalBridge(): Promise<OperationResult<unknown>> {
  if (!saveSource.forgetBridge) return ok({ success: true, bridge: "unsupported" });

  try {
    await saveSource.forgetBridge();
    return ok({ success: true, bridge: "off" });
  } catch (error) {
    console.error("[api/saves] forgetting the bridge failed:", error);
    return failed(500, (error as Error).message ?? "Disconnecting from the local bridge failed.");
  }
}
