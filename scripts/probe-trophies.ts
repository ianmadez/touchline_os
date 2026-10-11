/**
 * Every competition this save knows, read-only, for the trophy cabinet.
 *
 * The cabinet needs two things from the save and neither should be guessed: WHICH competitions exist,
 * and which of them the manager has actually won. Both are read here.
 *
 * The key finding this prints is the shape of the answer: the save's `leagues` table is not just
 * leagues. It holds every competition, with `leaguetype` separating the league competitions from the
 * cups, plus `level` and the international/women's flags. That is the whole reason this can be built
 * without a hardcoded list of competition names anywhere in the product.
 *
 *   npx tsx scripts/probe-trophies.ts [savePath]
 */
import fs from "fs";
import path from "path";
import { createSaveParser } from "../src/lib/platform/parse-resources";

type Row = Record<string, unknown>;

const num = (row: Row | undefined, key: string): number | null => {
  const value = row?.[key];
  return typeof value === "number" ? value : null;
};

const str = (row: Row | undefined, key: string): string | null => {
  const value = row?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** A stable, filesystem-safe key for one competition's artwork. */
export function trophyFileName(source: "league" | "cup", competitionId: number): string {
  return `${source}-${competitionId}.png`;
}

async function main(): Promise<void> {
  const savePath =
    process.argv[2] ?? path.join(process.cwd(), "data", "saves", "ManagerCareer20260925214344463");
  const size = fs.statSync(savePath).size;
  console.log(`save: ${path.basename(savePath)} (${size} bytes)\n`);

  const parsed = await createSaveParser({ allTables: true }).parse(
    {
      id: "probe",
      filePath: savePath,
      fileName: path.basename(savePath),
      lastModified: new Date(),
      fileSizeBytes: size,
    },
    new Uint8Array(fs.readFileSync(savePath))
  );

  const extracted = parsed.extractedTables as Record<string, Row[]>;
  const leagues = extracted["leagues"] ?? [];
  const progress = extracted["career_competitionprogress"] ?? [];
  const history = parsed.seasonHistory ?? [];

  console.log(`leagues table      : ${leagues.length} rows`);
  console.log(`competition progress: ${progress.length} rows`);
  console.log(`season history     : ${history.length} rows\n`);

  // ---- What the table actually contains ------------------------------------------------------
  const types = new Map<string, number>();
  for (const row of leagues) {
    const key = `${row.leaguetype ?? "?"}${num(row, "isinternationalleague") ? " international" : ""}${
      num(row, "iswomencompetition") ? " women" : ""
    }`;
    types.set(key, (types.get(key) ?? 0) + 1);
  }
  console.log("leaguetype distribution:");
  for (const [key, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  leaguetype ${key}`);
  }

  // ---- The list the manager needs to fetch artwork for ---------------------------------------
  const named = leagues
    .map((row) => ({
      id: num(row, "leagueid"),
      name: str(row, "leaguename"),
      level: num(row, "level"),
      type: num(row, "leaguetype"),
      international: Boolean(num(row, "isinternationalleague")),
      women: Boolean(num(row, "iswomencompetition")),
    }))
    .filter((entry) => entry.id !== null && entry.name !== null)
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || (a.name ?? "").localeCompare(b.name ?? ""));

  /**
   * Which artwork namespace a competition belongs to.
   *
   * NOT `leaguetype`: measured on this save it reads 0 on all 52 rows, so it cannot separate a league
   * from a cup however plausible it looks. What the save does tell us is `level` (1-7, the league
   * pyramid) and `isinternationalleague` (set on the continental and international competitions). So a
   * competition with a level is a league, an international one is a cup, and anything else is reported
   * as unknown rather than guessed into the wrong bucket.
   */
  const namespaceFor = (entry: { level: number | null; international: boolean }): "league" | "cup" | "unknown" => {
    if (entry.international) return "cup";
    if (entry.level !== null && entry.level >= 1 && entry.level <= 7) return "league";
    return "unknown";
  };

  console.log(`\n${named.length} named competitions, with the artwork filename each would look for:`);
  for (const entry of named) {
    const source = namespaceFor(entry);
    console.log(
      `  ${String(entry.id).padStart(4)}  L${String(entry.level ?? "-").padStart(2)}  ${source.padEnd(7)}  ${trophyFileName(source === "cup" ? "cup" : "league", entry.id!).padEnd(20)}  ${entry.name}${entry.international ? "  [international]" : ""}${entry.women ? "  [women]" : ""}`
    );
  }

  // ---- Rows the save cannot caption ------------------------------------------------------------
  const unnamed = leagues.filter((row) => str(row, "leaguename") === null);
  console.log(`\n${unnamed.length} competition rows with NO name in the save:`);
  for (const row of unnamed) {
    console.log(
      `  ${String(num(row, "leagueid") ?? "?").padStart(4)}  level ${String(num(row, "level") ?? "-")}  type ${num(row, "leaguetype") ?? "-"}  international ${num(row, "isinternationalleague") ?? 0}  <- cannot be captioned, so it cannot be offered as a trophy`
    );
    // Everything else the row carries, because a name-less competition still has to be identifiable
    // some other way for its artwork to be gathered at all.
    const rest = Object.entries(row)
      .filter(([key, value]) => key !== "leaguename" && value !== 0 && value !== null && value !== "")
      .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`);
    console.log(`        ${rest.join(" ")}`);
  }

  // ---- What THIS career has actually entered, and won -----------------------------------------
  console.log("\ncompetitions this career has entered (career_competitionprogress):");
  for (const row of progress) {
    const objId = num(row, "compobjid");
    const short = str(row, "compshortname");
    const leagueRow = objId !== null ? leagues.find((l) => num(l, "leagueid") === objId) : undefined;
    console.log(
      `  season ${String(num(row, "season") ?? "?").padStart(2)}  obj ${String(objId ?? "?").padStart(4)}  ${(short ?? "(blank)").padEnd(8)}  stage ${String(num(row, "stageid") ?? "?").padStart(3)}  won ${num(row, "hasteamwon") ?? 0}  objective ${num(row, "cup_objective_result") ?? 0}  ${str(leagueRow, "leaguename") ?? "(no leagues row)"}`
    );
  }

  console.log("\nper-season trophy record (career_managerhistory):");
  for (const season of history) {
    console.log(
      `  season ${String(season.season ?? "?").padStart(2)}  league trophies ${season.leagueTrophies ?? 0}  league pos ${season.tablePosition ?? 0}  domestic cup objective ${season.domesticCupObjective ?? 0}  europe cup objective ${season.europeCupObjective ?? 0}`
    );
  }

  console.log(
    "\nNOTE: an all-zero trophy record is the honest answer for a career in its first seasons - it is\n" +
      "not evidence that the fields are unreadable. The cabinet must grey out an unwon trophy rather\n" +
      "than hide the competition, or a manager who has won nothing sees an empty screen."
  );
}

void main();
