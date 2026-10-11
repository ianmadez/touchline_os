#!/usr/bin/env -S npx tsx
/**
 * Checks for the club picker ordering and labelling.
 *
 * The two debrief pickers both offer the manager's division, so the rule that orders that list and the
 * text of each option are shared code, and this is what pins them down. The interesting cases are the
 * ones the save actually produces: a club with no placing, a club the save reports as 0 while the
 * season is still running, and the ordinal teens, which do not follow the 1/2/3 rule.
 *
 *   npx tsx scripts/test-opponent-list.ts
 */
import { orderTeams, placingOf, teamOptionLabel } from "../src/lib/ui/opponent-list";
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

function team(
  name: string,
  tablePosition: number | null,
  isOwnClub = false
): LeagueTeamSummary {
  return { teamId: name.length * 1000 + (tablePosition ?? 99), name, tablePosition, previousYearPosition: null, form: null, isOwnClub };
}

// The save's own shapes: a normal placing, the ordinal teens, 0 while the season runs, and no value.
const squad: LeagueTeamSummary[] = [
  team("Wigan Athletic", 13, true),
  team("Brighton", 12),
  team("Arsenal", 1),
  team("Derby County", null),
  team("Chelsea", 3),
  team("Everton", 0),
  team("Fulham", 11),
  team("Grimsby Town", 21),
];

// Both pickers filter the manager's own club out before ordering.
const selectable = squad.filter((entry) => !entry.isOwnClub);
const names = (entries: LeagueTeamSummary[]): string[] => entries.map((entry) => entry.name);

console.log("placingOf");
check("a placing is the save's own number", placingOf(team("A", 12)), 12);
check("0 counts as no placing", placingOf(team("A", 0)), null);
check("null stays null", placingOf(team("A", null)), null);

console.log("orderTeams");
check(
  "A to Z is the alphabetical order",
  names(orderTeams(selectable, "A-Z")),
  ["Arsenal", "Brighton", "Chelsea", "Derby County", "Everton", "Fulham", "Grimsby Town"]
);
check(
  "Z to A is its reverse",
  names(orderTeams(selectable, "Z-A")),
  ["Grimsby Town", "Fulham", "Everton", "Derby County", "Chelsea", "Brighton", "Arsenal"]
);
check(
  "placing order puts the clubs with no placing last, by name",
  names(orderTeams(selectable, "POSITION")),
  ["Arsenal", "Chelsea", "Fulham", "Brighton", "Grimsby Town", "Derby County", "Everton"]
);

const before = names(selectable);
orderTeams(selectable, "Z-A");
check("the input array is not reordered in place", names(selectable), before);

console.log("teamOptionLabel");
check("a placing is written with its ordinal suffix", teamOptionLabel(team("Arsenal", 1)), "Arsenal 1st");
check("2 takes nd", teamOptionLabel(team("Chelsea", 2)), "Chelsea 2nd");
check("3 takes rd", teamOptionLabel(team("Chelsea", 3)), "Chelsea 3rd");
check("11 takes th", teamOptionLabel(team("Fulham", 11)), "Fulham 11th");
check("12 takes th", teamOptionLabel(team("Brighton", 12)), "Brighton 12th");
check("13 takes th", teamOptionLabel(team("Wigan Athletic", 13)), "Wigan Athletic 13th");
check("21 takes st", teamOptionLabel(team("Grimsby Town", 21)), "Grimsby Town 21st");
check("no placing means no number", teamOptionLabel(team("Derby County", null)), "Derby County");
check("0 means no number", teamOptionLabel(team("Everton", 0)), "Everton");

console.log("");
console.log(`${checks - failures} of ${checks} checks passed`);
if (failures > 0) process.exit(1);
