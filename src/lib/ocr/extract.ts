/**
 * Reading the numbers off a Match Facts table, and deciding whether to believe them.
 *
 * Everything in here is a pure function over OCR words and layout data, so the harness exercises exactly the
 * code the page runs. The stages, in order:
 *
 *   rows        OCR words bucketed into the row bands the preprocessor found
 *   screen      which Match Facts screen this capture is, decided by its content
 *   labels      each band's label text matched against the screen's rows, its section first
 *   values      the OUTER number either side of the matched label, the inner one being a goals count
 *   sides       which of the two columns is ours
 *   facts       the sums, the derived value and the all-or-nothing rule, in `facts`
 *
 * WHY THE LABEL IS THE ANCHOR rather than a fixed position. Screens scroll, so the same row is at a different
 * vertical position in two captures of the same screen, and a row can be missing entirely. A position only
 * means something next to the label that is sitting at it.
 */

import {
  aliasIndexFor,
  normaliseLabel,
  screenRows,
  sectionHeadings,
  storedRows,
  type Columns,
  type FactKey,
  type FactRow,
  type FactScreen,
  type LayoutProfile,
} from "./layouts";
import type { OcrWord } from "./engine";
/** One row of a screen, as the OCR saw it: its label text and the words either side. */
export interface RowReading {
  /** Vertical centre of the band, in prepared-table pixels. */
  y: number;
  labelText: string;
  labelScore: number;
  /** The normalised section heading in force above this band, or null when none has been read. */
  section: string | null;
  row: FactRow | null;
  left: ValueReading | null;
  right: ValueReading | null;
  /** True when the band's text is a section heading rather than a stat row. */
  isHeading: boolean;
}

/** One number found in a value column, with the span it occupied. */
export interface NumberToken {
  value: number;
  x0: number;
  x1: number;
  words: OcrWord[];
}

export interface ValueReading {
  /**
   * The stat itself, which is the OUTER number of the column.
   *
   * On Shooting a row can carry a goals count beside a small ball icon between the label and the number, as in
   * "1 [ball] 10", where the outer number is the stat and the inner one counts goals. Reading the column as one
   * concatenated string would turn that into 110, so the numbers are found separately and the outermost is the
   * one believed. It is also why a stray glyph is harmless: the ball is not a digit, and if the OCR reads it as
   * a 0 it is still the inner number rather than the outer one.
   */
  value: number;
  raw: string;
  wordConfidence: number;
  words: OcrWord[];
  /** Every number in the column, left to right. More than one means a goals count came with the stat. */
  tokens: NumberToken[];
}

/**
 * Reading a number out of OCR text.
 *
 * The captures show two forms for the same figure: `54` and `46` on FC25 and FC26, `45` and `55` on FIFA17, and
 * `39%` and `61%` on FIFA19. Both normalise to the same number.
 *
 * The leading-side bar is the hazard this function exists to survive. The table draws a coloured block at the
 * outer edge of whichever side is ahead, and the OCR sometimes reads it as a `|`, sometimes as an `l` and
 * sometimes not at all. Turning a stray `|` into a `1` would turn a real `0` into `10`, so a bar character is
 * DROPPED rather than mapped, and the letter confusions are only applied when there was at least one real digit
 * to begin with. A string of four or more digits is refused outright, because a value that long means the bar
 * or a neighbouring cell got glued to the number.
 */
export function normaliseNumber(raw: string): number | null {
  if (raw === null || raw === undefined) return null;
  let text = raw.trim();
  if (text === "") return null;

  // A bar is not a digit. So is a stray glyph the whitelist would have removed.
  text = text.replace(/[|_/\\()[\]{}<>]/g, "");

  const negatives = text.includes("-");
  const hasRealDigit = /[0-9]/.test(text);

  // Strip anything that cannot belong to a number, keeping a sign and a decimal point.
  let cleaned = text.replace(/[^0-9.,%+\-IlOo]/g, "");
  cleaned = cleaned.replace(/[%]/g, "");

  if (hasRealDigit && /[Il]/.test(cleaned)) cleaned = cleaned.replace(/[Il]/g, "1");
  if (hasRealDigit && /[Oo]/.test(cleaned)) cleaned = cleaned.replace(/[Oo]/g, "0");

  cleaned = cleaned.replace(/,/g, ".");

  // Keep the first decimal point only, so a doubled one cannot read as a thousands separator.
  const firstDot = cleaned.indexOf(".");
  if (firstDot >= 0) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }

  cleaned = cleaned.replace(/[+-]/g, (match) => (match === "-" ? "-" : ""));

  const digits = cleaned.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  if (digits.length > 4) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // A lone minus with no digit was already rejected above, so the sign is safe to trust here.
  return negatives && value > 0 ? -value : value;
}

