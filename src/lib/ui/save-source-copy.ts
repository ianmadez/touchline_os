/**
 * What the app says about where a save came from.
 *
 * Three runtimes can supply a save — the desktop build scanning folders, a browser file picker, or the
 * optional local bridge — and until now every screen spelled that out for itself. That is exactly how
 * "Re-scan save folders" ended up in a browser that has no folders, and how a card could display a
 * detected save directly above an error insisting none had been found. One module owns the wording, so a
 * fourth source or a fifth screen cannot reintroduce either.
 *
 * The test for whether a surface is correct is simply: does it read properly in all three modes?
 */
import type { SaveSourceMode } from "../platform/types";

/** The literal `foundIn` the browser picker writes. Kept in step with `save-source.browser.ts`. */
const FILE_PICKER_LABEL = "file picker";

/** The literal `foundIn` the bridge writes. Kept in step with `bridge-client.browser.ts`. */
const BRIDGE_LABEL = "local bridge";

/**
 * How the app found the save it is showing, in the manager's words.
 *
 * Reads `SaveCandidate.foundIn`, which all three sources already populate — the folder's own label, the
 * picker's literal, or the bridge's. Reusing that existing field rather than adding a new one to the
 * shared candidate type means a source cannot forget to declare itself, and the desktop build needed no
 * change at all.
 *
 * Returns null for a candidate that declares nothing, so a caller renders no line rather than an empty
 * one or the word "undefined".
 */
export function saveProvenanceLabel(foundIn?: string): string | null {
  if (!foundIn) return null;
  if (foundIn === BRIDGE_LABEL) return "Read from your local bridge";
  if (foundIn === FILE_PICKER_LABEL) return "The file you chose";
  return `Found in ${foundIn}`;
}

/**
 * The action that makes this runtime look for a save again.
 *
 * One label per mode, used by every surface. Two variants of the same button is what let the splash card
 * and the wizard disagree about what the same click would do.
 */
export function saveRefreshLabel(mode: SaveSourceMode): string {
  switch (mode) {
    case "bridge":
      // The bridge is asked again rather than re-scanned, and it may have picked up a newer save.
      return "Refresh from bridge";
    case "picker":
      return "Choose save file…";
    default:
      return "Re-scan save folders";
  }
}

/** What the app is doing while it has no save yet. */
export function saveScanningLabel(mode: SaveSourceMode): string {
  switch (mode) {
    case "bridge":
      return "Asking your local bridge…";
    case "picker":
      return "Waiting for a save file…";
    default:
      return "Scanning your save folders…";
  }
}

/** What the app reports when a scan finished and there is no save to show. */
export function saveEmptyLabel(mode: SaveSourceMode): string {
  switch (mode) {
    case "bridge":
      // Only reached with a bridge that IS answering - an unreachable one is reported by the bridge
      // panel, which knows the difference and says so. So this means it looked and found nothing.
      return "Your local bridge found no career saves";
    case "picker":
      return "No save file chosen yet";
    default:
      return "No EA SPORTS FC career save detected on this machine yet";
  }
}

/**
 * Why a sync could not read the save it was pointed at.
 *
 * The old wording told the manager to re-scan and pick from the detected files in every runtime, which
 * in a browser describes a folder list that does not exist and a control that is not on screen.
 */
export function saveUnreadableMessage(mode: SaveSourceMode): string {
  switch (mode) {
    case "bridge":
      return "The local bridge could not supply that save. Check the bridge window is still open, or choose the file instead.";
    case "picker":
      return "That save file could not be read. Choose it again to continue.";
    default:
      return "No EA SPORTS FC career save found at that location. Re-scan your save folders and pick one of the detected files.";
  }
}
