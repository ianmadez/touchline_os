#!/usr/bin/env -S npx tsx
/**
 * The scanner's decisions, checked without an image, a browser or an engine.
 *
 * Everything here is a pure function, which is the point of the pipeline being split the way it is: the number
 * reader, the label matcher, the screen classifier, the side reasoning and the checks are all callable with hand
 * written input, so a failure can be pinned to one of them in a second instead of by squinting at a screenshot.
 *
 * The captures for Shooting, Passing and Defending have not been supplied, so those three screens ship disabled
 * and their rows are exercised here instead: the outer number rule, every sum, the derived value and the
 * all-or-nothing rule all run against the figures the manager transcribed off those screens.
 *
 *   npx tsx scripts/test-ocr.ts
 */
import {
  LABEL_MATCH_MIN,
  LOW_CONFIDENCE,
  bucketIntoBands,
  classifyScreen,
  labelSimilarity,
  matchLabel,
  normaliseNumber,
  readColumnValue,
  readScreen,
  resolveSide,
  settledSide,
  shouldApply,
  type RowReading,
  type ScreenValue,
  type ValueReading,
} from "../src/lib/ocr/extract";
import {
  FC25_PLUS,
  SCREENS,
  defaultProfile,
  normaliseLabel,
  requiredRows,
  screenById,
  screenRows,
  storedRows,
  type FactKey,
  type FactRow,
  type FactScreen,
} from "../src/lib/ocr/layouts";
import {
  boxValuesFromFacts,
  crossScreenNotes,
  emptyFacts,
  evaluateScreen,
  factValue,
  factsAreEmpty,
  normaliseFacts,
  type MatchFacts,
  type ScreenFacts,
} from "../src/lib/ocr/facts";
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

const profile = FC25_PLUS;
const summary = screenById(profile, "SUMMARY") as FactScreen;
const shooting = screenById(profile, "SHOOTING") as FactScreen;
const passing = screenById(profile, "PASSING") as FactScreen;
const defending = screenById(profile, "DEFENDING") as FactScreen;

/** A word, with the box the OCR would report. x0 is what the column readers sort and compare on. */
const word = (text: string, x0: number, x1 = x0 + 12): OcrWord => ({
  text,
  x0,
  x1,
  y0: 0,
  y1: 20,
  confidence: 0.95,
});

/** The row definition for a key, so a test can name a row the way the layout does. */
const rowOf = (screen: FactScreen, key: FactKey): FactRow => {
  const row = screenRows(screen).find((entry) => entry.key === key);
  if (row === undefined) throw new Error(`${key} is not a row on ${screen.id}`);
  return row;
};

/** A value as the reader would produce it, for the tests that start after the numbers are read. */
const value = (n: number, confidence = 0.95): ValueReading => ({
  value: n,
  raw: String(n),
  wordConfidence: confidence,
  words: [word(String(n), 1)],
  tokens: [{ value: n, x0: 1, x1: 13, words: [word(String(n), 1)] }],
});

/** One band of a screen, as read. */
const band = (screen: FactScreen, key: FactKey, us: number, them: number, confidence = 0.95): RowReading => ({
  y: 0,
  labelText: rowOf(screen, key).aliases[0],
  labelScore: 1,
  section: null,
  row: rowOf(screen, key),
  left: value(us, confidence),
  right: value(them, confidence),
  isHeading: false,
});

/** A whole screen of the manager's own transcription, so one figure can be knocked out at a time. */
const pairMap = (entries: Array<[FactKey, number, number]>, omitted: FactKey[] = []): Map<FactKey, ScreenValue> => {
  const map = new Map<FactKey, ScreenValue>();
  for (const [key, us, them] of entries) {
    if (omitted.includes(key)) continue;
    map.set(key, { key, us, them, confidence: 0.95, derived: false, usWords: [], themWords: [] });
  }
  return map;
};