/** Levenshtein distance, iterative and single row, which is all a label needs. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

/**
 * How alike two labels are, 0 to 1. Exact matches score 1 and are what resolves near pairs.
 *
 * NORMALISED BY THE SHORTER STRING, which is the second thing tried and the one that works, so the reason is
 * worth keeping. Dividing by the longer string makes a whole extra WORD look like a close call: `tackles` against
 * `tackles won` scores 0.64, while a single misread letter in `corners` scores 0.71, so no threshold separates
 * them and the matcher has to choose which failure to accept.
 *
 * Dividing by the shorter one separates them properly, because a missing word is a large error relative to the
 * word that is actually there:
 *
 *   Corners misread as Comers    1 - 2/6 = 0.67   must match, and it is on a real capture
 *   Tackles against Tackles Won  1 - 4/7 = 0.43   must NOT match, or the two rows collapse
 *   Offsi against Offsides       1 - 3/5 = 0.40   must NOT match, it is too little to go on
 */
export function labelSimilarity(a: string, b: string): number {
  const left = normaliseLabel(a);
  const right = normaliseLabel(b);
  if (left === "" || right === "") return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.min(left.length, right.length));
}

/**
 * The similarity a label must reach before it is believed.
 *
 * Sits in the gap opened up above: above the 0.43 a missing word scores and below the 0.67 that a two letter
 * misread scores. Exact matches are checked first and always win, which is what keeps the two Tackles rows apart
 * on any clean read.
 */
export const LABEL_MATCH_MIN = 0.62;

export interface LabelMatch {
  row: FactRow;
  score: number;
  exact: boolean;
}

/**
 * The alias tables, built once per row list.
 *
 * A WeakMap rather than a module level variable, so this stays a pure lookup with no hidden mutable state: two
 * screens can be matched in the same process and neither can poison the other.
 */
const aliasTables = new WeakMap<readonly FactRow[], Array<{ key: string; row: FactRow }>>();

function aliasTable(rows: readonly FactRow[]): Array<{ key: string; row: FactRow }> {
  let table = aliasTables.get(rows);
  if (table === undefined) {
    table = aliasIndexFor(rows);
    aliasTables.set(rows, table);
  }
  return table;
}

/**
 * The best row for a label, or null.
 *
 * Exact matches beat fuzzy ones outright, so a near pair cannot be decided by a rounding difference in the
 * similarity score. Between two fuzzy candidates the longer alias wins, because the longer label is the more
 * specific one: `tackles won` over `tackles`.
 */
export function matchLabel(text: string, screen: FactScreen, rows?: readonly FactRow[]): LabelMatch | null {
  const key = normaliseLabel(text);
  if (key === "") return null;

  let best: LabelMatch | null = null;
  for (const candidate of aliasTable(rows ?? screenRows(screen))) {
    if (candidate.key === key) return { row: candidate.row, score: 1, exact: true };
    const score = labelSimilarity(key, candidate.key);
    if (score < LABEL_MATCH_MIN) continue;
    if (
      best === null ||
      score > best.score + 0.001 ||
      (Math.abs(score - best.score) <= 0.001 &&
        candidate.key.length > normaliseLabel(best.row.aliases[0]).length)
    ) {
      best = { row: candidate.row, score, exact: false };
    }
  }
  return best;
}

/** A word reduced to the text the label matcher compares on. */
export function wordText(word: OcrWord): string {
  return word.text.trim();
}

/**
 * Buckets words into the row bands.
 *
 * A word belongs to a band when its vertical centre falls inside it. The band boundaries are the midpoints
 * between the rule lines the preprocessor found, so a word whose box overlaps two bands still lands in exactly
 * one of them.
 */
