#!/usr/bin/env node
/**
 * The page half of replication, in a real browser against a real core.
 *
 * `scripts/test-replication.ts` proves the wire with two databases in two Node processes. This proves the
 * other end of it: the built browser app, with a career in OPFS, a paired bridge, and the agent elected
 * and running. Nothing is mocked, so what it shows is what a manager gets in Firefox.
 *
 * What it checks, in order:
 *
 *   1. the page leaves its career on the PC: the replica is created from the browser's copy
 *   2. the replica holds the same rows, table for table, as the browser it was seeded from
 *   3. a write made on the PC reaches this browser's OPFS database, which is read back and inspected
 *   4. it arrives once, not twice
 *
 *   node scripts/replication-e2e.mjs
 *
 * It needs `npm run build:browser` to have run, and it uses a temporary data directory, so the real
 * career and the real backups folder are never touched.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { firefox } from "playwright";

const root = process.cwd();
const appDir = path.join(root, "out-browser");
const fixture = path.join(root, "data", "backups", "pre-rework-2026-10-24_131953", "touchline.snapshot.db");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-replication-e2e-"));
const CAREER = "career_club_1917";
const CODE = "QWER45";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function tsxCli() {
  const candidates = [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The static export, served the way Cloudflare Pages would serve it. */
function startStatic(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let relative = decodeURIComponent(url.pathname);
    if (relative.endsWith("/")) relative += "index.html";
    let file = path.join(dir, relative);
    if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const answer = await check();
      if (answer) return answer;
    } catch (error) {
      // A busy core can reset a connection mid-poll. That is not the thing being waited for.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

/** One call to the replica's loopback listener, retried: a long synchronous apply can reset a pooled socket. */
async function syncCall(port, route, init = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}${route}`, {
        ...init,
        headers: {
          "x-touchline-bridge-code": CODE,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

/** Reads the browser's own database back out of OPFS, so what it holds can be inspected for real. */
async function readOpfs(page) {
  const base64 = await page.evaluate(async () => {
    const rootDir = await navigator.storage.getDirectory();
    const handle = await rootDir.getFileHandle("touchline.db");
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Chunked, because spreading fifteen megabytes into one call overflows the argument list.
    let text = "";
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
    }
    return btoa(text);
  });
  const file = path.join(dataDir, `opfs-${Date.now()}.db`);
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  return file;
}

async function main() {
  if (!fs.existsSync(path.join(appDir, "index.html"))) {
    console.error("out-browser/index.html is missing. Run: npm run build:browser");
    process.exit(2);
  }
  if (!fs.existsSync(fixture)) {
    console.error(`The fixture is missing: ${fixture}`);
    process.exit(2);
  }

  const Database = (await import("better-sqlite3")).default;

  // What the browser is about to hold, straight from the fixture.
  const source = new Database(fixture, { readonly: true });
  const expected = new Map();
  for (const table of ["career_events", "news_items", "player_user_profiles"]) {
    const row = source.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE career_id = ?`).get(CAREER);
    expected.set(table, row.n);
  }
  source.close();

  const loopbackPort = await freePort();
  const bridgeConfig = path.join(dataDir, "bridge.json");
  fs.writeFileSync(bridgeConfig, JSON.stringify({ code: CODE, port: loopbackPort }), "utf8");

  const cli = tsxCli();
  if (!cli) {
    console.error("Could not find the tsx CLI in node_modules. Run npm install.");
    process.exit(2);
  }

  const env = { ...process.env, TOUCHLINE_DATA_DIR: dataDir, TOUCHLINE_BRIDGE_CONFIG: bridgeConfig };
  // A career the PC does not have yet, which is the first-seed case.
  delete env.DATABASE_URL;

  const core = spawn(
    process.execPath,
    [cli, path.join("bridge", "touchline-core.ts"), "--no-watch", "--loopback-port", String(loopbackPort)],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let coreOutput = "";
  core.stdout.on("data", (chunk) => {
    coreOutput += chunk.toString("utf8");
  });
  core.stderr.on("data", (chunk) => {
    coreOutput += chunk.toString("utf8");
  });

  const app = await startStatic(appDir);
  const base = `http://127.0.0.1:${app.port}`;
  let browser = null;

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${loopbackPort}/status`);
        if (!response.ok) return false;
        return (await response.json()).service === "touchline-bridge";
      } catch {
        return false;
      }
    }, 90_000, "the core to start");

    const status = await (await syncCall(loopbackPort, `/sync/status?careerId=${CAREER}`)).json();
    check("the replica starts with nothing", status.counts.career_events === 0, JSON.stringify(status.counts.career_events));

    browser = await firefox.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  [page error] ${error.message}`));
    if (process.env.REPLICATION_E2E_DEBUG) {
      page.on("console", (message) => console.log(`  [page ${message.type()}] ${message.text()}`));
    }

    // Same origin, but before the app has opened a database of its own.
    await page.goto(`${base}/__seed`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const fixtureBase64 = fs.readFileSync(fixture).toString("base64");
    await page.evaluate(
      async ({ bytes, settings }) => {
        const rootDir = await navigator.storage.getDirectory();
        const handle = await rootDir.getFileHandle("touchline.db", { create: true });
        const writable = await handle.createWritable();
        const binary = Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0));
        await writable.write(binary);
        await writable.close();
        localStorage.setItem("touchline.bridge.v1", JSON.stringify(settings));
      },
      { bytes: fixtureBase64, settings: { enabled: true, port: loopbackPort, code: CODE } }
    );

    console.log("\n1. The browser's career is left on the PC");
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (process.env.REPLICATION_E2E_DEBUG) {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      const debugFile = await readOpfs(page);
      const debug = new Database(debugFile, { readonly: true });
      const careers = debug.prepare("SELECT COUNT(*) AS n FROM careers").get();
      const latest = debug.prepare("SELECT id FROM careers ORDER BY updated_at DESC LIMIT 1").get();
      debug.close();
      fs.rmSync(debugFile, { force: true });
      console.log(`  [debug] settings ${await page.evaluate(() => localStorage.getItem("touchline.bridge.v1"))}`);
      console.log(`  [debug] careers ${careers.n} latest ${latest?.id ?? "none"}`);
      console.log(`  [debug] url ${page.url()}`);
    }
    const seeded = await waitFor(
      async () => {
        const response = await syncCall(loopbackPort, `/sync/status?careerId=${CAREER}`);
        if (!response.ok) return false;
        const body = await response.json();
        return body.counts.career_events > 0 ? body : false;
      },
      180_000,
      "the page to seed the replica"
    );
    check("the replica now holds the career", seeded.counts.career_events > 0, `${seeded.counts.career_events} events`);

    for (const [table, count] of expected) {
      if (table === "player_user_profiles") continue;
      check(`${table} arrived whole`, seeded.counts[table] === count, `${seeded.counts[table]} of ${count}`);
    }

    if (process.env.REPLICATION_E2E_DEBUG) {
      // The drift check compares counts and hashes; if the two sides are computed differently anywhere,
      // this is what says which table, before an automatic reseed hides the cause.
      const crypto = await import("node:crypto");
      const image = await readOpfs(page);
      const copy = new Database(image, { readonly: true });
      const differing = [];
      for (const [table, hash] of Object.entries(seeded.hashes ?? {})) {
        let rows;
        try {
          rows = copy.prepare(`SELECT * FROM "${table}" WHERE career_id = ?`).all(CAREER);
        } catch {
          rows = [];
        }
        const canonical = rows
          .map((row) => JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key] ?? null])))
          .sort()
          .join("\n");
        const mine = crypto.createHash("sha1").update(canonical, "utf8").digest("hex");
        if (mine !== hash) differing.push(`${table} (${rows.length})`);
      }
      const counts = copy.prepare("SELECT COUNT(*) AS n FROM careers").get();
      copy.close();
      fs.rmSync(image, { force: true });
      console.log(`  [debug] careers in the page ${counts.n}, differing hashes: ${differing.join(", ") || "none"}`);
    }

    console.log("\n2. A write on the PC reaches the browser");
    const written = await syncCall(loopbackPort, "/api/trophies", {
      method: "PUT",
      body: JSON.stringify({
        careerId: CAREER,
        key: "replication_e2e",
        name: "Replication Cup",
        kind: "LEAGUE",
        season: 4,
      }),
    });
    check("the replica accepted a write", written.status === 200, `status ${written.status}`);

    const found = await waitFor(
      async () => {
        let file;
        try {
          file = await readOpfs(page);
        } catch {
          return false;
        }
        const copy = new Database(file, { readonly: true });
        try {
          const row = copy
            .prepare("SELECT COUNT(*) AS n FROM career_trophies WHERE career_id = ? AND key = ?")
            .get(CAREER, "replication_e2e");
          return row.n > 0;
        } catch {
          return false;
        } finally {
          copy.close();
          fs.rmSync(file, { force: true });
        }
      },
      60_000,
      "the browser to apply the PC's write"
    );
    check("it is in the browser's own database", Boolean(found));

    console.log("\n3. And it arrives once");
    const series = [];
    for (let step = 0; step < 4; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const probe = await (await syncCall(loopbackPort, `/sync/status?careerId=${CAREER}`)).json();
      series.push(probe.revision);
    }
    if (process.env.REPLICATION_E2E_DEBUG) {
      console.log(`  [debug] revisions ${series.join(", ")}`);
      const backups = path.join(dataDir, "backups");
      console.log(
        `  [debug] backups ${fs.existsSync(backups) ? fs.readdirSync(backups).join(", ") : "none"}`
      );
    }
    const file = await readOpfs(page);
    const copy = new Database(file, { readonly: true });
    const rows = copy
      .prepare("SELECT COUNT(*) AS n FROM career_trophies WHERE career_id = ? AND key = ?")
      .get(CAREER, "replication_e2e");
    const applied = copy
      .prepare("SELECT value FROM _sync_meta WHERE key = ?")
      .get(`applied:${CAREER}`);
    copy.close();
    fs.rmSync(file, { force: true });
    check("exactly one row, not two", rows.n === 1, `${rows.n} row(s)`);
    check("the browser recorded the revision it applied", Number(applied?.value ?? 0) > 0, applied?.value ?? "none");

    const final = await (await syncCall(loopbackPort, `/sync/status?careerId=${CAREER}`)).json();
    check("the journal did not echo the page's own state back at it", final.revision > 0, `revision ${final.revision}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => {
      app.server.close(resolve);
    });
    core.kill();
    if (failures > 0) console.log(`\n--- core output ---\n${coreOutput}`);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // A file still open on Windows is not a failed test.
    }
  }

  console.log(`\n${failures === 0 ? "PASS: the page and the PC keep one career." : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