const SHOOTING_VALUES: Array<[FactKey, number, number]> = [
  ["totalShots", 7, 17],
  ["onTarget", 3, 7],
  ["offTarget", 2, 4],
  ["blocked", 2, 6],
  ["normal", 7, 10],
  ["finesse", 0, 2],
  ["header", 0, 0],
  ["power", 0, 0],
  ["volley", 0, 1],
  ["chip", 0, 1],
  ["setPieces", 0, 3],
  ["insideBox", 4, 17],
  ["outsideBox", 3, 0],
  ["nearSide", 4, 9],
  ["farSide", 3, 8],
];

const SUMMARY_VALUES: Array<[FactKey, number, number]> = storedRows(summary).map((row) => [
  row.key as FactKey,
  row.key === "possessionPct" ? 38 : 4,
  row.key === "possessionPct" ? 62 : 9,
]);

const PASSING_VALUES: Array<[FactKey, number, number]> = [
  ["totalPasses", 114, 166],
  ["completed", 96, 147],
  ["intercepted", 14, 12],
  ["offside", 1, 2],
  ["other", 3, 5],
  ["ground", 59, 111],
  ["lob", 3, 5],
  ["through", 34, 34],
  ["lobbedThrough", 2, 2],
  ["cross", 0, 2],
  ["setPieces", 7, 6],
  ["keyPass", 5, 10],
  ["firstTime", 28, 17],
  ["passAndGo", 0, 0],
  ["downWing", 4, 8],
  ["breakaway", 1, 3],
];

// ---------------------------------------------------------------------------
console.log("normaliseNumber");
check("a bare count", normaliseNumber("54"), 54);
check("a percent sign is dropped", normaliseNumber("39%"), 39);
check("a decimal with a period", normaliseNumber("3.5"), 3.5);
check("a decimal with a comma", normaliseNumber("0,84"), 0.84);
check("the leading side bar is dropped, not read as a one", normaliseNumber("|54"), 54);
check("an empty string is nothing", normaliseNumber("  "), null);
check("a long run of digits is refused", normaliseNumber("12345"), null);

// ---------------------------------------------------------------------------
console.log("the outer number, which is the stat");
/*
  On Shooting a row can carry a goals count beside a small ball icon between the label and the number, and the
  stat is the OUTER number. On the right column that is the rightmost number, so the goals count is the one inside
  it. The six cases below are the rows the manager transcribed, where our side scored none.
*/
const right = (texts: string[]): ValueReading | null =>
  readColumnValue(texts.map((text, index) => word(text, index * 30)), 300, [0, 1], "RIGHT");
const leftColumn = (texts: string[]): ValueReading | null =>
  readColumnValue(texts.map((text, index) => word(text, index * 30)), 300, [0, 1], "LEFT");

check("Normal 7 against a goal and 10", right(["1", "●", "10"])?.value, 10);
check("Finesse 0 against a goal and 2", right(["1", "●", "2"])?.value, 2);
check("Chip 0 against a goal and 1", right(["1", "●", "1"])?.value, 1);
check("Inside the Box 4 against three goals and 17", right(["3", "●", "17"])?.value, 17);
check("Near Side 4 against a goal and 9", right(["1", "●", "9"])?.value, 9);
check("Far Side 3 against two goals and 8", right(["2", "●", "8"])?.value, 8);
check("both numbers are kept, so the goals count is not thrown away", right(["1", "●", "10"])?.tokens.length, 2);
check("the ball read as a zero is still the inner number", right(["1", "0", "10"])?.value, 10);
// Our side of a row is mirrored, and no capture of us scoring has been supplied, so this is the generic rule
// rather than a measured case: the number away from the label is still the stat.
check("on the left column the outermost number is the leftmost", leftColumn(["7", "●", "1"])?.value, 7);
check("a plain number with no goal count reads as itself", right(["17"])?.value, 17);
check("a decimal is still read whole", right(["1", ".", "9"])?.value, 1.9);
check("a column with no number at all is nothing", right(["●"]), null);

