#!/usr/bin/env node
/**
 * Bundles the TouchlineOS core into the thing a manager downloads and double-clicks.
 *
 * ## Why the core and not the old single-file bridge
 *
 * There used to be two programs. A small one that only handed save bytes to the website, and the core,
 * which hosts the whole app: the career database, the parser, the save watcher, phone pairing and the
 * replication a phone talks to. A manager who wanted their phone had to clone the repository and read a
 * runbook. That is not a feature, it is a build step they were asked to perform.
 *
 * So the download is the core. Everything the old bridge did, it still does, because the core's loopback
 * listener keeps that same contract (`/status`, `/saves`, `/saves/:id`) and adds the rest. Phone pairing
 * is a switch, off by default: no port opens on the network unless it is asked for.
 *
 * ## Why the app is not in the zip
 *
 * The browser build is about 60 MB and Cloudflare Pages refuses any single file over 25 MiB, so a zip
 * carrying the app would make the site's own deployment fail. Instead the core fetches the files a
 * phone asks for, from the deployed site, and keeps them under `%LOCALAPPDATA%\TouchlineOS\app`. The
 * download stays a few megabytes and a phone works offline after its first visit. A checkout never
 * needs this, because `out-browser` is right there.
 *
 * ## Why it needs no `npm install`
 *
 * `better-sqlite3` is the one dependency that cannot be bundled: it is a native module. Version 13 ships
 * N-API prebuilds, which are stable across Node versions, so the zip carries the package's `lib` folder
 * and the two Windows prebuilds. Node finds them by the ordinary resolution rules, and nothing is
 * compiled on the manager's machine.
 *
 * The bundle is deliberately NOT minified: a program that reads a file off somebody's disk and serves
 * it over a socket should be readable by the person running it.
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

/** The one package that cannot be bundled. Shipped as a folder beside the bundle instead. */
const NATIVE_PACKAGE = "better-sqlite3";

/** Windows, because the launchers are a `.cmd` and a `.vbs` and the config lives under `LOCALAPPDATA`. */
const SHIPPED_PREBUILDS = ["win32-x64.node", "win32-arm64.node"];

const root = process.cwd();
const outdir = path.join(root, "public", "bridge");
const outfile = path.join(outdir, "touchline-core.mjs");

fs.mkdirSync(outdir, { recursive: true });

// The old single-file bridge is gone from the download; leaving a stale copy beside the new bundle would
// be a file nobody can explain.
fs.rmSync(path.join(outdir, "touchline-bridge.mjs"), { force: true });

await build({
  entryPoints: [path.join(root, "bridge", "touchline-core.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false,
  legalComments: "none",
  external: [NATIVE_PACKAGE],
  // `qrcode` is CommonJS and calls `require("fs")` at load time for its PNG renderer. In an ES module
  // there is no `require`, and esbuild's shim throws instead of guessing, so one is provided here. This
  // is the documented way to bundle a CJS package into an ESM file for Node.
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
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

const unexpected = [...new Set(bareImports)].filter((name) => name !== NATIVE_PACKAGE);
if (unexpected.length > 0) {
  console.error(
    `Refusing to ship: the bundle imports ${unexpected.join(", ")}, ` +
      "which would need node_modules on the user's machine."
  );
  process.exit(1);
}

// ---------------------------------------------------------------- the native package
//
// Copied rather than referenced: the zip has to be self-contained, and `better-sqlite3` resolves its
// prebuilt binary relative to its own package folder.
const nativeSource = path.join(root, "node_modules", NATIVE_PACKAGE);
const nativeTarget = path.join(outdir, "node_modules", NATIVE_PACKAGE);
if (!fs.existsSync(nativeSource)) {
  console.error(
    `Refusing to ship: ${NATIVE_PACKAGE} is not installed, so the core could not open a database.`
  );
  process.exit(1);
}
fs.rmSync(nativeTarget, { recursive: true, force: true });
fs.mkdirSync(path.join(nativeTarget, "prebuilds"), { recursive: true });
fs.copyFileSync(path.join(nativeSource, "package.json"), path.join(nativeTarget, "package.json"));
fs.cpSync(path.join(nativeSource, "lib"), path.join(nativeTarget, "lib"), { recursive: true });
for (const prebuild of SHIPPED_PREBUILDS) {
  const from = path.join(nativeSource, "prebuilds", prebuild);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(nativeTarget, "prebuilds", prebuild));
}

// The launchers travel with the bundle - they are the double-click entry point, and a download with a
// missing launcher looks broken rather than incomplete.
const SHIPPED = [
  "touchline-core.mjs",
  "node_modules",
  "TouchlineBridge.cmd",
  "TouchlineBridge.vbs",
  "README.md",
];
for (const name of ["TouchlineBridge.cmd", "TouchlineBridge.vbs", "README.md"]) {
  const from = path.join(root, "bridge", name);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outdir, name));
}

/**
 * One zip, because the core is several files that have to end up in the same folder.
 *
 * Handing someone separate downloads and an instruction to file them correctly is exactly where a
 * one-time setup turns into a support conversation. Zipping with PowerShell, which is present on every
 * Windows machine. Built to a temporary file and moved, so the archive can never be written into the
 * same folder it is reading from.
 */
const zipPath = path.join(outdir, "touchline-bridge.zip");
const zipTmp = path.join(os.tmpdir(), `touchline-bridge-${process.pid}.zip`);

try {
  fs.rmSync(zipTmp, { force: true });
  const parts = SHIPPED.map((name) => path.join(outdir, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => `'${file.replace(/'/g, "''")}'`)
    .join(",");

  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${parts} -DestinationPath '${zipTmp.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: "ignore" }
  );

  fs.copyFileSync(zipTmp, zipPath);
  const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(
    `bridge packaged: public/bridge/touchline-bridge.zip (${SHIPPED.length} entries, ${zipMb} MB)`
  );
} catch {
  console.log("bridge zip not created; the individual files were still written.");
} finally {
  fs.rmSync(zipTmp, { force: true });
}

const sizeKb = (fs.statSync(outfile).size / 1024).toFixed(0);
console.log(`core bundled: public/bridge/touchline-core.mjs (${sizeKb} KB, no npm install needed)`);
