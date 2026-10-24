/**
 * The page's replicator: the one tab that keeps the bridge's copy in step with this browser.
 *
 * This is the only place in the page that talks to `/sync/*`, and it exists because the two halves of a
 * sync are different questions. Pushing is a flush of an outbox the triggers already filled, and it must
 * happen within half a second of a write. Pulling is a poll, because the bridge will not hold a stream
 * open for a page. Both live on one timer so there is one place where "what is due" is decided.
 *
 * ## One tab
 *
 * Two tabs syncing would push the same outbox twice, from two in-memory databases that are only flushed
 * to OPFS every 750 ms. That is not a merge problem, it is a corruption problem, so the work is claimed
 * with a Web Lock: the tab that gets `touchline.sync.agent` runs it, the others say "another tab is
 * doing the syncing" and change nothing. `BroadcastChannel` is not needed for correctness, only for the
 * odd browser without Web Locks, and there the claim is a localStorage lease with a heartbeat.
 *
 * ## Why the outbox needs no separate storage
 *
 * The `_sync_log` table IS the outbox, and it is in the OPFS image with everything else. A page that is
 * closed mid-flush therefore resumes with its queue intact, and `_sync_push_seq` on the bridge makes a
 * re-sent batch a no-op rather than a duplicate.
 *
 * ## Drift
 *
 * Every minute the two sides compare row counts and content hashes. They can only disagree after
 * something that is not replication has written to one side, so the answer is not to merge but to make
 * one side equal to the other: this page is the source of truth for a PAGE career, so it reseeds the
 * replica, which snapshots it first.
 */
import { sql } from "drizzle-orm";
import { storage } from "../../platform/storage";
import { readBridgeSettings } from "../../platform/bridge-client.browser";
import { isRemoteRuntime } from "../../platform/remote";
import {
  buildTransferPackage,
  importTransferPackage,
} from "../../services/career-transfer-service";
import { applyBatch, toDelta } from "./apply";
import {
  ackChanges,
  clearBulkDirty,
  clearCareerLedger,
  deltasFor,
  dirtyBulkTables,
  pendingCount,
  readMeta,
  readTable,
  rowCounts,
  tableHash,
  writeMeta,
} from "./ledger";
import { pullChanges, pushChanges, reseed, seedCareer, syncClientId, syncStatus } from "./client";
import { BULK_TABLES, DELTA_TABLES } from "./tables";
import { setSyncSnapshot, readSyncSnapshot } from "./state";
import { pickActiveCareer } from "../../career-selection";

/** Short enough that a write is on the other device well inside the three second target. */
const TICK_MS = 500;

/** The pull poll. Only while the tab is visible: a background tab has nothing to redraw. */
const PULL_EVERY_MS = 2_000;

/** The drift check, and also the recovery path after a reconnect. */
const DRIFT_EVERY_MS = 60_000;

/** The Web Lock every tab competes for. */
const AGENT_LOCK = "touchline.sync.agent";

/** The fallback lease, for a browser without Web Locks. */
const LEADER_KEY = "touchline.sync.leader.v1";
const LEADER_STALE_MS = 5_000;

/** Announced after remote rows land, so the screens refetch the way they do for a remote change. */
export const DATA_CHANGED_EVENT = "touchline:data-changed";

function appliedKey(careerId: string): string {
  return `applied:${careerId}`;
}

function seededKey(careerId: string): string {
  return `seeded:${careerId}`;
}

