/**
 * Read-only: does the meta XML actually match the schema of the save it is decoding?
 *
 * Our meta is the committed reference file in `public/parse-resources`, while a career save can come
 * from any EA SPORTS FC title. If the save holds a table or a field the meta does not know, the
 * decode still "succeeds" - but values are read off unnamed columns. `parse()` now reports that as a
 * parser warning; this script prints the warnings and the underlying drift counts.
 *
 * `--cripple` is the positive test: it renames one known field away in a COPY of the meta, parses
 * with that copy, and shows the warning firing. The copy is written to the OS temp directory, so the
 * repo's reference meta is never modified.
 *
 * Read `scripts/../public/parse-resources/README.md` for where that meta came from and the licensing
 * position on shipping it.
 *
 *   npx tsx scripts/probe-schema-drift.ts
 *   npx tsx scripts/probe-schema-drift.ts --cripple
 *   npx tsx scripts/probe-schema-drift.ts path/to/save
 */
import fs from "fs";
import os from "os";
import path from "path";
import { DECODED_TABLES, parseDbMeta, readTableHeaders } from "../src/lib/parser/feasibility-parser";
import { createSaveParser } from "../src/lib/platform/parse-resources";
import { saveSource } from "../src/lib/platform/save-source";

const META = path.join("public", "parse-resources", "fifa_ng_db-meta.xml");
const DEFAULT_SAVE = path.join("data", "saves");
const DB_HEADER = new Uint8Array([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
const FBCHUNKS_HEADER = new TextEncoder().encode("FBCHUNKS");
const MAX_PROBE_TABLES = 4096;

/**
 * Header arrangements worth testing against an FBCHUNKS-contained DB marker.
 *
 * These are hypotheses, not accepted formats. A candidate is accepted only if EVERY directory entry
 * names a printable four-byte table id and points to a complete, structurally valid table header and
 * all its field descriptors inside the declared DB block. If two layouts pass, the probe refuses to
 * choose between them. The FC27 file itself decides; no table names or offsets are guessed into output.
 */
const FBCHUNKS_LAYOUTS = [
  { name: "count@+12 / directory@+20 / trailer=4", countAt: 12, entriesAt: 20, trailerBytes: 4 },
  { name: "count@+16 / directory@+24 / trailer=4", countAt: 16, entriesAt: 24, trailerBytes: 4 },
  { name: "count@+16 / directory@+32 / trailer=4", countAt: 16, entriesAt: 32, trailerBytes: 4 },
  { name: "count@+12 / directory@+16 / trailer=4", countAt: 12, entriesAt: 16, trailerBytes: 4 },
] as const;

interface DirectoryEntry {
  shortName: string;
  offset: number;
}

interface ValidatedBlock {
  sourceOffset: number;
  declaredSize: number;
  layout: string;
  tableStart: number;
  entries: DirectoryEntry[];
  normalized: Uint8Array;
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function putU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

function shortName(bytes: Uint8Array, at: number): string | null {
  if (at < 0 || at + 4 > bytes.length) return null;
  const value = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  return /^[\x21-\x7e]{4}$/.test(value) ? value : null;
}

function isMarker(bytes: Uint8Array, at: number, marker: Uint8Array): boolean {
  return at >= 0 && at + marker.length <= bytes.length && marker.every((byte, index) => bytes[at + index] === byte);
}

/**
 * Confirms that one directory entry points to a table header and all declared field descriptors.
 *
 * This deliberately stops at header structure. Row bytes and semantic field meanings are left to the
 * existing parser and datasheet; treating a plausible-looking row value as a field name would violate
 * the exact failure rule this probe is meant to enforce.
 */
function validTableHeader(block: Uint8Array, tableStart: number, tableOffset: number): boolean {
  const at = tableStart + tableOffset;
  if (at < tableStart || at + 36 > block.length) return false;

  const recordSize = u32(block, at + 4);
  const recordCount = u16(block, at + 18);
  const fieldCount = block[at + 24];
  if (recordSize === 0 || recordCount > 250_000 || fieldCount === 0 || fieldCount > 255) return false;
  if (at + 36 + fieldCount * 16 > block.length) return false;

  for (let field = 0; field < fieldCount; field++) {
    const descriptor = at + 36 + field * 16;
    const fieldShort = shortName(block, descriptor + 8);
    const bitOffset = u32(block, descriptor + 4);
    const bitDepth = u32(block, descriptor + 12);
    if (!fieldShort || bitOffset + bitDepth > recordSize * 8) return false;
  }
  return true;
}

/**
 * Tests one hypothesised header layout and returns it only when the WHOLE directory validates.
 */
function testLayout(
  bytes: Uint8Array,
  sourceOffset: number,
  layout: (typeof FBCHUNKS_LAYOUTS)[number]
): ValidatedBlock | null {
  if (sourceOffset + 20 > bytes.length) return null;

  const declaredSize = u32(bytes, sourceOffset + 8);
  if (declaredSize < 64 || sourceOffset + declaredSize > bytes.length) return null;
  const block = bytes.subarray(sourceOffset, sourceOffset + declaredSize);
  const tableCount = u32(block, layout.countAt);
  if (tableCount === 0 || tableCount > MAX_PROBE_TABLES) return null;

  const tableStart = layout.entriesAt + tableCount * 8 + layout.trailerBytes;
  if (layout.entriesAt < 12 || tableStart <= layout.entriesAt || tableStart > declaredSize) return null;

  const entries: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < tableCount; index++) {
    const at = layout.entriesAt + index * 8;
    const name = shortName(block, at);
    const offset = u32(block, at + 4);
    if (!name || seen.has(name) || !validTableHeader(block, tableStart, offset)) return null;
    seen.add(name);
    entries.push({ shortName: name, offset });
  }

  // Re-emit only a canonical DB header + the validated table area. The table-relative offsets remain
  // unchanged, so `readTableHeaders` and the normal parser decode the same confirmed t3db records.
  const canonicalTableStart = 28 + tableCount * 8;
  const tableArea = block.subarray(tableStart);
  const normalized = new Uint8Array(canonicalTableStart + tableArea.length);
  normalized.set(DB_HEADER, 0);
  putU32(normalized, 8, normalized.length);
  putU32(normalized, 16, tableCount);
  for (let index = 0; index < entries.length; index++) {
    const at = 24 + index * 8;
    for (let byte = 0; byte < 4; byte++) {
      normalized[at + byte] = block[layout.entriesAt + index * 8 + byte];
    }
    putU32(normalized, at + 4, entries[index].offset);
  }
  normalized.set(tableArea, canonicalTableStart);

  return { sourceOffset, declaredSize, layout: layout.name, tableStart, entries, normalized };
}

/**
 * Finds FBCHUNKS-contained t3db blocks and normalizes only the validated outer header.
 *
 * The existing drift probe fails before table parsing on this save: raw scanning sees a DB signature
 * inside the FBCHUNKS data and interprets payload bytes as a table count (`2,917,453,911`). This is why
 * the old probe genuinely could not answer the requested question. The data section under the next
 * probe is necessary: it tries bounded, explicit layouts and accepts one only when every table header
 * validates. No guess about schema names participates in that decision.
 */
function normalizeFbChunks(bytes: Uint8Array): { bytes: Uint8Array; blocks: ValidatedBlock[] } | null {
  if (!isMarker(bytes, 0, FBCHUNKS_HEADER)) return null;

  const blocks: ValidatedBlock[] = [];
  let cursor = 0;
  while (cursor < bytes.length - DB_HEADER.length) {
    let at = -1;
    for (let index = cursor; index <= bytes.length - DB_HEADER.length; index++) {
      if (isMarker(bytes, index, DB_HEADER)) {
        at = index;
        break;
      }
    }
    if (at < 0) break;

    const accepted = FBCHUNKS_LAYOUTS.map((layout) => testLayout(bytes, at, layout)).filter(
      (block): block is ValidatedBlock => block !== null
    );
    if (accepted.length > 1) {
      throw new Error(
        `ambiguous FBCHUNKS DB at byte ${at}: validated layouts ${accepted.map((block) => block.layout).join("; ")}`
      );
    }
    if (accepted.length === 1) {
      const block = accepted[0];
      blocks.push(block);
      cursor = at + block.declaredSize;
    } else {
      cursor = at + DB_HEADER.length;
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      "FBCHUNKS container found, but no DB marker had a fully valid supported directory layout; refusing to infer table boundaries."
    );
  }

  const totalBytes = blocks.reduce((total, block) => total + block.normalized.length, 0);
  const normalized = new Uint8Array(totalBytes);
  let offset = 0;
  for (const block of blocks) {
    normalized.set(block.normalized, offset);
    offset += block.normalized.length;
  }
  return { bytes: normalized, blocks };
}

const args = process.argv.slice(2);
const wantsCripple = args.includes("--cripple");
const saveArg = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_SAVE;

async function run(label: string, metaPath: string | null): Promise<void> {
  const candidates = await saveSource.detectSaves(saveArg);
  if (candidates.length === 0) throw new Error(`No save candidates found under ${saveArg}`);

  const save = candidates[0];
  const bytes = await saveSource.readBytes(save);

  // FC27's FBCHUNKS container is not a raw stream of DB_HEADER blocks. The old probe saw an embedded
  // marker in payload bytes and reported the random following word as a table count. Do not pass that
  // unvalidated stream to `parse()`: this path inventories validated table headers and mapping status
  // only, until every required field has a table-local datasheet mapping.
  const fc27 = normalizeFbChunks(bytes);
  if (fc27) {
    const xml = fs.readFileSync(metaPath ?? META, "utf8");
    const meta = parseDbMeta(xml);
    const allNames = new Set<string>();

    console.log(`\n=== ${label} / validated FBCHUNKS inventory ===`);
    console.log(`save: ${save.fileName}`);
    console.log(`FBCHUNKS bytes: ${bytes.length}`);
    console.log(`validated embedded DB blocks: ${fc27.blocks.length}`);

    for (let database = 0; database < fc27.blocks.length; database++) {
      const block = fc27.blocks[database];
      const headerRead = readTableHeaders(block.normalized, meta, database);
      const headers = headerRead.headers as unknown as {
        shortName: string;
        tableName: string | null;
        recordCount: number;
        fieldCount: number;
        fields: { shortName: string; key: string; bitOffset: number; known: boolean }[];
      }[];

      console.log(
        `\nDB${database}: source byte ${block.sourceOffset}, size ${block.declaredSize}, ` +
          `layout ${block.layout}, validated directory entries ${block.entries.length}`
      );

      for (const header of headers) {
        const tableName = header.tableName;
        if (tableName) allNames.add(tableName);
        const localFields = tableName ? meta.fieldNamesByTable.get(tableName) : undefined;
        const fields = header.fields
          .slice()
          .sort((a, b) => a.bitOffset - b.bitOffset)
          .map((field) => {
            const exact = localFields?.get(field.shortName);
            const globalOnly = meta.fieldNames.get(field.shortName);
            if (exact) return `${field.shortName}=${exact}`;
            if (globalOnly) return `${field.shortName}=GLOBAL_ONLY(${globalOnly})`;
            return `${field.shortName}=UNMAPPED`;
          });
        console.log(
          `  ${tableName ?? `UNKNOWN_TABLE(${header.shortName})`}: rows=${header.recordCount} ` +
            `fields=${header.fields.length} [${fields.join(", ")}]`
        );
      }

      for (const short of headerRead.unknownTables) {
        console.log(`  UNKNOWN_TABLE_SHORTNAME: ${short}`);
      }
    }

    const missingRequired = DECODED_TABLES.filter((table) => !allNames.has(table));
    console.log(`\nCurrent parser-required tables absent: ${JSON.stringify(missingRequired)}`);
    console.log(
      "Row decoding is intentionally skipped for FBCHUNKS until required table/column mappings are exact."
    );
    return;
  }

  const parser = createSaveParser(metaPath === null ? {} : { metaPath });
  const data = await parser.parse(save, bytes);
  const drifted = data.tableStats.filter((stat) => stat.unknownFields.length > 0);

  console.log(`\n=== ${label} ===`);
  console.log(`save: ${save.fileName}`);
  console.log(`tables read from the save: ${data.tableStats.length}`);
  console.log(`tables the meta does not know: ${JSON.stringify([...new Set(data.unknownTables)])}`);
  console.log(`tables with fields the meta does not name: ${drifted.length}`);
  for (const stat of drifted.slice(0, 5)) {
    console.log(`  ${stat.tableName}: ${stat.unknownFields.join(", ")}`);
  }
  console.log(`parser warnings (${data.warnings.length}):`);
  for (const warning of data.warnings) console.log(`  - ${warning}`);
}

async function main(): Promise<void> {
  await run("current meta", null);

  if (!wantsCripple) return;

  const xml = fs.readFileSync(META, "utf8");
  // Two separate drifts, because the warning has two branches.
  //
  // The field one has to rename the shortname EVERYWHERE it appears: `fieldNameFor` falls back to a
  // global shortname -> field map when the per-table lookup misses, so a field dropped from one
  // table alone still resolves through another table that declares the same 4-character code.
  const cripples = [
    {
      label: "field shortname renamed in every table that declares it",
      from: 'shortname="zjtP"',
      to: 'shortname="zZZz"',
    },
    {
      label: "table shortname renamed (table becomes unknown)",
      from: '<table name="career_managerhistory" shortname="zgrE"',
      to: '<table name="career_managerhistory" shortname="zGRx"',
    },
  ];

  for (const cripple of cripples) {
    const occurrences = xml.split(cripple.from).length - 1;
    if (occurrences === 0) {
      throw new Error(`Could not cripple the meta: ${cripple.from} was not found.`);
    }
    const crippledPath = path.join(os.tmpdir(), "fifa_ng_db-meta.crippled.xml");
    fs.writeFileSync(crippledPath, xml.split(cripple.from).join(cripple.to));
    await run(`${cripple.label} (${occurrences} edit(s), copy at ${crippledPath})`, crippledPath);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
