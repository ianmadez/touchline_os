/**
 * Storage for the browser build: SQLite compiled to WebAssembly, persisted to OPFS.
 *
 * The reason this works without touching a single service is that `sql.js` is **synchronous**, so
 * Drizzle's `sql-js` session is the same `'sync'` dialect the local build uses and `withTransaction`
 * keeps its contract - a callback that returns `T`, not `T | Promise<T>`. An async driver (wa-sqlite,
 * the official SQLite WASM build) would have forced `await` through every service call site and
 * through the transaction type itself.
 *
 * The database lives in memory and is written back to OPFS as a whole image. That is the trade this
 * design makes: an incremental journal needs a VFS with an asynchronous API, which is the thing that
 * would have rippled through the app.
 *
 * This module is a build-time switch point, substituted for `./storage` by the browser target.
 */
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../db/schema";
import { SCHEMA_DDL, SCHEMA_MIGRATIONS } from "../db/schema-sql";
import type { AppDatabase, Storage } from "./types";

/** The OPFS file the image lives in. */
const DB_FILE = "touchline.db";

/**
 * The file an image is written to before it replaces the live one.
 *
 * `createWritable()` writes to a swap file and replaces the target when it is closed. If the page is
 * torn down mid-write - a reload, a closed tab, two tabs writing at once - that swap is not something
 * this code can rely on to leave the original intact, and an OPFS entry has been observed to go
 * missing across a navigation. Writing to a scratch file and then *moving* it into place means an
 * interrupted write can only ever damage the scratch file.
 */
const TMP_FILE = "touchline.db.tmp";

/** Held for the duration of a write so two tabs cannot interleave whole-image replacements. */
const PERSIST_LOCK = "touchline.db.persist";

/**
 * `FileSystemHandle.move()` is part of the File System Access spec's later drafts rather than of
 * `lib.dom.d.ts`, the same way `showOpenFilePicker` is. Declared here, and always called as optional:
 * if a browser does not implement it the write falls back to replacing the live file directly.
 */
declare global {
  interface FileSystemFileHandle {
    move?(name: string): Promise<void>;
  }
}

/**
 * How often the in-memory database is checked for unwritten changes.
 *
 * Short enough that losing a tab costs nothing meaningful, long enough that the burst of writes in
 * one sync is persisted once rather than on every statement.
 */
const PERSIST_INTERVAL_MS = 750;

const inBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";

/**
 * Where the wasm binary is served from, staged into `public/sql-wasm.wasm` by `scripts/with-target.mjs`.
 *
 * The name is pinned rather than following the `file` sql.js asks for. Turbopack resolves sql.js's
 * `browser` export condition, so it bundles `dist/sql-wasm-browser.js`, which asks for
 * `sql-wasm-browser.wasm` - while the binary itself is byte-identical to `dist/sql-wasm.wasm`
 * (verified by SHA-256: 38c14f6e...670a). Pinning ships one copy instead of two. A future sql.js
 * whose browser build needs a genuinely different binary fails loudly here, on the wasm fetch,
 * rather than subtly.
 */
const locateFile = () => "/sql-wasm.wasm";

/**
 * Stands in for the real thing on the server, where a static export prerenders the page shell.
 *
 * Prerendering must not reach for a database - if it does, this throws with a sentence that says so
 * rather than failing further down with a null dereference.
 */
const unavailable: Storage = {
  db: null as unknown as AppDatabase,
  withTransaction: () => {
    throw new Error(
      "The browser build has no database during prerender; local data is only read in the page."
    );
  },
  databaseInfo: async () => ({ location: "unavailable", exists: false, sizeBytes: null }),
};

async function opfsFile(): Promise<FileSystemFileHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getFileHandle(DB_FILE, { create: true });
  } catch {
    // OPFS is missing or blocked. The app still runs; the database is then memory-only, and
    // `databaseInfo` says so rather than pretending the data is safe.
    return null;
  }
}

/**
 * Reports a scratch file left behind by an interrupted write.
 *
 * Never used as a database - a scratch file that was never moved may be half-written, and there is no
 * way to tell from the outside. If the live file is gone as well this is worth saying out loud rather
 * than leaving the manager wondering where a career went.
 */
async function leftoverScratch(): Promise<string | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const scratch = await root.getFileHandle(TMP_FILE);
    const size = (await scratch.getFile()).size;
    return `${TMP_FILE} (${size} bytes)`;
  } catch {
    return null;
  }
}

/**
 * Replaces the live database with `bytes`, atomically where the platform allows it.
 *
 * `move()` is present in Chrome, Edge and Firefox; without it this degrades to writing the live file
 * directly, which is the older behaviour and carries the older risk.
 */
async function writeImage(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const scratch = await root.getFileHandle(TMP_FILE, { create: true });
  const writable = await scratch.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
  await scratch.move?.(DB_FILE);
}

async function readImage(
  handle: FileSystemFileHandle | null
): Promise<{ kind: "new" } | { kind: "loaded"; bytes: Uint8Array } | { kind: "unreadable"; reason: string }> {
  if (!handle) return { kind: "new" };
  try {
    const file = await handle.getFile();
    if (file.size === 0) return { kind: "new" };
    return { kind: "loaded", bytes: new Uint8Array(await file.arrayBuffer()) };
  } catch (error) {
    // Deliberately NOT treated as "no database yet".
    //
    // A file that exists but cannot be read is the one case where carrying on would destroy data:
    // an empty database would be created, and the first flush would write that emptiness over a
    // good file. The session runs in memory only instead, and says so.
    return { kind: "unreadable", reason: (error as Error).message ?? "unreadable" };
  }
}

