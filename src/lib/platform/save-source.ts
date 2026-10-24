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
import { GAME_METAS } from "../parser/game-versions";
import { sha1Hex } from "../parser/sha";
import { classifySlot, isReferenceFolderName, looksLikeSaveFile } from "../parser/save-naming";
import type { SaveCandidate, SaveSearchLocation } from "../parser/interface";
import type { SaveSource } from "./types";

const MAX_SCAN_DEPTH = 3;
const MAX_DIR_ENTRIES = 5000;

/**
 * The size band a save offered by the scan must sit in.
 *
 * Both ends exist because the list has no way to say "this one is not really a save" once a row is in
 * it: a candidate is shown with its name and its size, and a manager has no reason to doubt either.
 *
 * The floor is where the `0.00 MB` rows came from. Every real save measured for this project is
 * between three and sixteen megabytes, because a career container carries a database block with a
 * table directory inside it. What the list held instead was a synthetic 2.7 KB fixture and whatever
 * a half-written copy left behind: both rendered as `0.00 MB` next to a real career, and both fail to
 * parse the moment they are chosen.
 *
 * This filters what is OFFERED, never what is refused. A path handed in explicitly (one the wizard
 * carries, or a file the manager picked themselves) is checked for being a readable file and nothing
 * more, so a small save that someone means to open still opens.
 */
const MIN_SCAN_SAVE_BYTES = 1024 * 1024;

/** Guard rail: a legit FC career save is a few MB; refuse anything absurd. */
const MAX_SAVE_BYTES = 256 * 1024 * 1024;

/**
 * The folders older FIFA titles write careers into, taken from the supported-games registry.
 *
 * Derived rather than listed, so a game can never be readable by the parser while being unfindable by
 * the scan. FC-era titles are handled separately above: they nest their careers inside `settings`, and
 * their folders live in more than one place.
 */
const FIFA_SAVE_FOLDERS: string[] = GAME_METAS.filter((meta) => meta.id.startsWith("FIFA")).flatMap(
  (meta) => (meta.saveFolder ? [meta.saveFolder] : [])
);

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

  // Older FIFA titles keep their careers in the game's own folder under Documents, with NO `settings`
  // subfolder: FIFA 17 to 21 write `Documents\FIFA 18\Career20180108121239`. FIFA 16 and earlier are
  // deliberately absent, because their saves are not `fifa_ng_db` databases at all and offering their
  // folder would offer a file this parser cannot read.
  for (const folder of FIFA_SAVE_FOLDERS) {
    candidates.push([path.join(home, "Documents", folder), `${folder} · Documents`]);
    candidates.push([
      path.join(home, "OneDrive", "Documents", folder),
      `${folder} · OneDrive Documents`,
    ]);
  }

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
      // A folder that says it holds reference or test material is not descended into at all, so its
      // files are never even considered. See `isReferenceFolderName`.
      if (isReferenceFolderName(entry.name)) continue;
      walk(full, depth - 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

let lastScan: SaveSearchLocation[] = [];

/**
 * Walks the save locations on this machine.
 *
 * `allowPicker` is accepted and ignored: there is no dialog to open on the desktop build, so scanning
 * IS how a save is found here. The parameter exists because the port carries it - the browser build
 * needs it, and a signature that only one implementation honours is worse than one that says so.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function detectSaves(saveDirectory?: string, allowPicker?: { allowPicker?: boolean }): Promise<SaveCandidate[]> {
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

      // Out of the size band: an empty file, a stub left by an interrupted copy, or something that is
      // not a save at all. Recorded as seen first so a later location offering the same path cannot
      // reintroduce it, then dropped silently: the list is the only place it would have been
      // mentioned, and a row saying "ignored" is not something a manager asked to read.
      if (fileStat.size < MIN_SCAN_SAVE_BYTES || fileStat.size > MAX_SAVE_BYTES) {
        seen.add(key);
        continue;
      }

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
