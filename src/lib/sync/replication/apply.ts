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
 * Applies one batch and records what was done.
 *
 * `bulk` blocks are applied only when their hash differs from the hash last applied, which is what lets
 * a 19,000 row table be compared with a few hundred bytes and skipped entirely when it has not moved.
 * The `_sync_bulk_dirty` markers for applied tables are cleared, because the local ledger no longer has
 * anything to say about them - the content is the remote side's.
 */
export function applyBatch(careerId: string, deltas: Delta[], bulk: WireBulk[] = []): void {
  storage.withTransaction(() => {
    // A bulk table can reference another bulk table, and the blocks that arrive are only the ones whose
    // hash moved. Deferring the checks to COMMIT means the tables can be emptied and refilled in whatever
    // order the sender's journal produced, and a violation is still refused - just at the end, with a
    // rollback, rather than halfway through.
    storage.db.run(sql`PRAGMA defer_foreign_keys = ON`);
    setLoggingSuppressed(true);
    try {
      const ordered = deltas
        .filter((delta) => tableClass(delta.table) === "delta")
        .map((delta, index) => ({ delta, index, rank: rankOf(delta) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index);

      for (const { delta } of ordered) {
        if (delta.op === "D") deleteRow(delta.table, delta.key);
        else if (delta.row) insertRow(delta.table, delta.row);
      }

      // Bulk tables are deleted in reverse declaration order and written forwards, which is the order
      // the transfer service uses: it is the one order that satisfies every foreign key between them.
      const changed = bulk.filter(
        (block) =>
          tableClass(block.table) === "bulk" && readMeta(bulkMetaKey(block.table)) !== block.hash
      );
      if (changed.length > 0) {
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
    } finally {
      setLoggingSuppressed(false);
    }
  });
}
