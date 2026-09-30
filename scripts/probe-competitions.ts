/**
 * Read-only probe: can a league-only record be reconstructed from a save?
 *
 * The parser decodes `career_managerhistory` into `season_history`, and those columns turned out to be
 * all-competition totals (see `SeasonRecord`). The tables that carry per-competition detail -
 * `fixtures` and `career_competitionprogress` - are NOT decoded by the app. This script decodes them
 * for inspection and prints what they hold.
 *
 * It writes nothing: it reads the save, prints, and exits.
 *
 *   npx tsx scripts/probe-competitions.ts [savePath] [clubId]
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
const clubId = Number(process.argv[3] ?? 1917);
const metaPath = path.join("references", "fc26companion", "data", "fifa_ng_db-meta.xml");

const meta = parseDbMeta(fs.readFileSync(metaPath, "utf8"));
const blocks = unpackDatabases(fs.readFileSync(savePath));

console.log(`save=${savePath} blocks=${blocks.length} club=${clubId}`);

const WANTED = [
  "fixtures",
  "career_competitionprogress",
  "competition",
  "persistent_events",
  "career_calendar",
];

const row = (value: unknown): string => JSON.stringify(value);

for (let db = 0; db < blocks.length; db++) {
  const read = readTableHeaders(blocks[db], meta, db);
  for (const header of read.headers) {
    const name = header.tableName;
    if (!name || !WANTED.includes(name)) continue;

    const rows = decodeRows(blocks[db], header, meta, {}).rows;
    console.log(`\n### ${name} (db ${db}) rows=${rows.length} declared=${header.recordCount}`);

    if (name === "fixtures") {
      const shape = rows.map((r) => ({
        id: r.fixtureid,
        comp: r.competitionid,
        home: r.hometeamid,
        away: r.awayteamid,
        homeLeague: r.homeleagueid,
        awayLeague: r.awayleagueid,
        date: r.fixturedate,
        homePlayed: r.hometeammatchesplayed,
        awayPlayed: r.awayteammatchesplayed,
        sameLeague: r.homeleagueid === r.awayleagueid,
      }));
      console.log(row(shape));
      const ours = shape.filter((r) => r.home === clubId || r.away === clubId);
      const oursSameLeague = ours.filter((r) => r.sameLeague);
      console.log(
        `ourClub total=${ours.length} sameLeague=${oursSameLeague.length} comps=${[
          ...new Set(ours.map((r) => r.comp)),
        ].join(",")}`
      );
      if (ours.length > 0) console.log(row(ours));
      continue;
    }

    if (name === "career_competitionprogress") {
      const perSeason = new Map<number, string[]>();
      for (const r of rows) {
        const season = Number(r.season);
        const label = `${r.compshortname || "-"} (obj ${r.compobjid}, stage ${r.stageid}, won ${r.hasteamwon}, objResult ${r.cup_objective_result}, team ${r.teamid})`;
        perSeason.set(season, [...(perSeason.get(season) ?? []), label]);
      }
      for (const [season, labels] of [...perSeason].sort((a, b) => a[0] - b[0])) {
        console.log(`season ${season}: ${labels.length} competitions`);
        for (const label of labels) console.log(`  ${label}`);
      }
      console.log(`raw=${row(rows)}`);
      continue;
    }

    if (name === "competition") {
      // Cosmetic only (94 colour/flag/stadium fields, no name and no type - confirmed against the
      // meta), so dumping it is noise. Just show which ids exist, for cross-checking fixtures.
      const ids = row(rows.map((r) => r.competitionid));
      console.log(`competition ids: ${ids}`);
      continue;
    }

    console.log(row(rows));
  }
}
