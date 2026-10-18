/**
 * The remote port, browser build: the whole phone side of the pairing.
 *
 * A page served by the TouchlineOS core is not a static export with data baked in - it is a client of
 * the PC in front of it. This module is everything that client needs: does this page belong to a core
 * (`isRemoteRuntime`), what is the device token, how does it pair, what is the core's state, and how
 * does it hear about changes without polling every screen.
 *
 * Two decisions worth knowing about:
 *
 * - **The token travels in a header, and the cookie is a second key.** The core sets an HttpOnly
 *   cookie at pairing so that `EventSource`, which cannot send headers, still authenticates. Ordinary
 *   calls send the header as well, so a browser that drops the cookie keeps working.
 * - **Nothing here runs during render.** Every export touches `document`, `localStorage`, `fetch` or
 *   `EventSource`, and a static export is prerendered on a machine that has none of them. Screens ask
 *   `isRemoteRuntime()` inside an effect and hold the answer in state, so the server-rendered markup
 *   and the first client render agree.
 */
import {
  REMOTE_DATA_EVENT,
  REMOTE_LEASE_EVENT,
  REMOTE_MARKER_META,
  REMOTE_STORAGE_KEY,
  REMOTE_TOKEN_HEADER,
  type RemoteState,
} from "@/lib/remote/protocol";

export const REMOTE_SUPPORTED = true;

interface Session {
  token: string;
  deviceId: string;
  name: string;
  /** The origin it was paired against, so a token is never sent to a different core. */
  url: string;
}

let markerCache: boolean | null = null;

/** True when this page was served by the core: the marker is injected into the document head. */
export function isRemoteRuntime(): boolean {
  if (typeof document === "undefined") return false;
  if (markerCache === null) {
    markerCache = document.querySelector(`meta[name="${REMOTE_MARKER_META}"]`) !== null;
  }
  return markerCache;
}

export function readRemoteSession(): Session | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(REMOTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    // A token paired to another origin is not this origin's token. Refusing it is what stops a stale
    // local build (localhost:3000) from sending its secret to whatever now serves the page.
    if (typeof parsed.url === "string" && typeof location !== "undefined" && parsed.url !== location.origin) {
      return null;
    }
    return {
      token: parsed.token,
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : "",
      name: typeof parsed.name === "string" ? parsed.name : "",
      url: typeof parsed.url === "string" ? parsed.url : location.origin,
    };
  } catch {
    return null;
  }
}

function writeSession(session: Session): void {
  try {
    localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private mode with storage disabled: the pairing still holds for this page load, because the
    // cookie the core set is doing the work. The next load will ask again.
  }
}

/** The token, for callers that are not `apiFetch` (the event stream, mostly). */
export function remoteDeviceToken(): string {
  return readRemoteSession()?.token ?? "";
}

/** Adds the device header to a request the app is already making. */
export function remoteInit(init?: RequestInit): RequestInit {
  const token = remoteDeviceToken();
  if (!token) return init ?? {};
  const headers = new Headers(init?.headers);
  headers.set(REMOTE_TOKEN_HEADER, token);
  return { ...init, headers };
}

/** A name the PC can show in its device list. Browser and platform, nothing cleverer than that. */
export function currentDeviceName(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const phone = /iPhone|Android.*Mobile|Windows Phone/i.test(ua);
  const tablet = /iPad|Android/i.test(ua);
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? "iPhone"
    : /Android/i.test(ua)
      ? "Android"
      : /Macintosh/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "Browser";
  return `${platform} ${phone ? "phone" : tablet ? "tablet" : "device"}`;
}

function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const candidate = body as { error?: unknown; message?: unknown };
    if (typeof candidate.error === "string" && candidate.error) return candidate.error;
    if (typeof candidate.message === "string" && candidate.message) return candidate.message;
  }
  return fallback;
}

async function jsonRequest(
  path: string,
  init: RequestInit
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; status: number }> {
  try {
    const response = await fetch(path, { ...remoteInit(init), cache: "no-store" });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: errorText(parsed, `The PC answered ${response.status}.`),
      };
    }
    return { ok: true, body: parsed };
  } catch (error) {
    return { ok: false, status: 0, error: (error as Error).message || "The PC could not be reached." };
  }
}

export async function pairWithBridge(
  code: string,
  deviceName: string
): Promise<{ ok: true; state: RemoteState } | { ok: false; error: string }> {
  const result = await jsonRequest("/api/remote/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: deviceName }),
  });
  if (!result.ok) return { ok: false, error: result.error };

  const body = result.body as { token?: unknown; deviceId?: unknown; state?: RemoteState } | null;
  if (!body || typeof body.token !== "string" || !body.token) {
    return { ok: false, error: "The PC did not hand back a device token." };
  }
  writeSession({
    token: body.token,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : "",
    name: deviceName,
    url: location.origin,
  });
  return { ok: true, state: (body.state ?? null) as RemoteState };
}

export async function fetchRemoteState(): Promise<RemoteState | null> {
  if (!isRemoteRuntime()) return null;
  const result = await jsonRequest("/api/remote/state", { method: "GET" });
  return result.ok ? ((result.body as RemoteState) ?? null) : null;
}

export type RemoteReach = "paired" | "unpaired" | "offline";

/**
 * What this page's relationship with the core currently is.
 *
 * Three answers rather than two, because "the core says no" and "the core is not there" need different
 * sentences and different control: the first shows a pairing screen, the second says the PC is asleep.
 */
