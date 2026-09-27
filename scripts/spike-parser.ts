/**
 * TouchlineOS — Phase 0 Parser Spike Script.
 * Runs against save files and outputs full field breakdown and verdict to console & JSON.
 */
import fs from "fs";
import path from "path";

import { FeasibilitySaveParser } from "../src/lib/parser/feasibility-parser";
import type {
  FactCategory,
  SaveCandidate,
  SaveFact,
  SpikeCareerData,
  SquadEntry,
  TableStat,
} from "../src/lib/parser/interface";

interface Args {
  savePath: string | null;
  dir: string | null;
  rows: number;
  all: boolean;
  everySave: boolean;
  exportJson: boolean;
  metaPath: string | null;
  nameTablePath: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    savePath: null,
    dir: null,
    rows: 60,
    all: false,
    everySave: false,
    exportJson: true,
    metaPath: null,
    nameTablePath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--save":
      case "--path":
      case "-p":
        args.savePath = next();
        break;
      case "--dir":
        args.dir = next();
        break;
      case "--rows":
        args.rows = Math.max(1, Number(next()) || 60);
        break;
      case "--all":
        args.all = true;
        break;
      case "--every-save":
        args.everySave = true;
        break;
      case "--meta":
        args.metaPath = next();
        break;
      case "--names":
        args.nameTablePath = next();
        break;
      case "--no-export":
        args.exportJson = false;
        break;
    }
  }
  return args;
}

const rule = (width = 84): string => "─".repeat(width);
const pad = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
const padLeft = (value: string | number, width: number): string => {
  const text = String(value);
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
};
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const orDash = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function printLocations(locations: { path: string; label: string; exists: boolean }[]): void {
  console.log("\nSEARCH LOCATIONS");
  for (const location of locations) {
    console.log(`  ${location.exists ? "FOUND" : "MISS "}  ${pad(location.label, 34)} ${location.path}`);
  }
}

function printFingerprint(data: SpikeCareerData, save: SaveCandidate): void {
  const fp = data.fingerprint;
  console.log("\nCONTAINER PROFILE");
  console.log(`  file             ${save.fileName}`);
  console.log(`  path             ${save.filePath}`);
  console.log(`  size             ${mb(fp.sizeBytes)} · modified ${save.lastModified.toISOString()}`);
  console.log(`  container        ${fp.container}`);
  console.log(`  head hex         ${fp.headHex}`);
  console.log(`  database blocks  ${fp.databaseBlocks} block(s), ${mb(fp.databaseBytes)}`);
}

function printTables(stats: TableStat[], limit = 15): void {
  console.log("\nPARSED TABLES (Top rows)");
  const sorted = [...stats].sort((a, b) => b.rows - a.rows);
  console.log(`  ${padLeft("rows", 8)} ${padLeft("fields", 7)} ${pad("table name", 32)} short`);
  for (const stat of sorted.slice(0, limit)) {
    console.log(
      `  ${padLeft(stat.rows, 8)} ${padLeft(stat.fields, 7)} ${pad(stat.tableName ?? `?${stat.shortName}`, 32)} ${stat.shortName}`
    );
  }
  if (sorted.length > limit) {
    console.log(`  … ${sorted.length - limit} more tables recorded in output JSON`);
  }
}

function printFacts(facts: SaveFact[]): void {
  console.log("\nFACTS EXTRACTED (PROVENANCE = SAVE)");
  for (const fact of facts) {
    console.log(`  [${pad(fact.category ?? "general", 13)}] ${pad(fact.label, 30)} : ${orDash(fact.value)} (${fact.source})`);
  }
}

function printSquad(squad: SquadEntry[]): void {
  console.log("\nDECODED SQUAD SAMPLE");
  if (squad.length === 0) {
    console.log("  (no squad rows decoded)");
    return;
  }
  console.log(`  ${pad("#", 8)} ${pad("Name", 24)} ${padLeft("OVR", 5)} ${padLeft("POT", 5)} ${padLeft("Age", 5)} ${padLeft("Wage", 8)}`);
  for (const entry of squad.slice(0, 15)) {
    console.log(
      `  ${pad(String(entry.playerId), 8)} ${pad(entry.name, 24)} ${padLeft(orDash(entry.overall), 5)} ${padLeft(orDash(entry.potential), 5)} ${padLeft(orDash(entry.age), 5)} ${padLeft(orDash(entry.wage), 8)}`
    );
  }
}

function printVerdict(data: SpikeCareerData): void {
  console.log("\nPHASE 0 FEASIBILITY VERDICT");
  console.log("  Domain                 Provenance  Source / Status");
  console.log("  ───────────────────────────────────────────────────────────");
  console.log(`  Manager / Identity     SAVE        ${data.saveMetadata.managerName ?? "Unknown"} (${data.saveMetadata.clubName ?? "Unknown"})`);
  console.log(`  Squad Roster           SAVE        ${data.squadSample.length} members extracted`);
  console.log(`  Contracts & Wages      SAVE        Extracted from career_playercontract`);
  console.log(`  Finances / Budgets     SAVE        Extracted from career_managerpref`);
  console.log(`  Fixtures & Schedule    SAVE        ${data.fixtures ? `${data.fixtures.length} fixtures in mlop` : "None"}`);
  console.log(`  Recent Match Results   SAVE        ${data.matchResults ? `${data.matchResults.length} results in mrni` : "None"}`);
  console.log("  League Table Standings DERIVED     Arithmetic sum over played fixtures");
  console.log("  Market Values          DERIVED     Calculated dynamically (0 in raw DB)");
  console.log("  Tactics & Formations   USER        Configured via TouchlineOS interface");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("=== TOUCHLINE OS: PHASE 0 PARSER FEASIBILITY SPIKE ===");

  const parser = new FeasibilitySaveParser({
    rowLimit: args.rows,
    allTables: args.all,
    metaPath: args.metaPath,
    nameTablePath: args.nameTablePath,
  });

  if (!args.savePath && !args.dir) {
    printLocations(parser.searchLocations());
  }

  const candidates = await parser.detectSaves(args.savePath || args.dir || undefined);

  if (candidates.length === 0) {
    console.log("\nNo FC save file detected in local search paths.");
    console.log("Place your save file inside data/saves/ or specify path with --save <path>");
    return;
  }

  console.log(`\nFound ${candidates.length} save candidate(s).`);
  const targets = args.everySave ? candidates : candidates.slice(0, 1);

  for (const save of targets) {
    console.log(`\n${rule()}`);
    console.log(`Parsing: ${save.fileName} (${save.filePath})`);
    const data = await parser.parse(save);

    printFingerprint(data, save);
    printTables(data.tableStats);
    printFacts(data.facts);
    printSquad(data.squadSample);
    printVerdict(data);

    if (args.exportJson) {
      const exportPath = path.join(process.cwd(), "data", "exports", `${save.fileName}_inspection.json`);
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
      console.log(`\nFull extraction exported to: ${exportPath}`);
    }
  }

  console.log(`\n${rule()}`);
  console.log("=== SPIKE COMPLETE ===");
}

main().catch((err) => {
  console.error("Spike error:", err);
  process.exit(1);
});