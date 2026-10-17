/**
 * Mobile sweep harness for Phase 2.
 *
 * Runs a real Firefox against the dev server and does three jobs:
 *
 *   --phase before|after   Full-page screenshots of every app tab at 1280 and 1920, so the two
 *                          runs can be compared pixel for pixel.
 *   --check                At 360, 390, 430 and 768: page-level horizontal scroll, 44px targets,
 *                          and every tour stepped end to end with the card kept inside the viewport.
 *   --compare              Counts differing pixels between the before and after folders.
 *
 * Firefox is the project's primary browser (and the one the OCR harness already uses), so a pass
 * here is the same engine the manager runs on Android. Emulation cannot prove hover, tap highlight
 * or the software keyboard; those stay on the real-device list.
 *
 * Usage:
 *   node scripts/mobile-sweep.mjs --phase before --out <dir>
 *   node scripts/mobile-sweep.mjs --phase after  --out <dir>
 *   node scripts/mobile-sweep.mjs --check
 *   node scripts/mobile-sweep.mjs --compare --before <dir> --after <dir>
 */
import { firefox } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_KEY = "touchline.session.v1";
const TOUR_KEYS = ["touchline.tour.v1", "touchline.tour.revision"];

const TABS = [
  { id: "DASHBOARD", label: "Dashboard" },
  { id: "SEASON", label: "Season" },
  { id: "DEBRIEF", label: "Debrief" },
  { id: "SQUAD", label: "Squad" },
  { id: "TACTICS", label: "Tactics" },
  { id: "FINANCE", label: "Finances" },
  { id: "SETTINGS", label: "Settings" },
];

const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const MOBILE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
];

function args() {
  const out = { phase: null, out: null, before: null, after: null, check: false, compare: false, desktopOnly: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--phase") out.phase = process.argv[++index];
    else if (arg === "--out") out.out = process.argv[++index];
    else if (arg === "--before") out.before = process.argv[++index];
    else if (arg === "--after") out.after = process.argv[++index];
    else if (arg === "--check") out.check = true;
    else if (arg === "--compare") out.compare = true;
    else if (arg === "--desktop-only") out.desktopOnly = true;
  }
  return out;
}

function careerId() {
  if (process.env.CAREER_ID) return process.env.CAREER_ID;
  const db = new Database(path.join(process.cwd(), "data", "touchline.db"), { readonly: true });
  try {
    const row = db.prepare("select id from careers order by updated_at desc limit 1").get();
    if (!row?.id) throw new Error("no career in data/touchline.db");
    return row.id;
  } finally {
    db.close();
  }
}

function sessionFor(tab) {
  return {
    version: 1,
    careerId: careerId(),
    activeTab: tab,
    theme: "light",
    onboardingComplete: true,
    formationId: "4-3-3-holding",
    savePath: null,
    saveId: null,
    clubName: "",
    clubLogoUrl: "",
    managerName: "",
    openStorylineId: null,
  };
}

async function seed(context, tab, clearTours) {
  await context.addInitScript(
    ({ key, session, tourKeys, clear }) => {
      try {
        localStorage.setItem(key, JSON.stringify(session));
        if (clear) for (const tourKey of tourKeys) localStorage.removeItem(tourKey);
      } catch {
        /* storage unavailable; the run will report a missing app instead of crashing */
      }
    },
    { key: SESSION_KEY, session: sessionFor(tab), tourKeys: TOUR_KEYS, clear: clearTours }
  );
}

async function openApp(browser, viewport, tab, clearTours = false) {
  const context = await browser.newContext({
    viewport,
    // A coarse pointer at the phone/tablet widths, so `@media (pointer: coarse)` is what the run
    // exercises. Firefox reports `pointer: coarse` once touch is enabled.
    hasTouch: viewport.width <= 768,
    reducedMotion: "reduce",
    colorScheme: "light",
    deviceScaleFactor: 1,
  });
  await seed(context, tab, clearTours);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The first request in a dev run pays the Turbopack compile, so this is deliberately generous.
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // The entry menu is the app's own front door; reduced motion makes this switch immediate.
  const enter = page.getByRole("button", { name: /ENTER OS/i });
  await enter.waitFor({ timeout: 120_000 });
  await enter.click();
  await page.waitForSelector('[data-tour="tab-DASHBOARD"]', { state: "attached", timeout: 120_000 });
  await settle(page);
  return { context, page, errors };
}

async function settle(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  // Screens fetch their own data after the tab paints; the squad and finance panels can take a few
  // seconds on a cold dev compile. Measuring earlier produced before-shots of a loading state, which
  // is not a baseline for anything.
  await page.waitForTimeout(4500);
}

