/**
 * Career transfer: a one-time, user-initiated export/import of ONE career.
 *
 * This is deliberately NOT a sync mechanism and not a shared file. The local build writes a backup
 * to `data/exports/`; the user then hands that single file to another build (a browser, another
 * desktop). Nothing here reads a path it was not given, and nothing transfers automatically.
 *
 * A backup carries every table that belongs to the career, and names them, which is what makes
 * importing over an existing career of the same id a complete replacement rather than a partial
 * overwrite. Version 1 backups - written when the format carried nine tables - still read, but only
 * into a career that is not here yet, because they cannot restore what they do not carry.
 */
import { eq, getTableName, sql } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/client";
import type { AppDatabase } from "../platform/types";
import { storage } from "../platform/storage";
import {
  boardObjectives,
  careerEvents,
  careerFinanceInputs,
  careerObjectives,
  careerSnapshots,
  careers,
  clubFinances,
  clubFinanceSnapshots,
  leagues,
  leaguePositions,
  leagueTeams,
  managerOnboardingProfiles,
  players,
  playerSnapshots,
  playerUserProfiles,
  scoutTargets,
  seasonHistory,
  seasonProgress,
  storylines,
  storylineEvents,
  tacticalSystems,
  targetBlocks,
  transferDeals,
  worldPlayerOverrides,
  worldPlayers,
  youthProspects,
} from "../db/schema";

/** Raised for a payload that is not a readable backup, or cannot be applied as one. A 400. */
export class TransferPackageError extends Error {}

/** One row of any table, as it appears in a backup. */
type Row = Record<string, unknown>;

/** The on-wire shape of a career backup. */
export interface CareerTransferPackage {
  schemaVersion: number;
  exportedAt: string;
  provenanceLegend?: Record<string, string>;
  /** The root row. Every other table in the package hangs off this one. */
  career: typeof careers.$inferSelect;
  /** Row counts, keyed by table name. */
  counts: Record<string, number>;
  /**
   * The career-scoped tables `data` carries, named rather than implied.
   *
   * This is what lets a reader tell a complete backup from a partial one instead of assuming, and
   * it is the only reason replacing a career can be done safely.
   */
  tables: string[];
  /** Rows keyed by SQL table name. */
  data: Record<string, Row[]>;
}

/** The package version this build writes. Version 1 is still read. */
export const TRANSFER_SCHEMA_VERSION = 2;

/** How a table is reached from a career. */
interface CareerTableSpec {
  table: AnySQLiteTable;
  /**
   * `career` filters on the table's own `career_id`. `storyline` is the one exception:
   * `storyline_events` has no `career_id` column and reaches its career through its storyline.
   */
  scope: "career" | "storyline";
}

/**
 * Every table that belongs to a career, in the order foreign keys require them to be INSERTed -
 * parents before children. Deletes walk this list backwards.
 *
 * Order is load-bearing: both drivers run with `foreign_keys = ON`, so `player_snapshots` cannot be
 * written before the `career_snapshots` row it points at. `storylines` must precede
 * `storyline_events`, and `career_snapshots` must precede the eight tables that reference it.
 */
const CAREER_TABLES: CareerTableSpec[] = [
  { table: careerSnapshots, scope: "career" },
  { table: playerSnapshots, scope: "career" },
  { table: clubFinanceSnapshots, scope: "career" },
  { table: players, scope: "career" },
  { table: clubFinances, scope: "career" },
  { table: playerUserProfiles, scope: "career" },
  { table: careerEvents, scope: "career" },
  { table: managerOnboardingProfiles, scope: "career" },
  { table: tacticalSystems, scope: "career" },
  { table: storylines, scope: "career" },
  { table: seasonHistory, scope: "career" },
  { table: leaguePositions, scope: "career" },
  { table: careerObjectives, scope: "career" },
  { table: transferDeals, scope: "career" },
  { table: leagueTeams, scope: "career" },
  { table: leagues, scope: "career" },
  { table: seasonProgress, scope: "career" },
  { table: targetBlocks, scope: "career" },
  { table: careerFinanceInputs, scope: "career" },
  { table: scoutTargets, scope: "career" },
  { table: worldPlayers, scope: "career" },
  { table: worldPlayerOverrides, scope: "career" },
  { table: boardObjectives, scope: "career" },
  { table: youthProspects, scope: "career" },
  { table: storylineEvents, scope: "storyline" },
];

/** The SQL table names a complete backup must carry. */
const ALL_CAREER_TABLES = CAREER_TABLES.map((spec) => getTableName(spec.table));