function appliedRevision(careerId: string): number {
  const raw = readMeta(appliedKey(careerId));
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function setAppliedRevision(careerId: string, revision: number): void {
  writeMeta(appliedKey(careerId), String(revision));
  setSyncSnapshot({ applied: revision });
}

/** The career this database opens, by the same rule the app uses: newest that can be managed. */
export function currentCareerId(): string | null {
  const rows = storage.db.all<{ id: string; squadSize: number }>(
    sql`SELECT c.id AS id,
               (SELECT COUNT(*) FROM players p WHERE p.career_id = c.id) AS squadSize
          FROM careers c
      ORDER BY c.updated_at DESC`
  );
  return pickActiveCareer(rows, (row) => Number(row.squadSize))?.id ?? null;
}

// ---------------------------------------------------------------- one tab

let running: { careerId: string; stop: () => void } | null = null;

/** Bounds how often the cheap check below can touch the database. */
let lastAttempt = 0;

interface LeaderRecord {
  id: string;
  at: number;
}

function readLeader(): LeaderRecord | null {
  try {
    const raw = window.localStorage.getItem(LEADER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeaderRecord>;
    if (typeof parsed.id !== "string" || typeof parsed.at !== "number") return null;
    return { id: parsed.id, at: parsed.at };
  } catch {
    return null;
  }
}

function writeLeader(id: string): void {
  try {
    window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Storage blocked. The claim then lasts for this page load, which is still correct - it just cannot
    // be honoured across tabs, and that is the same situation as having no Web Locks at all.
  }
}

function releaseLeader(id: string): void {
  if (readLeader()?.id === id) {
    try {
      window.localStorage.removeItem(LEADER_KEY);
    } catch {
      // Nothing to do: the record goes stale on its own within five seconds.
    }
  }
}

// ---------------------------------------------------------------- the loop

/** True when this database has applied everything the bridge has, and nothing is waiting to go out. */
function settle(): void {
  const now = readSyncSnapshot();
  if (now.phase === "two-copies" || now.phase === "outdated" || now.phase === "off") return;
  setSyncSnapshot({ phase: now.applied >= now.revision ? "synced" : "catching-up" });
}

async function flush(careerId: string, clientId: string): Promise<"ok" | "stale" | "offline"> {
  const queued = pendingCount(careerId);
  const dirty = dirtyBulkTables(careerId);
  if (queued === 0 && dirty.length === 0) {
    setSyncSnapshot({ pending: 0 });
    settle();
    return "ok";
  }

  setSyncSnapshot({ phase: "syncing", pending: queued });
  const deltas = deltasFor(careerId);
  const bulk = dirty.map((table) => ({
    table,
    hash: tableHash(table, careerId),
    rows: readTable(table, careerId),
  }));

  const outcome = await pushChanges({
    careerId,
    clientId,
    baseRevision: appliedRevision(careerId),
    deltas,
    bulk,
  });

  if (outcome.kind === "unreachable") {
    setSyncSnapshot({ phase: "offline", pending: queued });
    return "offline";
  }
  if (outcome.kind === "unseeded") {
    await seed(careerId, true);
    return "stale";
  }
  if (outcome.kind === "stale") {
    setSyncSnapshot({ phase: "catching-up", revision: outcome.revision });
    return "stale";
  }

  ackChanges(outcome.reply.ackedSeq);
  if (bulk.length > 0) {
    clearBulkDirty(
      careerId,
      bulk.map((block) => block.table)
    );
  }
  // The bridge applied exactly what was sent and numbered it, so this database is now at that revision.
  setAppliedRevision(careerId, outcome.reply.revision);
  setSyncSnapshot({ phase: "synced", pending: pendingCount(careerId), revision: outcome.reply.revision });
  return "ok";
}

async function pull(careerId: string, clientId: string): Promise<"ok" | "offline"> {
  const since = appliedRevision(careerId);
  const reply = await pullChanges(careerId, since, clientId);
  if (!reply) {
    setSyncSnapshot({ phase: "offline" });
    return "offline";
  }

  const changed = reply.deltas.length > 0 || reply.bulk.length > 0;
  if (changed) {
    applyBatch(careerId, reply.deltas.map(toDelta), reply.bulk);
  }
  setAppliedRevision(careerId, reply.revision);
  setSyncSnapshot({ revision: reply.revision });
  settle();

  if (changed) {
    // The screens already know how to refetch when somebody else's change lands: they listen for this.
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: reply.revision }));
  }
  return "ok";
}

/** Sends this page's whole career, and records that it did. */
async function seed(careerId: string, force: boolean): Promise<boolean> {
  if (!force && readMeta(seededKey(careerId))) return true;

  const pkg = await buildTransferPackage(careerId);
  if (!pkg) return false;

  const answer = await seedCareer(careerId, pkg);
  if (!answer) {
    setSyncSnapshot({ phase: "offline" });
    return false;
  }

  if (answer.status === 409 && answer.body?.result === "conflict") {
    setSyncSnapshot({ phase: "two-copies", conflict: answer.body.comparison ?? null });
    return false;
  }
  if (answer.status !== 200) {
    setSyncSnapshot({
      phase: "offline",
      error: (answer.body as { error?: string } | null)?.error ?? null,
    });
    return false;
  }

  writeMeta(seededKey(careerId), new Date().toISOString());
  setSyncSnapshot({ conflict: null });

  // The packages now match, whatever the bridge's journal says, so this database is at its revision.
  const status = await syncStatus(careerId);
  setAppliedRevision(careerId, status?.revision ?? 0);
  return true;
}

