/**
 * TouchlineOS — Phase 0 feasibility parser.
 * Reads FIFA/FC bit-packed DB\0\x08 blocks and tagged career blobs (mlop/mrni).
 */
import {
  asciiBytes,
  hexText,
  indexOfBytes,
  latin1Text,
  readUInt16LE,
  readUInt32LE,
} from "./bytes";

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
  type GameVersion,
  type IncompleteName,
  type LeagueEntry,
  type MatchResult,
  type ParseOptions,
  type Row,
  type SaveCandidate,
  type SaveFact,
  type SaveFingerprint,
  type SeasonHistoryRow,
  type YouthProspectRow,
  type PresignedDeal,
  type SlotFixture,
  type SpikeCareerData,
  type SquadEntry,
  type WorldPlayerEntry,
  type TableStat,
} from "./interface";
const DB_HEADER = new Uint8Array([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
const FBCHUNKS_TAG = asciiBytes("FBCHUNKS");
const SQLITE_TAG = asciiBytes("SQLite format 3\u0000");
const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b, 0x08]);
const LZ4_FRAME_MAGIC = new Uint8Array([0x04, 0x22, 0x4d, 0x18]);
const ZLIB_MAGICS = [
  new Uint8Array([0x78, 0x01]),
  new Uint8Array([0x78, 0x5e]),
  new Uint8Array([0x78, 0x9c]),
  new Uint8Array([0x78, 0xda]),
];

const FIELD_STRING = 0;
const FIELD_INT = 3;
const FIELD_FLOAT = 4;

const MAX_TABLE_COUNT = 4096;
const MAX_SCANNED_ROWS = 250_000;
const MAX_INCOMPLETE_NAMES = 200;

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

export class ByteReader {
  readonly bytes: Uint8Array;
  position: number;
  private readonly view: DataView;

  constructor(bytes: Uint8Array, position = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = position;
  }

  private require(bytes: number): number {
    const at = this.position;
    if (at < 0 || at + bytes > this.bytes.length) {
      throw new RangeError(`read of ${bytes} byte(s) at ${at} exceeds length ${this.bytes.length}`);
    }
    return at;
  }

  readUInt8(): number {
    const at = this.require(1);
    this.position = at + 1;
    return this.bytes[at];
  }

  readUInt16LE(): number {
    const at = this.require(2);
    this.position = at + 2;
    return this.view.getUint16(at, true);
  }

  readUInt32LE(): number {
    const at = this.require(4);
    this.position = at + 4;
    return this.view.getUint32(at, true);
  }

