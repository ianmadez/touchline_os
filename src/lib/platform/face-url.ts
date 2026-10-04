/**
 * Where a player's face is served from.
 *
 * The local build serves `public/` statically, so a face is a URL and nothing else has to happen -
 * which is why this returns a path and never checks whether the file is there. A missing sprite simply
 * fails to load and the component falls back to initials, exactly as it always has.
 *
 * This module is a build-time switch point, substituted for `./face-url` by the browser target.
 */
export async function faceImageUrl(eaPlayerId: number): Promise<string | null> {
  if (!Number.isFinite(eaPlayerId) || eaPlayerId <= 0) return null;
  return `/faces/${eaPlayerId}.png`;
}
