/**
 * The hard gate for the storyline lifecycle: buffers, precedence, and the composer.
 *
 * Run against a COPY of the database, never the live one - these tests move players' contracts,
 * delete a player and rewrite squads, which is exactly what they have to do to exercise paths no
 * real save has gone down yet.
 *
 *   Copy-Item data/touchline.db      data/touchline.storyline-test.db
 *   Copy-Item data/touchline.db-wal  data/touchline.storyline-test.db-wal   # if it exists
 *   Copy-Item data/touchline.db-shm  data/touchline.storyline-test.db-shm   # if it exists
 *   $env:DATABASE_URL="<abs path>/data/touchline.storyline-test.db"
 *   npx tsx scripts/test-storyline-lifecycle.ts
 *
 * The WAL and SHM files are not optional: this database runs in WAL mode, so committed rows live in
 * the -wal until a checkpoint. Copying the .db alone produces a snapshot missing recent writes.
 *
 * What it proves, one check at a time:
 *
 *   FORM      - opens on a drop across two snapshots, survives a wobble, resolves only at the
 *               recovery threshold (the hysteresis, exercised rather than merely present)
 *   CONTRACT  - a sold player resolves and never stales; a renewal resolves without needing an
 *               event the save may never log
 *   SQUAD_DEPTH - reaching two specialists does not resolve the thread; three does
 *   INVARIANT - re-running over unchanged data adds no events and no links
 *   COMPOSER  - one fact reads as a note, four read as a report, and severity is a function of the
 *               evidence rather than of the category
 */
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  careerEvents,
  careerSnapshots,
  careers,
  playerSnapshots,
  players,
  storylineEvents,
  storylines,
} from "../src/lib/db/schema";
import { CareerService } from "../src/lib/services/career-service";
import { SquadService } from "../src/lib/services/squad-service";
import {
  composeStoryline,
  severityFor,
  severityReason,
  type ComposableFact,
} from "../src/lib/events/compose";
import type { StorylineItem } from "../src/lib/events/types";

const CAREER_ID = process.argv[2] ?? "career_club_1917";
const GUARD = "storyline-test";

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

const evaluator = new CareerService();
const squadService = new SquadService();

async function careerRow() {
  const row = await db.select().from(careers).where(eq(careers.id, CAREER_ID)).get();
  if (!row) throw new Error(`career ${CAREER_ID} not found in this database`);
  return row;
}

async function runEvaluator(): Promise<StorylineItem[]> {
  const career = await careerRow();
  const squad = await squadService.getCurrentSquad(CAREER_ID, career.inGameDate);
  return evaluator.evaluateAndSyncStorylines(CAREER_ID, squad, []);
}

/** Appends a snapshot that copies the latest one, with one player's reading overridden. */
async function appendSnapshot(override?: {
  eaPlayerId: number;
  form?: number | null;
  ovr?: number;
}): Promise<void> {
  const latest = await db
    .select()
    .from(careerSnapshots)
    .where(eq(careerSnapshots.careerId, CAREER_ID))
    .orderBy(desc(careerSnapshots.snapshotNumber))
    .limit(1)
    .get();
  if (!latest) throw new Error("no snapshot to build on");

  const snapshotNumber = latest.snapshotNumber + 1;
  const id = `snap_storyline_test_${snapshotNumber}`;
  await db
    .insert(careerSnapshots)
    .values({
      id,
      careerId: CAREER_ID,
      snapshotNumber,
      rawPayloadHash: `storyline-test-${snapshotNumber}`,
      inGameDate: latest.inGameDate,
    })
    .onConflictDoNothing();

  const rows = await db
    .select()
    .from(playerSnapshots)
    .where(eq(playerSnapshots.snapshotId, latest.id));

  for (const row of rows) {
    const target = override !== undefined && row.eaPlayerId === override.eaPlayerId;
    await db
      .insert(playerSnapshots)
      .values({
        ...row,
        id: `${id}_${row.eaPlayerId}`,
        snapshotId: id,
        form: target && override?.form !== undefined ? override.form : row.form,
        overallRating: target && override?.ovr !== undefined ? override.ovr : row.overallRating,
      })
      .onConflictDoNothing();
  }
}

