/**
 * Deciding whether a career the page holds may replace the one the bridge replica holds.
 *
 * This is the one decision in replication that can destroy work, so it is a pure function over two
 * packages rather than a condition scattered through the seed handler: given what each side holds, say
 * what may happen, and name exactly what would be lost if it did.
 *
 * The page is the source of truth for a PAGE career, so replacing a stale replica is the ordinary case
 * and needs no confirmation. Replacing a replica that holds something the page does not is not a sync,
 * it is a deletion - so it is refused, and the manager is shown both sides and asked which to keep.
 * There is no third answer: nothing here merges.
 */
import type { CareerTransferPackage } from "../../services/career-transfer-service";
import { BULK_TABLES, DELTA_TABLES } from "./tables";
import type { SeedComparison, SeedOutcome, SeedSide } from "./protocol";

/** The columns that date a row, in the order worth trying. Events are append-only and carry neither. */
const TIME_COLUMNS = ["updated_at", "created_at"] as const;

function timestampOf(row: Record<string, unknown>): string | null {
  for (const column of TIME_COLUMNS) {
    const value = row[column];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function newest(rows: Record<string, unknown>[]): string | null {
  let best: string | null = null;
  for (const row of rows) {
    const stamp = timestampOf(row);
    if (stamp && (best === null || stamp > best)) best = stamp;
  }
  return best;
}

function sideOf(pkg: CareerTransferPackage | null, tables: readonly string[]): SeedSide {
  const counts: Record<string, number> = {};
  let rows = 0;
  let newestEdit: string | null = null;
  for (const table of tables) {
    const found = pkg?.data[table] ?? [];
    // `careers` holds one row and is keyed by the career itself, so counting it would make every side
    // look like it has a row the other might not. It is compared separately, as a row.
    if (table === "careers") continue;
    counts[table] = found.length;
    rows += found.length;
    const stamp = newest(found);
    if (stamp && (newestEdit === null || stamp > newestEdit)) newestEdit = stamp;
  }
  return { tables: counts, rows, newestEdit };
}

/** The id a row is known by inside its package. */
function idOf(row: Record<string, unknown>): string {
  return String(row.id ?? "");
}

/**
 * Compares two packages and says what may happen.
 *
 * `local` is the bridge replica as it stands, or null when that career is not on the PC at all. `incoming`
 * is the page's copy. The comparison is returned for every outcome, because it is also what the Two
 * copies screen reads when the answer is `conflict`.
 */
export function decideSeed(
  local: CareerTransferPackage | null,
  incoming: CareerTransferPackage
): { result: SeedOutcome; comparison: SeedComparison } {
  const careerId = incoming.career.id;
  const pageSide = sideOf(incoming, DELTA_TABLES);
  const pcSide = sideOf(local, DELTA_TABLES);

  const pcOnly: Record<string, number> = {};
  const newerOnPc: Record<string, number> = {};

  if (local) {
    for (const table of DELTA_TABLES) {
      const mine = local.data[table] ?? [];
      if (mine.length === 0) continue;
      const theirs = new Map((incoming.data[table] ?? []).map((row) => [idOf(row), row]));

      for (const row of mine) {
        const id = idOf(row);
        const other = theirs.get(id);
        if (!other) {
          pcOnly[table] = (pcOnly[table] ?? 0) + 1;
          continue;
        }
        const mineAt = timestampOf(row);
        const theirsAt = timestampOf(other);
        if (mineAt && theirsAt && mineAt > theirsAt) {
          newerOnPc[table] = (newerOnPc[table] ?? 0) + 1;
        }
      }
    }
  }

  const bulk: Record<string, { pc: number; page: number }> = {};
  for (const table of BULK_TABLES) {
    bulk[table] = {
      pc: local?.data[table]?.length ?? 0,
      page: incoming.data[table]?.length ?? 0,
    };
  }

  const comparison: SeedComparison = {
    careerId,
    pc: pcSide,
    page: pageSide,
    pcOnly,
    newerOnPc,
    bulk,
  };

  if (!local) return { result: "created", comparison };

  const lost = Object.values(pcOnly).reduce((total, value) => total + value, 0);
  const stale = Object.values(newerOnPc).reduce((total, value) => total + value, 0);
  if (lost > 0 || stale > 0) return { result: "conflict", comparison };

  // Nothing on the PC is missing from the page, so the packages describe the same career. Whether it is
  // worth writing is a separate question, and one answered by comparing what the two sides hold.
  const sameRows = DELTA_TABLES.every(
    (table) => (local.data[table]?.length ?? 0) === (incoming.data[table]?.length ?? 0)
  );
  const sameBulk = BULK_TABLES.every((table) => bulk[table].pc === bulk[table].page);
  return { result: sameRows && sameBulk ? "unchanged" : "replaced", comparison };
}

/**
 * The sentence the Two copies screen puts above the counts.
 *
 * Written from the page's point of view, because the page is where the screen appears.
 */
export function describeConflict(comparison: SeedComparison): string {
  const tables = Object.keys(comparison.pcOnly);
  const lost = Object.values(comparison.pcOnly).reduce((total, value) => total + value, 0);
  const newer = Object.values(comparison.newerOnPc).reduce((total, value) => total + value, 0);

  if (lost > 0) {
    const named = tables.slice(0, 3).join(", ");
    return `The copy on this PC has ${lost} row${lost === 1 ? "" : "s"} this browser does not (${named}${tables.length > 3 ? ", …" : ""}). Replacing it here would delete them.`;
  }
  if (newer > 0) {
    return `The copy on this PC has ${newer} row${newer === 1 ? "" : "s"} edited more recently than this browser's. Replacing it here would undo those edits.`;
  }
  return "The two copies differ, and neither is clearly newer.";
}
