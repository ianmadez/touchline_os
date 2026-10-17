/**
 * The dual-build schema check: an EXISTING database is brought up to date on open.
 *
 * THE BUG. The browser port applied `SCHEMA_DDL` and `SCHEMA_MIGRATIONS` only when it created a new
 * database, so a database written by an earlier build kept its earlier shape forever. Nothing surfaced at
 * the time: it broke on the FIRST READ of a column that had been added since, months later, as
 * `table leagues has no column named country_name` on the entry screen - with no command the manager could
 * run to fix it, because his database lives in OPFS and only the app can touch it.
 *
 * So the check is not "does the schema apply". It is the sequence that actually failed:
 *
 *   1. build a database with the OLD shape of a table (the `leagues` table as it was before `country_name`),
 *   2. prove the column really is missing,
 *   3. run the bring-up that both ports now share,
 *   4. prove the column is there, that SQLite reports the schema as MOVED (which is what tells the browser
 *      port to write the image back), and that a second run reports NO move (so it is not re-writing a
 *      whole database on every page load).
 *
 * Runs on better-sqlite3 rather than sql.js: the logic under test is the statements and the version gate,
 * which are identical in both, and this keeps the check free of wasm and of a browser. The browser's own
 * driver is then exercised too, at the end.
 *
 *   npm run browser:schema:test
 *   npm run browser:schema:test -- --emit-old out-browser/probe-old-schema.db
 *
 * `--emit-old` is the hands-on half: it writes a copy of the real database with the newer columns and
 * tables REMOVED, which is what the manager's OPFS database looks like to a build that has moved on.
 * Serve the browser target, write that file into OPFS as `touchline.db`, reload, and the entry screen
 * either opens normally (fixed) or shows `table leagues has no column named country_name` (not fixed).
 * It reads `data/touchline.db`; it never writes to it.
 */
import fs from "fs";
import os from "os";
import path from "path";

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

/** The columns and tables a build from before the leagues rework did not have. */
const REMOVE_COLUMNS: ReadonlyArray<readonly [string, string]> = [["leagues", "country_name"]];
const REMOVE_TABLES = [
  "career_trophies",
  "news_items",
  "career_finance_inputs",
  "debrief_marks",
  "review_decisions",
  "hypothesis_evidence",
  "hypotheses",
  "assignments",
  "rules_profile",
];

/**
 * A real database as an older build left it, so the browser port can be tested against one by hand.
 *
 * The live file is copied WITH its `-wal` and `-shm`, because copying a WAL database without them yields a
 * database missing recent commits - which has silently produced "no such table" in this repo before.
 */
async function emitOldDatabase(outputPath: string): Promise<void> {
  const Database = (await import("better-sqlite3")).default;
  const source = path.join(process.cwd(), "data", "touchline.db");
  if (!fs.existsSync(source)) {
    console.error(`no database at ${source}`);
    process.exit(1);
  }

  const target = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${source}${suffix}`;
    if (fs.existsSync(from)) fs.copyFileSync(from, `${target}${suffix}`);
  }

  const db = new Database(target);
  // DELETE mode so the sidecars are folded into the one file: the point is a single file to drop into OPFS.
  db.pragma("journal_mode = DELETE");
  for (const [table, column] of REMOVE_COLUMNS) {
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    } catch (error) {
      console.error(`could not drop ${table}.${column}: ${(error as Error).message}`);
    }
  }
  for (const table of REMOVE_TABLES) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    } catch {
      /* an older build may not have had it either */
    }
  }
  db.close();
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${target}${suffix}`)) fs.rmSync(`${target}${suffix}`);
  }

  const bytes = fs.readFileSync(target);
  console.log(`wrote ${target} (${bytes.length} bytes)`);
  console.log(
    `  country_name in the file: ${bytes.includes(Buffer.from("country_name"))} (want false, or it is not an old database)`
  );
  console.log("  drop it into the browser port's OPFS as touchline.db, then reload the page.");
}

