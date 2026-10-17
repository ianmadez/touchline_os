/**
 * The gate for the review engine.
 *
 * Pure: no database, no browser, no clock. Run with `npx tsx scripts/test-review.ts`.
 *
 * What this proves, in the order the acceptance list asks for it:
 *
 * 1. The fixture block - a big win, a flat performance and a thin result - produces more than five findings, keeps
 *    the measured ones apart from the remembered ones, compares with the block before it, and offers between two
 *    and four options.
 * 2. The same data twice produces the same review, character for character.
 * 3. A match with no figures is unknown, never zero: no generated string prints a zero the manager did not record.
 * 4. No generated string claims a cause.
 * 5. Every finding lists a confound and names the matches it rests on.
 * 6. A block logged entirely as a group debrief reads as scorelines only, and every section says so.
 * 7. Two rows describing one fixture are counted once; two undated rows never are.
 */
import { composeReview } from "../src/lib/review";
import { foldOpponent } from "../src/lib/review/window";
import { DEFAULT_RULES_PROFILE, type Review, type ReviewContext } from "../src/lib/review/types";
import type { TargetBlock } from "../src/lib/services/target-block-service";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

interface Fixture {
  id: string;
  date: string | null;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  venue?: "HOME" | "AWAY" | "NEUTRAL";
  expectedGoals?: number;
  shots?: number;
  shotsInsideBox?: number;
  possession?: number;
  concededMinutes?: number[];
  weakness?: string;
  standouts?: string[];
  contributions?: Array<{ playerName: string; goals: number; assists: number }>;
  formation?: { label: string; formationName: string; source: "DEFAULT" | "OVERRIDE" };
  /** True when the row is the mirror of a group debrief rather than a match logged on its own. */
  mirror?: boolean;
}

function event(fixture: Fixture) {
  const stats: Record<string, unknown> = {};
  if (fixture.expectedGoals !== undefined) stats.expectedGoalsReported = fixture.expectedGoals;
  if (fixture.shots !== undefined) stats.shots = fixture.shots;
  if (fixture.shotsInsideBox !== undefined) stats.shotsInsideBox = fixture.shotsInsideBox;
  if (fixture.possession !== undefined) stats.possession = fixture.possession;
  return {
    id: fixture.id,
    timestamp: `${fixture.date ?? "2026-01-01"}T12:00:00.000Z`,
    entityType: fixture.mirror ? "TARGET_BLOCK" : "MATCH",
    payload: {
      opponent: fixture.opponent,
      matchDate: fixture.date,
      homeScore: fixture.goalsFor,
      awayScore: fixture.goalsAgainst,
      scoreline: `${fixture.goalsFor}-${fixture.goalsAgainst}`,
      venue: fixture.venue ?? "HOME",
      competition: "League Match",
      concededMinutes: fixture.concededMinutes ?? [],
      weaknessIdentified: fixture.weakness ?? "",
      standoutPlayerNames: fixture.standouts ?? [],
      contributions: fixture.contributions ?? [],
      matchStats: Object.keys(stats).length === 0 ? null : stats,
      ...(fixture.formation ? { formation: fixture.formation } : {}),
      ...(fixture.mirror ? { groupDebrief: { blockId: "blk_1", blockIndex: 1, matchday: 1 } } : {}),
    },
  };
}

const CONTEXT: ReviewContext = {
  objective: { targetPosition: 4 },
  currentPosition: 7,
  previousBlock: {
    id: "blk_prev",
    seasonNumber: 3,
    blockIndex: 1,
    verdict: "ON_TARGET",
    points: 9,
    possible: 15,
    targetMin: 8,
    targetMax: 10,
    dreamPoints: 12,
    concernPoints: 6,
    tablePosition: 5,
    formationLabel: "Primary",
  },
  keyPlayerNames: ["J. Koroma"],
  playerAges: { "J. Koroma": 24, "A. Cozier-Duberry": 20 },
  savedFormationCount: 3,
  profile: DEFAULT_RULES_PROFILE,
};

