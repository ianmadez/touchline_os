/**
 * Save source for the local Node build: scans the known FC save locations on this machine and reads
 * the bytes of the file that was chosen.
 *
 * This module is a build-time switch point. The browser target substitutes a file-picker-backed
 * implementation, so no caller may depend on anything here beyond the `SaveSource` interface.
 *
 * The scan lives here rather than in the parser because it is the one part of reading a save that
 * cannot exist in a browser: a page cannot enumerate `%USERPROFILE%\Documents\FC 26\settings`. The
 * parser decodes bytes and nothing else.
 */
import fs from "fs";
import path from "path";
import { sha1Hex } from "../parser/sha";
import { classifySlot, looksLikeSaveFile } from "../parser/save-naming";
import type { SaveCandidate, SaveSearchLocation } from "../parser/interface";
import type { SaveSource } from "./types";

const MAX_SCAN_DEPTH = 3;
const MAX_DIR_ENTRIES = 5000;

export function searchLocations(): SaveSearchLocation[] {
  const env = process.env;
  const home = env.USERPROFILE || env.HOME || "";
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
  const cwd = process.cwd();

  const candidates: [string, string][] = [
    [path.join(home, "Documents", "FC 25", "settings"), "FC 25 · Documents/settings"],
    [
      path.join(home, "OneDrive", "Documents", "FC 25", "settings"),
      "FC 25 · OneDrive Documents/settings",
    ],
    [path.join(localAppData, "EA SPORTS FC 25"), "FC 25 · AppData/Local"],
    [path.join(localAppData, "EA SPORTS FC 25", "settings"), "FC 25 · AppData/Local/settings"],
    [path.join(cwd, "data", "saves"), "workspace · data/saves"],
    [path.join(localAppData, "EA SPORTS FC 26", "settings"), "FC 26 · AppData/Local/settings"],
    [path.join(home, "Documents", "FC 26", "settings"), "FC 26 · Documents/settings"],
    [path.join(roaming, "EA Sports", "FC 25"), "FC 25 · AppData/Roaming/EA Sports"],
    [path.join(roaming, "EA Sports", "FC 26"), "FC 26 · AppData/Roaming/EA Sports"],
  ];

  for (const key of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const root = env[key];
    if (!root) continue;
    candidates.push([
      path.join(root, "Documents", "FC 25", "settings"),
      `FC 25 · ${key}/Documents/settings`,
    ]);
    candidates.push([
      path.join(root, "Documents", "FC 26", "settings"),
      `FC 26 · ${key}/Documents/settings`,
    ]);
  }

  const out: SaveSearchLocation[] = [];
  const seen = new Set<string>();
  for (const [dir, label] of candidates) {
    if (!dir || seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    out.push({ path: dir, label, exists: fs.existsSync(dir) });
  }
  return out;
}

function walk(dir: string, depth: number, out: string[]): string[] {
  if (depth < 0 || out.length >= MAX_DIR_ENTRIES) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_DIR_ENTRIES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth - 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

let lastScan: SaveSearchLocation[] = [];

async function detectSaves(saveDirectory?: string): Promise<SaveCandidate[]> {
  const locations: SaveSearchLocation[] = saveDirectory
    ? [
        {
          path: path.resolve(saveDirectory),
          label: "explicit path",
          exists: fs.existsSync(path.resolve(saveDirectory)),
        },
      ]
    : searchLocations();

  lastScan = locations;

  const candidates: SaveCandidate[] = [];
  const seen = new Set<string>();

  for (const location of locations) {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(location.path);
    } catch {
      continue;
    }

    const isFile = stat.isFile();
    const files = isFile ? [location.path] : walk(location.path, MAX_SCAN_DEPTH, []);

    for (const filePath of files) {
      const key = filePath.toLowerCase();
      if (seen.has(key)) continue;

      const fileName = path.basename(filePath);
      if (!isFile && !looksLikeSaveFile(fileName)) continue;

      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;

      seen.add(key);
      const slot = classifySlot(fileName);
      candidates.push({
        id: sha1Hex(filePath).slice(0, 16),
        filePath,
        fileName,
        lastModified: fileStat.mtime,
        fileSizeBytes: fileStat.size,
        slotKind: slot.kind,
        foundIn: location.label,
        ...(slot.stamp ? { slotStamp: slot.stamp } : {}),
      });
    }
  }

  return candidates.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/** Guard rail: a legit FC career save is a few MB; refuse anything absurd. */
const MAX_SAVE_BYTES = 256 * 1024 * 1024;

/**
 * Resolves a request into a concrete, validated save candidate.
 *
 * An explicit path is authoritative: it is what the wizard sends, it costs no directory walk, and a
 * path that does not resolve to a readable file is refused rather than silently replaced by whatever
 * else happens to be detected. Only when no path is given does the detected id get a say.
 */
async function resolveCandidate(request: {
  savePath?: string;
  saveId?: string;
}): Promise<SaveCandidate | null> {
  // 1. Explicit path (what the wizard sends) — cheap, no directory walking.
  if (request.savePath && request.savePath.trim().length > 0) {
    const resolved = path.resolve(request.savePath);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SAVE_BYTES) return null;
      return {
        id: sha1Hex(resolved).slice(0, 16),
        filePath: resolved,
        fileName: path.basename(resolved),
        lastModified: stat.mtime,
        fileSizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  }

  // 2. Detected id fallback (re-detection keeps the id contract identical to /api/saves).
  if (request.saveId) {
    const detected = await detectSaves();
    return detected.find((save) => save.id === request.saveId) ?? null;
  }

  return null;
}

export const saveSource: SaveSource = {
  mode: "folders",
  detectSaves,
  resolveCandidate,
  readBytes: async (candidate) => {
    if (!fs.existsSync(candidate.filePath)) {
      throw new Error(`Save file not found at path: ${candidate.filePath}`);
    }
    return new Uint8Array(fs.readFileSync(candidate.filePath));
  },
  lastScan: () => lastScan,
  // The desktop build can always enumerate the known save locations.
  unavailableReason: () => null,
  // Nothing to remember: this build finds saves by walking its own folders, so there is no picked
  // file to hold on to and no permission to re-establish. Answering `none` is what keeps the UI from
  // offering a "reconnect" control that would have no meaning here.
  rememberedSave: async () => "none",
  reconnectRememberedSave: async () => null,
  forgetRememberedSave: async () => {},
};
