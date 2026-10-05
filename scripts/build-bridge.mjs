#!/usr/bin/env node
/**
 * Bundles the bridge into one file the user can download and run with `node`.
 *
 * The point of a single file is that it needs no `npm install` and no `node_modules`: a manager who
 * wants automatic sync downloads two files, double-clicks one, and is done. Anything that reintroduces
 * an install step defeats the reason this exists.
 *
 * Output goes to `public/bridge/`, which Next serves statically, so the download link on the site is
 * versioned with the app. That matters specifically here: the bridge and the browser build share code
 * (`searchLocations`, `classifySlot`, `sha1Hex`), and a stale bridge from some other release could
 * silently disagree with what the current app expects. Locking them together removes that class of bug.
 *
 * The bundle is deliberately NOT minified. This is a program that reads a file off somebody's disk and
 * serves it over a socket, and a person download-and-running that deserves to be able to read it. The
 * size difference is a few kilobytes.
 *
 *   node scripts/build-bridge.mjs
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Node's own modules, with and without the `node:` prefix.
 *
 * Taken from the running Node rather than hand-listed, and both spellings are needed: esbuild keeps
 * whatever the source wrote, and this source imports `"fs"` rather than `"node:fs"`.
 */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const root = process.cwd();
const outdir = path.join(root, "public", "bridge");
const outfile = path.join(outdir, "touchline-bridge.mjs");

fs.mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "bridge", "touchline-bridge.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false,
  legalComments: "none",
  // `fs`/`path`/`http` and friends are builtins, so esbuild leaves them as imports. Anything else
  // reaching this list would be a package, which is exactly what the check below refuses.
  logLevel: "warning",
});

const source = fs.readFileSync(outfile, "utf8");

/**
 * The zero-dependency proof, asserted at build time rather than trusted to a reviewer.
 *
 * A single stray package import would not fail here - it would fail on the user's machine, at first
 * run, as a module-not-found error they have no way to act on. Cheaper to refuse to produce the
 * artefact at all.
 */
const bareImports = [...source.matchAll(/^\s*import[^"'\n]*from\s*["']([^"']+)["']/gm)]
  .map((match) => match[1])
  .filter(
    (specifier) =>
      !NODE_BUILTINS.has(specifier) &&
      !specifier.startsWith("./") &&
      !specifier.startsWith("../")
  );

if (bareImports.length > 0) {
  console.error(
    `Refusing to ship: the bundle imports ${[...new Set(bareImports)].join(", ")}, ` +
      "which would need node_modules on the user's machine."
  );
  process.exit(1);
}

// The launchers travel with the bundle - they are the double-click entry point, and a download with a
// missing launcher looks broken rather than incomplete.
const SHIPPED = ["touchline-bridge.mjs", "TouchlineBridge.cmd", "TouchlineBridge.vbs", "README.md"];
for (const name of SHIPPED) {
  const from = path.join(root, "bridge", name);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outdir, name));
}

/**
 * One zip, because the bridge is several files that have to end up in the same folder.
 *
 * Handing someone separate downloads and an instruction to file them correctly is exactly where a
 * one-time setup turns into a support conversation. Zipping with PowerShell, which is present on every
 * Windows machine - and Windows is the only platform this targets, since the launchers are a `.cmd` and
 * a `.vbs` and the pairing config lives under `LOCALAPPDATA`. Elsewhere the step is skipped and the
 * individual files are still published.
 *
 * Built to a temporary file and then moved, so the archive can never be written into the same folder it
 * is reading from - which would put a half-written zip inside itself.
 */
const zipPath = path.join(outdir, "touchline-bridge.zip");
const zipTmp = path.join(os.tmpdir(), `touchline-bridge-${process.pid}.zip`);

try {
  fs.rmSync(zipTmp, { force: true });
  const parts = SHIPPED.map((name) => path.join(outdir, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => `'${file}'`)
    .join(",");

  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Compress-Archive -Path ${parts} -DestinationPath '${zipTmp}' -Force`],
    { stdio: "ignore" }
  );

  fs.copyFileSync(zipTmp, zipPath);
  console.log(`bridge packaged: public/bridge/touchline-bridge.zip (${SHIPPED.length} files)`);
} catch {
  console.log("bridge zip not created; the individual files were still written.");
} finally {
  fs.rmSync(zipTmp, { force: true });
}

const sizeKb = (fs.statSync(outfile).size / 1024).toFixed(0);
console.log(`bridge bundled: public/bridge/touchline-bridge.mjs (${sizeKb} KB, no dependencies)`);
