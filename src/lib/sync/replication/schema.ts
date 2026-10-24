/**
 * The replication ledger, and the triggers that fill it.
 *
 * WHY TRIGGERS RATHER THAN A WRAPPER. The obvious place to catch changes is the dispatch layer, and it
 * is wrong: a save sync writes thirty tables through the sync service without ever passing through a
 * request, derived passes write rows in the middle of a transaction, and any future writer would have to
 * remember to announce itself. A trigger fires for whoever wrote, including code that has never heard of
 * replication. That is also why the phone's writes are caught the same way.
 *
 * THE ECHO PROBLEM, AND THE ONE-LINE ANSWER. Applying a remote change must not log itself, or two devices
 * would bounce the same row forever. Every trigger carries `WHEN (SELECT applying FROM _sync_flag) = 0`,
 * and the apply path sets that flag for the duration of one transaction. It is a table rather than a
 * session variable because the two drivers have no shared equivalent, and a row is the one thing they
 * both understand.
 *
 * WHY BULK TABLES GET A MARKER, NOT A LOG. One row per table, inserted conditionally, costs nothing
 * after the first statement in a transaction, so the 18,926 rows a sync rewrites produce one marker
 * instead of 18,926 log entries. The table itself is then read once, hashed, and replaced wholesale if
 * the hash differs from what the other side holds.
 *
 * WHY EVERY TRIGGER IS DROPPED AND RECREATED. `CREATE TRIGGER IF NOT EXISTS` leaves an existing
 * trigger body alone, so a database opened before a fix kept running the old body forever. Dropping
 * first means the bodies always match this file, which is the only thing that makes a change here
 * actually take effect on a manager's existing database.
 *
 * All of this is `IF NOT EXISTS` and runs from `applySchema`, which is the same migration path both
 * drivers already use on every open. The tables are named `_sync_*` and are deliberately absent from
 * `CAREER_TABLES`, which is a whitelist: a backup can never carry the ledger, so importing one cannot
 * resurrect somebody else's outbox.
 */
import { BULK_TABLES, DELTA_TABLES, KEY_COLUMNS, PARENT_SCOPED } from "./tables";
import { sha1Hex } from "../../parser/sha";

/** The ledger's own tables. Named once, so the exclusion check has one source. */
export const SYNC_TABLES = ["_sync_log", "_sync_bulk_dirty", "_sync_meta", "_sync_flag"] as const;

const LEDGER = `
  CREATE TABLE IF NOT EXISTS _sync_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    career_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL,
    op TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_sync_log_career_seq ON _sync_log(career_id, seq);

  CREATE TABLE IF NOT EXISTS _sync_bulk_dirty (
    career_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (career_id, table_name)
  );

  CREATE TABLE IF NOT EXISTS _sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS _sync_flag (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    applying INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO _sync_flag (id, applying) VALUES (1, 0);
`;

/** The value of the log's `career_id` for a row, as SQL. */
function careerExpression(table: string, alias: "NEW" | "OLD"): string {
  if (table === "careers") return `${alias}.id`;
  const parent = PARENT_SCOPED[table];
  if (parent) {
    // The parent still exists while a child row is being written or deleted, so the lookup is safe for
    // both. `COALESCE` covers a row orphaned by a cascade, which must not abort the write.
    return `COALESCE((SELECT career_id FROM ${parent.parent} WHERE id = ${alias}.${parent.column}), '')`;
  }
  return `${alias}.career_id`;
}

/** The value of the log's `row_key` for a row, as SQL. */
function keyExpression(table: string, alias: "NEW" | "OLD"): string {
  const columns = KEY_COLUMNS[table];
  if (!columns) return `${alias}.id`;
  return columns.map((column) => `COALESCE(${alias}.${column}, '')`).join(" || '|' || ");
}

/** `WHEN` guard shared by every trigger: silent while a remote change is being applied. */
const GUARD = "(SELECT applying FROM _sync_flag WHERE id = 1) = 0";

