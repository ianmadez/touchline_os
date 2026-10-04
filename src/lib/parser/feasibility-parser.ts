/**
 * TouchlineOS — Phase 0 feasibility parser.
 * Reads FIFA/FC bit-packed DB\0\x08 blocks and tagged career blobs (mlop/mrni).
 */
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { gunzipSync, inflateSync } from "node:zlib";

import {
  SAVE_PROVENANCE,
  calculateAgeFromBirthdate,
  positionCodeToRole,
  yyyymmddToDate,
  type BlobSectionInfo,
  type CareerDataProvider,
  type DbMeta,
  type FactCategory,
  type FieldValue,
  type IncompleteName,
  type LeagueEntry,
  type MatchResult,
  type ParseOptions,
  type Row,
  type SaveCandidate,
  type SaveFact,
  type SaveFingerprint,
  type SaveSearchLocation,
  type SaveSlotKind,
  type SeasonHistoryRow,
  type YouthProspectRow,
  type PresignedDeal,
  type SlotFixture,
  type SpikeCareerData,
  type SquadEntry,
  type WorldPlayerEntry,
  type TableStat,
} from "./interface";

const DB_HEADER = Buffer.from([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
const FBCHUNKS_TAG = Buffer.from("FBCHUNKS", "latin1");
const SQLITE_TAG = Buffer.from("SQLite format 3\u0000", "latin1");
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b, 0x08]);
const LZ4_FRAME_MAGIC = Buffer.from([0x04, 0x22, 0x4d, 0x18]);
const ZLIB_MAGICS = [
  Buffer.from([0x78, 0x01]),
  Buffer.from([0x78, 0x5e]),
  Buffer.from([0x78, 0x9c]),
  Buffer.from([0x78, 0xda]),
];

const FIELD_STRING = 0;
const FIELD_INT = 3;
const FIELD_FLOAT = 4;

const MAX_SCAN_DEPTH = 3;
const MAX_DIR_ENTRIES = 5000;
const MAX_TABLE_COUNT = 4096;
const MAX_SCANNED_ROWS = 250_000;
const MAX_INCOMPLETE_NAMES = 200;

const NON_CAREER_RE = /^(CmPlr|Squads|FutSquads|MatchDay|Settings|Assets|UltimateTeam|FUT|Temp)/i;
const SAVE_EXT_RE = /\.(db|sav|fcsave|fc25|fc26|bin|dat)$/i;

const SLOT_PATTERNS: { re: RegExp; kind: SaveSlotKind }[] = [
  { re: /^CmMgrC(\d{17})$/i, kind: "manager-career" },
  { re: /^ManagerCareer(\d{8,})$/i, kind: "manager-career" },
  { re: /^Career(\d{8,})$/i, kind: "career" },
  { re: /^CmPlrC?(\d{8,})$/i, kind: "player-career" },
];

const IDENTITY_TABLES = [
  "career_users",
  "career_managerinfo",
  "career_managerpref",
  "career_managerhistory",
  "career_calendar",
];

const REFERENCE_TABLES = ["teams", "leagues", "leagueteamlinks"];

/** Hard ceiling on the world-pool decode. The reference save declares 21,166, so this is headroom. */
const WORLD_POOL_LIMIT = 30_000;

/**
 * The columns a world-pool row needs - search fields plus the full dossier.
 *
 * A `players` row carries 137 columns, most of them appearance (hair, tattoos, boot codes). Naming
 * what is wanted keeps 21,166 row objects small enough to hand around, and makes the projection
 * below impossible to fat-finger into reading a column that was never taken.
 */
const WORLD_PLAYER_FIELDS: readonly string[] = [
  "playerid",
  /**
   * Read so the pool can be restricted to men's football AT DECODE TIME.
   *
   * This product has no women's career mode, so those rows are wasted pool space and noise in every
   * ranking. Measured on the reference save before relying on it: `players.gender` is a clean split
   * (0 x 18,932, 1 x 2,234), and it agrees with two independent flags - `teams.gender` (1 for
   * "Canada Women", "England Women") and `leagues.iswomencompetition` (1 for England WSL,
   * Germany Frauen-Bundesliga, France Division 1 Feminine, USA NWSL, Spain Liga F Femenina,
   * International Women, Rest of World Women).
   *
   * Worth knowing WHY this matters more than the row count suggests: women's clubs average 74 OVR
   * against 68 for men's, so those 2,234 players dominated the top of every strategy's ranking while
   * also being disproportionately unnamed. Excluding them fixes a ranking bias, not just noise.
   */
  "gender",
  "overallrating",
  "potential",
  "birthdate",
  "preferredposition1",
  "contractvaliduntil",
  "nationality",
  "height",
  "weight",
  "preferredfoot",
  "weakfootabilitytypecode",
  "skillmoves",
  "internationalrep",
  "acceleration",
  "sprintspeed",
  "positioning",
  "finishing",
  "shotpower",
  "longshots",
  "volleys",
  "penalties",
  "vision",
  "crossing",
  "freekickaccuracy",
  "shortpassing",
  "longpassing",
  "curve",
  "agility",
  "balance",
  "reactions",
  "ballcontrol",
  "dribbling",
  "composure",
  "interceptions",
  "headingaccuracy",
  "defspe",
  "standingtackle",
  "slidingtackle",
  "jumping",
  "stamina",
  "strength",
  "aggression",
  "gkdiving",
  "gkhandling",
  "gkkicking",
  "gkpositioning",
  "gkreflexes",
];
const SQUAD_TABLES = [
  "teamplayerlinks",
  "career_playercontract",
  "career_playergrowthuserseason",
  "career_squadranking",
];
const HISTORY_TABLES = [
  "career_playermatchratinghistory",
  "career_presignedcontract",
  "persistent_events",
  "editedplayernames",
];

export const DECODED_TABLES = [
  ...IDENTITY_TABLES,
  ...REFERENCE_TABLES,
  ...SQUAD_TABLES,
  ...HISTORY_TABLES,
];

const DATE_SOURCES: [string, string][] = [
  ["persistent_events", "eventdate"],
  ["career_playermatchratinghistory", "date"],
  ["career_presignedcontract", "signeddate"],
  ["career_playercontract", "last_status_change_date"],
];

export class BufferReader {
  readonly buffer: Buffer;
  position: number;

  constructor(buffer: Buffer, position = 0) {
    this.buffer = buffer;
    this.position = position;
  }

  private require(bytes: number): number {
    const at = this.position;
    if (at < 0 || at + bytes > this.buffer.length) {
      throw new RangeError(`read of ${bytes} byte(s) at ${at} exceeds length ${this.buffer.length}`);
    }
    return at;
  }

  readUInt8(): number {
    const at = this.require(1);
    this.position = at + 1;
    return this.buffer[at];
  }

  readUInt16LE(): number {
    const at = this.require(2);
    this.position = at + 2;
    return this.buffer.readUInt16LE(at);
  }

  readUInt32LE(): number {
    const at = this.require(4);
    this.position = at + 4;
    return this.buffer.readUInt32LE(at);
  }

  readBytes(length: number): Buffer {
    const at = this.require(length);
    this.position = at + length;
    return this.buffer.subarray(at, at + length);
  }

  skip(length: number): void {
    this.require(length);
    this.position += length;
  }
}

export interface DecodedName {
  text: string;
  complete: boolean;
  prefixCode?: number;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8OrLatin1(bytes: Buffer): string {
  if (bytes.length === 0) return "";
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    text = bytes.toString("latin1");
  }
  return text.replace(CONTROL_CHARS, "").trim();
}

export function decodeName(field: Buffer): DecodedName {
  if (field.length === 0) return { text: "", complete: true };

  const terminator = field.indexOf(0);
  const prefixed = field.length > 2 && field[1] === 0 && field[2] !== 0;
  if (terminator === 0 && !prefixed) return { text: "", complete: true };

  if (prefixed) {
    const prefixCode = field[0] | (field[1] << 8);
    const rest = field.subarray(2);
    const end = rest.indexOf(0);
    return {
      text: decodeUtf8OrLatin1(end === -1 ? rest : rest.subarray(0, end)),
      complete: false,
      prefixCode,
    };
  }

  return {
    text: decodeUtf8OrLatin1(terminator === -1 ? field : field.subarray(0, terminator)),
    complete: true,
  };
}

function attrOf(blob: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(blob);
  return match ? match[1] : undefined;
}

