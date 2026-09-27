import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import {
  AppSettings,
  AppSettingsPatch,
  AiProvider,
  CurrencySymbol,
  DebriefFrequency,
  RealismLevel,
  SyncTrigger,
  WageFormat,
} from "../settings-vocabulary";

// Re-exported so server-side callers keep a single import site for the settings vocabulary.
export * from "../settings-vocabulary";

/** Coerces the nullable storage columns into the concrete shape the rest of the app expects. */
function normaliseSettings(row: typeof appSettings.$inferSelect): AppSettings {
  return {
    id: row.id,
    saveDirectory: row.saveDirectory ?? "",
    syncTrigger: row.syncTrigger as SyncTrigger,
    debriefFrequency: row.debriefFrequency as DebriefFrequency,
    realismLevel: row.realismLevel as RealismLevel,
    currencySymbol: row.currencySymbol as CurrencySymbol,
    wageFormat: row.wageFormat as WageFormat,
    aiProvider: row.aiProvider as AiProvider,
    aiModelName: row.aiModelName ?? "",
    aiApiKey: row.aiApiKey ?? "",
    snapshotRetention: row.snapshotRetention,
    updatedAt: row.updatedAt,
  };
}

export class SettingsService {
  /**
   * Reads the single global settings row, materialising it from column defaults on first use.
   *
   * It previously returned a loose literal when the row was absent and the raw Drizzle row
   * otherwise, so the two branches disagreed about nullability. Creating the row up front removes
   * that split entirely and means callers always get one predictable shape.
   */
  async getSettings(): Promise<AppSettings> {
    const existing = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, "default"))
      .get();

    if (existing) return normaliseSettings(existing);

    await db.insert(appSettings).values({ id: "default" }).run();
    const created = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, "default"))
      .get();

    if (!created) throw new Error("Could not initialise the app_settings row.");
    return normaliseSettings(created);
  }

  /**
   * Applies a partial update, writing only the keys actually present in `patch`.
   *
   * This used to be a full write that copied every field from its input, so any field the caller
   * left out was stored as null/undefined - i.e. an omitted setting was silently erased.
   */
  async saveSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    await this.getSettings();

    const update: Partial<typeof appSettings.$inferInsert> = {
      ...(patch.saveDirectory !== undefined ? { saveDirectory: patch.saveDirectory } : {}),
      ...(patch.syncTrigger !== undefined ? { syncTrigger: patch.syncTrigger } : {}),
      ...(patch.debriefFrequency !== undefined
        ? { debriefFrequency: patch.debriefFrequency }
        : {}),
      ...(patch.realismLevel !== undefined ? { realismLevel: patch.realismLevel } : {}),
      ...(patch.currencySymbol !== undefined ? { currencySymbol: patch.currencySymbol } : {}),
      ...(patch.wageFormat !== undefined ? { wageFormat: patch.wageFormat } : {}),
      ...(patch.aiProvider !== undefined ? { aiProvider: patch.aiProvider } : {}),
      ...(patch.aiModelName !== undefined ? { aiModelName: patch.aiModelName } : {}),
      ...(patch.aiApiKey !== undefined ? { aiApiKey: patch.aiApiKey } : {}),
    };

    if (Object.keys(update).length > 0) {
      await db
        .update(appSettings)
        .set({ ...update, updatedAt: new Date().toISOString() })
        .where(eq(appSettings.id, "default"));
    }

    return this.getSettings();
  }
}