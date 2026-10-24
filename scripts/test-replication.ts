/**
 * The replication proof: seed, push, pull, status, reseed, and the two refusals that matter.
 *
 * Two real databases in two real processes, because `platform/storage` is a singleton bound to
 * `DATABASE_URL` at load and a test that faked one of the sides would not be testing replication. The
 * page is this process; the bridge replica is `scripts/replication-test-host.ts` with the real core server
 * listening on an ephemeral port.
 *
 * What is asserted is the wire, not the internals: that a seed creates a career that is not there and
 * replaces one that is stale, that a push is numbered and acknowledged, that a pull does not send a
 * device its own writes back, that a phone's write reaches the page through the journal, that a bulk
 * table arrives as a hash and rows rather than as 19,000 deltas, that a stale push is refused rather than
 * applied, that a replica holding something the page lacks is refused with a comparison, and that a
 * reseed snapshots what it overwrites. The LAN listener is checked to have no `/sync` at all.
 *
 *   npx tsx scripts/test-replication.ts
 *
 * Uses copies under `data/replication-test/` and deletes them. Never touches the real career.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const fixture = path.join(root, "data", "backups", "pre-rework-2026-10-24_131953", "touchline.snapshot.db");
// A temporary folder, because the parent process keeps its own copy open for the whole run and Windows
// will not delete a file that is still open. Nothing here can reach a real career either way.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-replication-"));
const pageDb = path.join(workDir, "page.db");
const bridgeDb = path.join(workDir, "bridge.db");
const CAREER_ID = "career_club_1917";
const CODE = "QWER45";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function tsxCli(): string | null {
  const candidates = [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Starts the replica process and waits for the port line. */
function startHost(): Promise<{ child: ChildProcessWithoutNullStreams; loopback: number; lan: number }> {
  const cli = tsxCli();
  if (!cli) throw new Error("tsx is not installed. Run npm install.");

  const child = spawn(process.execPath, [cli, path.join("scripts", "replication-test-host.ts"), bridgeDb, CAREER_ID], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`the replica did not start: ${buffer}`)), 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = /PORT (\d+) (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve({ child, loopback: Number(match[1]), lan: Number(match[2]) });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (process.env.REPLICATION_TEST_VERBOSE) {
        process.stderr.write(`\n[replica exited: code ${code} signal ${signal}]\n`);
      }
      reject(new Error(`the replica exited early (${code}): ${buffer}`));
    });
  });
}

