/**
 * Read-only probe: what reliably distinguishes men's from women's football in this save?
 *
 * A wrong exclusion here would silently delete real players from the pool - the same
 * silently-wrong-data class as the value-model bugs - so the flags are measured before anything is
 * filtered on them.
 *
 *   npx tsx scripts/probe-gender.ts [savePath]
 */
import fs from "fs";
import path from "path";
import {
  parseDbMeta,
  unpackDatabases,
  readTableHeaders,
  decodeRows,
} from "../src/lib/parser/feasibility-parser";

const savePath =
  process.argv[2] ?? path.join("data", "saves", "ManagerCareer20260925214344463");
const metaPath = path.join("public", "parse-resources", "fifa_ng_db-meta.xml");

const meta = parseDbMeta(fs.readFileSync(metaPath, "utf8"));
const blocks = unpackDatabases(fs.readFileSync(savePath));

const tally = (values: unknown[]): string => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} x${n}`)
    .join("   ");
};

for (let db = 0; db < blocks.length; db++) {
  const read = readTableHeaders(blocks[db], meta, db);
  for (const header of read.headers) {
    const name = header.tableName;
    if (!name) continue;

    if (name === "players") {
      const rows = decodeRows(blocks[db], header, meta, { limit: 30000 }).rows;
      console.log(`players rows: ${rows.length}`);
      console.log(`  gender distribution : ${tally(rows.map((r) => r.gender))}`);
      const sample = rows.find((r) => r.gender !== 0);
      if (sample) {
        console.log(`  first non-zero gender: gender=${sample.gender} ovr=${sample.overallrating}`);
      }

      // Sanity: are the women's-club players high-rated? If gender 1 tracks the women's clubs the
      // top-rated rows should be the ones we saw as FRANCE WOMEN / NG - FA WOMEN.
      const women = rows.filter((r) => Number(r.gender) === 1);
      const men = rows.filter((r) => Number(r.gender) === 0);
      console.log(`  gender=1 count: ${women.length}   gender=0 count: ${men.length}`);
      const avg = (list: typeof rows) =>
        list.length === 0
          ? 0
          : Math.round(list.reduce((s, r) => s + Number(r.overallrating ?? 0), 0) / list.length);
      console.log(`  avg OVR gender=1: ${avg(women)}   gender=0: ${avg(men)}`);
    }

    if (name === "teams") {
      const rows = decodeRows(blocks[db], header, meta, { limit: 2000 }).rows;
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
      const genderish = keys.filter((k) => /gender|wom|female|sex/i.test(k));
      console.log(`\nteams rows: ${rows.length}`);
      console.log(`  gender-ish fields: ${genderish.join(", ") || "(none)"}`);
      for (const key of genderish) {
        console.log(`    ${key}: ${tally(rows.map((r) => r[key]))}`);
      }
      const womenNamed = rows.filter((r) => /women|wom\b/i.test(String(r.teamname ?? "")));
      console.log(`  teams whose name says "women": ${womenNamed.length}`);
      if (womenNamed.length > 0) {
        const sampleKeys = genderish.length > 0 ? genderish : keys.slice(0, 0);
        console.log(
          `  sample: ${womenNamed
            .slice(0, 3)
            .map((r) => `${r.teamname}${sampleKeys.map((k) => ` [${k}=${r[k]}]`).join("")}`)
            .join(" | ")}`
        );
      }
    }

    if (name === "leagues") {
      const rows = decodeRows(blocks[db], header, meta, { limit: 200 }).rows;
      console.log(`\nleagues rows: ${rows.length}`);
      console.log(`  iswomencompetition: ${tally(rows.map((r) => r.iswomencompetition))}`);
      const womens = rows.filter((r) => Number(r.iswomencompetition) === 1);
      console.log(`  women's competitions: ${womens.length} of ${rows.length}`);
      console.log(
        `  women's league names: ${womens
          .slice(0, 8)
          .map((r) => r.leaguename)
          .join(", ")}`
      );
    }
  }
}