/**
 * A sync writes a player's form to both places, so the test does too: the current-state row (which
 * the closure pass reads) and a new snapshot reading (which the opening pass compares).
 */
async function setForm(playerRowId: string, eaPlayerId: number, form: number): Promise<void> {
  await db.update(players).set({ form }).where(eq(players.id, playerRowId)).run();
  await appendSnapshot({ eaPlayerId, form });
}

function threadsFor(threads: StorylineItem[], category: string, subject: string): StorylineItem[] {
  return threads.filter(
    (thread) => thread.category === category && thread.openingTitle.includes(subject)
  );
}

async function testFormHysteresis(): Promise<void> {
  section("FORM - opens on a drop, survives a wobble, resolves at the threshold");

  const squad = await db
    .select()
    .from(players)
    .where(eq(players.careerId, CAREER_ID))
    .orderBy(asc(players.eaPlayerId));
  const player = squad.find((candidate) => candidate.eaPlayerId < 400_000) ?? squad[0];
  if (!player) throw new Error("no players in this database");

  // Two readings that say "good", then one that says "poor": a movement, which is the opening gate.
  await setForm(player.id, player.eaPlayerId, 4);
  await setForm(player.id, player.eaPlayerId, 2);
  let threads = await runEvaluator();
  const opened = threadsFor(threads, "FORM", player.name);
  check(
    "opens on a drop into the slump band",
    opened.length === 1 && opened[0].status === "ACTIVE",
    JSON.stringify(opened.map((t) => t.status))
  );
  const threadId = opened[0]?.id;

  // The flap the buffer exists for: the reading sits on the boundary and wobbles.
  await setForm(player.id, player.eaPlayerId, 3);
  threads = await runEvaluator();
  let current = threadsFor(threads, "FORM", player.name);
  check(
    "a wobble to 3 does not resolve it",
    current.length === 1 && current[0].id === threadId && current[0].status === "ACTIVE",
    JSON.stringify(current.map((t) => [t.id, t.status]))
  );

  await setForm(player.id, player.eaPlayerId, 2);
  threads = await runEvaluator();
  current = threadsFor(threads, "FORM", player.name);
  check(
    "and does not open a second thread on the way back",
    current.length === 1 && current[0].id === threadId && current[0].status === "ACTIVE",
    JSON.stringify(current.map((t) => [t.id, t.status]))
  );

  await setForm(player.id, player.eaPlayerId, 4);
  threads = await runEvaluator();
  current = threadsFor(threads, "FORM", player.name);
  check(
    "resolves once the reading clears the recovery threshold",
    current.length === 1 && current[0].status === "RESOLVED",
    JSON.stringify(current.map((t) => t.status))
  );
}

async function testContractSold(): Promise<void> {
  section("CONTRACT - precedence: an answered thread is never dropped");

  const career = await careerRow();
  const squad = await db
    .select()
    .from(players)
    .where(eq(players.careerId, CAREER_ID))
    .orderBy(asc(players.eaPlayerId));
  // Someone well away from the radar, so the thread we watch is the one this test creates.
  const player = squad.find(
    (candidate) => candidate.eaPlayerId < 400_000 && candidate.name !== squad[0]?.name
  );
  if (!player) throw new Error("need two senior players for this test");

  await db
    .update(players)
    .set({ contractValidUntil: career.currentSeason + 1 })
    .where(eq(players.id, player.id))
    .run();

  let threads = await runEvaluator();
  let contract = threadsFor(threads, "CONTRACT", player.name);
  check(
    "opens a contract thread inside the radar window",
    contract.length === 1 && contract[0].status === "ACTIVE",
    JSON.stringify(contract.map((t) => t.status))
  );
  const threadId = contract[0]?.id;

  // Sold: the player is simply not in the squad any more, which is how the save shows a departure.
  await db.delete(players).where(eq(players.id, player.id)).run();
  threads = await runEvaluator();
  contract = threads.filter((thread) => thread.id === threadId);
  check(
    "a sold player's contract thread resolves",
    contract.length === 1 && contract[0].status === "RESOLVED",
    JSON.stringify(contract.map((t) => t.status))
  );
  check(
    "and is never marked stale",
    contract[0]?.status !== "STALE"
  );

  const closure = await db
    .select()
    .from(careerEvents)
    .where(eq(careerEvents.careerId, CAREER_ID));
  check(
    "the closure is recorded as a STORYLINE_RESOLVED event",
    closure.some(
      (event) => event.eventType === "STORYLINE_RESOLVED" && event.entityId === threadId
    )
  );
  check(
    "and no STORYLINE_STALE event was written for it",
    !closure.some((event) => event.eventType === "STORYLINE_STALE" && event.entityId === threadId)
  );
}

