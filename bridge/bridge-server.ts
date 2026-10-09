/**
 * The bridge server itself, with no side effects on import.
 *
 * Split from `touchline-bridge.ts` so the test can build a real server on an ephemeral port and assert
 * its actual headers, rather than spawning a process and hoping. Nothing here starts a listener: the
 * entry point does that, and this file only knows how to build one.
 *
 * It performs NO parsing. It finds save files and hands over the bytes of the one that was asked for;
 * the browser decodes them with the same in-page parser it has always used. A bridge that parsed would
 * be a second decode pipeline to keep in step with the first, and the two would drift.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { saveSource } from "../src/lib/platform/save-source";
import type { SaveCandidate } from "../src/lib/parser/interface";

/** Chosen to avoid colliding with the reference companion's 4126, which a user may also be running. */
export const DEFAULT_PORT = 4977;

/** Loopback only. Not configurable, on purpose. */
export const HOST = "127.0.0.1";

/** Identifies this service on `/status`, so a page can tell a bridge from anything else on the port. */
export const SERVICE = "touchline-bridge";
export const VERSION = "1";

export const CODE_HEADER = "x-touchline-bridge-code";

/**
 * No `I`, `O`, `0` or `1`, because this code gets read off a console window and typed by a human.
 * 32 characters means `byte % 32` is uniform over a 256-value byte, so there is no modulo bias.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/** Any port on loopback: local development, and the static export served for testing. */
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Cloudflare Pages, including preview deployments.
 *
 * Deliberately permissive, because the pairing code is the actual gate and this is the layer meant to be
 * defence in depth. Narrow it by setting `TOUCHLINE_BRIDGE_ORIGINS` once a domain is pinned down.
 */
const PAGES_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.pages\.dev$/;

export interface BridgeConfig {
  code: string;
  port: number;
}

/**
 * Extra origins, comma-separated, from `TOUCHLINE_BRIDGE_ORIGINS`.
 *
 * Empty by default rather than pre-filled with a guess. The deployment is a manual upload to Cloudflare
 * Pages and no domain is recorded anywhere in this repo, so a hardcoded value here would be a fiction
 * that fails silently. Adding one is an env var away, and `*.pages.dev` is already allowed.
 */
export function configuredOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TOUCHLINE_BRIDGE_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Where the pairing code is remembered, so re-pairing happens once rather than on every launch. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TOUCHLINE_BRIDGE_CONFIG;
  if (override) return path.resolve(override);

  const base = env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "TouchlineOS", "bridge.json");
}

export function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function isValidCode(code: unknown): code is string {
  return typeof code === "string" && CODE_PATTERN.test(code);
}

/**
 * Reads the remembered code, or generates and stores one.
 *
 * Stable across restarts is the point: a code that changed every launch would mean re-pairing every
 * launch, which is the repeated-prompt experience this feature exists to remove.
 */
export function loadOrCreateConfig(port: number, env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const file = configPath(env);

  try {
    // The byte-order mark is stripped before parsing, and that is not a nicety.
    //
    // `JSON.parse` throws on a leading BOM, and plenty of Windows tooling writes one - PowerShell's
    // `Set-Content -Encoding utf8`, and Notepad when a file is saved as UTF-8. Node's `readFileSync`
    // does not remove it. Without this line, a config file the manager had simply opened and saved
    // would fail to parse, be caught below as "no config yet", and silently produce a NEW pairing code:
    // pairing would appear to break for no reason, with nothing anywhere to explain it.
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(text) as { code?: unknown };
    if (isValidCode(raw.code)) return { code: raw.code, port };
  } catch {
    // No config yet, or unreadable, or written by an older version. A fresh code is generated below.
  }

  const config: BridgeConfig = { code: generateCode(), port };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  } catch {
    // An unwritable location costs only persistence: the code still works for this run.
  }
  return config;
}

/**
 * Compares the supplied code with the expected one.
 *
 * `timingSafeEqual` because this is the gate on a file that sits on disk. Not a cryptographically
 * serious threat model on loopback, but it costs nothing and avoids having to argue about it. The
 * length check returns early, which leaks only the length - and the length is fixed and public.
 */
export function codeMatches(supplied: string | undefined, expected: string): boolean {
  if (!supplied) return false;

  const given = Buffer.from(supplied.trim().toUpperCase(), "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;

  return crypto.timingSafeEqual(given, want);
}

export function originAllowed(origin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    LOOPBACK_ORIGIN.test(origin) ||
    PAGES_ORIGIN.test(origin) ||
    configuredOrigins(env).includes(origin)
  );
}

/**
 * Applies CORS headers, and reports whether the origin was allowed.
 *
 * When it is not, NO CORS header is written at all. That is what makes the browser block the page from
 * reading the response - a `403` alone would still leave the body readable wherever the origin was
 * tolerated, and `*` would let any site on the internet read a save file.
 */
function applyCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  env: NodeJS.ProcessEnv
): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !originAllowed(origin, env)) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", CODE_HEADER);
  // Private Network Access. A public page reaching a loopback address is a request Chromium may
  // preflight and refuse without this. It is inert in browsers that do not implement PNA, which is why
  // it is set unconditionally rather than feature-detected.
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** The candidate as it travels over HTTP. Dates do not survive JSON, so `lastModified` is ISO. */
function toWire(candidate: SaveCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    fileName: candidate.fileName,
    filePath: candidate.filePath,
    lastModified: candidate.lastModified.toISOString(),
    fileSizeBytes: candidate.fileSizeBytes,
    slotKind: candidate.slotKind,
    foundIn: candidate.foundIn,
  };
}