function deltaTriggers(): string[] {
  const statements: string[] = [];
  for (const table of DELTA_TABLES) {
    const key = table;
    for (const op of ["INSERT", "UPDATE", "DELETE"] as const) {
      const alias = op === "DELETE" ? "OLD" : "NEW";
      const suffix = op === "INSERT" ? "ai" : op === "UPDATE" ? "au" : "ad";
      const letter = op === "INSERT" ? "I" : op === "UPDATE" ? "U" : "D";
      const name = `_sync_${key}_${suffix}`;
      statements.push(`
        DROP TRIGGER IF EXISTS ${name};
        CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${op} ON ${table}
        WHEN ${GUARD}
        BEGIN
          INSERT INTO _sync_log (career_id, table_name, row_key, op)
          VALUES (${careerExpression(table, alias)}, '${table}', ${keyExpression(table, alias)}, '${letter}');
        END;`);
    }
  }
  return statements;
}

function bulkTriggers(): string[] {
  const statements: string[] = [];
  for (const table of BULK_TABLES) {
    for (const op of ["INSERT", "UPDATE", "DELETE"] as const) {
      const alias = op === "DELETE" ? "OLD" : "NEW";
      const suffix = op === "INSERT" ? "ai" : op === "UPDATE" ? "au" : "ad";
      const name = `_sync_${table}_${suffix}`;
      statements.push(`
        DROP TRIGGER IF EXISTS ${name};
        CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${op} ON ${table}
        WHEN ${GUARD}
        BEGIN
          ${markerStatement(table, alias)}
        END;`);
    }
  }
  return statements;
}

/**
 * Marks a bulk table as needing to be sent.
 *
 * `INSERT OR IGNORE` looks like the obvious way to make this idempotent, and it is wrong here. An
 * UPSERT (`INSERT ... ON CONFLICT DO UPDATE`, which the sync service uses for `leagues` on every run)
 * reaches its DO UPDATE arm, fires this trigger again, and the conflict on the marker's primary key is
 * raised as a hard error even though this statement says OR IGNORE. Measured on a real career: the second
 * sync of a save failed with `UNIQUE constraint failed: _sync_bulk_dirty.career_id`. A conditional
 * insert never reaches a conflict at all, so it behaves the same whichever statement fired the trigger.
 */
function markerStatement(table: string, alias: "NEW" | "OLD"): string {
  const career = careerExpression(table, alias);
  return `INSERT INTO _sync_bulk_dirty (career_id, table_name)
          SELECT ${career}, '${table}'
          WHERE NOT EXISTS (
            SELECT 1 FROM _sync_bulk_dirty WHERE career_id = ${career} AND table_name = '${table}'
          );`;
}

/**
 * Every statement, as one exec-able string.
 *
 * One string rather than a list because both drivers' `exec` run a script, and both `applySchema`
 * callers pass a single string down.
 *
 * `applySchema` does not use this directly. It applies `REPLICATION_LEDGER_DDL` every time and the
 * trigger half only when `REPLICATION_FINGERPRINT` says the trigger bodies have changed, because
 * dropping and recreating 89 triggers on every page load would rewrite the browser's whole database
 * image for nothing. This export is the whole thing, and the DDL proof uses it.
 */
export const REPLICATION_DDL = [LEDGER, ...deltaTriggers(), ...bulkTriggers()].join("\n");

/** The ledger tables. Idempotent, and cheap enough to run on every open. */
export const REPLICATION_LEDGER_DDL = LEDGER;

/**
 * The triggers, each dropped before it is created.
 *
 * `CREATE TRIGGER IF NOT EXISTS` leaves an existing body alone, so a database opened before a fix kept
 * running the old body forever. Recreating them is what makes a change here take effect on a manager's
 * existing database. It is gated on the fingerprint below so that a database which is already current
 * is not rewritten on every open.
 */
export const REPLICATION_TRIGGERS_DDL = [...deltaTriggers(), ...bulkTriggers()].join("\n");

/** A fingerprint of the trigger half. Stored in `_sync_meta`, so a body change is noticed exactly once. */
export const REPLICATION_FINGERPRINT = sha1Hex(REPLICATION_TRIGGERS_DDL).slice(0, 16);

/** The `_sync_meta` key the fingerprint is kept under. */
export const REPLICATION_FINGERPRINT_KEY = "replication:triggers";

/** True for a ledger table, so a caller can assert it never reaches a backup. */
export function isSyncTable(name: string): boolean {
  return (SYNC_TABLES as readonly string[]).includes(name);
}
