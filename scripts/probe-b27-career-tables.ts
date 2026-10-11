/**
 * Probe: do the four career tables resolve in a given save?
 *
 * Answers, per unpacked database block: whether the table headers were located at all, which of the target
 * tables were named, and what recordSize / recordsStart each one resolved to. Existence and resolution are
 * reported separately, because "the table is missing" and "the table is there but its header was not found"
 * are different outcomes with different fixes.
 *
 *   npx tsx scripts/probe-b27-career-tables.ts <save> [<save> ...]
 */
import fs from "node:fs";
import path from "node:path";
import { inspectDatabaseBlocks, parseDbMeta, readTableHeaders } from "../src/lib/parser/feasibility-parser";

const TARGETS = ["players", "manager", "career_managerinfo", "career_youthplayers", "cm_teamsheets", "teams"];

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: npx tsx scripts/probe-b27-career-tables.ts <save> [<save> ...]");
    process.exit(1);
  }
  const meta = parseDbMeta(
    fs.readFileSync(path.join("references", "fc26companion", "data", "fifa_ng_db-meta.xml"), "utf8")
  );

  for (const file of files) {
    console.log(`\n${file}`);
    const save = new Uint8Array(fs.readFileSync(file));
    const blocks = inspectDatabaseBlocks(save);
    console.log(`  ${blocks.length} database block(s): ${blocks.map((b) => b.bytes.length).join(", ")}`);

    for (const block of blocks) {
      const read = readTableHeaders(block.bytes, meta, block.offset);
      const named = read.headers.filter((h) => h.tableName !== null);
      console.log(
        `  block @${block.offset} (${block.bytes.length} bytes)  located=${read.headers.length}  ` +
          `named=${named.length}  unknown=[${read.unknownTables.join(" ")}]`
      );
      if (read.warnings.length > 0) {
        for (const warning of read.warnings.slice(0, 4)) console.log(`      warn: ${warning}`);
      }
      const shortsOf = new Map<string, string>();
      for (const header of named) shortsOf.set(header.tableName as string, header.shortName);
      for (const table of TARGETS) {
        const header = read.headers.find((h) => h.tableName === table);
        if (header === undefined) {
          console.log(`      ${table.padEnd(22)} NOT FOUND (in a block whose directory has ${named.length} named tables)`);
          continue;
        }
        console.log(
          `      ${table.padEnd(22)} ${header.shortName}  recordSize=${header.recordSize}  ` +
            `recordsStart=${header.recordsStart}  rows=${header.recordCount}  ` +
            `fields=${header.fields.filter((f) => f.known).length}/${header.fieldCount}`
        );
      }
    }
  }
}

main();
