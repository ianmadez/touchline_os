/**
 * The gate for Group Debriefs (5-match blocks).
 *
 * Proves the three things the feature exists for:
 *   1. A block round-trips - all five matches, the target RANGES, the notes and the club's
 *      situation before the block.
 *   2. The arithmetic that follows from the reported results is right, including the verdict band
 *      and the points still available.
 *   3. Saving through the API mirrors each reported match into the diary as an ordinary
 *      MATCH_DEBRIEF event, which is what makes the record reconciliation, the season vault and the
 *      timeline behave identically whether the manager logs match-by-match or in blocks.
 *
 * Run against a COPY - it writes and deletes block rows and career events.
 *
 *   Copy-Item data/touchline.db data/touchline.groupdebrief-test.db   # + -wal / -shm if present
 *   $env:DATABASE_URL="<abs>/data/touchline.groupdebrief-test.db"
 *   npx tsx scripts/test-group-debrief.ts
 */
import { and, eq } from "drizzle-orm";
import { TargetBlockService } from "../src/lib/services/target-block-service";
import { db } from "../src/lib/db/client";
import { careerEvents } from "../src/lib/db/schema";
import { PUT, DELETE } from "../src/app/api/season/blocks/route";

const CAREER = process.argv[2] ?? "career_club_1917";
const SEASON = 2026;
const BLOCK_INDEX = 99; // far above any real block, so the run cannot collide with live data
const GUARD = "groupdebrief-test";
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function clear(): Promise<void> {
  const svc = new TargetBlockService();
  const blocks = await svc.listBlocks(CAREER);
  for (const block of blocks.filter((b) => b.blockIndex === BLOCK_INDEX)) {
    await svc.deleteBlock(CAREER, block.id);
  }
  await db
    .delete(careerEvents)
    .where(and(eq(careerEvents.careerId, CAREER), eq(careerEvents.entityType, "TARGET_BLOCK")));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes(GUARD)) {
    console.error("Refusing to run: DATABASE_URL must point at a groupdebrief-test copy.");
    process.exit(1);
  }

  await clear();
  const svc = new TargetBlockService();

  // ---- 1. Round-trip, including a target RANGE and the pre-block situation -------------------
  const saved = await svc.saveBlock({
    careerId: CAREER,
    seasonNumber: SEASON,
    blockIndex: BLOCK_INDEX,
    matches: [
      { opponent: "Watford", opponentPosition: 8, targetPoints: 3, targetMaxPoints: 3, actualPoints: 0, goalsFor: 2, goalsAgainst: 3, note: "Fumbled it late." },
      { opponent: "Wolves", opponentPosition: 2, targetPoints: 3, targetMaxPoints: 3, actualPoints: 3, goalsFor: 2, goalsAgainst: 1, note: "Well fought." },
      { opponent: "Sunderland", opponentPosition: 3, targetPoints: 0, targetMaxPoints: 1, actualPoints: 0, goalsFor: 0, goalsAgainst: 2, note: "Toothless." },
      { opponent: "Huddersfield", opponentPosition: 23, targetPoints: 3, targetMaxPoints: 3, actualPoints: 3, goalsFor: 1, goalsAgainst: 0 },
      { opponent: "West Brom", opponentPosition: 9, targetPoints: 1, targetMaxPoints: 3, actualPoints: 3, goalsFor: 2, goalsAgainst: 0 },
    ],
    targetMin: 8,
    targetMax: 10,
    dreamPoints: 12,
    concernPoints: 6,
    gamesPlayedBefore: 36,
    pointsBefore: 48,
    positionBefore: 12,
    goalDifferenceBefore: 1,
    tablePosition: 13,
    notes: "Next two are must wins.",
  });

  check("five matches stored", saved.matches.length === 5, String(saved.matches.length));
  check("a five-match block always normalises to five", saved.matches.every((m) => m.matchday >= 1));
  check("opponent position kept", saved.matches[0]?.opponentPosition === 8, String(saved.matches[0]?.opponentPosition));
  check(
    "target RANGE kept distinct from its floor (0-1)",
    saved.matches[2]?.targetPoints === 0 && saved.matches[2]?.targetMaxPoints === 1,
    `${saved.matches[2]?.targetPoints}-${saved.matches[2]?.targetMaxPoints}`
  );
  check(
    "target RANGE kept distinct from its floor (1-3)",
    saved.matches[4]?.targetPoints === 1 && saved.matches[4]?.targetMaxPoints === 3,
    `${saved.matches[4]?.targetPoints}-${saved.matches[4]?.targetMaxPoints}`
  );
  check("per-match note kept", saved.matches[0]?.note === "Fumbled it late.", String(saved.matches[0]?.note));
  check("an unreported match has no note", saved.matches[3]?.note === null, String(saved.matches[3]?.note));
  check("pre-block situation kept", saved.gamesPlayedBefore === 36 && saved.pointsBefore === 48, `${saved.gamesPlayedBefore}/${saved.pointsBefore}`);
  check("pre-block position and GD kept", saved.positionBefore === 12 && saved.goalDifferenceBefore === 1);
  check("block notes kept", saved.notes === "Next two are must wins.");

  // A re-read must survive the JSON round-trip, not just the in-memory return value.
  const reread = (await svc.listBlocks(CAREER, SEASON)).find((b) => b.blockIndex === BLOCK_INDEX)!;
  check("survives the JSON round-trip", reread.matches[2]?.targetMaxPoints === 1, String(reread.matches[2]?.targetMaxPoints));
  check("goal difference survives negative values", (await svc.saveBlock({
    careerId: CAREER, seasonNumber: SEASON, blockIndex: BLOCK_INDEX,
    matches: reread.matches, targetMin: 8, targetMax: 10, dreamPoints: 12, concernPoints: 6,
    gamesPlayedBefore: 36, pointsBefore: 48, positionBefore: 12, goalDifferenceBefore: -4,
    tablePosition: 13, notes: reread.notes,
  })).goalDifferenceBefore === -4);

  // ---- 2. The arithmetic that follows from the reported results -----------------------------
  const summary = svc.summarise(reread, 2);
  check("points sum the reported results", summary.points === 9, String(summary.points));
  check("record is 3W 0D 2L", summary.wins === 3 && summary.draws === 0 && summary.losses === 2, `${summary.wins}W ${summary.draws}D ${summary.losses}L`);
  check("goals for and against", summary.goalsFor === 7 && summary.goalsAgainst === 6, `GF ${summary.goalsFor} GA ${summary.goalsAgainst}`);
  check("block reads as complete", summary.complete && summary.matchesPlayed === 5);
  check("9 points against a 8-10 band is ON_TARGET", summary.verdict === "ON_TARGET", summary.verdict);
  check("gap to the target place", summary.gapToTargetPosition === 11, String(summary.gapToTargetPosition));

  // A blank block is IN_PROGRESS and offers the full 15 - it is a plan, not a failure.
  const planned = svc.summarise(
    { ...reread, matches: reread.matches.map((m) => ({ ...m, actualPoints: null, goalsFor: null, goalsAgainst: null })) },
    2
  );
  check("an unreported block is IN_PROGRESS", planned.verdict === "IN_PROGRESS", planned.verdict);
  check("an empty block still has 15 available", planned.pointsIfRemainingWon === 15, String(planned.pointsIfRemainingWon));

  // A 3-point block is a concern, and a 12-point one is the dream.
  const concern = svc.summarise({ ...reread, matches: reread.matches.map((m) => ({ ...m, actualPoints: 0, goalsFor: 0, goalsAgainst: 1 })) }, 2);
  check("a 0-point block is a CONCERN", concern.verdict === "CONCERN", concern.verdict);
  const dream = svc.summarise({ ...reread, matches: reread.matches.map((m) => ({ ...m, actualPoints: 3, goalsFor: 1, goalsAgainst: 0 })) }, 2);
  check("a 15-point block is a DREAM", dream.verdict === "DREAM", dream.verdict);

  // ---- 3. Editing is an update, not a duplicate ---------------------------------------------
  const edited = await svc.saveBlock({
    careerId: CAREER, seasonNumber: SEASON, blockIndex: BLOCK_INDEX,
    matches: reread.matches, targetMin: 9, targetMax: 11, dreamPoints: 13, concernPoints: 7,
    notes: "Revised band.",
  });
  check("editing reuses the same row", edited.id === saved.id, `${saved.id} -> ${edited.id}`);
  check("editing rewrites the band", edited.targetMin === 9 && edited.concernPoints === 7);
  const all = await svc.listBlocks(CAREER, SEASON);
  check("editing does not add a second block", all.filter((b) => b.blockIndex === BLOCK_INDEX).length === 1);

  // ---- 4. The API mirrors each reported match into the diary --------------------------------
  const response = await PUT(
    new Request("http://localhost/api/season/blocks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        careerId: CAREER, seasonNumber: SEASON, blockIndex: BLOCK_INDEX,
        matches: reread.matches.map((m) => ({
          matchday: m.matchday, opponent: m.opponent, opponentPosition: m.opponentPosition,
          targetPoints: m.targetPoints, targetMaxPoints: m.targetMaxPoints,
          actualPoints: m.actualPoints, goalsFor: m.goalsFor, goalsAgainst: m.goalsAgainst, note: m.note,
        })),
        targetMin: 8, targetMax: 10, dreamPoints: 12, concernPoints: 6,
        gamesPlayedBefore: 36, pointsBefore: 48, positionBefore: 12, goalDifferenceBefore: 1,
        tablePosition: 13, notes: "Next two are must wins.",
      }),
    })
  );
  const putBody = (await response.json()) as { success?: boolean; error?: string };
  check("PUT succeeds through the API", response.ok && putBody.success === true, putBody.error ?? String(response.status));

  const mirrored = await db
    .select()
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, CAREER), eq(careerEvents.entityType, "TARGET_BLOCK")));
  check("all five results were mirrored", mirrored.length === 5, String(mirrored.length));
  check("mirrored as ordinary match debriefs", mirrored.every((row) => row.eventType === "MATCH_DEBRIEF"));
  check("mirrored from the manager, not the save", mirrored.every((row) => row.source === "USER"));

  const watford = mirrored.find((row) => JSON.parse(row.payloadJson).opponent === "Watford");
  const watfordPayload = watford ? (JSON.parse(watford.payloadJson) as { scoreline?: string; result?: string }) : {};
  check("scoreline is written OURS-FIRST", watfordPayload.scoreline === "2-3", String(watfordPayload.scoreline));
  check("outcome matches the scoreline", watfordPayload.result === "LOSS", String(watfordPayload.result));

  // Re-saving must not stack a second set of five on top of the first.
  await PUT(
    new Request("http://localhost/api/season/blocks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        careerId: CAREER, seasonNumber: SEASON, blockIndex: BLOCK_INDEX,
        matches: reread.matches.map((m) => ({ ...m })),
        targetMin: 8, targetMax: 10, dreamPoints: 12, concernPoints: 6,
      }),
    })
  );
  const afterResave = await db
    .select()
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, CAREER), eq(careerEvents.entityType, "TARGET_BLOCK")));
  check("re-saving does not duplicate the diary entries", afterResave.length === 5, String(afterResave.length));

  // Deleting the block must take its results with it.
  await DELETE(
    new Request(`http://localhost/api/season/blocks?careerId=${CAREER}&id=${saved.id}`, { method: "DELETE" })
  );
  const afterDelete = await db
    .select()
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, CAREER), eq(careerEvents.entityType, "TARGET_BLOCK")));
  check("deleting the block removes its diary entries", afterDelete.length === 0, String(afterDelete.length));
  check(
    "deleting the block removes the block",
    (await svc.listBlocks(CAREER, SEASON)).every((b) => b.blockIndex !== BLOCK_INDEX)
  );

  await clear();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
