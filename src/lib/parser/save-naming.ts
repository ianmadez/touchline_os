/**
 * Save-file naming rules, shared by both `SaveSource` implementations.
 *
 * These are pure string rules, but they decide a candidate's `slotKind` and whether it is worth
 * offering at all. Both the desktop scan and the browser picker must answer that identically, so the
 * rules live here rather than being repeated in each source.
 */
import type { SaveSlotKind } from "./interface";

export const NON_CAREER_RE = /^(CmPlr|Squads|FutSquads|MatchDay|Settings|Assets|UltimateTeam|FUT|Temp)/i;
export const SAVE_EXT_RE = /\.(db|sav|fcsave|fc25|fc26|bin|dat)$/i;

const SLOT_PATTERNS: { re: RegExp; kind: SaveSlotKind }[] = [
  { re: /^CmMgrC(\d{17})$/i, kind: "manager-career" },
  { re: /^ManagerCareer(\d{8,})$/i, kind: "manager-career" },
  { re: /^Career(\d{8,})$/i, kind: "career" },
  { re: /^CmPlrC?(\d{8,})$/i, kind: "player-career" },
];

export function classifySlot(fileName: string): { kind: SaveSlotKind; stamp: string | null } {
  for (const pattern of SLOT_PATTERNS) {
    const match = pattern.re.exec(fileName);
    if (match) return { kind: pattern.kind, stamp: match[1] };
  }
  if (SAVE_EXT_RE.test(fileName)) return { kind: "database", stamp: null };
  if (/career/i.test(fileName)) return { kind: "career", stamp: null };
  if (/^DATA/i.test(fileName)) return { kind: "database", stamp: null };
  return { kind: "unknown", stamp: null };
}

export function looksLikeSaveFile(fileName: string): boolean {
  if (NON_CAREER_RE.test(fileName)) return false;
  return classifySlot(fileName).kind !== "unknown";
}

/**
 * Folder names that hold reference or test material rather than a manager's own careers.
 *
 * The scan walks a few levels below each save location, which is right for the games that nest careers
 * in `settings` subfolders and wrong for a checkout that keeps sample saves beside the real ones. Every
 * reference save in `data/saves/not-my-own-saves` was being offered as though the manager had written
 * it, indistinguishable in the list from their own career, so a folder that says what it is decides it.
 *
 * Matched on a whole name, case-insensitively, and never on a path substring: a manager whose Windows
 * profile happens to contain the word "sample" must not lose every save they own.
 */
const REFERENCE_FOLDER_RE =
  /^(not[-_ ]?my[-_ ]?own([-_ ]?saves?)?|fixtures?|mocks?|test|tests|samples?|references?|examples?)$/i;

export function isReferenceFolderName(name: string): boolean {
  return REFERENCE_FOLDER_RE.test(name.trim());
}
