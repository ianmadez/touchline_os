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