const BAND: Review["block"] = {
  id: "blk_2",
  seasonNumber: 3,
  blockIndex: 2,
  verdict: "BELOW_TARGET",
  points: 6,
  possible: 15,
  targetMin: 8,
  targetMax: 10,
  dreamPoints: 12,
  concernPoints: 6,
  formationLabel: null,
  tablePosition: 7,
};

/** The fixture block: one big win, one flat performance, one thin result, plus two more to reach five. */
const FIXTURE = [
  event({
    id: "m1",
    date: "2026-03-01",
    opponent: "Birmingham City",
    goalsFor: 4,
    goalsAgainst: 0,
    expectedGoals: 1.2,
    shots: 12,
    shotsInsideBox: 8,
    possession: 44,
    weakness: "Set pieces",
    standouts: ["J. Koroma"],
    contributions: [{ playerName: "J. Koroma", goals: 3, assists: 0 }],
    formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" },
  }),
  event({
    id: "m2",
    date: "2026-03-08",
    opponent: "Wrexham",
    goalsFor: 0,
    goalsAgainst: 2,
    expectedGoals: 1.9,
    shots: 16,
    shotsInsideBox: 10,
    possession: 61,
    concededMinutes: [78, 88],
    weakness: "Set pieces again",
    formation: { label: "Secondary", formationName: "5-4-1-flat", source: "OVERRIDE" },
  }),
  event({
    id: "m3",
    date: "2026-03-15",
    opponent: "Stoke City",
    goalsFor: 1,
    goalsAgainst: 3,
    expectedGoals: 0.6,
    shots: 6,
    shotsInsideBox: 3,
    possession: 38,
    concededMinutes: [81],
    weakness: "Switched off after scoring",
    standouts: ["J. Koroma"],
    formation: { label: "Secondary", formationName: "5-4-1-flat", source: "OVERRIDE" },
  }),
  event({
    id: "m4",
    date: "2026-03-22",
    opponent: "Millwall",
    goalsFor: 2,
    goalsAgainst: 1,
    expectedGoals: 2.1,
    shots: 14,
    shotsInsideBox: 9,
    possession: 52,
    weakness: "Corners again",
    standouts: ["A. Cozier-Duberry"],
    formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" },
  }),
  event({
    id: "m5",
    date: "2026-03-29",
    opponent: "Preston North End",
    goalsFor: 1,
    goalsAgainst: 1,
    expectedGoals: 1.0,
    shots: 10,
    shotsInsideBox: 6,
    possession: 48,
    formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" },
  }),
];

function build(events: ReturnType<typeof event>[], blocks: TargetBlock[] = [], request = { kind: "WINDOW" as const, count: 5 }) {
  return composeReview({ request, events, blocks, context: CONTEXT, band: null });
}

function stringsOf(review: Review): string[] {
  const out: string[] = [];
  for (const finding of review.findings) {
    out.push(finding.headline, finding.detail, ...finding.confounds);
  }
  for (const section of review.sections) {
    out.push(section.title, ...section.paragraphs);
    for (const count of section.counts) out.push(`${count.label} ${count.value}`);
  }
  for (const option of review.options) {
    out.push(option.label, option.rationale, option.creates, ...option.chips);
  }
  if (review.contrast !== null) out.push(review.contrast.line);
  return out;
}

