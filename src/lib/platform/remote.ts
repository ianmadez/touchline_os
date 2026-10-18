/**
 * The remote port, local Node build: inert by construction.
 *
 * The remote layer exists so a phone can reach the career that lives on the PC. When this app is the
 * PC - `npm run dev`, or the desktop build - there is nothing remote to talk to: the database is
 * right here and the operations run in this process. Every export therefore reports "not remote" and
 * returns empty, so a screen can render in both builds without asking which one it is in.
 *
 * The browser twin (`remote.browser.ts`) is the real implementation. It is chosen by file suffix at
 * build time, so no runtime branch is involved and the Node bundle never carries an EventSource.
 *
 * The signatures here deliberately mirror the browser twin's, parameters and all. TypeScript resolves
 * an extensionless import to this file, so a screen calling `pairWithBridge(code, name)` is checked
 * against these declarations; if they took fewer arguments the shared components would not compile.
 */
import type { RemoteState } from "@/lib/remote/protocol";

export const REMOTE_SUPPORTED = false;

export function isRemoteRuntime(): boolean {
  return false;
}

export function remoteInit(init?: RequestInit): RequestInit {
  return init ?? {};
}

export function readRemoteSession(): null {
  return null;
}

export function remoteDeviceToken(): string {
  return "";
}

export function currentDeviceName(): string {
  return "";
}

export async function fetchRemoteState(): Promise<RemoteState | null> {
  return null;
}

export type RemoteReach = "paired" | "unpaired" | "offline";

export async function probeRemote(): Promise<{ reach: RemoteReach; state: RemoteState | null }> {
  return { reach: "offline", state: null };
}

export async function sendHeartbeat(): Promise<void> {
  // Nothing is remote, so there is no core to keep alive.
}

const LOCAL_ONLY = "This build runs on the PC itself, so there is nothing to pair with.";

/**
 * The no-op implementations are typed constants rather than functions with ignored parameters.
 *
 * TypeScript lets a function with fewer parameters be assigned to a wider signature, so each of these
 * reports "not remote" while still accepting the arguments the shared screens pass - and no parameter
 * exists to be unused.
 */
type PairResult = { ok: true; state: RemoteState } | { ok: false; error: string };

export const pairWithBridge: (
  code?: string,
  deviceName?: string
) => Promise<PairResult> = async () => ({ ok: false, error: LOCAL_ONLY });

export async function takeControl(): Promise<PairResult> {
  return { ok: false, error: LOCAL_ONLY };
}

export async function releaseControl(): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: LOCAL_ONLY };
}

export const revokeDevice: (id?: string) => Promise<PairResult> = async () => ({
  ok: false,
  error: LOCAL_ONLY,
});

export const setSharing: (enabled?: boolean) => Promise<PairResult> = async () => ({
  ok: false,
  error: LOCAL_ONLY,
});

export async function forgetRemoteSession(): Promise<void> {
  // Nothing is stored, so there is nothing to forget.
}

export interface RemoteSubscription {
  /** Cancels the stream and any fallback timer. */
  close: () => void;
}

export interface RemoteSubscriberHandlers {
  onState?: (state: RemoteState) => void;
  /** `by` is the device that made the write, or null when the PC itself did. */
  onDataChanged?: (revision: number, by: string | null) => void;
  onDegraded?: () => void;
}

export const POLL_FALLBACK_MS = 30_000;

export const subscribeRemote: (handlers?: RemoteSubscriberHandlers) => RemoteSubscription = () => ({
  close: () => {},
});

export const announceLeaseRefusal: (state: { message: string; leaseEpoch?: number }) => void = () => {
  // Nothing is remote, so nothing can be refused for holding the wrong pen.
};
