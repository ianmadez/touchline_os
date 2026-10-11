/**
 * Prints every trophy ID the game can award, as a list to read rather than a table to parse.
 *
 * Two sources, and the split is the whole point of the script:
 *
 *   - LEAGUES come from the SAVE's own competition catalogue, so the list contains exactly the leagues this
 *     game ships and nothing invented. The id in `league-<id>.png` is the save's own `league_id`.
 *   - CUPS and INTERNATIONAL competitions come from the authored catalogue, because the save ships domestic
 *     cups with an EMPTY name (they are localised in the game, not stored) so there is no id to key on.
 *
 *   npx tsx scripts/trophy-ids.ts            # the whole list
 *   npx tsx scripts/trophy-ids.ts --artwork  # just the artwork filenames, one per line
 *
 * READ-ONLY. Writes nothing.
 */
import { db } from "../src/lib/db/client";
import { leagues } from "../src/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { careers } from "../src/lib/db/schema";
import {
  catalogueKeys,
  continentalFor,
  domesticCupsFor,
  internationalTrophies,
  isInternationalKey,
  type CupDefinition,
} from "../src/lib/trophies/catalogue";
import { leagueLabel } from "../src/lib/ui/leagues";

/** The pools the game uses for editing and career scaffolding. Not trophies, never offered. */
const NOT_TROPHIES = new Set([0, 76, 78, 211, 216, 222, 255, 382, 384, 2000, 2028, 2092, 2136, 2226]);

const ARTWORK_ONLY = process.argv.includes("--artwork");

function cupLine(cup: CupDefinition): string {
  const tiers = cup.openToTiers === null ? "every tier" : `tiers ${cup.openToTiers.join(", ")}`;
  return `  ${cup.key.padEnd(24)} ${cup.name.padEnd(34)} ${tiers}`;
}

async function main(): Promise<void> {
  const career = await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get();
  if (!career) {
    console.log("no career in the database: run a sync first, because the league list comes from the save");
    return;
  }

  const catalogue = await db.select().from(leagues).where(eq(leagues.careerId, career.id));

  // Strict: a league row only counts when the game named it, gave it a country and gave it a tier. That is
  // what excludes the editing pools, the youth squad league and the women's divisions in one rule. A row whose
  // name is a continental competition is excluded too: the save files those as "leagues", and they belong in
  // the continental section further down where they are listed once.
  const continentalNames = new Set(
    [...new Set(catalogue.map((row) => row.countryId).filter((id): id is number => id !== null))]
      .flatMap((countryIdTmp) => continentalFor(countryIdTmp))
      .map((cup) => cup.name.toLowerCase())
  );
  const named = catalogue
    .filter(
      (row) =>
        row.name.trim() !== "" &&
        row.countryId !== null &&
        !row.isWomenCompetition &&
        row.level !== null &&
        row.level >= 1 &&
        row.level <= 7 &&
        !NOT_TROPHIES.has(row.leagueId) &&
        !continentalNames.has(row.name.replace(/\s*\(\d+\)\s*$/, "").toLowerCase())
    )
    .sort(
      (left, right) =>
        (left.countryName ?? "zz").localeCompare(right.countryName ?? "zz") ||
        (left.level ?? 99) - (right.level ?? 99) ||
        left.leagueId - right.leagueId
    );

  if (ARTWORK_ONLY) {
    for (const row of named) console.log(`league-${row.leagueId}.png`);
    for (const key of catalogueKeys()) {
      if (!key.startsWith("league-")) console.log(`${key}.png`);
    }
    return;
  }

  console.log(`TROPHY IDS  (from ${career.clubName}, save ${career.id})`);
  console.log("The league ids below are the save's own, so they are exactly the competitions the game ships.\n");

  console.log("LEAGUE TITLES - artwork is league-<id>.png\n");
  let country = "";
  for (const row of named) {
    const name = row.countryName ?? "Unknown nation";
    if (name !== country) {
      country = name;
      console.log(`\n  ${country.toUpperCase()}`);
    }
    console.log(
      `    league-${String(row.leagueId).padEnd(6)} ${leagueLabel(row.name, row.leagueId).padEnd(38)} tier ${row.level}`
    );
  }

  console.log("\n\nDOMESTIC CUPS - artwork is <key>.png\n");
  const nations = [...new Set(named.map((row) => row.countryId))].filter(
    (id): id is number => id !== null
  );
  for (const nationId of nations.sort((a, b) => a - b)) {
    const cups = domesticCupsFor(nationId);
    if (cups.length === 0) continue;
    const label = named.find((row) => row.countryId === nationId)?.countryName ?? `nation ${nationId}`;
    console.log(`\n  ${label.toUpperCase()} (nation ${nationId})`);
    for (const cup of cups) console.log(cupLine(cup));
  }

  console.log("\n\nCONTINENTAL - artwork is <key>.png\n");
  const seenRegion = new Set<string>();
  for (const nationId of nations) {
    for (const cup of continentalFor(nationId)) {
      if (seenRegion.has(cup.key)) continue;
      seenRegion.add(cup.key);
      console.log(cupLine(cup));
    }
  }

  console.log("\n\nINTERNATIONAL - artwork is <key>.png");
  console.log("Recorded by hand: nothing in a club save holds a national-team result.\n");
  for (const competition of internationalTrophies()) console.log(cupLine(competition));

  console.log(
    `\n\nTOTALS  ${named.length} league titles, ${catalogueKeys().filter((key) => isInternationalKey(key)).length} international, ${catalogueKeys().length} artwork files in all`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
