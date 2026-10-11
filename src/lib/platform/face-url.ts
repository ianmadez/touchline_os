/**
 * Where a player's face comes from, in the build that serves `public/` statically.
 *
 * The static file wins when there is one, because that is this build's durable cache: the sync writes
 * sprites into `public/faces/` for the manager's own squad, and `public/` is served as static files,
 * so the usual answer is a path and nothing else has to happen.
 *
 * A MISS NOW FETCHES FROM THE CDN rather than rendering initials. That is the difference between a
 * face that depends on a sync having already run and one that appears because the player was looked
 * at. It matters for the ordinary case of a fresh checkout: `public/faces/` is per-career artwork and
 * is deliberately NOT committed (see .gitignore), so a new clone starts empty, and before this a
 * manager whose sync was failing saw nothing but initials with no way to ask for better.
 *
 * The bytes land in an in-memory map for the session only. This build has somewhere durable to put
 * them - the folder the sync owns - and a client component cannot write to it, so the durable copy
 * stays the sync's job and this is purely the fallback.
 *
 * `isNewgen` and the sprite-size guard live in `face-source.ts`, so both builds answer "does this
 * player have a face at all" identically. This module is a build-time switch point, substituted by
 * the browser target, whose twin caches into the browser's own storage instead.
 */
import { fetchSprite, isNewgen, isUsablePlayerId } from "../services/face-source";

/** One blob URL per player, for this session. A sprite never changes for a given id. */
const resolvedUrls = new Map<number, string>();
const inFlight = new Map<number, Promise<string | null>>();

/** True when the statically served copy is present. A missing file is an ordinary 404, not a fault. */
async function hasStaticFace(eaPlayerId: number): Promise<boolean> {
  try {
    const response = await fetch(`/faces/${eaPlayerId}.png`, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveFace(eaPlayerId: number): Promise<string | null> {
  if (await hasStaticFace(eaPlayerId)) return `/faces/${eaPlayerId}.png`;

  const sprite = await fetchSprite(eaPlayerId);
  if (!sprite.bytes) return null;

  const url = URL.createObjectURL(new Blob([Uint8Array.from(sprite.bytes)], { type: "image/png" }));
  resolvedUrls.set(eaPlayerId, url);
  return url;
}

/**
 * A URL for one player's face, or null when there is no face to show.
 *
 * Null is the only failure mode: the component that calls this sets its state in a `.then`, so
 * anything thrown on this path would leave a player stuck on initials with nothing explaining why.
 */
export async function faceImageUrl(eaPlayerId: number): Promise<string | null> {
  if (!isUsablePlayerId(eaPlayerId) || isNewgen(eaPlayerId)) return null;

  const resolved = resolvedUrls.get(eaPlayerId);
  if (resolved) return resolved;

  const pending = inFlight.get(eaPlayerId);
  if (pending) return pending;

  const promise = resolveFace(eaPlayerId)
    .catch((error: unknown) => {
      console.warn(`[face] ${eaPlayerId} could not be resolved:`, error);
      return null;
    })
    .finally(() => inFlight.delete(eaPlayerId));
  inFlight.set(eaPlayerId, promise);
  return promise;
}
