// bridge/bridge-server.ts
import crypto from "node:crypto";
import fs2 from "node:fs";
import http from "node:http";
import os from "node:os";
import path2 from "node:path";

// src/lib/platform/save-source.ts
import fs from "fs";
import path from "path";

// src/lib/parser/bytes.ts
var utf8Encoder = new TextEncoder();
function utf8Bytes(text) {
  return utf8Encoder.encode(text);
}

// src/lib/parser/sha.ts
var HEX = "0123456789abcdef";
function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}
function withPadding(bytes) {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((bytes.length + 8 >> 6) + 1 << 6);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  return padded;
}
var rotl = (value, bits) => value << bits | value >>> 32 - bits;
function sha1(bytes) {
  const padded = withPadding(bytes);
  const view = new DataView(padded.buffer);
  const h = [1732584193, 4023233417, 2562383102, 271733878, 3285377520];
  const w = new Int32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotl(a, 5) + f + e + k + w[i] | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = h[0] + a | 0;
    h[1] = h[1] + b | 0;
    h[2] = h[2] + c | 0;
    h[3] = h[3] + d | 0;
    h[4] = h[4] + e | 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) outView.setUint32(i * 4, h[i] >>> 0, false);
  return out;
}
var SHA256_K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha1Hex(text) {
  return toHex(sha1(utf8Bytes(text)));
}

// src/lib/parser/save-naming.ts
var NON_CAREER_RE = /^(CmPlr|Squads|FutSquads|MatchDay|Settings|Assets|UltimateTeam|FUT|Temp)/i;
var SAVE_EXT_RE = /\.(db|sav|fcsave|fc25|fc26|bin|dat)$/i;
var SLOT_PATTERNS = [
  { re: /^CmMgrC(\d{17})$/i, kind: "manager-career" },
  { re: /^ManagerCareer(\d{8,})$/i, kind: "manager-career" },
  { re: /^Career(\d{8,})$/i, kind: "career" },
  { re: /^CmPlrC?(\d{8,})$/i, kind: "player-career" }
];
function classifySlot(fileName) {
  for (const pattern of SLOT_PATTERNS) {
    const match = pattern.re.exec(fileName);
    if (match) return { kind: pattern.kind, stamp: match[1] };
  }
  if (SAVE_EXT_RE.test(fileName)) return { kind: "database", stamp: null };
  if (/career/i.test(fileName)) return { kind: "career", stamp: null };
  if (/^DATA/i.test(fileName)) return { kind: "database", stamp: null };
  return { kind: "unknown", stamp: null };
}
function looksLikeSaveFile(fileName) {
  if (NON_CAREER_RE.test(fileName)) return false;
  return classifySlot(fileName).kind !== "unknown";
}

