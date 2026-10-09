/**
 * FC27 container de-chunking: unwrap the `FBCHUNKS` envelope and write the raw
 * embedded `fifa_ng_db` payload stream to disk, then decode it with the SAME
 * datasheet (`fifa_ng_db-meta.xml`) reader the app uses.
 *
 * Why this exists
 * ---------------
 * An FC27 career save is an `FBCHUNKS` container, not a bare stream of `DB\0\x08`
 * database blocks. Earlier ad-hoc byte probes guessed table-directory strides on
 * the raw container and got nonsense, because a byte scan of the whole file picks
 * up the DB signature inside payload/metadata regions. This script takes the
 * container apart in a documented, non-guessing way:
 *
 *   1. Parse the `FBCHUNKS` header (magic / version / size fields / name / save type).
 *   2. Inventory the `BNRY` chunk records the container declares.
 *   3. Locate every embedded `fifa_ng_db` block and validate it structurally
 *      (db size @ +8, table count @ +16, directory @ +24, per-table header + field
 *      descriptors) before trusting a single byte of it.
 *   4. Try to inflate at every zlib/gzip magic offset, and report honestly whether
 *      any compiled payload exists.
 *   5. Write the extracted database payload stream to `data/saves/extracted_fc27_db.bin`.
 *   6. Re-open that file and run `parseDbMeta` + `readTableHeaders` against it,
 *      reporting whether the `teams` / `players` / `managerinfo` directories align.
 *
 * The container/chunk layout comes from an independent FC26 CmMgr save decoder
 * (`fc26_cmmgr_phase2_parser.py`, `fc26_db_decoder.py`) and is reproduced here
 * rather than invented, so nothing depends on a guessed stride.
 *
 * Run:
 *   npx tsx scripts/extract-fc27-container.ts
 *   npx tsx scripts/extract-fc27-container.ts path/to/save out.bin
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DECODED_TABLES, parseDbMeta, readTableHeaders } from "../src/lib/parser/feasibility-parser";
import type { DbMeta } from "../src/lib/parser/interface";

const DEFAULT_SAVE = path.join("data", "saves", "CmMgrC20261006225936249");
const DEFAULT_OUT = path.join("data", "saves", "extracted_fc27_db.bin");
const META_PATH = path.join("public", "parse-resources", "fifa_ng_db-meta.xml");

const FBCHUNKS_MAGIC = Buffer.from("FBCHUNKS", "ascii");
const DB_SIGNATURE = Buffer.from([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
const ZLIB_MAGICS: ReadonlyArray<readonly [number, number]> = [
  [0x78, 0x01],
  [0x78, 0x5e],
  [0x78, 0x9c],
  [0x78, 0xda],
];
const GZIP_MAGIC: readonly [number, number, number] = [0x1f, 0x8b, 0x08];

/** The meta table names the brief's alignment question maps onto. */
const TARGET_TABLES = ["teams", "players", "manager", "career_managerinfo"];

/**
 * fifa_ng_db header arrangements. FC25/FC26 and the FC27 squads block put the table count at +16
 * with the directory at +24; the FC27 career block omits the 4-byte field at +12, so its count sits
 * at +12 and its directory at +20.
 */
const DB_HEADER_VARIANTS = [
  { id: "count@+16 dir@+24", countAt: 16, dirAt: 24 },
  { id: "count@+12 dir@+20", countAt: 12, dirAt: 20 },
] as const;

const DB_HEADER_TRAILER_BYTES = 4;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function u16(bytes: Buffer, at: number): number {
  return bytes.readUInt16LE(at);
}

