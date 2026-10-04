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
  /**
   * Decodes one save's bytes.
   *
   * The bytes are supplied by the caller rather than read here: the local build reads them off disk
   * and the browser build reads them from a handle the user picked, and neither belongs in a decoder.
   */
  parse(save: SaveCandidate, bytes: Uint8Array): Promise<RawCareerData>;
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
 * `players.preferredposition1..4`. Matches the game-accurate table.
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
 *
 * It also holds exactly ONE W/D/L/points/goals set per season, and that set spans EVERY competition
 * the club entered - the league plus its cups - so it is not league form. Verified arithmetically:
 * seasons 1 and 2 report 55 and 56 games for a 24-club (46-game) division, and
 * `wins + draws + losses` equals `gamesPlayed` in all three seasons. So everything from `gamesPlayed`
 * to `goalsAgainst` must never be described as league form; `tablePosition` is the only
 * league-specific value here.
 */
/**
 * One unpromoted academy player.
 *
 * These come from `career_youthplayers`, which is the save's own academy table - NOT a squad filtered
 * by age, which is what the Youth tab showed before this existed.
 *
 * Two things about this table are worth knowing before reading the fields. Academy players have no
 * `teamplayerlinks` row, because they are not in the first team, so their identity has to be pulled
 * from `players` by id. And their ids sit in a generated range (460xxx in the reference save) that
 * appears in neither the squad nor the world pool, so nothing else in the save would have surfaced
 * them.
 */
export interface YouthProspectRow {
  /** The save's own player id. Generated academy players are high-numbered and club-specific. */
  playerId: number;
  name: string | null;
  nameSource: string;
  /** The save's raw position code, kept so a re-map needs no re-parse. */
  positionCode: number | null;
  primaryPosition: string;
  age: number | null;
  birthdate: number | null;
  overallRating: number | null;
  potentialRating: number | null;

  // ---------------------------------------------------------------------------------------------
  // The assessment fields, carried as RANGES.
  //
  // `career_youthplayers` holds repeated assessments of the same prospect and they disagree: in the
  // reference save one 16-year-old reads tier 0 / swing -10 twice and tier 2 / swing +2 once. With no
  // timestamp and no "latest" flag, no single row can be called the correct one, and choosing the
  // bleakest would discard two of three readings to manufacture a certainty the save does not have.
  // So every disagreeing field is collapsed to the range actually observed - the same treatment the
  // transfer-value bands get - and `assessmentCount` records how thin that range is.
  //
  // A prospect with one reading has low === high, and the UI must show a plain value for him rather
  // than dressing it as a range.
  // ---------------------------------------------------------------------------------------------

  /** Academy quality band, 0-3, lowest reading seen. */
  tierLow: number | null;
  /** Highest reading seen. Equal to `tierLow` when he has only been assessed once. */
  tierHigh: number | null;
  /**
   * The LOW end of his potential swing, as a DELTA. Legitimately NEGATIVE (-10 to +21).
   *
   * This is the field that keeps an academy honest: a negative swing low is the game saying he may
   * never reach his headline potential. Across disagreeing assessments the two ends can straddle zero,
   * which is exactly the uncertainty a manager should see.
   */
  swingLowMin: number | null;
  swingLowMax: number | null;
  /** How wide the potential range is, 0-7. A high variance is uncertainty, not quality. */
  varianceMin: number | null;
  varianceMax: number | null;
  /** Longest observed tenure, in months. Tenure only grows, so the highest reading is the best one. */
  monthsInSquad: number | null;
  /** How many academy rows describe him. 1 means a single reading, so there is no range to show. */
  assessmentCount: number;
  goals: number | null;
  appearances: number | null;
}

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
  /** Final league position - the only league-specific value in the row. 0 = still in progress. */
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
 * One row of the save's own league catalogue (`leagues`).
 *
 * Carried on the parse result so the sync can persist it. `name` is the save's own text, untouched -
 * what a competition is *called* on screen is a display decision made elsewhere.
 */
export interface LeagueEntry {
  /** `leagues.leagueid`, the id that season and club rows point at. */
  leagueId: number;
  /** `leagues.leaguename`, e.g. "England Championship (2)". */
  name: string;
  /** `leagues.level`: the tier the save records, 0-7. Null when the save omits it. */
  level: number | null;
  countryId: number | null;
}

/** A named group of face stats, grouped exactly as the game groups them. */
export type AttributeGroup = Record<string, number | null>;

/**
 * One professional in the save's world pool.
 *
 * `preferredFoot`, `weakFoot` and `skillMoves` are decoded because the save carries them, but the
 * dossier lets the manager override the foot by hand: a hand-set value is recorded as USER rather
 * than blended with this one, so the two can never be confused for each other.
 */
export interface WorldPlayerEntry {
  playerId: number;
  name: string;
  nameSource: string | null;
  clubId: number | null;
  clubName: string | null;
  /** The raw 0-29 EA position code, kept so the role mapping loses nothing recoverable. */
  positionCode: number | null;
  primaryPosition: string;
  overall: number | null;
  potential: number | null;
  age: number | null;
  birthdate: number | null;
  heightCm: number | null;
  weightKg: number | null;
  nationalityId: number | null;
  contractValidUntil: number | null;
  preferredFoot: number | null;
  weakFoot: number | null;
  skillMoves: number | null;
  internationalRep: number | null;
  pace: AttributeGroup;
  shooting: AttributeGroup;
  passing: AttributeGroup;
  dribbling: AttributeGroup;
  defending: AttributeGroup;
  physical: AttributeGroup;
  goalkeeping: AttributeGroup;
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
  /** Contents of the meta XML, already read. Absent means names/fields decode as unknown. */
  metaXml?: string | null;
  /** Where that meta came from, carried through to the report. */
  metaSource?: string | null;
  /** Contents of the player-name CSV, already read. */
  nameTableCsv?: string | null;
  /** Where that name table came from, carried through to the report. */
  nameTableSource?: string | null;
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
  /**
   * Every professional in the save, not just our squad: 21,166 rows in the reference career.
   *
   * Deliberately NOT part of `extractedTables` - that object is folded into the sync payload hash, so
   * carrying the pool there would make hashing the expensive part of every sync.
   */
  worldPlayers: WorldPlayerEntry[];
  blobSections: BlobSectionInfo[];
  fixtures: SlotFixture[] | null;
  matchResults: MatchResult[] | null;
  /** Every `career_managerhistory` season row, in season order. Never collapsed to [0]. */
  seasonHistory: SeasonHistoryRow[];
  /** The unpromoted academy. Empty for a save whose academy table is missing or has no rows. */
  youthProspects: YouthProspectRow[];
  /** The save's league catalogue, so a `leagueid` anywhere can be resolved to a real name. */
  leagueDirectory: LeagueEntry[];
  /** Agreed transfers across the whole save - the evidence base for any value estimate. */
  presignedDeals: PresignedDeal[];
  warnings: string[];
  parseMs: number;
}