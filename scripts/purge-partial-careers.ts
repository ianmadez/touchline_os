/**
 * Removes careers that cannot be managed, and the replicator's bookkeeping for them.
 *
 * ## What this is for
 *
 * A career row that a test fixture or an interrupted seed wrote stays in the database forever. The app
 * no longer opens one (see `career-selection.ts`), but it still counts in diagnostics, still appears
 * in the career list, and its rows still sit in the replication journal where a later seed could
 * replay them. This is the one-off repair for a database that already has one, not a routine step.
 *
 * ## What makes a career removable
 *
 * Exactly the same rule the app opens a career by, imported rather than restated: fewer players than
 * can take the field. A career the app would open is never touched, whatever else is true of it.
 *
 * ## Why it backs up first
 *
 * Deleting a career cascades to every row that belongs to it, which is most of the database. The
 * backup is taken through SQLite's own backup API rather than a file copy, because the database runs
 * in WAL mode and a plain copy can miss the writes still sitting in the log.
 *
 *   npx tsx scripts/purge-partial-careers.ts --database "<path to career.db>"
 *   npx tsx scripts/purge-partial-careers.ts --database "<path to career.db>" --apply
 *
 * Without `--apply` it reports what it would remove and changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { RESUMABLE_SQUAD_SIZE, isResumableSquadSize } from "../src/lib/career-selection";

/** Tables the replicator keeps per career. Absent from a database that was never paired. */
const LEDGER_TABLES = ["_sync_journal", "_sync_log", "_sync_bulk_dirty", "_sync_push_seq"];

function argument(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : null;
}

interface CareerRow {
  id: string;
  clubName: string;
  managerName: string;
  squadSize: number;
  updatedAt: string;
}

function readCareers(db: Database.Database): CareerRow[] {
  return db
    .prepare(
      `SELECT c.id AS id,
              c.club_name AS clubName,
              c.manager_name AS managerName,
              c.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM players p WHERE p.career_id = c.id) AS squadSize
         FROM careers c
     ORDER BY c.updated_at DESC`
    )
    .all() as CareerRow[];
}

async function main(): Promise<void> {
  const target = argument("database") ?? process.env.DATABASE_URL ?? "";
  const apply = process.argv.includes("--apply");

  if (!target || !path.isAbsolute(target)) {
    console.error(
      "Refusing to run: pass the database explicitly with an absolute path,\n" +
        '  --database "C:\\Users\\<you>\\AppData\\Local\\TouchlineOS\\career.db"\n' +
        "so this can never be pointed at the wrong file by a stray environment variable."
    );
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    console.error(`Refusing to run: no database at ${target}`);
    process.exit(1);
  }

  const db = new Database(target);
  db.pragma("foreign_keys = ON");

  const careers = readCareers(db);
  if (careers.length === 0) {
    console.log(`No careers in ${target}. Nothing to do.`);
    db.close();
    return;
  }

  console.log(`Database: ${target}`);
  console.log(`Careers (${careers.length}):`);
  for (const career of careers) {
    const verdict = isResumableSquadSize(Number(career.squadSize))
      ? "keep"
      : "removable, cannot field a team";
    console.log(
      `  ${career.id.padEnd(22)} ${career.clubName} / ${career.managerName} ` +
        `squad ${career.squadSize} (floor ${RESUMABLE_SQUAD_SIZE}) - ${verdict}`
    );
  }

  const partial = careers.filter((career) => !isResumableSquadSize(Number(career.squadSize)));
  const resumable = careers.filter((career) => isResumableSquadSize(Number(career.squadSize)));

  // A partial career is only removable while something else is left to open. The app falls back to the
  // newest career when none can be managed, so a database holding nothing but a partial one must keep
  // it: deleting it would leave the manager with no career at all, which is worse than an incomplete
  // one they can recognise and re-seed over.
  const [newest] = careers;
  const removable =
    resumable.length > 0 ? partial : partial.filter((career) => career.id !== newest.id);
  const kept = partial.filter((career) => !removable.includes(career));

  for (const career of kept) {
    console.log(
      `\nKeeping ${career.id}: it is the only career in this database, so it is what the app opens.`
    );
  }

  if (removable.length === 0) {
    console.log("\nNothing removable. No changes made.");
    db.close();
    return;
  }

  if (!apply) {
    console.log(
      `\nWould remove ${removable.map((career) => career.id).join(", ")}.\n` +
        "Nothing changed. Run again with --apply to do it."
    );
    db.close();
    return;
  }

  const backupDir = path.join(path.dirname(target), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(backupDir, `pre-purge-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`\nBackup: ${backupPath}`);

  const removeCareer = db.transaction((careerId: string) => {
    for (const table of LEDGER_TABLES) {
      const exists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table);
      if (exists) db.prepare(`DELETE FROM ${table} WHERE career_id = ?`).run(careerId);
    }
    db.prepare("DELETE FROM careers WHERE id = ?").run(careerId);
  });

  for (const career of removable) {
    removeCareer(career.id);
    console.log(`Removed ${career.id} (${career.clubName}) and its rows.`);
  }

  const remaining = readCareers(db);
  console.log(`\nCareers left (${remaining.length}):`);
  for (const career of remaining) {
    console.log(`  ${career.id} ${career.clubName}, squad ${career.squadSize} - this is what the app opens.`);
  }
  db.close();
}

void main();
