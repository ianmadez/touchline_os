/**
 * Applying a batch of changes that came from another device.
 *
 * This is the only place a remote change is written, on both sides: the bridge applies what the page
 * pushes, and the page applies what the bridge journals. Keeping it in one module is what makes the two
 * halves of replication provably the same operation instead of two implementations that agree until they
 * do not.
 *
 * Three rules, and each one is a way this could otherwise corrupt a career:
 *
 * 1. **Suppressed.** The whole batch runs with the ledger's `applying` flag set, so the triggers do not
 *    log the change straight back out. Without it two devices bounce one row at each other forever.
 * 2. **Ordered for the foreign keys.** A child row cannot be written before its parent, so deletes of
 *    parent-scoped rows go first and their inserts last. Within a bucket the incoming revision order is
 *    kept exactly, because that order is the only thing that decides which of two writes wins.
 * 3. **Idempotent.** Rows are written with `INSERT OR REPLACE` and removed by primary key, so applying
 *    the same batch twice - which a reconnect will do - lands in the same state.
 */
import { sql } from "drizzle-orm";
import { storage } from "../../platform/storage";
import { clearBulkDirty, readMeta, setLoggingSuppressed, writeMeta, type Delta } from "./ledger";
import { BULK_TABLES, KEY_COLUMNS, PARENT_SCOPED, tableClass } from "./tables";
import type { WireBulk, WireDelta } from "./protocol";

/** The `_sync_meta` key that remembers the last content hash applied for a bulk table. */
export function bulkMetaKey(table: string): string {
  return `bulk:${table}`;
}

/** A value as SQLite can bind it, which is the same normalisation the transfer package needs. */
function bindable(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  // A nested object in a column means the sender and this build disagree about the table's shape.
  // Writing `[object Object]` would be worse than refusing the row, so it is refused.
  throw new Error(`A replicated row carries a value this build cannot store (${typeof value}).`);
}

function insertRow(table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  if (columns.length === 0) return;
  storage.db.run(
    sql`INSERT OR REPLACE INTO ${sql.identifier(table)}
        (${sql.join(columns.map((column) => sql.identifier(column)), sql`, `)})
        VALUES (${sql.join(columns.map((column) => sql`${bindable(row[column])}`), sql`, `)})`
  );
}

