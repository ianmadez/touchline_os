/**
 * The bridge half of replication: the sequencer, and the five calls the page makes.
 *
 * The bridge is the only side that numbers changes. It assigns a revision to every change it accepts,
 * from either direction, and hands those revisions out in order. That is what lets the page and the
 * replica converge without either of them deciding who wins: they apply in the same order, and the last
 * write to a row is the last revision.
 *
 * Two sources feed the journal:
 *
 * - **The page**, through `POST /sync/push`. Its deltas are applied here with the ledger suppressed and
 *   then journalled against the page's client id.
 * - **The phone** (and anything else writing to the replica directly), through the ordinary write path.
 *   Nothing calls this: the `_sync_*` triggers on the replica's own database log those rows, and
 *   `sequence()` drains that log into the journal whenever a sync call arrives. That is the whole reason
 *   the triggers exist rather than a wrapper around the request handler.
 *
 * Everything here is loopback only. The LAN listener refuses every `/sync/*` route outright - a phone
 * talks to the replica through `/api/*`, and never needs to sequence anything itself.
 *
 * The journal is NOT career data and lives in its own table, so it can never reach a backup or an export.
 * It is on the replica's database, which is only ever written through this process.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { sql } from "drizzle-orm";
import { config } from "../src/lib/config";
import { storage } from "../src/lib/platform/storage";
import {
  buildTransferPackage,
  importTransferPackage,
  incompletePackageReason,
  TransferPackageError,
  type CareerTransferPackage,
} from "../src/lib/services/career-transfer-service";
import { applyBatch, ReplicationApplyError, toDelta } from "../src/lib/sync/replication/apply";
import {
  ackChanges,
  clearBulkDirty,
  clearCareerLedger,
  deltasFor,
  dirtyBulkTables,
  forgetBulkHashes,
  pendingChanges,
  readTable,
  rowCounts,
  tableHash,
  PUSH_BATCH,
} from "../src/lib/sync/replication/ledger";
import { decideSeed } from "../src/lib/sync/replication/seed";
import { BULK_TABLES, DELTA_TABLES, tableClass } from "../src/lib/sync/replication/tables";
import type {
  PullReply,
  PushReply,
  ReseedReply,
  SeedReply,
  SyncStatusReply,
  WireBulk,
  WireDelta,
} from "../src/lib/sync/replication/protocol";
import { sendJson } from "./bridge-server";

/** How many of each career's pre-sync snapshots are kept. */
export const SEED_BACKUP_KEEP = 5;

/** How many revisions of one career's journal are kept. */
const JOURNAL_KEEP = 20_000;

/** A body larger than this is refused before it is parsed. A career package is a fraction of it. */
const MAX_SYNC_BODY = 64 * 1024 * 1024;

/**
 * The journal, plus the record of which of a client's log entries have already been accepted.
 *
 * `origin` is why pull can exclude a device's own pushes: the page sends deltas with seq 1..n, and when it
 * pulls afterwards it must not receive them back as somebody else's news.
 *
 * One statement per entry rather than one script: the driver behind `storage.db` prepares a single
 * statement at a time, so a script handed to it would run its first line and silently stop.
 */