// ---------------------------------------------------------------------------
console.log("labelSimilarity and matchLabel");
check("an exact label", labelSimilarity("Shots", "Shots"), 1);
check("a whole extra word is not a match", labelSimilarity("Tackles", "tackles won") < LABEL_MATCH_MIN, true);
check("a two letter misread is a match", labelSimilarity("Comers", "corners") > LABEL_MATCH_MIN, true);
check("Ball Recovery Time matches its row", matchLabel("Ball Recovery Time (Seconds)", summary)?.row.key, "ballRecoverySeconds");
check("Expected Goals matches its row", matchLabel("Expected Goals", summary)?.row.key, "expectedGoals");
check("Tackles does not match Tackles Won", matchLabel("Tackles", summary)?.row.key, "tackles");
check("and Tackles Won does not match Tackles", matchLabel("Tackles Won", summary)?.row.key, "tacklesWon");
check("an unrelated word matches nothing", matchLabel("Summary", summary), null);
check("a short fragment matches nothing", matchLabel("Offsi", summary), null);
// The same wording on two screens belongs to two different rows, which is why the screen is decided first.
check("Set Pieces on the Shooting screen is the shot type", matchLabel("Set Pieces", shooting)?.row.key, "setPieces");
check("and on the Passing screen it is the pass type", matchLabel("Set Pieces", passing)?.row.key, "setPieces");
check("Interceptions is a row of both Summary and Defending", [matchLabel("Interceptions", summary)?.row.key, matchLabel("Interceptions", defending)?.row.key], ["interceptions", "interceptions"]);
check("the section is tried first", matchLabel("Interceptions", defending, defending.sections[0].rows)?.row.key, "interceptions");

// ---------------------------------------------------------------------------
console.log("bucketIntoBands");
const bands = bucketIntoBands(
  [
    word("Shots", 100),
    { ...word("14", 10), y0: 0, y1: 18 },
    { ...word("9", 250), y0: 0, y1: 18 },
  ],
  [9, 30],
  21
);
check("a word lands in the band its centre falls in", bands[0].length, 3);
check("and never in two bands at once", bands[1].length, 0);

// ---------------------------------------------------------------------------
console.log("classification, by content rather than by the tab bar");
const classify = (labels: string[]): string | null =>
  classifyScreen(
    labels.map((label) => ({ y: 0, labelText: label, left: null, right: null })),
    profile
  ).screen?.id ?? null;
check("the Shooting heading decides it", classify(["Overall Shooting"]), "SHOOTING");
check("the Passing heading decides it", classify(["Overall Passing"]), "PASSING");
check("the Defending heading decides it", classify(["Overall Defending"]), "DEFENDING");
check("a misread heading still decides it", classify(["Overall Shooling"]), "SHOOTING");
check("a capture with nothing recognisable on it is nothing", classify([]), null);
// The rows decide it when no heading was read, which is how the Summary screen has to be recognised: it has no
// heading of its own and opens straight onto Possession %.
check(
  "the Summary rows decide it with no heading at all",
  classify(["Possession %", "Ball Recovery Time (Seconds)", "Shots", "Expected Goals", "Passes", "Tackles Won", "Corners"]),
  "SUMMARY"
);
// "Saves" and "Interceptions" are rows of two screens, so one of them alone proves nothing; the balance of the
// rows is what settles it.
check(
  "one shared row does not decide a screen on its own",
  classify(["Saves", "Interceptions", "Standing Tackles", "Sliding Tackles Won", "Clearances", "Beaten By Opponent"]),
  "DEFENDING"
);
// A screen that ships disabled is still identified, so the pane can say it is not read yet rather than claim the
// capture is unknown.
check("a disabled screen is still recognised", classify(["Overall Shooting", "Total Shots", "Finesse"]), "SHOOTING");