export function bucketIntoBands(
  words: OcrWord[],
  bandCentres: number[],
  bandHeight: number
): OcrWord[][] {
  const buckets: OcrWord[][] = bandCentres.map(() => []);
  if (bandCentres.length === 0) return buckets;

  // The first and last bands are half height, because the outermost rules only bound them on one side.
  const bounds: Array<[number, number]> = bandCentres.map((centre, index) => {
    const previous = index === 0 ? centre - bandHeight / 2 : (bandCentres[index - 1] + centre) / 2;
    const next =
      index === bandCentres.length - 1 ? centre + bandHeight / 2 : (centre + bandCentres[index + 1]) / 2;
    return [previous, next];
  });

  for (const word of words) {
    const centre = (word.y0 + word.y1) / 2;
    for (let i = 0; i < bounds.length; i += 1) {
      if (centre >= bounds[i][0] && centre < bounds[i][1]) {
        buckets[i].push(word);
        break;
      }
    }
  }

  for (const bucket of buckets) bucket.sort((a, b) => a.x0 - b.x0);
  return buckets;
}

/** Words whose horizontal centre falls inside a column's x range, in reading order. */
function wordsInColumn(words: OcrWord[], width: number, range: readonly [number, number]): OcrWord[] {
  const from = range[0] * width;
  const to = range[1] * width;
  return words.filter((word) => {
    const centre = (word.x0 + word.x1) / 2;
    return centre >= from && centre <= to;
  });
}

/** The mean confidence of a set of OCR words, 0 to 1. Tesseract reports 0 to 100. */
function meanConfidence(words: OcrWord[]): number {
  if (words.length === 0) return 0;
  let total = 0;
  for (const word of words) total += word.confidence;
  return total / words.length;
}

/**
 * The numbers in one column of a band.
 *
 * Read as separate tokens rather than as one concatenated string: a row on Shooting can carry a goals count
 * beside a ball icon next to the stat, and joining the column would turn "1 (ball) 10" into 110. Words that
 * cannot start a number close the token being built, which is what keeps the ball icon out of it whether the OCR
 * reads it as a glyph, as an `o` or as nothing at all.
 */
function readTokens(words: OcrWord[]): NumberToken[] {
  const tokens: NumberToken[] = [];
  let pending: OcrWord[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const value = normaliseNumber(pending.map((word) => word.text.trim()).join(""));
    if (value !== null) {
      tokens.push({
        value,
        x0: Math.min(...pending.map((word) => word.x0)),
        x1: Math.max(...pending.map((word) => word.x1)),
        words: pending,
      });
    }
    pending = [];
  };

  for (const word of words) {
    const trimmed = word.text.trim();
    const separator = /^[.,]$/.test(trimmed);
    // A separator belongs to the number being built whatever the gap: "0", "8" one space too far apart is still
    // a decimal on the screen, and at the outer edge it would otherwise read as two figures.
    if (separator && pending.length > 0) {
      pending.push(word);
      continue;
    }
    // A word with a digit in it belongs to the number being built.
    const numeric = /[0-9]/.test(word.text) || separator;
    // A wide gap ends the number as surely as a glyph does. Without this, a goals count read beside the stat
    // with the ball icon missed entirely would join it: "1" and "10" one space apart is 110.
    const gap = pending.length === 0 ? 0 : word.x0 - Math.max(...pending.map((entry) => entry.x1));
    const limit = Math.max(6, (word.y1 - word.y0) * 0.6);
    // A number cannot end on a bare separator, so the digit after one belongs to it however it was spaced.
    const afterSeparator = pending.length > 0 && /^[.,]$/.test(pending[pending.length - 1].text.trim());
    if (numeric && (pending.length === 0 || gap <= limit || afterSeparator)) pending.push(word);
    else {
      flush();
      if (numeric) pending.push(word);
    }
  }
  flush();
  return tokens;
}

/**
 * The stat in one column of a band, which is the OUTER number of that column.
 *
 * Outermost means the side away from the label: leftmost in the left column, rightmost in the right column. On
 * Shooting the inner number is a goals count, and on any screen a stray glyph read as a digit lands inside the
 * stat rather than outside it.
 */
export function readColumnValue(
  words: OcrWord[],
  width: number,
  range: readonly [number, number],
  side: "LEFT" | "RIGHT"
): ValueReading | null {
  const inColumn = wordsInColumn(words, width, range);
  if (inColumn.length === 0) return null;

  const tokens = readTokens(inColumn);
  if (tokens.length === 0) return null;

  const chosen =
    side === "RIGHT"
      ? tokens.reduce((best, token) => (token.x1 > best.x1 ? token : best))
      : tokens.reduce((best, token) => (token.x0 < best.x0 ? token : best));

  return {
    value: chosen.value,
    raw: inColumn.map((word) => word.text.trim()).join(""),
    wordConfidence: meanConfidence(chosen.words),
    words: chosen.words,
    tokens,
  };
}