const JOURNAL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS _sync_journal (
    rev INTEGER PRIMARY KEY AUTOINCREMENT,
    career_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_key TEXT NOT NULL DEFAULT '',
    op TEXT NOT NULL,
    row_json TEXT,
    bulk_hash TEXT,
    origin TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_journal_career_rev ON _sync_journal(career_id, rev)`,
  `CREATE TABLE IF NOT EXISTS _sync_push_seq (
    career_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    PRIMARY KEY (career_id, client_id, seq)
  )`,
];

let journalReady = false;

export function ensureJournal(): void {
  if (journalReady) return;
  for (const statement of JOURNAL_STATEMENTS) storage.db.run(sql.raw(statement));
  journalReady = true;
}

/** The newest revision the bridge has handed out for a career. */
export function currentRevision(careerId: string): number {
  ensureJournal();
  const rows = storage.db.all<{ rev: number | null }>(
    sql`SELECT MAX(rev) AS rev FROM _sync_journal WHERE career_id = ${careerId}`
  );
  return rows[0]?.rev ?? 0;
}

interface JournalEntry {
  careerId: string;
  table: string;
  key?: string;
  op: "I" | "U" | "D" | "B";
  row?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  bulkHash?: string | null;
  origin?: string | null;
}

/** Appends one entry and returns its revision. */
function append(entry: JournalEntry): number {
  ensureJournal();
  const payload =
    entry.op === "B" ? JSON.stringify(entry.rows ?? []) : entry.row ? JSON.stringify(entry.row) : null;
  const inserted = storage.db.all<{ rev: number }>(
    sql`INSERT INTO _sync_journal (career_id, table_name, row_key, op, row_json, bulk_hash, origin)
        VALUES (${entry.careerId}, ${entry.table}, ${entry.key ?? ""}, ${entry.op}, ${payload},
                ${entry.bulkHash ?? null}, ${entry.origin ?? null})
        RETURNING rev`
  );
  return inserted[0]?.rev ?? 0;
}

/**
 * Moves everything the replica's own triggers have logged into the journal, in order.
 *
 * Called at the start of every sync call, so a phone's write is numbered before the page asks what is
 * new. Bulk tables contribute one entry each, carrying the table's rows and its content hash, because the
 * hash is the only thing that can say whether 19,000 rows actually moved.
 */
export function sequence(careerId: string): number {
  ensureJournal();

  const logged = pendingChanges(careerId, PUSH_BATCH);
  let revision = currentRevision(careerId);

  if (logged.length > 0) {
    for (const delta of deltasFor(careerId, PUSH_BATCH)) {
      revision = append({
        careerId,
        table: delta.table,
        key: delta.key,
        op: delta.op,
        row: delta.row,
        origin: null,
      });
    }
    ackChanges(logged[logged.length - 1].seq);
    // The journal only grows when changes are journalled, so this is where it is worth trimming. Twenty
    // thousand revisions is far more than a page can fall behind (it polls every two seconds), and a
    // device that has been away longer than that has drifted anyway, which the drift check resolves.
    storage.db.run(
      sql`DELETE FROM _sync_journal
          WHERE career_id = ${careerId}
            AND rev <= (SELECT COALESCE(MAX(rev), 0) - ${JOURNAL_KEEP} FROM _sync_journal WHERE career_id = ${careerId})`
    );
  }

  const dirty = dirtyBulkTables(careerId);
  if (dirty.length > 0) {
    for (const table of dirty) {
      revision = append({
        careerId,
        table,
        op: "B",
        rows: readTable(table, careerId),
        bulkHash: tableHash(table, careerId),
        origin: null,
      });
    }
    clearBulkDirty(careerId, dirty);
  }

  return revision;
}

/** The snapshot folder: beside the database, which is `data/backups` in a checkout. */
export function backupDirectory(): string {
  return path.join(path.dirname(config.databasePath), "backups");
}

/**
 * Copies the whole database before it is replaced.
 *
 * `VACUUM INTO` rather than a file copy: the replica runs in WAL mode, so the `.db` file on its own is
 * not a consistent snapshot. This is the safety net the seed decision depends on - a conflict never gets
 * this far, but a stale replica that is replaced still leaves a file to go back to.
 */
export function backupBeforeSync(careerId: string, tag = "pre-sync"): string | null {
  const dir = backupDirectory();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const target = path.join(dir, `${careerId}-${tag}-${stamp}.db`);
    storage.db.run(sql.raw(`VACUUM INTO '${target.replace(/'/g, "''")}'`));
    pruneSeedBackups(dir, `${careerId}-${tag}-`, SEED_BACKUP_KEEP);
    return target;
  } catch {
    // A failed snapshot must stop the replacement, not be skipped: the whole promise is that the side
    // being overwritten can be got back.
    return null;
  }
}

function pruneSeedBackups(dir: string, prefix: string, keep: number): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return;
  }
  for (const name of names.slice(0, Math.max(0, names.length - keep))) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // Not being able to prune an old snapshot is not a reason to fail a sync.
    }
  }
}

/** Drops the journal for one career, after that career has been replaced wholesale. */
function resetJournal(careerId: string): void {
  ensureJournal();
  storage.db.run(sql`DELETE FROM _sync_journal WHERE career_id = ${careerId}`);
  storage.db.run(sql`DELETE FROM _sync_push_seq WHERE career_id = ${careerId}`);
}