// ---------------------------------------------------------------------------
console.log("the screens the tables describe");
check("Summary is read", summary.enabled, true);
check("Shooting is not read yet", shooting.enabled, false);
check("and the data says why", shooting.disabledBecause?.includes("were not read"), true);
check("Passing is not read yet", passing.enabled, false);
check("Defending is not read yet", defending.enabled, false);
check("Summary carries the four box figures that are on it", storedRows(summary).map((row) => row.key).filter((key) => ["shots", "expectedGoals", "possessionPct", "passes"].includes(key as string)).length, 4);
check("inside box is not on the Summary screen", storedRows(summary).some((row) => row.key === "insideBox"), false);
check("inside box is a row on the Shooting screen", storedRows(shooting).some((row) => row.key === "insideBox"), true);
check("Red Cards is not required, because it sits below the fold", requiredRows(summary).some((row) => row.key === "redCards"), false);
check("Red Cards is still stored when it is there", storedRows(summary).some((row) => row.key === "redCards"), true);
check("Summary's required rows are the fifteen that fit", requiredRows(summary).length, 15);

// ---------------------------------------------------------------------------
console.log("readScreen, both clubs at once");
const reading = readScreen([band(summary, "shots", 7, 17)], summary, "LEFT");
check("our side is the left column", [reading.values.get("shots")?.us, reading.values.get("shots")?.them], [7, 17]);
check("and the pair keeps the weaker half's confidence", reading.values.get("shots")?.confidence, 0.95);
const mirrored = readScreen([band(summary, "shots", 7, 17)], summary, "RIGHT");
check("the other column is ours when the side is swapped", [mirrored.values.get("shots")?.us, mirrored.values.get("shots")?.them], [17, 7]);
check("an unsettled side reads nothing at all", readScreen([band(summary, "shots", 7, 17)], summary, null).values.size, 0);
const halfRead = readScreen([{ ...band(summary, "shots", 7, 17), right: null }], summary, "LEFT");
check("a row with one side missing is not a value", halfRead.values.size, 0);
check("and the row is reported as unread", halfRead.unread, ["shots"]);
check("a figure past its ceiling is discarded rather than clamped", readScreen([band(summary, "possessionPct", 380, 62)], summary, "LEFT").values.size, 0);

// ---------------------------------------------------------------------------
console.log("the hard checks, one screen at a time");
const goodShooting = evaluateScreen(shooting, pairMap(SHOOTING_VALUES));
check("a screen whose sums hold is kept", goodShooting.group !== null, true);
check("and nothing on it was derived", goodShooting.derived, []);

const offTargetWrong = evaluateScreen(shooting, pairMap(SHOOTING_VALUES.map(([key, us, them]) => [key, key === "offTarget" ? 5 : us, them] as [FactKey, number, number])));
check("a sum that does not add up refuses the screen", offTargetWrong.group, null);
check("and the refusal names the rows", offTargetWrong.refusal, "on target, off target and blocked add up to 10 rather than 7 on one side");

const typesWrong = evaluateScreen(shooting, pairMap(SHOOTING_VALUES.map(([key, us, them]) => [key, key === "chip" ? 9 : us, them] as [FactKey, number, number])));
check("the shot types are checked against the total too", typesWrong.group, null);

const distanceWrong = evaluateScreen(shooting, pairMap(SHOOTING_VALUES.map(([key, us, them]) => [key, key === "outsideBox" ? 0 : us, them] as [FactKey, number, number])));
check("inside plus outside is checked", distanceWrong.group, null);

const aimWrong = evaluateScreen(shooting, pairMap(SHOOTING_VALUES.map(([key, us, them]) => [key, key === "farSide" ? 3 : us, key === "farSide" ? 3 : them] as [FactKey, number, number])));
check("near plus far is checked", aimWrong.group, null);

check("a screen with one sum and nothing else is kept", evaluateScreen(passing, pairMap(PASSING_VALUES)).group !== null, true);
check("and the same screen with a broken sum is not", evaluateScreen(passing, pairMap(PASSING_VALUES.map(([key, us, them]) => [key, key === "other" ? 9 : us, them] as [FactKey, number, number]))).group, null);