export function parseDbMeta(xmlText: string): DbMeta {
  const meta: DbMeta = {
    tableNames: new Map(),
    fieldNames: new Map(),
    fieldNamesByTable: new Map(),
    fieldRange: new Map(),
    primaryKeys: new Map(),
  };

  const tableRe = /<table\b([^>]*)>([\s\S]*?)<\/table>/g;
  let table: RegExpExecArray | null;

  while ((table = tableRe.exec(xmlText)) !== null) {
    const head = table[1];
    const body = table[2];
    const tableName = attrOf(head, "name");
    const tableShort = attrOf(head, "shortname");
    if (!tableName || !tableShort) continue;

    meta.tableNames.set(tableShort, tableName);
    const perTable = new Map<string, string>();
    meta.fieldNamesByTable.set(tableName, perTable);

    const fieldRe = /<field\b([^>]*)\/>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRe.exec(body)) !== null) {
      const attrs = field[1];
      const fieldName = attrOf(attrs, "name");
      const fieldShort = attrOf(attrs, "shortname");
      if (!fieldName || !fieldShort) continue;

      meta.fieldNames.set(fieldShort, fieldName);
      perTable.set(fieldShort, fieldName);

      const isInteger = (attrOf(attrs, "type") ?? "").includes("INTEGER");
      const rangeLow = isInteger ? Number(attrOf(attrs, "rangelow") ?? 0) : 0;
      meta.fieldRange.set(tableName + fieldName, Number.isFinite(rangeLow) ? rangeLow : 0);

      if (attrOf(attrs, "key") === "True") meta.primaryKeys.set(tableName, fieldName);
    }
  }

  if (meta.tableNames.size === 0) throw new Error("meta XML contains no <table> elements");
  return meta;
}

function fieldNameFor(meta: DbMeta, tableName: string, shortName: string): string | undefined {
  return meta.fieldNamesByTable.get(tableName)?.get(shortName) ?? meta.fieldNames.get(shortName);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

const NON_LATIN = /[^\u0020-\u024f\u1e00-\u1eff]/;

function sanitiseName(value: string): string {
  const trimmed = value.trim();
  const cut = NON_LATIN.exec(trimmed);
  return (cut ? trimmed.slice(0, cut.index) : trimmed).trim();
}

export function parseNameTable(csv: string): Map<number, string> {
  const byPlayerId = new Map<number, string>();
  const lines = csv.split(/\r?\n/);
  const headerAt = lines.findIndex((line) => line.trim() !== "" && !line.startsWith("#"));
  if (headerAt === -1) return byPlayerId;

  const header = parseCsvLine(lines[headerAt]).map((cell) => cell.trim().replace(/^\uFEFF/, ""));
  const idCol = header.indexOf("player_id");
  const shortCol = header.indexOf("short_name");
  const longCol = header.indexOf("long_name");
  if (idCol === -1 || (shortCol === -1 && longCol === -1)) return byPlayerId;

  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    const cells = parseCsvLine(line);
    const id = Number(cells[idCol]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const short = sanitiseName(shortCol === -1 ? "" : (cells[shortCol] ?? ""));
    const long = sanitiseName(longCol === -1 ? "" : (cells[longCol] ?? ""));
    if (!short && !long) continue;
    if (!byPlayerId.has(id)) byPlayerId.set(id, short || long);
  }
  return byPlayerId;
}

export function unpackDatabases(save: Buffer): Buffer[] {
  const blocks: Buffer[] = [];
  let offset = save.indexOf(DB_HEADER);
  while (offset >= 0) {
    if (offset + DB_HEADER.length + 4 > save.length) break;
    const size = save.readUInt32LE(offset + DB_HEADER.length);
    if (size <= 0 || offset + size > save.length) {
      throw new Error(`database at offset ${offset} declares invalid size ${size}`);
    }
    blocks.push(save.subarray(offset, offset + size));
    offset = save.indexOf(DB_HEADER, offset + size);
  }
  return blocks;
}

interface FieldDescriptor {
  type: number;
  bitOffset: number;
  bitDepth: number;
  shortName: string;
  key: string;
  known: boolean;
}

interface TableHeader {
  shortName: string;
  tableName: string | null;
  headerOffset: number;
  recordsStart: number;
  recordSize: number;
  recordCount: number;
  fieldCount: number;
  fields: FieldDescriptor[];
  unknownFields: string[];
}

interface HeaderRead {
  headers: TableHeader[];
  unknownTables: string[];
  stats: TableStat[];
}

export function readTableHeaders(block: Buffer, meta: DbMeta | null, database: number): HeaderRead {
  const reader = new BufferReader(block, DB_HEADER.length);

  const declaredSize = reader.readUInt32LE();
  if (declaredSize !== block.length) {
    throw new Error(`database size mismatch: header says ${declaredSize}, block is ${block.length}`);
  }
  reader.skip(4);
  const tableCount = reader.readUInt32LE();
  reader.skip(4);
  if (tableCount <= 0 || tableCount > MAX_TABLE_COUNT) {
    throw new Error(`database declares ${tableCount} tables`);
  }

  const entries: { shortName: string; offset: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    entries.push({
      shortName: reader.readBytes(4).toString("latin1"),
      offset: reader.readUInt32LE(),
    });
  }
  reader.skip(4);
  const tablesStart = reader.position;

  const headers: TableHeader[] = [];
  const unknownTables: string[] = [];
  const stats: TableStat[] = [];

  for (const entry of entries) {
    const headerOffset = tablesStart + entry.offset;
    if (headerOffset < tablesStart || headerOffset + 36 > block.length) {
      unknownTables.push(entry.shortName);
      continue;
    }

    reader.position = headerOffset;
    reader.skip(4);
    const recordSize = reader.readUInt32LE();
    reader.skip(10);
    const recordCount = reader.readUInt16LE();
    reader.skip(4);
    const fieldCount = reader.readUInt8();
    reader.skip(11);

    if (fieldCount <= 0 || fieldCount > 4096 || reader.position + fieldCount * 16 > block.length) {
      unknownTables.push(entry.shortName);
      continue;
    }

    const tableName = meta?.tableNames.get(entry.shortName) ?? null;
    if (tableName === null) unknownTables.push(entry.shortName);

    const declared: FieldDescriptor[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const type = reader.readUInt32LE();
      const bitOffset = reader.readUInt32LE();
      const shortField = reader.readBytes(4).toString("latin1");
      const bitDepth = reader.readUInt32LE();
      const known = tableName ? fieldNameFor(meta as DbMeta, tableName, shortField) : undefined;
      declared.push({
        type,
        bitOffset,
        bitDepth,
        shortName: shortField,
        key: known ?? `unk_${shortField}`,
        known: known !== undefined,
      });
    }

    const fields = declared.slice().sort((a, b) => a.bitOffset - b.bitOffset);

    headers.push({
      shortName: entry.shortName,
      tableName,
      headerOffset,
      recordsStart: reader.position,
      recordSize,
      recordCount,
      fieldCount,
      fields,
      unknownFields: fields.filter((f) => !f.known).map((f) => f.shortName),
    });

    stats.push({
      tableName,
      shortName: entry.shortName,
      database,
      rows: recordCount,
      fields: fieldCount,
      recordSize,
      unknownFields: fields.filter((f) => !f.known).map((f) => f.shortName),
    });
  }

  return { headers, unknownTables, stats };
}

interface RowRead {
  rows: Row[];
  scanned: number;
  kept: number;
  complete: boolean;
  incompleteNames: IncompleteName[];
}

export function decodeRows(
  block: Buffer,
  header: TableHeader,
  meta: DbMeta,
  options: {
    limit?: number | null;
    filter?: (row: Row) => boolean;
    /**
     * Write only these columns.
     *
     * Every column is still READ: the integer fields share a running bit-carry, so skipping a read
     * would corrupt every field after it. The saving is a narrower row object, which is what matters
     * at twenty thousand rows (137 keys -> ~45).
     */
    fields?: readonly string[];
  } = {}
): RowRead {
  const tableName = header.tableName;
  if (tableName === null) throw new Error("cannot decode an unnamed table");

  const limit = options.limit ?? null;
  const filter = options.filter;
  const keep = options.fields ? new Set(options.fields) : null;
  const fields = header.fields;
  const rangeLow = fields.map((f) => (f.known ? meta.fieldRange.get(tableName + f.key) ?? 0 : 0));

  const reader = new BufferReader(block, header.recordsStart);
  const rows: Row[] = [];
  const incompleteNames: IncompleteName[] = [];
  let scanned = 0;
  let complete = true;

  for (let r = 0; r < header.recordCount; r++) {
    if (scanned >= MAX_SCANNED_ROWS) {
      complete = false;
      break;
    }

    const row: Row = {};
    const recordStart = reader.position;
    let carry = 0;
    let carryBits = 0;

    for (let f = 0; f < fields.length; f++) {
      const field = fields[f];
      let value: FieldValue;

      switch (field.type) {
        case FIELD_STRING: {
          carry = 0;
          carryBits = 0;
          reader.position = recordStart + (field.bitOffset >> 3);
          const decoded = decodeName(reader.readBytes(field.bitDepth >> 3));
          if (decoded.complete) {
            value = decoded.text;
          } else {
            value = "";
            if (incompleteNames.length < MAX_INCOMPLETE_NAMES) {
              incompleteNames.push({
                table: tableName,
                field: field.key,
                row: r,
                prefixCode: decoded.prefixCode ?? 0,
                suffix: decoded.text,
              });
            }
          }
          break;
        }
        case FIELD_INT: {
          const depth = field.bitDepth;
          let raw = 0;
          let bit = 0;
          if (carryBits !== 0) {
            bit = 8 - carryBits;
            raw = carry >>> carryBits;
          }
          while (bit < depth) {
            carry = reader.readUInt8();
            raw += carry * 2 ** bit;
            bit += 8;
          }
          carryBits = (depth + 8 - bit) & 7;
          raw %= 2 ** depth;
          value = raw + rangeLow[f];
          break;
        }
        case FIELD_FLOAT: {
          reader.position = recordStart + (field.bitOffset >> 3);
          value = reader.readUInt32LE();
          break;
        }
        default:
          value = null;
          break;
      }

      if (keep === null || keep.has(field.key)) row[field.key] = value;
    }

    reader.position = recordStart + header.recordSize;
    scanned++;

    if (!filter || filter(row)) {
      rows.push(row);
      if (limit !== null && rows.length >= limit) {
        complete = r + 1 >= header.recordCount;
        break;
      }
    }
  }

  return { rows, scanned, kept: rows.length, complete, incompleteNames };
}

function blobStart(save: Buffer): number {
  let at = save.indexOf(DB_HEADER);
  if (at < 0) return -1;
  let past = 0;
  while (at >= 0) {
    const size = save.readUInt32LE(at + DB_HEADER.length);
    if (size <= 0 || at + size > save.length) break;
    past = at + size;
    at = save.indexOf(DB_HEADER, past);
  }
  return past;
}

export function blobSections(save: Buffer): BlobSectionInfo[] {
  const from = blobStart(save);
  if (from <= 0) return [];

  const marks: { tag: string; at: number }[] = [];
  for (let i = from; i < save.length - 12; i++) {
    if (save[i] !== 0x01 || save.readUInt32LE(i + 1) !== 4) continue;
    const tag = save.subarray(i + 5, i + 9).toString("latin1");
    if (!/^[a-z]{4}$/.test(tag)) continue;
    marks.push({ tag, at: i });
    i += 8;
  }

  return marks.map((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].at : save.length;
    return { tag: mark.tag, start: mark.at, end, bytes: end - mark.at };
  });
}

