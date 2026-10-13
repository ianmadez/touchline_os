#!/usr/bin/env -S npx tsx
/**
 * Checks how a background division is ordered, which is the difference between showing the save's own
 * table and showing one we worked out.
 *
 * The save's `currenttableposition` is only a table when it is a clean 1..N. On the reference career it
 * repeated places across 24 clubs, which is why a division whose positions are not clean must be ordered
 * from points instead - and why the screen has to say which of the two it did.
 *
 *   npx tsx scripts/test-competition-tables.ts
 */
import { orderCompetitionRows, type OrderableClub } from "../src/lib/services/competition-table-service";

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

const club = (
  name: string,
  position: number | null,
  points: number | null,
  goalsFor: number | null = null,
  goalsAgainst: number | null = null
): OrderableClub => ({ name, position, points, goalsFor, goalsAgainst });

const names = (rows: OrderableClub[]): string[] => rows.map((row) => row.name);

console.log("orderCompetitionRows");
check(
  "a clean set of positions is used as the save's own order",
  names(
    orderCompetitionRows(
      [club("Third", 3, 40), club("First", 1, 60), club("Second", 2, 50)],
      "SAVE"
    )
  ),
  ["First", "Second", "Third"]
);
check(
  "a club with no placing is filed last rather than first",
  names(orderCompetitionRows([club("Unknown", null, 10), club("Placed", 4, 10)], "SAVE")),
  ["Placed", "Unknown"]
);
check(
  "derived order is by points",
  names(
    orderCompetitionRows(
      [club("Low", 1, 30), club("High", 9, 60), club("Middle", 4, 45)],
      "DERIVED"
    )
  ),
  ["High", "Middle", "Low"]
);
check(
  "equal points are separated by goal difference",
  names(
    orderCompetitionRows(
      [club("Thin", 1, 50, 40, 40), club("Fat", 2, 50, 50, 30)],
      "DERIVED"
    )
  ),
  ["Fat", "Thin"]
);
check(
  "equal points and goal difference are separated by goals scored",
  names(
    orderCompetitionRows(
      [club("Quiet", 1, 50, 40, 30), club("Loud", 2, 50, 55, 45)],
      "DERIVED"
    )
  ),
  ["Loud", "Quiet"]
);
check(
  "a division with no record at all falls back to the name",
  names(
    orderCompetitionRows(
      [club("Zebra", 3, 0, 0, 0), club("Aardvark", 1, 0, 0, 0), club("Moose", 2, 0, 0, 0)],
      "DERIVED"
    )
  ),
  ["Aardvark", "Moose", "Zebra"]
);
check(
  "a missing figure does not read as zero",
  names(
    orderCompetitionRows([club("Nothing", 1, null), club("Something", 2, 1)], "DERIVED")
  ),
  ["Something", "Nothing"]
);
check(
  "the input array is not reordered in place",
  (() => {
    const input = [club("Second", 2, 40), club("First", 1, 50)];
    orderCompetitionRows(input, "SAVE");
    return names(input);
  })(),
  ["Second", "First"]
);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
