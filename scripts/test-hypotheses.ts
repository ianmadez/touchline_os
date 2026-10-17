/**
 * The gate for hypotheses.
 *
 * Two halves. The first is pure and proves the rules: what gets proposed, how a match is read against a claim, when a
 * verdict is offered, and which one extra question a save deserves. The second runs against a COPY of the database and
 * proves the lifecycle: accept, amend, drop, evidence idempotency, a new match updating rather than duplicating, and a
 * verdict that only lands when the manager confirms it.
 *
 *   Copy-Item data/touchline.db data/touchline.hypotheses-test.db   # + -wal / -shm if present
 *   $env:DATABASE_URL="<abs>/data/touchline.hypotheses-test.db"
 *   npx tsx scripts/test-hypotheses.ts
 */
import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { careerEvents, hypothesisEvidence, hypotheses } from "../src/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { composeReview } from "../src/lib/review";
import { evidenceFor, evidenceRowId, stanceFor } from "../src/lib/hypotheses/evidence";
import { proposeFromReview } from "../src/lib/hypotheses/proposals";
import { nextQuestion, progressOf, questionsThisSaveAnswers, verdictFor } from "../src/lib/hypotheses/verdict";
import { HypothesisStore, hypothesisIdFor } from "../src/lib/hypotheses/store";
import {
  DEFAULT_RULES_PROFILE,
  type ReviewContext,
  type ReviewMatch,
} from "../src/lib/review/types";
import type { HypothesisWithEvidence } from "../src/lib/hypotheses/types";

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

function match(overrides: Partial<ReviewMatch> & { id: string }): ReviewMatch {
  return {
    date: "2026-03-01",
    opponent: "Opponent",
    foldedOpponent: "opponent",
    venue: "HOME",
    competition: "League Match",
    goalsFor: 1,
    goalsAgainst: 1,
    points: 1,
    formation: null,
    figures: {
      expectedGoals: null,
      shots: null,
      shotsInsideBox: null,
      possession: null,
      passesCompleted: null,
    },
    hasFigures: false,
    goalMinutes: [],
    concededMinutes: [],
    weakness: null,
    standouts: [],
    contributions: [],
    source: "DEBRIEF",
    ...overrides,
  };
}

/** A window with three late goals, three notes about corners, three matches under their chances and two shapes. */
const MATCHES: ReviewMatch[] = [
  match({
    id: "evt_a",
    date: "2026-03-01",
    opponent: "Birmingham City",
    foldedOpponent: "birmingham city",
    goalsFor: 1,
    goalsAgainst: 2,
    points: 0,
    concededMinutes: [78, 88],
    weakness: "Corners again",
    figures: { expectedGoals: 2.1, shots: 12, shotsInsideBox: 8, possession: 55, passesCompleted: 400 },
    hasFigures: true,
    formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" },
  }),
  match({
    id: "evt_b",
    date: "2026-03-08",
    opponent: "Wrexham",
    foldedOpponent: "wrexham",
    goalsFor: 0,
    goalsAgainst: 1,
    points: 0,
    concededMinutes: [81],
    weakness: "Set pieces killing us",
    figures: { expectedGoals: 1.4, shots: 9, shotsInsideBox: 5, possession: 48, passesCompleted: 350 },
    hasFigures: true,
    formation: { label: "Primary", formationName: "4-4-2-flat", source: "DEFAULT" },
  }),
  match({
    id: "evt_c",
    date: "2026-03-15",
    opponent: "Stoke City",
    foldedOpponent: "stoke city",
    goalsFor: 0,
    goalsAgainst: 3,
    points: 0,
    concededMinutes: [64],
    weakness: "Corners",
    figures: { expectedGoals: 0.9, shots: 7, shotsInsideBox: 4, possession: 41, passesCompleted: 300 },
    hasFigures: true,
    formation: { label: "Secondary", formationName: "5-4-1-flat", source: "OVERRIDE" },
  }),
  match({
    id: "evt_d",
    date: "2026-03-22",
    opponent: "Millwall",
    foldedOpponent: "millwall",
    goalsFor: 3,
    goalsAgainst: 0,
    points: 3,
    figures: { expectedGoals: 1.1, shots: 10, shotsInsideBox: 6, possession: 44, passesCompleted: 320 },
    hasFigures: true,
    formation: { label: "Secondary", formationName: "5-4-1-flat", source: "OVERRIDE" },
  }),
];

