/**
 * The rules profile operation.
 *
 * It reads and writes four toggles and a notes box, and reports which of them currently has nothing to act on. That
 * last part is the whole reason this is an operation rather than two fields on a screen: `neverRotateKeyPlayers` does
 * nothing at all until a player carries an importance marker, and a panel that stayed silent about it would let a
 * manager believe he was being protected when he was not.
 */
import { readProfile, saveProfile, togglesWithoutEffect } from "../review/profile";
import { RULES_TOGGLE_LABELS, type RulesToggleId } from "../review/types";
import { SquadService } from "../services/squad-service";
import { at, failed, ok, type OperationResult } from "./types";

const KEY_MARKERS = new Set(["UNTOUCHABLE", "KEY_PLAYER"]);

/** The toggles, with the one line each that says what they do. */
export const TOGGLE_COPY: Array<{ id: RulesToggleId; label: string; line: string }> = [
  {
    id: "keepFormationFamily",
    label: RULES_TOGGLE_LABELS.keepFormationFamily,
    line: "Any option that would change the family of shape is not offered. Same line counts, different suffix, is the same family.",
  },
  {
    id: "neverRotateKeyPlayers",
    label: RULES_TOGGLE_LABELS.neverRotateKeyPlayers,
    line: "An option that would rest or leave out a player you marked as key is not offered.",
  },
  {
    id: "fixedPointsBand",
    label: RULES_TOGGLE_LABELS.fixedPointsBand,
    line: "No option to set or adjust a points target is offered. You set the band and it stays.",
  },
  {
    id: "preferYouthMinutes",
    label: RULES_TOGGLE_LABELS.preferYouthMinutes,
    line: "An option that would leave a young player out for a match is not offered.",
  },
];

/** Reads the profile, its copy, and what it cannot act on yet. */
export async function readRulesProfile(careerId: string | null): Promise<OperationResult<unknown>> {
  try {
    if (!careerId) return at(400, { success: false, error: "careerId is required." });
    const [profile, squad] = await Promise.all([readProfile(careerId), new SquadService().getCurrentSquad(careerId)]);
    const keyPlayers = squad.filter((player) => {
      const marker = player.userProfile?.importanceMarker ?? null;
      return marker !== null && KEY_MARKERS.has(marker);
    }).length;

    return ok({
      success: true,
      profile,
      toggles: TOGGLE_COPY,
      keyPlayerCount: keyPlayers,
      idle: togglesWithoutEffect(profile, keyPlayers),
    });
  } catch (error) {
    console.error("[api/rules-profile] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your rules.");
  }
}

/**
 * Saves the profile.
 *
 * A toggle the request says nothing about keeps its current value, so two screens saving different toggles cannot
 * silently turn each other off. The notes are stored as text and read by nothing.
 */
export async function saveRulesProfile(rawBody: string): Promise<OperationResult<unknown>> {
  let body: { careerId?: string; toggles?: Record<string, unknown>; notes?: string | null };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    const careerId = body.careerId ?? "";
    if (careerId === "") return at(400, { success: false, error: "careerId is required." });
    const profile = await saveProfile(careerId, {
      toggles: (body.toggles ?? {}) as Partial<Record<RulesToggleId, unknown>>,
      notes: body.notes,
    });

    const squad = await new SquadService().getCurrentSquad(careerId);
    const keyPlayers = squad.filter((player) => {
      const marker = player.userProfile?.importanceMarker ?? null;
      return marker !== null && KEY_MARKERS.has(marker);
    }).length;

    return ok({
      success: true,
      profile,
      toggles: TOGGLE_COPY,
      keyPlayerCount: keyPlayers,
      idle: togglesWithoutEffect(profile, keyPlayers),
    });
  } catch (error) {
    console.error("[api/rules-profile] save failed:", error);
    return failed(500, (error as Error).message ?? "Could not save your rules.");
  }
}