async function testContractRenewal(): Promise<void> {
  section("CONTRACT - a renewal resolves without a renewal event");

  const career = await careerRow();
  const squad = await db
    .select()
    .from(players)
    .where(eq(players.careerId, CAREER_ID))
    .orderBy(asc(players.eaPlayerId));
  const player = squad[squad.length - 1];
  if (!player) throw new Error("no players in this database");

  await db
    .update(players)
    .set({ contractValidUntil: career.currentSeason + 1 })
    .where(eq(players.id, player.id))
    .run();
  let threads = await runEvaluator();
  const opened = threadsFor(threads, "CONTRACT", player.name);
  check("opens a contract thread", opened.length === 1 && opened[0].status === "ACTIVE");
  const threadId = opened[0]?.id;

  // The date moves out - the save's own field changes, with no PLAYER_SIGNED event to go with it.
  await db
    .update(players)
    .set({ contractValidUntil: career.currentSeason + 5 })
    .where(eq(players.id, player.id))
    .run();
  threads = await runEvaluator();
  const renewed = threads.filter((thread) => thread.id === threadId);
  check(
    "resolves once the deal runs beyond the cleared window",
    renewed.length === 1 && renewed[0].status === "RESOLVED",
    JSON.stringify(renewed.map((t) => t.status))
  );

  // A renewal of a SINGLE year is still a renewal. The buffer alone would miss this, which is why
  // the check also looks at whether the save's own date has moved out at all.
  const shortPlayer = squad.find((candidate) => candidate.id !== player.id && candidate.eaPlayerId < 400_000);
  if (!shortPlayer) throw new Error("need a second senior player for the one-year renewal test");

  await db
    .update(players)
    .set({ contractValidUntil: career.currentSeason + 1 })
    .where(eq(players.id, shortPlayer.id))
    .run();
  threads = await runEvaluator();
  const shortOpened = threadsFor(threads, "CONTRACT", shortPlayer.name);
  check("opens a thread for the one-year case", shortOpened.length === 1);

  await db
    .update(players)
    .set({ contractValidUntil: career.currentSeason + 2 })
    .where(eq(players.id, shortPlayer.id))
    .run();
  threads = await runEvaluator();
  const shortRenewed = threads.filter((thread) => thread.id === shortOpened[0]?.id);
  check(
    "a one-year extension also resolves it",
    shortRenewed.length === 1 && shortRenewed[0].status === "RESOLVED",
    JSON.stringify(shortRenewed.map((t) => t.status))
  );
}

async function testDepthBuffer(): Promise<void> {
  section("SQUAD_DEPTH - a two-player role is not yet solved");

  const career = await careerRow();
  const squad = await db
    .select()
    .from(players)
    .where(eq(players.careerId, CAREER_ID))
    .orderBy(asc(players.eaPlayerId));

  // RB with exactly one occupant: thin (below DEPTH_PROBLEM_BELOW), so a thread must open.
  const [first, second, third, ...rest] = squad;
  await db.update(players).set({ primaryPosition: "RB" }).where(eq(players.id, first.id)).run();
  for (const player of [second, third, ...rest].filter(Boolean)) {
    await db.update(players).set({ primaryPosition: "ST" }).where(eq(players.id, player.id)).run();
  }

  let threads = await runEvaluator();
  const opened = threadsFor(threads, "SQUAD_DEPTH", "RB");
  check(
    "opens when a role is below the problem threshold",
    opened.length === 1 && opened[0].status === "ACTIVE",
    JSON.stringify(opened.map((t) => t.status))
  );
  const threadId = opened[0]?.id;

  // A second specialist arrives: the old rule resolved here, which is the flap this buffer prevents.
  await db.update(players).set({ primaryPosition: "RB" }).where(eq(players.id, second.id)).run();
  threads = await runEvaluator();
  let depth = threads.filter((thread) => thread.id === threadId);
  check(
    "two specialists does not resolve it",
    depth.length === 1 && depth[0].status === "ACTIVE",
    JSON.stringify(depth.map((t) => `${t.status} (${t.openingTitle})`))
  );

  // A third: the role is genuinely covered, and only now is the thread answered.
  await db.update(players).set({ primaryPosition: "RB" }).where(eq(players.id, third.id)).run();
  threads = await runEvaluator();
  depth = threads.filter((thread) => thread.id === threadId);
  check(
    "three specialists resolves it",
    depth.length === 1 && depth[0].status === "RESOLVED",
    JSON.stringify(depth.map((t) => t.status))
  );

  void career;
}