const CONTEXT: ReviewContext = {
  objective: null,
  currentPosition: null,
  previousBlock: null,
  keyPlayerNames: [],
  playerAges: {},
  savedFormationCount: 2,
  profile: DEFAULT_RULES_PROFILE,
};

function fixtureReview() {
  return composeReview({
    request: { kind: "WINDOW", count: 5 },
    events: [],
    blocks: [],
    context: CONTEXT,
    band: null,
    // The window is supplied directly so the test does not depend on stored event payloads.
    ...({} as Record<string, never>),
  });
}

async function pureHalf(): Promise<void> {
  console.log("proposals");
  // The engine composes from events, so the fixtures are turned into events once here.
  const review = composeReview({
    request: { kind: "WINDOW", count: 5 },
    events: MATCHES.map((entry) => ({
      id: entry.id,
      timestamp: `${entry.date}T12:00:00.000Z`,
      entityType: "MATCH",
      payload: {
        opponent: entry.opponent,
        matchDate: entry.date,
        homeScore: entry.goalsFor,
        awayScore: entry.goalsAgainst,
        concededMinutes: entry.concededMinutes,
        weaknessIdentified: entry.weakness,
        matchStats: {
          expectedGoalsReported: entry.figures.expectedGoals,
          shots: entry.figures.shots,
          shotsInsideBox: entry.figures.shotsInsideBox,
          possession: entry.figures.possession,
        },
        formation: entry.formation,
      },
    })),
    blocks: [],
    context: CONTEXT,
    band: null,
  });
  equal("four distinct fixtures survive the window", review.matches.length, 4);

  const proposals = proposeFromReview(review, []);
  check("late goals are proposed", proposals.some((entry) => entry.key === "performance:late-goals"));
  check("a recurring weakness is proposed", proposals.some((entry) => entry.key.startsWith("set-piece:")));
  check(
    "chances against goals are proposed",
    proposals.some((entry) => entry.key === "performance:chances-not-goals")
  );
  check("a shape contrast is proposed", proposals.some((entry) => entry.key.startsWith("tactical:shape-")));
  check(
    "every proposal carries a why with a count in it",
    proposals.every((entry) => /\d/.test(entry.why))
  );
  equal(
    "an accepted proposal is not offered again",
    proposeFromReview(review, ["performance:late-goals"]).some((entry) => entry.key === "performance:late-goals"),
    false
  );

  console.log("reading a match against a claim");
  equal(
    "a late goal stands for the late goal claim",
    stanceFor("performance:late-goals", null, MATCHES[0]),
    "FOR"
  );
  equal(
    "a match with timings but no late goal argues against it",
    stanceFor("performance:late-goals", null, MATCHES[2]),
    "AGAINST"
  );
  equal(
    "a match with no timing says nothing",
    stanceFor("performance:late-goals", null, match({ id: "x" })),
    null
  );
  equal(
    "a corners note stands for a corners question",
    stanceFor("set-piece:set-pieces", null, MATCHES[0]),
    "FOR"
  );
  equal(
    "a question the manager wrote himself is never auto-classified",
    stanceFor(null, null, MATCHES[0]),
    null
  );
  equal(
    "a shape question reads the shape",
    stanceFor("tactical:shape-Primary", "Primary", MATCHES[2]),
    "AGAINST"
  );

  console.log("evidence ids are derived");
  equal(
    "the same pair always produces the same id",
    evidenceRowId("hyp_1", "evt_a"),
    evidenceRowId("hyp_1", "evt_a")
  );
  check(
    "and a different match produces a different one",
    evidenceRowId("hyp_1", "evt_a") !== evidenceRowId("hyp_1", "evt_b")
  );
  const rows = evidenceFor("hyp_1", "performance:late-goals", null, MATCHES);
  equal("two late matches and one without, three rows", rows.length, 3);
  equal(
    "the ones that had nothing to say are left out",
    rows.filter((row) => row.stance === "AGAINST").length,
    1
  );

  console.log("verdicts");
  const base: HypothesisWithEvidence = {
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
    matchesSeen: 4,
    formationLabel: null,
    playerIds: [],
    objectiveId: null,
    storylineId: null,
    managerNote: null,
    verdictReason: null,
    openedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    resolvedAt: null,
    evidence: [],
    forCount: 3,
    againstCount: 1,
  };
  equal("too early for a verdict", verdictFor(base), null);
  const ready = { ...base, matchesSeen: 5 };
  equal("a strong majority supports it", verdictFor(ready)?.status, "SUPPORTED");
  equal(
    "a strong majority the other way weakens it",
    verdictFor({ ...ready, forCount: 1, againstCount: 4 })?.status,
    "WEAKENED"
  );
  equal(
    "a split leaves it open",
    verdictFor({ ...ready, forCount: 3, againstCount: 2 })?.status,
    "INCONCLUSIVE"
  );
  equal(
    "no evidence at all is inconclusive rather than supported",
    verdictFor({ ...ready, forCount: 0, againstCount: 0 })?.status,
    "INCONCLUSIVE"
  );
  check(
    "every verdict carries its reason with the counts in it",
    (verdictFor(ready)?.reason ?? "").includes("3")
  );

  console.log("the one extra question");
  const older = { ...base, id: "hyp_old", matchesSeen: 1 };
  const closer = { ...base, id: "hyp_close", matchesSeen: 4 };
  equal(
    "the question closest to a verdict wins",
    nextQuestion([older, closer])?.hypothesis.id,
    "hyp_close"
  );
  equal(
    "a question already at its threshold is not asked again",
    nextQuestion([{ ...ready }]),
    null
  );
  equal("progress is a share of the matches it asked for", progressOf(closer), 0.8);

  console.log("which questions a save speaks to");
  const speaks = questionsThisSaveAnswers(
    [{ ...base, evidence: [{ eventId: "evt_a", stance: "FOR", note: null }] }],
    ["evt_a", "evt_b"]
  );
  equal("a matching event brings the question up", speaks.length, 1);
  equal(
    "an unrelated event brings nothing up",
    questionsThisSaveAnswers([{ ...base, evidence: [{ eventId: "evt_z", stance: "FOR", note: null }] }], ["evt_a"]).length,
    0
  );
}

