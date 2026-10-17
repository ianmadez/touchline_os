#!/usr/bin/env node
/**
 * Phase 0: how accurately, and how fast, does the scanner read a Match Facts screen in Firefox?
 *
 * WHY THIS RUNS IN A BROWSER AND NOT IN NODE.
 *
 * The scanner is browser code. Tesseract.js picks a different wasm core per device capability, decodes images
 * through the browser's own codecs, and does all its work in a Web Worker. Measuring it in Node would measure a
 * different core, a different decoder and a different threading model, and the number that came out would not be
 * the number a manager gets. So the harness bundles the real modules with esbuild, serves them from a local
 * origin alongside the real OCR assets, and drives a real Firefox through Playwright.
 *
 * It also means no image decoder is needed here at all: the page decodes PNG, JPEG and WebP natively, which is
 * why the golden set is not restricted to PNG.
 *
 * WHAT IS MEASURED.
 *
 *   per field accuracy   every field the golden JSON asserts, exact match, per capture and per track
 *   runtime              the in page elapsed time of one read, reported as the Firefox runtime
 *   preprocessing        six variants swept, so the winner is named by measurement and not by assumption
 *   read mode            one pass over the table against three whitelisted column passes
 *   page segmentation    tesseract's "one block" against "sparse text"
 *
 * THE REPORT SAYS WHEN IT CANNOT CONCLUDE. There is one clean capture. A one image accuracy figure is labelled
 * as such rather than presented as a green light, and the gate prints "not measurable" rather than a pass when
 * the clean track is too thin to mean anything.
 *
 *   npm run ocr:eval
 *   npm run ocr:eval -- --verbose
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { firefox } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const goldenDir = path.join(root, "data", "ocr-golden");
const ocrDir = path.join(root, "public", "ocr");

const VERBOSE = process.argv.includes("--verbose");
/** Per field accuracy a clean capture has to reach. The one number in this file that gates anything. */
const GATE = 0.95;
/** The figures a Summary capture must yield for the gate to mean anything: the ones the five boxes take. */
const assertFields = ["possessionPct", "shots", "expectedGoals", "passes"];

/**
 * The page side of the harness.
 *
 * Bundled from source rather than hand written into a public file, so it exercises the same modules the app
 * does. It exposes one function and it hands back only what the report needs, which keeps the words (thousands
 * of them per read) out of the round trip.
 */
