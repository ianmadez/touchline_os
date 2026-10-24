/**
 * The page's five calls to the bridge's replication routes.
 *
 * Deliberately thin: the port and the pairing code come from the same localStorage record the save
 * bridge already uses, so a manager who has paired a bridge has paired this too. Nothing here decides
 * anything - the agent does that - and nothing here throws: "no answer" is an ordinary state when the
 * bridge window is closed, and it is reported as null rather than as an exception, because a page that
 * throws every two seconds because a PC is asleep is a page that is hard to debug.
 */
import { readBridgeSettings } from "../../platform/bridge-client.browser";
import type {
  PullReply,
  PushReply,
  PushRequest,
  ReseedReply,
  SeedReply,
  SyncStatusReply,
} from "./protocol";

/** Long enough for a slow first answer, short enough that a dead port does not stall a flush. */
const CALL_TIMEOUT_MS = 20_000;

/** A career package is megabytes. The seed gets its own, longer, patience. */
const SEED_TIMEOUT_MS = 120_000;

const CLIENT_KEY = "touchline.sync.client.v1";

/**
 * This browser's identity for replication.
 *
 * Stable across reloads, so the bridge can recognise a push it has already accepted after the page was
 * refreshed mid-flush. Generated once and kept; a regenerated id would only cost a duplicate apply, which
 * is harmless, but a stable one makes `_sync_push_seq` actually do its job.
 */
export function syncClientId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(CLIENT_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_KEY, created);
    return created;
  } catch {
    return "unidentified";
  }
}

interface Answer<T> {
  status: number;
  body: T | null;
}

async function call<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}
): Promise<Answer<T> | null> {
  if (typeof window === "undefined") return null;
  const settings = readBridgeSettings();
  if (!settings.enabled || !settings.code) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? CALL_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${settings.port}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "x-touchline-bridge-code": settings.code,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });

    let body: T | null = null;
    try {
      body = (await response.json()) as T;
    } catch {
      // Not JSON. The status alone is still worth returning; the caller treats a bad body as no body.
    }
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** What the bridge holds for a career, or null when it did not answer. */
export async function syncStatus(careerId: string): Promise<SyncStatusReply | null> {
  const answer = await call<SyncStatusReply>(
    `/sync/status?careerId=${encodeURIComponent(careerId)}`
  );
  return answer?.status === 200 ? answer.body : null;
}

/** Sends the page's whole career. The bridge decides whether it may replace its own copy. */
export async function seedCareer(
  careerId: string,
  pkg: unknown
): Promise<{ status: number; body: SeedReply | null } | null> {
  return call<SeedReply>("/sync/seed", {
    method: "POST",
    body: { careerId, package: pkg },
    timeoutMs: SEED_TIMEOUT_MS,
  });
}

export type PushOutcome =
  | { kind: "accepted"; reply: PushReply }
  /** The bridge has changes this page has not applied. Pull first, then send again. */
  | { kind: "stale"; revision: number }
  /** The bridge does not hold this career, so there is nothing to push into. */
  | { kind: "unseeded" }
  /**
   * The bridge holds this career but cannot write what was sent, and no retry will change that.
   *
   * The two copies disagree in a way that no single row can fix, so the answer is the one the model
   * gives everywhere else: this browser's copy is the main one, and the PC's copy is replaced from it.
   */
  | { kind: "unappliable"; detail: string }
  | { kind: "unreachable" };

export async function pushChanges(request: PushRequest): Promise<PushOutcome> {
  const answer = await call<PushReply & { code?: string; detail?: string }>("/sync/push", {
    method: "POST",
    body: request,
  });
  if (!answer) return { kind: "unreachable" };
  if (answer.status === 409) {
    if (answer.body?.code === "unseeded") return { kind: "unseeded" };
    if (answer.body?.code === "unappliable") {
      return { kind: "unappliable", detail: answer.body.detail ?? "" };
    }
    return { kind: "stale", revision: answer.body?.revision ?? 0 };
  }
  if (answer.status !== 200 || !answer.body) return { kind: "unreachable" };
  return { kind: "accepted", reply: answer.body };
}

export async function pullChanges(
  careerId: string,
  since: number,
  clientId: string
): Promise<PullReply | null> {
  const answer = await call<PullReply>(
    `/sync/pull?careerId=${encodeURIComponent(careerId)}&since=${since}&clientId=${encodeURIComponent(clientId)}`
  );
  return answer?.status === 200 ? answer.body : null;
}

/** Replaces one side on purpose, after the manager has chosen on the Two copies screen. */
export async function reseed(
  careerId: string,
  direction: "page-to-pc" | "pc-to-page",
  pkg?: unknown
): Promise<ReseedReply | null> {
  const answer = await call<ReseedReply>("/sync/reseed", {
    method: "POST",
    body: { careerId, direction, package: pkg },
    timeoutMs: SEED_TIMEOUT_MS,
  });
  return answer?.status === 200 ? answer.body : null;
}
