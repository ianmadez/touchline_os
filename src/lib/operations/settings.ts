import { PLAYSTYLES } from "../playstyles";
import {
  AI_PROVIDERS,
  AppSettingsPatch,
  CURRENCY_SYMBOLS,
  DEBRIEF_FREQUENCIES,
  REALISM_LEVELS,
  SYNC_TRIGGERS,
  SettingsService,
  WAGE_FORMATS,
  toClientSettings,
} from "../services/settings-service";
import { failed, ok, type OperationResult } from "./types";

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Narrows an untrusted body into an AppSettingsPatch, collecting human-readable problems.
 * Values are validated against the canonical unions rather than free-text trusted.
 */
function parsePatch(body: unknown): { patch: AppSettingsPatch; problems: string[] } {
  if (!body || typeof body !== "object") {
    return { patch: {}, problems: ["Request body must be a JSON object."] };
  }

  const input = body as Record<string, unknown>;
  const patch: AppSettingsPatch = {};
  const problems: string[] = [];

  if (input.saveDirectory !== undefined) {
    if (typeof input.saveDirectory !== "string") {
      problems.push("saveDirectory must be a string.");
    } else {
      patch.saveDirectory = input.saveDirectory.trim();
    }
  }

  if (input.syncTrigger !== undefined) {
    if (!isMember(SYNC_TRIGGERS, input.syncTrigger)) {
      problems.push(`syncTrigger must be one of: ${SYNC_TRIGGERS.join(", ")}.`);
    } else {
      patch.syncTrigger = input.syncTrigger;
    }
  }

  if (input.debriefFrequency !== undefined) {
    if (!isMember(DEBRIEF_FREQUENCIES, input.debriefFrequency)) {
      problems.push(`debriefFrequency must be one of: ${DEBRIEF_FREQUENCIES.join(", ")}.`);
    } else {
      patch.debriefFrequency = input.debriefFrequency;
    }
  }

  if (input.realismLevel !== undefined) {
    if (!isMember(REALISM_LEVELS, input.realismLevel)) {
      problems.push(`realismLevel must be one of: ${REALISM_LEVELS.join(", ")}.`);
    } else {
      patch.realismLevel = input.realismLevel;
    }
  }

  if (input.playstyle !== undefined) {
    if (!isMember(PLAYSTYLES, input.playstyle)) {
      problems.push(`playstyle must be one of: ${PLAYSTYLES.join(", ")}.`);
    } else {
      patch.playstyle = input.playstyle;
    }
  }

  if (input.currencySymbol !== undefined) {
    if (!isMember(CURRENCY_SYMBOLS, input.currencySymbol)) {
      problems.push(`currencySymbol must be one of: ${CURRENCY_SYMBOLS.join(", ")}.`);
    } else {
      patch.currencySymbol = input.currencySymbol;
    }
  }

  if (input.wageFormat !== undefined) {
    if (!isMember(WAGE_FORMATS, input.wageFormat)) {
      problems.push(`wageFormat must be one of: ${WAGE_FORMATS.join(", ")}.`);
    } else {
      patch.wageFormat = input.wageFormat;
    }
  }

  if (input.aiProvider !== undefined) {
    if (!isMember(AI_PROVIDERS, input.aiProvider)) {
      problems.push(`aiProvider must be one of: ${AI_PROVIDERS.join(", ")}.`);
    } else {
      patch.aiProvider = input.aiProvider;
    }
  }

  if (input.aiModelName !== undefined) {
    if (typeof input.aiModelName !== "string") {
      problems.push("aiModelName must be a string.");
    } else {
      patch.aiModelName = input.aiModelName.trim();
    }
  }

  if (input.aiApiKey !== undefined) {
    if (typeof input.aiApiKey !== "string") {
      problems.push("aiApiKey must be a string.");
    } else {
      patch.aiApiKey = input.aiApiKey;
    }
  }

  // Refused rather than ignored: silently dropping it would let the UI imply the retention window
  // was applied when no pruning code exists at all.
  if (input.snapshotRetention !== undefined) {
    problems.push(
      "snapshotRetention cannot be changed. Nothing implements snapshot pruning, so lowering it would delete immutable history."
    );
  }

  return { patch, problems };
}

/** Read the global settings (never includes the API key). */
export async function readSettings(): Promise<OperationResult<unknown>> {
  try {
    const settings = await new SettingsService().getSettings();
    return ok({ success: true, settings: toClientSettings(settings) });
  } catch (error) {
    console.error("[api/settings] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read settings.");
  }
}

/** Partial update. Omitted fields are left untouched. */
export async function patchSettings(body: unknown): Promise<OperationResult<unknown>> {
  const { patch, problems } = parsePatch(body);
  if (problems.length > 0) {
    return failed(400, problems.join(" "));
  }
  if (Object.keys(patch).length === 0) {
    return failed(400, "No recognised settings were supplied.");
  }

  try {
    const settings = await new SettingsService().saveSettings(patch);
    return ok({ success: true, settings: toClientSettings(settings) });
  } catch (error) {
    console.error("[api/settings] write failed:", error);
    return failed(500, (error as Error).message ?? "Could not save settings.");
  }
}
