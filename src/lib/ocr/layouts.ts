/**
 * What a post match Match Facts screen looks like, as data.
 *
 * This module is the only place in the app that knows the shape of the screen the scanner reads. Adding a new
 * game version, a new stat group, or a spelling the OCR mangles is an edit HERE and nothing else: the row
 * banding, the label matcher, the number reader and the validator all work from these tables.
 *
 * WHERE THE KNOWLEDGE COMES FROM. Five captures in `references/match-stats/`: one clean FC25 capture
 * (1280x720) and one phone photo of an FC26 TV (800x1067), which between them are row for row identical and
 * therefore pin one profile, plus three FIFA17 to 19 crops. The older games are a different screen - no tab
 * bar, no expected goals, no passes, no saves - and are deliberately NOT described here. A legacy profile is a
 * second entry in `PROFILES` when anyone wants it, and nothing else in the codebase would change.
 *
 * THE TWO RULES THIS TABLE ENFORCES.
 *
 * 1. A row we have no field for gets `field: null`. It is still listed, because the label matcher needs it to
 *    recognise the screen, but a null bound row produces no observation, is never counted as missing, and is
 *    never reported as something the scanner failed to read. That is how "do not force the scanner to capture
 *    what a screen does not carry" is enforced in the data rather than in a conditional somewhere downstream.
 *
 *    Two of the app's five manual boxes, shots inside the box and big chances, are bound to no row at all,
 *    because no capture carries them. They stay manager entered figures. If a Shooting capture turns out to
 *    carry them, binding them is two lines in `SUMMARY_ROWS`.
 *
 * 2. Every row label here has been READ on a capture. Red Cards is not listed: both captures cut off above it,
 *    so its label is not evidenced, and inferring it from the Yellow Cards pairing is exactly the kind of
 *    guess this module exists to avoid. It arrives when the scrolled capture does.
 */

/**
 * The figures a row can feed.
 *
 * A named union rather than `keyof MatchStats`, so the payload's metadata keys (`capture`) and anything added
 * later cannot be bound to a row by accident. The Phase 2 group's field names join this union when that phase
 * binds them.
 */
export type StatFieldKey =
  | "shots"
  | "shotsInsideBox"
  | "bigChances"
  | "possession"
  | "passesCompleted"
  | "expectedGoalsReported";

/** One row of a stat table, as the label reads on screen, and the field it feeds. */
export interface RowLabel {
  /**
   * Every spelling seen on a capture, already lowercased. The matcher normalises further (case, punctuation,
   * spacing), so this is where genuine alternative wordings go rather than every mangling the OCR produces.
   */
  aliases: string[];
  /** The field to fill, or null when this row is on the screen and is not something we record. */
  field: StatFieldKey | null;
}

/**
 * Where each column sits, as a fraction of the TABLE's width, not the image's.
 *
 * Readonly tuples because a profile is a literal in this module and is never mutated: declaring them mutable
 * only forced every consumer to copy them before use.
 */
export interface Columns {
  left: readonly [number, number];
  label: readonly [number, number];
  right: readonly [number, number];
}

export interface StatGroup {
  id: string;
  /**
   * Words that appear only on this group's screen, used to tell the groups apart when a label match is
   * ambiguous. Empty means the group is identified by its labels alone.
   */
  signatures: string[];
  labels: RowLabel[];
  /**
   * True when the group is taller than the screen, so one capture cannot be complete and a second one at a
   * different scroll offset is a normal input rather than a failure. The Summary group is 20 rows; 15 fit.
   */
  scrolls: boolean;
}

export interface LayoutProfile {
  /** Stored in `matchStats.capture.layout`. Internal: never shown to the manager, never chosen by them. */
  id: string;
  /** For diagnostics and the harness report only. */
  versions: string[];
  /** The group tab bar, in screen order, as read on the captures. */
  groupTabs: string[];
  groups: StatGroup[];
  columns: Columns;
  /** Where the two club names sit, as a fraction of the image height, for the side cross-check. */
  headerBand: { top: number; bottom: number };
  /** What separates the rows, which is what the row banding looks for. */
  rowSeparators: "RULES" | "ZEBRA";
  /** Where the club names are, or `UNREADABLE` when a capture does not show them legibly. */
  clubNames: "HEADER" | "TABLE_HEADER" | "UNREADABLE";
}

