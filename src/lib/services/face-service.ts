/**
 * Player faces, local build.
 *
 * Sprites are written into `public/faces/` because Next serves `public/` statically: that keeps the
 * whole thing offline at runtime with no route to maintain. The browser build has no such folder and
 * caches the same sprites in OPFS instead. Which players have a face, which ids the game generated,
 * and what the CDN counts as a sprite all live in `face-source.ts`, so both runtimes answer those
 * questions the same way and only the storage differs.
 *
 * Deliberately NOT gated on `players.hashighqualityhead`. That field means "has a scanned head",
 * not "has a face": measured against the CDN, players with the flag at 0 returned real 8.5 KB
 * sprites, so gating on it would have skipped 23 of 24 players in a real squad.
 */
import fs from "fs";
import path from "path";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { players } from "../db/schema";
import { cacheFaces, faceFileName, fetchSprite, type FaceImportSummary } from "./face-source";

export type { FaceImportSummary };

const FACE_DIR = path.join(process.cwd(), "public", "faces");

export type FaceOutcome = "cached" | "fetched" | "no-sprite" | "newgen";

/**
 * The on-disk path for one player's sprite.
 *
 * Exported so the platform `AssetStore` shares this single definition of where faces live rather
 * than repeating the path.
 */
export function facePathFor(eaPlayerId: number): string {
  return path.join(FACE_DIR, faceFileName(eaPlayerId));
}

/** True when this player already has a cached sprite. Never touches the network. */
export function hasCachedFace(eaPlayerId: number): boolean {
  try {
    return fs.existsSync(facePathFor(eaPlayerId));
  } catch {
    return false;
  }
}

/** The cached sprite bytes, or null when this player has no cached face. */
export function readFaceBytes(eaPlayerId: number): Uint8Array | null {
  try {
    return fs.readFileSync(facePathFor(eaPlayerId));
  } catch {
    return null;
  }
}

/** Caches sprite bytes for one player, creating the faces directory if it does not exist yet. */
export function writeFaceBytes(eaPlayerId: number, bytes: Uint8Array): void {
  fs.mkdirSync(FACE_DIR, { recursive: true });
  fs.writeFileSync(facePathFor(eaPlayerId), bytes);
}

/**
 * Resolves one player's face, using the local cache before the network.
 *
 * Idempotent: a player already on disk is never re-fetched, so this is safe to run on every sync.
 * `ensureFacesForSquad` goes through `cacheFaces` rather than this, so the batching and the summary
 * are shared with the browser build; this stays as the single-player entry point it always was.
 */
export async function ensureFace(eaPlayerId: number): Promise<FaceOutcome> {
  if (hasCachedFace(eaPlayerId)) return "cached";

  const sprite = await fetchSprite(eaPlayerId);
  if (sprite.outcome === "newgen") return "newgen";
  if (!sprite.bytes) return "no-sprite";

  writeFaceBytes(eaPlayerId, sprite.bytes);
  return "fetched";
}

/**
 * Fetches faces for every player on the books, skipping anyone already cached.
 *
 * The `players` table only ever holds the manager's own squad and youth, so scoping to a career is
 * itself the "squad and youth only" rule - there is no wider roster to leak out to. A new signing is
 * simply a row that is not on disk yet, which is why his face arrives on the next sync with nothing
 * for the manager to press.
 */
export async function ensureFacesForSquad(careerId: string): Promise<FaceImportSummary> {
  const squad = await db
    .select({ eaPlayerId: players.eaPlayerId })
    .from(players)
    .where(eq(players.careerId, careerId))
    .orderBy(desc(players.overallRating));

  return cacheFaces(
    squad.map((row) => row.eaPlayerId),
    {
      has: hasCachedFace,
      write: async (eaPlayerId, bytes) => writeFaceBytes(eaPlayerId, bytes),
    }
  );
}

/** Every face currently on disk, for diagnostics. */
export function listCachedFaces(): number[] {
  try {
    if (!fs.existsSync(FACE_DIR)) return [];
    return fs
      .readdirSync(FACE_DIR)
      .filter((name) => name.endsWith(".png"))
      .map((name) => Number(name.replace(".png", "")))
      .filter((id) => Number.isFinite(id));
  } catch {
    return [];
  }
}
