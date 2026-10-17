/**
 * The match figures a debrief records, as the form holds them.
 *
 * One module because three places need the same list and the same rules: the panel's manual boxes, the
 * screenshot pane that fills those boxes, and the draft the form persists between visits. When the two panes
 * each carried their own copy, adding a figure meant finding every copy, and the one that was missed is the
 * one that silently drops a scanned value on the next edit and save.
 *
 * The draft holds TEXT rather than numbers all the way to submit, because an empty box and a box holding
 * zero are different things and only the text can tell them apart. Validation happens once, on the server,
 * in `events/match-stats`.
 */

import { MATCH_STAT_LIMITS } from "../events/match-stats";
import { EXPECTED_GOALS_PLACES } from "./format";

/**
 * Every figure the form can carry, in the order the panel shows them.
 *
 * These five are the game's own Match Facts Summary figures, which is what makes them enterable: the manager
 * reads them off one screen rather than counting anything. Expected goals is among them for that reason. It
 * used to be scan-only, on the argument that nobody can count expected goals, and that argument was right about
 * counting and wrong about reading: the game prints the figure, so the manager can type it.
 */
export type MatchStatKey =
  | "shots"
  | "shotsInsideBox"
  | "expectedGoalsReported"
  | "possession"
  | "passesCompleted";

/** Every key, in panel order. */
export const MATCH_STAT_KEYS: readonly MatchStatKey[] = [
  "shots",
  "shotsInsideBox",
  "expectedGoalsReported",
  "possession",
  "passesCompleted",
];

/** The draft shape: text per figure, empty meaning nothing was entered. */
export type MatchStatDraft = Record<MatchStatKey, string>;

export const EMPTY_MATCH_STATS: MatchStatDraft = {
  shots: "",
  shotsInsideBox: "",
  expectedGoalsReported: "",
  possession: "",
  passesCompleted: "",
};

/** Which of the draft's figures the manager can type into, and what to count for each. */
export const MANUAL_STAT_FIELDS: ReadonlyArray<{ key: MatchStatKey; hint: string }> = [
  { key: "shots", hint: "Every shot, including the ones blocked or off target." },
  { key: "shotsInsideBox", hint: "Shots taken from inside the penalty area." },
  {
    key: "expectedGoalsReported",
    hint: "The game's own figure, and optional. Pause menu, Match Facts, Summary, the Expected Goals row, then your side's number.",
  },
  { key: "possession", hint: "Your share of the ball, 0 to 100." },
  { key: "passesCompleted", hint: "Passes you completed." },
];

/**
 * The box a figure lives in.
 *
 * One string shared by the manual pane and the screenshot pane, because the figures move between the two and a
 * scanned value that changed appearance when it landed would read as a different kind of value. The manual
 * pane's markup is otherwise untouched by the scanner.
 */
export const STAT_BOX_CLASS =
  "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white text-center font-sub text-sm font-bold tabular-nums text-slate-900 placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600";

/** Where a figure's current text came from. "NONE" is an empty box. */
export type StatSource = "NONE" | "SCAN" | "EDITED";

/** The sources of every figure, all empty boxes to begin with. */
export function emptySources(): Record<MatchStatKey, StatSource> {
  return {
    shots: "NONE",
    shotsInsideBox: "NONE",
    expectedGoalsReported: "NONE",
    possession: "NONE",
    passesCompleted: "NONE",
  };
}

/**
 * A box's text as a number, or null when it is empty or not a number.
 *
 * Never turns blank into zero: a keeper who made no saves is a different claim from one nobody counted.
 */
export function statNumberOf(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when any figure holds something. */
export function hasAnyMatchStat(stats: Partial<MatchStatDraft> | null | undefined): boolean {
  if (!stats) return false;
  return Object.values(stats).some((value) => typeof value === "string" && value.trim() !== "");
}

/** A stored figure as box text. Absent is an empty box, not a zero. */
export function toStatText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A whole number as text, or "", for the boxes that only accept integers.
 *
 * Guards the paste case: the boxes strip what they cannot use while typing, but a pasted string never passes
 * through an input event per character.
 */
export function sanitiseCount(value: string, maxLength = 4): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

/**
 * A decimal as text, or "".
 *
 * Separate from `sanitiseCount` because exactly one figure in the panel is genuinely a decimal, and letting a
 * dot into the others would let a manager type a shot count of "4.0" that the server then truncates without
 * saying so.
 */
export function sanitiseDecimal(value: string, places = 2, maxLength = 5): string {
  // A comma is a decimal point on most of the keyboards this app is used from, and the game's own figure is
  // printed with a dot. Both are read as the same separator rather than dropping the keypress.
  const normalised = value.replace(",", ".");
  const digitsOnly = normalised.replace(/[^\d.]/g, "");
  const firstDot = digitsOnly.indexOf(".");
  if (firstDot === -1) return digitsOnly.slice(0, maxLength);
  const whole = digitsOnly.slice(0, firstDot);
  const fraction = digitsOnly.slice(firstDot + 1).replace(/\./g, "").slice(0, places);
  // A trailing dot is left in place while it is being typed: "0." is a half typed "0.8", and stripping it
  // would swallow the keystroke.
  return `${whole}.${fraction}`;
}

/**
 * The game's own expected goals, as box text.
 *
 * One decimal place, because that is the precision the game prints and a second one would be a figure the
 * manager never saw. The ceiling is applied here as well as on the server so a typed "12" is refused at the
 * keystroke rather than accepted and then silently dropped on save; `previous` is what the box held a moment
 * ago, which is what a refused keystroke falls back to.
 */
export function sanitiseExpectedGoals(value: string, previous: string): string {
  const cleaned = sanitiseDecimal(value, EXPECTED_GOALS_PLACES, 4);
  const parsed = Number(cleaned);
  if (cleaned !== "" && Number.isFinite(parsed) && parsed > MATCH_STAT_LIMITS.expectedGoalsReported) {
    return previous;
  }
  return cleaned;
}
