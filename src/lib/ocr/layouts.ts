/**
 * What a post match Match Facts screen looks like, as data.
 *
 * This module is the only place in the app that knows the shape of the screens the scanner reads. Adding a game
 * version, a screen, or a spelling the OCR mangles is an edit HERE and nothing else: the row banding, the label
 * matcher, the number reader and the checks all work from these tables.
 *
 * FOUR SCREENS, ONE TABLE EACH. A screen is a list of SECTIONS and a section is a list of rows, and every row
 * carries the key its figure is stored under. The Summary screen has been measured against real captures. The
 * other three are written from the captures the manager transcribed, and ship DISABLED until their own captures
 * prove every required row and every check: a screen nobody has measured fills boxes with figures nobody has
 * looked at. See `enabled` on each screen.
 *
 * LABELS RESOLVE INSIDE THE CLASSIFIED SCREEN AND ITS SECTION. "Set Pieces" is a row on both Shooting and
 * Passing, and "Interceptions", "Saves" and "Yellow Cards" are rows on both Summary and Defending, so the screen
 * is what keeps those apart, and it is decided by CONTENT rather than by the tab bar: six words in small type,
 * where one misread letter would move the read onto another screen's rows. Within a screen the section is tried
 * first and the rest of the screen is the fallback, so a misread section heading cannot cost a row its figure.
 *
 * WHAT IS NOT READ. Possession and Events are not described at all: no capture of either has been supplied, and
 * a screen described from imagination is a screen that claims figures nobody has looked at. The defensive line
 * break counts are left out for the same reason.
 *
 * The row ORDER is recorded because it is a fallback: when a label fails to match, the pipeline can still read
 * the band at that position, which only works if the order is known.
 */

/**
 * The stored keys, screen by screen.
 *
 * These ARE the keys the manager's own transcription uses, so what is read off a screen and what is stored are
 * the same names all the way through: a group of facts reads as the screen reads.
 */
export type SummaryKey =
  | "possessionPct"
  | "ballRecoverySeconds"
  | "shots"
  | "expectedGoals"
  | "passes"
  | "tackles"
  | "tacklesWon"
  | "interceptions"
  | "saves"
  | "foulsCommitted"
  | "offsides"
  | "corners"
  | "freeKicks"
  | "penaltyKicks"
  | "yellowCards"
  | "redCards";

export type ShootingKey =
  | "totalShots"
  | "onTarget"
  | "offTarget"
  | "blocked"
  | "normal"
  | "finesse"
  | "header"
  | "power"
  | "volley"
  | "chip"
  | "setPieces"
  | "insideBox"
  | "outsideBox"
  | "nearSide"
  | "farSide";

export type PassingKey =
  | "totalPasses"
  | "completed"
  | "intercepted"
  | "offside"
  | "other"
  | "ground"
  | "lob"
  | "through"
  | "lobbedThrough"
  | "cross"
  | "setPieces"
  | "keyPass"
  | "firstTime"
  | "passAndGo"
  | "downWing"
  | "breakaway";

export type DefendingKey =
  | "standingTackles"
  | "standingTacklesWon"
  | "slidingTackles"
  | "slidingTacklesWon"
  | "interceptions"
  | "blocks"
  | "saves"
  | "clearances"
  | "offensiveDuelsWon"
  | "defensiveDuelsWon"
  | "aerialDuelsWon"
  | "beatenByOpponent"
  | "foulsCommitted"
  | "penaltiesCommitted"
  | "yellowCards"
  | "redCards";

/** The four screens the Match Facts pages carry that this app has any business reading. */
export type ScreenId = "SUMMARY" | "SHOOTING" | "PASSING" | "DEFENDING";

export type FactKey = SummaryKey | ShootingKey | PassingKey | DefendingKey;

/** One row of a screen, as the label reads on it, and the key the figure is stored under. */
export interface FactRow {
  /**
   * Every spelling seen on a capture, already lowercased. The matcher normalises further (case, punctuation,
   * spacing), so this is where genuine alternative wordings go rather than every mangling the OCR produces.
   */
  aliases: string[];
  /** The key this row is stored under, or null for a row listed only to recognise the screen. */
  key: FactKey | null;
  /**
   * True when the row is visible without scrolling.
   *
   * A group is stored all or nothing, and this is the line: every required row read, or none of the screen is
   * kept. Half a screen is a set of figures with no way to tell which half is missing, and the sums above it
   * would decide the truth of a group without saying so.
   */
  required: boolean;
  /** True for the two figures the screen prints with a decimal. */
  decimal?: boolean;
}