function deleteRow(table: string, key: string): void {
  const columns = KEY_COLUMNS[table] ?? ["id"];
  const parts = key.split("|");
  const conditions = columns.map(
    (column, index) => sql`${sql.identifier(column)} = ${parts[index] ?? ""}`
  );
  storage.db.run(
    sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.join(conditions, sql` AND `)}`
  );
}

/**
 * Where a delta belongs in the apply order.
 *
 * 0. deletes of child rows (they must go before the parent they point at)
 * 1. every other delete
 * 2. ordinary inserts and updates
 * 3. inserts and updates of child rows (their parents are already there by now)
 */
function rankOf(delta: Delta): number {
  const child = Object.prototype.hasOwnProperty.call(PARENT_SCOPED, delta.table);
  if (delta.op === "D") return child ? 0 : 1;
  return child ? 3 : 2;
}

/** Normalises a wire delta into the shape `applyBatch` uses. */
export function toDelta(wire: WireDelta): Delta {
  return { table: wire.table, key: wire.key, op: wire.op, row: wire.row, seq: wire.seq };
}

/**
 * A batch that could not be applied, with the row that stopped it.
 *
 * This exists because the alternative is what actually happened: SQLite reports a foreign key violation
 * as `FOREIGN KEY constraint failed`, naming neither the table nor the row, the bridge turned that into
 * a 500, the page read a 500 as "not there" and resent the same batch every half second. The manager's
 * log filled with identical stack traces and nothing said which row was wrong or why.
 *
 * So the failure is diagnosed rather than guessed at: the batch is replayed inside a transaction that is
 * rolled back, one statement at a time, with the deferred checks turned off, and the offending row's
 * foreign keys are then inspected to name the parent that is missing.
 */
export class ReplicationApplyError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "ReplicationApplyError";
    this.detail = detail;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";
  const message = (error as { message?: string })?.message ?? "";
  return code === "SQLITE_CONSTRAINT_FOREIGNKEY" || /FOREIGN KEY constraint failed/i.test(message);
}

/**
 * Finds the delta a failed batch cannot write.
 *
 * Only ever called after a failure, and always rolled back: the caller has already lost the batch, so
 * this costs one wasted pass in the rare case and nothing at all in the ordinary one.
 *
 * The batch is applied again exactly as it was, and SQLite's own `foreign_key_check` is then asked
 * which rows do not resolve, before the transaction is abandoned. That is more reliable than replaying
 * statement by statement with the checks turned on: `defer_foreign_keys` cannot be changed inside a
 * transaction, so a replay would have reported nothing at all and blamed no one.
 */
function diagnose(careerId: string, deltas: Delta[], bulk: WireBulk[]): ReplicationApplyError {
  const fallback =
    "This PC could not apply the change and could not say which row was to blame. Its copy and this " +
    "browser's copy disagree, so it needs replacing from this browser.";

  const touched = [
    ...new Set([
      ...deltas.filter((delta) => tableClass(delta.table) === "delta").map((delta) => delta.table),
      ...bulk.filter((block) => tableClass(block.table) === "bulk").map((block) => block.table),
    ]),
  ];

  try {
    storage.withTransaction(() => {
      storage.db.run(sql`PRAGMA defer_foreign_keys = ON`);
      setLoggingSuppressed(true);
      try {
        writeBatch(careerId, deltas, bulk);
      } finally {
        setLoggingSuppressed(false);
      }

      const found = firstViolation(touched);
      throw new ReplicationApplyError(found ?? fallback);
    });
  } catch (error) {
    if (error instanceof ReplicationApplyError) return error;
    return new ReplicationApplyError(fallback);
  }

  // `withTransaction` cannot return normally here: the callback always throws.
  return new ReplicationApplyError(fallback);
}

/**
 * The first row, in any of these tables, that points at a parent this database does not have.
 *
 * `foreign_key_check` reports violations of the CURRENT state, deferred or not, which is what makes it
 * usable as the last thing a doomed transaction does.
 */
function firstViolation(tables: string[]): string | null {
  for (const table of tables) {
    let report: { rowid?: unknown; parent?: unknown }[];
    try {
      report = storage.db.all<{ rowid: number; parent: string }>(
        `PRAGMA foreign_key_check(${JSON.stringify(table)})`
      );
    } catch {
      continue;
    }
    const first = report[0];
    if (!first) continue;

    const parent = typeof first.parent === "string" ? first.parent : "another";
    const rowid = Number(first.rowid);
    let named = "";
    try {
      const row = storage.db.all<Record<string, unknown>>(
        `SELECT * FROM ${JSON.stringify(table)} WHERE rowid = ${Number.isFinite(rowid) ? rowid : 0} LIMIT 1`
      )[0];
      const key = row?.id ?? row?.["career_id"];
      if (typeof key === "string" && key !== "") named = ` ${key}`;
    } catch {
      // The key is a convenience in the message, never a requirement for reporting it.
    }

    return `A ${table}${named} row points at a ${parent} row this PC does not have.`;
  }
  return null;
}

/**
 * The deltas in the order they must be applied.
 *
 * 0. deletes of child rows (they must go before the parent they point at)
 * 1. every other delete
 * 2. ordinary inserts and updates
 * 3. inserts and updates of child rows (their parents are already there by now)
 */
function orderForApply(deltas: Delta[]): Delta[] {
  return deltas
    .filter((delta) => tableClass(delta.table) === "delta")
    .map((delta, index) => ({ delta, index, rank: rankOf(delta) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.delta);
}

/**
 * The batch itself, with no transaction and no ledger handling of its own.
 *
 * Shared by `applyBatch` and by `diagnose`, which has to re-run exactly this to be able to say which row
 * was to blame. Two copies of this would drift, and the one that drifted would be the one used only when
 * something had already gone wrong.
 */
function writeBatch(careerId: string, deltas: Delta[], bulk: WireBulk[]): void {
  for (const delta of orderForApply(deltas)) {
    if (delta.op === "D") deleteRow(delta.table, delta.key);
    else if (delta.row) insertRow(delta.table, delta.row);
  }

  // Bulk tables are deleted in reverse declaration order and written forwards, which is the order
  // the transfer service uses: it is the one order that satisfies every foreign key between them.
  const changed = bulk.filter(
    (block) => tableClass(block.table) === "bulk" && readMeta(bulkMetaKey(block.table)) !== block.hash
  );
  if (changed.length === 0) return;

  for (const table of [...BULK_TABLES].reverse()) {
    if (changed.some((block) => block.table === table)) {
      storage.db.run(sql`DELETE FROM ${sql.identifier(table)} WHERE career_id = ${careerId}`);
    }
  }
  const forward = BULK_TABLES.filter((table) => changed.some((block) => block.table === table));
  for (const table of forward) {
    const block = changed.find((entry) => entry.table === table);
    if (!block) continue;
    for (const row of block.rows) insertRow(table, row);
  }
  for (const block of changed) writeMeta(bulkMetaKey(block.table), block.hash);
  clearBulkDirty(
    careerId,
    changed.map((block) => block.table)
  );
}

/**
 * Applies one batch and records what was done.
 *
 * `bulk` blocks are applied only when their hash differs from the hash last applied, which is what lets
 * a 19,000 row table be compared with a few hundred bytes and skipped entirely when it has not moved.
 * The `_sync_bulk_dirty` markers for applied tables are cleared, because the local ledger no longer has
 * anything to say about them - the content is the remote side's.
 *
 * A foreign key failure is turned into `ReplicationApplyError`, which names the row: see `diagnose` for
 * why that is worth a second pass in the rare case it is needed.
 */
export function applyBatch(careerId: string, deltas: Delta[], bulk: WireBulk[] = []): void {
  try {
    storage.withTransaction(() => {
      // A bulk table can reference another bulk table, and the blocks that arrive are only the ones whose
      // hash moved. Deferring the checks to COMMIT means the tables can be emptied and refilled in whatever
      // order the sender's journal produced, and a violation is still refused - just at the end, with a
      // rollback, rather than halfway through.
      storage.db.run(sql`PRAGMA defer_foreign_keys = ON`);
      setLoggingSuppressed(true);
      try {
        writeBatch(careerId, deltas, bulk);
      } finally {
        setLoggingSuppressed(false);
      }
    });
  } catch (error) {
    throw isForeignKeyViolation(error) ? diagnose(careerId, deltas, bulk) : error;
  }
}
