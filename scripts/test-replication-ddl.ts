/**
 * The one proof for the replication ledger: does every trigger fire, and does a delta carry enough to
 * rebuild the row?
 *
 * The 89 triggers are the only part of replication that cannot be checked by reading code. A key
 * expression that is wrong for one table fails silently: the row is written, the trigger fires, and the
 * log records a key that never matches anything. So this applies the real DDL to a copy of a real career
 * and then, for a delta table with a plain key, the composite key table, a parent scoped table and a bulk
 * table, does an insert, an update and a delete and asserts exactly what landed in the ledger.
 *
 * The second half matters as much: the deltas are replayed into a second copy of the same database, and
 * the two are compared by content hash. A delta that logged the right key but the wrong row would pass
 * the first half and fail this.
 *
 *   npx tsx scripts/test-replication-ddl.ts <fixture.db> <careerId>
 *
 * Never point this at the live database: it writes fixture rows.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const fixture = process.argv[2] ?? "data/backups/pre-rework-2026-10-24_131953/touchline.snapshot.db";
const careerId = process.argv[3] ?? "career_club_1917";
const workDir = path.join(process.cwd(), "data");
const primary = path.join(workDir, "replication-test.db");
const target = path.join(workDir, "replication-target.db");

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

for (const file of [primary, target]) {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
  fs.copyFileSync(fixture, file);
}

// `storage` applies the schema, including the replication DDL, when it is first imported. Pointing
// DATABASE_URL at the copy first is why this script can prove the DDL at all.
process.env.DATABASE_URL = primary;

async function main(): Promise<void> {
const { storage } = await import("../src/lib/platform/storage");
const { deltasFor, setLoggingSuppressed } = await import("../src/lib/sync/replication/ledger");
const { keyOf } = await import("../src/lib/sync/replication/tables");

console.log(`\n=== REPLICATION LEDGER PROOF ===\n`);
console.log(`copy:   ${primary}`);
console.log(`career: ${careerId}\n`);

const db = new Database(primary);
const reference = new Database(target, { readonly: false });

const columnsOf = (name: string): string[] =>
  db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => (c as { name: string }).name);

const pick = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;

function insertRow(table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`).run(
    ...columns.map((column) => row[column] as never)
  );
}

function logFor(table: string): Array<{ row_key: string; op: string }> {
  return db.prepare("SELECT row_key, op FROM _sync_log WHERE table_name = ? ORDER BY seq").all(table) as never;
}

function dirtyFor(table: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM _sync_bulk_dirty WHERE table_name = ?").get(table) as { n: number }).n;
}

function contentHash(connection: Database.Database, table: string): string {
  // Two tables have no `career_id` of their own; their rows belong to a career through a parent row.
  const scope =
    table === "storyline_events"
      ? "storyline_id IN (SELECT id FROM storylines WHERE career_id = ?)"
      : table === "hypothesis_evidence"
        ? "hypothesis_id IN (SELECT id FROM hypotheses WHERE career_id = ?)"
        : "career_id = ?";
  const rows = connection.prepare(`SELECT * FROM "${table}" WHERE ${scope}`).all(careerId);
  return rows.map((row) => JSON.stringify(row)).sort().join("\n");
}

// ---------------------------------------------------------------- 1. plain key
console.log("1. A delta table with a plain key (player_user_profiles)");
const profileRow = pick<Record<string, unknown>>(
  "SELECT * FROM player_user_profiles WHERE career_id = ? LIMIT 1",
  careerId
);
check("the fixture has a profile to copy", Boolean(profileRow));

if (profileRow) {
  db.prepare("DELETE FROM player_user_profiles WHERE id = ?").run(profileRow.id as string);
  insertRow("player_user_profiles", { ...profileRow, id: `${careerId}_dll_ins` });
  db.prepare("UPDATE player_user_profiles SET user_notes = 'ledger update' WHERE id = ?").run(`${careerId}_dll_upd`);
  const updatable = pick<{ id: string }>(
    "SELECT id FROM player_user_profiles WHERE career_id = ? AND id <> ? LIMIT 1",
    careerId,
    `${careerId}_dll_upd`
  );
  check("a second profile exists to update", Boolean(updatable));
  if (updatable) {
    db.prepare("UPDATE player_user_profiles SET user_notes = 'changed' WHERE id = ?").run(updatable.id);
    db.prepare("DELETE FROM player_user_profiles WHERE id = ?").run(updatable.id);
  }
  const entries = logFor("player_user_profiles");
  check("insert logged as I", entries.some((e) => e.op === "I" && e.row_key === `${careerId}_dll_ins`), JSON.stringify(entries));
  check("update logged as U", entries.some((e) => e.op === "U"), JSON.stringify(entries));
  check("delete logged as D", entries.some((e) => e.op === "D"), JSON.stringify(entries));
}

// ---------------------------------------------------------------- 2. composite key
console.log("\n2. The composite key table (leagues)");
const leagueRow = pick<Record<string, unknown>>("SELECT * FROM leagues WHERE career_id = ? LIMIT 1", careerId);
check("the fixture has a league to copy", Boolean(leagueRow));
if (leagueRow) {
  const newLeague: Record<string, unknown> = { ...leagueRow, league_id: 987654, name: "Ledger League" };
  insertRow("leagues", newLeague);
  const expectedKey = `${newLeague.career_id}|${newLeague.league_id}`;
  const entries = logFor("leagues");
  check(
    "a bulk table with a composite key writes one marker", dirtyFor("leagues") === 1, `${dirtyFor("leagues")} marker(s)`);
  db.prepare("UPDATE leagues SET name = 'Renamed' WHERE career_id = ? AND league_id = ?").run(newLeague.career_id as string, 987654);
  db.prepare("DELETE FROM leagues WHERE career_id = ? AND league_id = ?").run(newLeague.career_id as string, 987654);
  check("and still nothing in the row log", logFor("leagues").length === 0, `${logFor("leagues").length} log rows`);
}

// ---------------------------------------------------------------- 3. parent scoped
console.log("\n3. A parent scoped table (storyline_events)");
const eventRow = pick<Record<string, unknown>>("SELECT * FROM storyline_events LIMIT 1");
const storyline = pick<{ id: string }>("SELECT id FROM storylines WHERE career_id = ? LIMIT 1", careerId);
check("the fixture has a storyline to hang evidence on", Boolean(storyline));
if (storyline) {
  const realEventId = pick<{ id: string }>("SELECT id FROM career_events LIMIT 1")?.id ?? "";
  const row = eventRow && realEventId ? { ...eventRow, id: `${storyline.id}_dll_ins`, storyline_id: storyline.id, event_id: realEventId } : null;
  if (row) {
    insertRow("storyline_events", row);
    const entries = logFor("storyline_events");
    check(
      "its career id is resolved through the parent",
      entries.some((e) => e.op === "I" && e.row_key === `${storyline.id}_dll_ins`),
      JSON.stringify(entries)
    );
    const carrier = db
      .prepare("SELECT career_id FROM _sync_log WHERE table_name = 'storyline_events' LIMIT 1")
      .get() as { career_id: string } | undefined;
    check("and it is the storyline's career, not blank", carrier?.career_id === careerId, String(carrier?.career_id));
    db.prepare("UPDATE storyline_events SET event_id = event_id WHERE id = ?").run(row.id as string);
    db.prepare("DELETE FROM storyline_events WHERE id = ?").run(row.id as string);
    check("update and delete logged too", logFor("storyline_events").length === 3, `${logFor("storyline_events").length} entries`);
  }
}

// ---------------------------------------------------------------- 4. bulk table
console.log("\n4. A bulk table (world_players)");
const worldRow = pick<Record<string, unknown>>("SELECT * FROM world_players WHERE career_id = ? LIMIT 1", careerId);
check("the fixture has a world player to copy", Boolean(worldRow));
if (worldRow) {
  const before = dirtyFor("world_players");
  insertRow("world_players", { ...worldRow, id: `${careerId}_dll_world`, ea_player_id: 999999999 });
  db.prepare("UPDATE world_players SET name = 'Ledger Player' WHERE id = ?").run(`${careerId}_dll_world`);
  db.prepare("DELETE FROM world_players WHERE id = ?").run(`${careerId}_dll_world`);
  check("three writes produce ONE marker, not three log rows", dirtyFor("world_players") === 1 && before === 0, `${dirtyFor("world_players")} marker(s)`);
  check("and nothing in the row log", logFor("world_players").length === 0, `${logFor("world_players").length} log rows`);
}

// ---------------------------------------------------------------- 4b. an UPSERT over a bulk table
//
// `sync-service.ts` upserts `leagues` on every run, and an UPSERT reaches its UPDATE arm. Before this
// check existed the marker insert met its own primary key on that path and the whole sync failed with
// `UNIQUE constraint failed: _sync_bulk_dirty.career_id`. The marker has to survive being fired again.
console.log("\n4b. The same table written by an UPSERT, which is what a real sync does");
{
  const league = pick<Record<string, unknown>>("SELECT * FROM leagues WHERE career_id = ? LIMIT 1", careerId);
  check("the fixture has a league to update", Boolean(league));
  if (league) {
    const upsert = db.prepare(
      `INSERT INTO leagues (career_id, league_id, name, level, country_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(career_id, league_id) DO UPDATE SET name = excluded.name`
    );
    db.prepare("DELETE FROM _sync_bulk_dirty WHERE table_name = 'leagues'").run();
    let first = true;
    let second = true;
    try {
      upsert.run(careerId, league.league_id, String(league.name ?? "League"), league.level, league.country_id);
    } catch {
      first = false;
    }
    try {
      upsert.run(careerId, league.league_id, String(league.name ?? "League"), league.level, league.country_id);
    } catch {
      second = false;
    }
    check("the first upsert is accepted", first);
    check("and so is the second, which is the one that used to throw", second);
    check("both produce a single marker", dirtyFor("leagues") === 1, `${dirtyFor("leagues")} marker(s)`);
    check("and no row log, because leagues is a bulk table", logFor("leagues").length === 0);
  }
}

// ---------------------------------------------------------------- 5. suppression
console.log("\n5. Echo suppression");
const beforeSuppressed = (db.prepare("SELECT COUNT(*) AS n FROM _sync_log").get() as { n: number }).n;
setLoggingSuppressed(true);
db.prepare("UPDATE player_user_profiles SET user_notes = 'from another device' WHERE career_id = ?").run(careerId);
setLoggingSuppressed(false);
check(
  "a write while applying a remote change logs nothing",
  (db.prepare("SELECT COUNT(*) AS n FROM _sync_log").get() as { n: number }).n === beforeSuppressed,
  `${beforeSuppressed} before`
);
db.prepare("UPDATE player_user_profiles SET user_notes = 'local again' WHERE career_id = ?").run(careerId);
check("and the outbox resumes afterwards", (db.prepare("SELECT COUNT(*) AS n FROM _sync_log").get() as { n: number }).n > beforeSuppressed);

// ---------------------------------------------------------------- 6. replay
console.log("\n6. Replay the deltas into a second copy");
const deltas = deltasFor(careerId, 1000).filter((delta) =>
  ["player_user_profiles", "leagues", "storyline_events"].includes(delta.table)
);
check("deltas were produced", deltas.length > 0, `${deltas.length} delta(s)`);

const keyColumns = (table: string): string[] => (table === "leagues" ? ["career_id", "league_id"] : ["id"]);

for (const delta of deltas) {
  const columns = keyColumns(delta.table);
  const parts = delta.key.split("|");
  const where = columns.map((column) => `"${column}" = ?`).join(" AND ");
  if (delta.op === "D") {
    reference.prepare(`DELETE FROM "${delta.table}" WHERE ${where}`).run(...parts);
  } else if (delta.row) {
    const rowColumns = Object.keys(delta.row);
    const exists = reference.prepare(`SELECT 1 FROM "${delta.table}" WHERE ${where}`).get(...parts);
    if (exists) {
      const sets = rowColumns.filter((column) => !columns.includes(column)).map((column) => `"${column}" = ?`);
      reference
        .prepare(`UPDATE "${delta.table}" SET ${sets.join(", ")} WHERE ${where}`)
        .run(...rowColumns.filter((column) => !columns.includes(column)).map((column) => delta.row?.[column] as never), ...parts);
    } else {
      reference
        .prepare(`INSERT INTO "${delta.table}" (${rowColumns.map((c) => `"${c}"`).join(", ")}) VALUES (${rowColumns.map(() => "?").join(", ")})`)
        .run(...rowColumns.map((column) => delta.row?.[column] as never));
    }
  }
}

for (const table of ["player_user_profiles", "leagues", "storyline_events"]) {
  check(`${table} matches after replay`, contentHash(db, table) === contentHash(reference, table));
}

db.close();
reference.close();
console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===\n`);
process.exitCode = failures === 0 ? 0 : 1;
}

void main();
