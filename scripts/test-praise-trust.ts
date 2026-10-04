/**
 * The hard gate for praise-to-trust integration.
 *
 * This is the end-to-end proof that the feature works, not just that it compiles. It fabricates the
 * only input the pass can read - match debriefs - and drives the real evaluator over them, because
 * the reference save has no debriefs of its own and every praise path would otherwise be a code path
 * nobody has run.
 *
 * Run against a COPY of the database, never the live one - it deletes the career's debrief rows.
 *
 *   Copy-Item data/touchline.db      data/touchline.praise-test.db
 *   Copy-Item data/touchline.db-wal  data/touchline.praise-test.db-wal   # if it exists
 *   Copy-Item data/touchline.db-shm  data/touchline.praise-test.db-shm   # if it exists
 *   $env:DATABASE_URL="<abs path>/data/touchline.praise-test.db"
 *   npx tsx scripts/test-praise-trust.ts
 *
 * What it proves, in order:
 *
 *   ELEVATION   - 3 mentions in the window lift a player to HIGH; 4 add the marker tier
 *   IDEMPOTENT  - hydrating again writes nothing and changes nothing
 *   DECAY       - five silent debriefs roll the window past the praise and revert to baseline
 *   OWNERSHIP   - a manager's own trust value is never overwritten by the derived one
 *   CONTEXT     - the praise fact carries the opponent, not just the scoreline
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careerEvents, careers, playerUserProfiles } from "../src/lib/db/schema";
import { CareerService } from "../src/lib/services/career-service";
import { SquadService } from "../src/lib/services/squad-service";
import { UserProfileService } from "../src/lib/services/user-profile-service";
import { praiseFacts } from "../src/lib/events/evidence";

const CAREER_ID = process.argv[2] ?? "career_club_1917";
const OPPONENT = "Gate FC";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const careerService = new CareerService();
const squadService = new SquadService();
const userProfileService = new UserProfileService();

async function careerRow() {
  const row = await db.select().from(careers).where(eq(careers.id, CAREER_ID)).get();
  if (!row) throw new Error(`career ${CAREER_ID} not found in this database`);
  return row;
}

async function runEvaluator() {
  const career = await careerRow();
  const squad = await squadService.getCurrentSquad(CAREER_ID, career.inGameDate);
  return { squad, storylines: await careerService.evaluateAndSyncStorylines(CAREER_ID, squad, []) };
}

async function clearDebriefs(): Promise<number> {
  // Only the debriefs are ours to remove; every other spine row is left alone.
  const deleted = await db
    .delete(careerEvents)
    .where(
      and(eq(careerEvents.careerId, CAREER_ID), eq(careerEvents.eventType, "MATCH_DEBRIEF"))
    )
    .returning({ id: careerEvents.id });
  return deleted.length;
}

let clock = Date.now();
async function seedDebrief(opts: { standoutIds: string[]; standoutNames: string[] }): Promise<void> {
  clock += 1000;
  const payloadJson = JSON.stringify({
    opponent: OPPONENT,
    scoreline: "2 - 0",
    homeScore: 2,
    awayScore: 0,
    venue: "HOME",
    competition: "League",
    tacticalAdherence: 3,
    standoutPlayerIds: opts.standoutIds,
    standoutPlayerNames: opts.standoutNames,
    contributions: opts.standoutIds.map((playerId, index) => ({
      playerId,
      playerName: opts.standoutNames[index] ?? "Unknown player",
      goals: 1,
      assists: 0,
    })),
    weaknessIdentified: "",
    managerReflection: "",
    result: "WIN",
    matchDate: null,
    opponentTeamId: null,
    leagueSnapshot: {
      opponentPosition: null,
      opponentPoints: null,
      ownPosition: null,
      ownPoints: null,
    },
  });

  await db.insert(careerEvents).values({
    id: `evt_gate_${clock}`,
    careerId: CAREER_ID,
    eventType: "MATCH_DEBRIEF",
    source: "USER",
    entityType: "MATCH",
    entityId: `match_${clock}`,
    payloadJson,
    timestamp: new Date(clock).toISOString(),
  });
}

async function trustRow(eaPlayerId: number) {
  return db
    .select()
    .from(playerUserProfiles)
    .where(eq(playerUserProfiles.playerId, `${CAREER_ID}_${eaPlayerId}`))
    .get();
}

async function main() {
  if (!process.env.DATABASE_URL?.includes("praise-test")) {
    console.error(
      "Refusing to run: DATABASE_URL must point at a praise-test copy, not the live database."
    );
    process.exit(1);
  }

  section("Setup");
  const removed = await clearDebriefs();
  console.log(`  cleared ${removed} existing MATCH_DEBRIEF row(s) for this career`);
  const career = await careerRow();
  const squad = await squadService.getCurrentSquad(CAREER_ID, career.inGameDate);
  if (squad.length === 0) throw new Error("career has no squad");
  const target = squad[0];
  // Start from a clean slate for the target so the assertions are about this run, not a previous
  // one. The whole profile row goes, not just a derived one - this is a throwaway copy, and a
  // leftover USER row from an earlier gate run would otherwise mask the elevation step.
  const seeded = await trustRow(target.eaPlayerId);
  if (seeded) {
    await db.delete(playerUserProfiles).where(eq(playerUserProfiles.id, seeded.id));
  }
  console.log(`  target: ${target.name} (ea ${target.eaPlayerId}, ${target.id})`);

  // --- ELEVATION -----------------------------------------------------------
  section("ELEVATION - 3 mentions lift to HIGH, 4 add the marker tier");
  for (let index = 0; index < 3; index += 1) {
    await seedDebrief({ standoutIds: [target.id], standoutNames: [target.name] });
  }
  await runEvaluator();
  let row = await trustRow(target.eaPlayerId);
  check("3 mentions -> trustLevel HIGH", row?.trustLevel === "HIGH", `got ${row?.trustLevel}`);
  check("3 mentions -> no importance marker", row?.importanceMarker === null, `got ${row?.importanceMarker}`);
  check("derived row records trustSource DERIVED", row?.trustSource === "DERIVED", `got ${row?.trustSource}`);

  await seedDebrief({ standoutIds: [target.id], standoutNames: [target.name] });
  await runEvaluator();
  row = await trustRow(target.eaPlayerId);
  check("4 mentions -> importanceMarker KEY_PLAYER", row?.importanceMarker === "KEY_PLAYER", `got ${row?.importanceMarker}`);

  // --- IDEMPOTENCY ---------------------------------------------------------
  section("IDEMPOTENT - a second hydrate writes nothing");
  const eventsBefore = (await db.select().from(careerEvents).where(eq(careerEvents.careerId, CAREER_ID))).length;
  const updatedBefore = row?.updatedAt;
  await runEvaluator();
  const eventsAfter = (await db.select().from(careerEvents).where(eq(careerEvents.careerId, CAREER_ID))).length;
  const rowAfter = await trustRow(target.eaPlayerId);
  check("no new career events", eventsAfter === eventsBefore, `${eventsBefore} -> ${eventsAfter}`);
  check("trust row untouched", rowAfter?.updatedAt === updatedBefore, "updatedAt moved on a no-op run");

  // --- DECAY ---------------------------------------------------------------
  section("DECAY - five silent debriefs roll the window past the praise");
  for (let index = 0; index < 5; index += 1) {
    await seedDebrief({ standoutIds: [], standoutNames: [] });
  }
  await runEvaluator();
  row = await trustRow(target.eaPlayerId);
  check("back to baseline MEDIUM", row?.trustLevel === "MEDIUM", `got ${row?.trustLevel}`);
  check("marker cleared", row?.importanceMarker === null, `got ${row?.importanceMarker}`);

  // --- OWNERSHIP -----------------------------------------------------------
  section("OWNERSHIP - a manager's own value is never overwritten");
  await userProfileService.setPlayerProfile({
    careerId: CAREER_ID,
    eaPlayerId: target.eaPlayerId,
    trustLevel: "LOW",
    importanceMarker: "SURPLUS",
  });
  for (let index = 0; index < 4; index += 1) {
    await seedDebrief({ standoutIds: [target.id], standoutNames: [target.name] });
  }
  await runEvaluator();
  row = await trustRow(target.eaPlayerId);
  check("manager trustLevel preserved", row?.trustLevel === "LOW", `got ${row?.trustLevel}`);
  check("manager marker preserved", row?.importanceMarker === "SURPLUS", `got ${row?.importanceMarker}`);
  check("row still owned by USER", row?.trustSource === "USER", `got ${row?.trustSource}`);

  // --- CONTEXT -------------------------------------------------------------
  section("CONTEXT - the praise fact carries the opponent");
  const debriefs = await db
    .select({ payloadJson: careerEvents.payloadJson, timestamp: careerEvents.timestamp })
    .from(careerEvents)
    .where(
      and(eq(careerEvents.careerId, CAREER_ID), eq(careerEvents.eventType, "MATCH_DEBRIEF"))
    )
    .orderBy(asc(careerEvents.timestamp));
  const facts = praiseFacts(debriefs, squad);
  const fact = facts.find((entry) => entry.payload.playerId === target.id);
  const details = (fact?.payload.matchDetails as string[] | undefined) ?? [];
  check(
    `match context names ${OPPONENT}`,
    details.some((line) => line.includes(OPPONENT)),
    details.join(" | ") || "no match details"
  );

  // --- CARD ----------------------------------------------------------------
  section("CARD - a PRAISE storyline is composed for the praised player");
  const { storylines: composed } = await runEvaluator();
  const praiseCard = composed.find((entry) => entry.category === "PRAISE" && entry.title.includes(target.name));
  check("a PRAISE card exists for the target", Boolean(praiseCard), "none found");
  check("card body is non-empty", Boolean(praiseCard?.body && praiseCard.body.length > 0));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