// ---------------------------------------------------------------- the calls

function isPackage(value: unknown): value is CareerTransferPackage {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  const career = raw.career as { id?: unknown } | undefined;
  if (!career || typeof career.id !== "string" || career.id === "") return false;
  if (!raw.data || typeof raw.data !== "object") return false;
  return Object.values(raw.data as Record<string, unknown>).every((rows) => Array.isArray(rows));
}

/**
 * The seed.
 *
 * The page sends its whole career. If the replica does not have that career it is created; if it has a
 * copy the page fully covers, the copy is snapshotted and replaced; if the replica holds anything the
 * page does not, nothing is written and the comparison goes back for the Two copies screen.
 */
async function handleSeed(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const pkg = body.package;
  if (!isPackage(pkg)) {
    return { status: 400, body: { error: "That is not a career package." } };
  }

  const careerId = pkg.career.id;
  const local = await buildTransferPackage(careerId);
  const decision = decideSeed(local, pkg);

  if (decision.result === "conflict") {
    return { status: 409, body: { result: "conflict", comparison: decision.comparison } };
  }
  if (decision.result === "unchanged") {
    return { status: 200, body: { result: "unchanged", comparison: decision.comparison } };
  }

  // Snapshot first, and stop if it could not be taken. A replacement without a way back is the one
  // outcome this whole decision exists to prevent.
  let backup: string | null = null;
  if (decision.result === "replaced") {
    backup = backupBeforeSync(careerId);
    if (!backup) {
      return {
        status: 500,
        body: { error: "Could not snapshot the copy on this PC, so nothing was replaced." },
      };
    }
  }

  try {
    await importTransferPackage(pkg);
  } catch (error) {
    if (error instanceof TransferPackageError) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }

  // The import is thousands of ordinary writes, so the replica's own log is full of rows that are not
  // changes to send anywhere: the page already holds exactly this career.
  clearCareerLedger(careerId);
  resetJournal(careerId);

  const reply: SeedReply = { result: decision.result, comparison: decision.comparison };
  if (backup) reply.backup = backup;
  return { status: 200, body: reply };
}

function alreadyAcked(careerId: string, clientId: string, seq: number): boolean {
  const rows = storage.db.all<{ seq: number }>(
    sql`SELECT seq FROM _sync_push_seq
        WHERE career_id = ${careerId} AND client_id = ${clientId} AND seq = ${seq}`
  );
  return rows.length > 0;
}

function recordAcked(careerId: string, clientId: string, seq: number, rev: number): void {
  storage.db.run(
    sql`INSERT OR IGNORE INTO _sync_push_seq (career_id, client_id, seq, rev)
        VALUES (${careerId}, ${clientId}, ${seq}, ${rev})`
  );
}

/**
 * The page's writes, in order.
 *
 * A `baseRevision` older than what the bridge holds is refused with `409 stale` rather than applied:
 * the page would otherwise overwrite rows it has not seen, using values read before it caught up. Its
 * outbox is untouched by the refusal, so it pulls, applies, and sends again with current values.
 */