/**
 * One band into a reading.
 *
 * The section in force is tried first and the whole screen is the fallback, so a misread section heading cannot
 * cost a row its figure while two same-named rows on other screens still stay apart. A band whose label does not
 * match any row still comes back, with a null row, which is what the screen classifier counts.
 */
export function readRow(
  words: OcrWord[],
  y: number,
  width: number,
  columns: Columns,
  screen: FactScreen,
  section: readonly FactRow[] | null
): RowReading {
  const labelWords = wordsInColumn(words, width, columns.label);
  const labelText = labelWords.map(wordText).join(" ").trim();
  const inSection = section === null || section.length === 0 ? null : matchLabel(labelText, screen, section);
  const match = inSection ?? (labelText === "" ? null : matchLabel(labelText, screen));

  return {
    y,
    labelText,
    labelScore: match?.score ?? 0,
    // Filled in by `readRows`, which is the only caller that knows which heading was last seen.
    section: null,
    row: match?.row ?? null,
    left: readColumnValue(words, width, columns.left, "LEFT"),
    right: readColumnValue(words, width, columns.right, "RIGHT"),
    isHeading: false,
  };
}

/**
 * Every band of a screen read, top to bottom, tracking the section each band sits in.
 *
 * A band whose text matches a section heading sets the section for the bands below it, and carries no figure of
 * its own. That is the whole of the section logic: it exists so a label can be resolved inside its section
 * first, not so a heading has to be read for a screen to work.
 */
