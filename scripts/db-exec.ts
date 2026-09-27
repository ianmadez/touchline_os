/**
 * Runs a single write statement against the local database.
 *
 *   npx tsx scripts/db-exec.ts "DELETE FROM career_events WHERE id = 'evt_...'"
 *
 * The counterpart to `db-query.ts`, which is read-only. Exists because doing this inline through
 * `node -e` fights PowerShell's argument quoting: double quotes get stripped before Node sees them,
 * which turns a valid DELETE into a syntax error that looks like a bug in your SQL.
 *
 * Refuses anything that is not a single INSERT/UPDATE/DELETE, so it cannot be used to drop a table
 * or rewrite schema by accident. Prints the number of rows affected.
 */
import Database from "better-sqlite3";
import path from "path";
import { config } from "../src/lib/config";

const sql = process.argv.slice(2).join(" ").trim();

if (!sql) {
  console.error("usage: npx tsx scripts/db-exec.ts \"DELETE FROM career_events WHERE id = 'x'\"");
  process.exit(1);
}

const verb = sql.split(/\s+/)[0]?.toUpperCase() ?? "";
if (!["INSERT", "UPDATE", "DELETE"].includes(verb)) {
  console.error(`refusing to run a ${verb || "blank"} statement; only INSERT/UPDATE/DELETE allowed`);
  process.exit(1);
}

const db = new Database(config.databasePath);
db.pragma("foreign_keys = ON");

try {
  const info = db.prepare(sql).run();
  console.log(`${verb} affected ${info.changes} row${info.changes === 1 ? "" : "s"}.`);
} catch (error) {
  console.error(`failed: ${(error as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
