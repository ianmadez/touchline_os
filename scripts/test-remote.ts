/**
 * Proves the core's contract, against real servers on real ports.
 *
 * The bridge test next door is about a file leaving a disk. This one is about a whole career being
 * served to another device, so the assertions that matter are again the refusals:
 *
 *   - nothing on the LAN answers without a device token, and a wrong code cannot buy one
 *   - a `Host` this machine does not answer for is refused, which is what stops DNS rebinding
 *   - a page from another origin cannot read or write, whatever it knows
 *   - only one device holds the pen, a write from a second is a 409 with a reason, and taking control
 *     moves the epoch so a stale screen cannot write over the top
 *   - a revoked device is refused immediately, on the next call
 *   - the app build served to a phone is the app build, with the remote marker injected
 *   - the database lives where it was told to, survives a restart, and is snapshotted before each open
 *
 * It builds the servers in-process on ephemeral ports with a temporary data directory, so a run cannot
 * touch the real career. That is also why `DATABASE_URL` is set inside `main`: `platform/storage` reads
 * it at module load, so the environment has to exist before the first dynamic import.
 *
 *   npx tsx scripts/test-remote.ts
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

const CODE = "ABCD23";

/** A temporary home for this run's database and device list. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-core-test-"));
const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-core-app-"));

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

interface Probe {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  requestPath: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? null : Buffer.from(options.body, "utf8");
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method ?? "GET",
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function json(probe: Probe): Record<string, unknown> {
  try {
    return JSON.parse(probe.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface Stream {
  frames: { id: string; event: string; data: string }[];
  close: () => void;
  ready: Promise<void>;
}

/** Opens an event stream and parses the frames as they arrive. */
function openStream(port: number, token: string): Stream {
  const frames: Stream["frames"] = [];
  let buffer = "";
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const req = http.request(
    { host: "127.0.0.1", port, path: "/api/remote/events", headers: { "x-touchline-device": token } },
    (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (frame.startsWith(": connected")) resolveReady();
          const id = /(?:^|\n)id: (.*)/.exec(frame)?.[1] ?? "";
          const event = /(?:^|\n)event: (.*)/.exec(frame)?.[1] ?? "";
          const data = /(?:^|\n)data: (.*)/.exec(frame)?.[1] ?? "";
          if (event) frames.push({ id, event, data });
          index = buffer.indexOf("\n\n");
        }
      });
    }
  );
  req.end();
  return { frames, close: () => req.destroy(), ready };
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: CORE AND REMOTE LAYER ===\n");

  process.env.TOUCHLINE_DATA_DIR = dataDir;

  const { prepareCore, listBackups } = await import("../bridge/core");
  const boot = prepareCore();
  process.env.DATABASE_URL = boot.paths.dbPath;
  check("the career database is not created inside the repo", boot.paths.dbPath.startsWith(dataDir), boot.paths.dbPath);
  check("a first run has nothing to snapshot", boot.backup === null && boot.created);

  const { createCoreServer, isWrite } = await import("../bridge/core-server");
  const { DeviceStore } = await import("../bridge/device-store");
  const { createSaveWatcher, pickNewestCandidate } = await import("../bridge/save-watcher");
  const { DEFAULT_REMOTE_PORT, REMOTE_API_VERSION } = await import("../src/lib/remote/protocol");

  // A minimal app build, so the LAN listener has something real to serve.
  fs.mkdirSync(path.join(appDir, "_next", "static"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "index.html"),
    "<!doctype html><html><head><title>TouchlineOS</title></head><body><div id=app></div></body></html>"
  );
  fs.writeFileSync(path.join(appDir, "_next", "static", "chunk.js"), "console.log('chunk');");

  const storeFile = path.join(dataDir, "remote.json");
  const store = DeviceStore.load(storeFile);
  store.setSharing(true);

  const lanServer = createCoreServer({
    store,
    mode: "lan",
    pairingCode: CODE,
    hostName: os.hostname(),
    port: DEFAULT_REMOTE_PORT,
    appDir,
    // Small limits, so the tests for them are microseconds rather than a megabyte of socket.
    maxBodyBytes: 2048,
    rateLimit: { windowMs: 60_000, max: 400, pairMax: 3 },
  });
  const loopbackServer = createCoreServer({
    store,
    mode: "loopback",
    pairingCode: CODE,
    hostName: os.hostname(),
    port: 4977,
  });

  await new Promise<void>((resolve) => lanServer.server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => loopbackServer.server.listen(0, "127.0.0.1", resolve));
  const lanPort = (lanServer.server.address() as AddressInfo).port;
  const loopPort = (loopbackServer.server.address() as AddressInfo).port;
  console.log(`LAN listener on 127.0.0.1:${lanPort}, loopback on 127.0.0.1:${loopPort}\n`);

  try {
    // ------------------------------------------------------------------ 1. handshake
    console.log("1. The handshake, which has to work before a device has paired");
    const status = await request(lanPort, "/status");
    const statusBody = json(status);
    check("answers unauthenticated so a page can identify it", status.status === 200);
    check("identifies itself as the core", statusBody.service === "touchline-core", String(statusBody.service));
    check(
      "publishes the wire version and the oldest app it will serve",
      statusBody.apiVersion === REMOTE_API_VERSION && typeof statusBody.minClientVersion === "number",
      `apiVersion ${String(statusBody.apiVersion)}`
    );
    check("says nothing about the career", !("career" in statusBody) && !("saves" in statusBody));

    const loopStatus = json(await request(loopPort, "/status"));
    check(
      "the loopback listener still answers as the bridge the hosted app looks for",
      loopStatus.service === "touchline-bridge",
      String(loopStatus.service)
    );

    // ------------------------------------------------------------------ 2. host and origin
    console.log("\n2. Host and origin: a request for somebody else's server is not served");
    const badHost = await request(lanPort, "/api/remote/state", { headers: { host: "evil.example.com" } });
    check("refuses a Host it does not answer for", badHost.status === 421, `status ${badHost.status}`);

    const badOrigin = await request(lanPort, "/status", { headers: { origin: "https://evil.example.com" } });
    check("refuses a foreign Origin", badOrigin.status === 403, `status ${badOrigin.status}`);

    // ------------------------------------------------------------------ 3. pairing
    console.log("\n3. Pairing: the code is the only way in");
    const noToken = await request(lanPort, "/api/career");
    check("refuses an unpaired call", noToken.status === 401, `status ${noToken.status}`);
    check("tells the client why, with a code", json(noToken).code === "unpaired", String(json(noToken).code));

    const wrongCode = await request(lanPort, "/api/remote/pair", {
      method: "POST",
      body: JSON.stringify({ code: "ZZZZ99", name: "Test phone" }),
    });
    check("refuses a wrong pairing code", wrongCode.status === 401, `status ${wrongCode.status}`);
    check("names the failure as a pairing-code problem", json(wrongCode).code === "pairing-code");

    const paired = await request(lanPort, "/api/remote/pair", {
      method: "POST",
      body: JSON.stringify({ code: CODE, name: "Test phone" }),
    });
    const pairedBody = json(paired);
    const tokenA = String(pairedBody.token ?? "");
    check("pairs with the right code", paired.status === 200 && tokenA.length > 20);
    check(
      "sets the cookie the event stream needs, HttpOnly",
      String(paired.headers["set-cookie"] ?? "").includes("touchline_device=") &&
        String(paired.headers["set-cookie"] ?? "").toLowerCase().includes("httponly"),
      String(paired.headers["set-cookie"] ?? "(absent)")
    );
    check(
      "hands back the pairing code and a QR for a second device",
      typeof (pairedBody.state as { pairing?: { code?: string; qr?: string } } | undefined)?.pairing?.code === "string" &&
        String((pairedBody.state as { pairing?: { qr?: string } }).pairing?.qr).startsWith("data:image/svg+xml"),
      "QR rendered server-side as a data URL"
    );

    const stateA = await request(lanPort, "/api/remote/state", {
      headers: { "x-touchline-device": tokenA },
    });
    const stateABody = json(stateA) as { self?: { name?: string }; devices?: unknown[]; writer?: { deviceId?: string } };
    check("a paired device can read its own state", stateA.status === 200 && stateABody.self?.name === "Test phone");
    check("pairing makes that device the writer", typeof stateABody.writer?.deviceId === "string");

    // ------------------------------------------------------------------ 4. the career API
    console.log("\n4. The career API, on both listeners");
    const settingsRead = await request(loopPort, "/api/settings", { headers: { origin: "http://localhost:3000" } });
    check("loopback serves the same operations the app calls", settingsRead.status === 200, `status ${settingsRead.status}`);
    check("with the envelope the app already expects", json(settingsRead).success === true);

    const careerRead = await request(loopPort, "/api/career", { headers: { origin: "http://localhost:3000" } });
    check("and answers 404 for a career that does not exist yet", careerRead.status === 404, `status ${careerRead.status}`);

    const pagesOrigin = await request(loopPort, "/api/career", {
      headers: { origin: "https://somebody-else.pages.dev" },
    });
    check(
      "the loopback API refuses a hosted origin, so another site cannot read the career",
      pagesOrigin.status === 403,
      `status ${pagesOrigin.status}`
    );

    const lanRead = await request(lanPort, "/api/settings", { headers: { "x-touchline-device": tokenA } });
    check("the LAN listener serves the same operation to a paired device", lanRead.status === 200);

    // ------------------------------------------------------------------ 5. the lease
    console.log("\n5. One pen: a second device cannot write over the first");
    const settingsWrite = (token: string, value: string) =>
      request(lanPort, "/api/settings", {
        method: "PATCH",
        headers: { "x-touchline-device": token },
        body: JSON.stringify({ saveDirectory: value }),
      });

    const firstWrite = await settingsWrite(tokenA, "C:\\saves");
    check("the device holding the pen can write", firstWrite.status === 200, `status ${firstWrite.status}`);
    check(
      "a successful write publishes a revision",
      typeof firstWrite.headers["x-touchline-revision"] === "string",
      String(firstWrite.headers["x-touchline-revision"])
    );

    const pairedB = await request(lanPort, "/api/remote/pair", {
      method: "POST",
      body: JSON.stringify({ code: CODE, name: "Second phone" }),
    });
    const tokenB = String(json(pairedB).token ?? "");
    check("a second device can pair", tokenB.length > 20);

    const blocked = await settingsWrite(tokenB, "D:\\other");
    check("its write is refused while the first holds the pen", blocked.status === 409, `status ${blocked.status}`);
    check("the refusal says it is a lease problem", json(blocked).code === "lease", String(json(blocked).code));
    check(
      "and carries the epoch the caller would have needed",
      typeof json(blocked).leaseEpoch === "number",
      String(json(blocked).leaseEpoch)
    );

    const taken = await request(lanPort, "/api/remote/lease", {
      method: "POST",
      headers: { "x-touchline-device": tokenB },
      body: JSON.stringify({ take: true }),
    });
    const takenBody = json(taken) as { self?: { writer?: boolean }; writer?: { name?: string } };
    check("taking control succeeds", taken.status === 200);
    check("and the taker is now the writer", takenBody.self?.writer === true && takenBody.writer?.name === "Second phone");

    const stolen = await settingsWrite(tokenA, "E:\\stale");
    check("the displaced device is refused on its next write", stolen.status === 409, `status ${stolen.status}`);

    // ------------------------------------------------------------------ 6. event stream
    console.log("\n6. The event stream, which is how a screen learns to refetch");
    const stream = openStream(lanPort, tokenB);
    await Promise.race([stream.ready, new Promise((resolve) => setTimeout(resolve, 2000))]);
    check("the stream opens with a state frame", stream.frames.some((frame) => frame.event === "state"));

    const before = store.revision();
    await settingsWrite(tokenB, "F:\\current");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const changed = stream.frames.find((frame) => frame.event === "data-changed");
    check("a write is announced to every connected device", changed !== undefined, changed?.data ?? "(no frame)");
    check(
      "the frame is stamped with the revision, so a reconnect can catch up",
      changed?.id === String(store.revision()) && store.revision() > before,
      `id ${String(changed?.id)}`
    );
    stream.close();

    // ------------------------------------------------------------------ 7. devices
    console.log("\n7. Devices: the list, and revocation that actually takes effect");
    const list = json(await request(lanPort, "/api/remote/state", { headers: { "x-touchline-device": tokenB } })) as {
      devices?: { name?: string; self?: boolean }[];
    };
    check("both paired devices are listed", (list.devices ?? []).length === 2, `${(list.devices ?? []).length}`);
    check(
      "exactly one of them is marked as this device",
      (list.devices ?? []).filter((device) => device.self).length === 1
    );

    const selfId = (list.devices ?? []).find((device) => device.self) as { id?: string } | undefined;
    const revoke = await request(lanPort, `/api/remote/devices?id=${String(selfId?.id)}`, {
      method: "DELETE",
      headers: { "x-touchline-device": tokenA },
    });
    check("one device can revoke another", revoke.status === 200, `status ${revoke.status}`);

    const afterRevoke = await request(lanPort, "/api/remote/state", { headers: { "x-touchline-device": tokenB } });
    check("the revoked token stops working immediately", afterRevoke.status === 401, `status ${afterRevoke.status}`);
    check(
      "and revoking the pen-holder frees the pen rather than locking everyone out",
      store.lease() === null || store.lease()?.deviceId !== selfId?.id
    );

    // ------------------------------------------------------------------ 8. limits
    console.log("\n8. Limits: size, and guesses at the pairing code");
    const huge = await request(lanPort, "/api/settings", {
      method: "PATCH",
      headers: { "x-touchline-device": tokenA },
      body: JSON.stringify({ saveDirectory: "x".repeat(4096) }),
    });
    check("an oversized body is refused with 413", huge.status === 413, `status ${huge.status}`);
    check("with a code the client can explain", json(huge).code === "too-large");

    let limited = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const guess = await request(lanPort, "/api/remote/pair", {
        method: "POST",
        body: JSON.stringify({ code: "ZZZZ99", name: "Guesser" }),
      });
      if (guess.status === 429) limited += 1;
    }
    check("repeated wrong codes are rate limited", limited > 0, `${limited} of 6 refused with 429`);

    // ------------------------------------------------------------------ 9. the app
    console.log("\n9. The app served to a phone");
    const index = await request(lanPort, "/");
    check("serves the built app at the root", index.status === 200 && index.body.includes("id=app"));
    check(
      "injects the marker that makes the page a remote client",
      index.body.includes('name="touchline-remote"'),
      index.body.includes("touchline-remote") ? "marker present" : "MARKER MISSING"
    );
    check("does not let a page cache the app shell", String(index.headers["cache-control"]) === "no-store");

    const chunk = await request(lanPort, "/_next/static/chunk.js");
    check("serves hashed build assets", chunk.status === 200 && chunk.body.includes("chunk"));
    check(
      "and tells the browser they never change, so a phone launch is not a download",
      String(chunk.headers["cache-control"] ?? "").includes("immutable"),
      String(chunk.headers["cache-control"])
    );

    const deepLink = await request(lanPort, "/settings/");
    check("falls back to the app shell for a deep link", deepLink.status === 200 && deepLink.body.includes("id=app"));

    // ------------------------------------------------------------------ 10. restart integrity
    console.log("\n10. Restart: the career, the device list and the revision survive");
    const revisionBeforeRestart = store.revision();
    await new Promise<void>((resolve) => lanServer.close().then(resolve));
    await new Promise<void>((resolve) => loopbackServer.close().then(resolve));

    const boot2 = prepareCore();
    check("a second open snapshots the database first", boot2.backup !== null, String(boot2.backup ?? "(none)"));
    check("and says the database already existed", boot2.created === false);
    check("so there is now one snapshot on disk", listBackups(boot2.paths.backupDir).length === 1);

    const store2 = DeviceStore.load(storeFile);
    check("the paired device is still paired", store2.devices().length === 1, `${store2.devices().length} device(s)`);
    check("the revision kept counting", store2.revision() === revisionBeforeRestart, `${store2.revision()}`);
    check("the token still authenticates", store2.authenticate(tokenA) !== null);

    const restarted = createCoreServer({
      store: store2,
      mode: "lan",
      pairingCode: CODE,
      hostName: os.hostname(),
      port: DEFAULT_REMOTE_PORT,
      appDir,
    });
    await new Promise<void>((resolve) => restarted.server.listen(0, "127.0.0.1", resolve));
    const restartPort = (restarted.server.address() as AddressInfo).port;

    const settingsAfter = await request(restartPort, "/api/settings", { headers: { "x-touchline-device": tokenA } });
    const savedValue = (json(settingsAfter) as { settings?: { saveDirectory?: string } }).settings?.saveDirectory;
    check(
      "and the settings written before the restart are still there",
      settingsAfter.status === 200 && savedValue === "F:\\current",
      String(savedValue)
    );
    await restarted.close();

    // ------------------------------------------------------------------ 11. sharing switch
    console.log("\n11. Sharing can be switched off from a device");
    let shareDisabled = 0;
    const sharingServer = createCoreServer({
      store: store2,
      mode: "lan",
      pairingCode: CODE,
      hostName: os.hostname(),
      port: DEFAULT_REMOTE_PORT,
      appDir,
      onSharingDisabled: () => {
        shareDisabled += 1;
      },
    });
    await new Promise<void>((resolve) => sharingServer.server.listen(0, "127.0.0.1", resolve));
    const sharingPort = (sharingServer.server.address() as AddressInfo).port;
    const off = await request(sharingPort, "/api/remote/sharing", {
      method: "POST",
      headers: { "x-touchline-device": tokenA },
      body: JSON.stringify({ enabled: false }),
    });
    check("answers before it stops", off.status === 200 && json(off).sharing === false);
    check("and tells the entry point to close the listener", shareDisabled === 1, `${shareDisabled}`);
    await sharingServer.close();

    // ------------------------------------------------------------------ 12. watcher
    console.log("\n12. The watcher notices a save without a page being open");
    const candidate = (overrides: Record<string, unknown> = {}) => ({
      id: "abc123",
      fileName: "Career1",
      filePath: path.join(dataDir, "Career1"),
      lastModified: new Date("2026-10-18T00:00:00Z"),
      fileSizeBytes: 1024,
      slotKind: "career" as const,
      foundIn: "folders",
      ...overrides,
    });

    let detected = [candidate()];
    let synced = 0;
    const outcomes: string[] = [];
    const watcher = createSaveWatcher({
      detect: async () => detected as never,
      syncCandidate: async (entry) => {
        synced += 1;
        return { at: new Date().toISOString(), fileName: entry.fileName, status: "SYNCED", eventsEmitted: synced };
      },
      onChanged: (outcome) => outcomes.push(outcome.status),
      log: () => {},
      fullScanMs: 60 * 60 * 1000,
    });

    const first = await watcher.check();
    check("the first pass syncs, which is also how an empty database gets its career", first?.status === "SYNCED");
    await watcher.check();
    check("an unchanged save is not re-parsed", synced === 1, `${synced} sync(s)`);

    detected = [candidate({ lastModified: new Date("2026-10-18T01:00:00Z") })];
    const second = await watcher.check();
    check("a save the game just wrote is picked up", synced === 2 && second?.status === "SYNCED");
    check("and the change is published to other devices", outcomes.length === 2, `${outcomes.length}`);
    check(
      "a database slot is never mistaken for a career",
      pickNewestCandidate([candidate({ slotKind: "database" })]) === null
    );
    watcher.stop();

    // ------------------------------------------------------------------ 13. dispatch allowlist
    console.log("\n13. The allowlist is the same one the app calls");
    check("a normal write counts as a write", isWrite("PATCH", "/api/settings", new URLSearchParams()));
    check("a read does not", !isWrite("GET", "/api/settings", new URLSearchParams()));
    check(
      "closing a season counts as a write even though the app asks for it with GET",
      isWrite("GET", "/api/season/review", new URLSearchParams("action=transition"))
    );
  } finally {
    await lanServer.close().catch(() => {});
    await loopbackServer.close().catch(() => {});
    cleanup();
  }

  console.log("");
  if (failures > 0) {
    console.log(`FAIL: ${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("PASS: the core's contract holds.");
  }
}

/**
 * Removes the temporary folders.
 *
 * Best effort, and Windows is why: better-sqlite3 holds the database file open for the life of the
 * process, so the file cannot be unlinked while this test is still running. The app folder always goes;
 * the data folder is reported rather than fought with, because a temp folder left behind is a much
 * smaller problem than a test that crashes on its way out.
 */
function cleanup(): void {
  try {
    fs.rmSync(appDir, { recursive: true, force: true });
  } catch {
    // Reported by the caller below, if it matters.
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    console.log(`  (left the temporary database behind: ${dataDir})`);
  }
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