function plausibleDate(value: number): boolean {
  if (value < 20200101 || value > 20600101) return false;
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

const MAX_GOALS = 30;

function readGoals(value: number): number | null | false {
  if (value === 0xff) return null;
  if (value > MAX_GOALS) return false;
  return value;
}

const FIXTURE_STRIDE = 22;

export function readFixtureLedger(save: Buffer): SlotFixture[] | null {
  const section = blobSections(save).find((s) => s.tag === "mlop");
  if (!section) return null;

  const out: SlotFixture[] = [];
  for (let i = section.start; i + FIXTURE_STRIDE <= section.end; i++) {
    if (save[i + 9] !== 0xff || save[i + 13] !== 0xff) continue;
    const date = save.readUInt32LE(i);
    if (!plausibleDate(date)) continue;
    const goalsA = readGoals(save[i + 8]);
    const goalsB = readGoals(save[i + 12]);
    if (goalsA === false || goalsB === false) continue;
    const kickoff = save.readUInt16LE(i + 4);
    out.push({
      date,
      kickoff: kickoff >= 0 && kickoff <= 2359 ? kickoff : null,
      comp: save.readUInt16LE(i + 19),
      slotA: save.readUInt16LE(i + 6),
      slotB: save.readUInt16LE(i + 10),
      goalsA,
      goalsB,
    });
  }
  return out.length ? out : null;
}

const RESULT_STRIDE = 49;

export function readLatestResults(
  save: Buffer,
  leagueOfTeam: (teamId: number) => number | null,
  isPlayerId: (id: number) => boolean = () => false
): MatchResult[] | null {
  const section = blobSections(save).find((s) => s.tag === "mrni");
  if (!section) return null;

  const out: MatchResult[] = [];
  const seen = new Set<string>();
  for (let i = section.start; i + RESULT_STRIDE <= section.end; i++) {
    const date = save.readUInt32LE(i);
    if (!plausibleDate(date)) continue;
    const home = save.readUInt32LE(i + 6);
    const away = save.readUInt32LE(i + 10);
    if (home === away) continue;
    const league = leagueOfTeam(home);
    if (league === null || league !== leagueOfTeam(away)) continue;
    const homeGoals = save.readUInt32LE(i + 14);
    const awayGoals = save.readUInt32LE(i + 18);
    if (homeGoals > MAX_GOALS || awayGoals > MAX_GOALS) continue;
    if (save.readUInt16LE(i + 22) !== league) continue;

    const key = `${date}:${home}:${away}:${homeGoals}:${awayGoals}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const standout = save.readUInt32LE(i + 26);
    out.push({
      date,
      homeTeamId: home,
      awayTeamId: away,
      homeGoals,
      awayGoals,
      leagueId: league,
      standoutPlayerId: isPlayerId(standout) ? standout : null,
    });
  }
  return out.length ? out : null;
}

function firstZlibOffset(buffer: Buffer): number {
  for (const magic of ZLIB_MAGICS) {
    const at = buffer.indexOf(magic);
    if (at >= 0) return at;
  }
  return -1;
}

function classifySlot(fileName: string): { kind: SaveSlotKind; stamp: string | null } {
  for (const pattern of SLOT_PATTERNS) {
    const match = pattern.re.exec(fileName);
    if (match) return { kind: pattern.kind, stamp: match[1] };
  }
  if (SAVE_EXT_RE.test(fileName)) return { kind: "database", stamp: null };
  if (/career/i.test(fileName)) return { kind: "career", stamp: null };
  if (/^DATA/i.test(fileName)) return { kind: "database", stamp: null };
  return { kind: "unknown", stamp: null };
}

function looksLikeSaveFile(fileName: string): boolean {
  if (NON_CAREER_RE.test(fileName)) return false;
  return classifySlot(fileName).kind !== "unknown";
}

const num = (row: Row | undefined, key: string): number | null => {
  const value = row?.[key];
  return typeof value === "number" ? value : null;
};

const str = (row: Row | undefined, key: string): string | null => {
  const value = row?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const asDate = (yyyymmdd: number | null): string | null => {
  if (yyyymmdd === null) return null;
  const text = String(yyyymmdd);
  if (text.length !== 8) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
};

export class FeasibilitySaveParser implements CareerDataProvider {
  private readonly options: {
    metaPath: string | null;
    nameTablePath: string | null;
    rowLimit: number;
    allTables: boolean;
    sampleRows: number;
  };

  lastScan: SaveSearchLocation[] = [];
  lastSkippedFiles: string[] = [];

  private meta: DbMeta | null = null;
  private metaSource: string | null = null;
  private names: Map<number, string> = new Map();
  private nameTableSource: string | null = null;

  constructor(options: ParseOptions = {}) {
    this.options = {
      metaPath: options.metaPath ?? null,
      nameTablePath: options.nameTablePath ?? null,
      rowLimit: options.rowLimit ?? 60,
      allTables: options.allTables ?? false,
      sampleRows: options.sampleRows ?? 3,
    };
  }

  searchLocations(): SaveSearchLocation[] {
    const env = process.env;
    const home = env.USERPROFILE || env.HOME || "";
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
    const cwd = process.cwd();

    const candidates: [string, string][] = [
      [path.join(home, "Documents", "FC 25", "settings"), "FC 25 · Documents/settings"],
      [
        path.join(home, "OneDrive", "Documents", "FC 25", "settings"),
        "FC 25 · OneDrive Documents/settings",
      ],
      [path.join(localAppData, "EA SPORTS FC 25"), "FC 25 · AppData/Local"],
      [path.join(localAppData, "EA SPORTS FC 25", "settings"), "FC 25 · AppData/Local/settings"],
      [path.join(cwd, "data", "saves"), "workspace · data/saves"],
      [path.join(localAppData, "EA SPORTS FC 26", "settings"), "FC 26 · AppData/Local/settings"],
      [path.join(home, "Documents", "FC 26", "settings"), "FC 26 · Documents/settings"],
      [path.join(roaming, "EA Sports", "FC 25"), "FC 25 · AppData/Roaming/EA Sports"],
      [path.join(roaming, "EA Sports", "FC 26"), "FC 26 · AppData/Roaming/EA Sports"],
    ];

    for (const key of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
      const root = env[key];
      if (!root) continue;
      candidates.push([
        path.join(root, "Documents", "FC 25", "settings"),
        `FC 25 · ${key}/Documents/settings`,
      ]);
      candidates.push([
        path.join(root, "Documents", "FC 26", "settings"),
        `FC 26 · ${key}/Documents/settings`,
      ]);
    }

    const out: SaveSearchLocation[] = [];
    const seen = new Set<string>();
    for (const [dir, label] of candidates) {
      if (!dir || seen.has(dir.toLowerCase())) continue;
      seen.add(dir.toLowerCase());
      out.push({ path: dir, label, exists: fs.existsSync(dir) });
    }
    return out;
  }

  private walk(dir: string, depth: number, out: string[]): string[] {
    if (depth < 0 || out.length >= MAX_DIR_ENTRIES) return out;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (out.length >= MAX_DIR_ENTRIES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walk(full, depth - 1, out);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  async detectSaves(saveDirectory?: string): Promise<SaveCandidate[]> {
    const locations: SaveSearchLocation[] = saveDirectory
      ? [
          {
            path: path.resolve(saveDirectory),
            label: "explicit path",
            exists: fs.existsSync(path.resolve(saveDirectory)),
          },
        ]
      : this.searchLocations();

    this.lastScan = locations;
    this.lastSkippedFiles = [];

    const candidates: SaveCandidate[] = [];
    const seen = new Set<string>();

    for (const location of locations) {
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(location.path);
      } catch {
        continue;
      }

      const isFile = stat.isFile();
      const files = isFile ? [location.path] : this.walk(location.path, MAX_SCAN_DEPTH, []);

      for (const filePath of files) {
        const key = filePath.toLowerCase();
        if (seen.has(key)) continue;

        const fileName = path.basename(filePath);
        if (!isFile && !looksLikeSaveFile(fileName)) {
          this.lastSkippedFiles.push(filePath);
          continue;
        }

        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(filePath);
        } catch {
          continue;
        }
        if (!fileStat.isFile()) continue;

        seen.add(key);
        const slot = classifySlot(fileName);
        candidates.push({
          id: createHash("sha1").update(filePath).digest("hex").slice(0, 16),
          filePath,
          fileName,
          lastModified: fileStat.mtime,
          fileSizeBytes: fileStat.size,
          slotKind: slot.kind,
          foundIn: location.label,
          ...(slot.stamp ? { slotStamp: slot.stamp } : {}),
        });
      }
    }

    return candidates.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  private loadMeta(): void {
    if (this.meta !== null || this.metaSource === "none") return;

    const roots = [
      this.options.metaPath,
      process.env.FC_META_XML ?? null,
      path.join(process.cwd(), "data", "fifa_ng_db-meta.xml"),
      path.join(process.cwd(), "references", "fc26companion", "data", "fifa_ng_db-meta.xml"),
    ];

    for (const candidate of roots) {
      if (!candidate) continue;
      try {
        if (!fs.existsSync(candidate)) continue;
        this.meta = parseDbMeta(fs.readFileSync(candidate, "utf8"));
        this.metaSource = candidate;
        return;
      } catch {
        continue;
      }
    }
    this.metaSource = "none";
  }

  private loadNames(): void {
    if (this.nameTableSource !== null) return;

    const roots = [
      this.options.nameTablePath,
      process.env.FC_NAME_TABLE ?? null,
      path.join(process.cwd(), "data", "playernames_fc26.csv"),
      path.join(process.cwd(), "references", "fc26companion", "data", "playernames_fc26.csv"),
    ];

    for (const candidate of roots) {
      if (!candidate) continue;
      try {
        if (!fs.existsSync(candidate)) continue;
        const table = parseNameTable(fs.readFileSync(candidate, "utf8"));
        if (table.size === 0) continue;
        this.names = table;
        this.nameTableSource = candidate;
        return;
      } catch {
        continue;
      }
    }
    this.nameTableSource = "none";
  }

  async parse(save: SaveCandidate): Promise<SpikeCareerData> {
    const startedAt = performance.now();
    const warnings: string[] = [];
    const facts: SaveFact[] = [];
    const incompleteNames: IncompleteName[] = [];
    const truncatedTables: SpikeCareerData["truncatedTables"] = [];
    const decodedTables: Record<string, number> = {};

    if (!fs.existsSync(save.filePath)) {
      throw new Error(`Save file not found at path: ${save.filePath}`);
    }

    let bytes = fs.readFileSync(save.filePath);
    const fingerprint = this.fingerprint(bytes);
    let decompressedFrom: string | null = null;

    if (fingerprint.databaseBlocks === 0) {
      const inflated = this.tryInflate(bytes);
      if (inflated) {
        bytes = Buffer.from(inflated.bytes);
        decompressedFrom = `${inflated.strategy}@${inflated.offset}`;
        warnings.push(
          `Save is not a DB container: decompressed with ${inflated.strategy} at offset ${inflated.offset} before parsing.`
        );
      } else if (fingerprint.hasFbChunksTag) {
        warnings.push(
          "Save is an FBCHUNKS container. Decoding it needs the `fifa-career-save-parser` package."
        );
      } else if (fingerprint.hasLz4Frame) {
        warnings.push("Save carries an LZ4 frame. Decoding it needs an LZ4 dependency.");
      } else if (fingerprint.hasSqliteHeader) {
        warnings.push("Save contains a SQLite header; this parser does not read SQLite tables.");
      }
    }

    this.loadMeta();
    this.loadNames();
    const meta = this.meta;

    const blocks: Buffer[] = [];
    if (bytes.indexOf(DB_HEADER) >= 0) {
      try {
        blocks.push(...unpackDatabases(bytes));
      } catch (error) {
        warnings.push(`Database container rejected: ${(error as Error).message}`);
      }
    }

    const tableStats: TableStat[] = [];
    const unknownTables: string[] = [];
    const databases: SpikeCareerData["databases"] = [];
    const tableIndex = new Map<string, { block: number; header: TableHeader }[]>();

    for (let b = 0; b < blocks.length; b++) {
      let read: HeaderRead;
      try {
        read = readTableHeaders(blocks[b], meta, b);
      } catch (error) {
        warnings.push(`DB${b} rejected: ${(error as Error).message}`);
        continue;
      }
      tableStats.push(...read.stats);
      unknownTables.push(...read.unknownTables);
      databases.push({
        index: b,
        bytes: blocks[b].length,
        tableCount: read.headers.length,
        tables: read.headers.map((h) => h.tableName ?? `?${h.shortName}`).sort(),
      });
      for (const header of read.headers) {
        if (header.tableName === null) continue;
        const list = tableIndex.get(header.tableName) ?? [];
        list.push({ block: b, header });
        tableIndex.set(header.tableName, list);
      }
    }

    // Schema drift is reported, never quietly absorbed. The meta XML is not necessarily the one that
    // shipped with this save - EA is free to add, rename or reorder career columns between titles -
    // and a table or field the meta does not know would otherwise decode with its values read off
    // the wrong names. Both facts are already collected for the report; pushing them onto `warnings`
    // is what makes them visible, because `warnings` is the channel that reaches the user.
    if (meta !== null) {
      const missingTables = [...new Set(unknownTables)];
      if (missingTables.length > 0) {
        warnings.push(
          `Schema drift: ${missingTables.length} table(s) in this save are not in the meta XML (${missingTables
            .slice(0, 5)
            .join(", ")}${missingTables.length > 5 ? ", ..." : ""}), so they were not decoded.`
        );
      }
      // Only tables the meta DOES know: an unknown table is already reported above, and its fields
      // would otherwise be listed a second time under a name that does not exist.
      const driftedFields = tableStats.filter(
        (stat) => stat.tableName !== null && stat.unknownFields.length > 0
      );
      if (driftedFields.length > 0) {
        const shown = driftedFields
          .slice(0, 3)
          .map((stat) => `${stat.tableName ?? stat.shortName} (${stat.unknownFields.length} field(s))`)
          .join(", ");
        warnings.push(
          `Schema drift: ${driftedFields.length} table(s) carry fields the meta XML does not name (${shown}${
            driftedFields.length > 3 ? ", ..." : ""
          }), so those columns cannot be named and their values may be misread.`
        );
      }
    }

    const extractedTables: Record<string, unknown[]> = {};

    const decodeTable = (
      tableName: string,
      options: {
        limit?: number | null;
        filter?: (row: Row) => boolean;
        fields?: readonly string[];
        /**
         * Take the rows and register NOTHING.
         *
         * `extractedTables` is folded into the sync payload hash, so a 21,166-row pool landing in it
         * would make every sync serialise megabytes just to decide whether the save changed. The pool
         * is handed back instead, and never stored there.
         */
        unregistered?: boolean;
      } = {}
    ): Row[] => {
      const entries = tableIndex.get(tableName);
      if (!entries || meta === null) return [];
      const rows: Row[] = [];
      for (const { block, header } of entries) {
        const read = decodeRows(blocks[block], header, meta, options);
        rows.push(...read.rows);
        incompleteNames.push(...read.incompleteNames);
        if (!read.complete) {
          truncatedTables.push({
            table: tableName,
            scanned: read.scanned,
            total: header.recordCount,
            kept: read.kept,
          });
        }
      }
      if (!options.unregistered) {
        extractedTables[tableName] = rows;
        decodedTables[tableName] = rows.length;
      }
      return rows;
    };

    if (meta === null) {
      warnings.push("No meta XML found, so no table or field could be named.");
    }

    for (const table of IDENTITY_TABLES) decodeTable(table);
    for (const table of REFERENCE_TABLES) decodeTable(table);

    const users = (extractedTables["career_users"] as Row[]) ?? [];
    const managerInfo = (extractedTables["career_managerinfo"] as Row[]) ?? [];
    const managerPref = (extractedTables["career_managerpref"] as Row[]) ?? [];
    const managerHistory = (extractedTables["career_managerhistory"] as Row[]) ?? [];

    // The save's own league catalogue: `leagueid` -> the competition's real name. Built HERE, before
    // anything that carries a bare league id, because both the identity facts below and every
    // `career_managerhistory` season row need it. It used to be built after the season rows and
    // reach exactly one diagnostics fact, which is why a league id rendered as "Division 14"
    // everywhere it mattered while the name sat decoded and unused in memory.
    //
    // A league the save gives no name for is left out rather than stored as an empty string (one row
    // in a real save has an empty `leaguename`), so callers can tell "unknown" from "named".
    const leagueRows = (extractedTables["leagues"] as Row[]) ?? [];
    const leagueNameById = new Map<number, string>();
    const leagueDirectory: LeagueEntry[] = [];
    for (const league of leagueRows) {
      const leagueId = num(league, "leagueid");
      const name = str(league, "leaguename");
      if (leagueId === null || !name) continue;
      leagueNameById.set(leagueId, name);
      leagueDirectory.push({
        leagueId,
        name,
        level: num(league, "level"),
        countryId: num(league, "countryid"),
      });
    }

    // One row per season, kept whole and in season order. Every reader that indexed [0] silently
    // reported season 1's figures for the entire career, so nothing downstream should re-derive
    // this by hand.
    const seasonHistory: SeasonHistoryRow[] = [...managerHistory]
      .sort((a, b) => (num(a, "season") ?? 0) - (num(b, "season") ?? 0))
      .map((row) => ({
        season: num(row, "season"),
        leagueId: num(row, "leagueid"),
        gamesPlayed: num(row, "games_played"),
        wins: num(row, "wins"),
        draws: num(row, "draws"),
        losses: num(row, "losses"),
        points: num(row, "points"),
        goalsFor: num(row, "goals_for"),
        goalsAgainst: num(row, "goals_against"),
        tablePosition: num(row, "tableposition"),
        leagueObjective: num(row, "leagueobjective"),
        leagueObjectiveResult: num(row, "leagueobjectiveresult"),
        domesticCupObjective: num(row, "domestic_cup_objective"),
        europeCupObjective: num(row, "europe_cup_objective"),
        leagueTrophies: num(row, "leaguetrophies"),
        bigBuyAmount: num(row, "bigbuyamount"),
        bigBuyPlayerName: str(row, "bigbuyplayername"),
        bigSellAmount: num(row, "bigsellamount"),
        bigSellPlayerName: str(row, "bigsellplayername"),
      }));
    const teams = (extractedTables["teams"] as Row[]) ?? [];
    const leagueTeamLinks = (extractedTables["leagueteamlinks"] as Row[]) ?? [];

    const teamById = new Map<number, Row>();
    for (const team of teams) {
      const id = num(team, "teamid");
      if (id !== null) teamById.set(id, team);
    }
    const leagueOfTeam = new Map<number, number>();
    for (const link of leagueTeamLinks) {
      const teamId = num(link, "teamid");
      const leagueId = num(link, "leagueid");
      if (teamId !== null && leagueId !== null) leagueOfTeam.set(teamId, leagueId);
    }

    const user = users[0];
    const info = managerInfo[0];
    const clubId = num(info, "clubteamid") ?? num(user, "clubteamid");

    const fullName = (row: Row | undefined): string | null => {
      const joined = [str(row, "firstname"), str(row, "surname")].filter(Boolean).join(" ").trim();
      return joined.length > 0 ? joined : null;
    };

    const managerName = fullName(user);
    const club = clubId !== null ? teamById.get(clubId) : undefined;
    const clubName = str(club, "teamname");
    const seasonCount = num(user, "seasoncount");
    const userLeagueId =
      num(user, "leagueid") ?? (clubId !== null ? leagueOfTeam.get(clubId) ?? null : null);

    if (managerName) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "career_users.firstname+surname",
        label: "Manager name",
        value: managerName,
        category: "identity",
      });
    }
    if (clubId !== null) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "career_managerinfo.clubteamid",
        label: "Club id",
        value: clubId,
        category: "identity",
      });
    }
    facts.push({
      provenance: SAVE_PROVENANCE,
      source: "teams.teamname",
      label: "Club name",
      value: clubName,
      category: "identity",
      ...(clubName ? {} : { note: "teamname is string; prefix-compressed values decode empty." }),
    });
    if (seasonCount !== null) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "career_users.seasoncount",
        label: "Season number",
        value: seasonCount,
        category: "identity",
        note: "A count, not a calendar year.",
      });
    }
    if (userLeagueId !== null) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "leagueteamlinks.leagueid",
        label: "League",
        value: leagueNameById.get(userLeagueId) ?? userLeagueId,
        category: "identity",
      });
    }

    const squadLinks = decodeTable("teamplayerlinks", {
      limit: Math.max(this.options.rowLimit * 4, 200),
      filter: (row) => clubId !== null && num(row, "teamid") === clubId,
    });
    const squadPlayerIds = new Set<number>();
    for (const link of squadLinks) {
      const id = num(link, "playerid");
      if (id !== null) squadPlayerIds.add(id);
    }

    // ---- The academy ---------------------------------------------------------------------------
    //
    // Academy players are NOT in `teamplayerlinks`: they are unpromoted, so no row links them to the
    // first team. Their ids also sit in a generated range (460xxx in the reference save) that appears
    // in neither the squad nor the world pool. That is why the Youth tab could previously show the
    // world squad filtered by age but never the actual academy - nothing had read this table, and
    // nothing had widened the `players` decode to cover the ids it names. The ids are collected here
    // so the decode below can include them.
    const youthRows = decodeTable("career_youthplayers", {
      limit: Math.max(this.options.rowLimit, 300),
    });
    const youthIds = new Set<number>();
    for (const row of youthRows) {
      const id = num(row, "playerid");
      if (id !== null) youthIds.add(id);
    }

    const youthHistoryRows = decodeTable("career_youthplayerhistory", {
      limit: Math.max(this.options.rowLimit, 600),
    });
    const youthHistoryByPlayer = new Map<number, Row>();
    for (const row of youthHistoryRows) {
      const id = num(row, "playerid");
      if (id !== null && !youthHistoryByPlayer.has(id)) youthHistoryByPlayer.set(id, row);
    }

    const contracts = decodeTable("career_playercontract", {
      limit: Math.max(this.options.rowLimit * 2, 120),
      filter: (row) => {
        const playerId = num(row, "playerid");
        if (playerId !== null && squadPlayerIds.has(playerId)) return true;
        return clubId !== null && num(row, "teamid") === clubId;
      },
    });
    // Decoded for the feasibility report only: `decodeTable` is what registers a table in
    // `extractedTables`/`decodedTables`, so the rows themselves were never read. They are a
    // per-player attribute sheet (37 fields - `overall` plus every face stat), which is NOT what
    // the DEVELOPMENT storyline reads: that compares one player across two `player_snapshots`
    // (`CareerService.developmentObservations`). Nothing consumes this table today, and wiring it
    // in would change where rating movement is sourced from, so it is parked deliberately rather
    // than deleted or quietly used. Note the separate `career_playerlastgrowth` table - the one the
    // reference implementation named as the real injury source - is ~21k rows in the save and is
    // still not decoded by this parser at all.
    decodeTable("career_playergrowthuserseason", {
      limit: Math.max(this.options.rowLimit, 60),
      filter: (row) => {
        const id = num(row, "playerid");
        return id !== null && squadPlayerIds.has(id);
      },
    });
    decodeTable("career_squadranking", {
      limit: Math.max(this.options.rowLimit, 60),
      filter: (row) => {
        const id = num(row, "playerid");
        return id !== null && squadPlayerIds.has(id);
      },
    });
    const players = decodeTable("players", {
      limit: Math.max(squadPlayerIds.size * 10, 500),
      filter: (row) => {
        const id = num(row, "playerid");
        if (id === null) return false;
        // Academy ids are included so a prospect has a name, a rating and a position. They never reach
        // `squadSample` - that list is built from the team-sheet links, not from this one.
        return squadPlayerIds.has(id) || youthIds.has(id);
      },
    });

    const playerById = new Map<number, Row>();
    for (const player of players) {
      const id = num(player, "playerid");
      if (id !== null && !playerById.has(id)) playerById.set(id, player);
    }
    const contractByPlayer = new Map<number, Row>();
    for (const contract of contracts) {
      const id = num(contract, "playerid");
      if (id !== null && !contractByPlayer.has(id)) contractByPlayer.set(id, contract);
    }

    const editedNames = decodeTable("editedplayernames", { limit: 2000 });
    const editedByPlayer = new Map<number, string>();
    for (const row of editedNames) {
      const id = num(row, "playerid");
      if (id === null) continue;
      const name =
        str(row, "commonname") ??
        [str(row, "firstname"), str(row, "surname")].filter(Boolean).join(" ").trim();
      if (name) editedByPlayer.set(id, name);
    }

    // The in-game date is the newest dated row in the save. It is needed as the reference for age
    // derivation, so it must be computed BEFORE the squad sample is built. It used to be derived
    // afterwards, which forced age to fall back to a season-number guess.
    let latestDate = 0;
    for (const [table, field] of DATE_SOURCES) {
      for (const row of (extractedTables[table] as Row[]) ?? []) {
        const value = num(row, field);
        if (value !== null && value > latestDate) latestDate = value;
      }
    }

    // Prefer the real in-game date. Falling back to 31 Dec of the derived season year keeps the
    // month/day comparison from under-counting when the save holds no dated row (the old year-only
    // arithmetic effectively assumed the latest point in the season).
    const ageReferenceDate =
      (latestDate > 0 ? yyyymmddToDate(latestDate) : null) ??
      new Date(Date.UTC(2025 + (seasonCount ?? 0), 11, 31));

    const squadSample: SquadEntry[] = squadLinks.map((link) => {
      const playerId = num(link, "playerid");
      const player = playerId !== null ? playerById.get(playerId) : undefined;
      const contract = playerId !== null ? contractByPlayer.get(playerId) : undefined;

      let name = playerId !== null ? editedByPlayer.get(playerId) ?? null : null;
      let nameSource: SquadEntry["nameSource"] = name ? "edited-in-save" : "unresolved";
      if (!name && playerId !== null) {
        const imported = this.names.get(playerId);
        if (imported) {
          name = imported;
          nameSource = "imported-name-table";
        }
      }

      // Prefer the player's primary preference, then the team-sheet position. `preferredposition2`
      // is deliberately skipped (a secondary position must not outrank the team sheet) and
      // `players.position` does not exist. `-1` is the game's "no preference" sentinel, so it must
      // be filtered here rather than accepted by a `??` chain and mapped to UNKNOWN.
      const rawPosCode =
        [num(player, "preferredposition1"), num(link, "position")].find(
          (candidate): candidate is number => candidate !== null && candidate >= 0
        ) ?? null;
      const rawAge = num(player, "age");
      const birthdate = num(player, "birthdate");
      const computedAge = calculateAgeFromBirthdate(birthdate, rawAge, ageReferenceDate);
      // Null means the save did not say, which is different from "no real head". Only a definite
      // non-zero reading lets the face importer skip the network. The two related ids are kept
      // because they distinguish a real scanned head from a generic one.
      const headQuality = num(player, "hashighqualityhead");

      return {
        playerId: playerId ?? -1,
        name: name ?? `#${playerId ?? -1}`,
        nameSource,
        position: rawPosCode,
        primaryPosition: positionCodeToRole(rawPosCode),
        jersey: num(link, "jerseynumber"),
        overall: num(player, "overallrating") ?? num(link, "overallrating"),
        potential: num(player, "potential"),
        age: computedAge,
        birthdate,
        contractValidUntil:
          num(player, "contractvaliduntil") ?? num(contract, "contractvaliduntil"),
        wage: num(contract, "wage"),
        form: num(link, "form"),
        injury: num(link, "injury"),
        hasHighQualityHead: headQuality === null ? null : headQuality > 0,
        headAssetId: num(player, "headassetid"),
        avatarPomId: num(player, "avatarpomid"),
      };
    });

    /**
     * The unpromoted academy, resolved the same way a squad player is and collapsed to observed ranges.
     *
     * Name resolution follows `squadSample` exactly - edited names first, then the imported name
     * table - because an academy player is still a player and a second naming path would be a second
     * set of bugs. A prospect whose name the save does not hold keeps `null` rather than being given a
     * placeholder: `#460719` means nothing to a manager, and the sync stores the real reason instead.
     *
     * The academy table describes some prospects more than once and the rows disagree, with nothing in
     * the table to order them by. Every disagreeing field is therefore collapsed to the range observed
     * across his assessments rather than one row being picked as authoritative - picking would assert a
     * certainty the save does not carry. `assessmentCount` travels with the range so the UI can say how
     * many readings it rests on.
     *
     * Everything here is a SAVE fact. Nothing is derived or estimated; the range IS the save data.
     */
    const youthRowsByPlayer = new Map<number, Row[]>();
    for (const row of youthRows) {
      const id = num(row, "playerid");
      if (id === null) continue;
      const list = youthRowsByPlayer.get(id) ?? [];
      list.push(row);
      youthRowsByPlayer.set(id, list);
    }

    const observedRange = (rows: Row[], field: string): [number | null, number | null] => {
      const values = rows
        .map((row) => num(row, field))
        .filter((value): value is number => value !== null);
      if (values.length === 0) return [null, null];
      return [Math.min(...values), Math.max(...values)];
    };

    const youthProspects: YouthProspectRow[] = [...youthRowsByPlayer.entries()].map(
      ([playerId, rows]) => {
        const player = playerById.get(playerId);
        const history = youthHistoryByPlayer.get(playerId);

        let name = editedByPlayer.get(playerId) ?? null;
        let nameSource = name ? "edited-in-save" : "unresolved";
        if (!name) {
          const imported = this.names.get(playerId);
          if (imported) {
            name = imported;
            nameSource = "imported-name-table";
          }
        }

        // `-1` is the game's "no preference" sentinel, so it is filtered here rather than accepted by
        // a `??` chain and mapped to UNKNOWN - the same rule `squadSample` applies.
        const preferred = num(player, "preferredposition1");
        const rawPosCode = preferred !== null && preferred >= 0 ? preferred : null;
        const birthdate = num(player, "birthdate");

        const [tierLow, tierHigh] = observedRange(rows, "playertier");
        const [swingLowMin, swingLowMax] = observedRange(rows, "swinglowpotential");
        const [varianceMin, varianceMax] = observedRange(rows, "potentialvariance");
        const tenure = observedRange(rows, "monthsinsquad");

        return {
          playerId,
          name,
          nameSource,
          positionCode: rawPosCode,
          primaryPosition: positionCodeToRole(rawPosCode),
          age: calculateAgeFromBirthdate(birthdate, num(player, "age"), ageReferenceDate),
          birthdate,
          overallRating: num(player, "overallrating"),
          potentialRating: num(player, "potential"),
          tierLow,
          tierHigh,
          swingLowMin,
          swingLowMax,
          varianceMin,
          varianceMax,
          // Tenure only grows, so the highest reading is the best evidence; a range on it would imply he
          // might have been there for less time than we have already seen.
          monthsInSquad: tenure[1],
          assessmentCount: rows.length,
          goals: num(history, "goals"),
          appearances: num(history, "appearances"),
        };
      }
    );

    // ------------------------------------------------------------------ //
    // World player pool - taken UNREGISTERED and thrown away after use.    //
    // ------------------------------------------------------------------ //
    //
    // `players` above is squad-filtered, so the other 21,000-odd professionals in the save are never
    // read. Scouting needs them. Three things shape how they are taken:
    //
    //  1. Not registered in `extractedTables` (see `unregistered`) - that object feeds the payload
    //     hash, and 21k rows would make hashing the expensive part of every sync.
    //  2. A field allowlist, so a pool row is ~45 keys instead of 137.
    //  3. **No wages, deliberately.** `career_playercontract` declares 42 rows in this save - our own
    //     squad only - so a world player's value cannot be read and must be modelled from rating, age
    //     and potential. Wage data is not blended in anywhere: two confidence levels in one column is
    //     how a blended-provenance bug starts.
    const worldLinks = decodeTable("teamplayerlinks", {
      limit: 30_000,
      unregistered: true,
      fields: ["playerid", "teamid"],
    });

    const teamNameById = new Map<number, string>();
    for (const team of teams) {
      const id = num(team, "teamid");
      const name = str(team, "teamname");
      if (id !== null && name && !teamNameById.has(id)) teamNameById.set(id, name);
    }

    // One club per player, FIRST link wins. This save declares 22,240 links for 21,166 players, so
    // some hold more than one - a loan or a duplicate entry. Taking the last would let a player's
    // club silently change between syncs without the save changing.
    const clubByPlayer = new Map<number, number>();
    for (const link of worldLinks) {
      const playerId = num(link, "playerid");
      const teamId = num(link, "teamid");
      if (playerId === null || teamId === null) continue;
      if (!clubByPlayer.has(playerId)) clubByPlayer.set(playerId, teamId);
    }

    const worldRows = decodeTable("players", {
      limit: WORLD_POOL_LIMIT,
      unregistered: true,
      fields: WORLD_PLAYER_FIELDS,
      // Men's football only, filtered as the rows are read rather than afterwards. Any non-zero
      // gender is dropped, so a future third value cannot leak into the pool either.
      filter: (row) => Number(row.gender ?? 0) === 0,
    });

    // The save can carry the same player in more than one database block, so a raw decode contains
    // duplicates - and the unique index on (career, eaPlayerId) would reject the whole insert. Keep
    // the FIRST occurrence: the rows agree on every field the pool reads, and taking the first is what
    // `playerById` already does for the squad.
    const seenWorldPlayers = new Set<number>();
    const worldPlayers: WorldPlayerEntry[] = [];
    for (const row of worldRows) {
      const playerId = num(row, "playerid") ?? -1;
      if (playerId < 0 || seenWorldPlayers.has(playerId)) continue;
      seenWorldPlayers.add(playerId);

      const birthdate = num(row, "birthdate");
      const rawPosCode = num(row, "preferredposition1");
      const position = rawPosCode !== null && rawPosCode >= 0 ? rawPosCode : null;

      let name = editedByPlayer.get(playerId) ?? null;
      let nameSource: SquadEntry["nameSource"] = name ? "edited-in-save" : "unresolved";
      if (!name) {
        const imported = this.names.get(playerId);
        if (imported) {
          name = imported;
          nameSource = "imported-name-table";
        }
      }

      const clubId = clubByPlayer.get(playerId) ?? null;
      worldPlayers.push({
        playerId,
        name: name ?? `#${playerId}`,
        nameSource,
        clubId,
        clubName: clubId !== null ? teamNameById.get(clubId) ?? null : null,
        positionCode: position,
        primaryPosition: positionCodeToRole(position),
        overall: num(row, "overallrating"),
        potential: num(row, "potential"),
        age: calculateAgeFromBirthdate(birthdate, null, ageReferenceDate),
        birthdate,
        heightCm: num(row, "height"),
        weightKg: num(row, "weight"),
        nationalityId: num(row, "nationality"),
        contractValidUntil: num(row, "contractvaliduntil"),
        preferredFoot: num(row, "preferredfoot"),
        weakFoot: num(row, "weakfootabilitytypecode"),
        skillMoves: num(row, "skillmoves"),
        internationalRep: num(row, "internationalrep"),
        pace: { acceleration: num(row, "acceleration"), sprintSpeed: num(row, "sprintspeed") },
        shooting: {
          positioning: num(row, "positioning"),
          finishing: num(row, "finishing"),
          shotPower: num(row, "shotpower"),
          longShots: num(row, "longshots"),
          volleys: num(row, "volleys"),
          penalties: num(row, "penalties"),
        },
        passing: {
          vision: num(row, "vision"),
          crossing: num(row, "crossing"),
          freeKickAccuracy: num(row, "freekickaccuracy"),
          shortPassing: num(row, "shortpassing"),
          longPassing: num(row, "longpassing"),
          curve: num(row, "curve"),
        },
        dribbling: {
          agility: num(row, "agility"),
          balance: num(row, "balance"),
          reactions: num(row, "reactions"),
          ballControl: num(row, "ballcontrol"),
          dribbling: num(row, "dribbling"),
          composure: num(row, "composure"),
        },
        defending: {
          interceptions: num(row, "interceptions"),
          headingAccuracy: num(row, "headingaccuracy"),
          defensiveAwareness: num(row, "defspe"),
          standingTackle: num(row, "standingtackle"),
          slidingTackle: num(row, "slidingtackle"),
        },
        physical: {
          jumping: num(row, "jumping"),
          stamina: num(row, "stamina"),
          strength: num(row, "strength"),
          aggression: num(row, "aggression"),
        },
        goalkeeping: {
          diving: num(row, "gkdiving"),
          handling: num(row, "gkhandling"),
          kicking: num(row, "gkkicking"),
          positioning: num(row, "gkpositioning"),
          reflexes: num(row, "gkreflexes"),
        },
      });
    }

    const rated = squadSample.filter((entry) => entry.overall !== null);
    facts.push({
      provenance: SAVE_PROVENANCE,
      source: "teamplayerlinks (teamid = club)",
      label: "Squad size",
      value: squadSample.length,
      derived: true,
      category: "squads",
    });
    if (rated.length > 0) {
      const average = rated.reduce((sum, entry) => sum + (entry.overall ?? 0), 0) / rated.length;
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "players.overallrating",
        label: "Squad average OVR",
        value: Math.round(average * 10) / 10,
        derived: true,
        category: "ratings",
      });
    }

    const pref = managerPref[0];
    // `career_managerhistory` holds ONE ROW PER SEASON, each carrying that season's own biggest buy
    // and sale. Indexing [0] therefore reported season 1's deals as the career records forever.
    // The career record is the peak across every season, so reduce over all rows.
    // (`career_managerpref` and `career_managerinfo` really are single-row, so [0] is right there.)
    const peakAmount = (key: string): number =>
      managerHistory.reduce((max, row) => Math.max(max, num(row, key) ?? 0), 0);
    const managerPeaks: Row = {
      bigbuyamount: peakAmount("bigbuyamount"),
      bigsellamount: peakAmount("bigsellamount"),
    };
    const moneyFacts: [Row | undefined, string, string, FactCategory][] = [
      [pref, "career_managerpref.transferbudget", "Transfer budget", "finances"],
      [pref, "career_managerpref.wagebudget", "Wage budget", "finances"],
      [info, "career_managerinfo.totalearnings", "Manager total earnings", "finances"],
      [managerPeaks, "career_managerhistory.bigbuyamount", "Record buy", "finances"],
      [managerPeaks, "career_managerhistory.bigsellamount", "Record sale", "finances"],
    ];
    for (const [row, source, label, category] of moneyFacts) {
      const value = num(row, source.split(".")[1]);
      facts.push({
        provenance: SAVE_PROVENANCE,
        source,
        label,
        value,
        category,
        ...(value === 0 ? { note: "Reads 0 in reference saves." } : {}),
      });
    }

    const ratings = decodeTable("career_playermatchratinghistory", {
      limit: Math.max(this.options.rowLimit * 2, 200),
    });
    const presigned = decodeTable("career_presignedcontract", {
      limit: Math.max(this.options.rowLimit, 120),
    });
    // Decoded and then thrown away until now. These agreed fees are the only real market evidence
    // in the file: the game writes no player value anywhere, so any estimate has to be fitted on
    // what the world actually paid rather than on an invented price table.
    const presignedDeals: PresignedDeal[] = presigned
      .map((row) => {
        const playerId = num(row, "playerid");
        const offeredFee = num(row, "offeredfee");
        if (playerId === null || offeredFee === null || offeredFee <= 0) return null;
        return {
          playerId,
          offeredFee,
          offeredWage: num(row, "offeredwage"),
          signedDate: num(row, "signeddate"),
          completeDate: num(row, "completedate"),
          buyingTeamId: num(row, "teamid"),
          sellingTeamId: num(row, "offerteamid"),
          isLoanBuy: num(row, "isloanbuy") === 1,
          isExchangePlayer: num(row, "isexchangedplayer") === 1,
        } satisfies PresignedDeal;
      })
      .filter((deal): deal is PresignedDeal => deal !== null);
    // The save's own dated event log: 4 rows in the save we hold, so NOT empty, and not the
    // `mlop`/`mrni` fixture ledger (those are the blob readers below, which return null here). The
    // rows - `eventid`, `eventdate`, `team1id`, `team2id`, `player1id` - are a candidate feed for
    // the Timeline and are unused today, so this notes them rather than removing the decode: the
    // call is what registers the table in the feasibility report.
    //
    // It is also NOT a date source in practice, whatever `DATE_SOURCES` says: the in-game date is
    // computed further up (see `latestDate`), and `career_playermatchratinghistory`,
    // `career_presignedcontract` and this table are all decoded below that point, so today only
    // `career_playercontract.last_status_change_date` can feed it.
    decodeTable("persistent_events", { limit: Math.max(this.options.rowLimit, 200) });

    facts.push({
      provenance: SAVE_PROVENANCE,
      source: "career_playermatchratinghistory",
      label: "Per-player match ratings held",
      value: ratings.length,
      derived: true,
      category: "match-history",
    });

    const sections = blobSections(bytes);
    const fixtures = readFixtureLedger(bytes);
    const results = readLatestResults(
      bytes,
      (teamId) => leagueOfTeam.get(teamId) ?? null,
      (playerId) => squadPlayerIds.has(playerId)
    );

    if (fixtures) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "blob:mlop",
        label: "Fixtures in calendar",
        value: fixtures.length,
        derived: true,
        category: "match-history",
      });
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "blob:mlop (played rows)",
        label: "Played fixtures",
        value: fixtures.filter((f) => f.goalsA !== null && f.goalsB !== null).length,
        derived: true,
        category: "match-history",
      });
    }
    if (results) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "blob:mrni",
        label: "Latest round results",
        value: results.length,
        derived: true,
        category: "match-history",
      });
    }

    const estimatedDate = latestDate > 0 ? asDate(latestDate) : null;
    // Calendar year of the in-game date. `career_users.seasoncount` is only a 0-based season
    // counter within the career, which is why every career previously reported Season 1.
    const seasonYear = ageReferenceDate.getUTCFullYear();
    if (estimatedDate) {
      facts.push({
        provenance: SAVE_PROVENANCE,
        source: "max(eventdate, match rating dates, contract dates)",
        label: "In-game date (estimated)",
        value: estimatedDate,
        derived: true,
        category: "identity",
      });
    }

    const rawPayload: Record<string, unknown> = {
      headHex: fingerprint.headHex,
      container: fingerprint.container,
      sizeBytes: fingerprint.sizeBytes,
      signatureOffsets: fingerprint.signatureOffsets,
      decompressedFrom,
      databases: databases.map((db) => ({ index: db.index, bytes: db.bytes, tables: db.tableCount })),
      tableCount: tableStats.length,
      totalRows: tableStats.reduce((sum, stat) => sum + stat.rows, 0),
      blobTags: sections.map((section) => section.tag),
      metaSource: this.metaSource,
      nameTableSource: this.nameTableSource,
    };

    return {
      saveMetadata: {
        ...(managerName ? { managerName } : {}),
        ...(clubName ? { clubName } : {}),
        ...(estimatedDate ? { currentDate: estimatedDate } : {}),
        seasonYear,
      },
      rawPayload,
      extractedTables,
      fingerprint,
      metaSource: this.metaSource === "none" ? null : this.metaSource,
      nameTableSource: this.nameTableSource === "none" ? null : this.nameTableSource,
      databases,
      tableStats,
      unknownTables: [...new Set(unknownTables)],
      incompleteNames,
      truncatedTables,
      decodedTables,
      facts,
      squadSample,
      youthProspects,
      worldPlayers,
      blobSections: sections,
      fixtures,
      matchResults: results,
      seasonHistory,
      leagueDirectory,
      presignedDeals,
      warnings,
      parseMs: Math.round(performance.now() - startedAt),
    };
  }

  private fingerprint(bytes: Buffer): SaveFingerprint {
    const offsets = {
      db: bytes.indexOf(DB_HEADER),
      fbchunks: bytes.indexOf(FBCHUNKS_TAG),
      sqlite: bytes.indexOf(SQLITE_TAG),
      gzip: bytes.indexOf(GZIP_MAGIC),
      zlib: firstZlibOffset(bytes),
      lz4: bytes.indexOf(LZ4_FRAME_MAGIC),
    };

    let databaseBlocks = 0;
    let databaseBytes = 0;
    let cursor = offsets.db;
    while (cursor >= 0) {
      const size = bytes.readUInt32LE(cursor + DB_HEADER.length);
      if (size <= 0 || cursor + size > bytes.length) break;
      databaseBlocks++;
      databaseBytes += size;
      cursor = bytes.indexOf(DB_HEADER, cursor + size);
    }

    const container: SaveFingerprint["container"] =
      databaseBlocks > 0
        ? "db"
        : offsets.sqlite >= 0 && offsets.sqlite < 64
        ? "sqlite"
        : offsets.fbchunks >= 0 && offsets.fbchunks < 64
        ? "fbchunks"
        : offsets.gzip === 0
        ? "gzip"
        : offsets.zlib >= 0
        ? "zlib"
        : offsets.lz4 >= 0
        ? "lz4"
        : "unknown";

    return {
      container,
      headHex: bytes.subarray(0, 16).toString("hex"),
      sizeBytes: bytes.length,
      databaseBlocks,
      databaseBytes,
      blobSections: blobSections(bytes).length,
      hasSqliteHeader: offsets.sqlite >= 0 && offsets.sqlite < 64,
      hasFbChunksTag: offsets.fbchunks >= 0 && offsets.fbchunks < 64,
      hasGzipStream: offsets.gzip === 0,
      hasZlibStream: offsets.zlib >= 0,
      hasLz4Frame: offsets.lz4 >= 0,
      signatureOffsets: offsets,
    };
  }

  private tryInflate(bytes: Buffer): { bytes: Buffer; strategy: string; offset: number } | null {
    const gzipAt = bytes.indexOf(GZIP_MAGIC);
    if (gzipAt >= 0) {
      try {
        return { bytes: gunzipSync(bytes.subarray(gzipAt)), strategy: "gzip", offset: gzipAt };
      } catch {}
    }

    const zlibAt = firstZlibOffset(bytes);
    if (zlibAt >= 0) {
      try {
        return { bytes: inflateSync(bytes.subarray(zlibAt)), strategy: "zlib", offset: zlibAt };
      } catch {}
    }
    return null;
  }
}