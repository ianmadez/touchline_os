/**
 * Asset store for the local Node build: faces under `public/faces`, exports under `data/exports`.
 *
 * This module is a build-time switch point. The browser target substitutes an OPFS/download-backed
 * implementation, so no caller may depend on anything here beyond the `AssetStore` interface.
 */
import fs from "fs";
import path from "path";
import {
  ensureFacesForSquad,
  hasCachedFace,
  listCachedFaces,
  readFaceBytes,
  writeFaceBytes,
} from "../services/face-service";
import type { AssetStore } from "./types";

const EXPORTS_DIR = path.join(process.cwd(), "data", "exports");

export const assetStore: AssetStore = {
  faceExists: async (eaPlayerId) => hasCachedFace(eaPlayerId),
  readFace: async (eaPlayerId) => readFaceBytes(eaPlayerId),
  writeFace: async (eaPlayerId, bytes) => writeFaceBytes(eaPlayerId, bytes),
  listFaces: async () => listCachedFaces(),
  refreshSquadFaces: async (careerId) => {
    await ensureFacesForSquad(careerId);
  },
  writeExport: async (fileName, contents) => {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const filePath = path.join(EXPORTS_DIR, fileName);
    fs.writeFileSync(filePath, contents, "utf8");
    return { path: filePath, sizeBytes: fs.statSync(filePath).size };
  },
  exportsLocation: () => EXPORTS_DIR,
};
