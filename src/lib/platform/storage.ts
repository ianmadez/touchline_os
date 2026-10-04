/**
 * Storage for the local Node build: better-sqlite3, opened once per process.
 *
 * This module is a build-time switch point. The browser target substitutes an OPFS-backed
 * implementation, so no caller may depend on anything here beyond the `Storage` interface.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../config";
import * as schema from "../db/schema";
import type { AppDatabase, Storage } from "./types";

const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(config.databasePath);

// Enforce foreign keys and WAL mode for high performance and integrity
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, { schema });

export const storage: Storage = {
  db,
  withTransaction: <T>(work: (tx: AppDatabase) => T): T =>
    db.transaction((tx) => work(tx as unknown as AppDatabase)),
  databaseInfo: async () => {
    try {
      const stat = fs.statSync(config.databasePath);
      return { location: config.databasePath, exists: stat.isFile(), sizeBytes: stat.size };
    } catch {
      // A missing database file is a valid state (nothing synced yet), not an error.
      return { location: config.databasePath, exists: false, sizeBytes: null };
    }
  },
};
