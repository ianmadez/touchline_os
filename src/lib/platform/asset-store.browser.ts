/**
 * Asset store for the browser build.
 *
 * Faces are cached in OPFS rather than in `public/faces/`, because a static export has no folder to
 * write into at runtime. Which players have a face, which ids the game generated and what the CDN
 * counts as a sprite all come from `face-source.ts`, so this build resolves exactly the same faces the
 * local build does - and picks up a new signing the same way, because the sync runs this over the
 * whole squad every time and only requests the ones it does not already hold.
 *
 * Exports become a download. A page cannot write to a folder the user chose without a save picker,
 * and a download is the one thing every browser already does - it also puts the file exactly where
 * the user expects to find it when they move it to another build.
 *
 * This module is a build-time switch point, substituted for `./asset-store` by the browser target.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { players } from "../db/schema";
import { cacheFaces } from "../services/face-source";
import {
  hasCachedFace,
  listCachedFaces,
  readCachedFace,
  writeCachedFace,
} from "./face-store.browser";
import type { AssetStore } from "./types";

export const assetStore: AssetStore = {
  faceExists: async (eaPlayerId) => hasCachedFace(eaPlayerId),
  readFace: async (eaPlayerId) => readCachedFace(eaPlayerId),
  writeFace: async (eaPlayerId, bytes) => writeCachedFace(eaPlayerId, bytes),
  listFaces: async () => listCachedFaces(),

  /**
   * Caches a face for everyone on the books, skipping anyone already held.
   *
   * The `players` table only ever holds the manager's own squad and youth, so scoping to a career is
   * the whole of the "squad and youth only" rule - there is no wider roster to reach into. Newgens are
   * skipped before any request is made.
   */
  refreshSquadFaces: async (careerId) => {
    const squad = await db
      .select({ eaPlayerId: players.eaPlayerId })
      .from(players)
      .where(eq(players.careerId, careerId));

    await cacheFaces(
      squad.map((row) => row.eaPlayerId),
      {
        has: hasCachedFace,
        write: writeCachedFace,
      }
    );
  },

  /**
   * Nothing to persist, and no download here any more.
   *
   * This used to trigger the download, and that is precisely why Export behaved differently in the two
   * builds: here it downloaded from inside the operation, while the Node build wrote to
   * `data/exports/` and downloaded nothing at all. A local user clicking Export saw no file appear and
   * reasonably concluded the button was broken. Delivery now happens once, in the UI, for both
   * runtimes, so this reports the size and stops.
   */
  writeExport: async (fileName, contents) => ({
    path: fileName,
    sizeBytes: new Blob([contents]).size,
  }),

  // There is no exports directory to name. The export itself reports the file it downloaded.
  exportsLocation: () => null,
};