/**
 * Compares the two sides, and makes them equal if they are not.
 *
 * Catch up first: a bridge that has journalled a phone write and not yet been pulled looks drifted from
 * here, and reseeding on that would throw away a good replica for no reason.
 */
async function driftCheck(careerId: string, clientId: string): Promise<void> {
  let status = await syncStatus(careerId);
  if (!status) {
    setSyncSnapshot({ phase: "offline" });
    return;
  }

  if (status.revision > appliedRevision(careerId)) {
    await pull(careerId, clientId);
    // A fresh answer, because the pull above has just changed what this side holds.
    status = await syncStatus(careerId);
    if (!status) return;
  }

  const local = rowCounts(careerId);
  let same = DELTA_TABLES.every((table) => (local[table] ?? 0) === (status.counts[table] ?? 0));
  if (same) {
    for (const table of [...DELTA_TABLES, ...BULK_TABLES]) {
      if (tableHash(table, careerId) !== status.hashes[table]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;

  const pkg = await buildTransferPackage(careerId);
  if (!pkg) return;
  const reply = await reseed(careerId, "page-to-pc", pkg);
  if (!reply) {
    setSyncSnapshot({ phase: "offline" });
    return;
  }
  // The bridge now holds exactly this career. Anything still in the outbox is already part of it, so
  // pushing it again is harmless and keeping it is safer than dropping a write that happened mid-reseed.
  setAppliedRevision(careerId, reply.revision);
  setSyncSnapshot({ phase: "synced", revision: reply.revision });
}

async function runLoop(careerId: string, signal: AbortSignal): Promise<void> {
  const clientId = syncClientId();
  let busy = false;
  let lastPull = 0;
  // Not zero: the first tick would otherwise treat a drift check as overdue and compare (and possibly
  // reseed) the moment the seed finished, which is exactly when the two sides are known to agree.
  let lastDrift = Date.now();

  const tick = async (): Promise<void> => {
    if (busy || signal.aborted) return;
    busy = true;
    try {
      const outcome = await flush(careerId, clientId);
      if (outcome === "stale") {
        // The bridge is ahead. Pulling now is what makes the retry send current row values.
        await pull(careerId, clientId);
        lastPull = Date.now();
      }

      const now = Date.now();
      if (now - lastPull >= PULL_EVERY_MS && document.visibilityState === "visible") {
        lastPull = now;
        await pull(careerId, clientId);
      }
      if (now - lastDrift >= DRIFT_EVERY_MS) {
        lastDrift = now;
        await driftCheck(careerId, clientId);
      }
    } catch (error) {
      // A failed round trip is not a reason to stop replicating: the next tick tries again, and the
      // outbox is untouched by anything that threw.
      console.warn(`[sync] a replication pass failed: ${(error as Error)?.name ?? "Error"}: ${(error as Error)?.message ?? String(error)}`);
      setSyncSnapshot({ phase: "offline" });
    } finally {
      busy = false;
    }
  };

  // The seed has to happen before the first flush: there is nothing to push into yet.
  try {
    await seed(careerId, false);
  } catch (error) {
    // Silence here would look exactly like "the bridge is not there", which is a different problem.
    console.warn(`[sync] the seed failed: ${(error as Error)?.name ?? "Error"}: ${(error as Error)?.message ?? String(error)}`);
    setSyncSnapshot({ phase: "offline", error: (error as Error).message });
  }

  const timer = window.setInterval(() => void tick(), TICK_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush(careerId, clientId);
  };
  const onPageHide = () => void flush(careerId, clientId);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      resolve();
    };
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

async function claim(careerId: string, signal: AbortSignal): Promise<void> {
  try {
    await claimInner(careerId, signal);
  } catch (error) {
    if (!signal.aborted) {
      console.warn(`[sync] the replication agent stopped: ${(error as Error)?.name ?? "Error"}: ${(error as Error)?.message ?? String(error)}`);
      setSyncSnapshot({ phase: "offline", error: (error as Error).message });
    }
  }
}

async function claimInner(careerId: string, signal: AbortSignal): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    try {
      // No `signal` here: Firefox refuses `ifAvailable` and `signal` together, and aborting is not needed
      // anyway - the loop resolves as soon as the signal fires, which releases the lock.
      await navigator.locks.request(AGENT_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock || signal.aborted) {
          setSyncSnapshot({ agent: false });
          settle();
          return;
        }
        setSyncSnapshot({ agent: true });
        await runLoop(careerId, signal);
      });
    } catch (error) {
      // Aborting is the ordinary way this ends; anything else is worth saying out loud.
      if (!signal.aborted) throw error;
    }
    return;
  }

  const me = syncClientId();
  const leader = readLeader();
  const fresh = leader !== null && Date.now() - leader.at < LEADER_STALE_MS;
  if (fresh && leader.id !== me) {
    setSyncSnapshot({ agent: false });
    settle();
    return;
  }
  writeLeader(me);
  setSyncSnapshot({ agent: true });
  const beat = window.setInterval(() => writeLeader(me), LEADER_STALE_MS / 2);
  try {
    await runLoop(careerId, signal);
  } finally {
    window.clearInterval(beat);
    releaseLeader(me);
  }
}

