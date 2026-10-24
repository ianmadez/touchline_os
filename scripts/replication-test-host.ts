/**
 * The replica side of the replication proof, as its own process.
 *
 * Two databases cannot be open at once in one process: `platform/storage` is a module singleton bound to
 * `DATABASE_URL` at load, deliberately. So the only honest way to test page-to-bridge replication is two
 * processes, and this is the bridge one: it hosts the real core server on an ephemeral port, points it at
 * a copy of a real career, and takes commands on stdin so the test can write to the replica the way a
 * phone would (through the ordinary write path, which is what fires the triggers).
 *
 * Started by `scripts/test-replication.ts`. Never run directly: it prints a port and waits.
 */
import fs from "node:fs";
import readline from "node:readline";

/** Synchronous, so a line written just before an exit is never lost in a pipe buffer. */
function log(line: string): void {
  try {
    fs.writeSync(1, `${line}\n`);
  } catch {
    // A closed stdout is not worth failing over.
  }
}

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const careerId = process.argv[3] ?? "career_club_1917";
  if (!dbPath) {
    console.error("usage: replication-test-host <db> <careerId>");
    process.exit(2);
  }
  process.env.DATABASE_URL = dbPath;

  const { sql } = await import("drizzle-orm");
  const { storage } = await import("../src/lib/platform/storage");
  const { createCoreServer } = await import("../bridge/core-server");
  const { DeviceStore } = await import("../bridge/device-store");

  const store = new DeviceStore(`${dbPath}.devices.json`);
  const code = "QWER45";

  const loopback = createCoreServer({
    store,
    mode: "loopback",
    pairingCode: code,
    hostName: "replication-test",
    port: 0,
  });
  const lan = createCoreServer({
    store,
    mode: "lan",
    pairingCode: code,
    hostName: "replication-test",
    port: 0,
    appDir: null,
  });

  await new Promise<void>((resolve) => loopback.server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => lan.server.listen(0, "127.0.0.1", resolve));
  const loopbackPort = (loopback.server.address() as { port: number }).port;
  const lanPort = (lan.server.address() as { port: number }).port;
  log(`PORT ${loopbackPort} ${lanPort}`);

  /** Writes to the replica the way a phone does: an ordinary statement, logged by the triggers. */
  const commands: Record<string, () => void> = {
    "phone-write": () => {
      storage.db.run(
        sql`UPDATE career_trophies SET name = 'Renamed from the phone'
            WHERE career_id = ${careerId}`
      );
    },
    "phone-add": () => {
      storage.db.run(
        sql`INSERT OR REPLACE INTO career_trophies (id, career_id, key, name, kind, season, provenance)
            VALUES (${`${careerId}_phone_only`}, ${careerId}, 'phone_only', 'Only on the PC',
                    'LEAGUE', 3, 'USER')`
      );
    },
    "phone-bulk": () => {
      storage.db.run(
        sql`UPDATE world_players SET overall_rating = overall_rating
            WHERE id = (SELECT id FROM world_players WHERE career_id = ${careerId} LIMIT 1)`
      );
    },
    "phone-delete": () => {
      storage.db.run(
        sql`DELETE FROM career_trophies WHERE career_id = ${careerId} AND key = 'phone_only'`
      );
    },
    /** What a reinstall or a restored backup looks like: the replica no longer holds this career. */
    "drop-career": () => {
      storage.db.run(sql`DELETE FROM careers WHERE id = ${careerId}`);
    },
  };

  const reader = readline.createInterface({ input: process.stdin });
  process.on("uncaughtException", (error) => {
    log(`FATAL ${(error as Error).message}`);
    process.exit(3);
  });
  reader.on("line", (line) => {
    const command = line.trim();
    if (command === "quit") {
      log("BYE");
      process.exit(0);
    }
    const run = commands[command];
    if (!run) {
      log(`ERR unknown ${command}`);
      return;
    }
    try {
      run();
      log(`OK ${command}`);
    } catch (error) {
      log(`ERR ${(error as Error).message}`);
    }
  });
}

void main();
