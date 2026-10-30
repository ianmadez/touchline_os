#!/usr/bin/env node
/**
 * `npm run phone`: turn the phone link on, with nothing to remember.
 *
 * The core needs one flag to open a listener on the local network, and npm will not forward it: an
 * unrecognised `--flag` is treated as npm's own configuration, so `npm run core -- --share` starts the
 * core with sharing silently OFF. The workaround was an environment variable, which is a thing to
 * remember and a thing to get wrong.
 *
 * This is the one-word version. It sets the variable itself and passes any arguments through, so:
 *
 *   npm run phone                    local network, so a phone can pair
 *   npm run phone -- --port 5000     on a different port
 *
 * The listener is still off unless this is run: a plain `npm run core` stays visible to this PC only,
 * because opening a port on somebody's network should be something they asked for by name.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const candidates = [
  path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
];
const cli = candidates.find((candidate) => fs.existsSync(candidate));

if (!cli) {
  console.error("\n  Run npm install first: this needs the project's dependencies.\n");
  process.exit(1);
}

console.log("");
console.log("  Phone link: on.");
console.log("  This opens one port on your home network so a phone on the same Wi-Fi can open");
console.log("  the app. Nothing is uploaded, and nothing leaves your network.");
console.log("");

const child = spawn(
  process.execPath,
  [cli, path.join("bridge", "touchline-core.ts"), "--share", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    // Set here rather than relying on the flag alone, because the entry point accepts either and this
    // keeps working if the argument is ever swallowed by something in between.
    env: { ...process.env, TOUCHLINE_REMOTE: "1" },
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
