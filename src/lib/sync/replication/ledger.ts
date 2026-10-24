/**
 * Reading and writing the replication ledger, for both drivers.
 *
 * Everything here goes through `storage.db` and plain SQL rather than the typed query builder. The ledger
 * is not in `schema.ts` on purpose: it is not career data, it is not in any backup, and giving it a
 * Drizzle table would put it within reach of the code that builds backups. It is also the one place where
 * rows are manipulated generically, by table name, which the builder cannot express without a second
 * registry to keep in step.
 */
import { sql } from "drizzle-orm";
import { storage } from "../../platform/storage";
import { sha1Hex } from "../../parser/sha";
import { DELTA_TABLES, KEY_COLUMNS, PARENT_SCOPED } from "./tables";

export interface LogRow {
  seq: number;
  career_id: string;
  table_name: string;
  row_key: string;
  op: "I" | "U" | "D";
}

export interface Delta {
  table: string;
  key: string;
  op: "I" | "U" | "D";
  /** The row as it stands now, or null for a delete. */
  row: Record<string, unknown> | null;
  /** The log entry this came from, so a receiver can acknowledge it. */
  seq: number;
}

/** How many log rows one flush may carry. Batches are resumable, so a cap costs only a round trip. */
export const PUSH_BATCH = 400;

/**
 * Suppresses logging.
 *
 * Every trigger checks this flag, so a change applied from another device cannot log itself and bounce
 * back. The caller sets it inside the transaction that applies the batch and resets it in `finally`, so a
 * failed apply leaves it at zero rather than silencing the outbox for the rest of the session.
 */
export function setLoggingSuppressed(running: boolean): void {
  storage.db.run(sql`UPDATE _sync_flag SET applying = ${running ? 1 : 0} WHERE id = 1`);
}

/** Log entries for one career, oldest first. */
export function pendingChanges(careerId: string, limit: number = PUSH_BATCH): LogRow[] {
  return storage.db.all<LogRow>(
    sql`SELECT seq, career_id, table_name, row_key, op FROM _sync_log
        WHERE career_id = ${careerId} ORDER BY seq ASC LIMIT ${limit}`
  );
}

