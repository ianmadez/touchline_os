/**
 * The gate for the rules profile.
 *
 * Pure: no database. Run with `npx tsx scripts/test-rules-profile.ts`.
 *
 * The claim being tested is narrow and absolute: a toggle removes EXACTLY the option it names and nothing else, a
 * blocked option is never offered, the card can name the toggle that removed it, and the notes change nothing at all.
 * If any of that fails, the profile has become a preference that quietly rewrites the advice, which is the one thing
 * it must never be.
 */
import { composeReview } from "../src/lib/review";
import {
  DEFAULT_RULES_PROFILE,
  type Review,
  type ReviewContext,
  type RulesProfile,
  type RulesToggleId,
} from "../src/lib/review/types";
import type { ReviewMatch } from "../src/lib/review/types";

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

function match(
  id: string,
  points: 0 | 1 | 3,
  formation: { label: string; formationName: string } | null,
  standouts: string[] = []
): ReviewMatch {
  return {
    id,
    date: `2026-03-0${id.slice(-1)}`,
    opponent: `Opponent ${id}`,
    foldedOpponent: `opponent-${id}`,
    venue: "HOME",
    competition: "League Match",
    goalsFor: points === 3 ? 2 : points === 1 ? 1 : 0,
    goalsAgainst: points === 3 ? 0 : points === 1 ? 1 : 2,
    points,
    formation: formation === null ? null : { ...formation, source: "DEFAULT" },
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
    standouts,
    contributions: [],
    source: "DEBRIEF",
  };
}

/** Two shapes, a real gap, a named player marked as key, a winnable player, and a block that missed its band. */
const MATCHES: ReviewMatch[] = [
  match("m1", 3, { label: "Primary", formationName: "4-4-2-flat" }, ["J. Koroma"]),
  match("m2", 3, { label: "Primary", formationName: "4-4-2-flat" }, ["J. Koroma"]),
  match("m3", 0, { label: "Secondary", formationName: "5-4-1-flat" }),
  match("m4", 0, { label: "Secondary", formationName: "5-4-1-flat" }),
  match("m5", 1, { label: "Primary", formationName: "4-4-2-flat" }, ["A. Cozier-Duberry"]),
];

const BAND: Review["block"] = {
  id: "blk_2",
  seasonNumber: 3,
  blockIndex: 2,
  verdict: "BELOW_TARGET",
  points: 7,
  possible: 15,
  targetMin: 8,
  targetMax: 10,
  dreamPoints: 12,
  concernPoints: 6,
  tablePosition: 7,
  formationLabel: null,
};

function context(profile: RulesProfile, ages: Record<string, number | null> = {}): ReviewContext {
  return {
    objective: { targetPosition: 4 },
    currentPosition: 7,
    previousBlock: null,
    keyPlayerNames: ["J. Koroma"],
    playerAges: { "J. Koroma": 24, "A. Cozier-Duberry": 20, ...ages },
    savedFormationCount: 2,
    profile,
  };
}

function withToggle(toggle: RulesToggleId): RulesProfile {
  return { toggles: { ...DEFAULT_RULES_PROFILE.toggles, [toggle]: true }, notes: null };
}

function build(profile: RulesProfile, ages: Record<string, number | null> = {}): Review {
  return composeReview({
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
        venue: entry.venue,
        standoutPlayerNames: entry.standouts,
        formation: entry.formation,
      },
    })),
    blocks: [],
    context: context(profile, ages),
    band: BAND,
  });
}

function main(): void {
  const baseline = build(DEFAULT_RULES_PROFILE);
  const baseIds = baseline.options.map((option) => option.id);

  console.log("the untouched profile");
  check("offers more than one option", baseIds.length > 1, baseIds.join(", "));
  equal("and blocks nothing", baseline.blockedBy, []);
  check(
    "including the shape change",
    baseIds.includes("change-shape"),
    baseIds.join(", ")
  );

  console.log("keepFormationFamily");
  const family = build(withToggle("keepFormationFamily"));
  check(
    "removes the shape change",
    !family.options.some((option) => option.id === "change-shape")
  );
  check(
    "and names itself as the reason",
    family.blockedBy.includes("keepFormationFamily"),
    family.blockedBy.join(", ")
  );
  equal(
    "removes only its own option",
    baseIds.filter((id) => !family.options.some((option) => option.id === id)),
    ["change-shape"]
  );

  console.log("neverRotateKeyPlayers");
  const rotate = build(withToggle("neverRotateKeyPlayers"));
  check(
    "removes the rest option for the marked player",
    !rotate.options.some((option) => option.id === "rest-player")
  );
  check(
    "and names itself",
    rotate.blockedBy.includes("neverRotateKeyPlayers"),
    rotate.blockedBy.join(", ")
  );
  check(
    "while a plain watch on the same player stays",
    rotate.options.some((option) => option.id === "watch-player"),
    rotate.options.map((option) => option.id).join(", ")
  );

  console.log("fixedPointsBand");
  const fixed = build(withToggle("fixedPointsBand"));
  check(
    "removes the points target",
    !fixed.options.some((option) => option.id === "adjust-target" || option.id === "close-the-gap"),
    fixed.options.map((option) => option.id).join(", ")
  );
  check(
    "and names itself",
    fixed.blockedBy.includes("fixedPointsBand"),
    fixed.blockedBy.join(", ")
  );

  console.log("preferYouthMinutes");
  // The named player is 24 in this fixture, so the youth rule needs a young one at the top of the mentions to have
  // anything to act on at all.
  const young = { "J. Koroma": 20 };
  const youth = build(withToggle("preferYouthMinutes"), young);
  check(
    "removes the option to leave a young player out",
    !youth.options.some((option) => option.id === "leave-out-young-player")
  );
  check(
    "and names itself",
    youth.blockedBy.includes("preferYouthMinutes"),
    youth.blockedBy.join(", ")
  );

  console.log("every toggle at once");

  const all: RulesProfile = {
    toggles: {
      keepFormationFamily: true,
      neverRotateKeyPlayers: true,
      fixedPointsBand: true,
      preferYouthMinutes: true,
    },
    notes: null,
  };
  const blocked = build(all, { "J. Koroma": 20 });
  check(
    "nothing that crosses a rule is offered",
    !blocked.options.some((option) =>
      ["change-shape", "rest-player", "adjust-target", "close-the-gap", "leave-out-young-player"].includes(option.id)
    ),
    blocked.options.map((option) => option.id).join(", ")
  );
  check(
    "and every one of them is named, so the card can explain the empty decision step",
    blocked.blockedBy.length === 4,
    blocked.blockedBy.join(", ")
  );

  console.log("notes are never read");
  const withNotes = build({ ...DEFAULT_RULES_PROFILE, notes: "Never change shape mid-block. Prefer 4-4-2." });
  equal(
    "the review is identical with and without notes",
    JSON.stringify(withNotes),
    JSON.stringify(baseline)
  );

  console.log("findings are never filtered");
  equal(
    "a toggle cannot remove a finding",
    family.findings.map((finding) => finding.id),
    baseline.findings.map((finding) => finding.id)
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