  readBytes(length: number): Uint8Array {
    const at = this.require(length);
    this.position = at + length;
    return this.bytes.subarray(at, at + length);
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

function decodeUtf8OrLatin1(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    text = latin1Text(bytes);
  }
  return text.replace(CONTROL_CHARS, "").trim();
}

export function decodeName(field: Uint8Array): DecodedName {
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
    fieldDepth: new Map(),
    fieldType: new Map(),
    fieldCountByTable: new Map(),
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
    meta.fieldCountByTable.set(tableName, 0);

    const fieldRe = /<field\b([^>]*)\/>/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRe.exec(body)) !== null) {
      const attrs = field[1];
      const fieldName = attrOf(attrs, "name");
      const fieldShort = attrOf(attrs, "shortname");
      if (!fieldName || !fieldShort) continue;

      meta.fieldNames.set(fieldShort, fieldName);
      perTable.set(fieldShort, fieldName);

      const declaredType = attrOf(attrs, "type") ?? "";
      const isInteger = declaredType.includes("INTEGER");
      const rangeLow = isInteger ? Number(attrOf(attrs, "rangelow") ?? 0) : 0;
      meta.fieldRange.set(tableName + fieldName, Number.isFinite(rangeLow) ? rangeLow : 0);

      const metaKey = `${tableName}\u0000${fieldShort}`;
      const declaredDepth = Number(attrOf(attrs, "depth") ?? NaN);
      if (Number.isFinite(declaredDepth)) meta.fieldDepth.set(metaKey, declaredDepth);
      const declaredFieldType = declaredType.includes("STRING")
        ? FIELD_STRING
        : declaredType.includes("FLOAT")
        ? FIELD_FLOAT
        : declaredType.includes("INTEGER")
        ? FIELD_INT
        : -1;
      if (declaredFieldType >= 0) meta.fieldType.set(metaKey, declaredFieldType);

      if (attrOf(attrs, "key") === "True") meta.primaryKeys.set(tableName, fieldName);
      meta.fieldCountByTable.set(tableName, (meta.fieldCountByTable.get(tableName) ?? 0) + 1);
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

/**
 * Every fifa_ng_db block in the save, in file order.
 *
 * The scan steps past the SIGNATURE, not past the declared size: FC27's career block and squads
 * block overlap (the career block's declared size covers the squads block's start), so advancing by
 * size silently stepped over the second database. A candidate is only kept when its header and
 * directory are structurally sound, so stepping by signature cannot admit payload false positives.
 */
export function unpackDatabases(save: Uint8Array): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  let offset = indexOfBytes(save, DB_HEADER);
  while (offset >= 0) {
    const size = readUInt32LE(save, offset + DB_HEADER.length);
    if (size > 0 && size <= save.length - offset) {
      const block = save.subarray(offset, offset + size);
      const plausible = DB_HEADER_VARIANTS.some((variant) => scoreDbHeaderVariant(block, variant) > 0);
      if (plausible) blocks.push(block);
    }
    offset = indexOfBytes(save, DB_HEADER, offset + DB_HEADER.length);
  }
  if (blocks.length === 0) {
    throw new Error("no fifa_ng_db block with a valid header was found");
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
  /** Layout/drift problems, forwarded to `parse()` so they reach the UI warning channel. */
  warnings: string[];
  /** How many tables were read with each descriptor layout. */
  layoutUsage: { classic16: number; compact9: number; fc27Long16: number };
}

/**
 * fifa_ng_db header arrangements found in real saves.
 *
 * FC25/FC26 - and the FC27 squads-side block - put the table count at +16 with the directory at
 * +24. The FC27 career-side block omits the 4-byte field at +12, so its count sits at +12 and its
 * directory at +20. Both are tried and the one whose directory actually parses wins; nothing is
 * assumed from the offset alone.
 */
const DB_HEADER_VARIANTS = [
  { id: "count@+16 dir@+24", countAt: 16, dirAt: 24 },
  { id: "count@+12 dir@+20", countAt: 12, dirAt: 20 },
] as const;

const DB_HEADER_TRAILER_BYTES = 4;

/**
 * Field-descriptor layouts.
 *
 * FC25/FC26: 16 bytes - type u32 / bit offset u32 / 4-char shortname / bit depth u32.
 * FC27: 9 bytes - 4-char shortname / 1-byte depth / bit offset u32. The type is not stored, so it
 * comes from the datasheet, and the descriptor array starts 8 bytes later in the table header.
 */
interface DescriptorLayout {
  id: "classic16" | "compact9" | "fc27Long16";
  /** Byte offset from the table header where the descriptor array starts. */
  base: number;
  stride: number;
  shortAt: number;
  bitOffsetAt: number;
  /** classic16 only. */
  typeAt?: number;
  /** classic16 only. */
  bitDepthAt?: number;
  /** compact9 / fc27Long16: where the encoded depth lives. */
  depthAt?: number;
  /** compact9 = 1 (u8), fc27Long16 = 4 (u32). */
  depthSize?: number;
}

const DESCRIPTOR_LAYOUTS: DescriptorLayout[] = [
  { id: "classic16", base: 36, stride: 16, shortAt: 8, typeAt: 0, bitOffsetAt: 4, bitDepthAt: 12 },
  { id: "compact9", base: 44, stride: 9, shortAt: 0, depthAt: 4, depthSize: 1, bitOffsetAt: 5 },
  // FC27 career-side tables: 16 bytes, shortname FIRST, depth as a u32 (string depths reach 640
  // bits, which cannot fit the compact u8) and the array starting 24 bytes into the header.
  { id: "fc27Long16", base: 24, stride: 16, shortAt: 0, depthAt: 4, depthSize: 4, bitOffsetAt: 12 },
];

/**
 * Share of a table's fields that must resolve in the datasheet before the compact layout is trusted.
 * Below this, the descriptor array is not where the layout expects it and the table is left to the
 * classic read rather than decoded from a misaligned field list.
 */
const COMPACT_MIN_RESOLVED_RATIO = 0.5;

interface DescriptorRead {
  fields: FieldDescriptor[];
  /** Fields whose shortname the datasheet declares for this table. */
  resolved: number;
  /** compact9 only: fields whose encoded depth contradicts the datasheet. */
  depthMismatches: string[];
  /** compact9 only: entries read with an 8-byte step. Never silent - each is reported. */
  recoveries: string[];
  /** Byte offset just past the descriptor array, so records start where the array actually ends. */
  endOffset: number;
  /**
   * Fields whose encoded depth COULD be compared with the datasheet, and how many agreed.
   *
   * Counted for every layout. This is the signal that identifies the correct layout: a wrong layout
   * reads garbage where the encoded depth lives, so its depths cannot agree. Counting is separate
   * from decoding and never changes a decoded type.
   */
  depthChecked: number;
  depthAgreed: number;
}

function isPrintableId(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  for (let index = 0; index < 4; index++) {
    const byte = bytes[index];
    if (byte < 0x21 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Reads one table's descriptors under a candidate layout.
 *
 * Nothing is coerced. Two things are handled explicitly rather than silently:
 *
 * - A compact descriptor whose encoded depth contradicts the datasheet decodes as an unknown type,
 *   so a disagreement yields a null value and a warning instead of a plausible-looking wrong number.
 * - The reference FC27 save contains a minority of compact entries that are 8 bytes rather than 9.
 *   An 8-byte step is taken ONLY when the 9-byte step would not put a printable id on the next
 *   boundary and the 8-byte step puts a datasheet-known id there. Every recovery is reported.
 */
function readDescriptors(
  block: Uint8Array,
  headerOffset: number,
  fieldCount: number,
  layout: DescriptorLayout,
  meta: DbMeta | null,
  tableName: string | null,
  /** Descriptor positions from a scanned grid. When given, the layout's stride is not used. */
  positions?: readonly number[]
): DescriptorRead {
  const fields: FieldDescriptor[] = [];
  const depthMismatches: string[] = [];
  const recoveries: string[] = [];
  let resolved = 0;
  let depthChecked = 0;
  let depthAgreed = 0;
  let cursor = headerOffset + layout.base;

  for (let index = 0; index < fieldCount; index++) {
    const at = positions ? positions[index] : cursor;
    if (at === undefined) break;
    if (at < 0 || at + 4 > block.length) break;

    const shortField = latin1Text(block.subarray(at + layout.shortAt, at + layout.shortAt + 4));
    const bitOffset = readUInt32LE(block, at + layout.bitOffsetAt);
    const metaKey = meta === null || tableName === null ? null : `${tableName}\u0000${shortField}`;
    const declaredDepth = metaKey === null ? undefined : meta!.fieldDepth.get(metaKey);
    const declaredType = metaKey === null ? undefined : meta!.fieldType.get(metaKey);
    let type: number;
    let bitDepth: number;

    if (layout.id === "classic16") {
      type = readUInt32LE(block, at + (layout.typeAt ?? 0));
      bitDepth = readUInt32LE(block, at + (layout.bitDepthAt ?? 12));
    } else {
      bitDepth =
        layout.depthSize === 4
          ? readUInt32LE(block, at + (layout.depthAt ?? 4))
          : block[at + (layout.depthAt ?? 4)];
      // The compact layout can only hold depths up to 255, so a longer declared depth (a string's
      // byte length in bits) is not comparable there. The long layout stores a full u32 and IS
      // comparable for every type.
      const comparable =
        declaredDepth !== undefined &&
        (layout.depthSize === 4 || (declaredType !== FIELD_STRING && declaredDepth <= 255));
      if (comparable && declaredDepth !== bitDepth) {
        depthMismatches.push(`${shortField} encoded depth ${bitDepth} vs datasheet ${declaredDepth}`);
        type = -1;
      } else {
        type = declaredType ?? -1;
      }
    }

    if (declaredDepth !== undefined) {
      depthChecked++;
      if (declaredDepth === bitDepth) depthAgreed++;
    }

    const known = tableName === null || meta === null ? undefined : fieldNameFor(meta, tableName, shortField);
    if (known !== undefined) resolved++;
    fields.push({
      type,
      bitOffset,
      bitDepth,
      shortName: shortField,
      key: known ?? `unk_${shortField}`,
      known: known !== undefined,
    });

    if (layout.id === "classic16" || positions) {
      cursor = at + layout.stride;
      continue;
    }

    const next8 = latin1Text(block.subarray(at + 8, at + 12));
    const next8Known =
      tableName !== null && meta !== null && fieldNameFor(meta, tableName, next8) !== undefined;
    if (!isPrintableId(block.subarray(at + 9, at + 13)) && next8Known) {
      recoveries.push(`${shortField} -> ${next8}`);
      cursor = at + 8;
    } else {
      cursor = at + 9;
    }
  }

  return { fields, resolved, depthMismatches, recoveries, endOffset: cursor, depthChecked, depthAgreed };
}

/**
 * Scores one DB header arrangement.
 *
 * Counts directory entries that name a printable table id AND point at a header whose record size
 * and field count are plausible. A wrong count offset cannot score here.
 */
function scoreDbHeaderVariant(block: Uint8Array, variant: (typeof DB_HEADER_VARIANTS)[number]): number {
  if (variant.countAt + 4 > block.length) return 0;
  const tableCount = readUInt32LE(block, variant.countAt);
  if (tableCount <= 0 || tableCount > MAX_TABLE_COUNT) return 0;
  const tablesStart = variant.dirAt + tableCount * 8 + DB_HEADER_TRAILER_BYTES;
  if (tablesStart > block.length) return 0;

  let score = 0;
  for (let index = 0; index < tableCount; index++) {
    const at = variant.dirAt + index * 8;
    if (!isPrintableId(block.subarray(at, at + 4))) continue;
    const headerOffset = tablesStart + readUInt32LE(block, at + 4);
    if (headerOffset + 36 > block.length) continue;
    const recordSize = readUInt32LE(block, headerOffset + 4);
    const fieldCount = block[headerOffset + 24];
    if (recordSize > 0 && recordSize <= 65_535 && fieldCount > 0 && fieldCount <= 255) score++;
  }
  return score;
}

/** Picks the DB header arrangement whose directory scores highest. */
function chooseDbHeaderVariant(block: Uint8Array): (typeof DB_HEADER_VARIANTS)[number] {
  let best: (typeof DB_HEADER_VARIANTS)[number] = DB_HEADER_VARIANTS[0];
  let bestScore = 0;
  for (const variant of DB_HEADER_VARIANTS) {
    const score = scoreDbHeaderVariant(block, variant);
    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// FC27 table localisation
// ---------------------------------------------------------------------------------------------
//
// In FC25/FC26 the directory offset lands on a table header, so `recordSize`, the row count and the
// field count are all READ AT A COMPUTED ADDRESS. FC27 does not work that way: the directory offset
// lands inside the record data, so nothing about a table can be computed from it.
//
// What IS stable is the descriptor array itself - a run of printable 4-char field ids. So a table is
// FOUND rather than computed:
//
//   1. scan the payload for candidate descriptor runs;
//   2. attribute a run to a table by how many of its ids the datasheet declares for that table;
//   3. take the header from the bytes immediately BEFORE the run. The header is only accepted when
//      its field-count byte equals the number of ids the same header's descriptor start produces AND
//      its record size / row count are physically possible. A candidate that fails is rejected, not
//      decoded, so a wrong header cannot silently produce rows.
//
// Step 2 deliberately does NOT require the datasheet's field count to equal the run length: the
// bundled datasheet is older than the FC27 save (it declares 137 player fields where the save stores
// 110), so exact-count matching rejects every array. The run length is authoritative for the field
// count, and the datasheet is only used to decide WHICH table a run belongs to.

/** Descriptor entry lengths observed inside a single array: compact 9, short 8, long 16 and 12. */
const DESCRIPTOR_STEPS = [9, 8, 16, 12] as const;

/** A header sits at most this far before the first descriptor. */
const HEADER_SEARCH_BACK = 64;
/** Descriptors start this many bytes into a header. */
const DESCRIPTOR_START_IN_HEADER = 36;

const MAX_RECORD_SIZE_BYTES = 50_000_000;
const MAX_ROW_COUNT = 200_000;

const GRID_MIN_IDS = 6;
const GRID_MAX_IDS = 512;
/** Share of a run's ids that must be datasheet fields of the table before the run is attributed. */
const GRID_MIN_COVERAGE = 0.5;
const GRID_MIN_MATCHED = 4;

interface GridRun {
  start: number;
  ids: string[];
  positions: number[];
}

/**
 * Length of the descriptor at `cursor`. Entry length varies WITHIN one array: `teams` (lyxL) mixes
 * 9-byte compact int entries with the longer form used by string fields (teamname's 480-bit depth
 * only fits a u32). The next id is whichever candidate step lands on a printable id.
 */
function nextDescriptorStep(block: Uint8Array, cursor: number): number {
  for (const step of DESCRIPTOR_STEPS) {
    const at = cursor + step;
    if (at + 4 <= block.length && isPrintableId(block.subarray(at, at + 4))) return at;
  }
  return -1;
}

function walkGrid(block: Uint8Array, start: number): GridRun {
  const ids: string[] = [];
  const positions: number[] = [];
  let cursor = start;
  while (
    ids.length < GRID_MAX_IDS &&
    cursor + 4 <= block.length &&
    isPrintableId(block.subarray(cursor, cursor + 4))
  ) {
    ids.push(latin1Text(block.subarray(cursor, cursor + 4)));
    positions.push(cursor);
    const next = nextDescriptorStep(block, cursor);
    if (next < 0) break;
    cursor = next;
  }
  return { start, ids, positions };
}

/** An id begins a run when no descriptor step from an earlier id lands exactly on it. */
function isGridStart(block: Uint8Array, at: number): boolean {
  for (const back of DESCRIPTOR_STEPS) {
    const before = at - back;
    if (before >= 0 && isPrintableId(block.subarray(before, before + 4))) return false;
  }
  return true;
}

function scanGrids(block: Uint8Array): GridRun[] {
  const runs: GridRun[] = [];
  for (let at = 0; at + 4 <= block.length; at++) {
    if (!isPrintableId(block.subarray(at, at + 4))) continue;
    if (!isGridStart(block, at)) continue;
    const run = walkGrid(block, at);
    if (run.ids.length >= GRID_MIN_IDS) runs.push(run);
  }
  return runs;
}

/** The datasheet's field shortnames per table, keyed by table NAME. */
function datasheetFieldSets(meta: DbMeta): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  const add = (key: string): void => {
    const separator = key.indexOf("\u0000");
    if (separator < 0) return;
    const table = key.slice(0, separator);
    let set = sets.get(table);
    if (set === undefined) {
      set = new Set<string>();
      sets.set(table, set);
    }
    set.add(key.slice(separator + 1));
  };
  for (const key of meta.fieldDepth.keys()) add(key);
  for (const key of meta.fieldType.keys()) add(key);
  return sets;
}

interface LocatedTable {
  headerOffset: number;
  fieldsRead: DescriptorRead;
  matched: number;
}

/** Modal descriptor length of a run, used to close the array where its last entry ends. */
function modalStep(positions: readonly number[]): number {
  const counts = new Map<number, number>();
  for (let index = 1; index < positions.length; index++) {
    const step = positions[index] - positions[index - 1];
    counts.set(step, (counts.get(step) ?? 0) + 1);
  }
  let best = 9;
  let bestCount = 0;
  for (const [step, count] of counts) {
    if (count > bestCount) {
      best = step;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Finds a table's header and descriptors by scanning its located run.
 *
 * The accepting test is exact, not heuristic: walking the variable-length descriptors from
 * `headerOffset + 36` must yield precisely the number of ids the header's own field-count byte
 * claims. `teams` validates as `recordSize=188 rows=870 fieldCount=110` in the reference FC27 save,
 * which is the same header the FC25/FC26 layout would have read at that address.
 */
function headerForRun(
  block: Uint8Array,
  run: GridRun,
  layout: DescriptorLayout,
  meta: DbMeta | null,
  tableName: string | null
): LocatedTable | null {
  const highest = run.start - DESCRIPTOR_START_IN_HEADER;
  for (let headerOffset = highest; headerOffset >= run.start - HEADER_SEARCH_BACK; headerOffset--) {
    if (headerOffset < 0 || headerOffset + DESCRIPTOR_START_IN_HEADER + 4 > block.length) continue;
    const recordSize = readUInt32LE(block, headerOffset + 4);
    if (recordSize === 0 || recordSize > MAX_RECORD_SIZE_BYTES) continue;
    const recordCount = block[headerOffset + 18] | (block[headerOffset + 19] << 8);
    if (recordCount >= MAX_ROW_COUNT) continue;

    const fieldCount = block[headerOffset + 24];
    if (fieldCount < GRID_MIN_IDS) continue;

    const declared = walkGrid(block, headerOffset + DESCRIPTOR_START_IN_HEADER);
    // The located run is the tail of this descriptor array, never a different array.
    const from = declared.positions.indexOf(run.start);
    if (from < 0) continue;
    if (declared.ids.length - from < run.ids.length) continue;
    let same = true;
    for (let index = 0; index < run.ids.length && same; index++) {
      same = declared.ids[from + index] === run.ids[index];
    }
    if (!same) continue;
    // The header's own field count has to describe the array it precedes. The count is a u8 and the
    // array can begin a few bytes after the descriptor start, so allow a small slack.
    if (Math.abs(declared.ids.length - fieldCount) > 3) continue;

    const recordBytes = recordCount * recordSize;
    if (!Number.isSafeInteger(recordBytes) || recordBytes > block.length) continue;

    const fieldsRead: DescriptorRead = {
      ...readDescriptors(block, headerOffset, fieldCount, layout, meta, tableName, declared.positions),
      endOffset: declared.positions[declared.positions.length - 1] + modalStep(declared.positions),
    };
    return { headerOffset, fieldsRead, matched: run.ids.length };
  }
  return null;
}

/**
 * Attributes a descriptor run to a table.
 *
 * A run belongs to the table whose datasheet declares the most of its ids, and only if those ids are
 * also a majority of the run: a merged run that happens to contain a table's whole field list still
 * has to be mostly that table. The bundling is why the datasheet's declared field count is NOT used
 * as the test - it is stale for FC27 and would reject every array.
 */
function bestRunFor(
  runs: readonly GridRun[],
  fields: Set<string> | undefined
): { run: GridRun; matched: number } | null {
  if (fields === undefined || fields.size === 0) return null;
  let best: { run: GridRun; matched: number } | null = null;
  for (const run of runs) {
    if (run.ids.length > fields.size * 2 + 16) continue;
    let matched = 0;
    for (const id of run.ids) if (fields.has(id)) matched++;
    if (matched < GRID_MIN_MATCHED) continue;
    if (matched < run.ids.length * GRID_MIN_COVERAGE) continue;
    if (best === null || matched > best.matched) best = { run, matched };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// FC27 backwards anchoring, sample-row foreign keys and soft hypothesis ranking
// ---------------------------------------------------------------------------------------------
//
// A merged run breaks plain localisation: `players` and `manager` share one printable run, so the run
// start is NOT the array start and the header immediately before it belongs to neither table. That is
// exactly what the parenthesised warning "could not localise players" reports.
//
// The array start is therefore FOUND, not assumed. Walking backwards from the located run yields
// every position a variable-length array could begin at, and each one becomes a HYPOTHESIS. No single
// signal has to be right, because hypotheses are scored softly and the best one wins:
//
//   lead-field proximity  a known lead field in the first 5 descriptors
//   capacity sanity       rowCount * recordSize fits the block
//   descriptor continuity the header's own field count describes the walk from that anchor
//   foreign-key oracle    sampled `teamid` values resolve against the decoded `teams` table
//
// Soft scoring is what survives EA reordering fields between releases: `players` in FC27 stores 110
// fields where the bundled datasheet declares 137, so an exact signature would reject every array.

/**
 * Lead-field signatures per target table, in the order EA writes them. Matched on the NORMALISED
 * datasheet name (lowercase, alphanumerics only) so case and punctuation cannot hide a lead field.
 */
const LEAD_FIELD_SIGNATURES: Record<string, readonly string[]> = {
  players: ["playerid", "firstname", "surname", "commonname", "birthdate"],
  manager: ["managerid", "firstname", "surname", "teamid", "nationality"],
  // Same manager row under its FC27 career-side table name.
  career_managerinfo: ["managerid", "firstname", "surname", "teamid", "nationality"],
  career_youthplayers: ["youthplayerid", "firstname", "surname", "rating"],
  cm_teamsheets: ["teamsheetid", "teamid", "formationid"],
};

/** Field names that carry a club id, used for the foreign-key oracle. */
const FOREIGN_KEY_FIELDS: readonly string[] = [
  "teamid",
  "clubid",
  "currentteamid",
  "contractteamid",
];

/** How far back a descriptor array may start from a located run, in descriptors. */
const ANCHOR_MAX_STEPS = 150;
/** Hard cap on the breadth-first backwards walk, so dense record data cannot make it unbounded. */
const ANCHOR_MAX_CANDIDATES = 4_000;
/** A lead field must appear within this many descriptors of the array start to earn proximity credit. */
const LEAD_FIELD_WINDOW = 5;
/** Rows decoded to evaluate a hypothesis' club ids. */
const SAMPLE_ROWS = 10;
/** A candidate record size above this cannot come from a table header. */
const HYPOTHESIS_MAX_RECORD_SIZE = 10_000;
/** A header's field count and the walk from its descriptor start may disagree by at most this. */
const HYPOTHESIS_FIELD_SLACK = 3;

const SCORE_LEAD_FIRST = 40;
const SCORE_LEAD_NEAR = 30;
const SCORE_CAPACITY = 25;
const SCORE_CONTINUITY = 20;
const SCORE_FK_STRONG = 30;
const SCORE_FK_GOOD = 20;
const SCORE_FK_WEAK = 10;
const FK_STRONG_RATE = 0.8;
const FK_GOOD_RATE = 0.6;
const FK_WEAK_RATE = 0.4;
/** A hypothesis must clear this, AND show descriptor continuity, to displace the ordinary read. */
const HYPOTHESIS_MIN_SCORE = 55;
/** Cap on how many hypotheses get the (expensive) sample-row foreign-key check. */
const FK_SAMPLE_LIMIT = 24;

function normaliseFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The shortnames of a table's lead fields, resolved through the datasheet. */
function leadingFieldShorts(meta: DbMeta, tableName: string): Set<string> {
  const shorts = new Set<string>();
  const signature = LEAD_FIELD_SIGNATURES[tableName];
  if (signature === undefined) return shorts;
  const perTable = meta.fieldNamesByTable.get(tableName);
  if (perTable === undefined) return shorts;
  const wanted = new Set(signature.map(normaliseFieldName));
  for (const [short, human] of perTable) {
    if (wanted.has(normaliseFieldName(human))) shorts.add(short);
  }
  return shorts;
}

/**
 * Positions an array could start at, found by walking BACKWARDS from a located run.
 *
 * Descriptor length varies, so walking backwards branches: every position reachable by stepping 8, 9,
 * 12 or 16 bytes back from an already-reachable position is itself reachable. Breadth-first, so the
 * nearest - and most likely - anchors are produced first.
 */
function backwardAnchors(block: Uint8Array, from: number): number[] {
  const anchors: number[] = [from];
  const seen = new Set<number>([from]);
  let frontier: number[] = [from];
  for (let step = 0; step < ANCHOR_MAX_STEPS && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const at of frontier) {
      for (const back of DESCRIPTOR_STEPS) {
        const candidate = at - back;
        if (candidate < 0 || seen.has(candidate)) continue;
        seen.add(candidate);
        if (!isPrintableId(block.subarray(candidate, candidate + 4))) continue;
        anchors.push(candidate);
        next.push(candidate);
        if (anchors.length >= ANCHOR_MAX_CANDIDATES) return anchors;
      }
    }
    frontier = next;
  }
  return anchors;
}

/** The row key of the club-id field, when the table has one. */
function foreignKeyOf(fields: readonly FieldDescriptor[]): string | null {
  for (const field of fields) {
    if (!field.known) continue;
    if (FOREIGN_KEY_FIELDS.includes(normaliseFieldName(field.key))) return field.key;
  }
  return null;
}

/** Rows a header can actually hold before the block runs out. */
function blockCapacity(block: Uint8Array, recordsStart: number, recordSize: number): number {
  if (recordSize <= 0) return 0;
  return Math.max(0, Math.floor((block.length - recordsStart) / recordSize));
}

interface Hypothesis {
  arrayStart: number;
  headerOffset: number;
  recordSize: number;
  rowCount: number;
  fieldCount: number;
  layout: DescriptorLayout;
  read: DescriptorRead;
  leadFieldPosition: number;
  capacitySanity: boolean;
  descriptorContinuity: boolean;
  teamIdRate: number | null;
  score: number;
}

/**
 * Every array start reachable backwards from `run`, paired with every plausible header in the window
 * `[arrayStart - 64, arrayStart - 36]`.
 *
 * Candidates are hard-filtered only on physical impossibility (record size above 10 KB, or rows that
 * cannot fit the block). Everything else is left to the score, which is the point of soft evaluation.
 */
function buildHypotheses(
  block: Uint8Array,
  run: GridRun,
  meta: DbMeta,
  tableName: string,
  leadShorts: ReadonlySet<string>
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];
  for (const arrayStart of backwardAnchors(block, run.start)) {
    const walk = walkGrid(block, arrayStart);
    if (walk.ids.length < GRID_MIN_IDS) continue;
    // The located run has to be part of this array, or the anchor is not its start.
    if (!walk.positions.includes(run.start)) continue;

    const leadFieldPosition = walk.ids.findIndex((id) => leadShorts.has(id));

    for (
      let headerOffset = arrayStart - DESCRIPTOR_START_IN_HEADER;
      headerOffset >= arrayStart - HEADER_SEARCH_BACK;
      headerOffset--
    ) {
      if (headerOffset < 0 || headerOffset + DESCRIPTOR_START_IN_HEADER + 4 > block.length) continue;
      const recordSize = readUInt32LE(block, headerOffset + 4);
      if (recordSize === 0 || recordSize > HYPOTHESIS_MAX_RECORD_SIZE) continue;
      const rowCount = block[headerOffset + 18] | (block[headerOffset + 19] << 8);
      if (rowCount === 0) continue;
      const declaredFields = block[headerOffset + 24];
      if (declaredFields < GRID_MIN_IDS) continue;

      const descriptorContinuity =
        Math.abs(walk.ids.length - declaredFields) <= HYPOTHESIS_FIELD_SLACK;
      const fieldCount = descriptorContinuity ? declaredFields : walk.ids.length;

      // FC27 career tables put the shortname first and encode the depth as a u8 (compact) or a u32
      // (needed where a string depth exceeds 255). Both are read and the better-resolving one wins,
      // exactly as the ordinary path does.
      let best: { layout: DescriptorLayout; read: DescriptorRead } | null = null;
      for (const layout of [DESCRIPTOR_LAYOUTS[1], DESCRIPTOR_LAYOUTS[2]]) {
        const read = readDescriptors(
          block,
          headerOffset,
          fieldCount,
          layout,
          meta,
          tableName,
          walk.positions
        );
        if (best === null || read.resolved > best.read.resolved) best = { layout, read };
      }
      if (best === null) continue;

      const last = walk.positions[walk.positions.length - 1];
      const read: DescriptorRead = {
        ...best.read,
        endOffset: last + modalStep(walk.positions),
      };
      if (blockCapacity(block, read.endOffset, recordSize) === 0) continue;

      hypotheses.push({
        arrayStart,
        headerOffset,
        recordSize,
        rowCount,
        fieldCount: read.fields.length,
        layout: best.layout,
        read,
        leadFieldPosition,
        capacitySanity: rowCount * recordSize <= block.length,
        descriptorContinuity,
        teamIdRate: null,
        score: 0,
      });
    }
  }
  return hypotheses;
}

/**
 * Share of a hypothesis' sampled rows whose club id resolves to a real team.
 *
 * Rows with no club id at all are not counted either way: free agents and unassigned ids are
 * legitimate, so they must not be allowed to sink a correct hypothesis.
 */
function sampleTeamIdRate(
  block: Uint8Array,
  hypothesis: Hypothesis,
  meta: DbMeta,
  shortName: string,
  tableName: string,
  teamsIds: ReadonlySet<number>
): number | null {
  const fields = hypothesis.read.fields.slice().sort((a, b) => a.bitOffset - b.bitOffset);
  const key = foreignKeyOf(fields);
  if (key === null) return null;

  const capacity = blockCapacity(block, hypothesis.read.endOffset, hypothesis.recordSize);
  const rows = Math.min(hypothesis.rowCount, SAMPLE_ROWS, capacity);
  if (rows <= 0) return 0;

  const header: TableHeader = {
    shortName,
    tableName,
    headerOffset: hypothesis.headerOffset,
    recordsStart: hypothesis.read.endOffset,
    recordSize: hypothesis.recordSize,
    recordCount: rows,
    fieldCount: hypothesis.fieldCount,
    fields,
    unknownFields: [],
  };

  let sample: RowRead;
  try {
    sample = decodeRows(block, header, meta, { limit: rows });
  } catch {
    return 0;
  }
  if (sample.rows.length === 0) return 0;

  let seen = 0;
  let hits = 0;
  for (const row of sample.rows) {
    const value = row[key];
    if (typeof value !== "number") continue;
    seen++;
    if (value > 0 && teamsIds.has(value)) hits++;
  }
  return seen === 0 ? 0 : hits / seen;
}

/**
 * Scores every hypothesis and returns them best-first.
 *
 * The foreign-key check is the expensive part, so it is only applied to structurally sound
 * hypotheses (descriptor continuity) and is capped; a hypothesis that never gets sampled simply
 * scores on structure alone rather than being penalised for the cap.
 */
function scoreHypotheses(
  block: Uint8Array,
  hypotheses: Hypothesis[],
  meta: DbMeta,
  shortName: string,
  tableName: string,
  teamsIds: ReadonlySet<number> | null
): Hypothesis[] {
  let sampled = 0;
  for (const hypothesis of hypotheses) {
    let score = 0;
    if (hypothesis.leadFieldPosition === 0) score += SCORE_LEAD_FIRST;
    else if (hypothesis.leadFieldPosition > 0 && hypothesis.leadFieldPosition < LEAD_FIELD_WINDOW) {
      score += SCORE_LEAD_NEAR;
    }
    if (hypothesis.capacitySanity) score += SCORE_CAPACITY;
    if (hypothesis.descriptorContinuity) score += SCORE_CONTINUITY;

    if (teamsIds !== null && hypothesis.descriptorContinuity && sampled < FK_SAMPLE_LIMIT) {
      sampled++;
      hypothesis.teamIdRate = sampleTeamIdRate(block, hypothesis, meta, shortName, tableName, teamsIds);
      const rate = hypothesis.teamIdRate;
      if (rate !== null) {
        if (rate >= FK_STRONG_RATE) score += SCORE_FK_STRONG;
        else if (rate >= FK_GOOD_RATE) score += SCORE_FK_GOOD;
        else if (rate >= FK_WEAK_RATE) score += SCORE_FK_WEAK;
      }
    }

    hypothesis.score = score;
  }
  return hypotheses.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.descriptorContinuity) - Number(a.descriptorContinuity) ||
      b.fieldCount - a.fieldCount
  );
}

/** What the directory address produced for one table, before any hypothesis ranking. */
interface ResolvedEntry {
  headerOffset: number;
  recordSize: number;
  recordCount: number;
  fieldCount: number;
  layout: DescriptorLayout;
  read: DescriptorRead;
  /** True when the values came from a validated located header rather than the directory address. */
  located: boolean;
}

/**
 * Reads one table the ordinary way: the directory address first, then validated localisation when the
 * address does not resolve.
 *
 * Returns null when no field count could be established at all, which is how a table ends up in
 * `unknownTables` rather than in the decoded set.
 */
function resolveEntry(
  block: Uint8Array,
  meta: DbMeta | null,
  tableName: string | null,
  entry: { shortName: string; offset: number },
  tablesStart: number,
  runs: () => GridRun[],
  fieldsFor: (name: string) => Set<string> | undefined,
  warnings: string[]
): ResolvedEntry | null {
  let headerOffset = tablesStart + entry.offset;
  if (headerOffset + 36 > block.length) headerOffset = Math.max(0, block.length - 36);
  let recordSize = readUInt32LE(block, headerOffset + 4);
  let recordCount = block[headerOffset + 18] | (block[headerOffset + 19] << 8);
  let fieldCount = block[headerOffset + 24];
  const addressed = fieldCount > 0 && fieldCount <= 4096 ? fieldCount : 0;

  // Every layout is read and scored by how many field shortnames the datasheet declares for THIS
  // table. A tie keeps the classic layout, so FC25/FC26 decoding cannot change. The FC27 layouts are
  // additionally gated on resolving at least half the fields: a table whose descriptor array does
  // not sit where a layout expects it must NOT be read with that layout, because a plausible-looking
  // wrong field list is exactly the silent corruption to avoid.
  // Every layout is read and scored. DEPTH AGREEMENT decides, because a layout that is wrong about
  // where the descriptors start still reads the 4-char shortnames - they sit at the same offset in
  // both FC27 layouts - so counting resolvable names alone cannot tell the correct layout from one
  // that reads garbage where the encoded depth lives. Depths, unlike names, cannot agree by accident.
  //
  // A tie keeps the classic layout and the resolved-count rule still applies, so FC25/FC26 decoding
  // is unchanged: those saves have no depth evidence to prefer anything else, and a save whose
  // datasheet is stale ties at zero.
  const compactFloor = Math.ceil(addressed * COMPACT_MIN_RESOLVED_RATIO);
  let chosen = {
    layout: DESCRIPTOR_LAYOUTS[0],
    read: readDescriptors(block, headerOffset, addressed, DESCRIPTOR_LAYOUTS[0], meta, tableName),
  };
  if (addressed > 0) {
    for (const layout of DESCRIPTOR_LAYOUTS.slice(1)) {
      const read = readDescriptors(block, headerOffset, addressed, layout, meta, tableName);
      const better =
        read.depthAgreed > chosen.read.depthAgreed ||
        (read.depthAgreed === chosen.read.depthAgreed &&
          read.resolved >= compactFloor &&
          read.resolved > chosen.read.resolved);
      if (better) {
        chosen = { layout, read };
      }
    }
  }

  let located = false;
  if (meta !== null && tableName !== null && chosen.read.resolved < Math.max(addressed, GRID_MIN_IDS)) {
    const best = bestRunFor(runs(), fieldsFor(tableName));
    if (best === null) {
      warnings.push(`FC27 found no descriptor run for ${tableName}.`);
    } else {
      let foundBest: LocatedTable | null = null;
      let foundLayout = chosen.layout;
      for (const candidate of [DESCRIPTOR_LAYOUTS[1], DESCRIPTOR_LAYOUTS[2]]) {
        const found = headerForRun(block, best.run, candidate, meta, tableName);
        if (found === null) continue;
        if (foundBest === null || found.fieldsRead.resolved > foundBest.fieldsRead.resolved) {
          foundBest = found;
          foundLayout = candidate;
        }
      }
      if (foundBest !== null && foundBest.fieldsRead.resolved > chosen.read.resolved - 1) {
        headerOffset = foundBest.headerOffset;
        recordSize = readUInt32LE(block, headerOffset + 4);
        recordCount = block[headerOffset + 18] | (block[headerOffset + 19] << 8);
        fieldCount = block[headerOffset + 24];
        chosen = { layout: foundLayout, read: foundBest.fieldsRead };
        located = true;
        warnings.push(
          `FC27 localised ${tableName}: ${fieldCount} descriptors at ${headerOffset}, ` +
            `recordSize ${recordSize}, ${recordCount} rows.`
        );
      } else {
        warnings.push(
          `FC27 could not localise ${tableName} (run of ${best.run.ids.length} ids at ${best.run.start}); ` +
            `ranking hypotheses instead.`
        );
      }
    }
  }

  if (fieldCount <= 0) return null;
  return { headerOffset, recordSize, recordCount, fieldCount, layout: chosen.layout, read: chosen.read, located };
}

/**
 * Decodes `teams` and returns its id set, so a candidate table's club ids can be checked against real
 * clubs. Returns null when `teams` itself could not be decoded, in which case the foreign-key signal
 * is not scored at all rather than guessed at.
 */
function buildTeamsOracle(
  block: Uint8Array,
  meta: DbMeta,
  shortName: string,
  resolved: ResolvedEntry
): Set<number> | null {
  const fields = resolved.read.fields.slice().sort((a, b) => a.bitOffset - b.bitOffset);
  const key = foreignKeyOf(fields) ?? "teamid";
  const capacity = blockCapacity(block, resolved.read.endOffset, resolved.recordSize);
  const rows = Math.min(resolved.recordCount, capacity);
  if (rows <= 0) return null;

  const header: TableHeader = {
    shortName,
    tableName: "teams",
    headerOffset: resolved.headerOffset,
    recordsStart: resolved.read.endOffset,
    recordSize: resolved.recordSize,
    recordCount: rows,
    fieldCount: resolved.fieldCount,
    fields,
    unknownFields: [],
  };

  try {
    const read = decodeRows(block, header, meta, { limit: rows, fields: [key] });
    const ids = new Set<number>();
    for (const row of read.rows) {
      const value = row[key];
      if (typeof value === "number" && value > 0) ids.add(value);
    }
    return ids.size > 0 ? ids : null;
  } catch {
    return null;
  }
}

export function readTableHeaders(block: Uint8Array, meta: DbMeta | null, database: number): HeaderRead {
  const declaredSize = readUInt32LE(block, DB_HEADER.length);
  if (declaredSize !== block.length) {
    throw new Error(`database size mismatch: header says ${declaredSize}, block is ${block.length}`);
  }

  const variant = chooseDbHeaderVariant(block);
  const tableCount = readUInt32LE(block, variant.countAt);
  if (tableCount <= 0 || tableCount > MAX_TABLE_COUNT) {
    throw new Error(`database declares ${tableCount} tables`);
  }

  const entries: { shortName: string; offset: number }[] = [];
  for (let index = 0; index < tableCount; index++) {
    const at = variant.dirAt + index * 8;
    entries.push({
      shortName: latin1Text(block.subarray(at, at + 4)),
      offset: readUInt32LE(block, at + 4),
    });
  }
  const tablesStart = variant.dirAt + tableCount * 8 + DB_HEADER_TRAILER_BYTES;

  const headers: TableHeader[] = [];
  const unknownTables: string[] = [];
  const stats: TableStat[] = [];
  const warnings: string[] = [];
  const layoutUsage = { classic16: 0, compact9: 0, fc27Long16: 0 };

  // Scanning the payload is only done when a table's address-read descriptors fail to resolve, so
  // FC25/FC26 saves never pay for it.
  let gridRuns: GridRun[] | null = null;
  const runs = (): GridRun[] => (gridRuns ??= scanGrids(block));
  let fieldSets: Map<string, Set<string>> | null = null;
  const fieldsFor = (name: string): Set<string> | undefined =>
    (fieldSets ??= meta === null ? new Map() : datasheetFieldSets(meta)).get(name);

  const resolved: (ResolvedEntry | null)[] = entries.map((entry) =>
    resolveEntry(
      block,
      meta,
      meta?.tableNames.get(entry.shortName) ?? null,
      entry,
      tablesStart,
      runs,
      fieldsFor,
      warnings
    )
  );

  // The foreign-key oracle needs `teams`, so it is built once, up front, from whichever entry
  // resolves to it. When `teams` itself cannot be decoded the club-id signal is not scored at all.
  let teamsIds: Set<number> | null = null;
  if (meta !== null) {
    for (let index = 0; index < entries.length && teamsIds === null; index++) {
      if (meta.tableNames.get(entries[index].shortName) !== "teams") continue;
      const teams = resolved[index];
      if (teams !== null) teamsIds = buildTeamsOracle(block, meta, entries[index].shortName, teams);
    }
  }

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const tableName = meta?.tableNames.get(entry.shortName) ?? null;
    let current = resolved[index];

    // Target tables additionally get backwards-anchored hypotheses. A merged run leaves the plain
    // localiser with nothing, and even where localisation succeeded a scored hypothesis can be
    // better, so both are compared on rows produced.
    if (current !== null && meta !== null && tableName !== null) {
      if (LEAD_FIELD_SIGNATURES[tableName] !== undefined) {
        const best = bestRunFor(runs(), fieldsFor(tableName));
        if (best === null) {
          warnings.push(`FC27 ranked no hypotheses for ${tableName}: no run attributed to its fields.`);
        } else {
          const ranked = scoreHypotheses(
            block,
            buildHypotheses(block, best.run, meta, tableName, leadingFieldShorts(meta, tableName)),
            meta,
            entry.shortName,
            tableName,
            teamsIds
          );
          const top = ranked
            .slice(0, 3)
            .map(
              (h) =>
                `${h.score}@${h.arrayStart} fc=${h.fieldCount} rows=${h.rowCount} ` +
                `cont=${Number(h.descriptorContinuity)} lead=${h.leadFieldPosition} ` +
                `fk=${h.teamIdRate === null ? "n/a" : h.teamIdRate.toFixed(2)}`
            )
            .join(" | ");
          warnings.push(
            `FC27 ranked ${ranked.length} hypotheses for ${tableName} from run ` +
              `${best.run.ids.length}@${best.run.start}; top: ${top}`
          );
          const winner = ranked[0];
          if (winner !== undefined && winner.descriptorContinuity && winner.score >= HYPOTHESIS_MIN_SCORE) {
            const rows = Math.min(
              winner.rowCount,
              blockCapacity(block, winner.read.endOffset, winner.recordSize)
            );
            if (rows > current.recordCount) {
              warnings.push(
                `FC27 ranked ${ranked.length} hypotheses for ${tableName}; accepted the anchor at ` +
                  `${winner.arrayStart} (header ${winner.headerOffset}, score ${winner.score}, ` +
                  `${winner.fieldCount} fields, ${rows} rows, club-id rate ` +
                  `${winner.teamIdRate === null ? "n/a" : winner.teamIdRate.toFixed(2)}).`
              );
              current = {
                headerOffset: winner.headerOffset,
                recordSize: winner.recordSize,
                recordCount: rows,
                fieldCount: winner.fieldCount,
                layout: winner.layout,
                read: winner.read,
                located: true,
              };
            } else {
              warnings.push(
                `FC27 ranked ${ranked.length} hypotheses for ${tableName}; kept the ordinary read ` +
                  `(${current.recordCount} rows beats the best hypothesis' ${rows}).`
              );
            }
          }
        }
      }
    }

    if (current === null) {
      unknownTables.push(entry.shortName);
      continue;
    }
    if (tableName === null) unknownTables.push(entry.shortName);

    const layout = current.layout;
    const fieldsRead = current.read;
    const { headerOffset, recordSize, fieldCount } = current;
    let recordCount = current.recordCount;
    layoutUsage[layout.id]++;

    for (const mismatch of fieldsRead.depthMismatches) {
      warnings.push(`FC27 descriptor drift: ${tableName ?? entry.shortName}.${mismatch}`);
    }
    for (const recovery of fieldsRead.recoveries) {
      warnings.push(
        `FC27 compact descriptor: ${tableName ?? entry.shortName} read an 8-byte entry (${recovery})`
      );
    }
    if (fieldsRead.fields.length < fieldCount) {
      warnings.push(
        `Table ${tableName ?? entry.shortName}: only ${fieldsRead.fields.length} of ${fieldCount} descriptors fit the block`
      );
    }

    // Records must fit inside the database block. A scanned array can carry a header prefix that is
    // not this table's, so clamp the row count to what the block can actually hold and report the
    // clamp instead of reading past the end of the database.
    if (recordSize > 0) {
      const capacity = blockCapacity(block, fieldsRead.endOffset, recordSize);
      if (recordCount > capacity) {
        warnings.push(
          `Table ${tableName ?? entry.shortName}: row count ${recordCount} exceeds the ${capacity} ` +
            `rows this block can hold; clamped.`
        );
        recordCount = capacity;
      }
    } else if (recordCount > 0) {
      warnings.push(`Table ${tableName ?? entry.shortName}: record size is 0; row count forced to 0.`);
      recordCount = 0;
    }

    // Any FC27 field the bundled datasheet does not declare is kept as an unknown field rather than
    // dropped, so a renamed or brand-new column is visible instead of silently missing.
    const fields = fieldsRead.fields.slice().sort((a, b) => a.bitOffset - b.bitOffset);
    const unknownFields = fields.filter((field) => !field.known).map((field) => field.shortName);

    headers.push({
      shortName: entry.shortName,
      tableName,
      headerOffset,
      recordsStart: fieldsRead.endOffset,
      recordSize,
      recordCount,
      fieldCount,
      fields,
      unknownFields,
    });

    stats.push({
      tableName,
      shortName: entry.shortName,
      database,
      rows: recordCount,
      fields: fieldCount,
      recordSize,
      unknownFields,
    });
  }

  return { headers, unknownTables, stats, warnings, layoutUsage };
}

interface RowRead {
  rows: Row[];
  scanned: number;
  kept: number;
  complete: boolean;
  incompleteNames: IncompleteName[];
}

export function decodeRows(
  block: Uint8Array,
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

  const reader = new ByteReader(block, header.recordsStart);
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

function blobStart(save: Uint8Array): number {
  let at = indexOfBytes(save, DB_HEADER);
  if (at < 0) return -1;
  let past = 0;
  while (at >= 0) {
    const size = readUInt32LE(save, at + DB_HEADER.length);
    if (size <= 0 || at + size > save.length) break;
    past = at + size;
    at = indexOfBytes(save, DB_HEADER, past);
  }
  return past;
}

export function blobSections(save: Uint8Array): BlobSectionInfo[] {
  const from = blobStart(save);
  if (from <= 0) return [];

  const marks: { tag: string; at: number }[] = [];
  for (let i = from; i < save.length - 12; i++) {
    if (save[i] !== 0x01 || readUInt32LE(save, i + 1) !== 4) continue;
    const tag = latin1Text(save.subarray(i + 5, i + 9));
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

export function readFixtureLedger(save: Uint8Array): SlotFixture[] | null {
  const section = blobSections(save).find((s) => s.tag === "mlop");
  if (!section) return null;

  const out: SlotFixture[] = [];
  for (let i = section.start; i + FIXTURE_STRIDE <= section.end; i++) {
    if (save[i + 9] !== 0xff || save[i + 13] !== 0xff) continue;
    const date = readUInt32LE(save, i);
    if (!plausibleDate(date)) continue;
    const goalsA = readGoals(save[i + 8]);
    const goalsB = readGoals(save[i + 12]);
    if (goalsA === false || goalsB === false) continue;
    const kickoff = readUInt16LE(save, i + 4);
    out.push({
      date,
      kickoff: kickoff >= 0 && kickoff <= 2359 ? kickoff : null,
      comp: readUInt16LE(save, i + 19),
      slotA: readUInt16LE(save, i + 6),
      slotB: readUInt16LE(save, i + 10),
      goalsA,
      goalsB,
    });
  }
  return out.length ? out : null;
}

const RESULT_STRIDE = 49;

export function readLatestResults(
  save: Uint8Array,
  leagueOfTeam: (teamId: number) => number | null,
  isPlayerId: (id: number) => boolean = () => false
): MatchResult[] | null {
  const section = blobSections(save).find((s) => s.tag === "mrni");
  if (!section) return null;

  const out: MatchResult[] = [];
  const seen = new Set<string>();
  for (let i = section.start; i + RESULT_STRIDE <= section.end; i++) {
    const date = readUInt32LE(save, i);
    if (!plausibleDate(date)) continue;
    const home = readUInt32LE(save, i + 6);
    const away = readUInt32LE(save, i + 10);
    if (home === away) continue;
    const league = leagueOfTeam(home);
    if (league === null || league !== leagueOfTeam(away)) continue;
    const homeGoals = readUInt32LE(save, i + 14);
    const awayGoals = readUInt32LE(save, i + 18);
    if (homeGoals > MAX_GOALS || awayGoals > MAX_GOALS) continue;
    if (readUInt16LE(save, i + 22) !== league) continue;

    const key = `${date}:${home}:${away}:${homeGoals}:${awayGoals}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const standout = readUInt32LE(save, i + 26);
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

/**
 * Decompresses a gzip or zlib (RFC1950) stream.
 *
 * `DecompressionStream` is available in browsers and in Node 18+, so one implementation serves both
 * runtimes and the parser keeps no `node:zlib` import.
 */
async function inflate(bytes: Uint8Array, format: "gzip" | "deflate"): Promise<Uint8Array> {
  const decompressor = new DecompressionStream(format);
  const writer = decompressor.writable.getWriter();

  // Pump the compressed bytes in without awaiting: on a large payload, awaiting the write before
  // draining the readable would let the writable's queue fill and deadlock. A failure here surfaces
  // on `reader.read()` below, which is what the caller's try/catch sees.
  const pump = (async () => {
    // `write` is declared against `ArrayBufferView<ArrayBuffer>` in the DOM lib, which is narrower
    // than the `Uint8Array<ArrayBufferLike>` the decoder hands us. Both are plain views, so this is
    // a type-level gap rather than a runtime one.
    await writer.write(bytes as unknown as BufferSource);
    await writer.close();
  })().catch(() => {});

  const reader = decompressor.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await pump;

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function firstZlibOffset(buffer: Uint8Array): number {
  for (const magic of ZLIB_MAGICS) {
    const at = indexOfBytes(buffer, magic);
    if (at >= 0) return at;
  }
  return -1;
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
    metaXml: string | null;
    metaSource: string | null;
    nameTableCsv: string | null;
    nameTableSource: string | null;
    rowLimit: number;
    allTables: boolean;
    sampleRows: number;
  };

  private meta: DbMeta | null = null;
  private metaSource: string | null = null;
  private names: Map<number, string> = new Map();
  private nameTableSource: string | null = null;

  constructor(options: ParseOptions = {}) {
    this.options = {
      metaXml: options.metaXml ?? null,
      metaSource: options.metaSource ?? null,
      nameTableCsv: options.nameTableCsv ?? null,
      nameTableSource: options.nameTableSource ?? null,
      rowLimit: options.rowLimit ?? 60,
      allTables: options.allTables ?? false,
      sampleRows: options.sampleRows ?? 3,
    };
  }

  private loadMeta(): void {
    if (this.meta !== null || this.metaSource === "none") return;

    const xml = this.options.metaXml;
    if (xml === null) {
      this.metaSource = "none";
      return;
    }
    try {
      this.meta = parseDbMeta(xml);
      this.metaSource = this.options.metaSource ?? "provided";
    } catch {
      this.metaSource = "none";
    }
  }

  private loadNames(): void {
    if (this.nameTableSource !== null) return;

    const csv = this.options.nameTableCsv;
    if (csv === null) {
      this.nameTableSource = "none";
      return;
    }
    try {
      const table = parseNameTable(csv);
      if (table.size === 0) {
        this.nameTableSource = "none";
        return;
      }
      this.names = table;
      this.nameTableSource = this.options.nameTableSource ?? "provided";
    } catch {
      this.nameTableSource = "none";
    }
  }

  async parse(save: SaveCandidate, bytes: Uint8Array): Promise<SpikeCareerData> {
    const startedAt = performance.now();
    const warnings: string[] = [];
    const facts: SaveFact[] = [];
    const incompleteNames: IncompleteName[] = [];
    const truncatedTables: SpikeCareerData["truncatedTables"] = [];
    const decodedTables: Record<string, number> = {};

    const fingerprint = this.fingerprint(bytes);
    let decompressedFrom: string | null = null;

    if (fingerprint.databaseBlocks === 0) {
      const inflated = await this.tryInflate(bytes);
      if (inflated) {
        bytes = inflated.bytes;
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

    const blocks: Uint8Array[] = [];
    if (indexOfBytes(bytes, DB_HEADER) >= 0) {
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
    const descriptorLayoutUsage = { classic16: 0, compact9: 0, fc27Long16: 0 };

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
      warnings.push(...read.warnings);
      descriptorLayoutUsage.classic16 += read.layoutUsage.classic16;
      descriptorLayoutUsage.compact9 += read.layoutUsage.compact9;
      descriptorLayoutUsage.fc27Long16 += read.layoutUsage.fc27Long16;
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
    // Which title wrote this save, from the two signals that actually differ between titles: FC27
    // moved its tables to the compact 9-byte descriptor, FC26 CmMgr saves are FBCHUNKS containers,
    // and an FC25 save is a bare t3db stream. Never inferred from a filename.
    const gameVersion: GameVersion =
      descriptorLayoutUsage.compact9 > 0 || descriptorLayoutUsage.fc27Long16 > 0
        ? "FC27"
        : fingerprint.hasFbChunksTag
        ? "FC26"
        : "FC25";
    fingerprint.descriptorLayout =
      descriptorLayoutUsage.fc27Long16 > 0
        ? "fc27Long16"
        : descriptorLayoutUsage.compact9 > 0
        ? "compact9"
        : descriptorLayoutUsage.classic16 > 0
        ? "classic16"
        : "none";
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
        gameVersion,
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

  private fingerprint(bytes: Uint8Array): SaveFingerprint {
    const offsets = {
      db: indexOfBytes(bytes, DB_HEADER),
      fbchunks: indexOfBytes(bytes, FBCHUNKS_TAG),
      sqlite: indexOfBytes(bytes, SQLITE_TAG),
      gzip: indexOfBytes(bytes, GZIP_MAGIC),
      zlib: firstZlibOffset(bytes),
      lz4: indexOfBytes(bytes, LZ4_FRAME_MAGIC),
    };

    let databaseBlocks = 0;
    let databaseBytes = 0;
    let cursor = offsets.db;
    // Step past the SIGNATURE, not past the declared size: FC27's career and squads blocks overlap,
    // so advancing by size counted one database where the save holds two.
    while (cursor >= 0 && cursor + DB_HEADER.length + 4 <= bytes.length) {
      const size = readUInt32LE(bytes, cursor + DB_HEADER.length);
      if (size > 0 && cursor + size <= bytes.length) {
        databaseBlocks++;
        databaseBytes += size;
      }
      cursor = indexOfBytes(bytes, DB_HEADER, cursor + DB_HEADER.length);
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
      headHex: hexText(bytes.subarray(0, 16)),
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
      descriptorLayout: "none",
    };
  }

  private async tryInflate(
    bytes: Uint8Array
  ): Promise<{ bytes: Uint8Array; strategy: string; offset: number } | null> {
    const gzipAt = indexOfBytes(bytes, GZIP_MAGIC);
    if (gzipAt >= 0) {
      try {
        return {
          bytes: await inflate(bytes.subarray(gzipAt), "gzip"),
          strategy: "gzip",
          offset: gzipAt,
        };
      } catch {}
    }

    const zlibAt = firstZlibOffset(bytes);
    if (zlibAt >= 0) {
      try {
        return {
          bytes: await inflate(bytes.subarray(zlibAt), "deflate"),
          strategy: "zlib",
          offset: zlibAt,
        };
      } catch {}
    }
    return null;
  }
}