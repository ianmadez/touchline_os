/**
 * The PC core: the app and its data, served to the machine itself and to paired devices.
 *
 * One server module, two listeners, because they have genuinely different clearances:
 *
 * - **Loopback** keeps the contract the downloaded bridge already had - `/status`, `/saves`,
 *   `/saves/:id` - and adds `/api/*`, so a page on this machine can use the career database here
 *   instead of a private one in the browser. That is Phase 3's "PC-owned core": the desktop app can
 *   run against the same data as everything else.
 * - **LAN** is the whole app: the pinned static build, the same `/api/*`, pairing, devices, an event
 *   stream and the writer lease. It is off unless the manager turns sharing on.
 *
 * What is enforced here, and why:
 *
 * - **Origin, not just a token.** A browser can be made to send a request by any page the user visits.
 *   A mutation that arrives with an `Origin` header this core does not recognise is refused before it
 *   is read, so a hostile page cannot edit a career by knowing a URL.
 * - **A device token for every LAN call.** It travels in a header, and the cookie set at pairing is
 *   only there for `EventSource`, which cannot send one.
 * - **A writer lease.** Two phones editing the same note is a support conversation; one pen is a rule
 *   the UI can explain. Writes from a device that does not hold it are refused with `409` and a code
 *   the client turns into "Another device has changes to make. Take control."
 * - **Size and rate limits.** A public page cannot reach the LAN listener at all, but a paired phone
 *   with a stuck loop can, so bodies are capped and requests are counted per address.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { dispatch } from "../src/lib/operations/dispatch";
import {
  REMOTE_API_VERSION,
  REMOTE_MIN_CLIENT_VERSION,
  REMOTE_SERVICE,
  REMOTE_TOKEN_HEADER,
  type RemoteDevice,
  type RemotePairing,
  type RemoteState,
} from "../src/lib/remote/protocol";
import {
  applyCors,
  codeMatches,
  handleSaveRoutes,
  originAllowed,
  sendJson,
  CODE_HEADER,
  type BridgeConfig,
} from "./bridge-server";
import { handleSyncRoutes } from "./replication";
import type { DeviceStore } from "./device-store";
import { MIGRATION_LEVEL, SCHEMA_VERSION } from "../src/lib/sync/versions";

/** Largest body the core will read. A career transfer package is the big one, and it is far smaller. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Requests per address per window. Generous for a UI, mean enough to stop a loop. */
export const RATE_LIMIT = { windowMs: 60_000, max: 300, pairMax: 10 };

/** How long a pairing code attempt is remembered for rate limiting. */
const PAIR_WINDOW_MS = 10 * 60_000;

export type CoreMode = "lan" | "loopback";

export interface CoreServerOptions {
  store: DeviceStore;
  mode: CoreMode;
  /** The pairing code from `bridge.json`, used by `/pair` and shown in `/api/remote/state`. */
  pairingCode: string;
  /** The hostname of this machine, for the UI to say which PC it is talking to. */
  hostName: string;
  /** The port this listener is on, for building the pairing URL and checking `Host`. */
  port: number;
  /** The static app to serve. Null on the loopback listener, which has no page of its own. */
  appDir?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Called when sharing is switched off from a device, so the entry point can close the LAN socket. */
  onSharingDisabled?: () => void;
  /** Called after any successful write, so the save watcher and the console can react. */
  onWrite?: (info: { method: string; path: string }) => void;
  /** Overridden by tests so a limit can be exercised without sending thirty megabytes. */
  maxBodyBytes?: number;
  rateLimit?: { windowMs: number; max: number; pairMax: number };
}

interface RateWindow {
  count: number;
  resetAt: number;
}

interface PairAttempts {
  count: number;
  resetAt: number;
}

interface EventClient {
  id: number;
  res: http.ServerResponse;
  deviceId: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Every IPv4 address this machine has that another device could reach. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      out.push(entry.address);
    }
  }
  return out;
}

/** The address to print and to put in a QR code. The first private IPv4 that is not loopback. */
export function pairingAddress(port: number): string | null {
  const candidates = lanAddresses();
  const preferred =
    candidates.find((address) => address.startsWith("192.168.")) ??
    candidates.find((address) => address.startsWith("10.")) ??
    candidates.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address)) ??
    candidates[0];
  return preferred ? `http://${preferred}:${port}` : null;
}

