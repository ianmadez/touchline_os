/**
 * Proves the two things that unblock a stuck sync: the repair of a stale reference, and a refusal that
 * says which row caused it.
 *
 * WHAT WENT WRONG, because a test is only worth reading if you know what it is standing in front of.
 *
 * A page database written while foreign keys went unenforced kept `career_events` rows pointing at
 * `career_snapshots` rows that had since been deleted. On its own that is invisible: nothing reads
 * through that column. Against the replica it is fatal, because the replica DOES enforce the key. Every
 * push rolled back with `FOREIGN KEY constraint failed`, which names neither table nor row; the page read
 * the resulting 500 as "bridge not there" and resent the same batch twice a second; and the repair path
 * could not help, because the export carried the same dead ids and the import failed identically. One
 * database, permanently unable to sync, and a log of identical stack traces.
 *
 * Two behaviours make that impossible to repeat silently:
 *
 *   1. `applySchema` clears a reference whose parent is gone, for every foreign key declared `SET NULL`,
 *      which is exactly what SQLite would have done at the moment the parent was deleted.
 *   2. `applyBatch` reports a foreign key failure as a `ReplicationApplyError` naming the row, which the
 *      bridge turns into `409 unappliable` and the page answers by replacing the replica.
 *
 * Run against a copy:
 *   $env:DATABASE_URL="<abs>/data/repair-test.db"; npx tsx scripts/test-replication-repair.ts
 */
import Database from "better-sqlite3";
import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { applySchema } from "../src/lib/db/schema-apply";
import { storage } from "../src/lib/platform/storage";
import { careers } from "../src/lib/db/schema";
import { applyBatch, ReplicationApplyError } from "../src/lib/sync/replication/apply";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const CAREER_ID = "career_repair_test";
const SNAPSHOT_ID = "snap_repair_test_1";

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: A STALE REFERENCE AND A REFUSAL THAT NAMES THE ROW ===\n");

  // The guard the other writing scripts carry: this one creates and deletes rows.
  if (!config.databasePath.includes("repair-test")) {
    console.error(
      `Refusing to run: DATABASE_URL must point at a repair-test copy, not ${config.databasePath}.`
    );
    process.exit(1);
  }
  console.log(`Database: ${config.databasePath}\n`);

  // The schema step is driven from its own connection: pplySchema wants a raw driver, and this proves
  // it works on the file the app actually opened rather than on a stand-in.
  const schema = new Database(config.databasePath);
  schema.pragma("journal_mode = WAL");

  // 1. A career with one snapshot and an event that points at it.
  storage.db.run(`DELETE FROM careers WHERE id = '${CAREER_ID}'`);
  await db.insert(careers).values({
    id: CAREER_ID,
    managerName: "Repair Test",
    clubId: 1,
    clubName: "Repair Athletic",
  });
  storage.db.run(
    `INSERT INTO career_snapshots (id, career_id, snapshot_number, raw_payload_hash)
     VALUES ('${SNAPSHOT_ID}', '${CAREER_ID}', 1, 'hash')`
  );
  storage.db.run(
    `INSERT INTO career_events (id, career_id, snapshot_id, event_type, source, entity_type, entity_id, payload_json)
     VALUES ('evt_repair_1', '${CAREER_ID}', '${SNAPSHOT_ID}', 'TEST', 'SAVE', 'career', 'x', '{}')`
  );

  const danglingCount = (): number => {
    const rows = storage.db.all(
      `SELECT COUNT(*) AS n FROM career_events
        WHERE snapshot_id IS NOT NULL
          AND snapshot_id NOT IN (SELECT id FROM career_snapshots)`
    ) as { n: number }[];
    return rows[0]?.n ?? 0;
  };

  console.log("1. A reference that still resolves is left alone");
  check("no dangling reference to begin with", danglingCount() === 0);
  applySchema(schema);
  check(
    "and the repair leaves a valid reference alone",
    (storage.db.all(`SELECT snapshot_id FROM career_events WHERE id = 'evt_repair_1'`) as {
      snapshot_id: string | null;
    }[])[0]?.snapshot_id === SNAPSHOT_ID
  );

  console.log("\n2. The parent goes away, exactly as an unenforced foreign key would have allowed");
  // Written with the constraint off, which is what the browser build did before it enforced them: this is
  // the state the manager's own database was found in.
  storage.db.run("PRAGMA foreign_keys = OFF");
  storage.db.run(`DELETE FROM career_snapshots WHERE id = '${SNAPSHOT_ID}'`);
  storage.db.run("PRAGMA foreign_keys = ON");
  check("the event now points at nothing", danglingCount() === 1, `${danglingCount()} dangling`);

  console.log("\n3. Opening the database again repairs it");
  applySchema(schema);
  check("the dead reference is cleared", danglingCount() === 0);
  const cleared = storage.db.all(
    `SELECT snapshot_id FROM career_events WHERE id = 'evt_repair_1'`
  ) as { snapshot_id: string | null }[];
  check("cleared rather than deleted: the event is still here", cleared.length === 1);
  check("and its reference is null, which is what SET NULL means", cleared[0]?.snapshot_id === null);

  console.log("\n4. A second pass changes nothing");
  const before = storage.db.all("SELECT COUNT(*) AS n FROM career_events") as { n: number }[];
  applySchema(schema);
  const after = storage.db.all("SELECT COUNT(*) AS n FROM career_events") as { n: number }[];
  check("the repair is idempotent", before[0]?.n === after[0]?.n, `${before[0]?.n} rows`);

  console.log("\n5. A batch whose parent is missing is refused, and says which row");
  let caught: unknown = null;
  try {
    applyBatch(CAREER_ID, [
      {
        table: "career_events",
        key: "evt_repair_2",
        op: "I",
        seq: 1,
        row: {
          id: "evt_repair_2",
          career_id: CAREER_ID,
          snapshot_id: "snap_that_does_not_exist",
          event_type: "TEST",
          source: "SAVE",
          entity_type: "career",
          entity_id: "x",
          payload_json: "{}",
        },
      },
    ]);
  } catch (error) {
    caught = error;
  }
  check("it throws a refusal rather than a raw constraint failure", caught instanceof ReplicationApplyError);
  const message = caught instanceof Error ? caught.message : String(caught);
  check("the message names the row", /evt_repair_2/.test(message), message.slice(0, 120));
  check("and names the parent that is missing", /career_snapshots/.test(message));

  console.log("\n6. Nothing from the refused batch was kept");
  const leaked = storage.db.all(`SELECT id FROM career_events WHERE id = 'evt_repair_2'`) as {
    id: string;
  }[];
  check("the rejected row is not in the database", leaked.length === 0);

  // Leave nothing behind in the copy.
  storage.db.run(`DELETE FROM careers WHERE id = '${CAREER_ID}'`);
  const leftovers = storage.db.all(`SELECT id FROM careers WHERE id = '${CAREER_ID}'`) as {
    id: string;
  }[];
  check("the test career is cleaned up", leftovers.length === 0);

  console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
  if (failures > 0) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