/**
 * Starts replicating this career, replacing any agent already running on this tab.
 *
 * Returns a stop function. Called from the pairing flows and from the first API call of the page, so a
 * paired bridge starts syncing without the manager having to do anything after pairing.
 */
export function startAgent(careerId: string): () => void {
  if (typeof window === "undefined") return () => {};
  if (running?.careerId === careerId) return running.stop;

  running?.stop();

  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    if (running?.careerId === careerId) running = null;
    setSyncSnapshot({ agent: false });
  };
  running = { careerId, stop };
  setSyncSnapshot({ phase: "syncing" });
  void claim(careerId, controller.signal);
  return stop;
}

export function stopAgent(): void {
  running?.stop();
  running = null;
}

/** True when the bridge is switched on and this browser remembers a code for it. */
export function bridgeReady(): boolean {
  if (typeof window === "undefined") return false;
  const settings = readBridgeSettings();
  return settings.enabled && settings.code !== "";
}

/**
 * Starts the agent if it should be running, and does nothing at all otherwise.
 *
 * Cheap and idempotent on purpose: it is called from the pairing flow, from the landing page's bridge
 * probe and from the first operation the app makes, and any of those may be the first thing to happen.
 */
export function maybeStartAgent(): void {
  if (typeof window === "undefined") return;
  // A LAN client is a client of the bridge already: replicating there would be this device copying a
  // database it does not own.
  if (isRemoteRuntime()) return;
  if (!bridgeReady()) {
    if (running) stopAgent();
    setSyncSnapshot({ phase: "off" });
    return;
  }
  if (running) return;

  // Called from every operation, so the cost has to be bounded: a database read and a lock claim are not
  // worth repeating within the same second.
  const now = Date.now();
  if (now - lastAttempt < 1_000) return;
  lastAttempt = now;

  const careerId = currentCareerId();
  if (!careerId) {
    setSyncSnapshot({ phase: "off" });
    return;
  }
  startAgent(careerId);
}

/**
 * Keeps the page's own copy when the manager says so, then starts replicating again.
 *
 * The page is the source of truth in this direction, so its package is sent whole and the replica is
 * snapshotted by the bridge before it is replaced.
 */
export async function keepBrowserCopy(careerId: string): Promise<boolean> {
  const pkg = await buildTransferPackage(careerId);
  if (!pkg) return false;
  const reply = await reseed(careerId, "page-to-pc", pkg);
  if (!reply) return false;
  setAppliedRevision(careerId, reply.revision);
  writeMeta(seededKey(careerId), new Date().toISOString());
  setSyncSnapshot({ phase: "syncing", conflict: null });
  maybeStartAgent();
  return true;
}

/**
 * Replaces this browser's copy with the PC's.
 *
 * Nothing is exported from here: the Two copies screen hands the manager the download first, and this is
 * only ever called after they have confirmed. The local ledger is cleared with the import, because the
 * rows the page is about to lose are not changes anybody wants forwarded.
 */
export async function takePcCopy(careerId: string): Promise<boolean> {
  const reply = await reseed(careerId, "pc-to-page");
  if (!reply || !reply.package) return false;
  await importTransferPackage(reply.package);
  clearCareerLedger(careerId);
  setAppliedRevision(careerId, reply.revision);
  writeMeta(seededKey(careerId), new Date().toISOString());
  setSyncSnapshot({ phase: "syncing", conflict: null, pending: 0 });
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: reply.revision }));
  maybeStartAgent();
  return true;
}
