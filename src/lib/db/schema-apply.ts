/**
 * Bringing a database up to the current schema, for both ports.
 *
 * WHY THIS IS ITS OWN MODULE. The local build has `npm run db:init`, which a developer runs by hand. The
 * browser build has nothing to run: its database lives in OPFS, it is the only copy of the manager's data,
 * and there is no shell to type a command into. So the browser port has to do the same work ITSELF, on
 * every open, and the two must never drift - which is why the statements stay in `schema-sql.ts` and only
 * the applying of them lives here.
 *
 * THE BUG THIS EXISTS TO PREVENT. The browser port used to run the schema only when it created a NEW
 * database, so a database written by an earlier build kept its earlier shape forever. The symptom arrived
 * much later and looked nothing like a schema problem: `table leagues has no column named country_name`,
 * on the entry screen, with no way for the manager to fix it and no command he could run. Anything added
 * to `SCHEMA_DDL` or `SCHEMA_MIGRATIONS` after his first visit was invisible to him.
 *
 * `schema_version` is SQLite's own counter, bumped by DDL, which is what lets a caller know the database
 * was CHANGED rather than merely visited. That distinction matters for the browser port: it persists a
 * whole image and only writes when something moved, and `total_changes()` counts ROWS, so a migration
 * that only alters the schema would otherwise be applied in memory and then thrown away with the tab.
 */

/** The only two members needed, so both a `better-sqlite3` and a `sql.js` database satisfy this. */
export interface SchemaTarget {
  exec(sql: string): unknown;
}

import { SCHEMA_DDL, SCHEMA_MIGRATIONS } from "./schema-sql";
import {
  REPLICATION_FINGERPRINT,
  REPLICATION_FINGERPRINT_KEY,
  REPLICATION_LEDGER_DDL,
  REPLICATION_TRIGGERS_DDL,
} from "../sync/replication/schema";

/**
 * One number out of a query, whichever driver is underneath.
 *
 * THREE SHAPES have to be understood here, and every one of them was found the hard way:
 *
 *   - `better-sqlite3.exec` returns THE DATABASE, not a result set, so it can never answer a query. Its
 *     `pragma()` does, which is why that is tried first.
 *   - `sql.js.exec` returns `[{ columns, values }]`.
 *   - a `sql.js` statement returns an ARRAY of column values from `get()` and an object from
 *     `getAsObject()`.
 *
 * Reading only `values` (the first shape written here) returned null for every better-sqlite3 caller,
 * which is indistinguishable from "the schema never moved" - and that is exactly the signal the browser
 * port needs to be truthful about, so it would have silently disabled the write-back.
 */
function readNumber(sqlite: SchemaTarget, sql: string): number | null {
  const asNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return null;
  };

  try {
    const pragmaName = /^\s*PRAGMA\s+([a-z_]+)\s*$/i.exec(sql)?.[1];
    const pragma = (sqlite as { pragma?: (name: string) => unknown }).pragma;
    if (pragmaName && typeof pragma === "function") {
      const result = pragma.call(sqlite, pragmaName);
      const row = Array.isArray(result) ? result[0] : result;
      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>;
        const value = record[pragmaName] ?? Object.values(record)[0];
        const number = asNumber(value);
        if (number !== null) return number;
      }
    }

    const result = sqlite.exec(sql);
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0] as Record<string, unknown>;
      const values = first.values;
      if (Array.isArray(values)) return asNumber((values[0] as unknown[])?.[0]);
      return asNumber(Object.values(first)[0]);
    }
  } catch {
    // A driver that cannot answer returns null rather than throwing into a caller that cannot act on it.
  }
  return null;
}

/**
 * One text value out of a query, with the same three driver shapes understood as `readNumber`.
 *
 * `better-sqlite3.exec` returns the database itself rather than a result set, so a prepared statement
 * is tried first. Reading a value through `exec` alone silently returns null there, and null reads as
 * "the fingerprint is not stored yet", which would recreate every trigger on every open and rewrite the
 * browser's image each page load.
 */
function readText(sqlite: SchemaTarget, sql: string): string | null {
  const cellOf = (row: unknown): string | null => {
    if (!row || typeof row !== "object") return null;
    const cell = Object.values(row as Record<string, unknown>)[0];
    return typeof cell === "string" ? cell : null;
  };

  try {
    const prepare = (sqlite as { prepare?: (statement: string) => { get?: () => unknown } }).prepare;
    if (typeof prepare === "function") {
      const statement = prepare.call(sqlite, sql);
      if (statement && typeof statement.get === "function") {
        const value = cellOf(statement.get());
        if (value !== null) return value;
      }
    }
  } catch {
    // Fall through to the shapes below.
  }

  try {
    const result = sqlite.exec(sql);
    if (!Array.isArray(result) || result.length === 0) return null;
    const first = result[0] as Record<string, unknown>;
    const values = first.values;
    if (Array.isArray(values)) {
      const cell = (values[0] as unknown[])?.[0];
      return typeof cell === "string" ? cell : null;
    }
    return cellOf(first);
  } catch {
    // A driver that cannot answer returns null, which reads as "not applied yet" and is safe.
    return null;
  }
}

/**
 * SQLite's schema cookie. Moves when DDL runs, and never for a plain read.
 *
 * This is the signal that separates "the schema was changed" from "the schema was visited", which the
 * browser port needs because it persists a whole image and only writes when something moved.
 */
export function schemaVersion(sqlite: SchemaTarget): number {
  return readNumber(sqlite, "PRAGMA schema_version") ?? -1;
}

/**
 * Creates what is missing and migrates what is already there.
 *
 * Safe to call on every open because every statement in it is idempotent: the DDL is all
 * `CREATE ... IF NOT EXISTS`, the migrations are additive `ALTER TABLE ADD COLUMN` (a repeat throws, which
 * is swallowed exactly as `scripts/init-db.ts` swallows it), and the handful of `UPDATE`s are written to be
 * no-ops on a database that has already run them.
 *
 * Returns true when the schema itself moved, which is the caller's signal to persist.
 */
export function applySchema(sqlite: SchemaTarget): boolean {
  const before = schemaVersion(sqlite);

  sqlite.exec(SCHEMA_DDL);
  // Enforced for the same reason it is enforced locally: the cascade rules are what stop a deleted career
  // from leaving orphaned rows behind.
  sqlite.exec("PRAGMA foreign_keys = ON");

  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      sqlite.exec(statement);
    } catch {
      // Already applied. This is the expected outcome for every statement but the newest one.
    }
  }

  // The replication ledger and its triggers, from the same place and for the same reason: the browser
  // port has no shell to run a command in, so anything the schema needs has to be applied on open.
  //
  // The tables are created every time (they are `IF NOT EXISTS`). The triggers are only recreated when
  // the fingerprint says their bodies have changed, and that matters more than it looks: recreating
  // them on every open would move the schema cookie on every page load, and the browser port persists
  // its whole image whenever that cookie moves. A read-only visit must not rewrite fifteen megabytes.
  sqlite.exec(REPLICATION_LEDGER_DDL);
  const appliedFingerprint = readText(
    sqlite,
    `SELECT value FROM _sync_meta WHERE key = '${REPLICATION_FINGERPRINT_KEY}'`
  );
  if (appliedFingerprint !== REPLICATION_FINGERPRINT) {
    sqlite.exec(REPLICATION_TRIGGERS_DDL);
    sqlite.exec(
      `INSERT INTO _sync_meta (key, value) VALUES ('${REPLICATION_FINGERPRINT_KEY}', '${REPLICATION_FINGERPRINT}')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  }

  return schemaVersion(sqlite) !== before;
}