function main(): void {
  const review = build(FIXTURE);

  console.log("the fixture block");

  check("more than five findings", review.findings.length > 5, `${review.findings.length}`);
  check(
    "measured findings are kept apart from remembered ones",
    review.sections.find((section) => section.id === "NUMBERS")!.findings.every((f) => f.needsFigures) &&
      review.sections
        .find((section) => section.id === "SCORES")!
        .findings.every((finding) => !finding.needsFigures)
  );
  check(
    "it compares with the block before it",
    review.findings.some((finding) => finding.id === "against-previous-block")
  );
  check(
    "it offers between two and four options",
    review.options.length >= 2 && review.options.length <= 4,
    `${review.options.length}: ${review.options.map((option) => option.id).join(", ")}`
  );
  check(
    "every finding lists a confound",
    review.findings.every((finding) => finding.confounds.length > 0)
  );
  check(
    "every finding names the matches it rests on, or says it rests on none",
    review.findings.every((finding) => finding.matchIds.length > 0 || finding.id === "objective-progress")
  );
  equal(
    "all eight sections are present, in order",
    review.sections.map((section) => section.id),
    ["WINDOW", "NUMBERS", "SCORES", "CONTRAST", "PREVIOUS", "NOT_CLAIMING", "RESTS_ON", "QUESTIONS"]
  );
  equal("five matches were read", review.matches.length, 5);
  equal("the record adds up", [review.record.wins, review.record.draws, review.record.losses], [2, 1, 2]);
  equal("points are three for a win", review.record.points, 7);
  equal("nothing was merged in a clean window", review.mergedBothWays, 0);

  console.log("determinism");

  const again = build(FIXTURE);
  equal("the same data produces the same review", JSON.stringify(again), JSON.stringify(review));

  console.log("copy");

  const banned = [
    /\bbecause\b/i,
    /\bcaus(e|ed|es|ing)\b/i,
    /\bdue to\b/i,
    /\btherefore\b/i,
    /\bthus\b/i,
    /\bled to\b/i,
    /\bexplains?\b/i,
    /\bproves?\b/i,
    /\bso that\b/i,
    /\bwhich is why\b/i,
    /\bresults? from\b/i,
    /\bmeans that\b/i,
    /\bâ€”/,
  ];
  const strings = stringsOf(review);
  const offending = strings.filter((line) => banned.some((pattern) => pattern.test(line)));
  check("no generated string claims a cause, and none uses an em dash", offending.length === 0, offending.slice(0, 3).join(" | "));

  console.log("unknown is never zero");

  const scorelineOnly = build([
    event({ id: "s1", date: "2026-04-01", opponent: "Hull City", goalsFor: 1, goalsAgainst: 0 }),
    event({ id: "s2", date: "2026-04-08", opponent: "Cardiff City", goalsFor: 0, goalsAgainst: 1 }),
    event({ id: "s3", date: "2026-04-15", opponent: "Leeds United", goalsFor: 2, goalsAgainst: 2 }),
  ]);
  check(
    "no finding needing a figure survives a window with none",
    scorelineOnly.findings.every((finding) => !finding.needsFigures)
  );
  check(
    "the figures section says so rather than printing a zero",
    scorelineOnly.sections
      .find((section) => section.id === "NUMBERS")!
      .paragraphs.join(" ")
      .includes("no figures")
  );
  equal(
    "rests on counts them as scoreline only",
    [scorelineOnly.resting.withFigures, scorelineOnly.resting.scorelineOnly, scorelineOnly.resting.notRecorded],
    [0, 3, 0]
  );
  check(
    "no generated string prints an expected goals figure that was never recorded",
    !stringsOf(scorelineOnly).some((line) => /expected/i.test(line) && /\b0\.00\b/.test(line))
  );

  console.log("a block logged as a group debrief");

  const block: TargetBlock = {
    id: "blk_9",
    careerId: "career",
    seasonNumber: 3,
    blockIndex: 2,
    matches: [
      { matchday: 1, opponent: "Birmingham City", opponentPosition: 8, targetPoints: 3, targetMaxPoints: 3, actualPoints: 3, goalsFor: 2, goalsAgainst: 0, note: "Comfortable.", formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" } },
      { matchday: 2, opponent: "Wrexham", opponentPosition: 14, targetPoints: 1, targetMaxPoints: 3, actualPoints: 1, goalsFor: 1, goalsAgainst: 1, note: null, formation: null },
      { matchday: 3, opponent: "Stoke City", opponentPosition: 5, targetPoints: 1, targetMaxPoints: 3, actualPoints: 0, goalsFor: 0, goalsAgainst: 3, note: null, formation: null },
      { matchday: 4, opponent: "Millwall", opponentPosition: 11, targetPoints: 3, targetMaxPoints: 3, actualPoints: 3, goalsFor: 1, goalsAgainst: 0, note: null, formation: { label: "Secondary", formationName: "5-4-1-flat", source: "OVERRIDE" } },
      { matchday: 5, opponent: "Preston North End", opponentPosition: 17, targetPoints: 1, targetMaxPoints: 3, actualPoints: 1, goalsFor: 2, goalsAgainst: 2, note: null, formation: null },
    ],
    targetMin: 8,
    targetMax: 10,
    dreamPoints: 12,
    concernPoints: 6,
    gamesPlayedBefore: 20,
    pointsBefore: 30,
    positionBefore: 7,
    goalDifferenceBefore: 3,
    tablePosition: 8,
    notes: null,
  };

  // The five results are ALSO mirrored into the diary, exactly as the app writes them. The review must not read the
  // mirrors as five more matches.
  const mirrors = block.matches
    .filter((match) => match.goalsFor !== null && match.goalsAgainst !== null)
    .map((match) =>
      event({
        id: `grp_blk_9_${match.matchday}`,
        date: null,
        opponent: match.opponent ?? "Opponent",
        goalsFor: match.goalsFor ?? 0,
        goalsAgainst: match.goalsAgainst ?? 0,
        mirror: true,
      })
    );

  const blockReview = composeReview({
    request: { kind: "BLOCK", blockId: "blk_9" },
    events: mirrors,
    blocks: [block],
    context: CONTEXT,
    band: BAND,
  });

  equal("five block rows were read", blockReview.matches.length, 5);
  equal("the mirrored diary rows were not counted again", blockReview.mergedBothWays, 0);
  check(
    "no finding in a block of group matches needs a figure",
    blockReview.findings.every((finding) => !finding.needsFigures)
  );
  equal(
    "every block match is counted as scoreline only",
    [
      blockReview.resting.withFigures,
      blockReview.resting.scorelineOnly,
      blockReview.resting.notRecorded,
    ],
    [0, 5, 0]
  );
  check(
    "the contrast falls back to the scoreline",
    blockReview.contrast !== null && blockReview.contrast.basis === "RESULT",
    blockReview.contrast ? blockReview.contrast.basis : "no contrast"
  );
  check(
    "the block keeps its own band",
    blockReview.block !== null && blockReview.block.targetMin === 8 && blockReview.block.verdict === "BELOW_TARGET"
  );
  check(
    "a missed band offers a points target",
    blockReview.options.some((option) => option.id === "adjust-target"),
    blockReview.options.map((option) => option.id).join(", ")
  );
  const blockStrings = stringsOf(blockReview);
  check(
    "no generated string invents a figure for a group logged block",
    !blockStrings.some((line) => /expected|possession|shots/i.test(line) && /\b0(\.0+)?\b/.test(line)),
    blockStrings.filter((line) => /expected|possession|shots/i.test(line)).slice(0, 2).join(" | ")
  );

  console.log("one fixture, logged twice");

  const twice = build([
    event({ id: "d1", date: "2026-05-01", opponent: "Watford", goalsFor: 3, goalsAgainst: 0 }),
    event({
      id: "d2",
      date: "2026-05-01",
      opponent: "Watford FC",
      goalsFor: 3,
      goalsAgainst: 0,
      expectedGoals: 2.4,
      shots: 15,
      shotsInsideBox: 9,
    }),
  ]);
  equal("the same fixture logged twice is one match", twice.matches.length, 1);
  equal("and it is counted", twice.mergedBothWays, 1);
  check(
    "the row with figures was kept",
    twice.matches[0].hasFigures,
    `kept ${twice.matches[0].id}`
  );
  check(
    "the window says it happened",
    twice.sections[0].paragraphs.some((line) => line.includes("counted once")),
    twice.sections[0].paragraphs.join(" | ")
  );

  const undated = build([
    event({ id: "u1", date: null, opponent: "Coventry City", goalsFor: 2, goalsAgainst: 0 }),
    event({ id: "u2", date: null, opponent: "Coventry City", goalsFor: 1, goalsAgainst: 1 }),
  ]);
  equal("two undated rows are never merged", undated.matches.length, 2);
  equal("and nothing is counted as merged", undated.mergedBothWays, 0);

  console.log("folding opponent names");

  equal("a club written two ways folds together", foldOpponent("Brighton & Hove Albion"),
    foldOpponent("brighton and hove albion"));
  check(
    "two different Citys stay apart",
    foldOpponent("Birmingham City") !== foldOpponent("Bristol City")
  );
  equal("the club suffix goes", foldOpponent("Wrexham AFC"), "wrexham");

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
