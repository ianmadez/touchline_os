#!/usr/bin/env -S npx tsx
/**
 * The scanner's decisions, checked without an image, a browser or an engine.
 *
 * Everything here is a pure function, which is the point of the pipeline being split the way it is: the label
 * matcher, the number reader, the row banding, the side reasoning, the validators and the merge are all callable
 * with hand written input, so a failure can be pinned to one of them in a second instead of by squinting at a
 * screenshot. The cases that matter are the refusals and the near misses, because those are the ones that put a
 * wrong figure in a box.
 *
 *   npx tsx scripts/test-ocr.ts
 */
import {
  LABEL_MATCH_MIN,
  LOW_CONFIDENCE,
  bucketIntoBands,
  matchLabel,
  mergeIntoDraft,
  normaliseNumber,
  readRows,
  resolveSide,
  settledSide,
  shouldApply,
  validateReadings,
  emptyDraft,
  labelSimilarity,
  type RowReading,
  type ValidatedObservation,
} from "../src/lib/ocr/extract";
import { FC25_PLUS, defaultProfile, normaliseLabel } from "../src/lib/ocr/layouts";
import { admitImage, IMAGE_LIMITS } from "../src/lib/ocr/preprocess";
import type { OcrWord } from "../src/lib/ocr/engine";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`);
  }
}

const group = FC25_PLUS.groups[0];

// ---------------------------------------------------------------------------
console.log("normaliseNumber");
// One form per capture: FC25 and FC26 print a bare number, FIFA17 a bare number, FIFA19 a percent sign.
check("a bare count", normaliseNumber("54"), 54);
check("a percent sign is dropped", normaliseNumber("39%"), 39);
check("a percent with a space", normaliseNumber("61 %"), 61);
check("a decimal with a period", normaliseNumber("3.5"), 3.5);
check("a decimal with a comma", normaliseNumber("0,84"), 0.84);
check("the leading side bar is dropped, not read as a one", normaliseNumber("|54"), 54);
check("a trailing bar bracket is dropped", normaliseNumber("[54"), 54);
check("an opening bracket is dropped", normaliseNumber("10]"), 10);
check("a pair of bars", normaliseNumber("|12"), 12);
check("a lone dash is not a number", normaliseNumber("-"), null);
check("empty text is not a number", normaliseNumber(""), null);
check("whitespace is not a number", normaliseNumber("   "), null);
check("a letter soup with no digit is not a number", normaliseNumber("ft"), null);
check("a zero is a real figure, not a refusal", normaliseNumber("0"), 0);
check("negatives survive", normaliseNumber("-3"), -3);
check("a value glued to a neighbouring cell is refused", normaliseNumber("12345"), null);
check("a doubled decimal point keeps the first", normaliseNumber("0.8.5"), 0.85);

// ---------------------------------------------------------------------------
console.log("labelSimilarity and matchLabel");
check("identical labels score one", labelSimilarity("Shots", "Shots"), 1);
check("case and punctuation do not matter", labelSimilarity("POSSESSION %", "possession"), 1);
check(
  "the on screen label matches its row even though that row carries no field",
  matchLabel("Ball Recovery Time (Seconds)", group)?.row.field,
  null
);
// The near pair that must NOT collapse: the shorter label is a whole row of its own.
check("a near pair is nowhere near an exact match", labelSimilarity("Tackles", "Tackles Won") < LABEL_MATCH_MIN, true);

check("Shots matches its row", matchLabel("Shots", group)?.row.field, "shots");
check("Passes matches its row", matchLabel("Passes", group)?.row.field, "passesCompleted");
check("Possession % matches its row", matchLabel("Possession %", group)?.row.field, "possession");
check("Expected Goals matches its row", matchLabel("Expected Goals", group)?.row.field, "expectedGoalsReported");
// The near pair that must NOT collapse: the shorter label is a whole row of its own.
check("Tackles does not match Tackles Won", normaliseLabel(matchLabel("Tackles", group)?.row.aliases[0] ?? ""), "tackles");
check("Tackles Won does not match Tackles", normaliseLabel(matchLabel("Tackles Won", group)?.row.aliases[0] ?? ""), "tackles won");
// OCR mangling seen on the clean capture: rn read as m.
check("Corners as Comers still matches", normaliseLabel(matchLabel("Comers", group)?.row.aliases[0] ?? ""), "corners");
check("Fouls as , Fouls still matches", matchLabel(", Fouls", group)?.row.field, null);
check("an unrelated word matches nothing", matchLabel("Summary", group), null);
check("a short fragment matches nothing", matchLabel("Offsi", group), null);
check("an empty label matches nothing", matchLabel("   ", group), null);

// ---------------------------------------------------------------------------
console.log("bucketIntoBands and readRows");
const word = (text: string, x: number, y: number, confidence = 0.9): OcrWord => ({
  text,
  confidence,
  x0: x,
  y0: y,
  x1: x + text.length * 8,
  y1: y + 12,
});
const width = 500;
const columns = { left: [0, 0.13], label: [0.18, 0.86], right: [0.87, 1] } as const;
// Two words whose boxes sit at different heights inside one band still belong to that band.
const buckets = bucketIntoBands(
  [word("4", 10, 10), word("Shots", 150, 14), word("10", 460, 9)],
  [20, 50],
  30
);
check("both value words and the label land in one band", buckets[0].length, 3);
check("the next band is empty", buckets[1].length, 0);
check("words are ordered left to right", buckets[0].map((w) => w.text), ["4", "Shots", "10"]);

const rows = readRows(
  [word("4", 10, 10), word("Shots", 150, 14), word("10", 440, 9)],
  [20],
  30,
  width,
  columns,
  group
);
check("the label is read from the middle column", rows[0].row?.field, "shots");
check("the left value is read", rows[0].left?.value, 4);
check("the right value is read", rows[0].right?.value, 10);
// A decimal split into three tokens by the engine is one number.
const split = readRows(
  [word("0", 10, 10), word(".", 20, 10), word("8", 28, 10), word("Expected Goals", 150, 12), word("3", 440, 10), word(".", 450, 10), word("5", 458, 10)],
  [20],
  30,
  width,
  columns,
  group
);
check("a split decimal on the left is joined", split[0].left?.value, 0.8);
check("a split decimal on the right is joined", split[0].right?.value, 3.5);

// ---------------------------------------------------------------------------
console.log("resolveSide");
const header = (text: string, x: number): OcrWord => word(text, x, 40);
const leftClub = [header("FC", 380), header("BARCELONA", 420), header("REAL", 900), header("MADRID", 960)];
check("home means the left column", settledSide(resolveSide({ venue: "HOME", ourClub: "FC Barcelona", opponent: "Real Madrid", headerWords: [], imageWidth: 1280, clubNames: "HEADER" })), "LEFT");
check("away means the right column", settledSide(resolveSide({ venue: "AWAY", ourClub: "FC Barcelona", opponent: "Real Madrid", headerWords: [], imageWidth: 1280, clubNames: "HEADER" })), "RIGHT");
check("the venue and the names agreeing is AGREED", resolveSide({ venue: "HOME", ourClub: "FC Barcelona", opponent: "Real Madrid", headerWords: leftClub, imageWidth: 1280, clubNames: "HEADER" }).kind, "AGREED");
// The case that must never be guessed: the two signals point at different columns.
check("the venue and the names disagreeing is a CONFLICT", resolveSide({ venue: "AWAY", ourClub: "FC Barcelona", opponent: "Real Madrid", headerWords: leftClub, imageWidth: 1280, clubNames: "HEADER" }).kind, "CONFLICT");
check("an unsettled side settles nothing", settledSide(resolveSide({ venue: "NEUTRAL", ourClub: "FC Barcelona", opponent: "Real Madrid", headerWords: [], imageWidth: 1280, clubNames: "HEADER" })), null);
check("nothing readable at all is UNKNOWN", resolveSide({ venue: null, ourClub: "", opponent: "", headerWords: [], imageWidth: 1280, clubNames: "UNREADABLE" }).kind, "UNKNOWN");

// ---------------------------------------------------------------------------
console.log("validateReadings");
const reading = (label: string, left: number | null, right: number | null): RowReading => ({
  y: 0,
  labelText: label,
  labelScore: 1,
  row: matchLabel(label, group)?.row ?? null,
  left: left === null ? null : { value: left, raw: String(left), wordConfidence: 0.9, words: [] },
  right: right === null ? null : { value: right, raw: String(right), wordConfidence: 0.9, words: [] },
});

const validate = (rows: RowReading[], ours: "LEFT" | "RIGHT" | null, goalsFor: number | null = null) =>
  validateReadings({ columns, width, rows, ours, goalsFor, group });

check("nothing is applied while the side is unsettled", validate([reading("Possession %", 54, 46)], null).observations.length, 0);
check("an unsettled side reports every bound field as unread", validate([reading("Possession %", 54, 46)], null).unread.length, 4);
const ok = validate([reading("Possession %", 54, 46), reading("Shots", 4, 10)], "LEFT");
check("a clean pair produces observations", ok.observations.length, 2);
check("the value comes from our column", ok.observations[0].value, 54);
check("a full confidence clean read", ok.observations[0].confidence, 0.9);
check("no reason on a clean read", ok.observations[0].reason, null);

const notSumming = validate([reading("Possession %", 54, 40)], "LEFT");
check("possession that does not sum to 100 is kept, not dropped", notSumming.observations.length, 1);
check("...but halved in confidence", notSumming.observations[0].confidence, 0.45);
check("...and says why", notSumming.observations[0].reason, "these two add up to 94, not 100");
check("...and reads as low confidence", notSumming.observations[0].confidence < LOW_CONFIDENCE, true);

const impossible = validate([reading("Shots Inside Box", 9, 4), reading("Shots", 4, 10)], "LEFT");
check("an unbound row produces nothing at all", impossible.observations.some((o) => o.field === "shotsInsideBox"), false);

const outOfRange = validate([reading("Possession %", 140, 10)], "LEFT");
check("an impossible percentage is discarded rather than clamped", outOfRange.observations.length, 0);

const rightSide = validate([reading("Possession %", 54, 46)], "RIGHT");
check("the other column is read when it is the one that is ours", rightSide.observations[0].value, 46);

// ---------------------------------------------------------------------------
console.log("mergeIntoDraft");
const observation = (field: ValidatedObservation["field"], value: number, imageIndex: number): ValidatedObservation => ({
  field,
  value,
  confidence: 0.9,
  reason: null,
  derived: false,
  side: "LEFT",
  words: [],
});
const imageOf = (index: number) => ({ index, name: `img${index}`, profileId: "fc25-plus", groupId: "SUMMARY", side: { kind: "AGREED", ours: "LEFT", basis: "VENUE" } as const });

// Two captures of the same scrolled group: the second fills a field the first never had, and replaces one.
const first = mergeIntoDraft(emptyDraft(), [observation("shots", 4, 1), observation("possession", 54, 1)], imageOf(1), ["possession", "shots", "passesCompleted"]);
const second = mergeIntoDraft(first, [observation("passesCompleted", 158, 2), observation("shots", 6, 2)], imageOf(2), ["possession", "shots", "passesCompleted"]);
check("a field the second capture filled appears", second.observations.find((o) => o.field === "passesCompleted")?.value, 158);
check("the field the first capture filled survives", second.observations.find((o) => o.field === "possession")?.value, 54);
check("the newest read of the same field wins", second.observations.find((o) => o.field === "shots")?.value, 6);
check("...and it names the image it came from", second.observations.find((o) => o.field === "shots")?.imageIndex, 2);
check("a field read by either capture is no longer unread", second.unread, []);
check("both images are listed", second.images.map((i) => i.index), [1, 2]);

// ---------------------------------------------------------------------------
console.log("shouldApply, the one overwrite rule");
check("an empty box is filled", shouldApply({ currentText: "", currentSource: "NONE", force: false }), true);
check("a scan value is replaced by a newer scan", shouldApply({ currentText: "4", currentSource: "SCAN", force: false }), true);
check("a hand typed value is NEVER overwritten", shouldApply({ currentText: "7", currentSource: "NONE", force: false }), false);
check("a value the manager edited after a scan is not overwritten either", shouldApply({ currentText: "7", currentSource: "EDITED", force: false }), false);
check("the manager asking explicitly is the only way past it", shouldApply({ currentText: "7", currentSource: "EDITED", force: true }), true);

// ---------------------------------------------------------------------------
console.log("admitImage");
check("a normal screenshot is admitted", admitImage({ name: "shot.png", type: "image/png", size: 400_000, existingCount: 0 }).ok, true);
check("a paste with no name is admitted by type", admitImage({ name: "image.png", type: "image/png", size: 400_000, existingCount: 0 }).ok, true);
check("too many images is refused", admitImage({ name: "shot.png", type: "image/png", size: 1000, existingCount: IMAGE_LIMITS.maxImages }).ok, false);
check("too large is refused", admitImage({ name: "shot.png", type: "image/png", size: IMAGE_LIMITS.maxBytes + 1, existingCount: 0 }).ok, false);
check("an empty file is refused", admitImage({ name: "shot.png", type: "image/png", size: 0, existingCount: 0 }).ok, false);
check("a non image is refused", admitImage({ name: "notes.txt", type: "text/plain", size: 100, existingCount: 0 }).ok, false);
check("a file with no MIME type but a real extension is admitted", admitImage({ name: "shot.webp", type: "", size: 100, existingCount: 0 }).ok, true);

// ---------------------------------------------------------------------------
console.log("layouts");
check("the default profile is the modern one", defaultProfile().id, "fc25-plus");
check("the Summary group is the one that scrolls", group.scrolls, true);
// The two boxes with no screen evidence stay unbound, which is what keeps the scanner from claiming them.
check(
  "inside box is bound to no row at all",
  group.labels.some((row) => row.field === "shotsInsideBox"),
  false
);
check(
  "big chances is bound to no row at all",
  group.labels.some((row) => row.field === "bigChances"),
  false
);
check("four rows carry a field", group.labels.filter((row) => row.field !== null).length, 4);
check("the unbound rows are still listed so the screen is recognised", group.labels.length, 15);
// The line breaks are out entirely, per the decision: no storage, no validation, no UI.
check("no line break row is described", group.labels.some((row) => normaliseLabel(row.aliases[0]).includes("line")), false);

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
