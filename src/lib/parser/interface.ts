export const SAVE_PROVENANCE = "SAVE" as const;
export type Provenance = typeof SAVE_PROVENANCE | "DERIVED" | "USER";

export type FactCategory =
  | "identity"
  | "squads"
  | "ratings"
  | "contracts"
  | "finances"
  | "match-history"
  | "structure";

export interface SaveFact {
  provenance: Provenance;
  source: string;
  label: string;
  value: string | number | null;
  derived?: boolean;
  category?: FactCategory;
  note?: string;
}

export type SaveSlotKind = "manager-career" | "player-career" | "career" | "database" | "unknown";

export interface SaveCandidate {
  id: string;
  filePath: string;
  fileName: string;
  lastModified: Date;
  fileSizeBytes: number;
  slotKind?: SaveSlotKind;
  slotStamp?: string;
  foundIn?: string;
}

export interface RawCareerData {
  saveMetadata: {
    managerName?: string;
    clubName?: string;
    currentDate?: string;
    seasonYear?: number;
  };
  rawPayload: Record<string, unknown>;
  extractedTables: Record<string, unknown[]>;
}

export interface CareerDataProvider {
  detectSaves(saveDirectory?: string): Promise<SaveCandidate[]>;
  parse(save: SaveCandidate): Promise<RawCareerData>;
}

export type FieldValue = string | number | null;
export type Row = Record<string, FieldValue>;
export type Tables = Record<string, Row[]>;

export interface DbMeta {
  tableNames: Map<string, string>;
  fieldNames: Map<string, string>;
  fieldNamesByTable: Map<string, Map<string, string>>;
  fieldRange: Map<string, number>;
  primaryKeys: Map<string, string>;
}

export interface IncompleteName {
  table: string;
  field: string;
  row: number;
  prefixCode: number;
  suffix: string;
}

export interface BlobSectionInfo {
  tag: string;
  start: number;
  end: number;
  bytes: number;
}

export interface SlotFixture {
  date: number;
  kickoff: number | null;
  comp: number;
  slotA: number;
  slotB: number;
  goalsA: number | null;
  goalsB: number | null;
}

export interface MatchResult {
  date: number;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  leagueId: number;
  standoutPlayerId: number | null;
}

export interface TableStat {
  tableName: string | null;
  shortName: string;
  database: number;
  rows: number;
  fields: number;
  recordSize: number;
  unknownFields: string[];
}

export interface SaveFingerprint {
  container: "db" | "fbchunks" | "sqlite" | "zlib" | "gzip" | "lz4" | "unknown";
  headHex: string;
  sizeBytes: number;
  databaseBlocks: number;
  databaseBytes: number;
  blobSections: number;
  hasSqliteHeader: boolean;
  hasFbChunksTag: boolean;
  hasGzipStream: boolean;
  hasZlibStream: boolean;
  hasLz4Frame: boolean;
  signatureOffsets: Record<string, number>;
}

export interface SaveSearchLocation {
  path: string;
  label: string;
  exists: boolean;
}

/**
 * Fallback for position codes that are null, negative (the game's "no preference"
 * sentinel), or outside the known 0-29 space. Deliberately NOT "SUB" so an unmapped
 * player is visible and fixable in the UI instead of hiding among genuine substitutes.
 */
export const UNKNOWN_POSITION = "UNKNOWN";

/**
 * Canonical EA FC position codes as stored in `teamplayerlinks.position` and
 * `players.preferredposition1..4`. Mirrors the game-accurate table in
 * `references/fc26companion/src/domain/attributes.ts`.
 *
 * Codes are collapsed to their BASE role (sided variants fold into the group) so the
 * result can be compared against formation roles in `src/lib/tactics/formations.ts`,
 * which use GK/LB/CB/RB/CDM/CM/LM/RM/CAM/LW/RW/ST. Returning "LCB"/"RCM" here would
 * silently break the dashboard's positional-depth check.
 */
const POSITION_CODE_TO_ROLE: Record<number, string> = {
  0: "GK",
  1: "SW",
  2: "RWB",
  3: "RB",
  4: "CB",
  5: "CB",
  6: "CB",
  7: "LB",
  8: "LWB",
  9: "CDM",
  10: "CDM",
  11: "CDM",
  12: "RM",
  13: "CM",
  14: "CM",
  15: "CM",
  16: "LM",
  17: "RM",
  18: "CAM",
  19: "LM",
  20: "RW",
  21: "CF",
  22: "LW",
  23: "RW",
  24: "ST",
  25: "ST",
  26: "ST",
  27: "LW",
  28: "SUB",
  29: "RES",
};

/** Every value `positionCodeToRole` can return - the validation vocabulary for overrides. */
export const KNOWN_POSITION_ROLES: readonly string[] = [
  "GK",
  "SW",
  "RWB",
  "RB",
  "CB",
  "LB",
  "LWB",
  "CDM",
  "CM",
  "CAM",
  "RM",
  "LM",
  "RW",
  "LW",
  "CF",
  "ST",
  "SUB",
  "RES",
  UNKNOWN_POSITION,
];

/** Maps a raw EA position code to its base role, or "UNKNOWN" when it cannot be mapped. */
export function positionCodeToRole(code: number | null): string {
  if (code === null || code < 0) return UNKNOWN_POSITION;
  return POSITION_CODE_TO_ROLE[code] ?? UNKNOWN_POSITION;
}

/** EA/FIFA date values are day counts from 1582-10-14 (proleptic Gregorian). */
export const EA_DATE_EPOCH_MS = Date.UTC(1582, 9, 14);

/** Converts an EA day-count date value into a real Date. */
export function eaDaysToDate(days: number): Date {
  return new Date(EA_DATE_EPOCH_MS + days * 86_400_000);
}

