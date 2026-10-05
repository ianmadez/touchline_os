/**
 * Talks to the optional local bridge, browser build only.
 *
 * The bridge is a small program the manager runs on their own machine which serves their save file over
 * `http://127.0.0.1:<port>`. This module owns everything about that conversation: where the pairing
 * details are remembered, how to find out whether a bridge is running, and how to ask it for bytes.
 *
 * ## Why the port is separate from the save source
 *
 * `save-source.browser.ts` is about *which* save the app uses. This is about *whether a bridge exists
 * at all*, which the UI needs to answer independently - to decide whether to offer pairing, to show a
 * "connected" state, or to say plainly that a paired bridge is not running. Folding that into the save
 * source would have made one module answer two different questions.
 *
 * ## Nothing here is attempted unless the manager switched it on
 *
 * Probing localhost on every visit would fire a pointless request for every visitor and would announce
 * "this person has a bridge installed" to anyone able to observe it. So `enabled` gates everything, it
 * defaults to off, and the only thing that turns it on is the manager choosing to pair.
 */
import type { SaveCandidate } from "../parser/interface";
import { DEFAULT_BRIDGE_PORT, type BridgeState } from "./types";

// Re-exported so a caller already importing this module needs only one import site.
export { DEFAULT_BRIDGE_PORT };

/**
 * The pairing details, in their own localStorage key.
 *
 * Its own key rather than part of the session blob, for the same reason the dismissed-cards store has
 * one: the session is rewritten on every tab change, and a rewrite must never be able to drop a pairing
 * the manager has already done.
 */
const BRIDGE_KEY = "touchline.bridge.v1";

/** Long enough for a slow first request, short enough that a dead port does not stall a page load. */
const PROBE_TIMEOUT_MS = 2_500;
const REQUEST_TIMEOUT_MS = 15_000;

export interface BridgeSettings {
  enabled: boolean;
  port: number;
  code: string;
}

// The state vocabulary lives in the port, because the UI has to render it without knowing which runtime
// it is in. Re-exported here so a caller already importing this module needs only one import site.
export type { BridgeState };

const DEFAULTS: BridgeSettings = { enabled: false, port: DEFAULT_BRIDGE_PORT, code: "" };

export function readBridgeSettings(): BridgeSettings {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return DEFAULTS;

  try {
    const raw = JSON.parse(window.localStorage.getItem(BRIDGE_KEY) ?? "{}") as Partial<BridgeSettings>;
    return {
      enabled: raw.enabled === true,
      port:
        typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port > 0
          ? raw.port
          : DEFAULT_BRIDGE_PORT,
      code: typeof raw.code === "string" ? raw.code : "",
    };
  } catch {
    // Unreadable or written by an older version. Treated as "not set up", which is recoverable by
    // pairing again rather than by a migration.
    return DEFAULTS;
  }
}