async function databaseHalf(): Promise<void> {
  console.log("\nthe lifecycle (on a copy)");
  const CAREER = process.env.HYPOTHESES_TEST_CAREER ?? "career_club_1917";
  const store = new HypothesisStore();
  const key = "test:late-goals";
  const id = hypothesisIdFor(CAREER, key);

  await db.delete(hypothesisEvidence).where(eq(hypothesisEvidence.hypothesisId, id));
  await db.delete(hypotheses).where(eq(hypotheses.id, id));

  const created = await store.accept(CAREER, {
    key,
    kind: "PERFORMANCE",
    claim: "We concede late.",
    question: "Who was on the pitch?",
    ruleKey: "performance:late-goals",
    seasonNumber: 3,
    formationLabel: null,
    reviewAfterMatches: 2,
    origin: "ACCEPTED",
  });
  check("accepting a proposal opens a question", created.status === "INVESTIGATING");
  equal("and it starts with no matches seen", created.matchesSeen, 0);

  const again = await store.accept(CAREER, {
    key,
    kind: "PERFORMANCE",
    claim: "We concede late.",
    question: "Who was on the pitch?",
    ruleKey: "performance:late-goals",
    seasonNumber: 3,
    formationLabel: null,
    reviewAfterMatches: 2,
    origin: "ACCEPTED",
  });
  equal("accepting twice adopts rather than duplicates", again.id, created.id);
  equal(
    "and there is still one row",
    (await store.list(CAREER)).filter((entry) => entry.id === created.id).length,
    1
  );

  const amended = await store.amend(created.id, { claim: "We concede after the 75th minute.", managerNote: "Watch the subs." });
  equal("amending rewrites the claim", amended?.claim, "We concede after the 75th minute.");

  const matchA = match({ id: "evt_late_1", concededMinutes: [80] });
  const matchB = match({ id: "evt_late_2", concededMinutes: [30] });
  const matchC = match({ id: "evt_late_3", concededMinutes: [90] });
  const silent = match({ id: "evt_late_4", concededMinutes: [] });

  // Evidence points at a real event, so the fixtures have to be real rows: the foreign key is the reason a hypothesis
  // cannot cite a match that does not exist.
  await db.insert(careerEvents).values(
    [matchA, matchB, matchC].map((entry) => ({
      id: entry.id,
      careerId: CAREER,
      eventType: "MATCH_DEBRIEF",
      source: "USER" as const,
      entityType: "MATCH",
      entityId: entry.id,
      payloadJson: JSON.stringify({ opponent: entry.opponent, matchDate: entry.date }),
      timestamp: "2026-03-30T12:00:00.000Z",
    }))
  );

  const first = await store.syncForMatches(CAREER, [matchA, matchB]);
  equal("the first sync writes two rows", first.added, 2);
  const second = await store.syncForMatches(CAREER, [matchA, matchB]);
  equal("the second sync writes nothing", second.added, 0);
  const withSilent = await store.syncForMatches(CAREER, [matchA, matchB, silent]);
  equal("a match with nothing to say writes nothing", withSilent.added, 0);
  const afterTwo = (await store.list(CAREER)).find((entry) => entry.id === created.id);
  equal("and the count is matches, not saves", afterTwo?.matchesSeen, 2);
  equal("one stand for, one against", [afterTwo?.forCount, afterTwo?.againstCount], [1, 1]);

  const third = await store.syncForMatches(CAREER, [matchA, matchB, matchC]);
  equal("a new match adds one row", third.added, 1);
  equal(
    "and does not duplicate the old ones",
    (await store.list(CAREER)).find((entry) => entry.id === created.id)?.matchesSeen,
    3
  );

  const beforeVerdict = (await store.list(CAREER)).find((entry) => entry.id === created.id);
  equal("the engine offers nothing until the manager confirms", beforeVerdict?.status, "INVESTIGATING");
  const confirmed = await store.confirmVerdict(created.id);
  equal("confirming closes it", confirmed.closed, true);
  check(
    "with the status the count supports",
    confirmed.hypothesis?.status === "INCONCLUSIVE" || confirmed.hypothesis?.status === "SUPPORTED",
    String(confirmed.hypothesis?.status)
  );
  check("and a reason in words", (confirmed.reason ?? "").length > 10, confirmed.reason ?? "");

  const dropped = await store.drop(created.id);
  equal("dropping closes it too", dropped?.status, "RESOLVED");
  check(
    "and says the question stands unanswered",
    (dropped?.verdictReason ?? "").includes("unanswered"),
    dropped?.verdictReason ?? ""
  );
  check(
    "a dropped question is still tracked, so it is not proposed again",
    (await store.list(CAREER)).some((entry) => entry.id === created.id)
  );

  const confirmedAgain = await store.accept(CAREER, {
    key,
    kind: "PERFORMANCE",
    claim: "We concede late.",
    question: null,
    ruleKey: "performance:late-goals",
    seasonNumber: 3,
    formationLabel: null,
    reviewAfterMatches: 2,
    origin: "ACCEPTED",
  });
  equal("accepting it again reopens it rather than opening a twin", confirmedAgain.id, created.id);
  equal("and it is investigating once more", confirmedAgain.status, "INVESTIGATING");

  await db.delete(hypotheses).where(eq(hypotheses.id, created.id));
  await db
    .delete(careerEvents)
    .where(inArray(careerEvents.id, ["evt_late_1", "evt_late_2", "evt_late_3"]));
  console.log("  CLEANED the test question out of the copy");
}

async function main(): Promise<void> {
  await pureHalf();
  if (!config.databasePath.includes("hypotheses-test")) {
    console.log(
      "\nSkipping the lifecycle half: DATABASE_URL must point at a hypotheses-test copy to write anything."
    );
  } else {
    await databaseHalf();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

void fixtureReview;