const ENTRY_SOURCE = `
import { readMatchFacts, READ_MODES } from "./src/lib/ocr/read";
import { PREPROCESS_VARIANTS, detectTable, toLuma, scanRowEdges } from "./src/lib/ocr/preprocess";
import { disposeOcrEngine, getOcrEngine } from "./src/lib/ocr/engine";
import { defaultProfile } from "./src/lib/ocr/layouts";
import { SCREENS } from "./src/lib/ocr/layouts";
import { readRows } from "./src/lib/ocr/extract";

/** A union box around the words behind a value, for the focus highlight. Words themselves are dropped. */
function boxOf(words) {
  if (!words || words.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of words) {
    x0 = Math.min(x0, w.x0); y0 = Math.min(y0, w.y0);
    x1 = Math.max(x1, w.x1); y1 = Math.max(y1, w.y1);
  }
  return { x0, y0, x1, y1 };
}

function serialise(outcome) {
  if (!outcome.ok) return outcome;
  const values = {};
  for (const [key, value] of outcome.reading.values) {
    values[key] = { us: value.us, them: value.them, confidence: value.confidence, derived: value.derived, box: boxOf(value.usWords) };
  }
  const { reading, result, ...rest } = outcome;
  return {
    ...rest,
    values,
    refused: result === null ? null : result.group === null ? result.refusal : null,
    derived: result === null ? [] : result.derived,
  };
}

/** Decodes bytes the browser understands, then hands the pixels over as a plain object. */
async function decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  canvas.width = 0;
  canvas.height = 0;
  return { data: pixels.data, width: pixels.width, height: pixels.height };
}

window.__ocr = {
  async read(base64, options) {
    const image = await decode(base64);
    const outcome = await readMatchFacts(image, options);
    return serialise(outcome);
  },
  /** The table detection on its own, so a failure can be told apart from a bad read. */
  async inspect(base64) {
    const image = await decode(base64);
    const bands = detectTable(image);
    const edges = scanRowEdges(image);
    const summary = {
      found: bands !== null,
      width: image.width,
      height: image.height,
      edgeCount: edges.length,
      edges: edges.map((e) => ({ y: e.y, left: e.left, right: e.right, w: e.right - e.left })),
      meanLuma: Math.round(toLuma(image).reduce((a, b) => a + b, 0) / (image.width * image.height)),
    };
    if (!bands) return summary;
    return {
      ...summary,
      rowHeight: bands.rowHeight,
      rows: bands.centres.length,
      region: bands.region,
      centres: bands.centres,
    };
  },
  variants: () => PREPROCESS_VARIANTS.map((v) => v.id),
  modes: () => READ_MODES,
  /** Which screens the scanner reads, and why the others are off. Read from the real layout tables. */
  screens: () =>
    SCREENS.map((screen) => ({
      id: screen.id,
      label: screen.label,
      enabled: screen.enabled,
      disabledBecause: screen.disabledBecause,
    })),
  /** What the engine actually saw, in table coordinates, so a bad read can be told from a bad grid. */
  async words(base64, variantId, psm) {
    const image = await decode(base64);
    const bands = detectTable(image);
    if (!bands) return null;
    const { prepareTable, variantById } = await import("./src/lib/ocr/preprocess");
    const prepared = prepareTable(image, bands, variantById(variantId));
    const engine = await getOcrEngine();
    const frame = await engine.recognise({ image: prepared.image, psm });
    const profile = defaultProfile();
    const screen = profile.screens[0];
    const centres = bands.centres.map((c) => (c - bands.region.top) * prepared.scale);
    const height = bands.rowHeight * prepared.scale;
    const rows = readRows(frame.words, centres, height, prepared.image.width, profile.columns, screen);
    return {
      preparedWidth: prepared.image.width,
      preparedHeight: prepared.image.height,
      centres,
      bandHeight: height,
      columns: profile.columns,
      rows: rows.map((r) => ({
        y: Math.round(r.y),
        label: r.labelText,
        matched: r.row && r.row.key !== null ? r.row.key : null,
        left: r.left ? r.left.raw : null,
        right: r.right ? r.right.raw : null,
      })),
      words: frame.words.map((w) => ({ t: w.text, c: +w.confidence.toFixed(2), x: Math.round((w.x0+w.x1)/2), y: Math.round((w.y0+w.y1)/2) })),
    };
  },
  dispose: () => disposeOcrEngine(),
};
`;

// ---------------------------------------------------------------------------
// Golden set
// ---------------------------------------------------------------------------

function loadGolden() {
  if (!fs.existsSync(goldenDir)) {
    console.error(
      `Refusing to run: ${path.relative(root, goldenDir)} does not exist.\n` +
        "Put each capture there with a sidecar .json holding the fields to assert. See the header of this file."
    );
    process.exit(2);
  }

  const entries = fs
    .readdirSync(goldenDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const jsonPath = path.join(goldenDir, name);
      const spec = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const imagePath = path.join(goldenDir, spec.image);
      if (!fs.existsSync(imagePath)) {
        console.error(`Refusing to run: ${spec.image} is named by ${name} but is not there.`);
        process.exit(2);
      }
      return { spec, imagePath, base64: fs.readFileSync(imagePath).toString("base64") };
    });

  if (entries.length === 0) {
    console.error(`Refusing to run: ${path.relative(root, goldenDir)} holds no .json sidecars.`);
    process.exit(2);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// A local origin, so the worker, the core and the language file are all same origin
// ---------------------------------------------------------------------------

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".gz": "application/gzip",
  ".wasm": "application/wasm",
};

