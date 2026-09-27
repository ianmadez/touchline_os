/**
 * Settings vocabulary shared by the service, the API route and the browser UI.
 *
 * This module is deliberately dependency-free. The settings service opens SQLite, so importing it
 * from a client component would pull the native database driver into the browser bundle. Keeping
 * the unions and option lists here means the UI can never offer an option the API would reject.
 */

export type SyncTrigger = "ON_LAUNCH" | "MANUAL";
export type DebriefFrequency = "EVERY_MATCH" | "EVERY_2_MATCHES" | "EVERY_3_MATCHES" | "MANUAL";
export type RealismLevel = "STRICT_REALISM" | "REALISTIC" | "BALANCED" | "CASUAL" | "CHAOS";
export type CurrencySymbol = "GBP" | "EUR" | "USD";
export type WageFormat = "WEEKLY" | "ANNUAL";
export type AiProvider = "OLLAMA" | "GROQ" | "DISABLED";

/** Canonical vocabularies. The settings API rejects anything outside these unions. */
export const SYNC_TRIGGERS: readonly SyncTrigger[] = ["ON_LAUNCH", "MANUAL"];
export const DEBRIEF_FREQUENCIES: readonly DebriefFrequency[] = [
  "EVERY_MATCH",
  "EVERY_2_MATCHES",
  "EVERY_3_MATCHES",
  "MANUAL",
];
export const REALISM_LEVELS: readonly RealismLevel[] = [
  "STRICT_REALISM",
  "REALISTIC",
  "BALANCED",
  "CASUAL",
  "CHAOS",
];
export const CURRENCY_SYMBOLS: readonly CurrencySymbol[] = ["GBP", "EUR", "USD"];
export const WAGE_FORMATS: readonly WageFormat[] = ["WEEKLY", "ANNUAL"];
export const AI_PROVIDERS: readonly AiProvider[] = ["OLLAMA", "GROQ", "DISABLED"];

export interface AppSettings {
  id: string;
  saveDirectory: string;
  syncTrigger: SyncTrigger;
  debriefFrequency: DebriefFrequency;
  realismLevel: RealismLevel;
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
  STRICT_REALISM: "Strict realism",
  REALISTIC: "Realistic",
  BALANCED: "Balanced",
  CASUAL: "Casual",
  CHAOS: "Chaos",
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