/**
 * Creates the schema on a brand new database.
 *
 * The DDL and the additive migration statements are the ones the local initialiser runs, shared from
 * `../db/schema-sql`, so a browser database and a desktop database have the same shape.
 */
function createSchema(sqlite: import("sql.js").Database): void {
  sqlite.run(SCHEMA_DDL);
  // Enforced here for the same reason it is enforced locally: the cascade rules are what keep a
  // deleted career from leaving orphaned rows behind.
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      sqlite.run(statement);
    } catch {
      // Column already exists, ignore duplicate column error.
    }
  }
}

let storageImpl: Storage = unavailable;
let flushImpl: () => Promise<void> = async () => {};

if (inBrowser) {
  const SQL = await initSqlJs({ locateFile });
  const handle = await opfsFile();
  const loaded = await readImage(handle);
  const sqlite = loaded.kind === "loaded" ? new SQL.Database(loaded.bytes) : new SQL.Database();
  if (loaded.kind !== "loaded") createSchema(sqlite);

  /**
   * Reading the existing file failed. The session still works, but it must not write: the file on
   * disk is the only copy of the manager's data, and an in-memory database that started empty is not
   * a replacement for it. Diagnostics says so rather than reporting a healthy database.
   */
  const readOnly = loaded.kind === "unreadable";
  const unreadableReason = loaded.kind === "unreadable" ? loaded.reason : null;

  const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;

  const scalar = (sql: string): number =>
    (sqlite.exec(sql)[0]?.values[0]?.[0] as number | undefined) ?? 0;

  /**
   * `total_changes()` counts rows written since the connection opened, which is exactly the signal
   * needed to know whether the image on disk is stale. DDL does not move it, and the schema is only
   * ever created once, before anything is persisted.
   */
  const writtenRows = (): number => scalar("SELECT total_changes()");
  const imageBytes = (): number => scalar("PRAGMA page_count") * scalar("PRAGMA page_size");

  let persistedRows = writtenRows();
  let queue: Promise<void> = Promise.resolve();
  const scratch = loaded.kind === "new" ? await leftoverScratch() : null;

  const persist = async (): Promise<void> => {
    if (!handle || readOnly) return;
    // `export()` hands back a `Uint8Array` over a possibly-shared buffer; the writable wants an
    // `ArrayBufferView` over a plain one. Re-viewing the same bytes is what makes the types agree.
    const snapshot = sqlite.export();
    const bytes = Uint8Array.from(snapshot);

    // Two independent choices, deliberately kept apart: HOW to replace the file (scratch + move when
    // the browser can, direct write when it cannot) and WHETHER two tabs are allowed to do it at once.
    const replace = async (): Promise<void> => {
      if (typeof handle.move === "function") {
        await writeImage(bytes);
        return;
      }
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
      } finally {
        await writable.close();
      }
    };

    // The in-page queue serialises writes inside this tab; the lock is what stops a second tab from
    // swapping the file out from under this one.
    if (navigator.locks) {
      await navigator.locks.request(PERSIST_LOCK, replace);
      return;
    }
    await replace();
  };

  flushImpl = async () => {
    if (!handle || readOnly || writtenRows() === persistedRows) return;
    // Serialised, and the change is re-checked inside: two overlapping whole-image writes would
    // race, and the later one is not necessarily the newer one.
    queue = queue.then(async () => {
      const changed = writtenRows();
      if (changed === persistedRows) return;
      await persist();
      persistedRows = changed;
    });
    return queue;
  };

  // A poll rather than a hook on every statement: the query builder hides where writes actually
  // happen, and asking SQLite once in a while is cheaper than tracking them.
  setInterval(() => void flushImpl().catch(() => {}), PERSIST_INTERVAL_MS);

  // Last chance to get the image out before the page goes away.
  window.addEventListener("pagehide", () => void flushImpl().catch(() => {}));

  storageImpl = {
    db,
    // Drizzle's `sql-js` session implements `transaction` synchronously, with savepoints for
    // nesting, exactly like the better-sqlite3 session - so this is the Node port's own one-liner.
    withTransaction: <T>(work: (tx: AppDatabase) => T): T =>
      db.transaction((tx) => work(tx as unknown as AppDatabase)),
    databaseInfo: async () => ({
      location: readOnly
        ? `OPFS · ${DB_FILE} (could not be read: ${unreadableReason}) - this session is in memory and will not overwrite it`
        : scratch
          ? `OPFS · ${DB_FILE} (a previous write was interrupted and left ${scratch}; it is not a usable database, so this session started empty)`
          : handle
            ? `OPFS · ${DB_FILE}`
            : "in-memory (browser storage unavailable)",
      exists: loaded.kind === "loaded",
      sizeBytes: imageBytes(),
    }),
  };
}

export const storage: Storage = storageImpl;

/**
 * Writes the current image to OPFS now, rather than waiting for the next poll.
 *
 * The composition layer calls this before it reports a sync as finished, so a manager who closes the
 * tab the instant the spinner stops has still kept their data.
 */
export const flushStorage = (): Promise<void> => flushImpl();
