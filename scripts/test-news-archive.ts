/**
 * Checks for the news ARCHIVE.
 *
 * The desk's copy is checked in `test-news.ts`; this file checks the part with the real risk in it, which is
 * everything the manager asked for after the first pass:
 *
 *   - a story is published once and never written twice,
 *   - the paper is capped, and once it is full the OLDEST unsaved story is the one that goes,
 *   - a saved story is exempt from the cap AND refuses to be dismissed,
 *   - dismissing deletes one story and frees its slot immediately,
 *   - the unread count is a count of stored rows nobody has looked at, and opening the paper clears it.
 *
 * It runs against a THROWAWAY database in the OS temp folder, built from the real schema, so it cannot touch
 * a manager's career and needs no cleanup beyond deleting the file. `DATABASE_URL` has to be set before the
 * database client is imported, which is why everything below is a dynamic import inside the test body.
 *
 *   npm run news:archive
 */
import fs from "fs";
import os from "os";
import path from "path";

const tempPath = path.join(os.tmpdir(), `touchline-news-archive-${Date.now()}.db`);
process.env.DATABASE_URL = tempPath;

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function main() {
  const Database = (await import("better-sqlite3")).default;
  const { SCHEMA_DDL, SCHEMA_MIGRATIONS } = await import("../src/lib/db/schema-sql");

  // The schema first, straight onto the empty file, exactly as `db:init` does it.
  const sqlite = new Database(tempPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(SCHEMA_DDL);
  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      sqlite.exec(statement);
    } catch {
      /* column already exists */
    }
  }
  sqlite.close();

  const { db } = await import("../src/lib/db/client");
  const { careers, newsItems, newsPublished, players } = await import("../src/lib/db/schema");
  const { NewsArchiveService, NEWS_ARCHIVE_LIMIT } = await import("../src/lib/services/news-archive");
  const { NEWS_COPY_VERSION } = await import("../src/lib/news/news-engine");
  const { eq } = await import("drizzle-orm");

  const careerId = "career_test_news";
  await db.insert(careers).values({
    id: careerId,
    managerName: "Test Manager",
    clubName: "Test United",
    clubId: 1917,
    leagueId: 14,
    currentSeason: 2026,
    inGameDate: "2026-11-08",
  });

  // A squad of eleven, because a paper with nothing at all to write about would test the storage and none
  // of the publishing. One of them is a keeper and one is comfortably the best, which is what makes the
  // desk produce a story on its own.
  const roles = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "LW", "ST"];
  await db.insert(players).values(
    roles.map((role, index) => ({
      id: `${careerId}_${900000 + index}`,
      careerId,
      eaPlayerId: 900000 + index,
      name: role === "GK" ? "Test Keeper" : `Test Player ${index}`,
      primaryPosition: role,
      overallRating: index === 10 ? 74 : 66,
      potentialRating: index === 10 ? 76 : 68,
      age: 24 + (index % 6),
      contractValidUntil: 2027,
      jersey: index + 1,
    }))
  );

  const archive = new NewsArchiveService();

  console.log("\nreading a career publishes what the evidence supports");

  const first = await archive.read(careerId);
  check("a read returns a paper", first !== null);
  check("and it has stories in it", (first?.items.length ?? 0) > 0, `${first?.items.length} items`);
  check(
    "and nothing is read yet",
    first?.unseen === first?.items.length,
    `${first?.unseen} unseen of ${first?.items.length}`
  );
  const firstCount = first?.items.length ?? 0;

  console.log("\npublishing is idempotent");

  const second = await archive.read(careerId);
  check(
    "reading again does not duplicate anything",
    second?.items.length === firstCount,
    `${second?.items.length} vs ${firstCount}`
  );
  check("and publishes nothing new", second?.published === 0, `${second?.published}`);

  console.log("\nmarking read is what clears the count");

  const marked = await archive.markRead(careerId);
  check("the paper reports how many were marked", marked === firstCount, `${marked}`);
  const afterRead = await archive.read(careerId);
  check("and the unread count goes to zero", afterRead?.unseen === 0, `${afterRead?.unseen}`);
  check("while the stories stay", afterRead?.items.length === firstCount);
  check(
    "and the badge query agrees",
    (await archive.unseenCount(careerId)) === 0
  );

  console.log("\nsaving protects a story");

  const savedId = afterRead?.items[0]?.id ?? "";
  check("there is a story to save", savedId.length > 0);
  check("saving reports success", await archive.setSaved(careerId, savedId, true));
  check(
    "and the flag comes back on the story",
    (await archive.read(careerId))?.items.find((item) => item.id === savedId)?.saved === true
  );
  check(
    "a saved story refuses to be dismissed",
    (await archive.dismiss(careerId, savedId)) === "saved"
  );
  check(
    "and is still there",
    (await archive.read(careerId))?.items.some((item) => item.id === savedId) === true
  );

  console.log("\ndismissing frees a slot");

  const doomed = afterRead?.items.find((item) => item.id !== savedId)?.id ?? "";
  check("there is a second story to dismiss", doomed.length > 0);
  check("dismissing removes it", (await archive.dismiss(careerId, doomed)) === "removed");
  const afterDismiss = await archive.read(careerId);
  check(
    "and it is gone from the paper",
    afterDismiss?.items.some((item) => item.id === doomed) === false
  );
  check("dismissing it twice reports it missing", (await archive.dismiss(careerId, doomed)) === "missing");

  console.log("\nthe paper is capped, and the oldest unsaved story is what goes");

  // Fill the archive past its limit by hand: publishing that many real stories would mean inventing a
  // career, and the cap is arithmetic on rows rather than anything the desk knows about.
  //
  // Stamped with the CURRENT copy revision, because a row from an older desk is withdrawn and reprinted by
  // design - see the reprint section further down.
  const filler = Array.from({ length: NEWS_ARCHIVE_LIMIT + 5 }, (_, index) => ({
    id: `filler-${index}`,
    careerId,
    category: "FILLER",
    tone: "NEUTRAL",
    headline: `Filler ${index}`,
    body: "Filling the archive to prove the cap.",
    evidenceJson: "[]",
    playerNamesJson: "[]",
    playerIdsJson: "[]",
    quote: null,
    publishedOn: "2026-11-08",
    weight: 1,
    sortIndex: index,
    saved: false,
    edition: 900 + index,
    copyVersion: NEWS_COPY_VERSION,
  }));
  await db.insert(newsItems).values(filler);

  // The next read publishes a real edition, which runs the trim on the way through.
  const capped = await archive.read(careerId);
  const unsaved = capped?.items.filter((item) => !item.saved) ?? [];
  check(
    `the unsaved archive is held at the limit of ${NEWS_ARCHIVE_LIMIT}`,
    unsaved.length <= NEWS_ARCHIVE_LIMIT,
    `${unsaved.length} unsaved`
  );
  check(
    "the oldest fillers are the ones that went",
    capped?.items.some((item) => item.id === "filler-0") === false
  );
  check(
    "the newest fillers survived",
    capped?.items.some((item) => item.id === `filler-${NEWS_ARCHIVE_LIMIT + 4}`) === true
  );
  check(
    "and the saved story is still there, outside the count",
    capped?.items.some((item) => item.id === savedId && item.saved) === true
  );

  console.log("\nand nothing that has gone comes back");

  // The churn guard. Without a tombstone the desk would republish every story it still has evidence for the
  // moment its row was trimmed, so the paper would reshuffle itself on every single read.
  const again = await archive.read(careerId);
  check(
    "a trimmed story is not republished on the next read",
    again?.items.some((item) => item.id === "filler-0") === false
  );
  check(
    "and the paper is the same size as it was",
    again?.items.length === capped?.items.length,
    `${again?.items.length} vs ${capped?.items.length}`
  );

  console.log("\nwhen the desk itself is rewritten");

  // The one exception to "printed once and kept". A row written by an older revision of the desk is withdrawn
  // so it can be written again in the current voice, and the three states that must NOT move are checked here:
  // a saved story, a dismissed one (which has a tombstone and no row), and a tombstone belonging to a row that
  // is still on the paper.
  const oldVoiceId = "old-voice-story";
  await db.insert(newsItems).values({
    id: oldVoiceId,
    careerId,
    category: "ANALYSIS",
    tone: "NEUTRAL",
    headline: "Wrote This Before the Rewrite",
    body: "Old wording.",
    evidenceJson: "[]",
    playerNamesJson: "[]",
    playerIdsJson: "[]",
    quote: null,
    publishedOn: "2026-11-08",
    weight: 1,
    sortIndex: 999,
    saved: false,
    edition: 800,
    copyVersion: NEWS_COPY_VERSION - 1,
  });
  const savedOldVoiceId = "old-voice-saved";
  await db.insert(newsItems).values({
    id: savedOldVoiceId,
    careerId,
    category: "ANALYSIS",
    tone: "NEUTRAL",
    headline: "Kept Through the Rewrite",
    body: "Old wording, but bookmarked.",
    evidenceJson: "[]",
    playerNamesJson: "[]",
    playerIdsJson: "[]",
    quote: null,
    publishedOn: "2026-11-08",
    weight: 1,
    sortIndex: 998,
    saved: true,
    edition: 800,
    copyVersion: NEWS_COPY_VERSION - 1,
  });

  const rewritten = await archive.read(careerId);
  check(
    "a story from an older draft of the desk is withdrawn",
    rewritten?.items.some((item) => item.id === oldVoiceId) === false
  );
  check(
    "a SAVED story is never touched, however old the wording",
    rewritten?.items.some((item) => item.id === savedOldVoiceId && item.saved) === true
  );
  check(
    "and its tombstone is cleared alongside it, so the desk can write it again",
    (await db.select().from(newsPublished).where(eq(newsPublished.id, oldVoiceId))).length === 0
  );
  check(
    "a dismissed story has no row to reprint, so it stays dismissed",
    (await db.select().from(newsPublished).where(eq(newsPublished.id, doomed))).length === 1
  );

  // Leaving nothing behind for the checks that follow.
  await db.delete(newsItems).where(eq(newsItems.id, savedOldVoiceId));

  console.log("\nthe paper knows its own shape");

  check("it reports how many editions are on file", (capped?.editions ?? 0) >= 1, `${capped?.editions}`);
  check("it reports the cap it is holding to", capped?.limit === NEWS_ARCHIVE_LIMIT);
  check(
    "and carrying a club through",
    capped?.clubName === "Test United",
    capped?.clubName ?? "none"
  );

  // The rows are deleted with the career, so the temp file has nothing of anybody's in it. It is removed
  // anyway: a stray file in temp is how a test starts lying about which database it used.
  await db.delete(careers).where(eq(careers.id, careerId));
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${tempPath}${suffix}`);
    } catch {
      /* nothing to remove */
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