async function testInvariant(): Promise<void> {
  section("INVARIANT - re-running over unchanged data changes nothing");

  const before = await counts();
  await runEvaluator();
  const afterFirst = await counts();
  await runEvaluator();
  const afterSecond = await counts();

  check(
    "the second run adds no events",
    afterFirst.events === afterSecond.events,
    `${afterFirst.events} -> ${afterSecond.events}`
  );
  check(
    "the second run adds no storyline links",
    afterFirst.links === afterSecond.links,
    `${afterFirst.links} -> ${afterSecond.links}`
  );
  console.log(`        (this run settled at ${afterSecond.events} events, ${afterSecond.links} links; started at ${before.events}/${before.links})`);
}

async function counts(): Promise<{ events: number; links: number }> {
  const events = await db
    .select()
    .from(careerEvents)
    .where(eq(careerEvents.careerId, CAREER_ID));
  const links = await db.select().from(storylineEvents);
  return { events: events.length, links: links.length };
}

function testComposer(): void {
  section("COMPOSER - conclusions come from the evidence, urgency from the facts");

  const thread = {
    category: "CONTRACT" as const,
    title: "Contract: A. Player runs out in 2027",
    status: "ACTIVE" as const,
  };
  const one: ComposableFact[] = [
    {
      eventType: "PLAYER_CONTRACT_EXPIRING",
      summary: "A. Player's contract runs out at the end of 2027.",
      weight: "NOTABLE",
      payload: { name: "A. Player", contractValidUntil: 2027, seasonsLeft: 1 },
      observedAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const four: ComposableFact[] = [
    ...one,
    {
      eventType: "PLAYER_FORM_SLUMP",
      summary: "A. Player's form has dropped to poor (2/5).",
      weight: "NOTABLE",
      payload: { fromForm: 4, toForm: 2 },
      observedAt: "2026-09-02T00:00:00.000Z",
    },
    {
      eventType: "PLAYER_POSITION_CHANGED",
      summary: "A. Player has moved from CM to CDM.",
      weight: "NOTABLE",
      payload: { fromPosition: "CM", toPosition: "CDM" },
      observedAt: "2026-09-03T00:00:00.000Z",
    },
    {
      eventType: "PLAYER_DEVELOPED",
      summary: "A. Player has gone from 71 to 74 overall.",
      weight: "NOTABLE",
      payload: { oldOvr: 71, newOvr: 74, delta: 3 },
      observedAt: "2026-09-04T00:00:00.000Z",
    },
  ];

  const note = composeStoryline(thread, one, "20260901");
  const report = composeStoryline(thread, four, "20260901");

  check(
    "a single fact gets a headline that names the situation, not the fact type",
    note.title.startsWith("Contract Watch: A. Player") &&
      /2027/.test(note.title) &&
      !note.title.endsWith("the contract"),
    note.title
  );
  check(
    "a single fact still states the position and the decision",
    note.body.includes("his deal runs out at the end of 2027") &&
      /open(ing)? (renewal )?talks/.test(note.body) &&
      /(list(ing)? him|moving him on)/.test(note.body) &&
      /(leave it|leaving it)/.test(note.body),
    note.body
  );
  check("a single fact has no history line", !/How it got there:|The run-up:|How it got to this:/.test(note.body), note.body);
  check(
    "four different kinds of fact are stated once each, not repeated",
    ["form has dropped to poor", "moved from CM to CDM", "gone up 3 overall"].every((fragment) =>
      report.body.includes(fragment)
    ) && report.body.split("his deal runs out at the end of 2027").length === 2,
    report.body
  );
  // Substance, not bytes: the point is that a four-fact card states more of the evidence than a
  // one-fact card. Byte length is a poor proxy (a player's initials alone split a sentence counter).
  const evidenceFragments = [
    "his deal runs out at the end of 2027",
    "form has dropped to poor",
    "moved from CM to CDM",
    "gone up 3 overall",
  ];
  check(
    "a report states more of the evidence than a note",
    evidenceFragments.filter((fragment) => report.body.includes(fragment)).length === 4 &&
      evidenceFragments.filter((fragment) => note.body.includes(fragment)).length === 1,
    `note ${evidenceFragments.filter((fragment) => note.body.includes(fragment)).length}/4, report ${
      evidenceFragments.filter((fragment) => report.body.includes(fragment)).length
    }/4`
  );

  // Repeated readings of the SAME kind are a position that moved, not four competing statements.
  const depthRun: ComposableFact[] = [
    { eventType: "SQUAD_DEPTH_THIN", summary: "", weight: "SERIOUS", payload: { position: "CM", count: 0 }, observedAt: "2026-09-05T00:00:00.000Z" },
    { eventType: "SQUAD_DEPTH_THIN", summary: "", weight: "NOTABLE", payload: { position: "CM", count: 1 }, observedAt: "2026-09-01T00:00:00.000Z" },
  ];
  const depthThread = { category: "SQUAD_DEPTH" as const, title: "CM depth: only 0 in the squad", status: "ACTIVE" as const };
  const depth = composeStoryline(depthThread, depthRun, "20260901");
  check(
    "older readings of the same fact become history, not extra clauses",
    depth.body.includes("nobody is listed there") &&
      /How it got there:|The run-up:|How it got to this:/.test(depth.body) &&
      depth.body.includes("depth was recorded at 1") &&
      depth.body.split("nobody is listed there").length === 2,
    depth.body
  );
  check(
    "the depth headline counts rather than labelling",
    depth.title.startsWith("Structural Vulnerability: ") &&
      /CM/.test(depth.title) &&
      /nobody|no specialist|no cover/i.test(depth.title),
    depth.title
  );
  check(
    "the depth decision names both options",
    /promot/i.test(depth.body) &&
      /secondary-position player/.test(depth.body) &&
      /(transfer window|next window)/.test(depth.body),
    depth.body
  );

  const closedThread = { category: "CONTRACT" as const, title: "Contract: A. Player runs out in 2027", status: "RESOLVED" as const };
  const closed = composeStoryline(closedThread, one, "20260901");
  check(
    "a closed thread reads as a record, not a decision",
    closed.title.endsWith("answered") &&
      /^(This was answered|Answered -)/.test(closed.body) &&
      !/The call is whether/.test(closed.body),
    `${closed.title} | ${closed.body}`
  );

  check(
    "severity rises with the evidence",
    severityFor("CONTRACT", one, "20260901") === "WATCH" &&
      severityFor("CONTRACT", four, "20260901") === "CRITICAL"
  );
  check(
    "a passed deadline is critical, whatever the count",
    severityFor("CONTRACT", [{ ...one[0], payload: { contractValidUntil: 2020 } }], "20260901") ===
      "CRITICAL"
  );
  check(
    "severity does not depend on the category",
    severityFor("SQUAD_DEPTH", four, "20260901") === severityFor("CONTRACT", four, "20260901")
  );
  check(
    "a serious fact is at least a warning",
    severityFor("FORM", [{ ...one[0], weight: "SERIOUS" }], "20260901") === "WARNING"
  );
  check(
    "a plain watch needs no explaining, a critical one does",
    severityReason("CONTRACT", one, "20260901") === null &&
      severityReason("CONTRACT", four, "20260901") !== null,
    String(severityReason("CONTRACT", four, "20260901"))
  );
  check(
    "a passed deadline is explained in those terms",
    (severityReason("CONTRACT", [{ ...one[0], payload: { contractValidUntil: 2020 } }], "20260901") ??
      "").includes("already passed")
  );

  // A deal the save dates to a year that has gone must not be described as being in its final year.
  const pastDated = composeStoryline(
    thread,
    [{ ...one[0], payload: { contractValidUntil: 2020, seasonsLeft: -6 } }],
    "20260901"
  );
  check(
    "a past-dated deal reads as past its date, not as a final year",
    /past the recorded|out of time|recorded date has gone/.test(pastDated.title) &&
      pastDated.body.includes("already passed the date the save records"),
    `${pastDated.title} | ${pastDated.body}`
  );

  // Variety. The same facts, seeded by thread id: several phrasings, all making the same claim.
  const seededThreads = Array.from({ length: 40 }, (_, index) => ({
    ...thread,
    id: `st_probe_${index}`,
  }));
  const noteVariants = seededThreads.map((entry) => composeStoryline(entry, one, "20260901"));
  const titles = new Set(noteVariants.map((entry) => entry.title));
  const bodies = new Set(noteVariants.map((entry) => entry.body));

  check(
    "the same facts are delivered several ways",
    titles.size >= 3 && bodies.size >= 3,
    `${titles.size} headlines / ${bodies.size} wordings over ${seededThreads.length} seeds`
  );
  check(
    "every variant still names both options",
    noteVariants.every(
      (entry) =>
        /open(ing)? (renewal )?talks/.test(entry.body) &&
        /(list(ing)? him|moving him on)/.test(entry.body) &&
        /(leave it|leaving it)/.test(entry.body)
    ),
    [...bodies].join(" || ")
  );

  // The final-year state has a different pair of options, and every one of its variants must name
  // both - this is the check that stops variety drifting into a different claim.
  const finalYearVariants = seededThreads.map((entry) =>
    composeStoryline(
      entry,
      [{ ...one[0], payload: { contractValidUntil: 2027, seasonsLeft: 0 } }],
      "20260901"
    )
  );
  check(
    "the final-year variants all name renew-or-leave",
    finalYearVariants.every(
      (entry) =>
        /renew/i.test(entry.body) &&
        /(list him|cashing in)/i.test(entry.body) &&
        /(hold him|holding to the end)/i.test(entry.body)
    ),
    [...new Set(finalYearVariants.map((entry) => entry.body))].join(" || ")
  );
  check(
    "the same thread always reads the same way",
    composeStoryline({ ...thread, id: "st_fixed" }, one, "20260901").body ===
      composeStoryline({ ...thread, id: "st_fixed" }, one, "20260901").body
  );

  // Compounding is what makes two cards unlikely to match: more facts means more slots to choose
  // between, so the space of possible wordings grows with the evidence rather than staying fixed.
  const compounded: ComposableFact[] = [
    ...four,
    {
      eventType: "PLAYER_FORM_SLUMP",
      summary: "A. Player's form was good, then poor.",
      weight: "NOTABLE",
      payload: { fromForm: 5, toForm: 4 },
      observedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const compoundedVariants = new Set(
    seededThreads.map((entry) => composeStoryline(entry, compounded, "20260901").body)
  );
  check(
    "more evidence means more possible wordings",
    compoundedVariants.size > bodies.size,
    `1 fact -> ${bodies.size}, 5 facts -> ${compoundedVariants.size}`
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes(GUARD)) {
    console.error(
      `Refusing to run: DATABASE_URL must point at a ${GUARD} copy, not the live database.`
    );
    process.exit(1);
  }

  console.log(`=== STORYLINE LIFECYCLE TEST (${CAREER_ID}) ===`);

  await testFormHysteresis();
  await testContractSold();
  await testContractRenewal();
  await testDepthBuffer();
  await testInvariant();
  testComposer();

  const open = await db.select().from(storylines).where(eq(storylines.careerId, CAREER_ID));
  console.log(`\nthreads in this copy: ${open.length}`);
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("lifecycle test failed:", error);
  process.exit(1);
});