function handlePush(body: Record<string, unknown>): { status: number; body: unknown } {
  const careerId = typeof body.careerId === "string" ? body.careerId : "";
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!careerId || !clientId) {
    return { status: 400, body: { error: "A push needs a careerId and a clientId." } };
  }

  const revision = sequence(careerId);
  // A replica that lost this career has nothing to push into, and every delta would fail on a foreign key.
  // Saying so lets the page seed again instead of retrying a broken batch forever.
  const known = storage.db.all<{ id: string }>(sql`SELECT id FROM careers WHERE id = ${careerId}`);
  if (known.length === 0) {
    return { status: 409, body: { code: "unseeded", revision: 0 } };
  }

  const baseRevision = typeof body.baseRevision === "number" ? body.baseRevision : revision;
  if (baseRevision < revision) {
    return { status: 409, body: { code: "stale", revision } };
  }

  const deltas = Array.isArray(body.deltas) ? (body.deltas as WireDelta[]) : [];
  const bulk = Array.isArray(body.bulk) ? (body.bulk as WireBulk[]) : [];
  // Only tables this build replicates: a sender from a newer build could name a table this one does not
  // have, and applying or journalling it would fail on every sync from then on.
  const fresh = deltas.filter(
    (delta) =>
      delta &&
      tableClass(delta.table) === "delta" &&
      !alreadyAcked(careerId, clientId, delta.seq)
  );
  const blocks = bulk.filter((block) => block && tableClass(block.table) === "bulk");

  try {
    applyBatch(careerId, fresh.map(toDelta), blocks);
  } catch (error) {
    if (error instanceof ReplicationApplyError) {
      // A refusal the page can act on, rather than a 500 it retries forever. `unappliable` means the two
      // copies disagree in a way no individual row can fix, so the page replaces this one from its own
      // copy - which is the model's answer for every disagreement.
      return {
        status: 409,
        body: { code: "unappliable", revision, detail: error.detail },
      };
    }
    throw error;
  }

  let latest = revision;
  for (const delta of fresh) {
    latest = append({
      careerId,
      table: delta.table,
      key: delta.key,
      op: delta.op,
      row: delta.row,
      origin: clientId,
    });
    recordAcked(careerId, clientId, delta.seq, latest);
  }
  for (const block of blocks) {
    latest = append({
      careerId,
      table: block.table,
      op: "B",
      rows: block.rows,
      bulkHash: block.hash,
      origin: clientId,
    });
  }

  const ackedSeq = deltas.reduce((max, delta) => Math.max(max, Number(delta?.seq) || 0), 0);
  const reply: PushReply = { revision: latest, ackedSeq };
  return { status: 200, body: reply };
}

/** Everything after `since`, minus the caller's own pushes. */
function handlePull(url: URL): { status: number; body: unknown } {
  const careerId = url.searchParams.get("careerId") ?? "";
  if (!careerId) return { status: 400, body: { error: "A pull needs a careerId." } };

  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const clientId = url.searchParams.get("clientId") ?? "";
  const revision = sequence(careerId);

  const rows = storage.db.all<{
    rev: number;
    table_name: string;
    row_key: string;
    op: "I" | "U" | "D" | "B";
    row_json: string | null;
    bulk_hash: string | null;
  }>(
    sql`SELECT rev, table_name, row_key, op, row_json, bulk_hash FROM _sync_journal
        WHERE career_id = ${careerId} AND rev > ${since} AND (origin IS NULL OR origin <> ${clientId})
        ORDER BY rev ASC`
  );

  const deltas: WireDelta[] = [];
  const bulkByTable = new Map<string, WireBulk>();
  for (const row of rows) {
    if (row.op === "B") {
      // The latest entry for a table wins: an older version of the same table would be replaced again
      // immediately, and sending both would mean carrying 19,000 rows twice.
      bulkByTable.set(row.table_name, {
        table: row.table_name,
        hash: row.bulk_hash ?? "",
        rows: row.row_json ? (JSON.parse(row.row_json) as Record<string, unknown>[]) : [],
      });
      continue;
    }
    deltas.push({
      table: row.table_name,
      key: row.row_key,
      op: row.op,
      row: row.row_json ? (JSON.parse(row.row_json) as Record<string, unknown>) : null,
      seq: row.rev,
    });
  }

  const reply: PullReply = { revision, deltas, bulk: [...bulkByTable.values()] };
  return { status: 200, body: reply };
}

/** Counts and hashes, which is all a drift check needs to know the two sides agree. */
function handleStatus(url: URL): { status: number; body: unknown } {
  const careerId = url.searchParams.get("careerId") ?? "";
  if (!careerId) return { status: 400, body: { error: "A status call needs a careerId." } };

  const revision = sequence(careerId);
  const hashes: Record<string, string> = {};
  for (const table of [...DELTA_TABLES, ...BULK_TABLES]) {
    hashes[table] = tableHash(table, careerId);
  }

  const reply: SyncStatusReply = { revision, counts: rowCounts(careerId), hashes };
  return { status: 200, body: reply };
}

/**
 * Replacing one side on purpose, after the manager has chosen.
 *
 * `page-to-pc` keeps this browser's copy: the replica is snapshotted and rebuilt from the page.
 * `pc-to-page` keeps the replica's copy: the page gets the whole career back and imports it itself,
 * after exporting whatever it is about to lose.
 */
