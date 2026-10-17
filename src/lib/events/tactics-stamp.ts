/**
 * The shape a match was played in, as a stamp on the record.
 *
 * WHY A STAMP AND NOT A JOIN. A debrief is a report of one match, and the formation at the time is part of what
 * the manager reported. Reading it back later from the Tactics tab would be reading TODAY'S formation and calling
 * it the one that played, which is a claim the data cannot support: the manager may have changed shape twice since.
 * So the label and the registry shape are written into the payload at the moment of the report, and nothing
 * recomputes them.
 *
 * ABSENT MEANS NOT RECORDED. A debrief logged before this existed has no stamp, and that is a different claim from
 * "he played no formation". Every reader treats a missing stamp as unknown, and the review counts those matches as
 * matches without a formation rather than dropping them or inventing one.
 */

import { FORMATIONS_REGISTRY } from "../tactics/formations";

/** The registry shape a stamp refers to, or the label only when the registry cannot resolve it. */
export interface FormationStamp {
  /** The manager's own name for the formation, which is what keys a row in the Tactics tab. */
  label: string;
  /** The registry id of the shape, e.g. `4-3-3-holding`. Empty when the label no longer resolves. */
  formationName: string;
  /**
   * How the stamp got here. DEFAULT is the formation the Tactics tab marks as current at the moment of the
   * report; OVERRIDE is a formation the manager picked on this match, which is the common case for a one-off.
   */
  source: "DEFAULT" | "OVERRIDE";
}

/** What the form offers for a stamp: every saved formation, the default first. */
export interface FormationChoice {
  label: string;
  formationName: string;
  isDefault: boolean;
}

/**
 * The line counts without the suffix, which is the one definition of a formation family.
 *
 * THE RULE. Take the leading hyphen-separated segments of the registry id that are purely numeric, and stop at the
 * first one that is not. So `4-3-3-holding` and `4-3-3-attack` are both in the `4-3-3` family, `4-2-3-1-narrow`
 * is `4-2-3-1`, and `5-4-1-flat` is `5-4-1`. A shape with no suffix is its own family.
 *
 * WHY THE LEADING RUN RATHER THAN "EVERYTHING BEFORE THE LAST HYPHEN". Some ids end in a number that belongs to the
 * shape (`4-1-2-1-2`), so trimming the last segment would turn two different shapes into one family. The numeric
 * prefix has one meaning and one implementation, and the rules profile uses it to decide whether an option changes
 * the family at all.
 */
export function formationFamily(formationName: string | null | undefined): string | null {
  if (formationName === null || formationName === undefined) return null;
  const segments = formationName.trim().toLowerCase().split("-").filter((segment) => segment !== "");
  const leading: string[] = [];
  for (const segment of segments) {
    if (!/^\d+$/.test(segment)) break;
    leading.push(segment);
  }
  return leading.length === 0 ? null : leading.join("-");
}

/** True when two shapes belong to the same family. Unknown on either side is never "the same". */
export function sameFormationFamily(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const a = formationFamily(left);
  const b = formationFamily(right);
  return a !== null && b !== null && a === b;
}

/**
 * The stamp a report gets when the manager does not override it.
 *
 * `defaultChoice` is the Tactics tab's current formation, which is the only thing that can honestly fill this in
 * without asking. No default means no stamp: a made-up 4-3-3 in a career the manager never opened Tactics in would
 * be the app inventing a tactical fact, and the review has a column for "no formation recorded" precisely so this
 * case can be stated rather than guessed.
 */
export function stampFor(
  defaultChoice: FormationChoice | null,
  override: FormationChoice | null
): FormationStamp | null {
  const choice = override ?? defaultChoice;
  if (choice === null) return null;
  const label = choice.label.trim();
  if (label === "") return null;
  return {
    label,
    formationName: choice.formationName,
    source: override === null ? "DEFAULT" : "OVERRIDE",
  };
}

/**
 * A stored stamp, checked.
 *
 * The payload is text the browser sent, so it is validated like every other field: a stamp with no label is
 * dropped, an unknown source becomes DEFAULT, and an unknown formation name is kept as text rather than resolved,
 * because the label is the manager's and losing it would lose the one thing a stamp is for.
 */
export function normaliseFormationStamp(raw: unknown): FormationStamp | null {
  if (raw === null || typeof raw !== "object") return null;
  const input = raw as { label?: unknown; formationName?: unknown; source?: unknown };
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label === "") return null;
  const formationName = typeof input.formationName === "string" ? input.formationName.trim() : "";
  return {
    label,
    formationName,
    source: input.source === "OVERRIDE" ? "OVERRIDE" : "DEFAULT",
  };
}

/**
 * The select value that means "whatever the Tactics tab calls current", and the one that means "not recorded".
 *
 * Both are sentinels rather than a label, because a manager may name a formation "Not recorded" and the two
 * meanings must not collide. A form stores one of these or a formation label.
 */
export const FORMATION_USE_DEFAULT = "DEFAULT";
export const FORMATION_NOT_RECORDED = "NONE";

/** The formation the Tactics tab marks as current, which is what an unset select falls back to. */
export function defaultFormationChoice(formations: FormationChoice[]): FormationChoice | null {
  return formations.find((choice) => choice.isDefault) ?? formations[0] ?? null;
}

/**
 * The stamp a select value stands for.
 *
 * The default resolves against the Tactics tab at the moment of the report, so the stamp records what the
 * manager was playing rather than a pointer that would read differently after his next change. A label the
 * Tactics tab no longer offers is still honoured: the manager picked it on this match, and the label is his.
 */
export function stampForSelection(
  formations: FormationChoice[],
  value: string
): FormationStamp | null {
  if (value === FORMATION_NOT_RECORDED) return null;
  const fallback = defaultFormationChoice(formations);
  if (value === FORMATION_USE_DEFAULT) return stampFor(fallback, null);
  const picked = formations.find((choice) => choice.label === value);
  return stampFor(fallback, picked ?? { label: value, formationName: "", isDefault: false });
}

/** The select value a stored stamp reads back as. */
export function selectionForStamp(stamp: FormationStamp | null): string {
  return stamp === null ? FORMATION_NOT_RECORDED : stamp.label;
}

/** Registry names by id, so a stamp with a deleted shape falls back to its own label rather than a wrong one. */
const REGISTRY_NAMES = new Map(FORMATIONS_REGISTRY.map((shape) => [shape.id, shape.name]));

/**
 * The registry name for a shape id, or null when the registry has never heard of it.
 *
 * Null rather than the id itself: a picker that prints `4-1-3-2-x` is showing a storage key, and a caller that has
 * a label to fall back on should use it.
 */
export function formationShapeName(formationName: string): string | null {
  return REGISTRY_NAMES.get(formationName) ?? null;
}

/**
 * A stamp as a line of text for the screen: the shape, and the manager's own name for it when they differ.
 *
 * The shape is the part another manager would recognise, so it leads; the label is what the row in the Tactics
 * tab is called, and dropping it would leave the manager unable to find the formation the match was played in.
 */
export function formationDisplayName(stamp: FormationStamp): string {
  const shape = formationShapeName(stamp.formationName) ?? (stamp.formationName.trim() || null);
  if (shape === null) return stamp.label;
  return shape.toLowerCase() === stamp.label.toLowerCase() ? shape : `${shape} (${stamp.label})`;
}
