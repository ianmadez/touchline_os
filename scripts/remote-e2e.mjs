#!/usr/bin/env node
/**
 * Two devices, one core, and the things that only break when there are two of them.
 *
 * This is Phase 6's automated half. It spawns a real core on a real port with a temporary data
 * directory, serves the real static build, and drives two real browser contexts against it: a 390px
 * phone and a 1280px desktop. Nothing is mocked, so what it proves is what a manager would get.
 *
 * What it checks, in order:
 *
 *   1. the app is not usable before pairing, on either device
 *   2. a scanned pairing URL (`?pair=`) pairs in one step, and a typed code pairs from a plain visit
 *   3. a phone reading the PC's save folder - the wizard's save list comes over the wire
 *   4. a write on one device reaches the other's event stream, which is what makes it refetch
 *   5. only one device holds the pen, the other says so, and "Take control" moves it
 *   6. revoking a device puts it back to the pairing screen on its next load
 *   7. the pairing screen and the shell fit a 360-390px screen with no sideways scroll
 *
 *   node scripts/remote-e2e.mjs
 *   E2E_BROWSER=chromium node scripts/remote-e2e.mjs
 *
 * It needs `npm run build:browser` to have run: a core with nothing to serve cannot prove anything
 * about the app.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { firefox, chromium } from "playwright";

const root = process.cwd();
const appDir = path.join(root, "out-browser");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-e2e-"));

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

async function waitForCore(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok) {
        const body = await response.json();
        if (body.service === "touchline-core") return body;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`the core did not answer on port ${port} within ${timeoutMs}ms`);
}

/** The tsx CLI, so the core can be started without a shell and killed cleanly. */
function tsxCli() {
  const candidates = [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function launchBrowser() {
  const wanted = (process.env.E2E_BROWSER ?? "firefox").toLowerCase();
  if (wanted === "chromium") {
    // Playwright's pinned Chromium is not always installed; any local build works for a layout check.
    try {
      return { browser: await chromium.launch(), name: "chromium" };
    } catch {
      const local = "C:/Users/ianth/AppData/Local/ms-playwright";
      const found = fs.existsSync(local)
        ? fs
            .readdirSync(local)
            .filter((entry) => entry.startsWith("chromium-"))
            .map((entry) => path.join(local, entry, "chrome-win64", "chrome.exe"))
            .find((candidate) => fs.existsSync(candidate))
        : null;
      if (!found) throw new Error("no chromium build found; run with E2E_BROWSER=firefox");
      return { browser: await chromium.launch({ executablePath: found }), name: "chromium" };
    }
  }
  return { browser: await firefox.launch(), name: "firefox" };
}

/** Reads the device token the app stored, so a test can act as that device over the API. */
async function session(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("touchline.remote.v1") ?? "null");
    } catch {
      return null;
    }
  });
}

/**
 * Waits for the app to store a pairing.
 *
 * Polled rather than waited for in one call: accepting a code reloads the page, and an `evaluate` that
 * lands mid-navigation throws "execution context was destroyed" - which is the app working correctly
 * and the test being too eager.
 */