export function writeBridgeSettings(patch: Partial<BridgeSettings>): BridgeSettings {
  const next = { ...readBridgeSettings(), ...patch };
  try {
    window.localStorage.setItem(BRIDGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked. The pairing then lasts for this page load only, which is still usable.
  }
  return next;
}

/** Where the bridge lives. Loopback, and `127.0.0.1` rather than `localhost` to skip DNS entirely. */
function bridgeUrl(settings: BridgeSettings, path: string): string {
  return `http://127.0.0.1:${settings.port}${path}`;
}

interface RawResponse {
  status: number;
  body: unknown;
  bytes?: Uint8Array;
}

/**
 * One request to the bridge.
 *
 * Returns null when the request could not be made at all - refused, timed out, or blocked by the
 * browser. That is NOT an error state: "nothing is listening" is the ordinary answer when the bridge is
 * not running, and it is reported as such rather than as a failure.
 */
async function request(
  settings: BridgeSettings,
  path: string,
  options: { binary?: boolean; timeoutMs: number }
): Promise<RawResponse | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers: Record<string, string> = {};
    // Sent only when there is one, so a first probe cannot be refused for carrying an empty code.
    if (settings.code) headers["x-touchline-bridge-code"] = settings.code;

    const response = await fetch(bridgeUrl(settings, path), {
      method: "GET",
      headers,
      signal: controller.signal,
      // A bridge response is never worth reusing, and a cached one could hide a newly saved file.
      cache: "no-store",
    });

    if (options.binary) {
      if (!response.ok) return { status: response.status, body: null };
      return {
        status: response.status,
        body: null,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A bridge that answered with something that is not JSON is not a bridge. Reported as no answer
      // by the caller's `service` check.
    }
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Is a bridge actually listening on that port?
 *
 * Checks the service name, not just that something answered. Another program on the same port would
 * otherwise be treated as a bridge and produce confusing failures further down.
 */
export async function isBridgeListening(settings: BridgeSettings): Promise<boolean> {
  const response = await request(settings, "/status", { timeoutMs: PROBE_TIMEOUT_MS });
  if (!response || response.status !== 200) return false;
  return (response.body as { service?: unknown } | null)?.service === "touchline-bridge";
}

/** Maps the bridge's wire shape back into a candidate. Dates do not survive JSON, so they come as ISO. */
function toCandidate(raw: Record<string, unknown>): SaveCandidate | null {
  const { id, fileName, filePath, lastModified, fileSizeBytes } = raw;
  if (typeof id !== "string" || typeof fileName !== "string" || typeof filePath !== "string") {
    return null;
  }

  const modified = new Date(typeof lastModified === "string" ? lastModified : 0);
  return {
    id,
    fileName,
    filePath,
    lastModified: Number.isNaN(modified.getTime()) ? new Date(0) : modified,
    fileSizeBytes: typeof fileSizeBytes === "number" ? fileSizeBytes : 0,
    slotKind: (raw.slotKind as SaveCandidate["slotKind"]) ?? "unknown",
    // Also the marker that says which source produced this candidate: a bridge candidate's bytes come
    // from the bridge, and the save source uses exactly this label to know that.
    foundIn: BRIDGE_LABEL,
  };
}

/** The `foundIn` label for a bridge candidate. Descriptive, and used as the source discriminator. */
export const BRIDGE_LABEL = "local bridge";

/** The saves the bridge can see, or null when it did not answer or refused the code. */
export async function fetchBridgeSaves(
  settings: BridgeSettings
): Promise<{ status: number; saves: SaveCandidate[] } | null> {
  const response = await request(settings, "/saves", { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!response) return null;

  if (response.status !== 200) return { status: response.status, saves: [] };

  const raw = (response.body as { saves?: unknown } | null)?.saves;
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return {
    status: 200,
    saves: rows.map(toCandidate).filter((entry): entry is SaveCandidate => entry !== null),
  };
}

/** One save's bytes, or null when the bridge did not answer or refused. */
export async function fetchBridgeBytes(
  settings: BridgeSettings,
  id: string
): Promise<Uint8Array | null> {
  const response = await request(settings, `/saves/${encodeURIComponent(id)}`, {
    binary: true,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return response?.bytes ?? null;
}

/**
 * The one value the UI needs: is the bridge off, missing, unpaired, or working?
 *
 * Ordered so the cheapest decisive answer wins. Nothing is requested at all when the feature is off,
 * which is the default and therefore the overwhelmingly common case.
 */
export async function bridgeState(
  settings: BridgeSettings = readBridgeSettings()
): Promise<BridgeState> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return "unsupported";
  }
  if (!settings.enabled) return "off";

  if (!(await isBridgeListening(settings))) return "unreachable";

  // Reachable. A code is required to read anything, so an accepted `GET /saves` is the only proof that
  // pairing actually works - checking for the mere presence of a code would call an outdated one paired.
  if (!settings.code) return "needs-code";
  const response = await fetchBridgeSaves(settings);
  if (!response) return "unreachable";
  return response.status === 200 ? "paired" : "needs-code";
}
