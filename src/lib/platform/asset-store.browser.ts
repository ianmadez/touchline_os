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
import { and, eq } from "drizzle-orm";
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
   * Caches a face for everyone in the senior squad, skipping anyone already held.
   *
   * Scoped to the career and to `is_youth_prospect = 0`, which is the stated boundary: the squad's
   * faces, not the academy's. The career filter is what keeps this to the manager's own club - the
   * `players` table holds nobody else's squad - so there is no wider roster to reach into. A new
   * signing is simply a row that is not held yet, which is why his face arrives on his own.
   *
   * Newgens are refused before any request is made. Academy players are almost all newgens, so the
   * youth filter and the newgen check agree in practice; the filter is what makes the intent explicit
   * rather than something that merely happens to be true.
   */
  refreshSquadFaces: async (careerId) => {
    const squad = await db
      .select({ eaPlayerId: players.eaPlayerId })
      .from(players)
      .where(and(eq(players.careerId, careerId), eq(players.isYouthProspect, false)));

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