/** Reads one table's rows for a career. */
function readCareerRows(name: string, spec: CareerTableSpec, careerId: string): Row[] {
  return spec.scope === "storyline"
    ? db.all<Row>(
        sql`SELECT * FROM ${sql.identifier(name)} WHERE storyline_id IN (SELECT id FROM storylines WHERE career_id = ${careerId})`
      )
    : db.all<Row>(sql`SELECT * FROM ${sql.identifier(name)} WHERE career_id = ${careerId}`);
}

/** Clears one table's rows for a career. Only used ahead of a replace. */
function deleteCareerRows(
  tx: AppDatabase,
  name: string,
  spec: CareerTableSpec,
  careerId: string
): void {
  const target = sql.identifier(name);
  if (spec.scope === "storyline") {
    tx.run(
      sql`DELETE FROM ${target} WHERE storyline_id IN (SELECT id FROM storylines WHERE career_id = ${careerId})`
    );
    return;
  }
  tx.run(sql`DELETE FROM ${target} WHERE career_id = ${careerId}`);
}

/**
 * A value as SQLite can bind it.
 *
 * SQLite has no boolean type and JSON has no `undefined`, so the two are normalised here rather
 * than handed to the driver as-is. Anything else (an object, an array) is not something this format
 * produces, and is refused by name instead of being written as something it is not.
 */
function bindable(value: unknown, table: string): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  throw new TransferPackageError(
    `The backup has an unusable value in "${table}" (${Array.isArray(value) ? "array" : typeof value}). It is not readable as a career.`
  );
}

/**
 * Writes one table's rows.
 *
 * Rows are written row by row rather than in one statement: a career can be nineteen thousand rows,
 * and one INSERT with nineteen thousand bound parameters would exceed SQLite's variable limit.
 */
function insertCareerRows(tx: AppDatabase, name: string, rows: Row[]): void {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  if (columns.length === 0) return;

  const target = sql.identifier(name);
  const columnList = sql.join(
    columns.map((column) => sql.identifier(column)),
    sql`, `
  );

  for (const row of rows) {
    const values = sql.join(
      columns.map((column) => sql`${bindable(row[column], name)}`),
      sql`, `
    );
    tx.run(sql`INSERT INTO ${target} (${columnList}) VALUES (${values})`);
  }
}

/**
 * Reads one career, and every table that belongs to it, into a transfer package, or null when there
 * is no such career.
 *
 * The package is complete by construction and says so: `tables` names what `data` holds, so a
 * reader never has to assume how much of a career it is looking at. Empty tables are named too -
 * "this career has no scout targets" and "this backup predates scout targets" are different facts.
 */
export async function buildTransferPackage(
  careerId: string
): Promise<CareerTransferPackage | null> {
  const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
  if (!career) return null;

  const data: Record<string, Row[]> = {};
  for (const spec of CAREER_TABLES) {
    const name = getTableName(spec.table);
    data[name] = readCareerRows(name, spec, careerId);
  }

  return {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    // Provenance legend travels with the data so an exported file is self-describing.
    provenanceLegend: {
      SAVE: "Parsed from your career save file.",
      USER: "Entered by the manager.",
      DERIVED: "Computed by TouchlineOS from saved facts.",
      AI: "Generated by a language model (no AI features exist yet).",
    },
    career,
    counts: Object.fromEntries(
      Object.entries(data).map(([name, rows]) => [name, rows.length])
    ),
    tables: Object.keys(data),
    data,
  };
}

export interface TransferImportSummary {
  careerId: string;
  /** True when a career of this id was already here and was rebuilt from the backup. */
  replaced: boolean;
  /** Rows written, keyed by table name. */
  imported: Record<string, number>;
}

/**
 * The nine arrays a version 1 backup named, and the tables they correspond to.
 *
 * Read, never written: version 1 is shipped history, and a backup someone already has is worth
 * reading even though this build cannot produce that shape any more.
 */
const LEGACY_KEYS: Record<string, string> = {
  snapshots: "career_snapshots",
  playerSnapshots: "player_snapshots",
  clubFinanceSnapshots: "club_finance_snapshots",
  players: "players",
  clubFinances: "club_finances",
  playerUserProfiles: "player_user_profiles",
  onboarding: "manager_onboarding_profiles",
  tacticalSystems: "tactical_systems",
  careerEvents: "career_events",
};

