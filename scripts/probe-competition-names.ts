/**
 * Read-only probe: classify every competition the game ships, from its own flag columns.
 *
 * The `competition` table carries NO names (169 rows of adboards, badges and colours - measured). It does
 * carry flags, and a country binding. Subtracting the rows that are already leagues in the `leagues` table
 * leaves the competitions the game models as something ELSE, grouped by the nation or confederation they are
 * bound to. That is the closest thing to the game's own list of its cups.
 *
 * Read-only. Writes nothing.
 *
 *   npx tsx scripts/probe-competition-names.ts [savePath]
 */
import fs from "fs";
import path from "path";
import { parseDbMeta, readTableHeaders, decodeRows, unpackDatabases } from "../src/lib/parser/feasibility-parser";

const savePath = process.argv[2] ?? path.join("data", "saves", "ManagerCareer20260925214344463");
const metaPath = path.join("public", "parse-resources", "fifa_ng_db-meta.xml");

const meta = parseDbMeta(fs.readFileSync(metaPath, "utf8"));
const blocks = unpackDatabases(fs.readFileSync(savePath));

interface Row {
  competitionid: number;
  country_lock: number;
  isrealcompetition: number;
  iswomencompetition: number;
  competitionimportance: number;
}

let competitions: Row[] = [];
let leagueRows: Record<string, unknown>[] = [];

for (let db = 0; db < blocks.length; db++) {
  const read = readTableHeaders(blocks[db], meta, db);
  for (const header of read.headers) {
    if (header.tableName === "competition") {
      competitions = decodeRows(blocks[db], header, meta, {}).rows as unknown as Row[];
    }
    if (header.tableName === "leagues") {
      leagueRows = decodeRows(blocks[db], header, meta, {}).rows as unknown as Record<string, unknown>[];
    }
  }
}

const leagueIds = new Set(leagueRows.map((row) => Number(row.leagueid)));

console.log(`competition rows=${competitions.length} league rows=${leagueRows.length}`);

/** Competitions the game ships that are NOT a league in this career, grouped by their country binding. */
const byCountry = new Map<number, number[]>();
for (const row of competitions) {
  if (leagueIds.has(row.competitionid)) continue;
  const country = Number(row.country_lock);
  const list = byCountry.get(country) ?? [];
  list.push(row.competitionid);
  byCountry.set(country, list);
}

console.log("\n## competitions that are NOT a league, by country_lock");
for (const country of [...byCountry.keys()].sort((a, b) => a - b)) {
  const ids = byCountry.get(country)!;
  console.log(`country_lock ${country}: ${ids.length} -> ${ids.join(",")}`);
}

console.log("\n## the leagues, for reference (id -> country -> name)");
for (const row of leagueRows.slice().sort((a, b) => Number(a.leagueid) - Number(b.leagueid))) {
  console.log(`${row.leagueid} -> country ${row.countryid} -> ${String(row.leaguename ?? "")}`);
}

console.log("\n## flags on the non-league competitions");
for (const row of competitions) {
  if (leagueIds.has(row.competitionid)) continue;
  console.log(
    `id ${row.competitionid} country_lock ${row.country_lock} real ${row.isrealcompetition} women ${row.iswomencompetition} importance ${row.competitionimportance}`
  );
}

