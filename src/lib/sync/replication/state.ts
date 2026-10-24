/**
 * One subscribable value for "how is replication doing", for every surface that has to say it.
 *
 * A module-level store rather than a React context, for the same reason `bridge-version.ts` is one: the
 * agent is not a component, it is a timer that runs whether or not a screen is mounted, and the screens
 * that report on it sit in different trees (the landing page, the bridge card, the phone's pill). A
 * context would mean one provider above all of them and a second source of truth in between.
 *
 * The vocabulary is deliberately small. Each phase is a sentence the manager can act on, and nothing here
 * ever claims a sync that has not happened.
 */
import type { SeedComparison } from "./protocol";

export type SyncPhase =
  /** The bridge is off or the page is not paired with one. Nothing is attempted. */
  | "off"
  /** Paired, and the bridge is not answering. Changes wait in the outbox. */
  | "offline"
  /** Paired, reachable, and the two sides disagree about the schema. */
  | "outdated"
  /** Changes are queued or in flight. */
  | "syncing"
  /** The bridge holds revisions this page has not applied yet. */
  | "catching-up"
  /** Applied revision equals the bridge's, and the outbox is empty. */
  | "synced"
  /** The seed was refused because the replica holds something the page does not. */
  | "two-copies";

export interface SyncSnapshot {
  phase: SyncPhase;
  /** Local log entries not yet accepted by the bridge. */
  pending: number;
  /** The bridge's latest revision, as of the last answer. */
  revision: number;
  /** The revision this page has applied. */
  applied: number;
  /** True when this tab is the one running the agent. */
  agent: boolean;
  /** The refusal, when the phase is `two-copies`. */
  conflict: SeedComparison | null;
  /** Why the last attempt failed, when there is something to say. */
  error: string | null;
}

const INITIAL: SyncSnapshot = {
  phase: "off",
  pending: 0,
  revision: 0,
  applied: 0,
  agent: false,
  conflict: null,
  error: null,
};

let snapshot: SyncSnapshot = INITIAL;
const listeners = new Set<() => void>();

export function readSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function setSyncSnapshot(patch: Partial<SyncSnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (
    next.phase === snapshot.phase &&
    next.pending === snapshot.pending &&
    next.revision === snapshot.revision &&
    next.applied === snapshot.applied &&
    next.agent === snapshot.agent &&
    next.conflict === snapshot.conflict &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resets everything, for when the bridge is unpaired or the page is going away. */
export function resetSyncSnapshot(): void {
  setSyncSnapshot(INITIAL);
}

/** The one line a screen shows. Never claims more than the last answer supports. */
export function describeSync(snapshot: SyncSnapshot): string {
  switch (snapshot.phase) {
    case "off":
      return "";
    case "offline":
      return snapshot.pending > 0
        ? `This PC is not reachable. ${snapshot.pending} change${snapshot.pending === 1 ? "" : "s"} waiting to send.`
        : "This PC is not reachable. Everything is saved here, and it syncs when the PC is back.";
    case "outdated":
      return "This bridge is older than the web page. Update the bridge to sync.";
    case "catching-up": {
      const behind = Math.max(0, snapshot.revision - snapshot.applied);
      return `Catching up (${behind} change${behind === 1 ? "" : "s"}).`;
    }
    case "syncing":
      return snapshot.pending > 0
        ? `Sending ${snapshot.pending} change${snapshot.pending === 1 ? "" : "s"}…`
        : "Syncing…";
    case "synced":
      return snapshot.agent
        ? "Synced with this PC."
        : "Synced. Another tab is doing the syncing.";
    case "two-copies":
      return "This PC already has a different copy of this career. Choose which one to keep.";
    default:
      return "";
  }
}
