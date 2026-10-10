#!/usr/bin/env -S npx tsx
/**
 * FC 27 differential save analyzer.
 *
 * Why this exists
 * ---------------
 * The single-save parser cannot derive `recordSize` / `recordsStart` for most FC 27 tables, because
 * in FC 27 a directory entry does NOT point at the table header (see /memories/repo/notes.md). This
 * script attacks the same problem from a different direction: compare two DIFFERENT careers, so that
 * structure (invariant between saves) separates from content (dynamic between saves).
 *
 * Three independent probes, each of which can stand on its own:
 *
 *   1. Team-id oracle + stride finder. A club id occupies a fixed field inside every player record,
 *      so the byte distance between consecutive club-id hits IS the record size - and the field's
 *      position inside the record is the hit offset modulo that size. Needs no header at all.
 *
 *   2. Lead-field preamble differential. The bytes before a table's first descriptor are compared
 *      across the two saves: dynamic bytes are per-career data, invariant bytes are structure. A
 *      candidate header is then scored on the exact signature a header must have - same record size
 *      in both saves, same field count in both saves, different row count.
 *
 *   3. Directory delta math. FC 27 directory offsets are cumulative, so the delta between two
 *      consecutive entries is that table's payload size. Differencing those sizes across the two
 *      saves and dividing by the row delta yields an implied record width, which is validated
 *      against `teams` (whose true record size, 188, is known).
 *
 * Usage
 * -----
 *   npx tsx scripts/diff-fc27-saves.ts --saveA <path_to_save_A> --saveB <path_to_save_B>
 */

import fs from "node:fs";
import path from "node:path";

import { decodeRows, parseDbMeta, readTableHeaders, unpackDatabases } from "../src/lib/parser/feasibility-parser";
import type { DbMeta } from "../src/lib/parser/interface";

// ---------------------------------------------------------------------------------------------
// Small byte helpers
// ---------------------------------------------------------------------------------------------

const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const u16 = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);
const short4 = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

