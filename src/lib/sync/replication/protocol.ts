/**
 * The shapes that cross the wire between the page and the bridge.
 *
 * Shared rather than described twice, because the two ends are written months apart in different
 * processes and a field renamed on one side is a silent `undefined` on the other. Nothing here imports a
 * driver, so the bridge and the browser bundle can both take it.
 */

/** One row to move. `row` is null for a delete. `seq` is the sender's log entry, so it can be acked. */
export interface WireDelta {
  table: string;
  key: string;
  op: "I" | "U" | "D";
  row: Record<string, unknown> | null;
  seq: number;
}

/** A whole table, sent as one unit because a save sync rewrites all of it. */
export interface WireBulk {
  table: string;
  hash: string;
  rows: Record<string, unknown>[];
}

/** What a seed decided, and why. */
export type SeedOutcome = "created" | "replaced" | "unchanged" | "conflict";

/** One side of a comparison. Every number here is shown on the Two copies screen. */
export interface SeedSide {
  /** Rows per delta table. */
  tables: Record<string, number>;
  /** Rows the side holds in the delta tables together. */
  rows: number;
  /** The newest `updated_at` (or `created_at`) anywhere on that side, or null when it has none. */
  newestEdit: string | null;
}

/**
 * What the Two copies screen reads.
 *
 * `pcOnly` is the whole reason a seed can be refused: those are ids the bridge replica holds and the
 * page does not, so replacing the replica would delete work that exists nowhere else. `newerOnPc` is the
 * same fact one step quieter - a row both sides have, where the replica's copy is the more recent one.
 */
export interface SeedComparison {
  careerId: string;
  pc: SeedSide;
  page: SeedSide;
  pcOnly: Record<string, number>;
  newerOnPc: Record<string, number>;
  /** Row counts for the tables that are rebuilt from a save, per side. Informational only. */
  bulk: Record<string, { pc: number; page: number }>;
}

export interface SeedReply {
  result: SeedOutcome;
  /** The snapshot written before anything was replaced. Never present when nothing was replaced. */
  backup?: string;
  comparison?: SeedComparison;
}

export interface PushRequest {
  careerId: string;
  clientId: string;
  baseRevision: number;
  deltas: WireDelta[];
  bulk: WireBulk[];
}

export interface PushReply {
  revision: number;
  /** The highest log entry the bridge accepted, so the sender can drop it from its outbox. */
  ackedSeq: number;
}

export interface PullReply {
  revision: number;
  deltas: WireDelta[];
  bulk: WireBulk[];
}

export interface SyncStatusReply {
  revision: number;
  counts: Record<string, number>;
  hashes: Record<string, string>;
}

export interface ReseedReply {
  result: "replaced";
  /** The bridge's revision afterwards, which is what the page records as applied. */
  revision: number;
  /** The snapshot of the side that was overwritten. */
  backup: string | null;
  /** Only for `pc-to-page`: the bridge's whole career, for the page to import. */
  package?: unknown;
}
