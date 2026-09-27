/**
 * Runs a read-only SQL query against the local database and prints the rows as JSON.
 *
 *   npx tsx scripts/db-query.ts "SELECT count(*) AS n FROM players"
 *
 * Exists because inspecting state through `node -e` fights PowerShell's argument quoting, which
 * silently strips double quotes before Node ever sees them. Passing the SQL as a normal argument
 * avoids that entirely. Use single quotes for SQL string literals.
 */
import Database from "better-sqlite3";
import path from "path";

const sql = process.argv.slice(2).join(" ").trim();

if (!sql) {
  console.error('usage: npx tsx scripts/db-query.ts "SELECT ..."');
  process.exit(1);
}

const db = new Database(path.join(process.cwd(), "data", "touchline.db"), { readonly: true });

try {
  const rows = db.prepare(sql).all();
  console.log(JSON.stringify(rows, null, 1));
} catch (error) {
  console.error(`query failed: ${(error as Error).message}`);
  db.close();
  process.exit(1);
}

db.close();