function isPrintableId(bytes: Uint8Array, at: number): boolean {
  if (at < 0 || at + 4 > bytes.length) return false;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[at + i];
    if (byte < 0x21 || byte > 0x7e) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Save / block / directory layout
// ---------------------------------------------------------------------------------------------

/** fifa_ng_db header arrangements used by the two FC 27 blocks (see the parser's note). */
const DB_HEADER_VARIANTS = [
  { id: "count@+16 dir@+24", countAt: 16, dirAt: 24 },
  { id: "count@+12 dir@+20", countAt: 12, dirAt: 20 },
] as const;

interface DirEntry {
  short: string;
  tableName: string | null;
  /** Directory value, relative to `tablesStart`. FC 27 stores cumulative payload sizes here. */
  offset: number;
  /** Absolute start of this entry's payload. */
  start: number;
  /** Absolute end of this entry's payload (next entry's start, or the end of the block). */
  end: number;
  size: number;
}

interface BlockLayout {
  index: number;
  variant: string;
  tableCount: number;
  dirAt: number;
  tablesStart: number;
  bytes: Uint8Array;
  buffer: Buffer;
  entries: DirEntry[];
}

interface SaveFile {
  label: "A" | "B";
  filePath: string;
  bytes: Uint8Array;
  blocks: BlockLayout[];
}

interface LoadedSave extends SaveFile {
  blockByIndex: Map<number, BlockLayout>;
}

function layoutBlock(bytes: Uint8Array, index: number, meta: DbMeta): BlockLayout | null {
  for (const variant of DB_HEADER_VARIANTS) {
    if (variant.countAt + 4 > bytes.length) continue;
    const tableCount = u32(bytes, variant.countAt);
    if (tableCount <= 0 || tableCount > 4096) continue;
    const tablesStart = variant.dirAt + tableCount * 8 + 4;
    if (tablesStart >= bytes.length) continue;

    const raw: { short: string; offset: number }[] = [];
    let ok = true;
    for (let i = 0; i < tableCount; i++) {
      const at = variant.dirAt + i * 8;
      if (!isPrintableId(bytes, at)) {
        ok = false;
        break;
      }
      raw.push({ short: short4(bytes, at), offset: u32(bytes, at + 4) });
    }
    if (!ok || raw.length !== tableCount) continue;

    // FC 27 offsets are cumulative payload sizes, so they must be non-decreasing and in range.
    let monotonic = true;
    for (let i = 1; i < raw.length; i++) if (raw[i].offset < raw[i - 1].offset) monotonic = false;
    const last = raw[raw.length - 1];
    if (last === undefined || tablesStart + last.offset >= bytes.length) continue;
    if (!monotonic) continue;

    const ordered = raw.slice().sort((a, b) => a.offset - b.offset);
    const ends = new Map<number, number>();
    for (let i = 0; i < ordered.length; i++) {
      const next = ordered[i + 1];
      ends.set(ordered[i].offset, next === undefined ? bytes.length : tablesStart + next.offset);
    }

    const entries: DirEntry[] = raw.map((entry) => {
      const start = tablesStart + entry.offset;
      const end = ends.get(entry.offset) ?? bytes.length;
      return {
        short: entry.short,
        tableName: meta.tableNames.get(entry.short) ?? null,
        offset: entry.offset,
        start,
        end,
        size: Math.max(0, end - start),
      };
    });

    return {
      index,
      variant: variant.id,
      tableCount,
      dirAt: variant.dirAt,
      tablesStart,
      bytes,
      buffer: Buffer.from(bytes),
      entries,
    };
  }
  return null;
}

function loadSave(label: "A" | "B", filePath: string, meta: DbMeta): LoadedSave {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const blocks: BlockLayout[] = [];
  const rawBlocks = unpackDatabases(bytes);
  for (let index = 0; index < rawBlocks.length; index++) {
    const block = layoutBlock(rawBlocks[index], index, meta);
    if (block !== null) blocks.push(block);
  }
  if (blocks.length === 0) throw new Error(`no usable fifa_ng_db block found in ${filePath}`);
  return {
    label,
    filePath,
    bytes,
    blocks,
    blockByIndex: new Map(blocks.map((block) => [block.index, block])),
  };
}

/** The block that carries a table, found by the shortname appearing in its directory. */
function blockForTable(save: LoadedSave, short: string): BlockLayout | null {
  for (const block of save.blocks) if (block.entries.some((entry) => entry.short === short)) return block;
  return null;
}

function entryFor(block: BlockLayout, short: string): DirEntry | null {
  return block.entries.find((entry) => entry.short === short) ?? null;
}

/** The first shortname the datasheet declares for a table - its lead field. */
function leadFieldShort(meta: DbMeta, tableName: string): string | null {
  const fields = meta.fieldNamesByTable.get(tableName);
  if (fields === undefined) return null;
  for (const short of fields.keys()) return short;
  return null;
}

function humanName(meta: DbMeta, tableName: string, short: string): string {
  return meta.fieldNamesByTable.get(tableName)?.get(short) ?? short;
}

// ---------------------------------------------------------------------------------------------
// Module 1 - active team id oracle and stride finder
// ---------------------------------------------------------------------------------------------

interface OracleResult {
  ids: Set<number>;
  rows: number;
  source: string;
  /** Why no oracle was available, when that is the case - never swallow this silently. */
  failure: string | null;
}

/**
 * Club ids, read from the `teams` table of a save through the existing parser.
 *
 * `teams` is the one table FC 27 decodes today (its header sits at the start of the tables region),
 * which is exactly why it can serve as the oracle.
 */
function teamIds(save: LoadedSave, meta: DbMeta): OracleResult {
  const problems: string[] = [];
  for (const block of save.blocks) {
    let headers: ReturnType<typeof readTableHeaders>;
    try {
      headers = readTableHeaders(block.bytes, meta, block.index);
    } catch (error) {
      problems.push(`block ${block.index}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const header = headers.headers.find((candidate) => candidate.tableName === "teams");
    if (header === undefined) {
      problems.push(`block ${block.index}: no table named teams`);
      continue;
    }
    if (header.recordCount === 0) {
      problems.push(`block ${block.index}: teams has 0 rows`);
      continue;
    }
    const key = header.fields.find((field) => field.known && /^teamid$/i.test(field.key))?.key;
    if (key === undefined) {
      problems.push(`block ${block.index}: teams has no teamid field`);
      continue;
    }
    const read = decodeRows(block.bytes, header, meta, { limit: header.recordCount, fields: [key] });
    const ids = new Set<number>();
    const samples: string[] = [];
    for (const row of read.rows) {
      const value = row[key];
      if (samples.length < 5) samples.push(String(value));
      if (typeof value === "number" && value > 0) ids.add(value);
    }
    if (ids.size === 0) {
      const field = header.fields.find((candidate) => candidate.key === key);
      problems.push(
        `block ${block.index}: ${header.shortName} rs=${header.recordSize} rows=${header.recordCount} ` +
          `fc=${header.fieldCount} resolved=${header.fields.filter((f) => f.known).length}, ` +
          `${key} type=${field?.type ?? "?"} bitOffset=${field?.bitOffset ?? "?"} depth=${field?.bitDepth ?? "?"} ` +
          `samples=[${samples.join(", ")}]`
      );
      continue;
    }
    return {
      ids,
      rows: read.rows.length,
      source: `block ${block.index} ${header.shortName} @${header.headerOffset} rs=${header.recordSize}`,
      failure: null,
    };
  }
  return { ids: new Set(), rows: 0, source: "not decodable", failure: problems.join("; ") };
}

interface StrideResult {
  /** Absolute offsets in the scanned range where a value belongs to a club id set. */
  hitsA: number[];
  hitsB: number[];
  /** Offsets that are a club id in BOTH saves - these are structural field slots. */
  common: number[];
  alignment: number;
  /** Where the scan started, so offsets can be reported absolutely. */
  rangeStart: number;
  /** Most frequent gap between consecutive hits, i.e. the obvious record size candidate. */
  modalDelta: number;
  /** Widest gap that nearly every other gap is a multiple of. */
  detectedRecordSize: number;
  /** Share of gaps that are exact multiples of `detectedRecordSize`. */
  consistency: number;
  /** Position of the club-id field inside the record. */
  fieldOffset: number;
  /** Absolute offset of the first record boundary consistent with the stride. */
  recordsStart: number;
  /** Histogram of the most common gaps, largest first. */
  topDeltas: [number, number][];
  /** How the oracle was applied. `shared` means one save's id set was used on BOTH saves' bytes,
   * which is still a cross-save test and is not a weaker one - it removes any id-set difference.
   * `unconfirmed` means only one save showed periodicity, so the stride is a hint, not a result. */
  oracle: "independent" | "shared" | "unconfirmed";
  /** True when the stride is wide enough to be a record AND most gaps divide by it. */
  plausible: boolean;
}

const MIN_STRIDE = 8;
const MAX_STRIDE = 4096;
/** A record narrower than this is not a plausible table row. */
const MIN_PLAUSIBLE_STRIDE = 16;
/** Share of gaps that must divide by the stride before the candidate is worth reporting as real. */
const MIN_CONSISTENCY = 0.6;
const MAX_HITS = 400_000;

function collectHits(region: Uint8Array, ids: Set<number>, alignment: number): number[] {
  const hits: number[] = [];
  for (let at = 0; at + 4 <= region.length; at += alignment) {
    const value = (region[at] | (region[at + 1] << 8) | (region[at + 2] << 16) | (region[at + 3] << 24)) >>> 0;
    if (ids.has(value)) {
      hits.push(at);
      if (hits.length >= MAX_HITS) break;
    }
  }
  return hits;
}

/**
 * Record size from the spacing of club-id hits.
 *
 * Records are ordered by club, so every gap between consecutive hits is a whole number of records.
 * That makes "the value the most gaps are multiples of" the record size, and it is more robust than
 * taking the single most common gap (which under-reports when clubs repeat or players are clubless).
 */
function analyseStride(
  hits: number[],
  rangeStart: number,
  oracle: "independent" | "shared" | "unconfirmed"
): Omit<StrideResult, "hitsA" | "hitsB" | "common" | "alignment" | "rangeStart"> {
  const deltas: number[] = [];
  for (let i = 1; i < hits.length; i++) {
    const delta = hits[i] - hits[i - 1];
    if (delta >= MIN_STRIDE && delta <= MAX_STRIDE) deltas.push(delta);
  }
  if (deltas.length === 0) {
    return {
      modalDelta: 0,
      detectedRecordSize: 0,
      consistency: 0,
      fieldOffset: 0,
      recordsStart: 0,
      topDeltas: [],
      oracle,
      plausible: false,
    };
  }

  const histogram = new Map<number, number>();
  for (const delta of deltas) histogram.set(delta, (histogram.get(delta) ?? 0) + 1);
  const topDeltas: [number, number][] = [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const modalDelta = topDeltas[0][0];

  // Every distinct gap is a candidate; prefer the one the most gaps divide by, and on a tie the
  // largest such candidate, because a smaller divisor of the true stride would also fit.
  let detected = 0;
  let best = -1;
  for (const [candidate] of topDeltas) {
    let matches = 0;
    for (const delta of deltas) if (delta % candidate === 0) matches++;
    if (matches > best || (matches === best && candidate > detected)) {
      best = matches;
      detected = candidate;
    }
  }

  let multiple = 0;
  for (const delta of deltas) if (delta % detected === 0) multiple++;
  const first = hits[0];
  return {
    modalDelta,
    detectedRecordSize: detected,
    consistency: multiple / deltas.length,
    fieldOffset: first % detected,
    recordsStart: rangeStart + first - (first % detected),
    topDeltas,
    oracle,
    plausible: detected >= MIN_PLAUSIBLE_STRIDE && multiple / deltas.length >= MIN_CONSISTENCY,
  };
}

/**
 * Club-id periodicity over one byte range.
 *
 * The offsets that count are the ones that are a club id in BOTH saves. A random 32-bit value is very
 * unlikely to be a club id, and club ids are also unlikely to land on the same byte offset in two
 * different careers by chance, so agreement across the two saves is what makes a hit structural.
 * That agreement is REQUIRED: a scan that cannot be confirmed in the second save returns null rather
 * than reporting the first save's coincidences as a record size.
 */
function strideScan(
  blockA: BlockLayout,
  blockB: BlockLayout | null,
  idsA: Set<number>,
  idsB: Set<number>,
  rangeA: { start: number; end: number },
  rangeB: { start: number; end: number },
  oracleMode: "independent" | "shared"
): StrideResult | null {
  if (blockB === null || idsB.size === 0) return null;
  const startA = Math.max(0, rangeA.start);
  const endA = Math.min(rangeA.end, blockA.bytes.length);
  const startB = Math.max(0, rangeB.start);
  const endB = Math.min(rangeB.end, blockB.bytes.length);

  // Offsets are compared RELATIVE to each save's own region start. A table that moved between the
  // two careers would otherwise never line up, because a club id must sit at the same position
  // inside the record - not at the same absolute address - for the comparison to mean anything.
  const span = Math.min(endA - startA, endB - startB);
  if (span <= 64) return null;
  const sliceA = blockA.bytes.subarray(startA, startA + span);
  const sliceB = blockB.bytes.subarray(startB, startB + span);

  let best: { result: StrideResult; score: number } | null = null;
  for (const alignment of [4, 1]) {
    const hitsA = collectHits(sliceA, idsA, alignment);
    const hitsB = collectHits(sliceB, idsB, alignment);
    if (hitsA.length === 0 || hitsB.length === 0) continue;

    const setB = new Set(hitsB);
    const common = hitsA.filter((offset) => setB.has(offset));
    if (common.length < 8) continue;
    // A genuine table has most of its club-id slots in the same place in both careers. Anything below
    // a quarter is coincidence, not structure.
    if (common.length < hitsA.length / 4) continue;

    const analysis = analyseStride(common, startA, oracleMode);
    const result: StrideResult = {
      hitsA,
      hitsB,
      common,
      alignment,
      rangeStart: startA,
      ...analysis,
    };
    const score = result.consistency * Math.log2(result.common.length + 1);
    if (best === null || score > best.score) best = { result, score };
  }
  return best?.result ?? null;
}

/**
 * Single-save periodicity, used only when the cross-save test cannot align the two tables (the two
 * careers can place a table at different positions inside its own region). A stride found this way
 * is a HINT: one save's coincidences can look periodic, so it is always labelled unconfirmed and
 * always scores below anything both saves agree on.
 */
function strideScanSingle(
  blockA: BlockLayout,
  idsA: Set<number>,
  range: { start: number; end: number }
): StrideResult | null {
  const start = Math.max(0, range.start);
  const end = Math.min(range.end, blockA.bytes.length);
  if (end - start <= 64) return null;
  const slice = blockA.bytes.subarray(start, end);

  let best: { result: StrideResult; score: number } | null = null;
  for (const alignment of [4, 1]) {
    const hits = collectHits(slice, idsA, alignment);
    if (hits.length < 16) continue;
    const analysis = analyseStride(hits, start, "unconfirmed");
    const result: StrideResult = {
      hitsA: hits,
      hitsB: [],
      common: hits,
      alignment,
      rangeStart: start,
      ...analysis,
    };
    if (!result.plausible) continue;
    const score = result.consistency * Math.log2(result.common.length + 1);
    if (best === null || score > best.score) best = { result, score };
  }
  return best?.result ?? null;
}

// ---------------------------------------------------------------------------------------------
// Module 2 - lead-field preamble differential
// ---------------------------------------------------------------------------------------------

interface PreambleHit {
  /** Offset relative to this table's directory-derived region start. */
  offset: number;
  /** Absolute offset in save A's block. */
  absoluteA: number;
  /** Absolute offset in save B's block, paired by proximity. */
  absoluteB: number;
  /** How far the array moved between the two careers. */
  shifted: number;
  /** Inside this table's directory-derived region, i.e. the primary candidate. */
  insideRegion: boolean;
  /** Bytes identical in the 128-byte preamble window. */
  invariantBytes: number;
  windowBytes: number;
  /** Longest run of identical bytes and where it starts, relative to the lead field. */
  longestRun: number;
  longestRunStart: number;
  /** Header candidates: offsets before the lead field with a header-shaped byte pattern. */
  candidates: HeaderCandidate[];
}

interface HeaderCandidate {
  /** Bytes from this candidate to the lead field - the header-to-array distance. */
  distance: number;
  recordSize: number;
  recordSizeMatchesStride: boolean;
  rowsA: number;
  rowsB: number;
  rowsDiffer: boolean;
  fieldCount: number;
  fieldCountMatchesWalk: number;
  score: number;
}

function findOccurrences(buffer: Buffer, needle: string): number[] {
  const pattern = Buffer.from(needle, "latin1");
  const found: number[] = [];
  let at = buffer.indexOf(pattern, 0);
  while (at !== -1 && found.length < 64) {
    found.push(at);
    at = buffer.indexOf(pattern, at + 1);
  }
  return found;
}

/**
 * Header candidates before a lead field.
 *
 * A real header has to satisfy three things at once across two different careers:
 *   - the record size is IDENTICAL (schema does not change between saves),
 *   - the field count is IDENTICAL (same columns),
 *   - the row count is the per-career number, which is allowed to differ.
 * Scoring rewards those, and rewards a record size that agrees with the team-id stride.
 */
function headerCandidates(
  blockA: BlockLayout,
  blockB: BlockLayout,
  leadAbsoluteA: number,
  leadAbsoluteB: number,
  stride: number,
  walkLength: number
): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];
  const highest = 512;
  for (let distance = 4; distance <= highest; distance++) {
    const atA = leadAbsoluteA - distance;
    const atB = leadAbsoluteB - distance;
    if (atA < 0 || atB < 0 || atA + 28 > blockA.bytes.length || atB + 28 > blockB.bytes.length) continue;

    const recordSizeA = u32(blockA.bytes, atA + 4);
    const recordSizeB = u32(blockB.bytes, atB + 4);
    if (recordSizeA !== recordSizeB) continue;
    if (recordSizeA === 0 || recordSizeA > 20_000) continue;

    const fieldCountA = blockA.bytes[atA + 24];
    const fieldCountB = blockB.bytes[atB + 24];
    if (fieldCountA !== fieldCountB) continue;
    if (fieldCountA < 4) continue;

    const rowsA = u16(blockA.bytes, atA + 18);
    const rowsB = u16(blockB.bytes, atB + 18);
    if (rowsA === 0 || rowsB === 0) continue;

    const matchesStride = stride > 0 && recordSizeA === stride;
    let score = 40; // invariant record size
    score += 20; // invariant field count
    if (matchesStride) score += 30;
    if (rowsA !== rowsB) score += 10;

    candidates.push({
      distance,
      recordSize: recordSizeA,
      recordSizeMatchesStride: matchesStride,
      rowsA,
      rowsB,
      rowsDiffer: rowsA !== rowsB,
      fieldCount: fieldCountA,
      fieldCountMatchesWalk: walkLength,
      score,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.distance - b.distance).slice(0, 6);
}

function preambleDifferential(
  saveA: LoadedSave,
  saveB: LoadedSave,
  tableName: string,
  short: string,
  leadField: string,
  stride: number
): PreambleHit[] {
  const blockA = blockForTable(saveA, short);
  const blockB = blockForTable(saveB, short);
  if (blockA === null || blockB === null) return [];
  const regionA = entryFor(blockA, short);
  const regionB = entryFor(blockB, short);
  if (regionA === null || regionB === null) return [];

  const occurrencesA = findOccurrences(blockA.buffer, leadField);
  const occurrencesB = findOccurrences(blockB.buffer, leadField);
  const hits: PreambleHit[] = [];

  // Pair occurrences by PROXIMITY, not by ordinal: if the array shifted between careers, ordinal
  // pairing would diff unrelated bytes and report meaningless "invariant" runs.
  const pairs: { a: number; b: number; distance: number }[] = [];
  for (const a of occurrencesA) {
    let bestB = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const b of occurrencesB) {
      const distance = Math.abs(a - b);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestB = b;
      }
    }
    // Pair each A occurrence with the NEAREST B occurrence, with no distance cut-off: how far the
    // array moved between the two careers is itself a result, and the shift is reported so a diff of
    // unrelated bytes can never be mistaken for a structural match.
    if (bestB >= 0) pairs.push({ a, b: bestB, distance: bestDistance });
  }

  for (const pair of pairs.slice(0, 8)) {
    const absoluteA = pair.a;
    const absoluteB = pair.b;
    const windowStartA = Math.max(0, absoluteA - 128);
    const windowStartB = Math.max(0, absoluteB - 128);
    const windowBytes = absoluteA - windowStartA;

    let invariant = 0;
    let run = 0;
    let longestRun = 0;
    let longestRunStart = 0;
    for (let i = 0; i < windowBytes; i++) {
      if (blockA.bytes[windowStartA + i] === blockB.bytes[windowStartB + i]) {
        invariant++;
        run++;
        if (run > longestRun) {
          longestRun = run;
          longestRunStart = i - run + 1;
        }
      } else {
        run = 0;
      }
    }

    hits.push({
      offset: absoluteA - regionA.start,
      absoluteA,
      absoluteB,
      shifted: pair.distance,
      insideRegion: absoluteA >= regionA.start && absoluteA < regionA.end,
      invariantBytes: invariant,
      windowBytes,
      longestRun,
      longestRunStart: longestRunStart - windowBytes,
      candidates: headerCandidates(blockA, blockB, absoluteA, absoluteB, stride, 0),
    });
  }
  void tableName;
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Module 3 - directory delta payload math
// ---------------------------------------------------------------------------------------------

interface DeltaRow {
  short: string;
  tableName: string | null;
  offsetA: number;
  offsetB: number;
  deltaOffset: number;
  sizeA: number;
  sizeB: number;
  deltaSize: number;
  rowsA: number | null;
  rowsB: number | null;
  deltaRows: number | null;
  /** Implied bytes per row, from deltaSize / deltaRows. Null when the row delta is unknown or zero. */
  impliedRecordWidth: number | null;
}

function directoryDeltas(
  saveA: LoadedSave,
  saveB: LoadedSave,
  rowsByName: Map<string, { a: number | null; b: number | null }>
): DeltaRow[] {
  const rows: DeltaRow[] = [];
  const seen = new Set<string>();
  for (const blockA of saveA.blocks) {
    const blockB = saveB.blockByIndex.get(blockA.index);
    if (blockB === undefined) continue;
    for (const entryA of blockA.entries) {
      if (seen.has(entryA.short)) continue;
      seen.add(entryA.short);
      const entryB = entryFor(blockB, entryA.short);
      if (entryB === null) continue;
      const deltaSize = entryB.size - entryA.size;
      const known = rowsByName.get(entryA.short);
      const deltaRows =
        known?.a !== null && known?.a !== undefined && known?.b !== null && known?.b !== undefined
          ? known.b - known.a
          : null;
      rows.push({
        short: entryA.short,
        tableName: entryA.tableName,
        offsetA: entryA.offset,
        offsetB: entryB.offset,
        deltaOffset: entryB.offset - entryA.offset,
        sizeA: entryA.size,
        sizeB: entryB.size,
        deltaSize,
        rowsA: known?.a ?? null,
        rowsB: known?.b ?? null,
        deltaRows,
        impliedRecordWidth:
          deltaRows !== null && deltaRows !== 0 ? Number((deltaSize / deltaRows).toFixed(3)) : null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

interface DifferentialAnalysisResult {
  tableName: string;
  detectedRecordSize: number;
  recordsStartOffset: number;
  headerOffsetCandidate: number;
  confidenceScore: number;
}

const pad = (value: string | number, width: number): string =>
  String(value).length >= width ? String(value) : String(value) + " ".repeat(width - String(value).length);
const padLeft = (value: string | number, width: number): string => {
  const text = String(value);
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
};
const rule = (width = 92): string => "─".repeat(width);

/** Blend, in percent: stride consistency 60, region divisibility 25, header agreement 15. */
function confidenceFor(
  consistency: number,
  regionSize: number,
  stride: number,
  headerMatchesStride: boolean
): number {
  if (stride <= 0) return 0;
  const remainder = regionSize % stride;
  const divisibility = remainder === 0 ? 1 : Math.max(0, 1 - remainder / stride);
  const headerAgreement = headerMatchesStride ? 1 : 0;
  return Math.round(100 * (0.6 * consistency + 0.25 * divisibility + 0.15 * headerAgreement));
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

interface Args {
  saveA: string | null;
  saveB: string | null;
  metaPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    saveA: null,
    saveB: null,
    metaPath: path.join("public", "parse-resources", "fifa_ng_db-meta.xml"),
  };
  for (let i = 0; i < argv.length; i++) {
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${argv[i - 1]} requires a value`);
      return value;
    };
    switch (argv[i]) {
      case "--saveA":
        args.saveA = next();
        break;
      case "--saveB":
        args.saveB = next();
        break;
      case "--meta":
        args.metaPath = next();
        break;
    }
  }
  return args;
}

/**
 * The Save A safety baseline.
 *
 * `teams` (lyxL) is the one FC27 table whose header, record size and row count are all independently
 * established, so it is the canary for any change to the descriptor reader. A regression here is
 * SILENT - the table still decodes, just wrongly - so it is asserted rather than eyeballed.
 */
const BASELINE_TEAMS = { rows: 870, recordSize: 188 } as const;

function assertSaveABaseline(save: LoadedSave, meta: DbMeta): boolean {
  console.log("\nSAVE A BASELINE ASSERTION");
  for (const block of save.blocks) {
    let headers: ReturnType<typeof readTableHeaders>;
    try {
      headers = readTableHeaders(block.bytes, meta, block.index);
    } catch (error) {
      console.log(
        `  skip  block ${block.index}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    const header = headers.headers.find((candidate) => candidate.tableName === "teams");
    if (header === undefined) continue;
    const ok =
      header.recordCount === BASELINE_TEAMS.rows && header.recordSize === BASELINE_TEAMS.recordSize;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  teams (${header.shortName}) in block ${block.index}: ` +
        `${header.recordCount} rows @ recordSize ${header.recordSize}, ${header.fieldCount} fields ` +
        `(baseline ${BASELINE_TEAMS.rows} rows @ ${BASELINE_TEAMS.recordSize})`
    );
    return ok;
  }
  console.log(`  FAIL  teams was not found in any block of ${save.filePath}`);
  return false;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.saveA === null || args.saveB === null) {
    console.error("usage: npx tsx scripts/diff-fc27-saves.ts --saveA <path> --saveB <path> [--meta <xml>]");
    process.exit(1);
  }
  for (const [label, file] of [["A", args.saveA], ["B", args.saveB]] as const) {
    if (!fs.existsSync(file)) {
      console.error(`save ${label} not found: ${file}`);
      process.exit(1);
    }
  }

  const meta = parseDbMeta(fs.readFileSync(args.metaPath, "utf8"));
  const saveA = loadSave("A", args.saveA, meta);
  const saveB = loadSave("B", args.saveB, meta);

  console.log(`\n${rule()}\nFC 27 DIFFERENTIAL SAVE ANALYSIS\n${rule()}`);
  console.log(`  save A  ${saveA.filePath}  (${saveA.bytes.length.toLocaleString()} bytes)`);
  console.log(`  save B  ${saveB.filePath}  (${saveB.bytes.length.toLocaleString()} bytes)`);

  console.log("\nBLOCK LAYOUT");
  for (const save of [saveA, saveB]) {
    for (const block of save.blocks) {
      console.log(
        `  ${save.label}  block ${block.index}  ${padLeft(block.bytes.length, 9)} bytes  ` +
          `${padLeft(block.tableCount, 3)} tables  variant=${block.variant}  tablesStart=${block.tablesStart}`
      );
    }
  }

  // Checked before anything else is reported, so a moved baseline is the loudest thing in the output.
  if (!assertSaveABaseline(saveA, meta)) {
    console.log(
      "\n  The Save A baseline has moved. That is a regression in the descriptor reader rather than a\n" +
        "  difference between the saves: FC27's address-based path is the one every other save relies on."
    );
    process.exitCode = 1;
  }

  // Differential profile: how much of each block actually differs between the two careers.
  console.log("\nDIFFERENTIAL PROFILE (byte equality between A and B)");  for (const blockA of saveA.blocks) {
    const blockB = saveB.blockByIndex.get(blockA.index);
    if (blockB === undefined || blockB.bytes.length !== blockA.bytes.length) continue;
    let differing = 0;
    let firstDiff = -1;
    let lastDiff = -1;
    for (let at = 0; at < blockA.bytes.length; at++) {
      if (blockA.bytes[at] !== blockB.bytes[at]) {
        differing++;
        if (firstDiff < 0) firstDiff = at;
        lastDiff = at;
      }
    }
    const percent = ((differing / blockA.bytes.length) * 100).toFixed(2);
    console.log(
      `  block ${blockA.index}  ${padLeft(differing.toLocaleString(), 10)} bytes differ (${pad(percent, 6)}%)` +
        (firstDiff < 0 ? "  [identical]" : `  first=${firstDiff} last=${lastDiff}`)
    );
  }

  // ---- Module 1: team id oracle -------------------------------------------------------------
  const oracleA = teamIds(saveA, meta);
  const oracleB = teamIds(saveB, meta);
  console.log(`\n${rule()}\n[1] ACTIVE TEAM ID ORACLE & STRIDE FINDER\n${rule()}`);
  console.log(`  A  ${padLeft(oracleA.ids.size, 5)} club ids from ${padLeft(oracleA.rows, 5)} rows  (${oracleA.source})`);
  console.log(`  B  ${padLeft(oracleB.ids.size, 5)} club ids from ${padLeft(oracleB.rows, 5)} rows  (${oracleB.source})`);
  if (oracleA.failure !== null) console.log(`      A oracle failure: ${oracleA.failure}`);
  if (oracleB.failure !== null) console.log(`      B oracle failure: ${oracleB.failure}`);
  const shared = [...oracleA.ids].filter((id) => oracleB.ids.has(id)).length;
  console.log(`  shared club ids: ${shared} of ${oracleA.ids.size}`);

  // If a save cannot produce its own oracle, A's id set is applied to BOTH saves' bytes. That is not
  // a weaker test - it is a stricter one, because it removes any id-set difference and still demands
  // that the same byte offsets carry a club id in two different careers.
  const oracleMode: "independent" | "shared" = oracleB.ids.size > 0 ? "independent" : "shared";
  const idsB = oracleB.ids.size > 0 ? oracleB.ids : oracleA.ids;
  console.log(
    `  oracle mode: ${oracleMode}` +
      (oracleMode === "shared" ? " (B has no own oracle; A's ids used on both saves' bytes)" : "")
  );

  const targets: [string, string][] = [
    ["players", "CZUM"],
    ["manager", "Knen"],
    ["career_youthplayers", "IOmq"],
    ["cm_teamsheets", "zdMM"],
  ];

  const strides = new Map<string, StrideResult | null>();
  const scopes = new Map<string, "region" | "block">();
  const regions = new Map<string, { regionA: DirEntry; regionB: DirEntry; blockA: BlockLayout }>();
  const strength = (result: StrideResult): number =>
    result.consistency * Math.log2(result.common.length + 1);

  for (const [tableName, short] of targets) {
    const blockA = blockForTable(saveA, short);
    if (blockA === null) {
      strides.set(tableName, null);
      continue;
    }
    const blockB = saveB.blockByIndex.get(blockA.index) ?? null;
    const entryA = entryFor(blockA, short);
    const entryB = blockB === null ? null : entryFor(blockB, short);
    if (entryA === null || entryB === null) {
      strides.set(tableName, null);
      continue;
    }
    regions.set(tableName, { regionA: entryA, regionB: entryB, blockA });

    // FC 27's directory offsets do not delineate a single table's payload, so the table's own region
    // is only the first scope tried. The whole block is the fallback, and whichever yields the
    // stronger periodic signal is the one reported - with its scope named.
    let result = strideScan(
      blockA,
      blockB,
      oracleA.ids,
      idsB,
      { start: entryA.start, end: entryA.end },
      { start: entryB.start, end: entryB.end },
      oracleMode
    );
    let scope: "region" | "block" = "region";
    if (blockB !== null) {
      const whole = strideScan(
        blockA,
        blockB,
        oracleA.ids,
        idsB,
        { start: 0, end: blockA.bytes.length },
        { start: 0, end: blockB.bytes.length },
        oracleMode
      );
      if (whole !== null && (result === null || strength(whole) > strength(result))) {
        result = whole;
        scope = "block";
      }
    }

    // Cross-save alignment failed, so fall back to single-save periodicity and mark it unconfirmed.
    if (result === null) {
      const single = strideScanSingle(blockA, oracleA.ids, { start: 0, end: blockA.bytes.length });
      if (single !== null) {
        result = single;
        scope = "block";
      }
    }
    strides.set(tableName, result);
    scopes.set(tableName, scope);
  }

  console.log(
    `\n  ${pad("table", 20)} ${padLeft("stride", 7)} ${padLeft("ok", 4)} ${padLeft("scope", 7)} ${padLeft("hitsA", 7)} ` +
      `${padLeft("shared", 7)} ${padLeft("consist", 8)} ${padLeft("field@", 7)} ${padLeft("recordsStart", 13)} ${padLeft("rows~", 8)}`
  );
  for (const [tableName, short] of targets) {
    const stride = strides.get(tableName) ?? null;
    const region = regions.get(tableName);
    if (stride === null || region === undefined) {
      console.log(
        `  ${pad(tableName, 20)}        no cross-save club-id periodicity (${short}) - ` +
          `not a confident candidate`
      );
      continue;
    }
    const scope = scopes.get(tableName) ?? "region";
    const spanEnd = scope === "region" ? region.regionA.end : region.blockA.bytes.length;
    const impliedRows =
      stride.detectedRecordSize > 0
        ? Math.max(0, Math.floor((spanEnd - stride.recordsStart) / stride.detectedRecordSize))
        : 0;
    console.log(
      `  ${pad(tableName, 20)} ${padLeft(stride.detectedRecordSize, 7)} ${padLeft(stride.plausible ? "yes" : "NO", 4)} ` +
        `${padLeft(scope, 7)} ${padLeft(stride.hitsA.length, 7)} ${padLeft(stride.common.length, 7)} ` +
        `${padLeft(`${(stride.consistency * 100).toFixed(1)}%`, 8)} ${padLeft(stride.fieldOffset, 7)} ` +
        `${padLeft(stride.recordsStart, 13)} ${padLeft(impliedRows, 8)}`
    );
    console.log(
      `        alignment=${stride.alignment}  oracle=${stride.oracle}  modal gap=${stride.modalDelta}  top gaps=` +
        stride.topDeltas.map(([value, count]) => `${value}x${count}`).join(", ") +
        `  region ${region.regionA.start}..${region.regionA.end} (${region.regionA.size.toLocaleString()} B)`
    );
  }

  // ---- Module 2: preamble differential ------------------------------------------------------
  console.log(`\n${rule()}\n[2] LEAD-FIELD PREAMBLE DIFFERENTIAL\n${rule()}`);
  const preambles = new Map<string, PreambleHit[]>();
  for (const [tableName, short] of targets) {
    const lead = leadFieldShort(meta, tableName);
    if (lead === null) {
      console.log(`  ${tableName}: not in the datasheet`);
      continue;
    }
    const stride = strides.get(tableName) ?? null;
    const hits = preambleDifferential(saveA, saveB, tableName, short, lead, stride?.detectedRecordSize ?? 0);
    preambles.set(tableName, hits);
    if (hits.length === 0) {
      console.log(`  ${tableName}: lead field "${lead}" not found in both saves`);
      continue;
    }
    console.log(
      `  ${tableName}  lead "${lead}" (${humanName(meta, tableName, lead)})  ` +
        `${hits.length} paired occurrence(s)`
    );
    for (const hit of hits.slice(0, 3)) {
      console.log(
        `      @${hit.absoluteA}${hit.insideRegion ? "" : " [OUTSIDE region]"}` +
          `  B@${hit.absoluteB}  shift=${hit.shifted}` +
          `  invariant ${hit.invariantBytes}/${hit.windowBytes} bytes` +
          `  longest run ${hit.longestRun} starting ${hit.longestRunStart}` +
          (hit.shifted === 0 ? "  [aligned]" : "  [diff is across a shifted array]")
      );
      for (const candidate of hit.candidates.slice(0, 3)) {
        console.log(
          `          header h-${padLeft(candidate.distance, 3)}  rs=${padLeft(candidate.recordSize, 6)}` +
            `${candidate.recordSizeMatchesStride ? " (=stride)" : "         "}` +
            `  fc=${padLeft(candidate.fieldCount, 3)}  rows A=${padLeft(candidate.rowsA, 6)} B=${padLeft(candidate.rowsB, 6)}` +
            `${candidate.rowsDiffer ? " (differ)" : " (same)"}  score=${candidate.score}`
        );
      }
    }
  }

  // ---- Module 3: directory delta math --------------------------------------------------------
  const rowsByName = new Map<string, { a: number | null; b: number | null }>();
  for (const block of saveA.blocks) {
    for (const entry of block.entries) {
      rowsByName.set(entry.short, { a: entry.short === "lyxL" ? oracleA.rows : null, b: null });
    }
  }
  for (const [short, value] of rowsByName) value.b = short === "lyxL" ? oracleB.rows : null;
  // Tables whose row count the stride finder recovered get a real row pair, which is what turns a
  // payload delta into a record width.
  for (const [tableName, short] of targets) {
    const stride = strides.get(tableName) ?? null;
    const region = regions.get(tableName);
    if (stride === null || region === undefined || stride.detectedRecordSize <= 0) continue;
    // Block B is the same size and shape as block A, so A's recovered records start is used for both;
    // the row DELTA is what module 3 needs, and it is insensitive to a small constant offset.
    const rowsA = Math.max(0, Math.floor((region.regionA.end - stride.recordsStart) / stride.detectedRecordSize));
    const rowsB = Math.max(0, Math.floor((region.regionB.end - stride.recordsStart) / stride.detectedRecordSize));
    rowsByName.set(short, { a: rowsA, b: rowsB });
  }

  const deltas = directoryDeltas(saveA, saveB, rowsByName);
  console.log(`\n${rule()}\n[3] DIRECTORY DELTA PAYLOAD MATH\n${rule()}`);
  console.log(`  FC 27 offsets are cumulative payload sizes, so consecutive deltas are table sizes.`);
  const changed = deltas.filter((row) => row.deltaSize !== 0);
  console.log(`  ${changed.length} of ${deltas.length} tables changed size between the saves\n`);
  console.log(
    `  ${pad("table", 26)} ${pad("short", 6)} ${padLeft("Δoffset", 10)} ${padLeft("sizeA", 11)} ${padLeft("sizeB", 11)} ` +
      `${padLeft("Δsize", 9)} ${padLeft("Δrows", 7)} ${padLeft("implied w", 10)}`
  );
  for (const row of changed.sort((a, b) => Math.abs(b.deltaSize) - Math.abs(a.deltaSize)).slice(0, 18)) {
    console.log(
      `  ${pad(row.tableName ?? "?", 26)} ${pad(row.short, 6)} ${padLeft(row.deltaOffset, 10)} ` +
        `${padLeft(row.sizeA.toLocaleString(), 11)} ${padLeft(row.sizeB.toLocaleString(), 11)} ` +
        `${padLeft(row.deltaSize, 9)} ${padLeft(row.deltaRows ?? "—", 7)} ${padLeft(row.impliedRecordWidth ?? "—", 10)}`
    );
  }
  const teamsDelta = deltas.find((row) => row.tableName === "teams");
  if (teamsDelta !== undefined) {
    console.log(
      `\n  validation: teams Δsize=${teamsDelta.deltaSize} Δrows=${teamsDelta.deltaRows} ` +
        `implied width=${teamsDelta.impliedRecordWidth ?? "—"} (the known true value is 188)`
    );
  }

  // ---- Module 4: report ---------------------------------------------------------------------
  const report: DifferentialAnalysisResult[] = targets.map(([tableName]) => {
    const stride = strides.get(tableName) ?? null;
    const region = regions.get(tableName);
    const preamble = preambles.get(tableName) ?? [];
    const bestCandidate = preamble
      .flatMap((hit) => hit.candidates)
      .sort((a, b) => b.score - a.score)[0];

    if (stride === null || region === undefined) {
      return {
        tableName,
        detectedRecordSize: bestCandidate?.recordSize ?? 0,
        recordsStartOffset: 0,
        headerOffsetCandidate: 0,
        confidenceScore: 0,
      };
    }
    const rowsStartAbsolute = stride.recordsStart;
    const headerOffsetCandidate =
      bestCandidate === undefined
        ? 0
        : (preamble[0]?.absoluteA ?? 0) - bestCandidate.distance;
    const scope = scopes.get(tableName) ?? "region";
    const span = scope === "region" ? region.regionA.size : region.blockA.bytes.length;
    return {
      tableName,
      detectedRecordSize: stride.detectedRecordSize,
      recordsStartOffset: rowsStartAbsolute,
      headerOffsetCandidate,
      confidenceScore: confidenceFor(
        stride.consistency,
        span,
        stride.detectedRecordSize,
        bestCandidate?.recordSizeMatchesStride ?? false
      ),
    };
  });

  console.log(`\n${rule()}\n[4] DERIVED PARAMETERS\n${rule()}`);
  console.log(JSON.stringify(report, null, 2));

  console.log(`\n${rule()}`);
  const confident = report.filter((row) => row.confidenceScore >= 50);
  const candidates = report.filter((row) => row.detectedRecordSize > 0);
  console.log(
    `VERDICT: ${candidates.length}/${report.length} target tables have a candidate record size; ` +
      `${confident.length} of those reach 50% confidence.`
  );
  for (const row of report) {
    const stride = strides.get(row.tableName) ?? null;
    console.log(
      `  ${pad(row.tableName, 20)} rs=${padLeft(row.detectedRecordSize, 6)} ` +
        `recordsStart=${padLeft(row.recordsStartOffset, 13)} conf=${padLeft(row.confidenceScore, 4)}%` +
        (stride === null || !stride.plausible
          ? "   <- weak: no club-id periodicity wide enough to be a record"
          : "")
    );
  }
}

main();
