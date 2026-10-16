#!/usr/bin/env node
/**
 * Stages the OCR runtime into `public/ocr/`.
 *
 * Three things have to be served from this app's own origin, because nothing in the scanner may reach a
 * network:
 *
 *   worker.min.js          tesseract.js's own Web Worker, which does all the wasm work off the main thread
 *   core/*.wasm.js         the six tesseract.js-core builds, one per device capability combination
 *   lang/*.traineddata.gz  the English language model
 *
 * The worker and the core live in `node_modules` and are copied, exactly as `sql-wasm.wasm` is, so they are
 * gitignored and arrive on `npm install`. The language model is committed instead: a fresh clone has to build
 * a complete app offline, which is the same reason `public/parse-resources/` is committed.
 *
 * ALL SIX core files are copied rather than the two LSTM ones. `getCore.js` picks between them at runtime by
 * feature detecting SIMD and relaxed SIMD, so shipping only some of them means a device that is not detected
 * as expected gets a missing file at scan time - in front of the manager, rather than here.
 *
 *   node scripts/stage-ocr-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ocrDir = path.join(root, "public", "ocr");
const coreDir = path.join(ocrDir, "core");
const langDir = path.join(ocrDir, "lang");

/** The language model, its upstream source, and its exact size. Kept here so the README cannot drift. */
const LANG = {
  file: "eng.traineddata.gz",
  url: "https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz",
  bytes: 1984273,
};

/** The six core builds, by exact name. A partial copy is a runtime failure, so the list is exhaustive. */
const CORE_FILES = [
  "tesseract-core.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
];

fs.mkdirSync(coreDir, { recursive: true });
fs.mkdirSync(langDir, { recursive: true });

const missing = [];

/** Copies one file from `node_modules`, returning false when the source is absent. */
function stageFile(from, to, label) {
  if (!fs.existsSync(from)) {
    missing.push(`${label} (not found at ${path.relative(root, from)})`);
    return;
  }
  fs.copyFileSync(from, to);
}

stageFile(
  path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  path.join(ocrDir, "worker.min.js"),
  "worker.min.js"
);

for (const file of CORE_FILES) {
  stageFile(
    path.join(root, "node_modules", "tesseract.js-core", file),
    path.join(coreDir, file),
    `core/${file}`
  );
}

/**
 * The language model. Committed, so its absence means a broken checkout rather than a missing dependency -
 * and it is fetched once here so a fresh clone that predates the commit still ends up complete.
 */
const langPath = path.join(langDir, LANG.file);
if (!fs.existsSync(langPath)) {
  console.log(`fetching ${LANG.file} (${Math.round(LANG.bytes / 1024)} KB) from ${LANG.url}`);
  try {
    const response = await fetch(LANG.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fs.writeFileSync(langPath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    missing.push(`${LANG.file} (present neither locally nor at ${LANG.url}: ${error.message})`);
  }
}

if (fs.existsSync(langPath)) {
  const size = fs.statSync(langPath).size;
  // A truncated download is worse than none: it would load and then read as garbage.
  if (size !== LANG.bytes) {
    missing.push(`${LANG.file} is ${size} bytes, expected ${LANG.bytes}`);
  }
}

if (missing.length > 0) {
  console.error(
    "Refusing to continue: the OCR runtime is incomplete.\n  " +
      missing.join("\n  ") +
      "\nRun `npm install` first. The language model is committed, so if it is missing see public/ocr/README.md."
  );
  process.exit(1);
}

console.log(`staged public/ocr/worker.min.js and ${CORE_FILES.length} core builds, language model present`);
