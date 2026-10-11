/**
 * Read-only probe: every field of a pre-signed contract row, for the club's own deals.
 *
 * WHY THIS EXISTS. `career_presignedcontract` carries no field named buying or selling, only `teamid` and
 * `offerteamid`, and the two are easy to map the wrong way round - which happened here, twice, and produced
 * a ledger that showed every move in the opposite direction with the fees, dates and names all correct.
 * Inference from the field names is not enough; the mapping has to be settled by the data, so this prints
 * the raw row beside the club each player is registered to in the world pool.
 *
 * The cluster the app shows is `teamid` and `offerteamid` for ONE of the two clubs. Print them, compare
 * against `world_players.club_id`, and the mapping is either confirmed or exposed.
 *
 *   npx tsx scripts/probe-presigned-deals.ts [savePath] [clubId]
 */
import fs from "fs";
import path from "path";
import { parseDbMeta, readTableHeaders, decodeRows, unpackDatabases } from "../src/lib/parser/feasibility-parser";

const savePath = process.argv[2] ?? path.join("data", "saves", "ManagerCareer20260925214344463");
const clubId = Number(process.argv[3] ?? 1917);
const metaPath = path.join("public", "parse-resources", "fifa_ng_db-meta.xml");

const meta = parseDbMeta(fs.readFileSync(metaPath, "utf8"));
const blocks = unpackDatabases(fs.readFileSync(savePath));

type Row = Record<string, unknown>;

/** The fields that could say who is moving where, plus the money and the dates for context. */
const FIELDS = [
  "playerid",
  "teamid",
  "offerteamid",
  "offeredfee",
  "offeredwage",
  "signeddate",
  "completedate",
  "isloanbuy",
  "iscomingthisseason",
  "isdirectapproach",
  "isexchangedplayer",
  "secondaryplayerid",
  "squadrole",
  "future_fee",
  "wage_split",
];

for (let db = 0; db < blocks.length; db++) {
  const read = readTableHeaders(blocks[db], meta, db);

  /*
   * `transfers` FIRST, because it names the two sides explicitly - `buyingteamid` and `sellingteamid` - and
   * so needs no inference at all. `career_presignedcontract` below is the table the app actually reads, and
   * it has no such field: only `teamid` and `offerteamid`, which is where the mapping went wrong.
   */
  for (const header of read.headers) {
    if (header.tableName !== "transfers") continue;
    const rows = decodeRows(blocks[db], header, meta, {}).rows as unknown as Row[];
    console.log(`### transfers (db ${db}) rows=${rows.length}`);
    for (const row of rows) {
      console.log(
        `  player ${row.playerid} | buying ${row.buyingteamid} | selling ${row.sellingteamid} | amount ${row.transferamount}`
      );
    }
    const ours = rows.filter(
      (row) => Number(row.buyingteamid) === clubId || Number(row.sellingteamid) === clubId
    );
    console.log(`  naming club ${clubId}: ${ours.length}\n`);
  }

  for (const header of read.headers) {
    if (header.tableName !== "career_presignedcontract") continue;
    const rows = decodeRows(blocks[db], header, meta, {}).rows as unknown as Row[];
    console.log(`### career_presignedcontract (db ${db}) rows=${rows.length}\n`);

    const ours = rows.filter((row) => Number(row.teamid) === clubId || Number(row.offerteamid) === clubId);
    console.log(`rows naming club ${clubId}: ${ours.length}\n`);

    for (const row of ours) {
      const view: Record<string, unknown> = {};
      for (const field of FIELDS) view[field] = row[field] ?? null;
      console.log(JSON.stringify(view));
    }

    // Every distinct pair, so a pattern can be seen rather than one row being stared at.
    console.log(`\nall ${rows.length} rows as teamid-offerteamid-fee:`);
    for (const row of rows) {
      console.log(`  teamid ${row.teamid} | offerteamid ${row.offerteamid} | fee ${row.offeredfee} | player ${row.playerid}`);
    }
  }
}