/** Sends one command to the replica and waits for its answer. */
function command(child: ChildProcessWithoutNullStreams, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${name}`)), 30_000);
    const listener = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (!text.startsWith("OK") && !text.startsWith("ERR")) return;
      clearTimeout(timer);
      child.stdout.off("data", listener);
      resolve(text.trim());
    };
    child.stdout.on("data", listener);
    child.stdin.write(`${name}\n`);
  });
}

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
}

async function call(base: string, route: string, init: { method?: string; body?: unknown; code?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (init.code !== undefined) headers["x-touchline-bridge-code"] = init.code;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  // One retry, because a long synchronous apply on this side lets the server close the pooled keep-alive
  // socket, and reusing it then reports ECONNRESET for a request that never reached the route.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${base}${route}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      return { status: response.status, body };
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

async function main(): Promise<void> {
  if (!fixture.startsWith(path.join(root, "data"))) {
    console.error("Refusing to run outside data/.");
    process.exit(2);
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.copyFileSync(fixture, pageDb);
  fs.copyFileSync(fixture, bridgeDb);
  // The replica starts empty of this career, which is the ordinary first-seed case.
  const Database = (await import("better-sqlite3")).default;
  const empty = new Database(bridgeDb);
  empty.pragma("foreign_keys = ON");
  empty.prepare("DELETE FROM careers WHERE id = ?").run(CAREER_ID);
  empty.close();

  process.env.DATABASE_URL = pageDb;

  const { sql } = await import("drizzle-orm");
  const { storage } = await import("../src/lib/platform/storage");
  const { buildTransferPackage } = await import("../src/lib/services/career-transfer-service");
  const { applyBatch, toDelta } = await import("../src/lib/sync/replication/apply");
  const { ackChanges, deltasFor, pendingCount, tableHash } = await import("../src/lib/sync/replication/ledger");

  const host = await startHost();

  try {
    const base = String(host.loopback);    const lan = String(host.lan);

    console.log("\n1. A career the PC does not have");
    const pkg = await buildTransferPackage(CAREER_ID);
    check("the page holds the career", pkg !== null);
    const first = await call(base, "/sync/seed", { method: "POST", code: CODE, body: { careerId: CAREER_ID, package: pkg } });
    check("an absent career is created", first.status === 200 && first.body?.result === "created", `${first.status} ${JSON.stringify(first.body?.result ?? first.body?.error)}`);
    check("nothing was snapshotted, because nothing was overwritten", first.body?.backup === undefined);

    console.log("\n2. The same career again");
    const second = await call(base, "/sync/seed", { method: "POST", code: CODE, body: { careerId: CAREER_ID, package: pkg } });
    check("an equal copy is left alone", second.status === 200 && second.body?.result === "unchanged", JSON.stringify(second.body?.result));

    console.log("\n3. The door");
    const noCode = await call(base, "/sync/status?careerId=" + CAREER_ID);
    check("a request with no pairing code is refused", noCode.status === 401, `status ${noCode.status}`);
    const wrongCode = await call(base, "/sync/status?careerId=" + CAREER_ID, { code: "AAAAAA" });
    check("a wrong pairing code is refused", wrongCode.status === 401, `status ${wrongCode.status}`);
    const lanSync = await call(lan, "/sync/status?careerId=" + CAREER_ID, { code: CODE });
    check("the shared listener has no /sync at all", lanSync.status === 404, `status ${lanSync.status}`);

    console.log("\n4. A page write, pushed");
    storage.db.run(
      sql`INSERT OR REPLACE INTO career_trophies (id, career_id, key, name, kind, season, provenance)
          VALUES (${`${CAREER_ID}_from_page`}, ${CAREER_ID}, 'from_page', 'Won at home', 'LEAGUE', 2, 'USER')`
    );
    check("the trigger logged the write", pendingCount(CAREER_ID) > 0, `${pendingCount(CAREER_ID)} entry(s)`);
    const deltas = deltasFor(CAREER_ID);
    check("the delta carries the row", deltas.some((delta) => delta.table === "career_trophies" && delta.row !== null));

    const pushed = await call(base, "/sync/push", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, clientId: "page-1", baseRevision: 0, deltas, bulk: [] },
    });
    check("the push is accepted", pushed.status === 200, `status ${pushed.status}`);
    const revision = Number(pushed.body?.revision ?? 0);
    check("it is numbered", revision > 0, `revision ${revision}`);
    check("and acknowledged", Number(pushed.body?.ackedSeq ?? 0) >= Math.max(...deltas.map((delta) => delta.seq)));

    ackChanges(Number(pushed.body?.ackedSeq ?? 0));
    check("the outbox is empty afterwards", pendingCount(CAREER_ID) === 0);

    console.log("\n5. No echo, and no duplicates");
    const own = await call(base, `/sync/pull?careerId=${CAREER_ID}&since=0&clientId=page-1`, { code: CODE });
    check("a pull does not return a device's own push", (own.body?.deltas as unknown[]).length === 0, `${(own.body?.deltas as unknown[]).length} delta(s)`);
    const theirs = await call(base, `/sync/pull?careerId=${CAREER_ID}&since=0&clientId=somebody-else`, { code: CODE });
    check("somebody else does see it", (theirs.body?.deltas as unknown[]).length >= 1, `${(theirs.body?.deltas as unknown[]).length} delta(s)`);

    const replay = await call(base, "/sync/push", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, clientId: "page-1", baseRevision: revision, deltas, bulk: [] },
    });
    check("re-sending the same batch is accepted", replay.status === 200, `status ${replay.status}`);
    const afterReplay = await call(base, `/sync/pull?careerId=${CAREER_ID}&since=${revision}&clientId=somebody-else`, { code: CODE });
    check("and adds nothing", (afterReplay.body?.deltas as unknown[]).length === 0, `${(afterReplay.body?.deltas as unknown[]).length} delta(s)`);

    console.log("\n6. A change made on the PC reaches the page");
    const phone = await command(host.child, "phone-write");
    check("the replica accepted a phone write", phone.startsWith("OK"), phone);
    const fromPhone = await call(base, `/sync/pull?careerId=${CAREER_ID}&since=${revision}&clientId=page-1`, { code: CODE });
    const phoneDeltas = (fromPhone.body?.deltas ?? []) as Array<{ table: string; row: Record<string, unknown> | null }>;
    check("the pull carries it", phoneDeltas.some((delta) => delta.table === "career_trophies"), `${phoneDeltas.length} delta(s)`);

    applyBatch(CAREER_ID, (fromPhone.body?.deltas as never[]).map(toDelta), (fromPhone.body?.bulk as never[]) ?? []);
    const revisionAfterPhone = Number(fromPhone.body?.revision ?? 0);
    const statusAfterPhone = await call(base, `/sync/status?careerId=${CAREER_ID}`, { code: CODE });
    check(
      "the page now hashes the same as the replica",
      tableHash("career_trophies", CAREER_ID) === (statusAfterPhone.body?.hashes as Record<string, string>)?.career_trophies
    );

    console.log("\n7. A bulk table moves as one unit");
    const bulk = await command(host.child, "phone-bulk");
    check("the replica rewrote a bulk table", bulk.startsWith("OK"), bulk);
    const bulkPull = await call(base, `/sync/pull?careerId=${CAREER_ID}&since=${revisionAfterPhone}&clientId=page-1`, { code: CODE });
    const blocks = (bulkPull.body?.bulk ?? []) as Array<{ table: string; hash: string; rows: unknown[] }>;
    check("it arrives as a hash and rows", blocks.some((block) => block.table === "world_players"), `${blocks.length} block(s)`);
    check("and not as row deltas", ((bulkPull.body?.deltas ?? []) as unknown[]).length === 0);

    applyBatch(CAREER_ID, [], blocks as never[]);
    const statusAfterBulk = await call(base, `/sync/status?careerId=${CAREER_ID}`, { code: CODE });
    check(
      "the page's bulk table now matches",
      tableHash("world_players", CAREER_ID) === (statusAfterBulk.body?.hashes as Record<string, string>)?.world_players
    );

    console.log("\n8. A push from a page that has not caught up");
    const stale = await call(base, "/sync/push", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, clientId: "page-1", baseRevision: revision, deltas: [], bulk: [] },
    });
    check("is refused rather than applied", stale.status === 409 && stale.body?.code === "stale", `status ${stale.status}`);

    console.log("\n9. A replica holding something the page does not");
    const added = await command(host.child, "phone-add");
    check("the replica gained a row of its own", added.startsWith("OK"), added);
    const refused = await call(base, "/sync/seed", { method: "POST", code: CODE, body: { careerId: CAREER_ID, package: pkg } });
    check("the seed is refused with 409", refused.status === 409, `status ${refused.status}`);
    const comparison = refused.body?.comparison as { pcOnly?: Record<string, number> } | undefined;
    check(
      "and names what would have been lost",
      (comparison?.pcOnly?.career_trophies ?? 0) >= 1,
      JSON.stringify(comparison?.pcOnly)
    );

    console.log("\n10. Choosing a side on purpose");
    // A fresh package, because the page has taken the phone's changes since the one built above.
    const current = await buildTransferPackage(CAREER_ID);
    const reseeded = await call(base, "/sync/reseed", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, direction: "page-to-pc", package: current },
    });
    check("the replica accepts the page's copy", reseeded.status === 200, `status ${reseeded.status}`);
    const backup = String(reseeded.body?.backup ?? "");
    check("and snapshots what it replaced first", backup !== "" && fs.existsSync(backup), backup);
    check("the snapshot is not in the real backup folder", !backup.includes(path.join("data", "backups")), backup);

    const afterReseed = await call(base, `/sync/status?careerId=${CAREER_ID}`, { code: CODE });
    check("the journal starts again", Number(afterReseed.body?.revision ?? -1) === 0, `revision ${afterReseed.body?.revision}`);
    check(
      "and the two sides agree",
      tableHash("career_trophies", CAREER_ID) === (afterReseed.body?.hashes as Record<string, string>)?.career_trophies
    );

    console.log("\n11. The other direction");
    const toPage = await call(base, "/sync/reseed", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, direction: "pc-to-page" },
    });
    check("the replica hands over its whole career", toPage.status === 200 && Boolean(toPage.body?.package), `status ${toPage.status}`);

    console.log("\n12. A push into a replica that has lost the career");
    const gone = await command(host.child, "drop-career");
    check("the replica dropped it", gone.startsWith("OK"), gone);
    const orphan = await call(base, "/sync/push", {
      method: "POST",
      code: CODE,
      body: { careerId: CAREER_ID, clientId: "page-1", baseRevision: 0, deltas: [], bulk: [] },
    });
    check(
      "the push says it is unseeded rather than failing",
      orphan.status === 409 && orphan.body?.code === "unseeded",
      `status ${orphan.status}`
    );
    console.log("\n13. The version handshake, in both directions");
    const { SCHEMA_VERSION, MIGRATION_LEVEL, compareSchema, compatibilityMessage, compatible } = await import(
      "../src/lib/sync/versions"
    );

    const same = compareSchema({ schemaVersion: SCHEMA_VERSION, migrationLevel: MIGRATION_LEVEL });
    check("the same schema is recognised as the same", same === "same", same);
    check("and has nothing to say", compatibilityMessage(same) === null, String(compatibilityMessage(same)));
    check("and is allowed to pair", compatible(same) === true);

    const bridgeOlder = compareSchema({
      schemaVersion: "000000000000",
      migrationLevel: MIGRATION_LEVEL - 1,
    });
    check("a bridge behind the page is named as older", bridgeOlder === "bridge-older", bridgeOlder);
    check(
      "and is told to update the bridge",
      compatibilityMessage(bridgeOlder) === "This bridge is older than the web page. Update the bridge.",
      String(compatibilityMessage(bridgeOlder))
    );
    check("and is refused, rather than paired anyway", compatible(bridgeOlder) === false);

    const pageOlder = compareSchema({
      schemaVersion: "000000000000",
      migrationLevel: MIGRATION_LEVEL + 1,
    });
    check("a page behind the bridge is named as older", pageOlder === "page-older", pageOlder);
    check(
      "and is told to refresh the page",
      (compatibilityMessage(pageOlder) ?? "").includes("Refresh the web page"),
      String(compatibilityMessage(pageOlder))
    );
    check("and is refused in that direction too", compatible(pageOlder) === false);

    const silent = compareSchema({});
    check("a bridge that says nothing is treated as needing an update", silent === "unknown", silent);
    check(
      "with the update sentence rather than silence",
      (compatibilityMessage(silent) ?? "").includes("Update the bridge"),
      String(compatibilityMessage(silent))
    );
  } finally {
    host.child.stdin.write("quit\n");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        host.child.kill();
        resolve();
      }, 5_000);
      host.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // The replica's database is closed with its process, so the folder can go now. The page's copy is
    // still open in this process, which Windows refuses to delete, so a failure here is ignored.
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // A temporary folder left behind is not a failed test.
    }
  }

  console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