/** How many entries are waiting, which is what the "queued changes" count shows. */
export function pendingCount(careerId: string): number {
  const rows = storage.db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM _sync_log WHERE career_id = ${careerId}`
  );
  return rows[0]?.n ?? 0;
}

/** Drops entries a receiver has acknowledged, so the outbox cannot grow without bound. */
export function ackChanges(throughSeq: number): void {
  storage.db.run(sql`DELETE FROM _sync_log WHERE seq <= ${throughSeq}`);
}

/** The row as it stands now, or null when it has since been deleted. */
function readRow(table: string, key: string): Record<string, unknown> | null {
  const columns = KEY_COLUMNS[table] ?? ["id"];
  const parts = key.split("|");
  // The key is rebuilt from the same columns the trigger used, so a composite key binds in order.
  const rows =
    columns.length === 1
      ? storage.db.all<Record<string, unknown>>(
          sql`SELECT * FROM ${sql.identifier(table)} WHERE ${sql.identifier(columns[0])} = ${parts[0] ?? ""}`
        )
      : storage.db.all<Record<string, unknown>>(
          sql`SELECT * FROM ${sql.identifier(table)} WHERE ${sql.identifier(columns[0])} = ${parts[0] ?? ""} AND ${sql.identifier(columns[1])} = ${parts[1] ?? ""}`
        );
  return rows[0] ?? null;
}

/**
 * Turns log entries into row deltas.
 *
 * Duplicates are collapsed: a row inserted then updated twice inside one flush is one row to send, and a
 * row inserted then deleted inside one flush is nothing at all. Without that, the receiver would apply
 * three writes to reach one state, and a create-then-delete pair would leave a tombstone for a row that
 * never existed.
 */
export function deltasFor(careerId: string, limit: number = PUSH_BATCH): Delta[] {
  const entries = pendingChanges(careerId, limit);
  const collapsed = new Map<string, LogRow>();

  for (const entry of entries) {
    const id = `${entry.table_name}\u0000${entry.row_key}`;
    const existing = collapsed.get(id);
    if (!existing) {
      collapsed.set(id, entry);
      continue;
    }
    if (entry.op === "D") {
      if (existing.op === "I") collapsed.delete(id);
      else collapsed.set(id, entry);
      continue;
    }
    collapsed.set(id, { ...entry, op: existing.op });
  }

  const deltas: Delta[] = [];
  for (const entry of collapsed.values()) {
    const row = entry.op === "D" ? null : readRow(entry.table_name, entry.row_key);
    // An update whose row has since gone is a delete in effect; saying so keeps the two sides equal.
    if (entry.op !== "D" && row === null) {
      deltas.push({ table: entry.table_name, key: entry.row_key, op: "D", row: null, seq: entry.seq });
      continue;
    }
    deltas.push({ table: entry.table_name, key: entry.row_key, op: entry.op, row, seq: entry.seq });
  }
  return deltas;
}

/** Every row of a table for one career, as the wire carries a bulk table. */
export function readTable(table: string, careerId: string): Record<string, unknown>[] {
  if (table === "careers") {
    return storage.db.all<Record<string, unknown>>(
      sql`SELECT * FROM careers WHERE id = ${careerId}`
    );
  }
  const scoped = PARENT_SCOPED[table];
  if (scoped) {
    return storage.db.all<Record<string, unknown>>(
      sql`SELECT * FROM ${sql.identifier(table)}
          WHERE ${sql.identifier(scoped.column)} IN
            (SELECT id FROM ${sql.identifier(scoped.parent)} WHERE career_id = ${careerId})`
    );
  }
  return storage.db.all<Record<string, unknown>>(
    sql`SELECT * FROM ${sql.identifier(table)} WHERE career_id = ${careerId}`
  );
}

/** Row counts per table for one career. Cheap, and the first thing a drift check compares. */
export function rowCounts(careerId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of DELTA_TABLES) {
    counts[table] = readTable(table, careerId).length;
  }
  return counts;
}

/**
 * A content hash of one table for one career.
 *
 * Sorted by each row's canonical JSON, so the same set of rows hashes the same whatever order the
 * database returns them in. This is what lets a 19,000 row table be compared with a few hundred bytes on
 * the wire instead of 15 MB.
 *
 * The keys inside a row are sorted too, and that is load-bearing rather than tidy: a database built by
 * replaying migrations has its columns in the order they were added, and one built from the current DDL
 * has them in the order the table is written. `SELECT *` then returns the same values in a different
 * order, and an unsorted hash would report drift between two sides that hold exactly the same career.
 */
export function tableHash(table: string, careerId: string): string {
  const rows = readTable(table, careerId)
    .map((row) => canonicalRow(row))
    .sort();
  return sha1Hex(rows.join("\n"));
}

function canonicalRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  return JSON.stringify(keys.map((key) => [key, row[key] ?? null]));
}

/** Bulk tables a write has touched since they were last pushed. */
export function dirtyBulkTables(careerId: string): string[] {
  return storage.db
    .all<{ table_name: string }>(
      sql`SELECT table_name FROM _sync_bulk_dirty WHERE career_id = ${careerId} ORDER BY table_name`
    )
    .map((row) => row.table_name);
}

export function clearBulkDirty(careerId: string, tables: string[]): void {
  for (const table of tables) {
    storage.db.run(
      sql`DELETE FROM _sync_bulk_dirty WHERE career_id = ${careerId} AND table_name = ${table}`
    );
  }
}

/**
 * Drops every ledger entry for one career.
 *
 * Used after the career has been replaced wholesale by a seed or a reseed: the rows that were replaced
 * are not changes to send anywhere, and keeping their log entries would push a career's entire past at
 * the other side one row at a time.
 */
export function clearCareerLedger(careerId: string): void {
  storage.db.run(sql`DELETE FROM _sync_log WHERE career_id = ${careerId}`);
  storage.db.run(sql`DELETE FROM _sync_bulk_dirty WHERE career_id = ${careerId}`);
}

/** A value in the ledger's own key-value table: applied revision, last hash, and so on. */
export function readMeta(key: string): string | null {
  const rows = storage.db.all<{ value: string }>(sql`SELECT value FROM _sync_meta WHERE key = ${key}`);
  return rows[0]?.value ?? null;
}

export function writeMeta(key: string, value: string | null): void {
  if (value === null) {
    storage.db.run(sql`DELETE FROM _sync_meta WHERE key = ${key}`);
    return;
  }
  storage.db.run(
    sql`INSERT INTO _sync_meta (key, value) VALUES (${key}, ${value})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
}