/** Closes the onboarding tour if it opened, so it never sits over a screenshot or blocks the nav. */
async function dismissTour(page) {
  const card = page.locator('[role="dialog"][aria-labelledby="tour-step-title"]');
  try {
    await card.waitFor({ timeout: 2_500 });
  } catch {
    return false;
  }
  const skip = card.getByRole("button", { name: /^Skip$/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(200);
  }
  return true;
}

/** Clicks a tab through whichever navigation is present (top bar, bottom bar, or the More sheet). */
async function goToTab(page, id, { keepTour = false } = {}) {
  await dismissTour(page);
  const direct = page.locator(`[data-tour="tab-${id}"]:visible`).first();
  if (await direct.count()) {
    await direct.click();
    await settle(page);
    if (!keepTour) await dismissTour(page);
    return true;
  }
  const more = page.locator("[data-mobile-more]:visible").first();
  if (await more.count()) {
    await more.click();
    const row = page.locator(`[data-more-tab="${id}"]:visible`).first();
    if (await row.count()) {
      await row.click();
      await settle(page);
      if (!keepTour) await dismissTour(page);
      return true;
    }
    await page.keyboard.press("Escape");
  }
  return false;
}

async function capture(browser, viewport, tab, file) {
  const { context, page, errors } = await openApp(browser, viewport, tab);
  try {
    if (tab !== "DASHBOARD") {
      const moved = await goToTab(page, tab);
      if (!moved) {
        console.log(`  skip ${tab} at ${viewport.width}: no navigation is rendered`);
        return null;
      }
    }
    await dismissTour(page);
    // The tour scrolled an anchor into view. A full-page shot keeps fixed backgrounds at the
    // current scroll offset, so two runs would differ for no reason. Start every capture at the top.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  shot ${path.basename(file)}`);
    if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
    return { file, scrollWidth: await scrollWidth(page) };
  } finally {
    await context.close();
  }
}

async function scrollWidth(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
}

/** Visible controls that should meet the 44px floor. Text links are deliberately not counted. */
async function smallTargets(page) {
  return page.evaluate(() => {
    const tourCard = document.querySelector('[aria-labelledby="tour-step-title"]');
    const selector =
      'button:not([data-compact]), [role="button"]:not([data-compact]), select:not([data-compact])';
    const small = [];
    for (const element of document.querySelectorAll(selector)) {
      if (tourCard?.contains(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (rect.height < 43.5 || rect.width < 43.5) {
        small.push({
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().slice(0, 40),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return small;
  });
}

async function stepThroughTour(page) {
  const card = page.locator('[role="dialog"][aria-labelledby="tour-step-title"]');
  try {
    await card.waitFor({ timeout: 8_000 });
  } catch {
    return { shown: false };
  }
  const steps = [];
  for (let index = 0; index < 20; index += 1) {
    const box = await card.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) break;
    const inside =
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1;
    steps.push({ inside, box });
    const label = await page.locator("#tour-step-title").textContent();
    console.log(`    tour step ${index + 1}: ${label?.trim()} inside=${inside}`);
    const next = card.getByRole("button", { name: /^(Next|Got it)$/ });
    if (!(await next.count())) break;
    const isLast = (await next.textContent())?.trim() === "Got it";
    await next.click();
    if (isLast) break;
    await page.waitForTimeout(500);
  }
  return { shown: true, steps, allInside: steps.every((step) => step.inside) };
}

async function check(browser) {
  const report = [];
  for (const viewport of MOBILE_VIEWPORTS) {
    console.log(`\n${viewport.width}x${viewport.height}`);
    for (const tab of TABS) {
      const { context, page, errors } = await openApp(browser, viewport, tab.id, true);
      try {
        const moved = tab.id === "DASHBOARD" ? true : await goToTab(page, tab.id, { keepTour: true });
        if (!moved) {
          report.push({ viewport, tab: tab.id, skipped: "no navigation" });
          console.log(`  ${tab.id}: no navigation`);
          continue;
        }
        const width = await scrollWidth(page);
        const small = await smallTargets(page);
        const tour = await stepThroughTour(page);
        const entry = { viewport, tab: tab.id, width, small, tour, errors };
        report.push(entry);
        console.log(
          `  ${tab.id}: scroll ${width.scrollWidth}/${width.innerWidth} smallTargets ${small.length} tour ${tour.shown ? (tour.allInside ? "ok" : "OUTSIDE") : "none"}`
        );
        if (small.length) {
          console.log(`    ${small.slice(0, 6).map((item) => `${item.tag} ${item.width}x${item.height} "${item.text}"`).join(" | ")}`);
        }
      } finally {
        await context.close();
      }
    }
  }
  return report;
}

/** Counts differing pixels between two PNGs by drawing them into a blank page's canvas. */
async function compare(browser, beforeDir, afterDir) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const files = fs
    .readdirSync(beforeDir)
    .filter((name) => name.endsWith(".png"))
    .sort();
  const results = [];
  for (const name of files) {
    const afterFile = path.join(afterDir, name);
    if (!fs.existsSync(afterFile)) {
      results.push({ name, missing: true });
      console.log(`  ${name}: missing after shot`);
      continue;
    }
    const before = fs.readFileSync(path.join(beforeDir, name)).toString("base64");
    const after = fs.readFileSync(afterFile).toString("base64");
    const result = await page.evaluate(
      async ([a, b]) => {
        const load = (base64) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = `data:image/png;base64,${base64}`;
          });
        const [left, right] = await Promise.all([load(a), load(b)]);
        if (left.width !== right.width || left.height !== right.height) {
          return { sizeMismatch: true, left: [left.width, left.height], right: [right.width, right.height] };
        }
        const canvas = document.createElement("canvas");
        canvas.width = left.width;
        canvas.height = left.height;
        const cx = canvas.getContext("2d", { willReadFrequently: true });
        cx.drawImage(left, 0, 0);
        const leftData = cx.getImageData(0, 0, canvas.width, canvas.height).data;
        cx.clearRect(0, 0, canvas.width, canvas.height);
        cx.drawImage(right, 0, 0);
        const rightData = cx.getImageData(0, 0, canvas.width, canvas.height).data;
        let differing = 0;
        for (let index = 0; index < leftData.length; index += 4) {
          if (
            Math.abs(leftData[index] - rightData[index]) > 8 ||
            Math.abs(leftData[index + 1] - rightData[index + 1]) > 8 ||
            Math.abs(leftData[index + 2] - rightData[index + 2]) > 8
          ) {
            differing += 1;
          }
        }
        return { differing, pixels: left.width * left.height };
      },
      [before, after]
    );
    results.push({ name, ...result });
    console.log(
      result.sizeMismatch
        ? `  ${name}: SIZE ${result.left.join("x")} -> ${result.right.join("x")}`
        : `  ${name}: ${result.differing} differing of ${result.pixels}`
    );
  }
  await context.close();
  return results;
}

async function main() {
  const options = args();

  if (options.compare) {
    if (!options.before || !options.after) throw new Error("--compare needs --before and --after");
    const browser = await firefox.launch();
    try {
      const results = await compare(browser, options.before, options.after);
      const changed = results.filter((item) => item.missing || item.sizeMismatch || item.differing > 0);
      console.log(`\n${changed.length === 0 ? "PASS" : "FAIL"}: ${changed.length} screenshot(s) changed`);
      process.exitCode = changed.length === 0 ? 0 : 1;
    } finally {
      await browser.close();
    }
    return;
  }

  const browser = await firefox.launch();

  try {
    if (options.check) {
      const report = await check(browser);
      const failures = report.filter(
        (entry) =>
          entry.width &&
          (entry.width.scrollWidth > entry.width.innerWidth + 1 || entry.small.length > 0)
      );
      const outside = report.filter((entry) => entry.tour?.shown && !entry.tour.allInside);
      console.log(
        `\n${failures.length === 0 && outside.length === 0 ? "PASS" : "FAIL"}: ` +
          `${failures.length} width/target issue(s), ${outside.length} tour card(s) outside the viewport`
      );
      if (options.out) {
        fs.mkdirSync(options.out, { recursive: true });
        fs.writeFileSync(path.join(options.out, "check.json"), JSON.stringify(report, null, 1));
      }
      process.exitCode = failures.length === 0 && outside.length === 0 ? 0 : 1;
      return;
    }

    if (!options.phase || !options.out) throw new Error("--phase and --out are required");
    fs.mkdirSync(options.out, { recursive: true });

    if (options.phase === "before") {
      for (const viewport of DESKTOP_VIEWPORTS) {
        console.log(`\n${viewport.width}x${viewport.height} (desktop baseline)`);
        for (const tab of TABS) {
          await capture(browser, viewport, tab.id, path.join(options.out, `${tab.id}-${viewport.width}.png`));
        }
      }
      // The old UI has no navigation below 768, so only the tab the app always enters is captured.
      console.log("\n390x844 (mobile baseline, dashboard only until the bar exists)");
      await capture(browser, { width: 390, height: 844 }, "DASHBOARD", path.join(options.out, "MOBILE-DASHBOARD-390.png"));
      return;
    }

    for (const viewport of DESKTOP_VIEWPORTS) {
      console.log(`\n${viewport.width}x${viewport.height} (desktop after)`);
      for (const tab of TABS) {
        await capture(browser, viewport, tab.id, path.join(options.out, `${tab.id}-${viewport.width}.png`));
      }
    }
    if (options.desktopOnly) return;
    for (const viewport of MOBILE_VIEWPORTS) {
      console.log(`\n${viewport.width}x${viewport.height} (mobile after)`);
      for (const tab of TABS) {
        await capture(browser, viewport, tab.id, path.join(options.out, `${tab.id}-${viewport.width}.png`));
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