function startServer(bundle) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        "<!doctype html><meta charset='utf-8'><title>ocr harness</title><body><script src='/harness.js'></script></body>"
      );
      return;
    }
    if (url.pathname === "/harness.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(bundle);
      return;
    }
    if (url.pathname.startsWith("/ocr/")) {
      // The one path the scanner fetches from, served from the real staged folder, so a missing asset fails
      // here exactly as it would in the app.
      const file = path.join(root, "public", url.pathname);
      if (!file.startsWith(ocrDir) || !fs.existsSync(file)) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        // The browser's own HTTP cache is the only cache, by design.
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pad(value, width) {
  return String(value).padEnd(width);
}

function score(outcome, expected) {
  if (!outcome.ok) return { hits: 0, total: Object.keys(expected).length, misses: [`not read: ${outcome.reason}`] };
  const misses = [];
  let hits = 0;
  for (const [field, want] of Object.entries(expected)) {
    const got = outcome.values[field];
    if (got === undefined) {
      misses.push(`${field}: missing`);
      continue;
    }
    // Our side is the one the manager's own figures are about, so that is the column a golden value is checked
    // against. A decimal is compared to one place, which is the precision the game prints.
    const value = got.us;
    const matched = typeof want === "number" && !Number.isInteger(want) ? Math.abs(value - want) < 0.05 : value === want;
    if (matched) hits += 1;
    else misses.push(`${field}: want ${want} got ${value}`);
  }
  const refused = outcome.refused === null ? [] : [`screen refused: ${outcome.refused}`];
  return { hits, total: Object.keys(expected).length, misses: [...misses, ...refused] };
}

function summarise(rows) {
  const hits = rows.reduce((total, row) => total + row.hits, 0);
  const total = rows.reduce((total, row) => total + row.total, 0);
  const ms = rows.reduce((max, row) => Math.max(max, row.ms), 0);
  return { hits, total, ms, accuracy: total === 0 ? 0 : hits / total };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const golden = loadGolden();

const bundle = await esbuild.build({
  stdin: { contents: ENTRY_SOURCE, resolveDir: root, sourcefile: "ocr-harness-entry.ts" },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["firefox115"],
  logLevel: "warning",
});
const bundleText = bundle.outputFiles[0].text;

const { server, port } = await startServer(bundleText);
const browser = await firefox.launch();
const page = await browser.newPage();
page.on("console", (message) => {
  if (VERBOSE) console.log(`  [page] ${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => console.error(`  [page error] ${error.message}`));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

const variants = await page.evaluate(() => window.__ocr.variants());
const modes = await page.evaluate(() => window.__ocr.modes());
const screens = await page.evaluate(() => window.__ocr.screens());
const userAgent = await page.evaluate(() => navigator.userAgent);

/** Dumps what the engine actually saw, for one capture at one setting. */
async function dumpWords(entry, variantId, psm) {
  const info = await page.evaluate(
    ([base64, v, p]) => window.__ocr.words(base64, v, p),
    [entry.base64, variantId, psm]
  );
  if (!info) {
    console.log(`  ${entry.spec.image}: no table`);
    return;
  }
  console.log(`  ${entry.spec.image}  prepared ${info.preparedWidth}x${info.preparedHeight}, band height ${info.bandHeight.toFixed(1)}`);
  console.log(`    columns left ${JSON.stringify(info.columns.left)} label ${JSON.stringify(info.columns.label)} right ${JSON.stringify(info.columns.right)}`);
  for (const row of info.rows) {
    console.log(
      `    y=${pad(row.y, 5)} ${pad(row.matched ?? "(no label)", 24)} ${pad(row.left ?? "-", 8)} ${pad(row.right ?? "-", 8)} raw label "${row.label}"`
    );
  }
}

console.log("Phase 0: Match Facts readability in Firefox");
console.log(`browser:  ${userAgent}`);
console.log(`golden:   ${golden.length} capture(s) in ${path.relative(root, goldenDir)}`);
console.log("");

// ---- Table detection, which is the failure mode that looks like a bad read ---------------------------
console.log("Table detection");
for (const entry of golden) {
  const info = await page.evaluate(([base64]) => window.__ocr.inspect(base64), [entry.base64]);
  if (!info.found) {
    console.log(`  ${pad(entry.spec.image, 26)} no table found (${info.width}x${info.height}, ${info.edgeCount} edges, mean luma ${info.meanLuma})`);
  } else {
    const region = info.region;
    console.log(
      `  ${pad(entry.spec.image, 26)} ${info.rows} rows, row height ${Math.round(info.rowHeight)}px, ` +
        `region ${region.left},${region.top} ${region.width}x${region.height}, ` +
        `${info.edgeCount} edges, scale to 40px would be ${(40 / info.rowHeight).toFixed(2)}x`
    );
  }
  if (VERBOSE) {
    for (const edge of info.edges) {
      console.log(`      edge y=${pad(edge.y, 6)} x ${pad(edge.left, 6)} to ${pad(edge.right, 6)} width ${edge.w}`);
    }
  }
}
// ---- Word level dump, when asked for, so a bad read can be told from a bad grid ----------------------
if (VERBOSE) {
  console.log("What the engine saw");
  for (const entry of golden) await dumpWords(entry, variants[0], "6");
  const words = await page.evaluate(
    ([base64, v]) => window.__ocr.words(base64, v, "6"),
    [golden[0].base64, variants[0]]
  );
  if (words) {
    console.log("  every word, in prepared coordinates");
    for (const w of words.words.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
      console.log(`    x=${pad(w.x, 5)} y=${pad(w.y, 5)} conf ${pad(w.c, 5)} "${w.t}"`);
    }
  }
  console.log("");
}

console.log("");
const psmCandidates = ["6", "11", "4"];
const configs = [];
for (const variantId of variants) {
  for (const psm of psmCandidates) {
    configs.push({ id: `${variantId}/${psm}`, variantId, mode: "SINGLE_PASS", psm });
  }
}

const results = new Map();

for (const config of configs) {
  for (const entry of golden) {
    const options = {
      variantId: config.variantId,
      mode: config.mode,
      psm: config.psm,
      imageIndex: 1,
      name: entry.spec.image,
      venue: entry.spec.venue ?? null,
      ourClub: entry.spec.ourClub ?? "",
      opponent: entry.spec.opponent ?? "",
      goalsFor: null,
    };
    const outcome = await page.evaluate(
      ([base64, opts]) => window.__ocr.read(base64, opts),
      [entry.base64, options]
    );
    const key = `${config.id}::${entry.spec.image}`;
    results.set(key, { outcome, entry, config, ...score(outcome, entry.spec.expected) });
  }
  process.stdout.write(".");
}
console.log("");
console.log("");

function tableFor(track, mode, psm) {
  const rows = [];
  for (const config of configs) {
    if (config.mode !== mode) continue;
    if (psm !== undefined && config.psm !== psm) continue;
    const picked = golden
      .filter((entry) => entry.spec.track === track)
      .map((entry) => ({ entry, row: results.get(`${config.id}::${entry.spec.image}`) }))
      .filter(({ row }) => row !== undefined);
    if (picked.length === 0) continue;
    const summary = summarise(picked.map(({ row }) => ({ hits: row.hits, total: row.total, ms: row.outcome.elapsedMs ?? 0 })));
    rows.push({ config, summary, picked });
  }
  return rows;
}

function reportTable(track, mode, psm) {
  const rows = tableFor(track, mode, psm);
  if (rows.length === 0) return null;
  console.log(`--- ${track} track, ${mode}${psm ? `, psm ${psm}` : ""} ---`);
  console.log(`  ${pad("config", 30)}${pad("accuracy", 12)}${pad("runtime", 10)}misses`);
  for (const { config, summary, picked } of [...rows].sort((a, b) => b.summary.accuracy - a.summary.accuracy || a.summary.ms - b.summary.ms)) {
    const misses = picked.flatMap(({ row }) => row.misses.map((miss) => `${row.entry.spec.image.split("-")[0]}:${miss}`));
    console.log(
      `  ${pad(config.id, 30)}${pad(`${summary.hits}/${summary.total}`, 12)}${pad(`${summary.ms}ms`, 10)}${misses.length ? misses.join(", ") : "-"}`
    );
  }
  console.log("");
  return rows;
}

reportTable("CLEAN", "SINGLE_PASS");
reportTable("PHOTO", "SINGLE_PASS");

// ---- The winner, then per column against the winner ---------------------------------------------------
function bestFor(track) {
  let best = null;
  for (const config of configs) {
    const picked = golden.filter((entry) => entry.spec.track === track);
    const rows = picked
      .map((entry) => results.get(`${config.id}::${entry.spec.image}`))
      .filter((row) => row !== undefined);
    if (rows.length === 0) continue;
    const summary = summarise(rows.map((row) => ({ hits: row.hits, total: row.total, ms: row.outcome.elapsedMs ?? 0 })));
    if (best === null || summary.accuracy > best.summary.accuracy + 0.0001 || (Math.abs(summary.accuracy - best.summary.accuracy) <= 0.0001 && summary.ms < best.summary.ms)) {
      best = { config, summary };
    }
  }
  return best;
}

const cleanBest = bestFor("CLEAN");
console.log(`Winner on the CLEAN track: ${cleanBest.config.id} at ${cleanBest.summary.hits}/${cleanBest.summary.total} and ${cleanBest.summary.ms}ms`);
console.log("");

// Per column, at the winner's preprocessing, across the segmentation modes.
//
// The id is prefixed because a per column config shares its variant and mode with a single pass one, and an
// unprefixed id would silently overwrite the single pass result it is being compared against. That happened, and
// the symptom was a gate reading zero for a configuration that had just scored perfectly.
const columnConfigs = psmCandidates.map((psm) => ({
  id: `PER_COLUMN/${cleanBest.config.variantId}/${psm}`,
  variantId: cleanBest.config.variantId,
  mode: "PER_COLUMN",
  psm,
}));

for (const config of columnConfigs) {
  for (const entry of golden) {
    const options = {
      variantId: config.variantId,
      mode: config.mode,
      psm: config.psm,
      imageIndex: 1,
      name: entry.spec.image,
      venue: entry.spec.venue ?? null,
      ourClub: entry.spec.ourClub ?? "",
      opponent: entry.spec.opponent ?? "",
      goalsFor: null,
    };
    const outcome = await page.evaluate(
      ([base64, opts]) => window.__ocr.read(base64, opts),
      [entry.base64, options]
    );
    results.set(`${config.id}::${entry.spec.image}`, { outcome, entry, config, ...score(outcome, entry.spec.expected) });
  }
}

console.log("--- the same preprocessing and segmentation, one pass against three whitelisted column passes ---");
for (const config of columnConfigs) {
  for (const track of ["CLEAN", "PHOTO"]) {
    const picked = golden.filter((entry) => entry.spec.track === track);
    const rows = picked.map((entry) => results.get(`${config.id}::${entry.spec.image}`)).filter(Boolean);
    if (rows.length === 0) continue;
    const summary = summarise(rows.map((row) => ({ hits: row.hits, total: row.total, ms: row.outcome.elapsedMs ?? 0 })));
    const misses = rows.flatMap((row) => row.misses);
    console.log(
      `  ${pad(config.mode, 12)} ${pad(`psm ${config.psm}`, 8)} ${pad(track, 7)} ${pad(`${summary.hits}/${summary.total}`, 8)} ${pad(`${summary.ms}ms`, 9)} ${misses.join(", ") || "-"}`
    );
  }
}
console.log("");

// ---- The read itself, at the winner, so the numbers behind the accuracy are visible -------------------
console.log(`What the winner actually read (${cleanBest.config.id}, SINGLE_PASS)`);
for (const entry of golden) {
  const row = results.get(`${cleanBest.config.id}::${entry.spec.image}`);
  if (row === undefined) continue;
  const outcome = row.outcome;
  console.log(`  ${entry.spec.image}`);
  if (!outcome.ok) {
    console.log(`    not read: ${outcome.reason}`);
    continue;
  }
  console.log(
    `    side ${outcome.side.kind}${outcome.side.kind === "AGREED" ? ` (${outcome.side.ours}, from ${outcome.side.basis})` : ""}, ` +
      `screen ${outcome.screenId ?? "none"}, scale ${outcome.scale.toFixed(2)}`
  );
  for (const [key, value] of Object.entries(outcome.values)) {
    const want = entry.spec.expected[key];
    const mark = want === undefined ? " " : Math.abs(value.us - want) < 0.05 ? "+" : "x";
    console.log(
      `      ${mark} ${pad(key, 22)} us ${pad(value.us, 6)} them ${pad(value.them, 6)} conf ${value.confidence.toFixed(2)}` +
        `${value.derived ? "  (worked out from the sums)" : ""}`
    );
  }
  console.log(
    `      group: ${outcome.refused === null ? "kept" : `refused, ${outcome.refused}`}`
  );
}
console.log("");

// ---- The gate ----------------------------------------------------------------------------------------
const cleanRows = golden.filter((entry) => entry.spec.track === "CLEAN").map((entry) => results.get(`${cleanBest.config.id}::${entry.spec.image}`)).filter(Boolean);
const cleanSummary = summarise(cleanRows.map((row) => ({ hits: row.hits, total: row.total, ms: row.outcome.elapsedMs ?? 0 })));

console.log("Gate");
const cleanAccuracy = cleanSummary.total === 0 ? 0 : cleanSummary.accuracy;
const percent = (cleanAccuracy * 100).toFixed(1);
console.log(`  clean track:    ${cleanSummary.hits}/${cleanSummary.total} fields, ${percent} percent, ${cleanSummary.ms}ms per read`);
console.log(`  clean captures: ${cleanRows.length}`);
console.log(`  gate:           ${GATE * 100} percent per field`);

let verdict;
if (cleanRows.length === 0) {
  verdict = "not measurable";
  console.log("  verdict:        NOT MEASURABLE, there is no clean capture to read");
} else if (cleanAccuracy >= GATE) {
  verdict = "pass";
  console.log(`  verdict:        PASS at ${percent} percent`);
} else {
  verdict = "fail";
  console.log(`  verdict:        FAIL at ${percent} percent`);
  console.log("  what to try:    the target row height, colour suppression, the value whitelist,");
  console.log("                  a tighter alias list, then an engine swap, in that order");
}

/**
 * The sample size is stated rather than folded into the verdict. A gate can only be as trustworthy as the set it
 * was measured on, and this one currently rests on a single clean capture, so the number above is a real reading
 * of a real screen and is not yet a distribution.
 */
if (verdict === "pass" && cleanRows.length < 3) {
  console.log(`  caveat:         ${cleanRows.length} clean capture(s), so this is a smoke result and not a spread`);
}

/**
 * The gate above measures the FIGURES, and the group is a separate question.
 *
 * A screen is only STORED whole: every required row read and every sum holding. This prints both, per screen, so
 * a screen that reads its four box figures and then refuses to be stored cannot be mistaken for a pass.
 */
console.log("");
console.log("Groups");
for (const screen of screens) {
  const label = pad(screen.label, 10);
  if (!screen.enabled) {
    console.log(`  ${label} disabled  ${screen.disabledBecause}`);
    continue;
  }
  const reads = golden
    .map((entry) => results.get(`${cleanBest.config.id}::${entry.spec.image}`))
    .filter((row) => row !== undefined && row.outcome.ok && row.outcome.screenId === screen.id);
  if (reads.length === 0) {
    console.log(`  ${label} enabled   no capture of it in the golden set`);
    continue;
  }
  for (const row of reads) {
    console.log(
      `  ${label} enabled   ${row.outcome.refused === null ? "stored" : `REFUSED: ${row.outcome.refused}`}  (${row.outcome.name})`
    );
  }
  const stored = reads.filter((row) => row.outcome.refused === null).length;
  console.log(
    `  ${pad("", 10)}           ${stored} of ${reads.length} capture(s) of this screen pass every required row and every sum`
  );
}

await page.evaluate(() => window.__ocr.dispose());
await browser.close();
server.close();
console.log("");
console.log(`exit: ${verdict}`);
