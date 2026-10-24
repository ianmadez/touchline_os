/**
 * TouchlineOS core: the entry point.
 *
 * This is the program a manager runs on the PC that owns their career. It is not the downloaded bridge:
 * that one is a single file with no dependencies that only hands over save bytes, and it stays that
 * way. This one hosts the whole app - the database in `%LOCALAPPDATA%\TouchlineOS`, the parser, the
 * sync, the save watcher and an HTTP surface - so it needs the app's dependencies and runs from the
 * repo.
 *
 *   npm run core                 # loopback only: a page on this PC can use this career
 *   npm run core -- --share      # plus the LAN listener, so a paired phone can too
 *   npm run core -- --share --port 4978 --app ./out-browser
 *
 * ## Why the imports are dynamic
 *
 * `platform/storage` reads `DATABASE_URL` at module load and opens the database there and then. So the
 * environment has to be published before anything that reaches the storage port is imported, and a
 * static import would hoist above the assignment and quietly open the wrong file. The three dynamic
 * imports below are the whole reason this file looks unusual.
 *
 * ## What it refuses to do
 *
 * It never edits a save. It reads the newest one it can find and syncs the database to it - the same
 * one-way read the app has always done. It never listens anywhere but this machine's own addresses, and
 * the LAN listener does not exist unless `--share` was asked for.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import {
  DEFAULT_PORT,
  HOST,
  loadOrCreateConfig,
  startPeriodicRescan,
  type BridgeConfig,
} from "./bridge-server";
import { prepareCore } from "./core";
import { DeviceStore } from "./device-store";
import { DEFAULT_REMOTE_PORT } from "../src/lib/remote/protocol";

/**
 * Where a downloaded core gets the app from, when this PC has no build of its own.
 *
 * The download cannot carry the app: it is about 60 MB, every file Cloudflare Pages serves is capped at
 * 25 MiB, and a download over that cap fails to deploy. So the core fetches the files a phone asks for
 * and keeps them, which makes the download a few megabytes and a phone work offline after its first
 * visit. A checkout never uses this, because `out-browser` is right there.
 */
const DEFAULT_APP_URL = "https://touchline-os.pages.dev";

interface CliOptions {
  share: boolean | null;
  lanPort: number;
  loopbackPort: number;
  appDir: string;
  /** Where the app is fetched from when this PC holds no build. Empty means "do not fetch". */
  appUrl: string;
  /** Where fetched app files are kept. */
  appCacheDir: string;
  noLoopback: boolean;
  /** Skips the save watcher. Used by the end-to-end check, which wants a predictable empty career. */
  noWatch: boolean;
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function numeric(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

function readOptions(): CliOptions {
  // `--share` covers `tsx bridge/touchline-core.ts --share` and `node touchline-core.js --share`.
  // `TOUCHLINE_REMOTE=1` covers `npm run core`, because npm treats an unrecognised `--flag` as its own
  // config and prints a deprecation warning instead of forwarding it - a footgun that would look like
  // sharing being broken.
  const shareFlag =
    process.argv.includes("--share") || process.env.TOUCHLINE_REMOTE === "1"
      ? true
      : process.argv.includes("--no-share") || process.env.TOUCHLINE_REMOTE === "0"
        ? false
        : null;
  return {
    share: shareFlag,
    lanPort: numeric("--port", Number(process.env.TOUCHLINE_REMOTE_PORT ?? DEFAULT_REMOTE_PORT)),
    loopbackPort: numeric("--loopback-port", Number(process.env.TOUCHLINE_BRIDGE_PORT ?? DEFAULT_PORT)),
    appDir: path.resolve(flag("--app") ?? process.env.TOUCHLINE_APP_DIR ?? path.join(process.cwd(), "out-browser")),
    appUrl: flag("--app-url") ?? process.env.TOUCHLINE_APP_URL ?? DEFAULT_APP_URL,
    appCacheDir: (() => {
      const raw = flag("--app-cache") ?? process.env.TOUCHLINE_APP_CACHE ?? "";
      return raw === "" ? "" : path.resolve(raw);
    })(),
    noLoopback: process.argv.includes("--no-loopback"),
    noWatch: process.argv.includes("--no-watch") || process.env.TOUCHLINE_NO_WATCH === "1",
  };
}

/**
 * The folders the app build can be in.
 *
 * `out-browser` is what `npm run build:browser` writes, and it is the only one that is a static export
 * with no server behind it - which is exactly what has to be served to a phone. Named here so a manager
 * who built somewhere else can see what was expected rather than a bare 404.
 */
function appLooksBuilt(appDir: string): boolean {
  return fs.existsSync(path.join(appDir, "index.html"));
}

async function main(): Promise<void> {
  const options = readOptions();
  const boot = prepareCore();

  // Published before ANY import that reaches the storage port. See the header.
  process.env.DATABASE_URL = boot.paths.dbPath;

  const config: BridgeConfig = loadOrCreateConfig(options.loopbackPort);
  const store = DeviceStore.load(path.join(boot.paths.dataDir, "remote.json"));

  if (options.share === true && !store.sharing()) store.setSharing(true);
  if (options.share === false && store.sharing()) store.setSharing(false);

  const hostName = os.hostname();

  // Imported only now: every one of these reaches `platform/storage`, which opens the database with
  // whatever `DATABASE_URL` says at that instant.
  const [{ createCoreServer, pairingAddress }, { createSaveWatcher }] = await Promise.all([
    import("./core-server"),
    import("./save-watcher"),
  ]);

  const loopback = options.noLoopback
    ? null
    : createCoreServer({
        store,
        mode: "loopback",
        pairingCode: config.code,
        hostName,
        port: options.loopbackPort,
      });

  const lan = store.sharing()
    ? createCoreServer({
        store,
        mode: "lan",
        pairingCode: config.code,
        hostName,
        port: options.lanPort,
        appDir: options.appDir,
        appUrl: options.appUrl || null,
        appCacheDir: options.appCacheDir || path.join(boot.paths.dataDir, "app"),
        onSharingDisabled: () => {
          console.log("\n  Sharing stopped from a device. This PC is no longer serving the app.");
          lan?.close().catch(() => {});
        },
      })
    : null;

  const watcher = !options.noWatch
    ? createSaveWatcher({
        log: (line) => console.log(line),
        onChanged: (outcome) => {
          // The revision is what other devices watch. A save landing on disk is a change in the same
          // sense a note typed on the phone is, so it moves the same counter.
          store.bumpRevision();
          lan?.hub.broadcastChanged(store.revision());
          lan?.hub.broadcastState();
          console.log(`  ${outcome.fileName} changed on disk, other devices told.`);
        },
      })
    : null;

  const listen = (server: ReturnType<typeof createCoreServer>, port: number, host: string, label: string) =>
    new Promise<boolean>((resolve) => {
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          console.error(`\n  ${label}: port ${port} is already in use.`);
          console.error(
            port === options.loopbackPort
              ? "  The downloaded bridge is probably running there. This core still serves the LAN.\n"
              : `  Start it elsewhere:  npm run core -- --port ${port + 1}\n`
          );
        } else {
          console.error(`\n  ${label} could not start: ${error.message}\n`);
        }
        resolve(false);
      };
      server.server.once("error", onError);
      server.server.listen(port, host, () => {
        server.server.off("error", onError);
        resolve(true);
      });
    });