async function waitForSession(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await session(page);
      if (value?.token) return value;
    } catch {
      // Mid-navigation. Ask again.
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function api(page, requestPath, init = {}) {
  return page.evaluate(
    async ([url, options]) => {
      const response = await fetch(url, options);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    [requestPath, init]
  );
}

async function main() {
  console.log("=== TOUCHLINE OS: TWO DEVICES, ONE CORE ===\n");

  if (!fs.existsSync(path.join(appDir, "index.html"))) {
    console.error("out-browser/index.html is missing. Run: npm run build:browser");
    process.exit(2);
  }

  const cli = tsxCli();
  if (!cli) {
    console.error("Could not find the tsx CLI in node_modules. Run npm install.");
    process.exit(2);
  }

  const port = await freePort();
  let loopbackPort = await freePort();
  while (loopbackPort === port) loopbackPort = await freePort();

  const core = spawn(
    process.execPath,
    [
      cli,
      path.join("bridge", "touchline-core.ts"),
      "--share",
      "--no-watch",
      "--port",
      String(port),
      "--loopback-port",
      String(loopbackPort),
      "--app",
      appDir,
    ],
    {
      cwd: root,
      env: { ...process.env, TOUCHLINE_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const coreLog = [];
  core.stdout.setEncoding("utf8");
  core.stderr.setEncoding("utf8");
  core.stdout.on("data", (chunk) => coreLog.push(chunk));
  core.stderr.on("data", (chunk) => coreLog.push(chunk));

  let browser = null;
  let coreRunning = true;

  try {
    const status = await waitForCore(port);
    console.log(`Core on 127.0.0.1:${port} (${status.hostName}), sharing on, watcher off\n`);

    const pairingCode = /Pairing code:\s+([A-Z0-9]{6})/.exec(coreLog.join(""))?.[1] ?? "";
    check("the console prints a six-character pairing code", /^[A-Z0-9]{6}$/.test(pairingCode), pairingCode || "(none)");

    const launched = await launchBrowser();
    browser = launched.browser;
    console.log(`Browser: ${launched.name}\n`);

    const base = `http://127.0.0.1:${port}`;

    // ------------------------------------------------------------------ 1. phone
    console.log("1. The phone, which has never paired");
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: false,
      reducedMotion: "reduce",
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await phonePage.waitForSelector("input[aria-label='Pairing code']", { timeout: 60_000 });
    check("a page served by the core asks to pair before anything else", true);

    const phoneWidths = await phonePage.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    check(
      "the pairing screen does not scroll sideways at 390px",
      phoneWidths.scroll === phoneWidths.inner,
      `${phoneWidths.scroll} of ${phoneWidths.inner}`
    );

    const inputFont = await phonePage.evaluate(() => {
      const input = document.querySelector("input[aria-label='Pairing code']");
      return input ? getComputedStyle(input).fontSize : "0px";
    });
    check(
      "the code field is at least 16px, so iOS does not zoom the page into it",
      Number.parseFloat(inputFont) >= 16,
      inputFont
    );

    const tapTargets = await phonePage.evaluate(() => {
      const nodes = [...document.querySelectorAll("button, input, a")];
      return nodes
        .map((node) => Math.round(node.getBoundingClientRect().height))
        .filter((height) => height > 0 && height < 40);
    });
    check(
      "every control on the pairing screen is a comfortable tap target",
      tapTargets.length === 0,
      tapTargets.length ? `${tapTargets.length} under 40px` : "all at least 40px"
    );

    // ------------------------------------------------------------------ 2. pairing by QR
    console.log("\n2. Pairing, the way a scan arrives");
    const scanned = await phone.newPage();
    await scanned.goto(`${base}/?pair=${pairingCode}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const scannedSession = await waitForSession(scanned);
    check("a `?pair=` link pairs without typing anything", typeof scannedSession?.token === "string");
    check(
      "and the code is stripped from the address bar afterwards",
      !scanned.url().includes("pair="),
      scanned.url().replace(base, "")
    );
    await scanned.waitForLoadState("domcontentloaded");
    await scanned.waitForTimeout(2500);
    check(
      "the app it was already looking at appears, rather than a second pairing prompt",
      (await scanned.locator("input[aria-label='Pairing code']").count()) === 0
    );

    // ------------------------------------------------------------------ 3. the PC's saves
    console.log("\n3. The wizard reads the PC's folders, not this device's");
    const saves = await api(scanned, "/api/saves", { cache: "no-store" });
    check("the save scan answers over the wire", saves.status === 200, `status ${saves.status}`);
    check(
      "and reports the runtime as the PC's own folder scan",
      saves.body?.saveSourceMode === "folders",
      String(saves.body?.saveSourceMode)
    );

    // ------------------------------------------------------------------ 4. desktop pairs by code
    console.log("\n4. A second device, typed in by hand");
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    const desktopPage = await desktop.newPage();
    await desktopPage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await desktopPage.waitForSelector("input[aria-label='Pairing code']", { timeout: 60_000 });
    await desktopPage.fill("input[aria-label='Pairing code']", pairingCode);
    await desktopPage.getByRole("button", { name: /^connect$/i }).click();
    const desktopSession = await waitForSession(desktopPage);
    check("typing the code pairs too", typeof desktopSession?.token === "string");

    const phoneSession = await waitForSession(scanned);
    check(
      "each device got its own token",
      Boolean(phoneSession?.token) && Boolean(desktopSession?.token) && phoneSession.token !== desktopSession.token
    );

    const listed = await api(scanned, "/api/remote/state", {
      headers: { "x-touchline-device": phoneSession.token },
    });
    check(
      "the core lists both devices",
      Array.isArray(listed.body?.devices) && listed.body.devices.length === 2,
      `${listed.body?.devices?.length ?? 0} device(s)`
    );

    // ------------------------------------------------------------------ 5. cross-device changes
    console.log("\n5. A change on one device reaches the other");
    // The phone paired first, so it holds the pen. The desktop asks for it, which is the same call the
    // "Take control" button makes.
    const desktopTake = await api(desktopPage, "/api/remote/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-touchline-device": desktopSession.token },
      body: JSON.stringify({ take: true }),
    });
    check("the desktop can take control", desktopTake.status === 200, `status ${desktopTake.status}`);

    await scanned.evaluate(() => {
      window.__touchlineChanges = [];
      window.addEventListener("touchline:data-changed", (event) => {
        window.__touchlineChanges.push(event.detail);
      });
    });
    const write = await api(desktopPage, "/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-touchline-device": desktopSession.token },
      body: JSON.stringify({ saveDirectory: "C:\\Users\\e2e\\Documents" }),
    });
    check("a write from the device holding the pen is accepted", write.status === 200, `status ${write.status}`);

    const heard = await scanned
      .waitForFunction(() => (window.__touchlineChanges ?? []).length > 0, undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check("the phone hears about it without asking", heard);
    const seenRevision = await scanned.evaluate(() => (window.__touchlineChanges ?? []).at(-1));
    check("the announcement carries the revision", typeof seenRevision === "number", `revision ${seenRevision}`);

    const readBack = await api(scanned, "/api/settings", { cache: "no-store" });
    check(
      "and reads the value the desktop wrote",
      readBack.body?.settings?.saveDirectory === "C:\\Users\\e2e\\Documents",
      String(readBack.body?.settings?.saveDirectory)
    );

    // ------------------------------------------------------------------ 6. the pen
    console.log("\n6. One pen, and a way to ask for it");
    const blocked = await api(scanned, "/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-touchline-device": phoneSession.token },
      body: JSON.stringify({ saveDirectory: "D:\\nope" }),
    });
    check("the device without the pen is refused", blocked.status === 409, `status ${blocked.status}`);
    check("with a code the client can explain", blocked.body?.code === "lease", String(blocked.body?.code));

    await scanned.reload({ waitUntil: "domcontentloaded" });
    await scanned.waitForTimeout(3000);
    const pill = scanned.getByText(/is editing here/i);
    check("the phone says it is viewing, and who is editing", (await pill.count()) > 0);

    const takeControl = scanned.getByRole("button", { name: /take control/i }).first();
    if ((await takeControl.count()) > 0) {
      await takeControl.click();
      await scanned.waitForTimeout(1500);
    }
    const afterTake = await api(scanned, "/api/remote/state", {
      headers: { "x-touchline-device": phoneSession.token },
    });
    check(
      "pressing Take control moves the pen to this device",
      afterTake.body?.writer?.deviceId === afterTake.body?.self?.id,
      String(afterTake.body?.writer?.name)
    );

    const desktopBlocked = await api(desktopPage, "/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-touchline-device": desktopSession.token },
      body: JSON.stringify({ saveDirectory: "D:\\also-no" }),
    });
    check(
      "and the desktop, which had it, is now the one being refused",
      desktopBlocked.status === 409,
      `status ${desktopBlocked.status}`
    );

    // ------------------------------------------------------------------ 7. revocation
    console.log("\n7. Revocation, which has to take effect now rather than at the next refresh");
    const revoke = await api(scanned, `/api/remote/devices?id=${encodeURIComponent(desktopSession.deviceId)}`, {
      method: "DELETE",
      headers: { "x-touchline-device": phoneSession.token },
    });
    check("one device can revoke another", revoke.status === 200, `status ${revoke.status}`);

    const desktopAfter = await api(desktopPage, "/api/remote/state", {
      headers: { "x-touchline-device": desktopSession.token },
    });
    check("the revoked token stops working", desktopAfter.status === 401, `status ${desktopAfter.status}`);

    await desktopPage.reload({ waitUntil: "domcontentloaded" });
    await desktopPage.waitForSelector("input[aria-label='Pairing code']", { timeout: 30_000 });
    check("and its next load asks to pair again", true);

    // ------------------------------------------------------------------ 8. smaller screens
    console.log("\n8. The pairing screen on the smallest phone this supports");
    const small = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, reducedMotion: "reduce" });
    const smallPage = await small.newPage();
    await smallPage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await smallPage.waitForSelector("input[aria-label='Pairing code']", { timeout: 60_000 });
    const smallWidths = await smallPage.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      height: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
    }));
    check(
      "360px wide does not scroll sideways",
      smallWidths.scroll === smallWidths.inner,
      `${smallWidths.scroll} of ${smallWidths.inner}`
    );
    check(
      "and the card fits above the fold without hunting",
      smallWidths.height <= smallWidths.viewport + 8,
      `${smallWidths.height} of ${smallWidths.viewport}`
    );
    await small.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (coreRunning) {
      core.kill();
      coreRunning = false;
      // Windows leaves the child's handles open briefly; the temp folder is best effort either way.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      console.log(`  (left the temporary data behind: ${dataDir})`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.log(`FAIL: ${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("PASS: two devices, one career, no surprises.");
  }
}

main().catch((error) => {
  console.error(error);
  console.log(`\nCore output tail:\n${""}`);
  process.exit(1);
});