async function main() {
  const emitIndex = process.argv.indexOf("--emit-old");
  if (emitIndex !== -1) {
    const outputPath = process.argv[emitIndex + 1];
    if (!outputPath) {
      console.error("--emit-old needs a path, e.g. --emit-old out-browser/probe-old-schema.db");
      process.exit(2);
    }
    await emitOldDatabase(outputPath);
    return;
  }

  const Database = (await import("better-sqlite3")).default;
  const { applySchema, schemaVersion } = await import("../src/lib/db/schema-apply");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-schema-"));
  const file = path.join(dir, "old-shape.db");

  // 1. A database as an EARLIER BUILD left it. Deliberately not the current DDL: this file has to look
  // like the manager's browser storage does, which is the whole point of the check.
  const old = new Database(file);
  old.exec(`
    CREATE TABLE leagues (
      career_id TEXT NOT NULL,
      league_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      level INTEGER,
      country_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (career_id, league_id)
    );
    INSERT INTO leagues (career_id, league_id, name, level, country_id)
      VALUES ('career_club_1917', 14, 'England Championship (2)', 2, 14);
  `);

  const columnsOf = (db: InstanceType<typeof Database>, table: string): string[] =>
    (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map(
      (row) => row.name
    );

  console.log("\na database from an earlier build");

  check("the old shape really has no country_name", !columnsOf(old, "leagues").includes("country_name"));
  check("the live column names it does have are the ones we expect", columnsOf(old, "leagues").includes("country_id"));

  // The read that failed for the manager: every column the app selects, which includes the new one.
  let failedBefore = false;
  try {
    old.prepare("SELECT career_id, league_id, name, level, country_id, country_name FROM leagues").all();
  } catch {
    failedBefore = true;
  }
  check("so the app's own read of leagues throws, exactly as it did in the browser", failedBefore);

  console.log("\nbringing it up to date, which is what open now does in both ports");

  const versionBefore = schemaVersion(old);
  const moved = applySchema(old);
  check("the bring-up reports that the schema moved", moved);
  check("and SQLite's own schema counter agrees", schemaVersion(old) > versionBefore);
  check("the column is there now", columnsOf(old, "leagues").includes("country_name"));

  // The same read, which is the manager's screen.
  let rows: { name: string; country_name: string | null }[] = [];
  let failedAfter = false;
  try {
    rows = old
      .prepare("SELECT name, country_name FROM leagues")
      .all() as { name: string; country_name: string | null }[];
  } catch {
    failedAfter = true;
  }
  check("and the read that failed now works", !failedAfter && rows.length === 1, JSON.stringify(rows));
  check("the row it was failing on survived, with a null the app can read", rows[0]?.country_name === null);

  // Tables added since that build must appear too, or the manager meets the same class of error again.
  check(
    "a table added since that build is created as well",
    (
      old.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).some((row) => row.name === "career_trophies")
  );

  console.log("\nrunning it again, which is what every later page load does");

  const movedAgain = applySchema(old);
  check("a second run changes nothing, so no page load rewrites the database", !movedAgain);
  check("and the column is still single-valued, not duplicated", columnsOf(old, "leagues").filter((c) => c === "country_name").length === 1);

  old.close();
  fs.rmSync(dir, { recursive: true, force: true });

  // ---------------------------------------------------------------------------------------------
  // The same sequence on the driver the BROWSER actually uses.
  //
  // Better-sqlite3 above is what the local build runs; sql.js is what OPFS storage runs, and the two
  // report a result set in different shapes. That difference is not academic: reading only sql.js's
  // `{ columns, values }` made the version gate answer "never moved" for better-sqlite3, which is how a
  // schema fix can be applied and then silently not written back.
  // ---------------------------------------------------------------------------------------------
  console.log("\nthe same thing on sql.js, the browser's own driver");

  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({
    locateFile: () => path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  });

  const browser = new SQL.Database();
  browser.exec(`
    CREATE TABLE leagues (
      career_id TEXT NOT NULL,
      league_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      level INTEGER,
      country_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (career_id, league_id)
    );
    INSERT INTO leagues (career_id, league_id, name, level, country_id)
      VALUES ('career_club_1917', 14, 'England Championship (2)', 2, 14);
  `);

  const browserColumns = (): string[] =>
    (browser.exec("SELECT name FROM pragma_table_info('leagues')")[0]?.values ?? []).map(String);

  check("sql.js reads the old shape without the column", !browserColumns().includes("country_name"));
  check("and the version gate can read this driver's result shape", schemaVersion(browser) > 0, String(schemaVersion(browser)));

  const browserMoved = applySchema(browser);
  check("the bring-up reports the move on sql.js too", browserMoved);
  check("the column is added", browserColumns().includes("country_name"));
  check(
    "and the read the app does now returns the row rather than throwing",
    (browser.exec("SELECT name, country_name FROM leagues")[0]?.values ?? []).length === 1
  );
  check("a second run is still a no-op", !applySchema(browser));
  browser.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