export async function probeRemote(): Promise<{ reach: RemoteReach; state: RemoteState | null }> {
  if (!isRemoteRuntime()) return { reach: "offline", state: null };
  const result = await jsonRequest("/api/remote/state", { method: "GET" });
  if (result.ok) return { reach: "paired", state: (result.body as RemoteState) ?? null };
  if (result.status === 401) return { reach: "unpaired", state: null };
  return { reach: "offline", state: null };
}

/** Tells the core somebody is looking at this page, so the pen is not released under them. */
export async function sendHeartbeat(): Promise<void> {
  if (!isRemoteRuntime() || readRemoteSession() === null) return;
  try {
    await fetch("/api/remote/heartbeat", { ...remoteInit({ method: "POST" }), cache: "no-store" });
  } catch {
    // A missed heartbeat costs nothing: the pen only expires after five quiet minutes.
  }
}

export async function takeControl(): Promise<{ ok: true; state: RemoteState } | { ok: false; error: string }> {
  const result = await jsonRequest("/api/remote/lease", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ take: true }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, state: result.body as RemoteState };
}

export async function releaseControl(): Promise<{ ok: boolean; error?: string }> {
  const result = await jsonRequest("/api/remote/lease", { method: "DELETE" });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function revokeDevice(id: string): Promise<{ ok: true; state: RemoteState } | { ok: false; error: string }> {
  const result = await jsonRequest(`/api/remote/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, state: result.body as RemoteState };
}

export async function setSharing(enabled: boolean): Promise<{ ok: true; state: RemoteState } | { ok: false; error: string }> {
  const result = await jsonRequest("/api/remote/sharing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, state: result.body as RemoteState };
}

/**
 * Unpairs this device.
 *
 * The local record is cleared whatever the answer is. A phone that could not reach the PC would
 * otherwise be stuck on a pairing it cannot use and cannot remove, which is the worst of both.
 */
export async function forgetRemoteSession(): Promise<void> {
  await jsonRequest("/api/remote/unpair", { method: "POST" });
  try {
    localStorage.removeItem(REMOTE_STORAGE_KEY);
  } catch {
    // Nothing stored, or storage disabled - both leave the page in the state the caller wants.
  }
}

export interface RemoteSubscription {
  /** Cancels the stream and any fallback timer. */
  close: () => void;
}

export interface RemoteSubscriberHandlers {
  onState?: (state: RemoteState) => void;
  /**
   * `by` is the device that made the write, or null when it came from the PC itself (the save watcher,
   * mostly). A client uses it to tell its own writes from somebody else's.
   */
  onDataChanged?: (revision: number, by: string | null) => void;
  /** The stream dropped; polling has taken over. */
  onDegraded?: () => void;
}

/** How often the poll fallback asks, when the event stream is unavailable. */
export const POLL_FALLBACK_MS = 30_000;

/**
 * Subscribes to the core's changes.
 *
 * `EventSource` first, because it is one connection and the core knows exactly when something changed.
 * A 30 second poll takes over if the stream cannot be established - a proxy that buffers, a browser
 * with the stream blocked, a core restarted underneath it - because "the phone never updates" is a
 * worse failure than "the phone updates slowly".
 */
export function subscribeRemote(handlers: RemoteSubscriberHandlers): RemoteSubscription {
  if (!isRemoteRuntime() || typeof EventSource === "undefined") return { close: () => {} };

  let closed = false;
  let source: EventSource | null = null;
  let timer: number | null = null;
  let retry: number | null = null;
  let lastRevision = -1;

  const poll = async () => {
    const next = await fetchRemoteState();
    if (closed || !next) return;
    handlers.onState?.(next);
    if (next.revision !== lastRevision) {
      const first = lastRevision === -1;
      lastRevision = next.revision;
      if (!first) {
        // A poll cannot say who wrote, so it is reported as somebody else's. Re-reading is the safe
        // assumption; the alternative is a screen that quietly shows data the PC no longer has.
        handlers.onDataChanged?.(next.revision, null);
        window.dispatchEvent(new CustomEvent(REMOTE_DATA_EVENT, { detail: next.revision }));
      }
    }
  };

  const startPolling = () => {
    if (closed || timer !== null) return;
    handlers.onDegraded?.();
    void poll();
    timer = window.setInterval(() => void poll(), POLL_FALLBACK_MS);
  };

  const connect = () => {
    if (closed) return;
    const next = new EventSource("/api/remote/events");
    source = next;

    next.addEventListener("state", (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as RemoteState;
        if (next.revision !== lastRevision && lastRevision !== -1) {
          handlers.onDataChanged?.(next.revision, null);
          window.dispatchEvent(new CustomEvent(REMOTE_DATA_EVENT, { detail: next.revision }));
        }
        lastRevision = next.revision;
        handlers.onState?.(next);
      } catch {
        // A malformed frame is dropped rather than thrown: the next one is a whole state anyway.
      }
    });

    next.addEventListener("open", () => {
      // The stream recovered, so the timer is no longer needed.
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    });

    next.addEventListener("error", () => {
      // EventSource retries on its own, but a hard failure (a 401 after a revoke, or a core that is
      // gone) never recovers, and the screen would sit on stale data forever.
      next.close();
      source = null;
      startPolling();
      retry = window.setTimeout(connect, POLL_FALLBACK_MS);
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      source?.close();
      source = null;
      if (timer !== null) window.clearInterval(timer);
      if (retry !== null) window.clearTimeout(retry);
      timer = null;
      retry = null;
    },
  };
}

/** Announced by `apiFetch` when the core refuses a write because another device holds the pen. */
export function announceLeaseRefusal(state: { message: string; leaseEpoch?: number }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REMOTE_LEASE_EVENT, { detail: state }));
}