/**
 * The Summary rows, in screen order, from the clean FC25 capture.
 *
 * The order is recorded because it is a fallback: when a label fails to match, the pipeline falls back to
 * reading the band at that position, which only works if the order is known.
 *
 * Five of these fifteen rows feed a field we record. The other ten are listed so the screen is recognised and
 * so a label match never lands on the wrong row, and they are skipped in silence.
 */
const SUMMARY_ROWS: RowLabel[] = [
  { aliases: ["possession %", "possession"], field: "possession" },
  { aliases: ["ball recovery time (seconds)", "ball recovery time", "ball recovery"], field: null },
  { aliases: ["shots"], field: "shots" },
  { aliases: ["expected goals", "expected goal"], field: "expectedGoalsReported" },
  { aliases: ["passes"], field: "passesCompleted" },
  { aliases: ["tackles"], field: null },
  { aliases: ["tackles won"], field: null },
  { aliases: ["interceptions"], field: null },
  { aliases: ["saves", "save"], field: null },
  { aliases: ["fouls committed", "fouls"], field: null },
  { aliases: ["offsides", "offside"], field: null },
  { aliases: ["corners", "corner"], field: null },
  { aliases: ["free kicks", "free kick"], field: null },
  { aliases: ["penalty kicks", "penalty kick", "penalties"], field: null },
  { aliases: ["yellow cards", "yellow card"], field: null },
];

const SUMMARY: StatGroup = {
  id: "SUMMARY",
  signatures: ["summary"],
  labels: SUMMARY_ROWS,
  scrolls: true,
};

/**
 * FC25 and later, as one profile.
 *
 * The columns are read off both captures, and the label band is deliberately wide. It was first set to the middle
 * half of the table and that CLIPPED the longest labels: on the clean capture `Ball Recovery Time (Seconds)` runs
 * from 0.32 to 0.86 of the table's width, so a band ending at 0.80 cut its last word and the leftover text then
 * competed with the short labels for a match. Values are narrow and right or left aligned, so they get the outer
 * eighth each and the middle carries the label.
 */
export const FC25_PLUS: LayoutProfile = {
  id: "fc25-plus",
  versions: ["fc25", "fc26"],
  groupTabs: ["Summary", "Possession", "Shooting", "Passing", "Defending", "Events"],
  groups: [SUMMARY],
  columns: { left: [0, 0.13], label: [0.18, 0.86], right: [0.87, 1] },
  headerBand: { top: 0.04, bottom: 0.12 },
  rowSeparators: "RULES",
  clubNames: "HEADER",
};

export const PROFILES: readonly LayoutProfile[] = [FC25_PLUS];

/** The profile to read with. One ships today; the signature is here for the one that comes next. */
export function defaultProfile(): LayoutProfile {
  return PROFILES[0];
}

export function profileById(id: string | null | undefined): LayoutProfile | null {
  if (!id) return null;
  return PROFILES.find((profile) => profile.id === id) ?? null;
}

export function groupById(profile: LayoutProfile, id: string | null | undefined): StatGroup | null {
  if (!id) return null;
  return profile.groups.find((group) => group.id === id) ?? null;
}

/**
 * A label reduced to what the matcher compares on.
 *
 * Lowercase, alphanumerics only, single spaced. So `Possession %`, `POSSESSION` and `Possession%` are one key,
 * and the parenthetical in `Ball Recovery Time (Seconds)` does not have to be typed into every alias.
 */
export function normaliseLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Every alias in a group, normalised, paired with the row it belongs to. */
export function aliasIndex(group: StatGroup): Array<{ key: string; row: RowLabel }> {
  const index: Array<{ key: string; row: RowLabel }> = [];
  for (const row of group.labels) {
    for (const alias of row.aliases) index.push({ key: normaliseLabel(alias), row });
  }
  return index;
}

/** The bound rows of a group: the ones that can produce a value. Null bounded rows are excluded. */
export function boundRows(group: StatGroup): RowLabel[] {
  return group.labels.filter((row) => row.field !== null);
}
