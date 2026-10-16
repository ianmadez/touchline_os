/**
 * Reading the numbers off a Match Facts table, and deciding whether to believe them.
 *
 * Everything in here is a pure function over OCR words and layout data, so the harness exercises exactly the
 * code the page runs. The stages, in order:
 *
 *   rows        OCR words bucketed into the row bands the preprocessor found
 *   labels      each band's label text matched against the profile's alias table
 *   values      the number either side of the matched label
 *   sides       which of the two columns is ours
 *   validate    the cross field rules, and a confidence that comes from the rules as well as the OCR
 *   merge       folded into a draft, newest read first, hand edited fields never overwritten
 *
 * WHY THE LABEL IS THE ANCHOR rather than a fixed position. The Summary group scrolls, so the same field is at
 * a different vertical position in two captures of the same screen, and a field could be missing entirely. A
 * position only means something next to the label that is sitting at it.
 */

import {
  aliasIndex,
  boundRows,
  normaliseLabel,
  type Columns,
  type RowLabel,
  type StatFieldKey,
  type StatGroup,
} from "./layouts";
import type { OcrWord } from "./engine";
/** One row of the table, as the OCR saw it: its label text and the words either side. */
export interface RowReading {
  /** Vertical centre of the band, in prepared-table pixels. */
  y: number;
  labelText: string;
  labelScore: number;
  row: RowLabel | null;
  left: ValueReading | null;
  right: ValueReading | null;
}

export interface ValueReading {
  value: number;
  raw: string;
  /** The mean of the OCR word confidences that produced this value, 0 to 1. */
  wordConfidence: number;
  /** The words that produced it, in prepared-table coordinates, for the focus highlight. */
  words: OcrWord[];
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
  row: RowLabel;
  score: number;
  exact: boolean;
}

/**
 * The alias table for a group, built once per group object.
 *
 * A WeakMap rather than a module level variable, so this stays a pure lookup with no hidden mutable state: two
 * groups can be matched in the same process and neither can poison the other.
 */
const aliasTables = new WeakMap<StatGroup, Array<{ key: string; row: RowLabel }>>();

