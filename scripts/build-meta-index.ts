/**
 * Regenerates `public/parse-resources/meta-index.json`, the table-id set of every datasheet.
 *
 *   npx tsx scripts/build-meta-index.ts [--check]
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN BY HAND. The index is the only thing that identifies which
 * game wrote a save, and it does that by comparing the save's own table ids against each datasheet's.
 * A hand-written copy of 1,000-odd four-character ids would be wrong within a week of anybody touching
 * a meta file, and wrong in the worst way: identification would silently pick the neighbouring game and
 * every field would decode from the wrong bit offsets.
 *
 * It doubles as the check that a new datasheet is USABLE, so `--check` reports a non-zero count of
 * tables and fields per file and fails on a file the parser cannot read at all. That is the gate for
 * adding a game to `GAME_METAS`.
 */
import fs from "fs";
import path from "path";
import { parseDbMeta } from "../src/lib/parser/feasibility-parser";
import { GAME_METAS, META_INDEX_FILE, type MetaIndex } from "../src/lib/parser/game-versions";

const DIR = path.join(process.cwd(), "public", "parse-resources");
const TARGET = path.join(DIR, META_INDEX_FILE);
const checkOnly = process.argv.includes("--check");

const index: MetaIndex = { versions: [] };
/** One datasheet can serve several ids (FC 25/26/27 share one), so it is parsed once. */
const parsed = new Map<string, { tables: number; fields: number }>();

let failed = false;

for (const descriptor of GAME_METAS) {
  const file = path.join(DIR, descriptor.metaFile);
  if (!fs.existsSync(file)) {
    console.log(`  MISSING  ${descriptor.id.padEnd(7)} ${descriptor.metaFile}`);
    failed = true;
    continue;
  }

  if (!parsed.has(descriptor.metaFile)) {
    const meta = parseDbMeta(fs.readFileSync(file, "utf8"));
    let fields = 0;
    for (const count of meta.fieldCountByTable.values()) fields += count;
    parsed.set(descriptor.metaFile, { tables: meta.tableNames.size, fields });
  }
  const counts = parsed.get(descriptor.metaFile)!;

  if (counts.tables === 0) {
    console.log(`  UNREADABLE ${descriptor.id.padEnd(6)} ${descriptor.metaFile}: 0 tables`);
    failed = true;
    continue;
  }

  const meta = parseDbMeta(fs.readFileSync(file, "utf8"));
  index.versions.push({ id: descriptor.id, tableIds: [...meta.tableNames.keys()].sort() });
  console.log(
    `  ok       ${descriptor.id.padEnd(7)} ${descriptor.metaFile.padEnd(30)} ` +
      `${String(counts.tables).padStart(4)} tables, ${String(counts.fields).padStart(6)} fields, ` +
      `support ${descriptor.support}`
  );
}

if (failed) {
  console.error("\nAt least one datasheet is missing or unreadable. Nothing was written.");
  process.exit(1);
}

// A save can only be identified against a datasheet that is in the index, so the two lists must agree.
const indexed = new Set(index.versions.map((entry) => entry.id));
const missing = GAME_METAS.filter((meta) => !indexed.has(meta.id));
if (missing.length > 0) {
  console.error(`Not indexed: ${missing.map((meta) => meta.id).join(", ")}`);
  process.exit(1);
}

const serialised = `${JSON.stringify(index)}\n`;

if (checkOnly) {
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : null;
  if (current !== serialised) {
    console.error(`\n${META_INDEX_FILE} is out of date. Run without --check to rewrite it.`);
    process.exit(1);
  }
  console.log(`\n${META_INDEX_FILE} is up to date (${index.versions.length} versions).`);
} else {
  fs.writeFileSync(TARGET, serialised, "utf8");
  const kb = (Buffer.byteLength(serialised) / 1024).toFixed(1);
  console.log(`\nWrote ${META_INDEX_FILE}: ${index.versions.length} versions, ${kb} KB.`);
}