const possessionWrong = evaluateScreen(
  summary,
  pairMap(SUMMARY_VALUES.map(([key, us, them]) => [key, us, key === "possessionPct" ? 52 : them] as [FactKey, number, number]))
);
check("possession has to add up to 100", possessionWrong.group, null);
check("and it says so", possessionWrong.refusal, "possession adds up to 90 rather than 100");
check("a possession split inside the tolerance is kept", evaluateScreen(summary, pairMap(SUMMARY_VALUES)).group !== null, true);

console.log("one figure missing inside a sum, which is arithmetic rather than a guess");
const derivedOne = evaluateScreen(shooting, pairMap(SHOOTING_VALUES, ["blocked"]));
check("the missing figure is worked out from the total", derivedOne.group?.blocked, { us: 2, them: 6 });
check("and it is marked as derived", derivedOne.derived, ["blocked"]);
check("a derived figure is trusted less than a read one", derivedOne.confidence < 0.95, true);
const derivedTotal = evaluateScreen(shooting, pairMap(SHOOTING_VALUES, ["totalShots"]));
check("a missing total comes off the rows that were read", derivedTotal.group?.totalShots, { us: 7, them: 17 });
const twoMissing = evaluateScreen(shooting, pairMap(SHOOTING_VALUES, ["blocked", "offTarget"]));
check("two missing figures is a capture that did not read, not arithmetic", twoMissing.group, null);
check("and it says how many rows are behind the sum", twoMissing.refusal, "only 1 of 3 rows behind on target, off target and blocked could be read");
const negativeDerive = evaluateScreen(shooting, pairMap(SHOOTING_VALUES.map(([key, us, them]) => [key, key === "totalShots" ? 3 : us, them] as [FactKey, number, number]), ["normal"]));
check("a sum that would go negative refuses rather than inventing a figure", negativeDerive.group, null);

console.log("all or nothing, and absent is not zero");
const missingRequired = evaluateScreen(summary, pairMap(SUMMARY_VALUES, ["corners"]));
check("a required row that was never read refuses the whole screen", missingRequired.group, null);
check("and it says how many rows are missing", missingRequired.refusal, "1 of its rows could not be read");
const oneGapInASum = evaluateScreen(shooting, pairMap(SHOOTING_VALUES, ["farSide"]));
check("a required row inside a sum is derived rather than missing", oneGapInASum.group?.farSide, { us: 3, them: 8 });
const belowFold = evaluateScreen(summary, pairMap(SUMMARY_VALUES, ["redCards"]));
check("a row below the fold is not required, so the screen is still kept", belowFold.group !== null, true);

// ---------------------------------------------------------------------------
console.log("the facts shape");
check("a new set of facts has no screen at all", factsAreEmpty(emptyFacts()), true);
check("which is not the same as a screen of zeroes", factValue(emptyFacts(), "SUMMARY", "shots"), null);
const summaryFacts: MatchFacts = { v: 1, summary: (evaluateScreen(summary, pairMap(SUMMARY_VALUES)).group as ScreenFacts) };
check("possession is stored as a pair", factValue(summaryFacts, "SUMMARY", "possessionPct"), { us: 38, them: 62 });
check("a screen that was not scanned is absent rather than zero", factValue(summaryFacts, "SHOOTING", "totalShots"), null);

console.log("the five boxes take their figures from the facts, and from nowhere else");
const summaryBoxes = boxValuesFromFacts(summaryFacts);
check("shots come off Summary", summaryBoxes.shots, 4);
check("expected goals come off Summary", summaryBoxes.expectedGoalsReported, 4);
check("possession comes off Summary", summaryBoxes.possession, 38);
check("passes come off Summary", summaryBoxes.passesCompleted, 4);
check("inside box is not on Summary, so that box is left alone", summaryBoxes.shotsInsideBox, null);
const shootingFacts: MatchFacts = { v: 1, shooting: (goodShooting.group as ScreenFacts) };
check("shots can come off the Shooting total instead", boxValuesFromFacts(shootingFacts).shots, 7);
check("and inside box only ever comes off Shooting", boxValuesFromFacts(shootingFacts).shotsInsideBox, 4);
check("a screen that was not scanned offers a box nothing", boxValuesFromFacts(shootingFacts).possession, null);

