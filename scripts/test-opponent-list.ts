#!/usr/bin/env -S npx tsx
/**
 * Checks for the club picker ordering.
 *
 * Both debrief pickers offer the manager's division, so the rule that orders that list is shared code
 * and this is what pins it down. Note what is deliberately absent: a league placing. The save's
 * placings are not a usable table (see the module note in `opponent-list.ts`), so the order is by name
 * only, and a check that looked for a placing would be asserting on something the app does not do.
 *
 *   npx tsx scripts/test-opponent-list.ts
 */
import { OPPONENT_SORT_ORDERS, orderTeams } from "../src/lib/ui/opponent-list";
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

function team(name: string, isOwnClub = false): LeagueTeamSummary {
  return { teamId: name.length * 1000, name, form: null, isOwnClub };
}

// The shapes a real save throws at the sort: an ampersand, a leading numeral, and a club the save
// writes in lower case.
const squad: LeagueTeamSummary[] = [
  team("Wigan Athletic", true),
  team("Brighton & Hove Albion"),
  team("Arsenal"),
  team("Stoke City"),
  team("1. FC Köln"),
  team("queens park rangers"),
  team("Derby County"),
];

// Both pickers filter the manager's own club out before ordering.
const selectable = squad.filter((entry) => !entry.isOwnClub);
const names = (entries: LeagueTeamSummary[]): string[] => entries.map((entry) => entry.name);

console.log("OPPONENT_SORT_ORDERS");
check("offers exactly two orders", OPPONENT_SORT_ORDERS.map((entry) => entry.id), ["A-Z", "Z-A"]);
check("A to Z is listed first, so it reads as the default", OPPONENT_SORT_ORDERS[0]?.id, "A-Z");
check(
  "no order mentions a placing",
  OPPONENT_SORT_ORDERS.some((entry) => /position|place|table/i.test(`${entry.id} ${entry.label}`)),
  false
);

console.log("orderTeams");
check("A to Z sorts by name, ignoring case", names(orderTeams(selectable, "A-Z")), [
  "1. FC Köln",
  "Arsenal",
  "Brighton & Hove Albion",
  "Derby County",
  "queens park rangers",
  "Stoke City",
]);
check(
  "Z to A is its exact reverse",
  names(orderTeams(selectable, "Z-A")),
  names(orderTeams(selectable, "A-Z")).slice().reverse()
);
check(
  "case does not decide the order, so lower case q still files with the Qs",
  names(orderTeams([team("Arsenal"), team("queens park rangers"), team("Stoke City")], "A-Z")),
  ["Arsenal", "queens park rangers", "Stoke City"]
);

const before = names(selectable);
orderTeams(selectable, "Z-A");
check("the input array is not reordered in place", names(selectable), before);

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
