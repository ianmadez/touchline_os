/**
 * Visual pass for the phone layout fixes.
 *
 * A real engine is enough here: this is a geometry question (does the text fit, does the strip scroll,
 * is the header one row), not a platform-feel one. Sticky hover, tap highlight and the software
 * keyboard still need a real device and are not claimed by this script.
 *
 *   node scripts/mobile-visual.mjs --out <dir>
 */
import { firefox } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_KEY = "touchline.session.v1";

function careerId() {
  if (process.env.CAREER_ID) return process.env.CAREER_ID;
  const db = new Database(path.join(process.cwd(), "data", "touchline.db"), { readonly: true });
  try {
    return db.prepare("select id from careers order by updated_at desc limit 1").get().id;
  } finally {
    db.close();
  }
}

const session = {
  version: 1,
  careerId: careerId(),
  activeTab: "DASHBOARD",
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

const TOURS_DONE = JSON.stringify({
  [session.careerId]: ["DASHBOARD", "SEASON", "DEBRIEF", "SQUAD", "TACTICS", "FINANCE", "SETTINGS"],
});

async function context(browser, viewport, { signedIn = true } = {}) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: false,
    reducedMotion: "reduce",
    colorScheme: "light",
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(
    ({ key, value, tours, signedIn: authed }) => {
      if (authed) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      if (authed) localStorage.setItem("touchline.tour.v1", tours);
    },
    { key: SESSION_KEY, value: JSON.stringify(session), tours: TOURS_DONE, signedIn }
  );
  return ctx;
}

async function openApp(browser, viewport, options) {
  const ctx = await context(browser, viewport, options);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => console.log("  pageerror:", error.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // The Next dev overlay's indicator sits over the bottom-left corner of the viewport, which is
  // exactly where the HOME tab is. It is a development-only control, so the harness hides it rather
  // than working around a phantom overlap.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const enter = page.getByRole("button", { name: /ENTER OS/i });
  await enter.waitFor({ timeout: 120_000 });
  return { ctx, page, enter };
}

async function dismissTour(page) {
  const card = page.locator('[role="dialog"][aria-labelledby="tour-step-title"]');
  if (await card.count()) {
    await card.getByRole("button", { name: /^Skip$/ }).click();
    await page.waitForTimeout(250);
  }
}

async function goTab(page, id) {
  await dismissTour(page);
  const direct = page.locator(`[data-tour="tab-${id}"]:visible`).first();
  if (await direct.count()) {
    await direct.click();
    await page.waitForTimeout(1200);
    return;
  }
  await page.locator("[data-mobile-more]:visible").click();
  await page.locator(`[data-more-tab="${id}"]:visible`).click();
  await page.waitForTimeout(1200);
}

async function shot(page, out, name, { fullPage = false } = {}) {
  await dismissTour(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
  console.log("  shot", name);
}

/** One element, at full resolution, so a wrapped word or a clipped label is actually visible. */
async function shotOf(page, out, name, locator) {
  await dismissTour(page);
  const target = page.locator(locator).first();
  if (!(await target.count())) {
    console.log("  missing", name);
    return;
  }
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await target.screenshot({ path: path.join(out, `${name}.png`) });
  console.log("  shot", name);
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex > 0 ? process.argv[outIndex + 1] : "mobile-visual";
  fs.mkdirSync(out, { recursive: true });

  const browser = await firefox.launch();

  // 1. Landing header: the Enter Portal CTA and the brand on one row.
  {
    const { ctx, page } = await openApp(browser, { width: 390, height: 844 }, { signedIn: false });
    await page.waitForTimeout(2500);
    await shot(page, out, "landing-390");
    const header = await page.locator("header").first().boundingBox();
    console.log("  landing header height", header?.height);
    await ctx.close();
  }

  // 2. Entry splash: brand, subtitle, club name.
  {
    const { ctx, page } = await openApp(browser, { width: 360, height: 800 });
    await page.waitForTimeout(2500);
    await shot(page, out, "splash-360");
    await ctx.close();
  }

  // 3. The app itself.
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const { ctx, page, enter } = await openApp(browser, viewport);
    await enter.click();
    await page.waitForTimeout(2500);
    await dismissTour(page);
    await shot(page, out, `dashboard-${viewport.width}`, { fullPage: true });

    await shotOf(page, out, `dashboard-storylines-${viewport.width}`, '[data-tour="dashboard-storylines"]');

    for (const tab of ["SEASON", "DEBRIEF", "SQUAD", "SETTINGS"]) {
      await goTab(page, tab);
      await page.waitForTimeout(1800);
      await shot(page, out, `${tab.toLowerCase()}-${viewport.width}`, { fullPage: true });
    }

    await goTab(page, "SEASON");
    await page.waitForTimeout(1200);
    await shotOf(page, out, `season-strip-${viewport.width}`, '[data-tour="season-subtabs"]');
    await shotOf(page, out, `season-history-${viewport.width}`, '[data-tour="season-history"]');
    await goTab(page, "DASHBOARD");
    await page.waitForTimeout(1200);
    await shotOf(page, out, `dashboard-objective-${viewport.width}`, '[data-tour="dashboard-season"]');

    await goTab(page, "DEBRIEF");
    await page.waitForTimeout(1200);
    await shotOf(page, out, `debrief-strip-${viewport.width}`, '[role="tablist"]');
    await shotOf(page, out, `debrief-scoreline-${viewport.width}`, 'div:has(> div > span:text("Scoreline & Venue"))');

    await goTab(page, "SQUAD");
    await page.waitForTimeout(1200);
    await shotOf(page, out, `squad-cards-${viewport.width}`, 'ul.divide-y');

    await goTab(page, "SETTINGS");
    await page.waitForTimeout(1200);
    await shotOf(page, out, `settings-segments-${viewport.width}`, 'section:has(h3:text("Career & Display"))');

    const width = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    console.log(`  ${viewport.width}: scroll width`, width);
    await ctx.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