/** A run of rows under one heading. The heading is tracked so a label can be resolved inside its section. */
export interface FactSection {
  /**
   * The heading as it reads on screen, lowercased, or "" for rows that sit under no evidenced heading.
   *
   * An empty heading is deliberately not matched: a section whose heading nobody has read yet still resolves its
   * rows through the whole screen, where the fallback is, rather than through a heading invented to look tidy.
   */
  heading: string;
  rows: FactRow[];
}

export interface FactScreen {
  id: ScreenId;
  /** How the screen is named in a sentence to the manager. */
  label: string;
  /** Words that appear only on this screen, which is how it is told apart from the others. */
  signatures: string[];
  sections: FactSection[];
  /** True when the screen is taller than a capture, so a second one at another offset is normal input. */
  scrolls: boolean;
  /** False means the scanner does not read this screen at all. */
  enabled: boolean;
  /** One line on why a screen is disabled. Null when it is enabled. */
  disabledBecause: string | null;
  /**
   * Column overrides for this screen, as fractions of the table rather than of the image.
   *
   * Only Shooting needs one, and the reason is the goals count. That screen draws a small ball and a goal tally
   * between the label and the value, which lands inside a label band wide enough for the longest Summary label and
   * turns "Normal" into "Normal 1". Pulling the label band back and letting the right column own everything from
   * the goals count outwards is what keeps the label clean while the outer-number rule still finds the stat.
   */
  columns?: { label?: readonly [number, number]; right?: readonly [number, number] };
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

export interface LayoutProfile {
  /** Stored in `matchStats.capture.layout`. Internal: never shown to the manager, never chosen by them. */
  id: string;
  /** For diagnostics and the harness report only. */
  versions: string[];
  /** The group tab bar, in screen order, as read on the captures. */
  groupTabs: string[];
  /** Every screen this profile knows, in tab order. Disabled ones are described but not read. */
  screens: FactScreen[];
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
 * Fifteen of these are visible without scrolling, which is what makes them required. Red Cards sits below the
 * fold: it is stored whenever it is on the capture and never counted as missing, because a screen that scrolls
 * is not a screen that failed.
 *
 * The four defensive line break counts sit under Red Cards and are NOT listed: no capture of them has been
 * supplied, so nothing here claims to read them.
 */
const SUMMARY_ROWS: FactRow[] = [
  { aliases: ["possession %", "possession"], key: "possessionPct", required: true },
  { aliases: ["ball recovery time (seconds)", "ball recovery time", "ball recovery"], key: "ballRecoverySeconds", required: true, decimal: true },
  { aliases: ["shots"], key: "shots", required: true },
  { aliases: ["expected goals", "expected goal"], key: "expectedGoals", required: true, decimal: true },
  { aliases: ["passes"], key: "passes", required: true },
  { aliases: ["tackles"], key: "tackles", required: true },
  { aliases: ["tackles won"], key: "tacklesWon", required: true },
  { aliases: ["interceptions"], key: "interceptions", required: true },
  { aliases: ["saves", "save"], key: "saves", required: true },
  { aliases: ["fouls committed", "fouls"], key: "foulsCommitted", required: true },
  { aliases: ["offsides", "offside"], key: "offsides", required: true },
  { aliases: ["corners", "corner"], key: "corners", required: true },
  { aliases: ["free kicks", "free kick"], key: "freeKicks", required: true },
  { aliases: ["penalty kicks", "penalty kick", "penalties"], key: "penaltyKicks", required: true },
  { aliases: ["yellow cards", "yellow card"], key: "yellowCards", required: true },
  { aliases: ["red cards", "red card"], key: "redCards", required: false },
];

/**
 * The Shooting rows, in the order the manager transcribed them.
 *
 * The four shot-accuracy rows sit under the first heading the manager read on this screen, "Shot Type", because
 * that is the only section heading evidenced on it before the type rows begin. If a capture shows them under a
 * heading of their own the row list does not change: matching falls back to the whole screen, so a heading is
 * only ever used to tell two same-named rows apart.
 */
const SHOOTING_ROWS: FactRow[] = [
  { aliases: ["total shots", "shots"], key: "totalShots", required: true },
  { aliases: ["on target"], key: "onTarget", required: true },
  { aliases: ["off target"], key: "offTarget", required: true },
  { aliases: ["blocked"], key: "blocked", required: true },
  { aliases: ["normal"], key: "normal", required: true },
  { aliases: ["finesse"], key: "finesse", required: true },
  { aliases: ["header", "headed"], key: "header", required: true },
  { aliases: ["power"], key: "power", required: true },
  { aliases: ["volley"], key: "volley", required: true },
  { aliases: ["chip"], key: "chip", required: true },
  { aliases: ["set pieces", "set piece"], key: "setPieces", required: true },
  { aliases: ["inside the box", "inside box"], key: "insideBox", required: true },
  { aliases: ["outside the box", "outside box"], key: "outsideBox", required: true },
  { aliases: ["near side", "nearside"], key: "nearSide", required: true },
  { aliases: ["far side", "farside"], key: "farSide", required: true },
];

/**
 * The Passing rows.
 *
 * "Set Pieces" appears here and on Shooting: the screens are told apart by content, so the same label resolves
 * to two different keys and neither read can land on the other's row.
 */
const PASSING_ROWS: FactRow[] = [
  { aliases: ["total passes", "passes"], key: "totalPasses", required: true },
  { aliases: ["completed", "completed passes"], key: "completed", required: true },
  { aliases: ["intercepted"], key: "intercepted", required: true },
  { aliases: ["offside", "offsides"], key: "offside", required: true },
  { aliases: ["other"], key: "other", required: true },
  { aliases: ["ground", "ground passes"], key: "ground", required: true },
  { aliases: ["lob", "lobbed"], key: "lob", required: true },
  { aliases: ["through", "through balls"], key: "through", required: true },
  { aliases: ["lobbed through", "lobbed through balls"], key: "lobbedThrough", required: true },
  { aliases: ["cross", "crosses"], key: "cross", required: true },
  { aliases: ["set pieces", "set piece"], key: "setPieces", required: true },
  { aliases: ["key pass", "key passes"], key: "keyPass", required: true },
  { aliases: ["first time", "first time passes"], key: "firstTime", required: true },
  { aliases: ["pass and go", "pass and move"], key: "passAndGo", required: true },
  { aliases: ["down wing", "down the wing"], key: "downWing", required: true },
  { aliases: ["breakaway", "breakaways"], key: "breakaway", required: true },
];

/** The Defending rows, with the disciplinary ones under the one heading the manager read: Infractions. */
const DEFENDING_ROWS: FactRow[] = [
  { aliases: ["standing tackles"], key: "standingTackles", required: true },
  { aliases: ["standing tackles won"], key: "standingTacklesWon", required: true },
  { aliases: ["sliding tackles"], key: "slidingTackles", required: true },
  { aliases: ["sliding tackles won"], key: "slidingTacklesWon", required: true },
  { aliases: ["interceptions"], key: "interceptions", required: true },
  { aliases: ["blocks", "blocked"], key: "blocks", required: true },
  { aliases: ["saves", "save"], key: "saves", required: true },
  { aliases: ["clearances", "clearance"], key: "clearances", required: true },
  { aliases: ["offensive duels won"], key: "offensiveDuelsWon", required: true },
  { aliases: ["defensive duels won"], key: "defensiveDuelsWon", required: true },
  { aliases: ["aerial duels won"], key: "aerialDuelsWon", required: true },
  { aliases: ["beaten by opponent", "beaten by opponents"], key: "beatenByOpponent", required: true },
];

const DEFENDING_INFRACTIONS: FactRow[] = [
  { aliases: ["fouls committed", "fouls"], key: "foulsCommitted", required: true },
  { aliases: ["penalties committed", "penalties conceded"], key: "penaltiesCommitted", required: true },
  { aliases: ["yellow cards", "yellow card"], key: "yellowCards", required: true },
  { aliases: ["red cards", "red card"], key: "redCards", required: true },
];

/**
 * The screens, in tab order.
 *
 * SUMMARY is enabled because two captures of it have been measured and pass. The other three are DISABLED with
 * the reason on the data, because the captures they would be proved against have not been supplied. Nothing
 * reads them until they are, which is the difference between a feature that is waiting for evidence and one that
 * fills a box from a screen nobody has looked at.
 */
export const SCREENS: readonly FactScreen[] = [
  {
    id: "SUMMARY",
    label: "Summary",
    // No heading of its own: the screen opens on the Possession % row, which is what identifies it.
    signatures: [],
    sections: [{ heading: "", rows: SUMMARY_ROWS }],
    scrolls: true,
    // On, because this screen is what fills the five boxes. Its FACTS group still refuses on every golden capture
    // (three rows unread on each of the two clean ones, twelve on the photo), and the all-or-nothing rule means
    // nothing from it is stored: the boxes are filled from the read, the facts are not kept until every required
    // row and the possession sum hold.
    enabled: true,
    disabledBecause: null,
  },
  {
    id: "SHOOTING",
    label: "Shooting",
    signatures: ["overall shooting", "shooting"],
    sections: [
      { heading: "shot type", rows: SHOOTING_ROWS.slice(0, 11) },
      { heading: "distance", rows: SHOOTING_ROWS.slice(11, 13) },
      { heading: "aim", rows: SHOOTING_ROWS.slice(13) },
    ],
    scrolls: false,
    // Off on the Wigan capture: four shot-type rows that stand at 0 on our side (Header, Power, Volley, Chip) are
    // not read at all, so three of the seven type rows are missing and the sums cannot be checked.
    enabled: false,
    disabledBecause:
      "rows standing at 0 on our side were not read, so the shot type sum cannot be verified",
    columns: { label: [0.18, 0.68], right: [0.68, 1] },
  },
  {
    id: "PASSING",
    label: "Passing",
    signatures: ["overall passing", "passing"],
    sections: [
      { heading: "pass type", rows: PASSING_ROWS.slice(0, 12) },
      { heading: "style", rows: PASSING_ROWS.slice(12) },
    ],
    scrolls: false,
    // Off on the Wigan capture: Pass and Go reads 0 on both sides and was not read at all, and one row missing is
    // enough to fail the all-or-nothing rule.
    enabled: false,
    disabledBecause:
      "the Pass and Go row, 0 on both sides, was not read, so the screen cannot be stored whole",
  },
  {
    id: "DEFENDING",
    label: "Defending",
    signatures: ["overall defending", "defending"],
    sections: [
      { heading: "", rows: DEFENDING_ROWS },
      { heading: "infractions", rows: DEFENDING_INFRACTIONS },
    ],
    scrolls: false,
    // Off on the Wigan capture: three rows standing at 0 were not read, which is the same zero-glyph failure the
    // other two screens show.
    enabled: false,
    disabledBecause:
      "rows standing at 0 were not read, so the screen cannot be stored whole",
  },
];

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
  screens: [...SCREENS],
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

export function screenById(profile: LayoutProfile, id: string | null | undefined): FactScreen | null {
  if (!id) return null;
  return profile.screens.find((screen) => screen.id === id) ?? null;
}

/** The screens the scanner will actually read, in tab order. */
export function readableScreens(profile: LayoutProfile): FactScreen[] {
  return profile.screens.filter((screen) => screen.enabled);
}

/** Every row of a screen, in screen order, flattened across its sections. */
export function screenRows(screen: FactScreen): FactRow[] {
  return screen.sections.flatMap((section) => section.rows);
}

/** The rows a group cannot be stored without, which are the ones a capture shows without scrolling. */
export function requiredRows(screen: FactScreen): FactRow[] {
  return screenRows(screen).filter((row) => row.required && row.key !== null);
}

