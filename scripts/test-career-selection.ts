/**
 * Proves the app opens the career it can manage, and only falls back when it has no choice.
 *
 * The bug this covers: a fixture career written into the database later than the manager's own took
 * the app over, because "most recently touched" was the whole rule. Every screen behind it was empty
 * or described a two-club division, and there is no career picker in the app to get back.
 *
 * The rule is data-driven, so this test states it as data: a row with a real squad beats a newer row
 * without one, and a database holding only a partial career still reports it rather than reporting
 * nothing at all.
 *
 * Run with
 *   npx tsx scripts/test-career-selection.ts
 */
import {
  RESUMABLE_SQUAD_SIZE,
  isResumableSquadSize,
  pickActiveCareer,
} from "../src/lib/career-selection";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
}

interface Row {
  id: string;
  squadSize: number;
}

/** Newest first, which is the order both callers read in. */
const career = (id: string, squadSize: number): Row => ({ id, squadSize });

function pick(rows: Row[]): string | null {
  return pickActiveCareer(rows, (row) => row.squadSize)?.id ?? null;
}

console.log("=== TOUCHLINE OS: WHICH CAREER THE APP OPENS ===\n");

console.log("1. The squad size decides what counts as resumable");
check("eleven players can take the field", isResumableSquadSize(RESUMABLE_SQUAD_SIZE));
check("ten cannot", !isResumableSquadSize(RESUMABLE_SQUAD_SIZE - 1));
check("an empty squad cannot", !isResumableSquadSize(0));
check("a missing count is not treated as a squad", !isResumableSquadSize(Number.NaN));

console.log("\n2. A newer partial career does not take the app over");
const managerCareer = career("career_a_full_squad", 24);
const partialCareer = career("career_b_three_players", 3);
check(
  "the full squad wins even though it is older",
  pick([partialCareer, managerCareer]) === managerCareer.id,
  `chose ${pick([partialCareer, managerCareer])}`
);

console.log("\n3. Between two careers that can both be managed, the newest wins");
const older = career("career_c_older", 26);
const newer = career("career_d_newer", 20);
check("newest first, as before", pick([newer, older]) === newer.id, `chose ${pick([newer, older])}`);

console.log("\n4. A database holding only a partial career still reports one");
check(
  "the incomplete row is opened rather than reported as missing",
  pick([partialCareer]) === partialCareer.id,
  "no career at all would send the manager back to the wizard"
);

console.log("\n5. An empty database has no career to open");
check("answers null", pick([]) === null);

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
if (failures > 0) process.exit(1);
