/**
 * Lists the tables actually present in the local database, and whether the ones the code expects
 * are among them.
 *
 * This exists because `scripts/init-db.ts` is the only schema authority here - there are no
 * drizzle-kit migrations - so a table can be declared in `src/lib/db/schema.ts` and referenced by
 * a service while never actually being created. Run it after changing the schema.
 *
 *   npx tsx scripts/db-tables.ts
 */
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "touchline.db");
const db = new Database(dbPath, { readonly: true });

const actual = (
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
).map((row) => row.name);

/** Every table `src/lib/db/schema.ts` declares, plus the ones read directly by services. */
const expected = [
  "careers",
  "career_snapshots",
  "player_snapshots",
  "club_finance_snapshots",
  "players",
  "club_finances",
  "player_user_profiles",
  "career_events",
  "manager_onboarding_profiles",
  "tactical_systems",
  "app_settings",
  "storylines",
  "storyline_events",
  "season_history",
  "league_positions",
  "career_objectives",
];

console.log(`Database: ${dbPath}\n`);
console.log(`Tables present (${actual.length}):`);
console.log(`  ${actual.join(", ")}\n`);

const missing = expected.filter((name) => !actual.includes(name));
console.log(`Declared tables NOT present (${missing.length}):`);
console.log(missing.length ? `  ${missing.join(", ")}` : "  none");

db.close();