export function readRows(
  words: OcrWord[],
  bandCentres: number[],
  bandHeight: number,
  width: number,
  columns: Columns,
  screen: FactScreen
): RowReading[] {
  const buckets = bucketIntoBands(words, bandCentres, bandHeight);
  const headings = sectionHeadings(screen);
  const rows: RowReading[] = [];
  let current: FactRow[] | null = null;
  let heading: string | null = null;

  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const labelText = wordsInColumn(bucket, width, columns.label).map(wordText).join(" ").trim();
    const normalised = normaliseLabel(labelText);

    const headingHit =
      normalised === ""
        ? null
        : headings.find((candidate) => labelSimilarity(normalised, candidate) >= 0.8) ?? null;
    if (headingHit !== null) {
      const section = screen.sections.find((entry) => normaliseLabel(entry.heading) === headingHit);
      heading = headingHit;
      current = section?.rows ?? null;
      rows.push({
        y: bandCentres[index],
        labelText,
        labelScore: 1,
        section: headingHit,
        row: null,
        left: null,
        right: null,
        isHeading: true,
      });
      continue;
    }

    const reading = readRow(bucket, bandCentres[index], width, columns, screen, current);
    rows.push({ ...reading, section: heading });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface ScreenChoice {
  screen: FactScreen | null;
  /** Why this screen, in a sentence the report can print. */
  reason: string;
}

/**
 * Which screen a capture is, decided by what is on it.
 *
 * The tab bar is deliberately not used: it is a strip of six words in small type, and one misread letter would
 * move a read onto another screen's rows, where the labels are plausible and the figures are wrong. The content
 * is the stronger signal, because the headings and the row labels are large type in the middle of the table.
 *
 * A screen's own heading decides it. Failing that, the screen whose rows matched most of the bands wins, and a
 * capture that matched nothing is not a Match Facts table at all.
 */
export function classifyScreen(rows: RowReading[], profile: LayoutProfile): ScreenChoice {
  const screens = profile.screens;

  for (const entry of screens) {
    for (const row of rows) {
      const text = normaliseLabel(row.labelText);
      if (text === "") continue;
      const hit = entry.signatures.some((signature) => labelSimilarity(text, signature) >= 0.8);
      if (hit) return { screen: entry, reason: `the ${entry.label} heading is on the capture` };
    }
  }

  let best: { screen: FactScreen; matched: number } | null = null;
  for (const entry of screens) {
    const matched = rows.filter((row) => row.row !== null).length;
    if (best === null || matched > best.matched) best = { screen: entry, matched };
  }

  if (best === null || best.matched === 0) {
    return { screen: null, reason: "no row on this capture belongs to a screen the scanner knows" };
  }
  return {
    screen: best.screen,
    reason: `${best.matched} of its rows were read and no other screen's heading was found`,
  };
}

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

/**
 * Which column is ours.
 *
 * Two signals, and they are not equal. The venue the manager already chose on the form is the strong one: home
 * is the left column and away is the right, which is how the screen has read on every capture. The club names
 * in the header are the cross-check, and where they can be read at all they decide on their own.
 *
 * When the two disagree, or when neither can decide, the answer is CONFLICT or UNKNOWN and the manager gets a
 * one click swap. Nothing is ever applied while the side is unsettled, because a silent wrong side fills the
 * boxes with the opponent's figures and those figures look completely plausible.
 */
export type SideResolution =
  | { kind: "AGREED"; ours: "LEFT" | "RIGHT"; basis: "VENUE" | "NAMES" | "VENUE_AND_NAMES" }
  | { kind: "CONFLICT"; venue: "LEFT" | "RIGHT"; names: "LEFT" | "RIGHT" }
  | { kind: "UNKNOWN" };

/**
 * How alike a club name and an OCR word have to be to count as a match of that club.
 *
 * Compared WORD BY WORD rather than whole name against whole word, which the first version got wrong: it scored
 * `FC Barcelona` against the single header word `BARCELONA` as a two thirds match, under the bar, and quietly
 * gave up on the club names entirely. A club's distinctive name is one word long, so anything under four letters
 * is skipped as a prefix or an abbreviation (`FC`, `LFC`) and the rest are compared individually.
 */
const CLUB_WORD_MATCH_MIN = 0.85;
const CLUB_WORD_MIN_LENGTH = 4;

/** The best similarity between any distinctive word of a club name and any word on one half of the header. */
function bestClubScore(club: string, words: OcrWord[], imageWidth: number, half: "LEFT" | "RIGHT"): number {
  const from = half === "LEFT" ? 0 : imageWidth / 2;
  const to = half === "LEFT" ? imageWidth / 2 : imageWidth;
  const clubWords = normaliseLabel(club)
    .split(" ")
    .filter((word) => word.length >= CLUB_WORD_MIN_LENGTH);
  if (clubWords.length === 0) return 0;

  let best = 0;
  for (const word of words) {
    const centre = (word.x0 + word.x1) / 2;
    if (centre < from || centre > to) continue;
    for (const clubWord of clubWords) {
      const score = labelSimilarity(clubWord, word.text);
      if (score > best) best = score;
    }
  }
  return best;
}

export function resolveSide(input: {
  venue: "HOME" | "AWAY" | "NEUTRAL" | null;
  ourClub: string;
  opponent: string;
  headerWords: OcrWord[];
  imageWidth: number;
  clubNames: "HEADER" | "TABLE_HEADER" | "UNREADABLE";
}): SideResolution {
  const fromVenue: "LEFT" | "RIGHT" | null =
    input.venue === "HOME" ? "LEFT" : input.venue === "AWAY" ? "RIGHT" : null;

  let fromNames: "LEFT" | "RIGHT" | null = null;
  if (input.clubNames !== "UNREADABLE" && input.headerWords.length > 0) {
    const ourLeft = bestClubScore(input.ourClub, input.headerWords, input.imageWidth, "LEFT");
    const ourRight = bestClubScore(input.ourClub, input.headerWords, input.imageWidth, "RIGHT");
    const ourBest = Math.max(ourLeft, ourRight);
    if (ourBest >= CLUB_WORD_MATCH_MIN) {
      const theirsLeft = bestClubScore(input.opponent, input.headerWords, input.imageWidth, "LEFT");
      const theirsRight = bestClubScore(input.opponent, input.headerWords, input.imageWidth, "RIGHT");
      // Ours is on the side where our name reads better than theirs does.
      const leftWins = ourLeft > theirsLeft;
      const rightWins = ourRight > theirsRight;
      if (leftWins && !rightWins) fromNames = "LEFT";
      else if (rightWins && !leftWins) fromNames = "RIGHT";
      else if (ourLeft > ourRight) fromNames = "LEFT";
      else if (ourRight > ourLeft) fromNames = "RIGHT";
    }
  }

  if (fromVenue && fromNames) {
    return fromVenue === fromNames
      ? { kind: "AGREED", ours: fromVenue, basis: "VENUE_AND_NAMES" }
      : { kind: "CONFLICT", venue: fromVenue, names: fromNames };
  }
  if (fromNames) return { kind: "AGREED", ours: fromNames, basis: "NAMES" };
  if (fromVenue) return { kind: "AGREED", ours: fromVenue, basis: "VENUE" };
  return { kind: "UNKNOWN" };
}

/** The side a resolution has settled on, or null when it has not settled. */
export function settledSide(resolution: SideResolution): "LEFT" | "RIGHT" | null {
  return resolution.kind === "AGREED" ? resolution.ours : null;
}

/** Below this a value is shown with a text cue as well as a colour, so the cue is never colour alone. */
export const LOW_CONFIDENCE = 0.75;

/**
 * The ceiling a figure can plausibly reach, per key.
 *
 * A guard against a bad read rather than a football claim, and a value past it is DISCARDED rather than
 * clamped: clamping a misread 700 passes down, or a misread 70 up, would invent an observation the manager
 * never made. Everything not named here shares the ceiling below, which is the largest figure these screens
 * print.
 */
const DEFAULT_CEILING = 1500;
export const FIELD_CEILINGS: Partial<Record<FactKey, number>> = {
  possessionPct: 100,
  expectedGoals: 10,
  ballRecoverySeconds: 60,
};

/** One screen's figure for both clubs, under the key the row is stored as. */
export interface ScreenValue {
  key: FactKey;
  us: number;
  them: number;
  /** The LOWER of the two confidences, so a pair is only as trustworthy as its weaker half. */
  confidence: number;
  /** True when a value had to be worked out from a sum rather than read. */
  derived: boolean;
  usWords: OcrWord[];
  themWords: OcrWord[];
}

export interface ScreenReading {
  values: Map<FactKey, ScreenValue>;
  /** Keys whose row was on the screen but whose two figures could not both be read. */
  unread: FactKey[];
}

/**
 * One classified screen's bands, turned into a figure for each club.
 *
 * Nothing beyond the outer-number rule and the ceilings is decided here. The sums, the derived value and the
 * all-or-nothing rule live in `facts`, where they can be reasoned about without a screenshot in front of them.
 */
export function readScreen(
  rows: RowReading[],
  screen: FactScreen,
  ours: "LEFT" | "RIGHT" | null
): ScreenReading {
  const values = new Map<FactKey, ScreenValue>();
  if (ours === null) {
    // Nothing is believed while the side is unsettled, because a value off the wrong column is worse than no
    // value at all: the opponent's figures look completely plausible in our boxes.
    return { values, unread: storedRows(screen).map((row) => row.key as FactKey) };
  }

  const unread: FactKey[] = [];
  for (const reading of rows) {
    if (reading.row === null || reading.row.key === null) continue;
    const key = reading.row.key;
    const us = ours === "LEFT" ? reading.left : reading.right;
    const them = ours === "LEFT" ? reading.right : reading.left;
    const ceiling = FIELD_CEILINGS[key] ?? DEFAULT_CEILING;
    if (us === null || them === null || us.value < 0 || them.value < 0 || us.value > ceiling || them.value > ceiling) {
      if (!unread.includes(key)) unread.push(key);
      continue;
    }
    values.set(key, {
      key,
      us: us.value,
      them: them.value,
      confidence: Math.min(us.wordConfidence, them.wordConfidence),
      derived: false,
      usWords: us.words,
      themWords: them.words,
    });
  }

  return { values, unread };
}

/**
 * The one overwrite rule.
 *
 * A scan never overwrites a figure the manager has edited by hand. It fills a box that is empty, and it
 * replaces a value an earlier scan put there, because the newest read of the same screen is the better one.
 * `force` is the manager saying so explicitly, which is the only way past it.
 *
 * One rule and one test, with no resolution UI, because anything more elaborate would be a second thing to
 * explain on a panel that is meant to stay simple.
 */
export function shouldApply(input: {
  currentText: string;
  currentSource: "NONE" | "SCAN" | "EDITED";
  force: boolean;
}): boolean {
  if (input.force) return true;
  if (input.currentText.trim() === "") return true;
  if (input.currentSource === "SCAN") return true;
  return false;
}

/** A number rendered the way the manual boxes hold it, so a scanned value is editable in the same box. */
export function toFieldText(value: number): string {
  return String(value);
}
