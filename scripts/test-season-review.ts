/**
 * The gate for the season handover.
 *
 * Two halves. The first is pure and proves the page: eight sections at most, a save half that never borrows from the
 * observed half, a carry-over list that defaults to keep, and copy that neither claims a cause nor uses an em dash.
 * The second runs against a COPY and proves the transition is idempotent: a second run changes nothing and does not
 * write a second boundary event.
 *
 *   Copy-Item data/touchline.db data/touchline.season-test.db   # + -wal / -shm if present
 *   $env:DATABASE_URL="<abs>/data/touchline.season-test.db"
 *   npx tsx scripts/test-season-review.ts
 */
import { and, eq } from "drizzle-orm";

import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { careerEvents } from "../src/lib/db/schema";
import { carryOverOptionId, carryOverReviewKey, composeSeasonReview } from "../src/lib/season/handover";
import { SeasonService } from "../src/lib/services/season-service";
import type { SeasonDossier } from "../src/lib/services/season-archive-service";
import type { HypothesisWithEvidence } from "../src/lib/hypotheses/types";
import type { Assignment } from "../src/lib/assignments/types";
import type { ReviewBlockBand } from "../src/lib/review/types";
import { resolveLeagueName } from "../src/lib/ui/leagues";

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

function band(blockIndex: number, points: number, formationLabel: string | null): ReviewBlockBand {
  return {
    id: `blk_${blockIndex}`,
    seasonNumber: 3,
    blockIndex,
    verdict: points >= 8 ? "ON_TARGET" : "BELOW_TARGET",
    points,
    possible: 15,
    targetMin: 8,
    targetMax: 10,
    dreamPoints: 12,
    concernPoints: 6,
    tablePosition: 7,
    formationLabel,
  };
}

const DOSSIER: SeasonDossier = {
  season: 3,
  complete: true,
  current: false,
  fromSave: {
    leagueId: 1,
    leagueName: "Championship",
    played: 46,
    wins: 20,
    draws: 12,
    losses: 14,
    points: 72,
    goalsFor: 68,
    goalsAgainst: 55,
    goalDifference: 13,
    tablePosition: 7,
    boardObjectiveCode: 2,
    boardObjectiveResult: 4,
    domesticCupObjective: null,
    europeCupObjective: null,
    leagueTrophies: 0,
    biggestSigning: { name: "A. Striker", fee: 1_500_000 },
    biggestSale: null,
  },
  coverage: {
    observed: true,
    from: "2026-08-01T00:00:00.000Z",
    to: "2027-05-30T00:00:00.000Z",
    saveRecordWhenFirstSeen: { played: 10, points: 15, position: 9 },
  },
  observed: {
    snapshots: {
      count: 12,
      firstNumber: 1,
      lastNumber: 12,
      firstInGameDate: "2026-08-01",
      lastInGameDate: "2027-05-25",
      allIdentical: false,
    },
    ourRecord: {
      logged: 5,
      wins: 2,
      draws: 1,
      losses: 2,
      goalsFor: 7,
      goalsAgainst: 6,
      points: 7,
      unreadable: 0,
    },
    debriefs: {
      logged: 5,
      unreadable: 0,
      scorers: [{ name: "J. Koroma", goals: 4, assists: 1, matches: 4 }],
      standouts: [{ name: "J. Koroma", times: 3 }],
      weaknesses: [
        { note: "Corners again", matchDate: "2027-01-01" },
        { note: "Set pieces", matchDate: "2027-02-01" },
      ],
      reflections: [{ note: "We are close.", matchDate: "2027-05-01" }],
      prompts: [],
      venues: { home: 3, away: 2, neutral: 0 },
      competitions: [{ name: "League Match", matches: 5 }],
      goalsFor: 7,
      goalsAgainst: 6,
    },
    squad: {
      firstSnapshot: { number: 1, inGameDate: "2026-08-01" },
      lastSnapshot: { number: 12, inGameDate: "2027-05-25" },
      sizeFirst: 24,
      sizeLast: 25,
      arrivals: ["A. Striker"],
      arrivalCount: 1,
      departures: [],
      departureCount: 0,
      risers: [{ name: "J. Koroma", from: 68, to: 72, delta: 4 }],
      fallers: [{ name: "V. Old", from: 70, to: 67, delta: -3 }],
      youthCount: 3,
      avgOverallFirst: 69,
      avgOverallLast: 70,
      wageBillFirst: 120_000,
      wageBillLast: 135_000,
    },
    finance: {
      transferBudget: { first: 2_000_000, last: 750_000 },
      wageBudget: { first: 130_000, last: 140_000 },
      totalEarnings: { first: null, last: null },
      recordBuy: 1_500_000,
      recordSale: 400_000,
    },
    storylines: [],
    objectives: [
      {
        id: "obj_user",
        source: "USER",
        text: "Push for the play-offs",
        targetPosition: 4,
        status: "MISSED",
        outcome: "Finished 7, target was 4 or better.",
        openedAt: "2026-08-01T00:00:00.000Z",
        closedAt: "2027-05-30T00:00:00.000Z",
      },
      {
        id: "obj_save",
        source: "SAVE",
        text: null,
        targetPosition: null,
        status: "CLOSED",
        outcome: "EA's objective result code: 4.",
        openedAt: "2026-08-01T00:00:00.000Z",
        closedAt: "2027-05-30T00:00:00.000Z",
      },
    ],
    boardObjectives: [
      { id: "bo_1", category: "YOUTH", priority: 3, title: "Give youth a chance", status: "ON_TRACK", notes: null },
      { id: "bo_2", category: "FINANCIAL", priority: 2, title: "Trim the wage bill", status: "AT_RISK", notes: null },
    ],
    positions: [],
    timeline: [],
    unplacedStorylines: 0,
  },
};