  /**
   * The columns a screen is read with: its own overrides, or the profile's.
   *
   * A screen can pull the label band back so a goals count beside the label stops becoming part of it, while the
   * outer-number rule still reads the stat from the value column.
   */
export function columnsFor(profile: LayoutProfile, screen: FactScreen): Columns {
  if (screen.columns === undefined) return profile.columns;
  return {
    left: profile.columns.left,
    label: screen.columns.label ?? profile.columns.label,
    right: screen.columns.right ?? profile.columns.right,
  };
}

/** The rows that carry a stored key at all. */
export function storedRows(screen: FactScreen): FactRow[] {
  return screenRows(screen).filter((row) => row.key !== null);
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

/** Every alias of a set of rows, normalised, paired with the row it belongs to. */
export function aliasIndexFor(rows: readonly FactRow[]): Array<{ key: string; row: FactRow }> {
  const index: Array<{ key: string; row: FactRow }> = [];
  for (const row of rows) {
    for (const alias of row.aliases) index.push({ key: normaliseLabel(alias), row });
  }
  return index;
}

/** Every alias in a screen, across its sections. */
export function aliasIndex(screen: FactScreen): Array<{ key: string; row: FactRow }> {
  return aliasIndexFor(screenRows(screen));
}

/** The normalised headings of a screen, for tracking which section a band sits in. */
export function sectionHeadings(screen: FactScreen): string[] {
  return screen.sections.map((section) => normaliseLabel(section.heading)).filter((heading) => heading !== "");
}
