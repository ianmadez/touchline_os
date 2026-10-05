/**
 * Save source for the browser build.
 *
 * A page cannot enumerate a filesystem, so "detection" is a control the user drives. There are two
 * that can work and this uses both: `showOpenFilePicker` where it exists (Chrome and Edge on
 * desktop), and the browser's own `<input type="file">` everywhere else - Firefox, Safari and iOS
 * Safari. Firefox has never implemented the File System Access API, so the input is the only way a
 * Firefox user can open a save at all; without it the build would be honest but useless there.
 *
 * What differs between the two is persistence, not capability. The picker hands back a handle that
 * stays valid for the session; an input gives the file itself. Either way the bytes are read into
 * memory and parsed in the page, and nothing is uploaded anywhere.
 *
 * This module is a build-time switch point, substituted for `./save-source` by the browser target.
 */
import { sha1Hex } from "../parser/sha";
import { classifySlot } from "../parser/save-naming";
import type { SaveCandidate, SaveSearchLocation } from "../parser/interface";
import {
  forgetSaveHandle,
  handlePermission,
  loadSaveHandle,
  rememberSaveHandle,
  requestHandlePermission,
} from "./save-handle-store.browser";
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

/** The only case this can still be true: a page with no DOM at all, which cannot pick a file. */
const UNSUPPORTED =
  "This browser gives pages no way to open a local file, so saves cannot be read here. Try Chrome, Edge, Firefox or Safari on a desktop.";

/**
 * What the wizard is told when a save is remembered but access has to be confirmed again.
 *
 * Worded as a state rather than a fault. A browser re-asking for access is normal and expected, and
 * describing it as a failure would send a manager looking for a problem that does not exist.
 */
const REGRANT_REQUIRED =
  "Your save file is still remembered. This browser needs you to confirm access to it again before TouchlineOS can read it.";

/**
 * FC save files have no registered MIME type, so no `accept` filter is offered. A filter that does
 * not match the real file would hide the very file the user came to open, and `excludeAcceptAllOption`
 * would only remove the "all files" entry the picker needs here.
 */
const PICKER_OPTIONS: OpenFilePickerOptions = { multiple: false };

/** What the last pick produced, so a sync resolves the file already chosen instead of re-prompting. */
interface PickedSave {
  candidate: SaveCandidate;
  read: () => Promise<File>;
}

const picked = new Map<string, PickedSave>();
let scan: SaveSearchLocation[] = [];

const hasPicker = (): boolean =>
  typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";

const canUseFileInput = (): boolean =>
  typeof document !== "undefined" && typeof document.createElement === "function";

/**
 * Whether this call is happening inside a real user gesture.
 *
 * It matters because opening a file dialog without one does nothing at all in Firefox - no dialog,
 * and no `change` event either, so a caller waiting for a file would wait forever. The scan that
 * runs when the wizard mounts has no gesture behind it, and this is how it knows not to try.
 */
function hasUserGesture(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  // Where the API is missing, assume a gesture: the button path always has one, and refusing to
  // open the dialog would be a worse failure than opening it when it was allowed.
  return activation ? activation.isActive : true;
}

/**
 * Turns chosen files into candidates, remembering how to read each one back.
 *
 * The reason a file was left out comes back separately: a picker usually returns exactly one file,
 * and dropping that one silently would look like the control had not worked at all.
 */
function acceptFiles(files: File[]): { candidates: SaveCandidate[]; filteredOut: string | null } {
  const candidates: SaveCandidate[] = [];
  let filteredOut: string | null = null;

  for (const file of files) {
    const slot = classifySlot(file.name);
    const id = sha1Hex(`${file.name}|${file.size}|${file.lastModified}`).slice(0, 16);

    // The wizard drops `database` slots, so name the one file that was actually chosen rather than
    // returning nothing and looking like a failure.
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

    picked.set(id, { candidate, read: async () => file });
    candidates.push(candidate);
  }

  return { candidates, filteredOut };
}

/**
 * Opens the browser's own file control and waits for a choice.
 *
 * Three ways out, because no single one is reliable everywhere: `change` for a selection, `cancel`
 * for a dismissed dialog, and window focus for the browsers that never fire `cancel` - without that
 * last one, dismissing the dialog would leave the caller waiting for a file that is never coming.
 */
function chooseFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // Several saves can be picked at once, which is the closest a page gets to the desktop build
    // listing every slot it found.
    input.multiple = true;
    input.style.display = "none";

    let settled = false;
    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const selected = () => settle(input.files ? Array.from(input.files) : []);
    // The dialog holds focus while it is open, so the page getting it back means the dialog has
    // closed - and `change` has already fired if anything was chosen. The short delay makes sure of
    // that ordering rather than assuming it.
    const onFocus = () => window.setTimeout(selected, 150);

    input.addEventListener("change", selected);
    input.addEventListener("cancel", () => settle([]));
    window.addEventListener("focus", onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * The save this browser is already allowed to read, resolved without showing a dialog.
 *
 * The middle outcome is the whole reason the reconnect flow exists. A handle can outlive the page
 * while the PERMISSION to read through it does not, and Chrome's own guidance is to treat that as
 * ordinary rather than exceptional - so it is a state to report, not a fault to raise. Only a click
 * can confirm access, which is why this never attempts to.
 */
async function resolveRememberedSave(): Promise<
  { candidate: SaveCandidate } | "needs-permission" | "none"
> {
  const handle = await loadSaveHandle();
  if (!handle) return "none";

  const permission = await handlePermission(handle);
  // A browser that cannot answer the permission question cannot honour a remembered handle either,
  // so there is nothing here for it to read.
  if (permission === "unsupported") return "none";
  if (permission === "prompt") return "needs-permission";
  if (permission !== "granted") {
    // The manager refused this file. Asking again on every visit would be re-asking a question that
    // has already been answered, so the handle is dropped and the picker takes over from here.
    await forgetSaveHandle();
    return "none";
  }

  try {
    const file = await handle.getFile();
    const candidate = acceptFiles([file]).candidates[0];
    if (!candidate) return "none";

    // Re-attached so a later sync reads the file as it is THEN. A `File` is only readable while the
    // file underneath it has not changed, so holding one across sessions would read a stale save.
    picked.set(candidate.id, { candidate, read: () => handle.getFile() });
    return { candidate };
  } catch {
    // Moved, renamed or deleted since it was picked. The reference is dead, and keeping it would mean
    // offering the same broken save on every future visit.
    await forgetSaveHandle();
    return "none";
  }
}

export const saveSource: SaveSource = {
  mode: "picker",
  detectSaves: async () => {
    // Tried before anything that could open a dialog. A save we are already allowed to read is
    // resolved with no interaction at all, which is the entire point of remembering it.
    const remembered = await resolveRememberedSave();
    if (remembered === "needs-permission") {
      scan = [{ path: "", label: REGRANT_REQUIRED, exists: false }];
      return [];
    }
    if (remembered !== "none") {
      scan = [{ path: "", label: remembered.candidate.filePath, exists: true }];
      return [remembered.candidate];
    }

    if (!hasPicker()) {
      if (!canUseFileInput()) {
        scan = [{ path: "", label: UNSUPPORTED, exists: false }];
        return [];
      }
      if (!hasUserGesture()) {
        // The mount-time scan, with no gesture behind it. Opening the dialog here would do nothing
        // and never settle, so the honest answer is that nothing has been chosen yet and the
        // wizard's own button is the way in.
        scan = [{ path: "", label: "No save file chosen yet.", exists: false }];
        return [];
      }

      const { candidates, filteredOut } = acceptFiles(await chooseFiles());
      scan = filteredOut
        ? [{ path: "", label: filteredOut, exists: false }]
        : [{ path: "", label: "file picker", exists: candidates.length > 0 }];
      return candidates;
    }

    let handles: FileSystemFileHandle[];
    try {
      handles = await window.showOpenFilePicker!(PICKER_OPTIONS);
    } catch {
      // Dismissing the picker is a normal outcome, not a failure, and nothing was probed.
      scan = [];
      return [];
    }

    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    const { candidates, filteredOut } = acceptFiles(files);

    // The handle is re-attached to each candidate so a later sync reads the file from disk as it is
    // then, rather than from a snapshot taken at pick time.
    handles.forEach((handle, index) => {
      const candidate = candidates[index];
      if (candidate) picked.set(candidate.id, { candidate, read: () => handle.getFile() });
    });

    // Remembered so the next visit needs no dialog at all: the handle is the only thing here that can
    // outlive the page. The first handle that produced a usable candidate is the one worth keeping -
    // a storage file sitting beside the save is not a save.
    const usable = candidates.findIndex((candidate) => candidate.slotKind !== "database");
    if (usable >= 0) {
      const chosen = handles[usable];
      if (chosen) await rememberSaveHandle(chosen);
    }

    scan = filteredOut
      ? [{ path: "", label: filteredOut, exists: false }]
      : [{ path: "", label: "file picker", exists: true }];
    return candidates;
  },

  /**
   * Whether a save is remembered, and whether it can currently be read.
   *
   * Answers a question about a reference, not about bytes: a handle can survive a reload while the
   * permission to read through it does not, and the two have to be told apart for the UI to know
   * whether to sync by itself or to ask for one click.
   */
  rememberedSave: async () => {
    const handle = await loadSaveHandle();
    if (!handle) return "none";

    const permission = await handlePermission(handle);
    if (permission === "granted") return "granted";
    if (permission === "prompt") return "needs-permission";

    // Refused, or a browser that cannot answer the question. Either way there is nothing here that
    // could be reconnected, so the reference is dropped rather than offered again.
    await forgetSaveHandle();
    return "none";
  },

  /**
   * Re-opens the remembered save from a click, asking for access on the way.
   *
   * The gesture is not a nicety: `requestPermission()` throws if there is no user activation behind
   * it, so this is the only shape the re-grant flow can take. A refusal is reported by returning
   * null, and the handle is dropped - the manager has answered, and asking again on every visit
   * would be re-asking it.
   */
  reconnectRememberedSave: async () => {
    const handle = await loadSaveHandle();
    if (!handle) return null;

    if ((await requestHandlePermission(handle)) !== "granted") {
      await forgetSaveHandle();
      return null;
    }

    try {
      const file = await handle.getFile();
      const candidate = acceptFiles([file]).candidates[0] ?? null;
      if (candidate) picked.set(candidate.id, { candidate, read: () => handle.getFile() });
      return candidate;
    } catch {
      // The file has gone since it was picked. Its handle is worth nothing now.
      await forgetSaveHandle();
      return null;
    }
  },

  forgetRememberedSave: async () => {
    await forgetSaveHandle();
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
    const file = await entry.read();
    return new Uint8Array(await file.arrayBuffer());
  },

  lastScan: () => scan,
  unavailableReason: () => (hasPicker() || canUseFileInput() ? null : UNSUPPORTED),
};
