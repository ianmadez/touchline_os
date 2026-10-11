/**
 * A4 verification - what a DEVELOPMENT card says to a starter against a squad player.
 *
 * Read-only, and it asserts rather than prints where it can: the point is that a player who is in the
 * manager's XI is never offered a loan for minutes, because he already has the minutes.
 *
 *   npx tsx scripts/probe-development-copy.ts
 */
import { composeStoryline, type ComposableFact } from "../src/lib/events/compose";

const PLAYER_ID = "player-1";
const NAME = "A. Aznou";

function factsFor(delta: number): ComposableFact[] {
  return [
    {
      eventType: "PLAYER_DEVELOPED",
      summary: `${NAME} has gone from 70 to ${70 + delta} overall.`,
      weight: "NOTABLE",
      // The recorded standing is deliberately the WRONG one: this is the case the live XI has to win.
      payload: { playerId: PLAYER_ID, name: NAME, delta, oldOvr: 70, newOvr: 70 + delta, isStarter: false },
      observedAt: "2026-10-10T00:00:00.000Z",
    },
  ];
}

function compose(delta: number, starters?: ReadonlySet<string>): string {
  const composed = composeStoryline(
    { id: "thread-1", category: "DEVELOPMENT", title: `${NAME} - up ${delta}`, status: "ACTIVE" },
    factsFor(delta),
    "2026-10-10",
    starters
  );
  return composed.body;
}

function main(): void {
  const starter = new Set([PLAYER_ID]);
  const squad = new Set<string>();
  let failures = 0;

  console.log("DEVELOPMENT card, live XI = starter against live XI = squad player\n");
  for (const delta of [1, 3, -1]) {
    const asStarter = compose(delta, starter);
    const asSquad = compose(delta, squad);
    console.log(`  delta ${String(delta).padStart(2)}`);
    console.log(`    starter : ${asStarter}`);
    console.log(`    squad   : ${asSquad}\n`);

    if (/\bloan\b/i.test(asStarter)) {
      console.log(`    FAIL - the starter copy mentions a loan`);
      failures += 1;
    }
    if (asStarter === asSquad) {
      console.log(`    FAIL - the starter reads exactly like a squad player, so the XI changed nothing`);
      failures += 1;
    }
  }

  // The live XI has to beat the standing recorded on the fact, which is what makes the two systems
  // update each other rather than the card freezing at the moment the rating was noticed.
  const recordedSquadLiveStarter = compose(1, starter);
  const recordedSquadNoXi = compose(1, undefined);
  console.log("  the fact records isStarter=false; only the live XI can override it");
  console.log(`    with live XI        : ${recordedSquadLiveStarter}`);
  console.log(`    with no live XI     : ${recordedSquadNoXi}`);
  if (recordedSquadLiveStarter === recordedSquadNoXi) {
    console.log(`    FAIL - the live XI did not override the recorded standing`);
    failures += 1;
  }
  if (!/\bloan\b/i.test(recordedSquadNoXi)) {
    console.log(`    FAIL - with no live XI a squad player should still be offered the loan framing`);
    failures += 1;
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main();
