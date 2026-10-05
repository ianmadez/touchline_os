/**
 * TouchlineOS bridge: the entry point.
 *
 * Starts a small local server that lets the hosted app read your save file, and prints what the manager
 * needs to pair it. The server itself lives in `bridge-server.ts`, which has no side effects on import
 * so the test can build one on an ephemeral port and assert its real headers instead of spawning a
 * process and hoping.
 *
 * ## Why this exists
 *
 * A webpage cannot enumerate a filesystem, and only Chromium browsers can remember a file the manager
 * picked. So on the hosted build, Firefox and Safari users re-pick their save on every visit, and even
 * Chromium users depend on whether the browser still holds their permission. This closes that gap for
 * anyone willing to run one small program: the browser asks this instead of a file dialog.
 *
 * ## What it is not
 *
 * It is not the app, and it performs no parsing - see `bridge-server.ts` for why that matters. It also
 * cannot sync with the tab closed, and it cannot remove the one-time install. Neither is a limitation
 * to engineer around; both are stated in the UI.
 *
 * Run it:           npx tsx bridge/touchline-bridge.ts
 * Built single file: node touchline-bridge.mjs
 */
import {
  createBridgeServer,
  DEFAULT_PORT,
  HOST,
  loadOrCreateConfig,
  scanSummary,
  type BridgeConfig,
} from "./bridge-server";

function parsePortArg(): number | null {
  const index = process.argv.indexOf("--port");
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Prints what the manager needs, and nothing they do not.
 *
 * The scan result is included because "it cannot find my save" is the likeliest reason this appears not
 * to work, and showing the folders it looked in answers that immediately rather than after a round of
 * guessing. A folder that was probed and is not there is shown greyed rather than hidden: the empty ones
 * are exactly the ones worth knowing about.
 */
async function printBanner(config: BridgeConfig): Promise<void> {
  const found = await scanSummary();

  console.log("");
  console.log("  TouchlineOS bridge is running.");
  console.log("");
  console.log(`    Pairing code:   ${config.code}`);
  console.log(`    Address:        http://${HOST}:${config.port}`);
  console.log("");
  console.log("  Enter the pairing code once on the TouchlineOS website. After that, leave");
  console.log("  this window open whenever you want the site to sync on its own. Closing it");
  console.log("  costs nothing - your career is untouched, and the site simply goes back");
  console.log("  to asking for the save file.");
  console.log("");

  if (found.candidates === 0) {
    console.log("  No career saves were found. These are the folders it looked in:");
  } else {
    console.log(`  Found ${found.candidates} career save(s). Folders checked:`);
  }
  for (const location of found.locations) {
    console.log(`    ${location.exists ? "[x]" : "[ ]"} ${location.path}`);
  }
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
}

async function main(): Promise<void> {
  const port = Number(process.env.TOUCHLINE_BRIDGE_PORT ?? parsePortArg() ?? DEFAULT_PORT);
  const config = loadOrCreateConfig(port);
  const server = createBridgeServer(config);

  // Registered before listening, so a port clash is reported as a sentence rather than an unhandled
  // error event that takes the process down with a stack trace.
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `\n  Port ${port} is already in use.\n` +
          `  If the bridge is already running, just use that one.\n` +
          `  Otherwise start this on another port:  npx tsx bridge/touchline-bridge.ts --port ${port + 1}\n`
      );
    } else {
      console.error(`\n  The bridge could not start: ${error.message}\n`);
    }
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    void printBanner(config);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    // A connection held open by a browser would otherwise keep this alive after Ctrl+C.
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
