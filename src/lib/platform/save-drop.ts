/**
 * Dropping a save file onto the page, as a build-time switch point.
 *
 * The local Node build finds saves by scanning folders on disk, so a dropped file has nowhere to go and
 * the drop zone is not offered there. The browser build substitutes `save-drop.browser.ts`, which hands
 * the files to the browser save source. Screens import this file rather than the save source itself,
 * because the Node save source reads the disk and must never be pulled into a client bundle.
 */
export const canDropSaves = false;

export async function acceptDroppedSaves(
  files: File[]
): Promise<{ accepted: number; filteredOut: string | null }> {
  void files;
  return { accepted: 0, filteredOut: null };
}
