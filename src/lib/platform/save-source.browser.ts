/**
 * Save source for the browser build: the File System Access API.
 *
 * A page cannot enumerate a filesystem, so "detection" is a picker the user drives. `showOpenFilePicker`
 * is Chrome/Edge on desktop only - Firefox, Safari/iOS Safari and Android Chrome do not implement it
 * (caniuse, checked 2026-10: Firefox `n` through 160; Safari `n` through 27.2 and TP). Rather than
 * show a control that silently does nothing, `unavailableReason()` returns a plain sentence the UI
 * can display.
 *
 * Nothing is uploaded anywhere: the file is read into memory locally and parsed in the page. This is
 * the browser half of the same `SaveSource` interface the desktop build implements.
 */
import { sha1Hex } from "../parser/sha";
import { classifySlot } from "../parser/save-naming";
import type { SaveCandidate, SaveSearchLocation } from "../parser/interface";
import type { SaveSource } from "./types";

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }
}

const UNSUPPORTED =
  "This browser can't open local save files yet. Try Chrome or Edge on a desktop.";

/**
 * FC save files have no registered MIME type, so no `accept` filter is offered. A filter that does
 * not match the real file would hide the very file the user came to open, and `excludeAcceptAllOption`
 * would only remove the "all files" entry the picker needs here.
 */
const PICKER_OPTIONS: OpenFilePickerOptions = { multiple: false };

/** What the last pick produced, so a sync resolves the file already chosen instead of re-prompting. */
const picked = new Map<string, { handle: FileSystemFileHandle; candidate: SaveCandidate }>();
let scan: SaveSearchLocation[] = [];

const supported = (): boolean =>
  typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";

export const saveSource: SaveSource = {
  mode: "picker",
  detectSaves: async () => {
    if (!supported()) {
      // `lastScan` is the only channel this port offers the UI for explaining an empty result, and
      // this build has no folders to list. The single entry carries the reason so the wizard can
      // show it where it would otherwise show "no saves found". `unavailableReason` is the same
      // sentence, for the UI to use directly once it reads that field.
      scan = [{ path: "", label: UNSUPPORTED, exists: false }];
      return [];
    }

    let handles: FileSystemFileHandle[];
    try {
      handles = await window.showOpenFilePicker!(PICKER_OPTIONS);
    } catch {
      // Dismissing the picker is a normal outcome, not a failure, and nothing was probed.
      scan = [];
      return [];
    }

    const candidates: SaveCandidate[] = [];
    let filteredOut: string | null = null;

    for (const handle of handles) {
      const file = await handle.getFile();
      const slot = classifySlot(file.name);
      const id = sha1Hex(`${file.name}|${file.size}|${file.lastModified}`).slice(0, 16);

      // The wizard drops `database` slots, and a picker usually returns exactly one file. Dropping
      // that one file would look like the picker had not worked, so name it instead.
      if (slot.kind === "database") {
        filteredOut = `${file.name} is a storage file, not a career save. Pick the file named like "ManagerCareer…".`;
      }

      const candidate: SaveCandidate = {
        id,
        // A page has no path to report; the file name is the only honest identifier there is.
        filePath: file.name,
        fileName: file.name,
        lastModified: new Date(file.lastModified),
        fileSizeBytes: file.size,
        slotKind: slot.kind,
        foundIn: "file picker",
        ...(slot.stamp ? { slotStamp: slot.stamp } : {}),
      };

      picked.set(id, { handle, candidate });
      candidates.push(candidate);
    }

    scan = filteredOut
      ? [{ path: "", label: filteredOut, exists: false }]
      : [{ path: "", label: "file picker", exists: true }];
    return candidates;
  },

  /**
   * Id only. The wizard sends the candidate's `filePath` as well, but a page cannot read a path -
   * treating that field as authoritative the way the desktop build does would refuse every sync.
   * The file the manager actually picked is what `saveId` points at.
   */
  resolveCandidate: async (request) => {
    if (!request.saveId) return null;
    return picked.get(request.saveId)?.candidate ?? null;
  },

  readBytes: async (candidate) => {
    const entry = picked.get(candidate.id);
    if (!entry) {
      // Same wording as the desktop source, so a caller sees one contract either way.
      throw new Error(`Save file not found at path: ${candidate.filePath}`);
    }
    const file = await entry.handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  },

  lastScan: () => scan,
  unavailableReason: () => (supported() ? null : UNSUPPORTED),
};