const HYPOTHESIS: HypothesisWithEvidence = {
  id: "hyp_1",
  careerId: "career",
  seasonNumber: 3,
  claim: "We concede late.",
  question: "Who was on the pitch?",
  ruleKey: "performance:late-goals",
  origin: "ACCEPTED",
  status: "INVESTIGATING",
  kind: "PERFORMANCE",
  reviewAfterMatches: 5,
  matchesSeen: 3,
  formationLabel: null,
  playerIds: [],
  objectiveId: null,
  storylineId: null,
  managerNote: null,
  verdictReason: null,
  openedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  resolvedAt: null,
  evidence: [],
  forCount: 2,
  againstCount: 1,
};

const ASSIGNMENT: Assignment = {
  id: "asg_1",
  careerId: "career",
  seasonNumber: 3,
  type: "POINTS_TARGET",
  status: "ACTIVE",
  targetPoints: 9,
  formationLabel: null,
  matchesTarget: 5,
  playerId: null,
  blockIndex: 3,
  verdict: null,
  reviewKey: null,
  createdAt: "2027-01-01T00:00:00.000Z",
  updatedAt: "2027-01-01T00:00:00.000Z",
  closedAt: null,
};

function pureHalf(): void {
  const review = composeSeasonReview({
    dossier: DOSSIER,
    blocks: [band(1, 9, "Primary"), band(2, 7, "Primary"), band(3, 4, "Secondary")],
    hypotheses: [HYPOTHESIS],
    assignments: [ASSIGNMENT],
  });

  console.log("the page");
  equal("the season is named", review.season, 3);
  check("it reads as finished", review.complete);
  check(
    "the headline leads with the position",
    review.headline.includes("7th") && review.headline.includes("Championship"),
    review.headline
  );
  check("the subhead carries the record", review.subhead.includes("72 points"), review.subhead);
  check(
    "all eight sections are present",
    review.sections.length === 8,
    review.sections.map((section) => section.id).join(", ")
  );
  check(
    "every section names which half it came from",
    review.sections.every((section) => ["SAVE", "OBSERVED", "USER"].includes(section.provenance))
  );
  check(
    "the record quotes the save's own position",
    review.sections
      .find((section) => section.id === "RECORD")!
      .counts.some((count) => count.label === "Position" && count.value === "7th")
  );
  check(
    "the objectives section judges the user's target and quotes the board's code",
    review.sections.find((section) => section.id === "OBJECTIVES")!.lines.some((line) => line.includes("target 4th")) &&
      review.sections.find((section) => section.id === "OBJECTIVES")!.lines.some((line) => line.includes("result code"))
  );
  check(
    "tactics compare the two shapes",
    review.sections.find((section) => section.id === "TACTICS")!.lines.some((line) => line.includes("Primary")),
    review.sections.find((section) => section.id === "TACTICS")!.lines.join(" | ")
  );
  check(
    "the patterns section groups the notes rather than quoting them",
    review.sections.find((section) => section.id === "PATTERNS")!.lines.some((line) => line.includes("set pieces")),
    review.sections.find((section) => section.id === "PATTERNS")!.lines.join(" | ")
  );
  check(
    "the closing word is the manager's own last note",
    review.closing === "We are close.",
    String(review.closing)
  );

  console.log("what carries over");
  equal(
    "four kinds are offered",
    review.carryOver.map((item) => item.kind),
    ["OBJECTIVE", "HYPOTHESIS", "ASSIGNMENT", "FORMATION"]
  );
  check(
    "the missed target is offered again",
    review.carryOver[0].label.includes("4th"),
    review.carryOver[0].label
  );
  equal(
    "each item has a stable storage key",
    review.carryOver.map((item) => carryOverOptionId(item.kind, item.refId)),
    [
      "OBJECTIVE:obj_user",
      "HYPOTHESIS:hyp_1",
      "ASSIGNMENT:asg_1",
      "FORMATION:Primary",
    ]
  );
  equal("decisions live under a per-season key", carryOverReviewKey(3), "carry:3");

  console.log("nothing is invented");
  const unobserved = composeSeasonReview({
    dossier: {
      ...DOSSIER,
      coverage: { observed: false, from: null, to: null, saveRecordWhenFirstSeen: null },
      observed: null,
    },
    blocks: [],
    hypotheses: [],
    assignments: [],
  });
  check(
    "a season we never watched says so rather than showing empty tables",
    unobserved.sections
      .find((section) => section.id === "RECORD")!
      .lines.some((line) => line.includes("not watching"))
  );
  equal("and nothing carries over", unobserved.carryOver.length, 0);

  console.log("copy");
  const banned = [/—/, /\bbecause\b/i, /\bcaus(e|ed|es)\b/i, /\bdue to\b/i, /\btherefore\b/i, /\bseamless/i, /\brobust\b/i];
  const strings = review.sections.flatMap((section) => [section.title, ...section.lines]);
  const offending = strings.filter((line) => banned.some((pattern) => pattern.test(line)));
  check("no em dash, no causal verb, no marketing filler", offending.length === 0, offending.slice(0, 2).join(" | "));

  // A stored code must never reach the page as an identifier. `ON_TRACK` lower-cased prints `on_track`, which is what
  // the objectives section used to do.
  const identifiers = strings.filter((line) => /\b[a-z]+_[a-z_]+\b/.test(line));
  check(
    "no stored code is printed as an identifier",
    identifiers.length === 0,
    identifiers.slice(0, 2).join(" | ")
  );
  check(
    "a board goal's status reads as words",
    review.sections
      .find((section) => section.id === "OBJECTIVES")!
      .lines.some((line) => line.includes("Give youth a chance: On track")),
    review.sections.find((section) => section.id === "OBJECTIVES")!.lines.join(" | ")
  );
  const unknownStatus = composeSeasonReview({
    dossier: {
      ...DOSSIER,
      observed: {
        ...DOSSIER.observed!,
        boardObjectives: [
          { id: "bo_3", category: "BRAND", priority: 4, title: "Grow the brand", status: "UNMAPPED_CODE", notes: null },
        ],
      },
    },
    blocks: [],
    hypotheses: [],
    assignments: [],
  });
  check(
    "and a status this app does not know is passed through rather than guessed",
    unknownStatus.sections
      .find((section) => section.id === "OBJECTIVES")!
      .lines.some((line) => line.includes("Grow the brand: UNMAPPED_CODE")),
    unknownStatus.sections.find((section) => section.id === "OBJECTIVES")!.lines.join(" | ")
  );

  // The save writes its own competition name with a trailing tier marker. The headline must not carry it.
  check(
    "the league name drops the save's tier suffix",
    !/\(\d+\)/.test(review.headline),
    review.headline
  );
  equal("and it uses this app's wording", resolveLeagueName("England League One (3)"), "League One");
}