/**
 * The origin allowlist for the loopback API: this machine only.
 *
 * Deliberately narrower than the one `/saves` uses. Save bytes were always gated by the pairing code in
 * a header, so a broad origin list was defence in depth; the API has no such code, and any
 * `*.pages.dev` site being able to read a career would be a hole rather than a convenience. A hosted
 * page that wants the career has to come through the LAN listener and pair.
 */
function loopbackOriginOk(origin: string, env: NodeJS.ProcessEnv): boolean {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return (env.TOUCHLINE_BRIDGE_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

/** The hosts a `Host:` header may name. Anything else is a request for somebody else's server. */
function allowedHosts(hostName: string, env: NodeJS.ProcessEnv): string[] {
  const extra = (env.TOUCHLINE_REMOTE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [
    "localhost",
    "127.0.0.1",
    hostName.toLowerCase(),
    ...lanAddresses().map((address) => address.toLowerCase()),
    ...extra,
  ];
}

function hostOf(header: string | undefined): string {
  if (!header) return "";
  // `Host` may carry a port and, for IPv6, brackets. Neither matters for the comparison.
  const withoutPort = header.replace(/:\d+$/, "");
  return withoutPort.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Reads a whole body, refusing politely once it is larger than the cap. */
function readBody(
  req: http.IncomingMessage,
  limit: number
): Promise<{ ok: true; text: string } | { ok: false; reason: "too-large" }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // The stream is drained rather than destroyed: destroying it mid-upload surfaces as a socket
        // error in the browser, and the manager gets "failed to fetch" instead of the real answer.
        chunks.length = 0;
        resolve({ ok: false, reason: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", reject);
  });
}

function tokenOf(req: http.IncomingMessage): string | undefined {
  const header = req.headers[REMOTE_TOKEN_HEADER];
  if (typeof header === "string" && header) return header;
  // The bearer form, for anything that proxies and rewrites custom headers.
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  const cookie = req.headers.cookie;
  if (typeof cookie === "string") {
    const match = /(?:^|;\s*)touchline_device=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
}

/** True for a call that changes data, which is what the lease and the revision counter watch. */
export function isWrite(method: string, pathname: string, params: URLSearchParams): boolean {
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return true;
  // One GET does write: closing a season is a transition, and the app has always asked for it as a
  // GET. Missing that would let a read-only device end somebody's season.
  return pathname === "/api/season/review" && params.get("action") === "transition";
}

export interface CoreServer {
  server: http.Server;
  /** Frames for every connected device. Exposed so a test can assert what a client receives. */
  hub: EventHub;
  /** The most recent state, for the console banner and for tests. */
  stateFor(deviceId: string | null): RemoteState;
  close: () => Promise<void>;
}

export class EventHub {
  private clients: EventClient[] = [];
  private nextId = 1;
  private timer: NodeJS.Timeout;

  constructor(
    private readonly store: DeviceStore,
    private readonly describe: (deviceId: string) => RemoteState
  ) {
    // A comment every 20 seconds. Without it a proxy or a phone radio decides the stream is dead, and
    // the app falls back to polling for no reason.
    this.timer = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.res.write(": keep-alive\n\n");
        } catch {
          this.remove(client.id);
        }
      }
    }, 20_000);
    this.timer.unref();
  }

  add(res: http.ServerResponse, deviceId: string): number {
    const id = this.nextId++;
    this.clients.push({ id, res, deviceId });
    this.writeEvent(id, "state", this.describe(deviceId));
    return id;
  }

  remove(id: number): void {
    const client = this.clients.find((entry) => entry.id === id);
    this.clients = this.clients.filter((entry) => entry.id !== id);
    try {
      client?.res.end();
    } catch {
      // Already gone.
    }
  }

  /**
   * Drops every stream a device holds.
   *
   * Called when a device is revoked. A stream that stayed open would keep delivering frames to a device
   * that is no longer allowed to read the career, which is the one thing revocation exists to stop.
   * Returns how many were closed, so a test can assert it rather than infer it.
   */
  removeFor(deviceId: string): number {
    const doomed = this.clients.filter((entry) => entry.deviceId === deviceId);
    for (const client of doomed) this.remove(client.id);
    return doomed.length;
  }

  get size(): number {
    return this.clients.length;
  }

  private writeEvent(id: number, event: string, data: unknown): void {
    const client = this.clients.find((entry) => entry.id === id);
    if (!client) return;
    try {
      client.res.write(`id: ${this.store.revision()}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.remove(id);
    }
  }

  /** Every device's state, because `self` and `writer` are per-device. */
  broadcastState(): void {
    for (const client of this.clients) this.writeEvent(client.id, "state", this.describe(client.deviceId));
  }

  /** Says the data moved, without sending the data itself. */
  broadcastChanged(revision: number, by: string | null = null): void {
    for (const client of this.clients) {
      try {
        client.res.write(
          `id: ${revision}\nevent: data-changed\ndata: ${JSON.stringify({ revision, by })}\n\n`
        );
      } catch {
        this.remove(client.id);
      }
    }
  }

  close(): void {
    clearInterval(this.timer);
    for (const client of [...this.clients]) this.remove(client.id);
  }
}

/** Builds the server. Does not listen: the caller owns the port, which is what makes it testable. */
export function createCoreServer(options: CoreServerOptions): CoreServer {
  const env = options.env ?? process.env;
  const store = options.store;
  const hosts = allowedHosts(options.hostName, env);
  const extraOrigins = (env.TOUCHLINE_REMOTE_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const lan = options.mode === "lan";
  const bodyLimit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const limit = options.rateLimit ?? RATE_LIMIT;

  const rate = new Map<string, RateWindow>();
  const pairAttempts = new Map<string, PairAttempts>();

  const clientAddress = (req: http.IncomingMessage): string =>
    req.socket.remoteAddress ?? "unknown";

  /** A fixed window per address. Returns false when the caller has used their allowance. */
  const underRateLimit = (req: http.IncomingMessage, max: number): boolean => {
    const now = Date.now();
    const key = clientAddress(req);
    const current = rate.get(key);
    if (!current || now >= current.resetAt) {
      rate.set(key, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  };

  const underPairLimit = (req: http.IncomingMessage): boolean => {
    const now = Date.now();
    const key = clientAddress(req);
    const current = pairAttempts.get(key);
    if (!current || now >= current.resetAt) {
      pairAttempts.set(key, { count: 1, resetAt: now + PAIR_WINDOW_MS });
      return true;
    }
    current.count += 1;
    return current.count <= limit.pairMax;
  };

  /** Caches the QR for the address it encodes, so a state call does not re-render it every time. */
  const qrCache = {
    values: new Map<string, string>(),
    get(base: string, code: string): string | null {
      return this.values.get(`${base}|${code}`) ?? null;
    },
    async ensure(base: string, code: string): Promise<void> {
      const key = `${base}|${code}`;
      if (this.values.has(key)) return;
      try {
        const svg = await QRCode.toString(`${base}/?pair=${code}`, { type: "svg", margin: 1, width: 320 });
        this.values.set(key, `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`);
      } catch {
        this.values.set(key, "");
      }
    },
  };

  /** Refreshes the cached QR before building a state that will contain it. */
  const warmQr = async (): Promise<void> => {
    const base = pairingAddress(options.port) ?? `http://${options.hostName}:${options.port}`;
    await qrCache.ensure(base, options.pairingCode);
  };

  const stateFor = (deviceId: string | null): RemoteState => {
    const now = new Date();
    const lease = store.lease(now);
    const devices: RemoteDevice[] = store.devices().map((device) => ({
      id: device.id,
      name: device.name,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
      self: device.id === deviceId,
      writer: lease?.deviceId === device.id,
    }));
    const writerDevice = lease ? devices.find((device) => device.id === lease.deviceId) : undefined;

    let pairing: RemotePairing | null = null;
    if (deviceId) {
      const base = pairingAddress(options.port) ?? `http://${options.hostName}:${options.port}`;
      pairing = {
        code: options.pairingCode,
        url: `${base}/?pair=${options.pairingCode}`,
        // Rendered here rather than in the page: the core knows the address, and the app does not
        // need a QR encoder in its bundle to draw it.
        qr: qrCache.get(base, options.pairingCode),
      };
    }

    return {
      paired: deviceId !== null,
      apiVersion: REMOTE_API_VERSION,
      minClientVersion: REMOTE_MIN_CLIENT_VERSION,
      compatible: true,
      hostName: options.hostName,
      url: pairingAddress(options.port) ?? `http://${options.hostName}:${options.port}`,
      sharing: store.sharing(),
      self: devices.find((device) => device.self) ?? null,
      writer: writerDevice
        ? { deviceId: writerDevice.id, name: writerDevice.name, since: lease?.since ?? "" }
        : null,
      devices,
      pairing,
      revision: store.revision(),
    };
  };

  const hub = new EventHub(store, stateFor);

  const setDeviceCookie = (res: http.ServerResponse, token: string): void => {
    // HttpOnly: nothing in the page needs to read it, and a script that could read it would be able to
    // steal it. SameSite=Strict because this cookie is only ever used from the core's own origin.
    res.setHeader(
      "set-cookie",
      `touchline_device=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`
    );
  };

  /** The origin gate. Returns true when the request may proceed. */
  const originPermitted = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || origin === "") {
      // No Origin: a native client, curl, or a same-origin navigation. Allowed - a browser always
      // sends Origin on a cross-origin fetch, which is the case this check exists for.
      return true;
    }
    if (LAN_ORIGIN_OK(origin, hosts, extraOrigins)) return true;
    sendJson(res, 403, { success: false, error: "That origin is not allowed to talk to this PC." });
    return false;
  };

  const LAN_ORIGIN_OK = (origin: string, allowed: string[], extra: string[]): boolean => {
    if (extra.includes(origin)) return true;
    if (!/^https?:\/\//.test(origin)) return false;
    const withoutScheme = origin.replace(/^https?:\/\//, "");
    const host = withoutScheme.replace(/:\d+$/, "");
    // Same-origin is the normal case: the page came from this core. A loopback origin is allowed too,
    // so a developer running the app locally can point it at the core.
    return allowed.includes(host) || host === "127.0.0.1" || host === "localhost";
  };

  const serveApp = (req: http.IncomingMessage, res: http.ServerResponse, url: URL): void => {
    const appDir = options.appDir ?? null;
    if (!appDir) {
      sendJson(res, 404, { success: false, error: "This listener does not serve the app." });
      return;
    }

    const relative = decodeURIComponent(url.pathname);
    let target = path.join(appDir, relative);
    // Traversal guard: the resolved path must stay inside the app folder.
    if (!path.resolve(target).startsWith(path.resolve(appDir))) {
      sendJson(res, 403, { success: false, error: "That path is not served." });
      return;
    }
    if (relative.endsWith("/")) target = path.join(target, "index.html");
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      // A static export with `trailingSlash` answers a folder with its index. Anything else falls back
      // to the app's own entry, so a deep link still boots the app rather than 404ing.
      const nested = fs.existsSync(target) && fs.statSync(target).isDirectory()
        ? path.join(target, "index.html")
        : path.join(appDir, "index.html");
      target = nested;
    }

    if (!fs.existsSync(target)) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body style="font:14px system-ui;padding:2rem;background:#0f172a;color:#e2e8f0">` +
          `<h1 style="font-size:1rem;letter-spacing:.1em">TOUCHLINE<span style="color:#E11D48">OS</span></h1>` +
          `<p>The app has not been built yet, so there is nothing to serve.</p>` +
          `<p style="opacity:.7">Run <code>npm run build:browser</code> on the PC, then reload this page.</p>` +
          `</body></html>`
      );
      return;
    }

    const extension = path.extname(target).toLowerCase();
    const type = CONTENT_TYPES[extension] ?? "application/octet-stream";

    // The marker is what makes a page remote: `isRemoteRuntime()` reads it, and `apiFetch` forwards
    // instead of answering in the page. Injected on the way out rather than patched into the build,
    // so the same export works hosted and served by a core.
    if (extension === ".html") {
      let html = fs.readFileSync(target, "utf8");
      const marker = `<meta name="${"touchline-remote"}" content="apiVersion=${REMOTE_API_VERSION};minClientVersion=${REMOTE_MIN_CLIENT_VERSION}">`;
      html = html.includes("<head>")
        ? html.replace("<head>", `<head>${marker}`)
        : `${marker}${html}`;
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      "content-type": type,
      // Hashed build assets are immutable; anything else is revalidated. `no-store` on everything
      // would make a phone re-download the whole bundle on every launch.
      "cache-control": target.includes(`${path.sep}_next${path.sep}static${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-store",
    });
    fs.createReadStream(target).pipe(res);
  };

  const handlePair = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!underPairLimit(req)) {
      sendJson(res, 429, {
        success: false,
        code: "rate-limited",
        error: "Too many pairing attempts. Wait a few minutes and try again.",
      });
      return;
    }

    const body = await readBody(req, 64 * 1024);
    if (!body.ok) {
      sendJson(res, 413, { success: false, code: "too-large", error: "That request was too large." });
      return;
    }

    let parsed: { code?: unknown; name?: unknown } = {};
    try {
      parsed = JSON.parse(body.text || "{}") as typeof parsed;
    } catch {
      sendJson(res, 400, { success: false, error: "Request body must be valid JSON." });
      return;
    }

    const supplied = typeof parsed.code === "string" ? parsed.code : "";
    if (!codeMatches(supplied, options.pairingCode)) {
      sendJson(res, 401, {
        success: false,
        code: "pairing-code",
        error: "That code does not match. Check the code shown on the PC.",
      });
      return;
    }

    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "Unnamed device";
    const { device, token } = store.pair(name);
    setDeviceCookie(res, token);
    // A brand new device takes the pen only if nobody has it. Pairing a second phone must not knock
    // the first one out of the middle of a sentence.
    if (!store.lease()) store.take(device.id);
    await warmQr();
    hub.broadcastState();

    sendJson(res, 200, {
      success: true,
      token,
      deviceId: device.id,
      state: stateFor(device.id),
    });
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const method = (req.method ?? "GET").toUpperCase();

      try {
        // ---------------------------------------------------------------- host check (LAN only)
        if (lan) {
          const host = hostOf(req.headers.host);
          // A `Host` this machine does not answer for is refused outright rather than served: it is
          // either a typo, a proxy misconfiguration, or DNS rebinding, and none of those should end up
          // looking at a career.
          if (host && !hosts.includes(host)) {
            sendJson(res, 421, { success: false, error: "This core does not answer for that host name." });
            return;
          }
          if (!originPermitted(req, res)) return;
        } else {
          const origin = req.headers.origin;
          if (typeof origin === "string" && !originAllowed(origin, env)) {
            // No CORS header at all on a foreign origin: the browser then blocks the read, which is
            // the actual boundary. A bare 403 would still let an allowed origin read the body.
            sendJson(res, 403, { success: false, error: "That origin is not allowed to talk to this PC." });
            return;
          }
          applyCors(req, res, env);
        }

        if (method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-methods": lan
              ? "GET, POST, PUT, PATCH, DELETE, OPTIONS"
              // POST on loopback exists for replication only: the page seeds and pushes the replica.
              : "GET, POST, OPTIONS",
            "access-control-allow-headers": lan
              ? `content-type, ${REMOTE_TOKEN_HEADER}, ${"x-touchline-code"}`
              : "x-touchline-bridge-code, content-type",
            "access-control-max-age": "600",
            vary: "Origin",
          });
          res.end();
          return;
        }

        // ---------------------------------------------------------------- discovery
        if (pathname === "/status") {
          sendJson(res, 200, {
            // The loopback listener keeps the name the hosted app already looks for, so adding the API
            // here does not break the save-bytes feature it has always offered.
            service: lan ? REMOTE_SERVICE : "touchline-bridge",
            core: REMOTE_SERVICE,
            version: String(REMOTE_API_VERSION),
            apiVersion: REMOTE_API_VERSION,
            minClientVersion: REMOTE_MIN_CLIENT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            migrationLevel: MIGRATION_LEVEL,
            hostName: options.hostName,
            sharing: store.sharing(),
            paired: store.devices().length > 0,
            lastScanAt: null,
          });
          return;
        }

        if (pathname === "/touchline/runtime.json") {
          sendJson(res, 200, {
            service: REMOTE_SERVICE,
            apiVersion: REMOTE_API_VERSION,
            minClientVersion: REMOTE_MIN_CLIENT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            migrationLevel: MIGRATION_LEVEL,
            hostName: options.hostName,
            url: pairingAddress(options.port),
            sharing: store.sharing(),
          });
          return;
        }

        // ---------------------------------------------------------------- save bytes (both)
        if (pathname === "/saves" || pathname.startsWith("/saves/")) {
          const config: BridgeConfig = { code: options.pairingCode, port: options.port };
          await handleSaveRoutes(req, res, url, config);
          return;
        }

        // ---------------------------------------------------------------- replication (loopback only)
        //
        // The page sequences its changes through this listener and nowhere else. The LAN listener
        // answers 404 to the whole prefix rather than authenticating it: a phone is a client of the
        // replica and never needs a revision, so the door does not exist there at all.
        if (pathname === "/sync" || pathname.startsWith("/sync/")) {
          if (lan) {
            sendJson(res, 404, { success: false, error: "Unknown route." });
            return;
          }
          const supplied = req.headers[CODE_HEADER];
          if (!codeMatches(typeof supplied === "string" ? supplied : undefined, options.pairingCode)) {
            sendJson(res, 401, {
              error: "Pairing code missing or incorrect. Check the code shown by the bridge.",
            });
            return;
          }
          await handleSyncRoutes(req, res, url);
          return;
        }

        // ---------------------------------------------------------------- remote control
        if (pathname === "/api/remote/pair") {
          if (method !== "POST") {
            sendJson(res, 405, { success: false, error: "Only POST is supported here." });
            return;
          }
          if (!lan) {
            sendJson(res, 404, { success: false, error: "Pairing only exists on the shared listener." });
            return;
          }
          await handlePair(req, res);
          return;
        }

        if (pathname.startsWith("/api/remote/")) {
          if (!lan) {
            sendJson(res, 404, { success: false, error: "This call only exists on the shared listener." });
            return;
          }

          const token = tokenOf(req);
          const device = store.authenticate(token);
          if (!device) {
            sendJson(res, 401, {
              success: false,
              code: "unpaired",
              error: "This device is not paired with that PC any more. Pair it again from the code on the PC.",
            });
            return;
          }
          store.touch(device.id);

          if (pathname === "/api/remote/state" && method === "GET") {
            await warmQr();
            sendJson(res, 200, stateFor(device.id));
            return;
          }

          if (pathname === "/api/remote/heartbeat" && method === "POST") {
            sendJson(res, 200, { success: true, revision: store.revision() });
            return;
          }

          if (pathname === "/api/remote/lease") {
            if (method === "POST") {
              store.take(device.id);
              hub.broadcastState();
              await warmQr();
              sendJson(res, 200, stateFor(device.id));
              return;
            }
            if (method === "DELETE") {
              store.release(device.id);
              hub.broadcastState();
              sendJson(res, 200, stateFor(device.id));
              return;
            }
            sendJson(res, 405, { success: false, error: "Only POST and DELETE are supported here." });
            return;
          }

          if (pathname === "/api/remote/devices" && method === "DELETE") {
            const id = url.searchParams.get("id") ?? "";
            if (!id) {
              sendJson(res, 400, { success: false, error: "A device id is required." });
              return;
            }
            const known = store.devices().some((entry) => entry.id === id);
            if (!known) {
              sendJson(res, 404, { success: false, error: "No paired device with that id." });
              return;
            }
            store.revoke(id);
            // A revoked device must lose the stream it is already holding, not only its next request.
            hub.removeFor(id);
            hub.broadcastState();
            sendJson(res, 200, stateFor(device.id));
            return;
          }

          if (pathname === "/api/remote/sharing" && method === "POST") {
            const body = await readBody(req, 4096);
            if (!body.ok) {
              sendJson(res, 413, { success: false, code: "too-large", error: "That request was too large." });
              return;
            }
            let enabled: boolean;
            try {
              enabled = Boolean((JSON.parse(body.text || "{}") as { enabled?: unknown }).enabled);
            } catch {
              sendJson(res, 400, { success: false, error: "Request body must be valid JSON." });
              return;
            }
            store.setSharing(enabled);
            hub.broadcastState();
            sendJson(res, 200, stateFor(device.id));
            // Closing the listener is the last thing that happens, so this answer still reaches the
            // device that asked for it.
            if (!enabled) options.onSharingDisabled?.();
            return;
          }

          if (pathname === "/api/remote/unpair" && method === "POST") {
            store.revoke(device.id);
            hub.removeFor(device.id);
            hub.broadcastState();
            sendJson(res, 200, { success: true });
            return;
          }

          if (pathname === "/api/remote/events" && method === "GET") {
            res.writeHead(200, {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-store, no-transform",
              connection: "keep-alive",
              // Proxies that buffer would defeat the whole point of a stream.
              "x-accel-buffering": "no",
            });
            res.write(": connected\n\n");
            const id = hub.add(res, device.id);
            // `Last-Event-ID` tells us the last revision the client saw. Anything newer is replayed as
            // a change, so a phone that slept through writes catches up on reconnect.
            const lastId = Number(req.headers["last-event-id"] ?? NaN);
            if (Number.isFinite(lastId) && lastId < store.revision()) {
              hub.broadcastChanged(store.revision());
            }
            req.on("close", () => hub.remove(id));
            return;
          }

          sendJson(res, 404, { success: false, error: "Unknown remote route." });
          return;
        }

        // ---------------------------------------------------------------- the app itself
        if (lan && !pathname.startsWith("/api/")) {
          if (method !== "GET" && method !== "HEAD") {
            sendJson(res, 405, { success: false, error: "Only GET is supported here." });
            return;
          }
          serveApp(req, res, url);
          return;
        }

        // ---------------------------------------------------------------- operations
        if (pathname.startsWith("/api/")) {
          if (!underRateLimit(req, limit.max)) {
            sendJson(res, 429, {
              success: false,
              code: "rate-limited",
              error: "Too many requests in a minute. Give it a moment.",
            });
            return;
          }

          if (!lan) {
            const origin = req.headers.origin;
            if (typeof origin === "string" && !loopbackOriginOk(origin, env)) {
              sendJson(res, 403, {
                success: false,
                error: "A page from another site cannot read this career. Open the app itself instead.",
              });
              return;
            }
          }

          const write = isWrite(method, pathname, url.searchParams);
          let deviceId: string | null = null;

          if (lan) {
            const device = store.authenticate(tokenOf(req));
            if (!device) {
              sendJson(res, 401, {
                success: false,
                code: "unpaired",
                error: "This device is not paired with that PC any more. Pair it again from the code on the PC.",
              });
              return;
            }
            deviceId = device.id;
            store.touch(device.id);

            if (write) {
              const lease = store.lease();
              if (!lease) {
                // The first device to write takes the pen. Making that an explicit press would mean a
                // manager cannot type into a note until they have found a button first.
                store.take(device.id);
              } else if (lease.deviceId !== device.id) {
                const holder = store.devices().find((entry) => entry.id === lease.deviceId);
                sendJson(res, 409, {
                  success: false,
                  code: "lease",
                  leaseEpoch: lease.epoch,
                  error: `${holder?.name ?? "Another device"} is editing. Take control to make changes here.`,
                });
                return;
              } else {
                const supplied = Number(req.headers["x-touchline-lease-epoch"]);
                if (Number.isFinite(supplied) && supplied !== lease.epoch) {
                  sendJson(res, 409, {
                    success: false,
                    code: "lease",
                    leaseEpoch: lease.epoch,
                    error: "That screen was open before another device took control. Reload to catch up.",
                  });
                  return;
                }
              }
            }
          } else if (write && req.headers.origin !== undefined && !originAllowed(String(req.headers.origin), env)) {
            // Belt and braces on loopback: the `originAllowed` check above already refused this, but
            // a write is the one thing worth refusing twice.
            sendJson(res, 403, {
              success: false,
              error: "A write from an unrecognised origin is refused. Open the app itself to make changes.",
            });
            return;
          }

          const body = await readBody(req, bodyLimit);
          if (!body.ok) {
            sendJson(res, 413, {
              success: false,
              code: "too-large",
              error: "That request was too large for this PC to accept.",
            });
            return;
          }

          const outcome = await dispatch({
            method,
            path: pathname,
            params: url.searchParams,
            raw: body.text === "" ? null : body.text,
          });

          // The revision moves only on a write that actually succeeded, so a refused or failed call
          // does not make every other device refetch for nothing.
          const changed = write && outcome.status >= 200 && outcome.status < 300;
          if (changed) {
            store.bumpRevision();
            // The device travels with the frame so each client can tell its own write from somebody
            // else's. A screen must not be torn down and rebuilt under the finger that just saved.
            hub.broadcastChanged(store.revision(), deviceId);
            hub.broadcastState();
            options.onWrite?.({ method, path: pathname });
          }

          const payload = JSON.stringify(outcome.body ?? null);
          res.writeHead(outcome.status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(payload),
            ...(deviceId ? { "x-touchline-device-id": deviceId } : {}),
            ...(changed ? { "x-touchline-revision": String(store.revision()) } : {}),
          });
          res.end(payload);
          return;
        }

        sendJson(res, 404, { success: false, error: "Unknown route." });
      } catch (error) {
        console.error("[core] request failed:", error);
        if (!res.headersSent) {
          sendJson(res, 500, { success: false, error: (error as Error).message ?? "The core failed." });
        } else {
          res.end();
        }
      }
    })();
  });


  return {
    server,
    hub,
    stateFor,
    close: async () => {
      hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