/** Converts a YYYYMMDD date value (the format used by DATE_SOURCES) into a Date. */
export function yyyymmddToDate(value: number): Date | null {
  const text = String(value);
  if (text.length !== 8) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Derives a player's age from their stored birthdate at a given reference moment.
 *
 * `birthdate` is a genuine SAVE FACT and is persisted (see the `birthdate` columns), so
 * age never has to be re-guessed. Month/day are compared properly rather than using
 * year-only arithmetic, which was off by a year for birthdays late in the season.
 *
 * Returns null when the inputs cannot produce a plausible age - it never invents one.
 */
export function calculateAgeFromBirthdate(
  birthdate: number | null,
  rawAge: number | null,
  referenceDate: Date | null = null
): number | null {
  // Some save sources do carry an explicit age; treat it as authoritative when sane.
  if (typeof rawAge === "number" && rawAge >= 15 && rawAge <= 50) {
    return rawAge;
  }
  if (typeof birthdate !== "number" || birthdate <= 0) return null;

  let born: Date | null = null;

  // Case 1: Formatted YYYYMMDD
  if (birthdate > 19_000_000) {
    const year = Math.floor(birthdate / 10_000);
    const month = Math.floor((birthdate % 10_000) / 100);
    const day = birthdate % 100;
    if (year > 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      born = new Date(Date.UTC(year, month - 1, day));
    }
  } else if (birthdate > 100_000 && birthdate < 300_000) {
    // Case 2: EA day count offset from the 1582-10-14 epoch
    born = eaDaysToDate(birthdate);
  }

  if (!born || Number.isNaN(born.getTime())) return null;

  const reference = referenceDate ?? new Date();
  if (Number.isNaN(reference.getTime())) return null;

  let age = reference.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = reference.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }

  // Outside a plausible footballing range the derivation is wrong, so report nothing
  // rather than clamping to a confident-looking number.
  if (age < 15 || age > 50) return null;
  return age;
}

export interface SquadEntry {
  playerId: number;
  name: string;
  nameSource: "imported-name-table" | "edited-in-save" | "unresolved";
  position: number | null;
  primaryPosition: string;
  jersey: number | null;
  overall: number | null;
  potential: number | null;
  age: number | null;
  birthdate: number | null;
  contractValidUntil: number | null;
  wage: number | null;
  form: number | null;
  injury: number | null;
  /**
   * Head-asset flags. Decoded only so the face importer can skip the network for players who have
   * no real head sprite, instead of discovering that via a failed fetch.
   */
  hasHighQualityHead: boolean | null;
  headAssetId: number | null;
  avatarPomId: number | null;
}

/**
 * One season from `career_managerhistory`.
 *
 * That table holds ONE ROW PER SEASON, not one row per career, which is why every reader that
 * indexed [0] reported season 1's figures forever. `tablePosition` is 0 until the season completes,
 * which makes it the save's only reliable "the season has ended" signal.
 */
export interface SeasonHistoryRow {
  season: number | null;
  leagueId: number | null;
  gamesPlayed: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** Final league position. 0 means the season is still in progress. */
  tablePosition: number | null;
  /** EA's own board objective for that season, and the result against it. SAVE-sourced. */
  leagueObjective: number | null;
  leagueObjectiveResult: number | null;
  domesticCupObjective: number | null;
  europeCupObjective: number | null;
  leagueTrophies: number | null;
  bigBuyAmount: number | null;
  bigBuyPlayerName: string | null;
  bigSellAmount: number | null;
  bigSellPlayerName: string | null;
}

/**
 * One agreed transfer, read from `career_presignedcontract`.
 *
 * This table is the world's record of deals that have been agreed, fees included - the closest
 * thing the save has to observed market prices. The game writes no player valuation anywhere, so
 * these agreed fees are the only real evidence a value estimate can be fitted on.
 */
export interface PresignedDeal {
  /** The player being signed. */
  playerId: number;
  /** The agreed transfer fee, in the save's own currency units. */
  offeredFee: number;
  /** The agreed weekly wage. */
  offeredWage: number | null;
  /** YYYYMMDD the deal was signed. */
  signedDate: number | null;
  /** YYYYMMDD the move completes. */
  completeDate: number | null;
  /** The buying club. */
  buyingTeamId: number | null;
  /** The selling club. */
  sellingTeamId: number | null;
  /** A loan made permanent, or a swap - both distort the fee as a price signal. */
  isLoanBuy: boolean;
  isExchangePlayer: boolean;
}

export interface ParseOptions {
  metaPath?: string | null;
  nameTablePath?: string | null;
  rowLimit?: number;
  allTables?: boolean;
  sampleRows?: number;
}

export interface SpikeCareerData extends RawCareerData {
  fingerprint: SaveFingerprint;
  metaSource: string | null;
  nameTableSource: string | null;
  databases: { index: number; bytes: number; tableCount: number; tables: string[] }[];
  tableStats: TableStat[];
  unknownTables: string[];
  incompleteNames: IncompleteName[];
  truncatedTables: { table: string; scanned: number; total: number; kept: number }[];
  decodedTables: Record<string, number>;
  facts: SaveFact[];
  squadSample: SquadEntry[];
  blobSections: BlobSectionInfo[];
  fixtures: SlotFixture[] | null;
  matchResults: MatchResult[] | null;
  /** Every `career_managerhistory` season row, in season order. Never collapsed to [0]. */
  seasonHistory: SeasonHistoryRow[];
  /** Agreed transfers across the whole save - the evidence base for any value estimate. */
  presignedDeals: PresignedDeal[];
  warnings: string[];
  parseMs: number;
}