/**
 * The scan the bridge last performed, and when.
 *
 * The bridge runs for as long as the game does, so a save written mid-session has to be noticed
 * without the page asking for it. Two triggers, on purpose:
 *
 * - an immediate one: before serving a cached list, the cached candidates are re-stat'd. Statting a
 *   handful of known files is far cheaper than walking the save tree, and a changed mtime is exactly
 *   the "the game just wrote a save" signal.
 * - a fallback one: a full rescan on an interval, so the list still refreshes when nothing asks and
 *   when a file appears in a folder that was not in the cache at all.
 */
let scanCache: { at: number; saves: SaveCandidate[] } | null = null;

/** Fallback rescan interval. Long on purpose: this is a safety net, not a poll loop. */
export const RESCAN_INTERVAL_MS = 10 * 60 * 1000;

/** True when the cache cannot be trusted: too old, a candidate changed, or one has gone. */
function cacheIsStale(): boolean {
  if (scanCache === null) return true;
  if (Date.now() - scanCache.at >= RESCAN_INTERVAL_MS) return true;
  for (const candidate of scanCache.saves) {
    try {
      const stat = fs.statSync(candidate.filePath);
      if (stat.mtimeMs !== candidate.lastModified.getTime()) return true;
      if (stat.size !== candidate.fileSizeBytes) return true;
    } catch {
      // A save that vanished is a change too, so the list stops offering it.
      return true;
    }
  }
  return false;
}

/** The candidate list, refreshed only when it needs to be. */
async function currentSaves(force = false): Promise<SaveCandidate[]> {
  if (!force && !cacheIsStale() && scanCache !== null) return scanCache.saves;
  const saves = await saveSource.detectSaves();
  scanCache = { at: Date.now(), saves };
  return saves;
}

/**
 * Starts the fallback rescan. Unref'd so it can never be the reason the process stays alive, which
 * would leave a bridge running after the launcher's shutdown signal.
 */
export function startPeriodicRescan(intervalMs: number = RESCAN_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    void currentSaves(true).catch(() => {
      /* A transient read failure must not kill the timer. The next tick tries again. */
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

/** Everything behind the pairing code. */
async function handleAuthorised(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  config: BridgeConfig
): Promise<void> {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname !== "/saves" && !pathname.startsWith("/saves/")) {
    sendJson(res, 404, { error: "Unknown route." });
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Only GET is supported here." });
    return;
  }

  const supplied = req.headers[CODE_HEADER];
  if (!codeMatches(typeof supplied === "string" ? supplied : undefined, config.code)) {
    sendJson(res, 401, {
      error: "Pairing code missing or incorrect. Check the code shown by the bridge.",
    });
    return;
  }

  try {
    if (pathname === "/saves") {
      const candidates = await currentSaves();
      sendJson(res, 200, { saves: candidates.map(toWire) });
      return;
    }

    const id = decodeURIComponent(pathname.slice("/saves/".length));
    const candidates = await currentSaves();
    const candidate = candidates.find((entry) => entry.id === id);
    if (!candidate) {
      sendJson(res, 404, { error: "No save with that id. Ask for the list again." });
      return;
    }

    const bytes = await saveSource.readBytes(candidate);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": bytes.byteLength,
      "cache-control": "no-store",
    });
    res.end(Buffer.from(bytes));
  } catch (error) {
    // A save that vanished mid-request, or a permission problem on the folder. Reported as a 500 with
    // the reason rather than an empty 200, which would read as an empty save file.
    sendJson(res, 500, { error: (error as Error).message ?? "Could not read the save file." });
  }
}

/** Builds the server. Does not listen - the caller owns the port, which is what makes it testable. */
export function createBridgeServer(
  config: BridgeConfig,
  env: NodeJS.ProcessEnv = process.env
): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const allowed = applyCors(req, res, env);

    // The preflight, for both ordinary CORS and Private Network Access. Answered before any routing
    // because a browser never sends the real request until this one succeeds.
    if (req.method === "OPTIONS") {
      res.writeHead(allowed ? 204 : 403);
      res.end();
      return;
    }

    // Discovery. Deliberately unauthenticated and deliberately say-nothing: a page has to be able to
    // find out whether a bridge is running BEFORE it has a code to send. It reveals the service's
    // existence and nothing about the save.
    if (url.pathname.replace(/\/+$/, "") === "/status") {
      // The scan time is added, and nothing about the save itself: a page has to be able to tell
      // whether the bridge is awake and looking, without this route becoming a way to read a career
      // it has not paired with.
      sendJson(res, 200, { service: SERVICE, version: VERSION, lastScanAt: scanCache?.at ?? null });
      return;
    }

    void handleAuthorised(req, res, url, config);
  });
}

/**
 * What the scan found, for the banner.
 *
 * Runs the scan rather than only reading `lastScan()`, because that is empty until a scan has happened
 * and a banner listing nothing would look like the bridge had failed. "It cannot find my save" is the
 * likeliest reason this appears not to work, so the banner answers it before it is asked.
 */
export async function scanSummary(): Promise<{
  locations: { path: string; exists: boolean }[];
  candidates: number;
}> {
  const candidates = await currentSaves(true);
  const locations = saveSource.lastScan().map((entry) => ({
    path: entry.path,
    exists: entry.exists,
  }));
  return { locations, candidates: candidates.length };
}
