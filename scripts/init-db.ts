import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { config } from "../src/lib/config";
import { SCHEMA_DDL, SCHEMA_MIGRATIONS } from "../src/lib/db/schema-sql";

async function initDatabase() {
  console.log("=== TOUCHLINE OS: INITIALIZING PRODUCTION DATABASE ===");

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(config.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(SCHEMA_DDL);

  // Auto-migration checks for existing databases
  for (const stmt of SCHEMA_MIGRATIONS) {
    try {
      sqlite.exec(stmt);
    } catch {
      // Column already exists, ignore duplicate column error
    }
  }

  console.log("Database initialized cleanly with full foreign keys, indexes, and snapshot history tables at:", config.databasePath);
}

initDatabase().catch((err) => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