// src/lib/platform/save-source.ts
var MAX_SCAN_DEPTH = 3;
var MAX_DIR_ENTRIES = 5e3;
function searchLocations() {
  const env = process.env;
  const home = env.USERPROFILE || env.HOME || "";
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
  const cwd = process.cwd();
  const candidates = [
    [path.join(home, "Documents", "FC 25", "settings"), "FC 25 \xB7 Documents/settings"],
    [
      path.join(home, "OneDrive", "Documents", "FC 25", "settings"),
      "FC 25 \xB7 OneDrive Documents/settings"
    ],
    [path.join(localAppData, "EA SPORTS FC 25"), "FC 25 \xB7 AppData/Local"],
    [path.join(localAppData, "EA SPORTS FC 25", "settings"), "FC 25 \xB7 AppData/Local/settings"],
    [path.join(cwd, "data", "saves"), "workspace \xB7 data/saves"],
    [path.join(localAppData, "EA SPORTS FC 26", "settings"), "FC 26 \xB7 AppData/Local/settings"],
    [path.join(home, "Documents", "FC 26", "settings"), "FC 26 \xB7 Documents/settings"],
    [path.join(roaming, "EA Sports", "FC 25"), "FC 25 \xB7 AppData/Roaming/EA Sports"],
    [path.join(roaming, "EA Sports", "FC 26"), "FC 26 \xB7 AppData/Roaming/EA Sports"]
  ];
  for (const key of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const root = env[key];
    if (!root) continue;
    candidates.push([
      path.join(root, "Documents", "FC 25", "settings"),
      `FC 25 \xB7 ${key}/Documents/settings`
    ]);
    candidates.push([
      path.join(root, "Documents", "FC 26", "settings"),
      `FC 26 \xB7 ${key}/Documents/settings`
    ]);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [dir, label] of candidates) {
    if (!dir || seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    out.push({ path: dir, label, exists: fs.existsSync(dir) });
  }
  return out;
}
function walk(dir, depth, out) {
  if (depth < 0 || out.length >= MAX_DIR_ENTRIES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_DIR_ENTRIES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, depth - 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}
var lastScan = [];
async function detectSaves(saveDirectory) {
  const locations = saveDirectory ? [
    {
      path: path.resolve(saveDirectory),
      label: "explicit path",
      exists: fs.existsSync(path.resolve(saveDirectory))
    }
  ] : searchLocations();
  lastScan = locations;
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (const location of locations) {
    let stat = null;
    try {
      stat = fs.statSync(location.path);
    } catch {
      continue;
    }
    const isFile = stat.isFile();
    const files = isFile ? [location.path] : walk(location.path, MAX_SCAN_DEPTH, []);
    for (const filePath of files) {
      const key = filePath.toLowerCase();
      if (seen.has(key)) continue;
      const fileName = path.basename(filePath);
      if (!isFile && !looksLikeSaveFile(fileName)) continue;
      let fileStat;
      try {
        fileStat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;
      seen.add(key);
      const slot = classifySlot(fileName);
      candidates.push({
        id: sha1Hex(filePath).slice(0, 16),
        filePath,
        fileName,
        lastModified: fileStat.mtime,
        fileSizeBytes: fileStat.size,
        slotKind: slot.kind,
        foundIn: location.label,
        ...slot.stamp ? { slotStamp: slot.stamp } : {}
      });
    }
  }
  return candidates.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
var MAX_SAVE_BYTES = 256 * 1024 * 1024;
async function resolveCandidate(request) {
  if (request.savePath && request.savePath.trim().length > 0) {
    const resolved = path.resolve(request.savePath);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SAVE_BYTES) return null;
      return {
        id: sha1Hex(resolved).slice(0, 16),
        filePath: resolved,
        fileName: path.basename(resolved),
        lastModified: stat.mtime,
        fileSizeBytes: stat.size
      };
    } catch {
      return null;
    }
  }
  if (request.saveId) {
    const detected = await detectSaves();
    return detected.find((save) => save.id === request.saveId) ?? null;
  }
  return null;
}
var saveSource = {
  mode: "folders",
  detectSaves,
  resolveCandidate,
  readBytes: async (candidate) => {
    if (!fs.existsSync(candidate.filePath)) {
      throw new Error(`Save file not found at path: ${candidate.filePath}`);
    }
    return new Uint8Array(fs.readFileSync(candidate.filePath));
  },
  lastScan: () => lastScan,
  // The desktop build can always enumerate the known save locations.
  unavailableReason: () => null,
  // Nothing to remember: this build finds saves by walking its own folders, so there is no picked
  // file to hold on to and no permission to re-establish. Answering `none` is what keeps the UI from
  // offering a "reconnect" control that would have no meaning here.
  rememberedSave: async () => "none",
  reconnectRememberedSave: async () => null,
  forgetRememberedSave: async () => {
  }
};

// bridge/bridge-server.ts
var DEFAULT_PORT = 4977;
var HOST = "127.0.0.1";
var SERVICE = "touchline-bridge";
var VERSION = "1";
var CODE_HEADER = "x-touchline-bridge-code";
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 6;
var CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
var LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
var PAGES_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.pages\.dev$/;
function configuredOrigins(env = process.env) {
  return (env.TOUCHLINE_BRIDGE_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}
function configPath(env = process.env) {
  const override = env.TOUCHLINE_BRIDGE_CONFIG;
  if (override) return path2.resolve(override);
  const base = env.LOCALAPPDATA || path2.join(os.homedir(), ".local", "share");
  return path2.join(base, "TouchlineOS", "bridge.json");
}
function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}
function isValidCode(code) {
  return typeof code === "string" && CODE_PATTERN.test(code);
}
function loadOrCreateConfig(port, env = process.env) {
  const file = configPath(env);
  try {
    const text = fs2.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(text);
    if (isValidCode(raw.code)) return { code: raw.code, port };
  } catch {
  }
  const config = { code: generateCode(), port };
  try {
    fs2.mkdirSync(path2.dirname(file), { recursive: true });
    fs2.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  } catch {
  }
  return config;
}
function codeMatches(supplied, expected) {
  if (!supplied) return false;
  const given = Buffer.from(supplied.trim().toUpperCase(), "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}
function originAllowed(origin, env = process.env) {
  return LOOPBACK_ORIGIN.test(origin) || PAGES_ORIGIN.test(origin) || configuredOrigins(env).includes(origin);
}
function applyCors(req, res, env) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !originAllowed(origin, env)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", CODE_HEADER);
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}
function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
function toWire(candidate) {
  return {
    id: candidate.id,
    fileName: candidate.fileName,
    filePath: candidate.filePath,
    lastModified: candidate.lastModified.toISOString(),
    fileSizeBytes: candidate.fileSizeBytes,
    slotKind: candidate.slotKind,
    foundIn: candidate.foundIn
  };
}
async function handleAuthorised(req, res, url, config) {
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
  if (!codeMatches(typeof supplied === "string" ? supplied : void 0, config.code)) {
    sendJson(res, 401, {
      error: "Pairing code missing or incorrect. Check the code shown by the bridge."
    });
    return;
  }
  try {
    if (pathname === "/saves") {
      const candidates2 = await saveSource.detectSaves();
      sendJson(res, 200, { saves: candidates2.map(toWire) });
      return;
    }
    const id = decodeURIComponent(pathname.slice("/saves/".length));
    const candidates = await saveSource.detectSaves();
    const candidate = candidates.find((entry) => entry.id === id);
    if (!candidate) {
      sendJson(res, 404, { error: "No save with that id. Ask for the list again." });
      return;
    }
    const bytes = await saveSource.readBytes(candidate);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": bytes.byteLength,
      "cache-control": "no-store"
    });
    res.end(Buffer.from(bytes));
  } catch (error) {
    sendJson(res, 500, { error: error.message ?? "Could not read the save file." });
  }
}
function createBridgeServer(config, env = process.env) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const allowed = applyCors(req, res, env);
    if (req.method === "OPTIONS") {
      res.writeHead(allowed ? 204 : 403);
      res.end();
      return;
    }
    if (url.pathname.replace(/\/+$/, "") === "/status") {
      sendJson(res, 200, { service: SERVICE, version: VERSION });
      return;
    }
    void handleAuthorised(req, res, url, config);
  });
}
async function scanSummary() {
  const candidates = await saveSource.detectSaves();
  const locations = saveSource.lastScan().map((entry) => ({
    path: entry.path,
    exists: entry.exists
  }));
  return { locations, candidates: candidates.length };
}

// bridge/touchline-bridge.ts
function parsePortArg() {
  const index = process.argv.indexOf("--port");
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}
async function printBanner(config) {
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
async function main() {
  const port = Number(process.env.TOUCHLINE_BRIDGE_PORT ?? parsePortArg() ?? DEFAULT_PORT);
  const config = loadOrCreateConfig(port);
  const server = createBridgeServer(config);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `
  Port ${port} is already in use.
  If the bridge is already running, just use that one.
  Otherwise start this on another port:  npx tsx bridge/touchline-bridge.ts --port ${port + 1}
`
      );
    } else {
      console.error(`
  The bridge could not start: ${error.message}
`);
    }
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    void printBanner(config);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