function aliasTable(group: StatGroup): Array<{ key: string; row: RowLabel }> {
  let table = aliasTables.get(group);
  if (table === undefined) {
    table = aliasIndex(group);
    aliasTables.set(group, table);
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
export function matchLabel(text: string, group: StatGroup): LabelMatch | null {
  const key = normaliseLabel(text);
  if (key === "") return null;

  let best: LabelMatch | null = null;
  for (const candidate of aliasTable(group)) {
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
 * The number in one column of a band.
 *
 * Every word in the column is concatenated rather than taking the first, because a decimal point is often its
 * own token: `0.8` comes back as `0`, `.`, `8` about as often as it comes back whole.
 */
function readValue(words: OcrWord[], width: number, range: readonly [number, number]): ValueReading | null {
  const inColumn = wordsInColumn(words, width, range);
  if (inColumn.length === 0) return null;

  const raw = inColumn.map((word) => word.text.trim()).join("");
  const value = normaliseNumber(raw);
  if (value === null) return null;

  return { value, raw, wordConfidence: meanConfidence(inColumn), words: inColumn };
}

/**
 * One band into a reading.
 *
 * A band whose label does not match any known row still comes back, with a null row, so the caller can count it
 * toward "is this the Summary screen" without inventing a field for it.
 */
export function readRow(
  words: OcrWord[],
  y: number,
  width: number,
  columns: Columns,
  group: StatGroup
): RowReading {
  const labelWords = wordsInColumn(words, width, columns.label);
  const labelText = labelWords.map(wordText).join(" ").trim();
  const match = labelText === "" ? null : matchLabel(labelText, group);

  return {
    y,
    labelText,
    labelScore: match?.score ?? 0,
    row: match?.row ?? null,
    left: readValue(words, width, columns.left),
    right: readValue(words, width, columns.right),
  };
}

/** Every band read, top to bottom. */
export function readRows(
  words: OcrWord[],
  bandCentres: number[],
  bandHeight: number,
  width: number,
  columns: Columns,
  group: StatGroup
): RowReading[] {
  const buckets = bucketIntoBands(words, bandCentres, bandHeight);
  return buckets.map((bucket, index) => readRow(bucket, bandCentres[index], width, columns, group));
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Below this a value is shown with a text cue as well as a colour, so the cue is never colour alone. */
export const LOW_CONFIDENCE = 0.75;

/**
 * Sane bounds, per field.
 *
 * These are guards against a bad read, not football claims. A value outside its bound is DISCARDED rather than
 * clamped, for the reason the existing `match-stats` module already gives: clamping a misread number into range
 * would invent an observation the manager never made.
 */
export const FIELD_BOUNDS: Partial<Record<StatFieldKey, { min: number; max: number }>> = {
  possession: { min: 0, max: 100 },
  shots: { min: 0, max: 60 },
  shotsInsideBox: { min: 0, max: 60 },
  bigChances: { min: 0, max: 30 },
  passesCompleted: { min: 0, max: 1500 },
  expectedGoalsReported: { min: 0, max: 10 },
};

/** The fields that are percentages, so possession alone today. */
const PERCENT_FIELDS: StatFieldKey[] = ["possession"];

export interface ValidatedObservation {
  field: StatFieldKey;
  value: number;
  confidence: number;
  reason: string | null;
  derived: boolean;
  side: "LEFT" | "RIGHT";
  /** The words behind the value, for the focus highlight. In prepared-table coordinates. */
  words: OcrWord[];
}

export interface ValidationContext {
  /** Fractions, in prepared-table coordinates. */
  columns: Columns;
  width: number;
  rows: RowReading[];
  /** Which column is ours, or null when the side is not settled. */
  ours: "LEFT" | "RIGHT" | null;
  /** Our goals from the debrief's scoreline, when the manager has entered one. */
  goalsFor: number | null;
  /** The group being read, which is what says which rows carry a field. */
  group: StatGroup;
}

/**
 * Turns readings into observations.
 *
 * The order matters and is deliberate: the side is resolved first, because a value read off the wrong column is
 * worse than no value at all, and the cross field rules run afterwards so a value they reject never reaches the
 * review pane.
 */
export function validateReadings(context: ValidationContext): {
  observations: ValidatedObservation[];
  unread: StatFieldKey[];
} {
  const ours = context.ours;
  const expected = boundRows(context.group);
  if (ours === null) {
    // Nothing is applied while the side is unsettled, so every bound field is unread by definition.
    return { observations: [], unread: expected.map((row) => row.field as StatFieldKey) };
  }

  const picked = new Map<StatFieldKey, ValidatedObservation>();

  for (const reading of context.rows) {
    if (reading.row === null || reading.row.field === null) continue;
    const field = reading.row.field;
    const side = ours === "LEFT" ? reading.left : reading.right;
    if (side === null) continue;

    const bound = FIELD_BOUNDS[field];
    if (bound && (side.value < bound.min || side.value > bound.max)) {
      // Out of range is a refused read, not a clamped one. It is reported as unread instead.
      continue;
    }

    picked.set(field, {
      field,
      value: side.value,
      confidence: side.wordConfidence,
      reason: null,
      derived: false,
      side: ours,
      words: side.words,
    });
  }

  const notes = crossChecks(picked, context);

  for (const [field, observation] of picked) {
    const note = notes.get(field);
    if (note === undefined) continue;
    observation.reason = note.reason;
    observation.confidence = Math.max(0, observation.confidence * note.factor);
  }

  const observations = [...picked.values()];
  const read = new Set(observations.map((observation) => observation.field));
  const unread = expected
    .map((row) => row.field as StatFieldKey)
    .filter((field) => !read.has(field));

  return { observations, unread };
}

/**
 * The rules that need two values to check, and the same side read twice.
 *
 * A SOFT failure halves the confidence and states why rather than removing the value, because the manager is
 * looking at the picture and can settle it in a second. A possession pair that does not sum to 100 is the
 * clearest case: one of the two is a misread, and which one is not knowable from the numbers alone.
 */
function crossChecks(
  picked: Map<StatFieldKey, ValidatedObservation>,
  context: ValidationContext
): Map<StatFieldKey, { reason: string; factor: number }> {
  const notes = new Map<StatFieldKey, { reason: string; factor: number }>();
  const soft = (field: StatFieldKey, reason: string) => {
    if (!picked.has(field)) return;
    notes.set(field, { reason, factor: 0.5 });
  };

  // Cross-checks need the other side of the row, which is the same band read off the other column.
  const otherSideOf = (field: StatFieldKey): number | null => {
    for (const reading of context.rows) {
      if (reading.row === null || reading.row.field !== field) continue;
      const other = context.ours === "LEFT" ? reading.right : reading.left;
      return other?.value ?? null;
    }
    return null;
  };

  for (const field of PERCENT_FIELDS) {
    if (!picked.has(field)) continue;
    const other = otherSideOf(field);
    if (other === null) continue;
    const total = picked.get(field)!.value + other;
    if (Math.abs(total - 100) > 1) {
      soft(field, `these two add up to ${total}, not 100`);
    }
  }

  const shots = picked.get("shots")?.value;
  const inside = picked.get("shotsInsideBox")?.value;
  if (shots !== undefined && inside !== undefined && inside > shots) {
    soft("shotsInsideBox", "more shots inside the box than shots");
  }

  if (context.goalsFor !== null) {
    const goals = context.rows.find((reading) => normaliseLabel(reading.labelText) === "goals");
    const value = context.ours === "LEFT" ? goals?.left?.value : goals?.right?.value;
    if (value !== undefined && value !== null && value !== context.goalsFor) {
      // There is no Goals field to mark, so the note lands on the figure most likely to be wrong with it.
      soft("shots", `the scoreline says ${context.goalsFor} goals were scored`);
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface ScanObservation {
  field: StatFieldKey;
  value: number;
  /** From the OCR word confidence AND the rules. Never the OCR confidence alone. */
  confidence: number;
  reason: string | null;
  imageIndex: number;
  derived: boolean;
  words: OcrWord[];
}

export interface ScanImage {
  index: number;
  name: string;
  profileId: string | null;
  groupId: string | null;
  side: SideResolution;
}

export interface ScanDraft {
  observations: ScanObservation[];
  images: ScanImage[];
  /** Bound fields of this group that no image produced. Drives the "one more capture" line. */
  unread: StatFieldKey[];
}

export function emptyDraft(): ScanDraft {
  return { observations: [], images: [], unread: [] };
}

/**
 * Folds one image's readings into the draft.
 *
 * Keyed on the FIELD, not on the row position. The Summary group scrolls, so a second capture at a different
 * offset is a different set of rows carrying the same labels, and the position a value happened to occupy in one
 * capture says nothing about the other.
 *
 * The newest read wins. That is safe and it is not silent: every field in the pane names the image its value
 * came from, so a value that changed is visible rather than quietly replaced.
 */
export function mergeIntoDraft(
  draft: ScanDraft,
  observations: ValidatedObservation[],
  image: ScanImage,
  unread: StatFieldKey[]
): ScanDraft {
  const byField = new Map<StatFieldKey, ScanObservation>();
  for (const existing of draft.observations) byField.set(existing.field, existing);

  for (const observation of observations) {
    byField.set(observation.field, {
      field: observation.field,
      value: observation.value,
      confidence: observation.confidence,
      reason: observation.reason,
      imageIndex: image.index,
      derived: observation.derived,
      words: observation.words,
    });
  }

  const read = new Set([...byField.keys()]);

  return {
    observations: [...byField.values()],
    images: [...draft.images.filter((entry) => entry.index !== image.index), image].sort(
      (a, b) => a.index - b.index
    ),
    unread: unread.filter((field) => !read.has(field)),
  };
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