// ---------------------------------------------------------------------------
console.log("the cross checks, which are notes rather than drops");
const disagreeing: MatchFacts = { ...summaryFacts, shooting: (goodShooting.group as ScreenFacts) };
check("Shots against the shooting total is compared", crossScreenNotes(disagreeing), ["Shots reads 4 on the Summary screen and 7 on the Shooting screen"]);
const agreeing: MatchFacts = {
  v: 1,
  summary: { ...(summaryFacts.summary as ScreenFacts), shots: { us: 7, them: 17 } },
  shooting: (goodShooting.group as ScreenFacts),
};
check("and it says nothing when the two screens agree", crossScreenNotes(agreeing), []);
check("a screen on its own is never compared", crossScreenNotes(summaryFacts), []);

console.log("stored facts are validated on the way in");
const withJunkFacts = normaliseFacts({ summary: { shots: { us: 1, them: 2 }, somethingElse: { us: 9, them: 9 } } });
check("a crafted key is dropped", withJunkFacts?.summary, { shots: { us: 1, them: 2 } });
check("a half pair is dropped", normaliseFacts({ summary: { shots: { us: 1 } } }), null);
check("a pair that is not numbers is dropped", normaliseFacts({ summary: { shots: { us: "1", them: 2 } } }), null);
check("a screen with nothing left in it is dropped rather than stored empty", normaliseFacts({ summary: {} }), null);
check("a group round trips, which is what an edit and re-save does", normaliseFacts(summaryFacts)?.summary?.possessionPct, { us: 38, them: 62 });
check("and the version is stamped on it", normaliseFacts(summaryFacts)?.v, 1);

// ---------------------------------------------------------------------------
console.log("sides");
const sideInput = (venue: "HOME" | "AWAY" | "NEUTRAL" | null) => ({
  venue,
  ourClub: "Wigan Athletic",
  opponent: "Bristol City",
  headerWords: [] as OcrWord[],
  imageWidth: 300,
  clubNames: "HEADER" as const,
});
check("the venue decides on its own", settledSide(resolveSide(sideInput("HOME"))), "LEFT");
check("and the other way at an away match", settledSide(resolveSide(sideInput("AWAY"))), "RIGHT");
check("no venue and no names is unknown", settledSide(resolveSide(sideInput(null))), null);
check(
  "the club names confirm it",
  settledSide(resolveSide({ ...sideInput("HOME"), headerWords: [word("Wigan", 10), word("Bristol", 250)] })),
  "LEFT"
);

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
check("too many images is refused", admitImage({ name: "shot.png", type: "image/png", size: 1000, existingCount: IMAGE_LIMITS.maxImages }).ok, false);
check("too large is refused", admitImage({ name: "shot.png", type: "image/png", size: IMAGE_LIMITS.maxBytes + 1, existingCount: 0 }).ok, false);
check("a non image is refused", admitImage({ name: "notes.txt", type: "text/plain", size: 100, existingCount: 0 }).ok, false);
check("a file with no MIME type but a real extension is admitted", admitImage({ name: "shot.webp", type: "", size: 100, existingCount: 0 }).ok, true);

// ---------------------------------------------------------------------------
console.log("layouts");
check("the default profile is the modern one", defaultProfile().id, "fc25-plus");
check("Summary is the screen that scrolls", summary.scrolls, true);
check("the screens are in tab order", SCREENS.map((screen) => screen.id), ["SUMMARY", "SHOOTING", "PASSING", "DEFENDING"]);
check("Possession and Events are not described at all", SCREENS.map((screen) => screen.id as string).includes("POSSESSION") || SCREENS.map((screen) => screen.id as string).includes("EVENTS"), false);
check("a normalised label drops punctuation", normaliseLabel("Ball Recovery Time (Seconds)"), "ball recovery time seconds");
check("the low confidence line is where the pane says it is", LOW_CONFIDENCE, 0.75);

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
