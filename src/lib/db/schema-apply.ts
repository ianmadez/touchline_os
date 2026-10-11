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

  return schemaVersion(sqlite) !== before;
}
