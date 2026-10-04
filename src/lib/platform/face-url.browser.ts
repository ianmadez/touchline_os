/**
 * Where a player's face is served from, browser build.
 *
 * There is no `public/faces/` to point an `<img>` at: a static export's files are fixed at build time,
 * and the sprites this build resolves belong to whoever's save is open. A cached sprite is handed to
 * the page as a blob URL instead.
 *
 * Blob URLs are created once per player and kept for the session - a sprite never changes for a given
 * id, and a squad's worth is a few hundred kilobytes. Returning null means "nothing cached", which the
 * face component renders as initials without making a request at all.
 *
 * This module is a build-time switch point, substituted for `./face-url` by the browser target.
 */
import { isUsablePlayerId } from "../services/face-source";
import { readCachedFace } from "./face-store.browser";

const objectUrls = new Map<number, string>();

export async function faceImageUrl(eaPlayerId: number): Promise<string | null> {
  if (!isUsablePlayerId(eaPlayerId)) return null;

  const cached = objectUrls.get(eaPlayerId);
  if (cached) return cached;

  const bytes = await readCachedFace(eaPlayerId);
  if (!bytes) return null;

  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  objectUrls.set(eaPlayerId, url);
  return url;
}