/** The transition must be idempotent: a second run changes nothing and writes no second boundary event. */
async function databaseHalf(): Promise<void> {
  console.log("\nthe transition (on a copy)");
  const service = new SeasonService();
  const history = await service.getSeasonHistory(process.env.SEASON_TEST_CAREER ?? "career_club_1917");
  const complete = history.filter((season) => season.complete);
  if (complete.length === 0) {
    console.log("  SKIP  this career has no completed season, so there is no boundary to mark");
    return;
  }

  const careerId = process.env.SEASON_TEST_CAREER ?? "career_club_1917";
  await service.evaluateSeasonTransition(careerId);
  const first = await service.evaluateSeasonTransition(careerId);
  equal("a second run changes nothing", first, 0);

  const boundaries = await db
    .select({ id: careerEvents.id })
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "SEASON_ENDED")));
  equal("one boundary event per completed season", boundaries.length, complete.length);
  const third = await service.evaluateSeasonTransition(careerId);
  const after = await db
    .select({ id: careerEvents.id })
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "SEASON_ENDED")));
  equal("and a third run adds no event", after.length, boundaries.length + third);
}

async function main(): Promise<void> {
  pureHalf();
  if (config.databasePath.includes("season-test")) {
    await databaseHalf();
  } else {
    console.log("\nSkipping the transition half: DATABASE_URL must point at a season-test copy to write anything.");
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