async function handleReseed(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const careerId = typeof body.careerId === "string" ? body.careerId : "";
  const direction = body.direction === "pc-to-page" ? "pc-to-page" : "page-to-pc";
  if (!careerId) return { status: 400, body: { error: "A reseed needs a careerId." } };

  if (direction === "pc-to-page") {
    const pkg = await buildTransferPackage(careerId);
    if (!pkg) {
      return { status: 404, body: { error: "This PC does not hold that career." } };
    }
    const reply: ReseedReply = {
      result: "replaced",
      revision: currentRevision(careerId),
      backup: backupBeforeSync(careerId, "pre-reseed"),
      package: pkg,
    };
    return { status: 200, body: reply };
  }

  const pkg = body.package;
  if (!isPackage(pkg)) return { status: 400, body: { error: "That is not a career package." } };

  // Checked BEFORE the snapshot is taken. The import refuses a package that carries fewer tables than a
  // career is made of, and it has to refuse it: replacing with an incomplete package would delete the
  // tables the package did not carry. But the refusal used to happen after `VACUUM INTO` had written a
  // full copy of the database, and nothing removed it, so a page whose reseed could never succeed wrote
  // ninety megabytes a minute until the disk filled. A refusal that costs nothing is the only kind that
  // can be retried safely.
  const refusal = packageRefusal(pkg);
  if (refusal) return { status: 400, body: { error: refusal } };

  const backup = backupBeforeSync(careerId, "pre-reseed");
  if (!backup) {
    return {
      status: 500,
      body: { error: "Could not snapshot the copy on this PC, so nothing was replaced." },
    };
  }

  try {
    await importTransferPackage(pkg);
  } catch (error) {
    if (error instanceof TransferPackageError) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }

  clearCareerLedger(careerId);
  resetJournal(careerId);
  // The import wrote this career's rows through the transfer service, not through `applyBatch`, so the
  // "last hash applied" record for each bulk table now describes rows that are not here any more. Left
  // in place it would let the next push skip a block the replica actually needed.
  forgetBulkHashes();

  const reply: ReseedReply = { result: "replaced", revision: 0, backup };
  return { status: 200, body: reply };
}

/**
 * Why this package may not replace the copy here, or null when it may.
 *
 * Only the completeness rule, and only when the career is already here: the import is still the
 * authority on everything else, and this exists so the caller can find out before it writes a snapshot.
 */
function packageRefusal(pkg: CareerTransferPackage): string | null {
  const existing = storage.db.all<{ id: string }>(
    sql`SELECT id FROM careers WHERE id = ${pkg.career.id}`
  );
  if (existing.length === 0) return null;
  return incompletePackageReason(pkg);
}

/** Reads a whole body, refusing politely once it is larger than a career package could be. */
function readBody(
  req: http.IncomingMessage
): Promise<{ ok: true; text: string } | { ok: false }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SYNC_BODY) {
        chunks.length = 0;
        resolve({ ok: false });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", reject);
  });
}

/**
 * Routes a `/sync/*` call.
 *
 * The caller has already refused a foreign origin and checked the pairing code: this function is the
 * part behind the door and does not repeat the check, because two places deciding who may come in is how
 * one of them ends up wrong.
 */
export async function handleSyncRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/sync/pull" || pathname === "/sync/status") {
    if (method !== "GET") {
      sendJson(res, 405, { error: "Only GET is supported here." });
      return;
    }
    const answer = pathname === "/sync/pull" ? handlePull(url) : handleStatus(url);
    sendJson(res, answer.status, answer.body);
    return;
  }

  if (pathname === "/sync/push" || pathname === "/sync/seed" || pathname === "/sync/reseed") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "Only POST is supported here." });
      return;
    }
    const read = await readBody(req);
    if (!read.ok) {
      sendJson(res, 413, { error: "That request was too large for this PC to accept." });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(read.text || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const answer =
      pathname === "/sync/push"
        ? handlePush(body)
        : pathname === "/sync/seed"
          ? await handleSeed(body)
          : await handleReseed(body);
    sendJson(res, answer.status, answer.body);
    return;
  }

  sendJson(res, 404, { error: "Unknown route." });
}

/** Exported so a test can assert the journal exists without going through a route. */
export { JOURNAL_STATEMENTS };
