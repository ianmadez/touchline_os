/**
 * The browser build's face cache: player sprites in OPFS.
 *
 * The local build writes into `public/faces/` because Next serves `public/` statically. A static
 * export has no folder to write into at runtime, so the same sprites live under `faces/` in this
 * origin's OPFS root instead, and are handed to the page as blob URLs.
 *
 * Unlike the database image, these are written straight to their final name rather than through a
 * scratch file. A face is small and individually replaceable, so an interrupted write can only lose
 * one sprite - and the size check on read turns that into "not cached yet", which the next sync
 * fixes on its own. The database gets the careful treatment because there is no next sync for it.
 */
import { MIN_SPRITE_BYTES, faceFileName } from "../services/face-source";

/**
 * Async iteration over a directory's entries is in the File System Access spec but not in this
 * `lib.dom.d.ts`, the same way `move()` and `showOpenFilePicker` are not. Declared here rather than
 * reached for through a cast, so the one call site below stays readable. `listCachedFaces` catches, so
 * a browser without it simply reports no cached faces.
 */
declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

const FACE_DIR = "faces";

/** The directory faces live in, or null when OPFS is missing or blocked. */
async function faceDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(FACE_DIR, { create });
  } catch {
    return null;
  }
}

/** True when this player's sprite is cached and looks complete. */
export async function hasCachedFace(eaPlayerId: number): Promise<boolean> {
  try {
    const dir = await faceDir(false);
    if (!dir) return false;
    const handle = await dir.getFileHandle(faceFileName(eaPlayerId));
    // Size only: nothing needs the bytes just to answer this, and `file.size` is metadata.
    return (await handle.getFile()).size >= MIN_SPRITE_BYTES;
  } catch {
    // NotFoundError is the ordinary "not cached yet" answer, not a fault.
    return false;
  }
}

/** One cached sprite, or null when it is absent or too short to be a real one. */
export async function readCachedFace(eaPlayerId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const dir = await faceDir(false);
    if (!dir) return null;
    const handle = await dir.getFileHandle(faceFileName(eaPlayerId));
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    return bytes.byteLength >= MIN_SPRITE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Caches one sprite, creating the faces directory the first time. */
export async function writeCachedFace(
  eaPlayerId: number,
  bytes: Uint8Array
): Promise<void> {
  const dir = await faceDir(true);
  if (!dir) return;

  const handle = await dir.getFileHandle(faceFileName(eaPlayerId), { create: true });
  const writable = await handle.createWritable();
  // `Uint8Array.from` narrows to `Uint8Array<ArrayBuffer>`, which is what a write chunk accepts.
  await writable.write(Uint8Array.from(bytes));
  await writable.close();
}

/** Every sprite currently cached, for diagnostics. */
export async function listCachedFaces(): Promise<number[]> {
  try {
    const dir = await faceDir(false);
    if (!dir) return [];

    const ids: number[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".png")) continue;
      const id = Number(name.slice(0, -4));
      if (Number.isFinite(id)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}