/** Reads either package shape into one canonical `data` map, and names what it found. */
function readPackageData(raw: Record<string, unknown>): { data: Record<string, Row[]>; tables: string[] } {
  const data: Record<string, Row[]> = {};
  const tables: string[] = [];

  if (raw.data && typeof raw.data === "object") {
    for (const [name, rows] of Object.entries(raw.data as Record<string, unknown>)) {
      if (!Array.isArray(rows)) {
        throw new TransferPackageError(`The backup's "${name}" section is not a list of rows.`);
      }
      data[name] = rows as Row[];
      tables.push(name);
    }
    return { data, tables };
  }

  // Version 1: nine named arrays, three of them a single object rather than a list.
  for (const [legacy, name] of Object.entries(LEGACY_KEYS)) {
    const value = raw[legacy];
    if (value === undefined || value === null) continue;
    const rows = (Array.isArray(value) ? value : [value]) as Row[];
    data[name] = rows;
    tables.push(name);
  }
  return { data, tables };
}

/** Validates an untrusted payload into a package, or throws `TransferPackageError`. */
function assertPackage(payload: unknown): CareerTransferPackage {
  if (!payload || typeof payload !== "object") {
    throw new TransferPackageError("That file is not a TouchlineOS career backup.");
  }

  const raw = payload as Record<string, unknown>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    throw new TransferPackageError(
      `Unsupported backup version: ${String(raw.schemaVersion)}. This build reads versions 1 and ${TRANSFER_SCHEMA_VERSION}.`
    );
  }

  const career = raw.career as { id?: unknown } | undefined;
  if (!career || typeof career !== "object" || typeof career.id !== "string" || career.id === "") {
    throw new TransferPackageError("That backup has no career id, so there is nothing to import.");
  }

  const { data, tables } = readPackageData(raw);

  return {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
    provenanceLegend: (raw.provenanceLegend as Record<string, string> | undefined) ?? undefined,
    career: raw.career as CareerTransferPackage["career"],
    counts: (raw.counts as Record<string, number> | undefined) ?? {},
    tables,
    data,
  };
}

/** Raised when a partial backup would have to replace a career to apply. A 409. */
export class PartialBackupError extends Error {}

/**
 * Applies a backup.
 *
 * When the career it names is already here, the whole career is cleared and rebuilt from the backup,
 * so what lands is exactly what was exported - never a mix of the two. "The whole career" is
 * literal: every career-scoped table cascades from `careers`. The tables are also cleared
 * explicitly, child-first, so the outcome is the same whether or not foreign keys are enforced
 * rather than depending on that pragma being on.
 *
 * A backup that carries only some of those tables cannot be applied over an existing career - it
 * would delete what it cannot put back - so it is refused with the reason. A backup whose career is
 * not here yet is simply inserted, which is the one case where a partial backup is safe.
 */
export async function importTransferPackage(
  payload: unknown
): Promise<TransferImportSummary> {
  const pkg = assertPackage(payload);
  const careerId = pkg.career.id;

  const applied = storage.withTransaction((tx) => {
    const existing = tx
      .select({ id: careers.id })
      .from(careers)
      .where(eq(careers.id, careerId))
      .get();
    const replacing = Boolean(existing);

    if (replacing) {
      const missing = ALL_CAREER_TABLES.filter((name) => !pkg.tables.includes(name));
      if (missing.length > 0) {
        throw new PartialBackupError(
          `${careerId} is already here, and this backup carries ${pkg.tables.length} of the ${ALL_CAREER_TABLES.length} tables a career is made of, so replacing it would delete the other ${missing.length} (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}). Export a fresh backup from this build and import that instead.`
        );
      }

      // Child-first, then the root. The cascade would clear these on its own; doing it explicitly
      // keeps the result the same whichever way foreign keys are configured.
      for (let index = CAREER_TABLES.length - 1; index >= 0; index -= 1) {
        const spec = CAREER_TABLES[index];
        deleteCareerRows(tx, getTableName(spec.table), spec, careerId);
      }
      tx.delete(careers).where(eq(careers.id, careerId)).run();
    }

    // Parent-first, so every foreign key is satisfied by construction.
    tx.insert(careers).values(pkg.career).run();

    const imported: Record<string, number> = {};
    for (const spec of CAREER_TABLES) {
      const name = getTableName(spec.table);
      const rows = pkg.data[name] ?? [];
      insertCareerRows(tx, name, rows);
      imported[name] = rows.length;
    }

    return { replacing, imported };
  });

  return { careerId, replaced: applied.replacing, imported: applied.imported };
}
