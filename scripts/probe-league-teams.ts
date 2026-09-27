/**
 * One-off probe: what does the save actually tell us about the rest of our own division?
 *
 *   npx tsx scripts/probe-league-teams.ts [savePath]
 *
 * The debrief screen wants the manager to pick an opponent from their own league rather than type
 * a club name from memory. That is only worth building if the save carries readable names for the
 * other clubs in the division, so this measures that before anything is built on it.
 *
 * `teams`, `leagues` and `leagueteamlinks` are already decoded into `extractedTables` by the
 * parser, so this reads them rather than re-decoding.
 */
import fs from "fs";
import path from "path";
import { FeasibilitySaveParser } from "../src/lib/parser/feasibility-parser";

type Row = Record<string, unknown>;

function num(row: Row | undefined, field: string): number | null {
  if (!row) return null;
  const value = row[field];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function str(row: Row | undefined, field: string): string | null {
  if (!row) return null;
  const value = row[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function main() {
  const savePath =
    process.argv[2] ?? path.join(process.cwd(), "data", "saves", "ManagerCareer20260925214344463");
  const size = fs.statSync(savePath).size;
  console.log(`save: ${path.basename(savePath)} (${size} bytes)`);

  const parsed = await new FeasibilitySaveParser().parse({
    id: "probe",
    filePath: savePath,
    fileName: path.basename(savePath),
    lastModified: new Date(),
    fileSizeBytes: size,
  });
  const tables = parsed.extractedTables;
  if (!tables) {
    console.log("NO extractedTables on the parse result - cannot probe.");
    return;
  }

  const teams = (tables["teams"] as Row[]) ?? [];
  const links = (tables["leagueteamlinks"] as Row[]) ?? [];
  console.log(`teams rows: ${teams.length}   leagueteamlinks rows: ${links.length}`);

  // Our own club, so we can identify our division without hardcoding it.
  const ourClubId = 1917;
  const ourLink = links.find((l) => num(l, "teamid") === ourClubId);
  const ourLeague = num(ourLink, "leagueid");
  console.log(`our club ${ourClubId} -> league ${ourLeague}`);

  if (ourLeague === null) {
    console.log("Could not resolve our league; dumping a sample of links instead:");
    console.log(JSON.stringify(links.slice(0, 5), null, 1));
    return;
  }

  const teamById = new Map<number, Row>();
  for (const team of teams) {
    const id = num(team, "teamid");
    if (id !== null) teamById.set(id, team);
  }

  const inLeague = links.filter((l) => num(l, "leagueid") === ourLeague);
  console.log(`\nclubs in league ${ourLeague}: ${inLeague.length}`);
  console.log("teamid | name                       | tablePos | prevPos | form   | lastResult");

  let named = 0;
  const rows = inLeague
    .map((link) => {
      const id = num(link, "teamid");
      const team = id !== null ? teamById.get(id) : undefined;
      const name = str(team, "teamname");
      if (name) named++;
      return {
        id,
        name,
        pos: num(link, "currenttableposition"),
        prev: num(link, "previousyeartableposition"),
        form: num(link, "teamform"),
        last: num(link, "lastgameresult"),
      };
    })
    .sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));

  for (const row of rows) {
    console.log(
      `${String(row.id).padStart(6)} | ${String(row.name ?? "(NO NAME)").padEnd(26)} | ` +
        `${String(row.pos ?? "-").padStart(8)} | ${String(row.prev ?? "-").padStart(7)} | ` +
        `${String(row.form ?? "-").padStart(6)} | ${String(row.last ?? "-")}`
    );
  }

  console.log(`\nnamed clubs: ${named}/${inLeague.length}`);
  console.log(`named overall: ${teams.length} team rows, sample names:`);
  console.log(
    "  " +
      teams
        .slice(0, 12)
        .map((t) => str(t, "teamname") ?? "(NO NAME)")
        .join(", ")
  );
}

void main();
