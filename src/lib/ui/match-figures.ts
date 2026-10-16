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

/**
 * Every figure the form can carry, in the order the panel shows them.
 *
 * The game's own expected goals is here and is deliberately NOT one of the manual boxes: a manager cannot
 * count it, so it only ever arrives from a screenshot. It rides in the same draft so it persists with the
 * other figures and survives an edit, rather than living in a second piece of state that the draft writer
 * and `startEditDebrief` would both have to remember.
 */
export type MatchStatKey =
  | "shots"
  | "shotsInsideBox"
  | "bigChances"
  | "possession"
  | "passesCompleted"
  | "expectedGoalsReported";

/** Every key, in panel order. */
export const MATCH_STAT_KEYS: readonly MatchStatKey[] = [
  "shots",
  "shotsInsideBox",
  "bigChances",
  "possession",
  "passesCompleted",
  "expectedGoalsReported",
];

/** The draft shape: text per figure, empty meaning nothing was entered. */
export type MatchStatDraft = Record<MatchStatKey, string>;

export const EMPTY_MATCH_STATS: MatchStatDraft = {
  shots: "",
  shotsInsideBox: "",
  bigChances: "",
  possession: "",
  passesCompleted: "",
  expectedGoalsReported: "",
};

/** Which of the draft's figures the manager can type into, and what to count for each. */
export const MANUAL_STAT_FIELDS: ReadonlyArray<{ key: MatchStatKey; hint: string }> = [
  { key: "shots", hint: "Every shot, including the ones blocked or off target." },
  { key: "shotsInsideBox", hint: "Shots taken from inside the penalty area." },
  { key: "bigChances", hint: "Chances you would have expected to be scored." },
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
    bigChances: "NONE",
    possession: "NONE",
    passesCompleted: "NONE",
    expectedGoalsReported: "NONE",
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
  const digitsOnly = value.replace(/[^\d.]/g, "");
  const firstDot = digitsOnly.indexOf(".");
  if (firstDot === -1) return digitsOnly.slice(0, maxLength);
  const whole = digitsOnly.slice(0, firstDot);
  const fraction = digitsOnly.slice(firstDot + 1).replace(/\./g, "").slice(0, places);
  // A trailing dot is left in place while it is being typed: "0." is a half typed "0.8", and stripping it
  // would swallow the keystroke.
  return `${whole}.${fraction}`;
}
