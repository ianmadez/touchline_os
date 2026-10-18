/**
 * Where the core keeps its data, and how it refuses to lose it.
 *
 * The downloadable bridge and this program are deliberately different sizes of thing. That one is a
 * single file with no dependencies that hands over save bytes; this one hosts the entire app, which
 * means it needs the app's dependencies, so it runs from the repo (`npm run core`) rather than from a
 * download. Three consequences follow, and this module is where the first two live:
 *
 * 1. The database is not `./data/touchline.db` any more. A core that runs from a folder somebody
 *    cloned must not keep its career inside that folder - a `git clean`, a re-clone, or moving the
 *    repo would take the career with it. It lives in `%LOCALAPPDATA%\TouchlineOS`, the same folder
 *    the pairing config already used, so there is one place to back up and one place to delete.
 * 2. A copy is taken before every open. SQLite files do corrupt - a power cut during a WAL
 *    checkpoint is the usual way - and the manager's career is the one thing here that cannot be
 *    regenerated from a save file. `VACUUM INTO` is used rather than copying the file because it
 *    produces a single consistent snapshot even with a WAL beside it, and it compacts while it does.
 * 3. `DATABASE_URL` is set BEFORE anything opens the database. `platform/storage` reads it at module
 *    load, so the entry point must set it and only then import the server - hence the dynamic imports
 *    in `touchline-core.ts`. Setting it afterwards would be a no-op that looks like it worked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/** How many snapshots to keep. Enough to walk back through a bad week, few enough to stay small. */
export const BACKUP_KEEP = 10;

export interface CorePaths {
  dataDir: string;
  dbPath: string;
  backupDir: string;
}

/**
 * `%LOCALAPPDATA%\TouchlineOS`, or the platform equivalent.
 *
 * `TOUCHLINE_DATA_DIR` overrides it, which is what the tests use: a test that wrote into the real
 * career folder would be a test that could destroy the thing it is testing around.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TOUCHLINE_DATA_DIR) return path.resolve(env.TOUCHLINE_DATA_DIR);
  const base = env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "TouchlineOS");
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): CorePaths {
  const dataDir = resolveDataDir(env);
  return {
    dataDir,
    // `DATABASE_URL` is honoured when it names a file, so a manager who has pointed the local app at
    // a specific database keeps it. Anything else falls back to the data directory, which is the
    // interesting case: the core owned by this program rather than by a checkout.
    dbPath: env.DATABASE_URL && path.isAbsolute(env.DATABASE_URL)
      ? env.DATABASE_URL
      : path.join(dataDir, "career.db"),
    backupDir: path.join(dataDir, "backups"),
  };
}

/** Creates the folders the core needs. Idempotent, so it can run on every start. */
export function prepareDirs(paths: CorePaths): void {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.backupDir, { recursive: true });
}

/**
 * Copies the database into `backups/`, newest last, and prunes the old ones.
 *
 * Returns the snapshot's path, or null when there was no database to copy yet - which is the normal
 * state on a first run and must not be reported as a failure.
 */
export function backupDatabase(paths: CorePaths, keep: number = BACKUP_KEEP): string | null {
  if (!fs.existsSync(paths.dbPath)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const target = path.join(paths.backupDir, `career_${stamp}.db`);

  // Opened read-only-ish: the only statement is `VACUUM INTO`, which reads. Closed before the caller
  // opens the real connection, so this never competes with the app for the write lock.
  const source = new Database(paths.dbPath);
  try {
    source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  pruneBackups(paths.backupDir, keep);
  return target;
}

/** Keeps the newest `keep` snapshots. Sorting is on the name, which starts with the timestamp. */
export function pruneBackups(backupDir: string, keep: number): string[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(backupDir)
      .filter((name) => /^career_.*\.db$/.test(name))
      .sort();
  } catch {
    return [];
  }
  const removed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of removed) {
    try {
      fs.rmSync(path.join(backupDir, name), { force: true });
    } catch {
      // A snapshot that cannot be deleted is not a reason to fail a start.
    }
  }
  return removed;
}

/** The snapshots that exist, oldest first. Shown by the diagnostics screen and asserted by the test. */
export function listBackups(backupDir: string): { name: string; sizeBytes: number }[] {
  try {
    return fs
      .readdirSync(backupDir)
      .filter((name) => /^career_.*\.db$/.test(name))
      .sort()
      .map((name) => ({ name, sizeBytes: fs.statSync(path.join(backupDir, name)).size }));
  } catch {
    return [];
  }
}

export interface CoreBoot {
  paths: CorePaths;
  /** Null on the first run, when there was nothing to snapshot. */
  backup: string | null;
  /** True when this is the first run: a database existed only after the schema was applied. */
  created: boolean;
}

/**
 * Everything a start has to do before a single request is served.
 *
 * Order matters and is the whole point of this function existing rather than being inlined: folders,
 * then snapshot, then hand back the path so the entry point can publish it to `DATABASE_URL` before
 * importing anything that opens the database.
 */
export function prepareCore(env: NodeJS.ProcessEnv = process.env): CoreBoot {
  const paths = resolvePaths(env);
  const existed = fs.existsSync(paths.dbPath);
  prepareDirs(paths);
  const backup = existed ? backupDatabase(paths) : null;
  return { paths, backup, created: !existed };
}
