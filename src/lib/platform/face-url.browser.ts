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

/** Reports a given problem once per player. A squad table retries as it scrolls, and a warning per row
 * per render would bury the one line that explains it. */
const warned = new Set<string>();
function warnOnce(tag: string, message: string, error?: unknown): void {
  if (warned.has(tag)) return;
  warned.add(tag);
  if (error === undefined) console.warn(message);
  else console.warn(message, error);
}

/** The eight bytes every PNG starts with: the same test the CDN fetch makes, applied to the cache. */
function looksLikePng(bytes: Uint8Array): boolean {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.byteLength >= magic.length && magic.every((byte, index) => bytes[index] === byte);
}

/**
 * The cache, but never a reason to skip the CDN.
 *
 * This used to be the first half of an `??` chain, so ANY throw out of the cache - OPFS unavailable, a
 * private window, a quota error, a handle that cannot be reopened - ended the whole lookup before the
 * fetch was ever reached. The symptom of that is indistinguishable from "this player has no face": a
 * disc of initials and not one network request in the log, forever. The cache is an optimisation and it
 * now behaves like one.
 *
 * Bytes that are not a PNG are treated as absent for the same reason. A cache written by an interrupted
 * fetch, or by a build that stored the CDN's error page, describes the player just as convincingly as a
 * real sprite does unless something checks.
 */
async function cachedFace(eaPlayerId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const bytes = await readCachedFace(eaPlayerId);
    if (!bytes) return null;
    if (!looksLikePng(bytes)) {
      warnOnce(`bad:${eaPlayerId}`, `[face] ${eaPlayerId} has cached bytes that are not a PNG, refetching`);
      return null;
    }
    return bytes;
  } catch (error) {
    warnOnce(
      "cache-read",
      "[face] the sprite cache could not be read, so faces are fetched from the CDN instead",
      error
    );
    return null;
  }
}

/**
 * Asks the CDN for one sprite and caches it, or null when there is nothing worth caching.
 *
 * A newgen and a CDN miss both come back as no bytes, and both mean the same thing here: render the
 * initials disc. `fetchSprite` refuses a newgen before it makes a request at all.
 *
 * The cache write is BEST EFFORT, and that ordering is deliberate. It used to be awaited before the
 * bytes were returned, so a browser that refuses the write - a private window, a full quota, an
 * implementation without `createWritable` - threw the bytes away and the player kept his initials
 * even though the sprite had been fetched successfully. A cache is an optimisation; it must never be
 * able to cost the thing it is caching.
 */
async function fetchAndCache(eaPlayerId: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const sprite = await fetchSprite(eaPlayerId);
  if (!sprite.bytes) {
    // "No sprite" is a normal answer for a newgen or an id the CDN does not have. It is worth a line in
    // the log for anything else, because "the face never appeared" and "the CDN refused us" look exactly
    // the same on screen and only one of them is fixable by the person looking at it.
    if (sprite.outcome === "no-sprite") {
      warnOnce(`miss:${eaPlayerId}`, `[face] ${eaPlayerId} came back with no sprite (status or size)`);
    }
    return null;
  }

  // `Uint8Array.from` narrows to `Uint8Array<ArrayBuffer>`, which both the cache write and the Blob
  // require: a bare `Uint8Array` is `Uint8Array<ArrayBufferLike>` and neither accepts that.
  const bytes = Uint8Array.from(sprite.bytes);
  try {
    await writeCachedFace(eaPlayerId, bytes);
  } catch {
    // Nothing to report to the caller: the face is in hand either way.
  }
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
  const bytes = (await cachedFace(eaPlayerId)) ?? (await fetchAndCache(eaPlayerId));
  if (!bytes) return null;

  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  objectUrls.set(eaPlayerId, url);
  return url;
}

/**
 * A blob URL for one player's face, or null when there is no face to show.
 *
 * NULL IS THE ONLY FAILURE MODE, and nothing may reject out of here. That is not defensive habit: the
 * component that calls this sets its state in a `.then`, so an exception anywhere on this path left
 * the promise rejected with nobody listening - an unhandled rejection in the console and a player
 * stuck on initials forever, with nothing on screen to explain it. A count of the squad table and a
 * count of initials should never disagree without a reason in the log, so a failure that is not "no
 * face exists" is reported before it is swallowed.
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

  const promise = resolveFace(eaPlayerId)
    .catch((error: unknown) => {
      warnOnce(`throw:${eaPlayerId}`, `[face] ${eaPlayerId} could not be resolved:`, error);
      return null;
    })
    .finally(() => inFlight.delete(eaPlayerId));
  inFlight.set(eaPlayerId, promise);
  return promise;
}
