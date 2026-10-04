/**
 * Settings vocabulary shared by the service, the API route and the browser UI.
 *
 * This module is deliberately dependency-free. The settings service opens SQLite, so importing it
 * from a client component would pull the native database driver into the browser bundle. Keeping
 * the unions and option lists here means the UI can never offer an option the API would reject.
 */

import type { Playstyle } from "./playstyles";

export type SyncTrigger = "ON_LAUNCH" | "MANUAL";
export type DebriefFrequency =
  | "EVERY_MATCH"
  | "EVERY_2_MATCHES"
  | "EVERY_3_MATCHES"
  | "EVERY_5_MATCHES"
  | "MANUAL";
/**
 * Four levels, not five.
 *
 * Five was choice fatigue for no benefit: CASUAL, BALANCED and REALISTIC all behaved identically, so
 * three of the five options were the same option wearing different labels. Four distinct behaviours
 * fit in the same control and take less reading.
 */
export type RealismLevel = "CHAOS" | "STRICT_REALISM" | "NORMAL" | "OFF";
export type CurrencySymbol = "GBP" | "EUR" | "USD";
export type WageFormat = "WEEKLY" | "ANNUAL";
export type AiProvider = "OLLAMA" | "GROQ" | "DISABLED";

/** Canonical vocabularies. The settings API rejects anything outside these unions. */
export const SYNC_TRIGGERS: readonly SyncTrigger[] = ["ON_LAUNCH", "MANUAL"];
export const DEBRIEF_FREQUENCIES: readonly DebriefFrequency[] = [
  "EVERY_MATCH",
  "EVERY_2_MATCHES",
  "EVERY_3_MATCHES",
  "EVERY_5_MATCHES",
  "MANUAL",
];
/**
 * The realism ladder. The two poles lead, because they are the two a manager arrives already wanting;
 * NORMAL follows as the middle, and OFF trails because turning a feature off is the rarer intent.
 * The order is the manager's to read; the MEANING is fixed by `realismModeOf`.
 */
export const REALISM_LEVELS: readonly RealismLevel[] = [
  "CHAOS",
  "STRICT_REALISM",
  "NORMAL",
  "OFF",
];

/**
 * Coerces any stored value into the current four, mapping the retired vocabulary to NORMAL.
 *
 * Three levels were retired here (REALISTIC, BALANCED, CASUAL) and existing rows still hold them, so
 * every read goes through this rather than casting. NORMAL is the destination for all three because it
 * is the middle: an unrecognised value must never silently make the app stricter than it was set to.
 */
export function normaliseRealismLevel(raw: string | null | undefined): RealismLevel {
  return isRealismLevel(raw) ? raw : "NORMAL";
}

function isRealismLevel(value: string | null | undefined): value is RealismLevel {
  return value === "CHAOS" || value === "STRICT_REALISM" || value === "NORMAL" || value === "OFF";
}

/**
 * What each level actually does, in the same order as the ladder above.
 *
 * These are shown under the control so the choice is made from consequences rather than from the name.
 * CHAOS and OFF are worth separating clearly, because they sound alike and are not: CHAOS still tells
 * you how far above your level a target sits, it just refuses to act on it. OFF does not assess
 * realism at all, so there is no score to show.
 */
export const REALISM_HINTS: Record<RealismLevel, string> = {
  CHAOS:
    "No move is ever ruled out. Targets still show how far above your own level they sit, but the app never blocks or warns on plausibility.",
  STRICT_REALISM:
    "Believable moves only. A large jump in level is ruled out outright, and a wage bill past 65% of tier revenue is flagged.",
  NORMAL:
    "Some licence. A moderate step up is allowed where money and a reason exist; only the far-fetched is ruled out.",
  OFF:
    "Realism is not assessed at all. No plausibility score, no rulings-out, and no realism warnings anywhere in the app.",
};
export const CURRENCY_SYMBOLS: readonly CurrencySymbol[] = ["GBP", "EUR", "USD"];
export const WAGE_FORMATS: readonly WageFormat[] = ["WEEKLY", "ANNUAL"];
export const AI_PROVIDERS: readonly AiProvider[] = ["OLLAMA", "GROQ", "DISABLED"];

export interface AppSettings {
  id: string;
  saveDirectory: string;
  syncTrigger: SyncTrigger;
  debriefFrequency: DebriefFrequency;
  /**
   * How much licence the app allows when judging a move, and how strict its advisory warnings are.
   * Advisory only: it never scales or rewrites a save figure.
   */
  realismLevel: RealismLevel;
  /**
   * The kind of squad the manager is building. Sits beside realism because it is the same kind of
   * control - a mode that changes how the app JUDGES, and never one that touches a save figure.
   */
  playstyle: Playstyle;
  currencySymbol: CurrencySymbol;
  wageFormat: WageFormat;
  aiProvider: AiProvider;
  aiModelName: string;
  /** Write-only from the client's perspective; never returned by the API. */
  aiApiKey: string;
  /**
   * Stored but NOT patchable from the UI. Nothing implements snapshot pruning, so letting a user
   * lower this would schedule deletion of immutable history - the opposite of the promise that
   * snapshots are never rewritten or dropped.
   */
  snapshotRetention: number;
  updatedAt: string;
}

/**
 * Settings minus the secret. `aiApiKey` is replaced by a boolean so the UI can report whether a
 * key is configured without the key ever reaching the browser.
 */
export type ClientAppSettings = Omit<AppSettings, "aiApiKey"> & { aiApiKeyConfigured: boolean };

/** A partial update. Omitted fields are left untouched rather than nulled. */
export type AppSettingsPatch = Partial<
  Omit<AppSettings, "id" | "updatedAt" | "snapshotRetention">
>;

export function toClientSettings(settings: AppSettings): ClientAppSettings {
  const { aiApiKey, ...rest } = settings;
  return { ...rest, aiApiKeyConfigured: aiApiKey.length > 0 };
}

/** Human labels for the option lists, so the UI and validation cannot drift apart. */
export const SETTING_LABELS: Record<string, string> = {
  ON_LAUNCH: "Prompt on launch",
  MANUAL: "Manual only",
  EVERY_MATCH: "Every match",
  EVERY_2_MATCHES: "Every 2 matches",
  EVERY_3_MATCHES: "Every 3 matches",
  // A five-match cadence IS the Group Debrief, so the label names that rather than counting.
  EVERY_5_MATCHES: "Group Debrief — every 5 matches",
  STRICT_REALISM: "Strict realism",
  NORMAL: "Normal",
  CHAOS: "Chaos",
  OFF: "Off",
  OWN: "Own",
  MONEYBALL: "Moneyball",
  YOUTH_ONLY: "Youth only",
  YOUNG_SIGNINGS: "Young signings",
  FORGOTTEN_LEGENDS: "Forgotten legends",
  VETERANS: "Veterans",
  GBP: "GBP (£)",
  EUR: "EUR (€)",
  USD: "USD ($)",
  WEEKLY: "Weekly",
  ANNUAL: "Annual",
  OLLAMA: "Local Ollama",
  GROQ: "Groq remote",
  DISABLED: "Disabled",
};

export function labelFor(value: string): string {
  return SETTING_LABELS[value] ?? value;
}
