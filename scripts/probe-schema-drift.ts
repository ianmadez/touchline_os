/**
 * Read-only: does the meta XML actually match the schema of the save it is decoding?
 *
 * Our meta is a reference file that ships with `references/fc26companion`, while a career save can
 * come from any EA SPORTS FC title. If the save holds a table or a field the meta does not know, the
 * decode still "succeeds" - but values are read off unnamed columns. `parse()` now reports that as a
 * parser warning; this script prints the warnings and the underlying drift counts.
 *
 * `--cripple` is the positive test: it renames one known field away in a COPY of the meta, parses
 * with that copy, and shows the warning firing. The copy is written to the OS temp directory, so the
 * repo's reference meta is never modified.
 *
 *   npx tsx scripts/probe-schema-drift.ts
 *   npx tsx scripts/probe-schema-drift.ts --cripple
 *   npx tsx scripts/probe-schema-drift.ts path/to/save
 */
import fs from "fs";
import os from "os";
import path from "path";
import { FeasibilitySaveParser } from "../src/lib/parser/feasibility-parser";

const META = path.join("references", "fc26companion", "data", "fifa_ng_db-meta.xml");
const DEFAULT_SAVE = path.join("data", "saves");

const args = process.argv.slice(2);
const wantsCripple = args.includes("--cripple");
const saveArg = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_SAVE;

async function run(label: string, metaPath: string | null): Promise<void> {
  const parser = new FeasibilitySaveParser(metaPath === null ? {} : { metaPath });
  const candidates = await parser.detectSaves(saveArg);
  if (candidates.length === 0) throw new Error(`No save candidates found under ${saveArg}`);

  const save = candidates[0];
  const data = await parser.parse(save);
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
