/**
 * Remembers the save file the manager picked. Browser build only.
 *
 * A page cannot enumerate a filesystem, so the only way to avoid asking for the save file again is to
 * keep the handle the picker handed back. A `FileSystemFileHandle` is serializable, which means it can
 * be written to IndexedDB and read back on a later visit - and that is the entire reason this module
 * exists, because nothing else here survives a reload.
 *
 * IndexedDB is used rather than OPFS, deliberately. OPFS holds bytes this origin owns (the database
 * image, the face cache); it has no way to hold a *reference to a file somebody else owns*, which is
 * what a handle is. The two stores answer different questions, and a handle in OPFS is not a thing.
 *
 * Permission is a separate question from the handle, and it is not ours to decide. Storing the handle
 * keeps the reference; whether we may still READ through it is the browser's call, can differ between
 * visits, and - by design - can never be granted silently. See `handlePermission` below for the rule
 * this file exists to make explicit.
 */

/** The IndexedDB database, kept separate from any other storage this app uses. */
const DB_NAME = "touchline.save-access";
const DB_VERSION = 1;
const STORE = "handles";

/** One save is remembered, not a list: the app has a single career open at a time. */
const HANDLE_KEY = "career-save";

/**
 * What the browser says about our right to read through a handle.
 *
 * `unsupported` is not a failure - it is the honest answer on Firefox and Safari, which implement
 * neither `queryPermission` nor `requestPermission`. Those browsers can still open a save, but they
 * cannot remember one, and the UI says so rather than promising something it cannot deliver.
 */
export type SavePermission = "granted" | "prompt" | "denied" | "unsupported";

/**
 * The permission methods, which are not in this project's `lib.dom.d.ts`.
 *
 * Declared as a local narrow type rather than merged into the global `FileSystemHandle`, because the
 * rest of the app should not start believing every handle everywhere has these - on Firefox none of
 * them do. Reaching them through this type keeps that belief local to the two functions below.
 */
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
};

/** Opens the database, creating the store on first use, or null when IDB is unusable here. */
async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      // An upgrade held open by another tab would otherwise leave this promise pending forever, and a
      // pending promise here means the wizard never finishes deciding what to show.
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
    });
  } catch {
    // Private windows and hardened configurations refuse IndexedDB outright. That costs the
    // remembered save and nothing else: every caller falls back to the picker.
    return null;
  }
}

/** Runs one operation against the store, or returns null when IDB is unusable. */
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      // A transaction can abort without the request erroring - a quota fault, or the connection being
      // closed underneath it - so this is listened for separately rather than assumed.
      transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted."));
    });
  } catch {
    return null;
  } finally {
    database.close();
  }
}

/**
 * Reads back the remembered save handle, or null when there is none.
 *
 * The stored value is checked before it is trusted: IndexedDB returns whatever was written, and a
 * future version of this file could have written something else. A handle that is not a file handle is
 * treated as "nothing remembered" rather than handed on to fail somewhere less obvious.
 */
export async function loadSaveHandle(): Promise<FileSystemFileHandle | null> {
  const stored = await withStore<unknown>("readonly", (store) => store.get(HANDLE_KEY));
  if (!stored || typeof stored !== "object") return null;

  const candidate = stored as FileSystemFileHandle;
  return candidate.kind === "file" && typeof candidate.getFile === "function" ? candidate : null;
}

/** Remembers one handle, replacing whatever was there. */
export async function rememberSaveHandle(handle: FileSystemFileHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

/**
 * Forgets the remembered handle.
 *
 * Called when the browser reports the permission as denied: the manager has refused access, and
 * offering the same file again on the next visit would be asking a question they have already
 * answered. Also called when the remembered file has gone from disk.
 */
export async function forgetSaveHandle(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

/**
 * Whether we may read through this handle right now. Never prompts, so it is safe to call on load.
 *
 * This is the check the whole feature turns on. A restored handle is a REFERENCE, not a grant: a
 * browser may keep the reference and still require the manager to confirm access again on a later
 * visit, and Chrome's own guidance is to treat that as normal rather than exceptional. So a
 * `'granted'` answer is what lets a visit sync itself with no interaction, and anything else is a
 * question only the manager can answer.
 */
export async function handlePermission(handle: FileSystemFileHandle): Promise<SavePermission> {
  const query = (handle as PermissionHandle).queryPermission;
  if (typeof query !== "function") return "unsupported";

  try {
    return await query.call(handle, { mode: "read" });
  } catch {
    return "prompt";
  }
}

/**
 * Asks for access, which MUST be called from a click.
 *
 * `requestPermission()` requires transient user activation: called without a fresh gesture it throws
 * a `SecurityError` rather than showing a prompt. This is deliberate browser design, not a limitation
 * to work around - disk access is never granted silently, so there is no version of this feature
 * where a visit re-grants itself. Every path into here hangs off a real button press.
 */
export async function requestHandlePermission(
  handle: FileSystemFileHandle
): Promise<SavePermission> {
  const request = (handle as PermissionHandle).requestPermission;
  if (typeof request !== "function") return "unsupported";

  try {
    return await request.call(handle, { mode: "read" });
  } catch {
    // A refused or impossible prompt is reported as `denied` so the caller stops offering it.
    return "denied";
  }
}

/**
 * Whether this browser can remember a save at all.
 *
 * False on Firefox and Safari. They can open a save through the `<input type="file">` fallback, but
 * the `File` object an input returns is a snapshot with no link back to disk, and it cannot be stored
 * - so on those browsers the save has to be re-picked. The UI states that plainly instead of showing
 * a "remembered" affordance that would never work.
 */
export function canRememberSave(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function"
  );
}
