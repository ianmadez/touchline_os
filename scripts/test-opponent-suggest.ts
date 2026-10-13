#!/usr/bin/env -S npx tsx
/**
 * Checks the next-opponent suggestion, with the second cycle as the case that matters.
 *
 * The save carries no fixture list, so this is the only thing standing between a useful prompt and a
 * field that goes quietly dead halfway through a season. Three properties are asserted: the club faced
 * fewest times wins, every club gets a turn before any club gets a second, and the order is
 * deterministic.
 *
 *   npx tsx scripts/test-opponent-suggest.ts
 */
import { suggestNextOpponent } from "../src/lib/ui/opponent-suggest";
import type { LeagueTeamSummary } from "../src/lib/services/career-service";

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

const team = (teamId: number, name: string, isOwnClub = false): LeagueTeamSummary => ({
  teamId,
  name,
  form: null,
  isOwnClub,
});

const division: LeagueTeamSummary[] = [
  team(1, "Ours", true),
  team(2, "Alpha"),
  team(3, "Bravo"),
  team(4, "Charlie"),
];

console.log("suggestNextOpponent");
check("nothing logged, so the first name alphabetically leads", suggestNextOpponent(division, [])?.name, "Alpha");
check("the cycle starts at one", suggestNextOpponent(division, [])?.cycle, 1);
check("our own club is never offered", suggestNextOpponent([team(1, "Ours", true)], []), null);
check("an empty division offers nothing", suggestNextOpponent([], []), null);

check(
  "a club already faced drops behind the ones that have not been",
  suggestNextOpponent(division, [2])?.name,
  "Bravo"
);
check(
  "the fewest-faced rule holds across several logged matches",
  suggestNextOpponent(division, [2, 3, 2])?.name,
  "Charlie"
);

// THE SECOND CYCLE. Every club faced once, so the suggestion must reset rather than go empty.
const secondCycle = suggestNextOpponent(division, [2, 3, 4]);
check("the second cycle still suggests a club", secondCycle?.name, "Alpha");
check("and says so with a cycle of two", secondCycle?.cycle, 2);
check("the reverse fixture is explained", secondCycle?.reason, "faced once already, so this would be the reverse fixture");

check(
  "between two clubs faced once each, the least recently played comes round first",
  suggestNextOpponent(division, [4, 3, 2])?.name,
  "Charlie"
);

check("a third meeting is not claimed as a fixture", suggestNextOpponent(division, [2, 2, 3, 3, 4, 4])?.cycle, 3);
check("clubs outside the division are ignored", suggestNextOpponent(division, [99])?.name, "Alpha");
check("facing the same club does not exhaust the list", suggestNextOpponent(division, [2, 2, 2, 2])?.name, "Bravo");
check("the result is deterministic", JSON.stringify(suggestNextOpponent(division, [2])), JSON.stringify(suggestNextOpponent(division, [2])));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
