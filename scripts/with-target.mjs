#!/usr/bin/env node
/**
 * Runs a Next.js CLI command with `TOUCHLINE_TARGET` set.
 *
 * This exists so the browser target can be built without a shell-specific env-var syntax (and
 * without adding a cross-platform env dependency just for two npm scripts).
 *
 * The browser target needs one thing that cannot ship from source: `sql-wasm.wasm`, the SQLite
 * engine, which lives in `node_modules`. It is staged into `public/` before Next runs, so Next places
 * it in the static output the same way it places every other asset, and it is gitignored.
 *
 * The parser's reference data is NOT staged any more: it is committed in `public/parse-resources/`,
 * so a fresh clone builds a complete browser app with nothing else present. This script only checks
 * that those two files are there, and fails the build if they are not - a missing one used to be a
 * silent degradation to unresolved player names, which is exactly the sort of quiet breakage a
 * release build should refuse.
 *
 *   node scripts/with-target.mjs browser build
 *   node scripts/with-target.mjs browser dev
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [target, ...args] = process.argv.slice(2);
if (!target || args.length === 0) {
  console.error("usage: node scripts/with-target.mjs <target> <next-args...>");
  process.exit(2);
}

const root = process.cwd();

/** Copies a file, creating its directory. Returns false when the source does not exist. */
function copyIfPresent(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function stageBrowserAssets() {
  const publicDir = path.join(root, "public");

  const wasm = copyIfPresent(
    path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(publicDir, "sql-wasm.wasm")
  );
  console.log(wasm ? "staged sql-wasm.wasm" : "sql-wasm.wasm not found in node_modules/sql.js");

  const referenceData = path.join(publicDir, "parse-resources");
  const missing = ["fifa_ng_db-meta.xml", "playernames_fc26.csv"].filter(
    (file) => !fs.existsSync(path.join(referenceData, file))
  );
  if (missing.length > 0) {
    console.error(
      `Refusing to build the browser target: public/parse-resources is missing ${missing.join(", ")}. ` +
        "Without them every table and field decodes as unknown and every player renders as #<id>. " +
        "See public/parse-resources/README.md."
    );
    process.exit(1);
  }
  console.log("reference data present in public/parse-resources");
}

if (target === "browser") stageBrowserAssets();

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env: { ...process.env, TOUCHLINE_TARGET: target },
});

child.on("exit", (code) => process.exit(code ?? 0));
