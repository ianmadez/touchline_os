/**
 * Asset store for the browser build.
 *
 * Faces are switched off for v1. Nothing is fetched and nothing is cached: `player-face.tsx` already
 * renders an initials disc when there is no image, so a build with no face pipeline degrades on its
 * own. A cache in OPFS is a real feature and a later decision, not a prerequisite for shipping.
 *
 * Exports become a download. A page cannot write to a folder the user chose without a save picker,
 * and a download is the one thing every browser already does - it also puts the file exactly where
 * the user expects to find it when they move it to another build.
 *
 * This module is a build-time switch point, substituted for `./asset-store` by the browser target.
 */
import type { AssetStore } from "./types";

export const assetStore: AssetStore = {
  faceExists: async () => false,
  readFace: async () => null,
  writeFace: async () => {
    // Faces are disabled; there is nowhere for an image to go.
  },
  listFaces: async () => [],
  refreshSquadFaces: async () => {
    // Deliberately empty. The sync treats this as presentation, exactly as the desktop build does.
  },

  writeExport: async (fileName, contents) => {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Released on the next task, once the download has been handed to the browser.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { path: fileName, sizeBytes: blob.size };
  },

  // There is no exports directory to name. The export itself reports the file it downloaded.
  exportsLocation: () => null,
};