  const loopbackUp = loopback
    ? await listen(loopback, options.loopbackPort, HOST, "Loopback listener")
    : false;
  const lanUp = lan ? await listen(lan, options.lanPort, "0.0.0.0", "LAN listener") : false;

  if (!loopbackUp && !lanUp) {
    console.error("  Nothing is listening, so there is nothing to serve. Stopping.\n");
    process.exit(1);
  }

  // Watching is not conditional on sharing. With pairing off this is what a manager runs instead of the
  // old save-only bridge, and the thing that made that useful was the folder watch: a save the game has
  // just written turns up without anyone pressing anything.
  watcher?.start();
  startPeriodicRescan();

  const phoneUrl = pairingAddress(options.lanPort) ?? `http://${hostName}:${options.lanPort}`;

  printBanner({ config, options, boot, store, loopbackUp, lanUp, phoneUrl });

  if (lanUp && !appLooksBuilt(options.appDir)) {
    console.log(
      `  Note: the app is not built on this PC, so a phone fetches it from ${options.appUrl || "(nowhere)"}`
    );
    console.log("  and it is kept for next time. Build it locally with:  npm run build:browser\n");
  }

  if (lanUp) {
    try {
      const shortCode = phoneUrl.replace(/^https?:\/\//, "");
      const qr = await QRCode.toString(`${phoneUrl}/?pair=${config.code}`, { type: "terminal", small: true });
      console.log(`  Scan to pair a phone (${shortCode}):\n`);
      console.log(
        qr
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => `  ${line}`)
          .join("\n")
      );
      console.log("");
    } catch {
      // A terminal that cannot render the QR still gets the address and code on the lines above.
    }
  }

  console.log("  Press Ctrl+C to stop.\n");

  const shutdown = () => {
    watcher?.stop();
    void Promise.all([loopback?.close(), lan?.close()]).finally(() => process.exit(0));
    // A socket held open by a browser would otherwise keep this alive after Ctrl+C.
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

interface BannerInput {
  config: BridgeConfig;
  options: CliOptions;
  boot: ReturnType<typeof prepareCore>;
  store: DeviceStore;
  loopbackUp: boolean;
  lanUp: boolean;
  phoneUrl: string;
}

function printBanner(input: BannerInput): void {
  const { boot, config, options, store, loopbackUp, lanUp, phoneUrl } = input;

  console.log("");
  console.log("  TouchlineOS core is running.");
  console.log("");
  console.log(`    Career database:  ${boot.paths.dbPath}`);
  if (boot.backup) console.log(`    Snapshot taken:   ${path.basename(boot.backup)}`);
  else if (boot.created) console.log("    Snapshot:         none yet (first run)");
  console.log(`    Pairing code:     ${config.code}`);

  if (loopbackUp) {
    console.log(`    This PC only:     http://${HOST}:${options.loopbackPort}`);
  }
  if (lanUp) {
    console.log(`    Your phone:       ${phoneUrl}  (same Wi-Fi)`);
    console.log(`    Paired devices:   ${store.devices().length}`);
  } else {
    console.log("    Your phone:       sharing is off");
    console.log("");
    console.log("  To use this career on a phone, start it again with sharing on:");
    console.log("    TouchlineBridge.cmd share          (the download)");
    console.log("    npm run core                       (set TOUCHLINE_REMOTE=1 first)");
    console.log("    npx tsx bridge/touchline-core.ts --share");
    console.log("  That opens one port on your own network, and nothing else. It never leaves your Wi-Fi.");
  }
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
