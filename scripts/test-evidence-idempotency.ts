/**
 * The hard gate for the storyline evidence pass.
 *
 * Evidence is written during hydration, which happens every time the dashboard loads. So the pass
 * has to be a no-op when nothing has changed: a reload is not an event, and the career history must
 * not grow because someone refreshed a tab.
 *
 *   npx tsx scripts/test-evidence-idempotency.ts
 *
 * Reports the row counts before and after each hydration. The first run is allowed to add rows -
 * that is the one-time backfill of facts we already held but had never recorded. The second run
 * must add nothing.
 */
import { db } from "../src/lib/db/client";
import {
  careerEvents,
  careerSnapshots,
  playerSnapshots,
  storylineEvents,
  storylines,
} from "../src/lib/db/schema";
import { CareerService } from "../src/lib/services/career-service";
import { desc, eq } from "drizzle-orm";

const CAREER_ID = process.argv[2] ?? "career_club_1917";

async function counts(label: string) {
  const events = await db
    .select()
    .from(careerEvents)
    .where(eq(careerEvents.careerId, CAREER_ID));
  const links = await db.select().from(storylineEvents);
  const threads = await db.select().from(storylines).where(eq(storylines.careerId, CAREER_ID));

  const evidence = events.filter((e) => e.entityType === "EVIDENCE");
  const byType = new Map<string, number>();
  for (const event of evidence) {
    byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + 1);
  }

  console.log(
    `${label.padEnd(26)} events=${String(events.length).padStart(3)} ` +
      `(evidence ${String(evidence.length).padStart(2)}: ${
        [...byType.entries()].map(([k, v]) => `${k}x${v}`).join(", ") || "none"
      })  links=${String(links.length).padStart(3)}  threads=${threads.length}`
  );

  return { events: events.length, evidence: evidence.length, links: links.length };
}

const service = new CareerService();

/**
 * Moves one player's latest reading so the development probe has something to report.
 *
 * No rating has ever moved across this career's nine snapshots, which makes the probe correct but
 * unexercised - a path nobody has ever run is not a path that works. This fabricates the one input
 * the probe needs, in a throwaway copy of the database, so the code path is genuinely tested.
 */
async function simulateDevelopment(): Promise<void> {
  const latest = await db
    .select()
    .from(careerSnapshots)
    .where(eq(careerSnapshots.careerId, CAREER_ID))
    .orderBy(desc(careerSnapshots.snapshotNumber))
    .limit(1)
    .get();
  if (!latest) throw new Error("no snapshot to modify");

  const row = await db
    .select()
    .from(playerSnapshots)
    .where(eq(playerSnapshots.snapshotId, latest.id))
    .limit(1)
    .get();
  if (!row) throw new Error("no player row to modify");

  await db
    .update(playerSnapshots)
    .set({ overallRating: row.overallRating + 3 })
    .where(eq(playerSnapshots.id, row.id));

  console.log(
    `simulated: ${row.name} ${row.overallRating} -> ${row.overallRating + 3} in snapshot ${latest.snapshotNumber}`
  );
}

/**
 * Moves one player's save position in the latest snapshot.
 *
 * The counterpart to `simulateDevelopment`. No player's position has ever changed across this
 * career's snapshots either, so without fabricating one the position probe is a code path nobody
 * has run. Picks a player who already has a real position, so the simulated change is a genuine
 * move rather than a recording gap closing - which the probe is supposed to ignore.
 */
async function simulatePositionChange(): Promise<void> {
  const latest = await db
    .select()
    .from(careerSnapshots)
    .where(eq(careerSnapshots.careerId, CAREER_ID))
    .orderBy(desc(careerSnapshots.snapshotNumber))
    .limit(1)
    .get();
  if (!latest) throw new Error("no snapshot to modify");

  const rows = await db
    .select()
    .from(playerSnapshots)
    .where(eq(playerSnapshots.snapshotId, latest.id));
  const row = rows.find(
    (entry) =>
      entry.positionCode !== null &&
      !["SUB", "RES", "UNKNOWN"].includes((entry.primaryPosition || "").toUpperCase())
  );
  if (!row) throw new Error("no positioned player to modify");

  const NEW_CODE = 4; // CB
  await db
    .update(playerSnapshots)
    .set({ positionCode: NEW_CODE, primaryPosition: "CB" })
    .where(eq(playerSnapshots.id, row.id));

  console.log(
    `simulated: ${row.name} ${row.primaryPosition} (code ${row.positionCode}) -> CB (code ${NEW_CODE}) in snapshot ${latest.snapshotNumber}`
  );
}

async function main() {
  // With RESET=1 the evidence rows and their links are cleared first, which is how the backfill
  // path gets exercised: a state that holds the raw facts but has never recorded them.
  if (process.env.RESET === "1") {
    await db.delete(storylineEvents);
    await db.delete(careerEvents).where(eq(careerEvents.entityType, "EVIDENCE"));
    console.log("reset: cleared all storyline links and evidence events");
  }

  if (process.env.SIMULATE_GROWTH === "1") {
    await simulateDevelopment();
  }

  if (process.env.SIMULATE_POSITION === "1") {
    await simulatePositionChange();
  }

  const before = await counts("before");

  await service.hydrate(CAREER_ID);
  const first = await counts("after hydrate #1");

  await service.hydrate(CAREER_ID);
  const second = await counts("after hydrate #2");

  await service.hydrate(CAREER_ID);
  const third = await counts("after hydrate #3");

  const passGrew = first.events - before.events;
  const secondGrowth = second.events - first.events;
  const thirdGrowth = third.events - second.events;
  const linkGrowth = second.links - first.links;

  console.log("");
  console.log(`backfill on first hydrate : ${passGrew} events`);
  console.log(`growth on second hydrate  : ${secondGrowth} events`);
  console.log(`growth on third hydrate   : ${thirdGrowth} events`);
  console.log(`link growth on second     : ${linkGrowth}`);

  const ok = secondGrowth === 0 && thirdGrowth === 0 && linkGrowth === 0;
  console.log("");
  console.log(
    ok
      ? "PASS - re-hydrating unchanged data writes nothing"
      : "FAIL - hydration is not idempotent"
  );
  process.exit(ok ? 0 : 1);
}

void main();
