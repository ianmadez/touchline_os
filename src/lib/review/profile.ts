/**
 * The rules profile: four toggles and a notes box, one row per career.
 *
 * WHY THE DEFAULTS ARE ALL OFF. A toggle only ever REMOVES an option from a review, so an untouched profile offers
 * everything and every restriction on the screen is one the manager set. A safety-on default would quietly narrow his
 * advice before he had said a word.
 *
 * THE NOTES ARE NEVER READ BY CODE. They are a place to think, and `test-rules-profile` asserts the review output is
 * identical with and without them. The moment the engine parsed them, the advice would depend on wording rather than
 * on state.
 */
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { rulesProfiles } from "../db/schema";
import { DEFAULT_RULES_PROFILE, type RulesProfile, type RulesToggleId } from "./types";

const TOGGLES: RulesToggleId[] = [
  "keepFormationFamily",
  "neverRotateKeyPlayers",
  "fixedPointsBand",
  "preferYouthMinutes",
];

/** A stored blob, checked. Unknown keys are dropped rather than kept as debris. */
function fromStored(raw: string | null, notes: string | null): RulesProfile {
  const toggles = { ...DEFAULT_RULES_PROFILE.toggles };
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        for (const toggle of TOGGLES) {
          const value = (parsed as Record<string, unknown>)[toggle];
          if (typeof value === "boolean") toggles[toggle] = value;
        }
      }
    } catch {
      /* an unreadable blob means the defaults, which block nothing */
    }
  }
  return { toggles, notes };
}

/** The profile for a career, or the defaults when nothing has been saved. */
export async function readProfile(careerId: string): Promise<RulesProfile> {
  const row = await db.select().from(rulesProfiles).where(eq(rulesProfiles.careerId, careerId)).get();
  if (!row) return { toggles: { ...DEFAULT_RULES_PROFILE.toggles }, notes: null };
  return fromStored(row.togglesJson, row.notes);
}

/** Saves the profile. A full replace rather than a patch, because a toggle turned off is a decision too. */
export async function saveProfile(
  careerId: string,
  input: { toggles?: Partial<Record<RulesToggleId, unknown>>; notes?: string | null }
): Promise<RulesProfile> {
  const current = await readProfile(careerId);
  const toggles = { ...current.toggles };
  for (const toggle of TOGGLES) {
    const value = input.toggles?.[toggle];
    if (typeof value === "boolean") toggles[toggle] = value;
  }
  const notes = input.notes === undefined ? current.notes : input.notes;
  const stamp = new Date().toISOString();
  const existing = await db.select().from(rulesProfiles).where(eq(rulesProfiles.careerId, careerId)).get();

  if (existing) {
    await db
      .update(rulesProfiles)
      .set({ togglesJson: JSON.stringify(toggles), notes, updatedAt: stamp })
      .where(eq(rulesProfiles.careerId, careerId));
  } else {
    await db.insert(rulesProfiles).values({
      id: `rules_${careerId}`,
      careerId,
      togglesJson: JSON.stringify(toggles),
      notes,
      updatedAt: stamp,
    });
  }
  return { toggles, notes };
}

/**
 * The toggles that have nothing to act on in this career.
 *
 * Only one can: `neverRotateKeyPlayers` needs a player marked as key or untouchable. The panel says so rather than
 * letting a manager believe a toggle is protecting something when no player carries the marker.
 */
export function togglesWithoutEffect(profile: RulesProfile, keyPlayerCount: number): RulesToggleId[] {
  if (profile.toggles.neverRotateKeyPlayers && keyPlayerCount === 0) return ["neverRotateKeyPlayers"];
  return [];
}