function u32(bytes: Buffer, at: number): number {
  return bytes.readUInt32LE(at);
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function hexBytes(bytes: Buffer, at: number, length: number): string {
  return bytes.subarray(at, at + length).toString("hex").replace(/(..)/g, "$1 ").trim();
}

function cstring(bytes: Buffer, at: number, max: number): string {
  const end = Math.min(bytes.length, at + max);
  let stop = at;
  while (stop < end && bytes[stop] !== 0x00) stop++;
  return bytes.subarray(at, stop).toString("utf8");
}

function findAll(bytes: Buffer, needle: Buffer, from = 0): number[] {
  const hits: number[] = [];
  let at = bytes.indexOf(needle, from);
  while (at >= 0) {
    hits.push(at);
    at = bytes.indexOf(needle, at + 1);
  }
  return hits;
}

function printableRun(bytes: Buffer, at: number, max: number, minLength = 4): string | null {
  const window = bytes.subarray(at, Math.min(bytes.length, at + max));
  const match = /[\x20-\x7e]{4,}/.exec(window.toString("latin1"));
  if (!match) return null;
  const value = match[0].trim();
  return value.length >= minLength ? value.slice(0, 120) : null;
}

/** Classic 16-bytes-per-line hex + ASCII listing, used for header forensics. */
function hexdump(bytes: Buffer, from: number, length: number): string {
  const lines: string[] = [];
  for (let at = from; at < from + length && at < bytes.length; at += 16) {
    const row = bytes.subarray(at, at + 16);
    const hexPart = row.toString("hex").replace(/(..)/g, "$1 ").padEnd(48);
    const ascii = row.toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    lines.push(`      ${at.toString(10).padStart(9)}  ${hexPart} |${ascii}|`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 1. FBCHUNKS container header
// ---------------------------------------------------------------------------

interface ContainerHeader {
  magic: string;
  version: number;
  fieldA: number;
  fieldB: number;
  name: string;
  saveType: string | null;
  payloadStart: number;
}

function parseContainerHeader(bytes: Buffer): ContainerHeader {
  const magic = bytes.subarray(0, 8).toString("latin1");
  const version = bytes.length >= 10 ? u16(bytes, 8) : 0;
  // The reference decoder reads two u32s at +10 and +14. Which is the chunk-table
  // offset and which is the file size is not settled, so both are reported raw.
  const fieldA = bytes.length >= 14 ? u32(bytes, 10) : 0;
  const fieldB = bytes.length >= 18 ? u32(bytes, 14) : 0;
  const name = cstring(bytes, 18, 256);
  const saveTypeMatch = /SaveType_[A-Za-z0-9_]+/.exec(bytes.subarray(0, 4096).toString("latin1"));

  // If one of the two fields equals the file size, the container's metadata ends
  // there and the payload begins at 0 (the DB blocks are located by signature
  // anyway). If it is a plausible header offset, use it as the payload start.
  const payloadStart =
    fieldB === bytes.length || fieldA === bytes.length ? 0 : fieldA > 0 && fieldA < bytes.length ? fieldA : 0;

  return {
    magic,
    version,
    fieldA,
    fieldB,
    name,
    saveType: saveTypeMatch ? saveTypeMatch[0] : null,
    payloadStart,
  };
}

// ---------------------------------------------------------------------------
// 2. BNRY chunk inventory
// ---------------------------------------------------------------------------

interface BnryChunk {
  index: number;
  start: number;
  end: number;
  marker: number;
  preA: number;
  guid: string;
  preB: number;
  hint: string | null;
}

/**
 * A chunk is a 24-byte prelude, the `BNRY` marker, then a 32-byte post-header.
 * Chunks are laid out back-to-back, so each chunk spans from its own prelude to
 * the next chunk's prelude (the last one runs to end of file).
 */
function inventoryBnryChunks(bytes: Buffer, from: number): BnryChunk[] {
  const markers = findAll(bytes, Buffer.from("BNRY", "ascii"), from);
  const chunks: BnryChunk[] = [];
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const start = Math.max(0, marker - 24);
    const end = index + 1 < markers.length ? Math.max(start, markers[index + 1] - 24) : bytes.length;
    const pre = bytes.subarray(start, marker);
    if (pre.length < 24) continue;
    chunks.push({
      index: index + 1,
      start,
      end,
      marker,
      preA: u32(pre, 0),
      guid: pre.subarray(4, 20).toString("hex"),
      preB: u32(pre, 20),
      hint: printableRun(bytes, start, Math.min(end - start, 4096), 6),
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// 3. Embedded fifa_ng_db blocks (validated, never guessed)
// ---------------------------------------------------------------------------

interface DirectoryEntry {
  shortName: string;
  offset: number;
}

interface DbBlock {
  offset: number;
  dbSize: number;
  field12: number;
  tableCount: number;
  field20: number;
  tablesStart: number;
  entries: DirectoryEntry[];
  /** True when the DB header (size at +8, table count at +16) is plausible. */
  headerPlausible: boolean;
  /** Empty when the header AND every table header validate. */
  problems: string[];
}

/**
 * Read the DB header at a signature offset. Never rejects: a signature that turns
 * out to be a false positive inside payload bytes is reported, not discarded
 * silently, because silently dropping one is how a real block gets missed.
 *
 * Both header arrangements are tried - count@+16/dir@+24 (FC25/FC26 and the FC27 squads block)
 * and count@+12/dir@+20 (the FC27 career block) - and the one whose directory names the most
 * printable table ids wins.
 */
function readDbBlock(bytes: Buffer, offset: number): DbBlock {
  const dbSize = offset + 12 <= bytes.length ? u32(bytes, offset + 8) : 0;
  const field12 = offset + 16 <= bytes.length ? u32(bytes, offset + 12) : 0;
  const field20 = offset + 24 <= bytes.length ? u32(bytes, offset + 20) : 0;
  const withinFile = dbSize >= 1024 && dbSize <= 400_000_000 && offset + dbSize <= bytes.length;

  let tableCount = 0;
  let tablesStart = 0;
  let entries: DirectoryEntry[] = [];
  const problems: string[] = [];
  if (!withinFile) problems.push(`db size ${dbSize} implausible or overruns the file`);

  if (withinFile) {
    const body = bytes.subarray(offset, offset + dbSize);
    let bestScore = -1;
    for (const variant of DB_HEADER_VARIANTS) {
      if (variant.countAt + 4 > body.length) continue;
      const count = u32(body, variant.countAt);
      if (count < 1 || count > 4096) continue;
      const start = variant.dirAt + count * 8 + DB_HEADER_TRAILER_BYTES;
      if (start > body.length) continue;
      const list: DirectoryEntry[] = [];
      let score = 0;
      for (let index = 0; index < count; index++) {
        const at = variant.dirAt + index * 8;
        const shortName = body.subarray(at, at + 4).toString("latin1");
        list.push({ shortName, offset: u32(body, at + 4) });
        if (/^[\x21-\x7e]{4}$/.test(shortName)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        tableCount = count;
        tablesStart = start;
        entries = list;
      }
    }
    if (bestScore < 0) problems.push("no DB header arrangement produced a directory");
  }

  return {
    offset,
    dbSize,
    field12,
    tableCount,
    field20,
    tablesStart,
    entries,
    headerPlausible: entries.length > 0,
    problems,
  };
}

// ---------------------------------------------------------------------------
// 4. Compression scan (reported honestly, never assumed)
// ---------------------------------------------------------------------------

interface InflateHit {
  offset: number;
  kind: "zlib" | "raw-deflate" | "gzip";
  outBytes: number;
  containsDbSignature: boolean;
  headHex: string;
}

function tryInflateAt(bytes: Buffer, offset: number): InflateHit | null {
  const slice = bytes.subarray(offset);
  const attempts: Array<{ kind: InflateHit["kind"]; run: () => Buffer }> = [];

  for (const [low, high] of ZLIB_MAGICS) {
    if (bytes[offset] === low && bytes[offset + 1] === high) {
      attempts.push({
        kind: "zlib",
        run: () => zlib.inflateSync(slice, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
      });
      attempts.push({ kind: "raw-deflate", run: () => zlib.inflateRawSync(slice) });
    }
  }
  if (bytes[offset] === GZIP_MAGIC[0] && bytes[offset + 1] === GZIP_MAGIC[1] && bytes[offset + 2] === GZIP_MAGIC[2]) {
    attempts.push({ kind: "gzip", run: () => zlib.gunzipSync(slice) });
  }

  for (const attempt of attempts) {
    try {
      const out = attempt.run();
      if (out.length === 0) continue;
      return {
        offset,
        kind: attempt.kind,
        outBytes: out.length,
        containsDbSignature: out.indexOf(DB_SIGNATURE) >= 0,
        headHex: out.subarray(0, 16).toString("hex").replace(/(..)/g, "$1 ").trim(),
      };
    } catch {
      // Not a real stream at this offset; fall through to the next candidate.
    }
  }
  return null;
}

/** Header-search helpers: a real FC27 table header carries three 4-char ids on a 9-byte grid. */
function isPrintableFour(bytes: Buffer, at: number): boolean {
  if (at < 0 || at + 4 > bytes.length) return false;
  for (let index = 0; index < 4; index++) {
    const byte = bytes[at + index];
    if (byte < 0x21 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Locates each table's real descriptor array by scanning for a run of printable 4-char ids on a
 * fixed grid, then scoring that run against the datasheet's field set for the table (set
 * intersection). The best candidate per table is printed with its run length and match ratio.
 */
/**
 * Entry length varies INSIDE a single array: 9 bytes for the compact int form, 8 bytes where the
 * save writes the short form, and 16 bytes for the long form (observed on `AUsv`/teamname, depth 480).
 * The next id is whichever candidate step lands on a printable 4-char id.
 */
function nextGridStep(body: Buffer, cursor: number, stride: number): number {
  if (stride === 16) return cursor + 16;
  for (const step of [9, 8, 16, 12]) {
    if (isPrintableFour(body, cursor + step)) return cursor + step;
  }
  return -1;
}

/** Mirrors the parser's stride-9 walk: accept a 9- or an 8-byte step. */
function walkGrid(body: Buffer, start: number, stride: number): { ids: string[]; positions: number[] } {
  const ids: string[] = [];
  const positions: number[] = [];
  let cursor = start;
  for (;;) {
    if (cursor + 4 > body.length || !isPrintableFour(body, cursor)) break;
    ids.push(body.subarray(cursor, cursor + 4).toString("latin1"));
    positions.push(cursor);
    if (stride === 16) cursor += 16;
    else {
      const next = nextGridStep(body, cursor, stride);
      if (next < 0) break;
      cursor = next;
    }
  }
  return { ids, positions };
}

function collectGrids(body: Buffer): Array<{ stride: number; start: number; ids: string[]; positions: number[] }> {
  const grids: Array<{ stride: number; start: number; ids: string[]; positions: number[] }> = [];
  for (const [stride, minRun] of [
    [16, 4],
    [9, 3],
  ] as const) {
    for (let at = 0; at + 4 + stride * (minRun - 1) <= body.length; at++) {
      let ok = true;
      let cursor = at;
      for (let index = 0; index < minRun; index++) {
        if (!isPrintableFour(body, cursor)) {
          ok = false;
          break;
        }
        const next = nextGridStep(body, cursor, stride);
        if (next < 0) {
          ok = false;
          break;
        }
        cursor = next;
      }
      if (!ok) continue;
      const run = walkGrid(body, at, stride);
      grids.push({ stride, start: at, ids: run.ids, positions: run.positions });
      at = run.positions[run.positions.length - 1] - 1;
      if (grids.length >= 4000) return grids;
    }
  }
  return grids;
}

interface GridHit {
  shortName: string;
  tableName: string;
  stride: number;
  foundAt: number;
  runLength: number;
  expectedFields: number;
  resolved: number;
  ratio: number;
  /** 24 bytes from where the run stopped, and the last two ids + their positions. */
  stopDetail: string;
  /** Header-prefix probe at candidate bases before the grid: recordSize / rowCount / fieldCount. */
  headerProbe: string;
  /** Raw bytes at the base-44 header when it validates against the run length. */
  headerHex: string;
}

/**
 * Reports the best set-intersection candidate per table: which scanned descriptor run shares the
 * most shortnames with the datasheet's field set, and what fraction of the run that is.
 */
function findTableHeaders(body: Buffer, entries: DirectoryEntry[], _tablesStart: number, meta: DbMeta): GridHit[] {
  const grids = collectGrids(body);
  console.log(`    descriptor grids found: ${grids.length}`);

  const hits: GridHit[] = [];
  for (const entry of entries) {
    const tableName = meta.tableNames.get(entry.shortName) ?? null;
    if (tableName === null) continue;
    const fields = meta.fieldNamesByTable.get(tableName);
    const expected = meta.fieldCountByTable.get(tableName) ?? 0;
    if (!fields || fields.size === 0) continue;

    let best: { grid: (typeof grids)[number]; resolved: number; ratio: number } | null = null;
    for (const grid of grids) {
      if (grid.ids.length < 4) continue;
      let resolved = 0;
      for (const id of grid.ids) if (fields.has(id)) resolved++;
      const ratio = resolved / grid.ids.length;
      if (best === null || resolved > best.resolved || (resolved === best.resolved && ratio > best.ratio)) {
        best = { grid, resolved, ratio };
      }
    }
    if (best === null) continue;
    const last = best.grid.positions[best.grid.positions.length - 1];
    const stopAt = best.grid.stride === 16 ? last + 16 : last + 9;
    const tail = body.subarray(Math.max(0, stopAt - 8), stopAt + 24);
    const headerProbe = [44, 24, 36, 32, 48]
      .map((base) => {
        const h = best.grid.start - base;
        if (h < 0 || h + 28 > body.length) return `b${base}:n/a`;
        return (
          `b${base}:rs=${u32(body, h + 4)} rows=${u16(body, h + 18)} fc=${body[h + 24]}`
        );
      })
      .join("  ");
    const v = best.grid.start - 44;
    const headerValidates =
      v >= 0 && v + 48 < body.length && Math.abs(body[v + 24] - best.grid.ids.length) <= 2;
    const headerHex = headerValidates ? hexBytes(body, v, 48) : "";
    hits.push({
      shortName: entry.shortName,
      tableName,
      stride: best.grid.stride,
      foundAt: best.grid.start,
      runLength: best.grid.ids.length,
      expectedFields: expected,
      resolved: best.resolved,
      ratio: best.ratio,
      stopDetail:
        `${best.grid.ids[best.grid.ids.length - 2] ?? ""}@${last - (best.grid.stride === 16 ? 16 : 9)} ` +
        `${best.grid.ids[best.grid.ids.length - 1]}@${last} then ${tail.toString("hex").replace(/(..)/g, "$1 ")}`,
      headerProbe,
      headerHex,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const savePath = process.argv[2] ?? DEFAULT_SAVE;
  const outPath = process.argv[3] ?? DEFAULT_OUT;

  const bytes = fs.readFileSync(savePath);
  console.log("=".repeat(78));
  console.log(`FC27 container extraction`);
  console.log(`save: ${savePath}`);
  console.log(`size: ${bytes.length.toLocaleString()} bytes`);
  console.log(`head: ${hexBytes(bytes, 0, 16)}`);
  console.log("=".repeat(78));

  // --- 1. Container header -------------------------------------------------
  const header = parseContainerHeader(bytes);
  const isFbChunks = bytes.subarray(0, FBCHUNKS_MAGIC.length).equals(FBCHUNKS_MAGIC);
  console.log(`\n[1] FBCHUNKS container header`);
  console.log(`  magic              : ${JSON.stringify(header.magic)} ${isFbChunks ? "(FBCHUNKS)" : "(NOT FBCHUNKS)"}`);
  console.log(`  version            : ${header.version}`);
  console.log(`  u32 @ +10 (field A) : ${header.fieldA} ${header.fieldA === bytes.length ? "(= file size)" : ""}`);
  console.log(`  u32 @ +14 (field B) : ${header.fieldB} ${header.fieldB === bytes.length ? "(= file size)" : ""}`);
  console.log(`  name @ +18         : ${JSON.stringify(header.name)}`);
  console.log(`  save type          : ${JSON.stringify(header.saveType)}`);
  console.log(`  further FBCHUNKS magic at: ${JSON.stringify(findAll(bytes, FBCHUNKS_MAGIC).slice(1))}`);

  // --- 2. Chunk inventory --------------------------------------------------
  const chunks = inventoryBnryChunks(bytes, header.payloadStart);
  console.log(`\n[2] BNRY chunk records: ${chunks.length}`);
  for (const chunk of chunks) {
    console.log(
      `  #${String(chunk.index).padStart(3)} ${chunk.start.toLocaleString().padStart(12)}..` +
        `${chunk.end.toLocaleString().padStart(12)} (${(chunk.end - chunk.start).toLocaleString()} bytes) ` +
        `preA=${hex(chunk.preA, 8)} preB=${hex(chunk.preB, 8)} guid=${chunk.guid} ` +
        `hint=${JSON.stringify(chunk.hint)}`
    );
  }

  // --- 3. Embedded DB blocks ----------------------------------------------
  const meta = parseDbMeta(fs.readFileSync(META_PATH, "utf8"));
  const signatures = findAll(bytes, DB_SIGNATURE);
  const blocks = signatures.map((offset) => readDbBlock(bytes, offset));
  const validated = blocks.filter((block) => block.headerPlausible && block.problems.length === 0);
  const extractable = blocks.filter((block) => block.headerPlausible);

  console.log(`\n[3] embedded fifa_ng_db signatures: ${signatures.length} (${validated.length} fully validated)`);
  for (const block of blocks) {
    console.log(
      `  DB @ ${block.offset.toLocaleString()}: size=${block.dbSize.toLocaleString()} ` +
        `tables=${block.tableCount} dirEntries=${block.entries.length} ` +
        `u32@+12=${block.field12} u32@+20=${block.field20} ` +
        `header=${block.headerPlausible ? "plausible" : "INVALID"}`
    );
    console.log(hexdump(bytes, block.offset, 64));
    if (block.entries.length > 0) {
      console.log(`    table shortnames: ${block.entries.map((entry) => entry.shortName).join(", ")}`);
    }
    for (const problem of block.problems.slice(0, 5)) console.log(`    - ${problem}`);

    const body = bytes.subarray(block.offset, block.offset + block.dbSize);
    for (const entry of block.entries.slice(0, 3)) {
      const headerAt = block.tablesStart + entry.offset;
      if (headerAt + 96 > body.length) continue;
      console.log(`    dir-derived header for ${entry.shortName} @ ${headerAt}:`);
      console.log(hexdump(body, headerAt, 96));
    }
    const hits = findTableHeaders(body, block.entries, block.tablesStart, meta);
    console.log(`    header search (tablesStart=${block.tablesStart}):`);
    console.log(`      short  stride  foundAt  runLen  datasheet  matched  ratio`);
    for (const hit of hits) {
      console.log(
        `      ${hit.shortName}  ${String(hit.stride).padStart(6)} ${String(hit.foundAt).padStart(8)} ` +
          `${String(hit.runLength).padStart(7)} ${String(hit.expectedFields).padStart(10)} ` +
          `${String(hit.resolved).padStart(8)}  ${hit.ratio.toFixed(3)}`
      );
      if (hit.runLength < hit.expectedFields) console.log(`        stop: ${hit.stopDetail}`);
      if (hit.headerHex !== "") console.log(`        hdr : ${hit.headerHex}`);
      console.log(`        headers: ${hit.headerProbe}`);
    }
  }

  // --- 4. Compression scan -------------------------------------------------
  const candidates = new Set<number>();
  for (const magic of ZLIB_MAGICS) candidates.add(bytes.indexOf(Buffer.from(magic)));
  candidates.add(bytes.indexOf(Buffer.from(GZIP_MAGIC)));
  for (const [low, high] of ZLIB_MAGICS) {
    for (const at of findAll(bytes, Buffer.from([low, high]))) candidates.add(at);
  }
  for (const at of findAll(bytes, Buffer.from(GZIP_MAGIC))) candidates.add(at);
  candidates.delete(-1);

  const hits: InflateHit[] = [];
  for (const at of candidates) {
    const hit = tryInflateAt(bytes, at);
    if (hit) hits.push(hit);
  }

  console.log(`\n[4] compression scan`);
  console.log(`  zlib/gzip magic candidates: ${candidates.size}`);
  console.log(`  successful inflations     : ${hits.length}`);
  for (const hit of hits.slice(0, 20)) {
    console.log(
      `    ${hit.kind} @ ${hit.offset}: -> ${hit.outBytes.toLocaleString()} bytes, ` +
        `DB signature=${hit.containsDbSignature}, head=${hit.headHex}`
    );
  }
  const compressedDb = hits.filter((hit) => hit.containsDbSignature);
  const usedCompression = compressedDb.length > 0;
  console.log(
    usedCompression
      ? `  VERDICT: compressed chunk(s) do contain a database; using inflated output.`
      : `  VERDICT: no compressed chunk contains a database. The DB payload is stored UNCOMPRESSED.`
  );

  // --- 5. Extract the database payload stream ------------------------------
  let extracted: Buffer;
  if (usedCompression) {
    const parts: Buffer[] = [];
    for (const hit of compressedDb) {
      const slice = bytes.subarray(hit.offset);
      const out = hit.kind === "gzip" ? zlib.gunzipSync(slice) : hit.kind === "zlib" ? zlib.inflateSync(slice) : zlib.inflateRawSync(slice);
      parts.push(out);
    }
    extracted = Buffer.concat(parts);
  } else {
    // Raw stream concatenation: lay the plausible DB blocks end to end.
    extracted = Buffer.concat(
      extractable.map((block) => bytes.subarray(block.offset, block.offset + block.dbSize))
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, extracted);
  console.log(`\n[5] wrote ${extracted.length.toLocaleString()} bytes -> ${outPath}`);
  console.log(`  method: ${usedCompression ? "inflated chunk stream" : "raw concatenation of validated DB blocks"}`);

  // --- Step 2: verify the extracted signature ------------------------------
  console.log(`\n[2] verify extracted stream`);
  const outBytes = fs.readFileSync(outPath);
  console.log(`  DB\\0\\x08 signatures : ${findAll(outBytes, DB_SIGNATURE).length}`);
  console.log(`  FBCHUNKS magic      : ${findAll(outBytes, FBCHUNKS_MAGIC).length}`);
  console.log(`  contains "t3db"     : ${outBytes.includes(Buffer.from("t3db", "ascii"))}`);
  console.log(`  first 16 bytes      : ${hexBytes(outBytes, 0, 16)}`);

  // --- Step 3: schema inspection against the extracted stream -------------
  console.log(`\n[3] fifa_ng_db-meta.xml reader against ${outPath}`);

  const seenTables = new Set<string>();
  const outBlocks = findAll(outBytes, DB_SIGNATURE).map((offset) => readDbBlock(outBytes, offset));
  let database = 0;
  for (const block of outBlocks) {
    if (!block.headerPlausible) {
      console.log(`  DB${database} @ ${block.offset}: header invalid -> ${block.problems[0]}`);
      database++;
      continue;
    }
    const slice = outBytes.subarray(block.offset, block.offset + block.dbSize);
    try {
      const read = readTableHeaders(slice, meta, database);
      const headers = read.headers as unknown as {
        shortName: string;
        tableName: string | null;
        recordCount: number;
        fieldCount: number;
        fields: { shortName: string; bitOffset: number }[];
      }[];
      console.log(`  DB${database}: ${headers.length} tables read from the extracted block`);
      for (const table of headers) {
        const name = table.tableName;
        if (name) seenTables.add(name);
        const localFields = name ? meta.fieldNamesByTable.get(name) : undefined;
        const globalOnly = table.fields.filter((f) => !localFields?.get(f.shortName) && meta.fieldNames.get(f.shortName));
        console.log(
          `    ${(name ?? `UNKNOWN_TABLE(${table.shortName})`).padEnd(34)} ` +
            `short=${table.shortName} rows=${table.recordCount} fields=${table.fieldCount}` +
            (globalOnly.length > 0 ? ` global-only-fields=${globalOnly.length}` : "")
        );
      }
      for (const short of read.unknownTables) console.log(`    UNKNOWN_TABLE shortname: ${short}`);
    } catch (error) {
      console.log(`  DB${database}: reader rejected the block -> ${(error as Error).message}`);
    }
    database++;
  }

  console.log(`\n[3] alignment for the brief's target tables`);
  for (const target of TARGET_TABLES) {
    const present = seenTables.has(target);
    console.log(`  ${target.padEnd(18)} : ${present ? "ALIGNED" : "ABSENT from the extracted stream"}`);
  }
  console.log(
    `  note: the datasheet declares no table named "managerinfo". It has "manager" (world block, shortname Knen) ` +
      `and "career_managerinfo" (career block, shortname biWl), reported above under those real names.`
  );
  const missing = DECODED_TABLES.filter((table) => !seenTables.has(table));
  console.log(`  parser-required tables absent: ${JSON.stringify(missing)}`);
}

main();
