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
import { fetchSprite, isNewgen, isUsablePlayerId } from "../services/face-source";
import { readCachedFace, writeCachedFace } from "./face-store.browser";

const objectUrls = new Map<number, string>();
const inFlight = new Map<number, Promise<string | null>>();

/**
 * Asks the CDN for one sprite and caches it, or null when there is nothing worth caching.
 *
 * A newgen and a CDN miss both come back as no bytes, and both mean the same thing here: render the
 * initials disc. `fetchSprite` refuses a newgen before it makes a request at all.
 */
async function fetchAndCache(eaPlayerId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const sprite = await fetchSprite(eaPlayerId);
  if (!sprite.bytes) return null;

  // `Uint8Array.from` narrows to `Uint8Array<ArrayBuffer>`, which both the cache write and the Blob
  // require: a bare `Uint8Array` is `Uint8Array<ArrayBufferLike>` and neither accepts that.
  const bytes = Uint8Array.from(sprite.bytes);
  await writeCachedFace(eaPlayerId, bytes);
  return bytes;
}

/**
 * Resolves one sprite: the cache first, then the CDN, then caches whatever it found.
 *
 * The cache-first half is the obvious one. The repair half is why this build shows a face at all for
 * a career that had no sync behind it.
 *
 * A miss here used to mean "no face", full stop. The only thing that ever filled this cache was the
 * sync's own `refreshSquadFaces`, and that is scoped to a career being synced from a save file. A
 * career that reached this build any other way - and importing one is the ordinary way - had an empty
 * cache and no sync coming, so every player rendered as initials permanently with nothing to press.
 *
 * Fetching on a miss means a face is resolved by the act of looking at it, which keeps it inside the
 * same boundary: only players the app actually renders are ever asked for, newgens are refused before
 * any request, and what comes back is cached, so it costs one request ever.
 */
async function resolveFace(eaPlayerId: number): Promise<string | null> {
  const bytes = (await readCachedFace(eaPlayerId)) ?? (await fetchAndCache(eaPlayerId));
  if (!bytes) return null;

  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  objectUrls.set(eaPlayerId, url);
  return url;
}

/**
 * A blob URL for one player's face, or null when there is no face to show.
 *
 * Concurrent callers share a single lookup. A squad table and the player drawer can render the same
 * player in the same tick, and without this both would miss the cache and both would fetch the same
 * sprite. The entry is dropped as soon as it settles, so a later visit goes back to the cache instead
 * of replaying a stale answer.
 */
export async function faceImageUrl(eaPlayerId: number): Promise<string | null> {
  if (!isUsablePlayerId(eaPlayerId) || isNewgen(eaPlayerId)) return null;

  const cached = objectUrls.get(eaPlayerId);
  if (cached) return cached;

  const pending = inFlight.get(eaPlayerId);
  if (pending) return pending;

  const promise = resolveFace(eaPlayerId).finally(() => inFlight.delete(eaPlayerId));
  inFlight.set(eaPlayerId, promise);
  return promise;
}
