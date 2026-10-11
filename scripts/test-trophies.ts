/**
 * Checks for the trophy catalogue.
 *
 * The catalogue is the one part of the honours cabinet that is authored rather than read from a save, so
 * it is the part that can be wrong in a way nothing else notices: a mistyped country id produces an
 * empty shelf, a duplicated key makes two competitions share one piece of artwork, and a key that is not
 * filename-safe breaks the artwork path silently. All three are checked here.
 *
 * The country ids are checked against the committed nation table, which is what makes a typo in a
 * `DOMESTIC_CUPS` key fail here instead of quietly excluding a nation from the cabinet.
 *
 *   npm run trophies:test
 */
import fs from "fs";
import path from "path";
import { parseNationTable } from "../src/lib/parser/feasibility-parser";
import {
  allCupsFor,
  catalogueCups,
  catalogueKeys,
  continentalFor,
  domesticCupsFor,
  isOpenToTier,
  knownCupNations,
  trophyArtworkPath,
} from "../src/lib/trophies/catalogue";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const nations = parseNationTable(
  fs.readFileSync(
    path.join(process.cwd(), "public", "parse-resources", "nations_fc26.csv"),
    "utf8"
  )
);

console.log("\nthe nation ids the catalogue is keyed by");

check("the committed nation table parsed", nations.size > 100, `${nations.size} rows`);
for (const nationId of knownCupNations()) {
  check(
    `country ${nationId} is a real nation (${nations.get(nationId) ?? "UNKNOWN"})`,
    nations.has(nationId)
  );
}

// Every nation with a league in a real save's catalogue must have cups. England, Spain, Germany, Italy
// and France are the ones a career is most likely to be in, so they are asserted by name.
for (const [id, name] of [
  [14, "England"],
  [45, "Spain"],
  [21, "Germany"],
  [27, "Italy"],
  [18, "France"],
] as const) {
  check(`${name} has domestic cups`, domesticCupsFor(id).length > 0);
  check(`${name} has continental competitions`, continentalFor(id).length > 0);
}

console.log("\nthe keys, which are also the artwork filenames");

const everyKey = catalogueKeys();

check("no duplicate keys anywhere", new Set(everyKey).size === everyKey.length, `${everyKey.length} keys`);
check(
  "every key is filename-safe",
  everyKey.every((key) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)),
  everyKey.filter((key) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)).join(", ")
);
check(
  "no key collides with a league key",
  everyKey.every((key) => !key.startsWith("league-"))
);
check("artwork paths point under /trophies/", everyKey.every((key) => trophyArtworkPath(key) === `/trophies/${key}.png`));

// A cup with no tiers array is open to everybody. A cup WITH one must list real tiers, or a manager in
// that division would never see it.
const tiered = catalogueCups().filter((cup) => cup.openToTiers !== null);
check("tiered competitions exist to check", tiered.length > 0, `${tiered.length}`);
check(
  "every tier restriction lists real tiers",
  tiered.every((cup) => (cup.openToTiers ?? []).every((tier) => tier >= 1 && tier <= 7))
);
check(
  "every tier restriction is non-empty",
  tiered.every((cup) => (cup.openToTiers ?? []).length > 0)
);

console.log("\nisOpenToTier");

const faCup = domesticCupsFor(14).find((cup) => cup.key === "fa-cup")!;
const eflTrophy = domesticCupsFor(14).find((cup) => cup.key === "efl-trophy")!;
const ucl = continentalFor(14).find((cup) => cup.key === "ucl")!;

check("an open cup is open to tier 1", isOpenToTier(faCup, 1));
check("an open cup is open to tier 4", isOpenToTier(faCup, 4));
check("a lower-league cup is closed to tier 1", !isOpenToTier(eflTrophy, 1));
check("a lower-league cup is open to tier 3", isOpenToTier(eflTrophy, 3));
check("a lower-league cup is open to tier 4", isOpenToTier(eflTrophy, 4));
check("a continental cup is closed to tier 4", !isOpenToTier(ucl, 4));
check("a continental cup is open to tier 1", isOpenToTier(ucl, 1));
check("an unknown tier enters nothing restricted", !isOpenToTier(ucl, null));
check("an unknown tier still enters an open cup", isOpenToTier(faCup, null));

console.log("\nwhat a nation is offered");

check("England is offered more than its league", allCupsFor(14).length >= 6, `${allCupsFor(14).length}`);
check("an unknown nation is offered nothing", allCupsFor(9999).length === 0);
check("a null country is offered nothing", allCupsFor(null).length === 0);
check(
  "the women's game is not in this catalogue",
  knownCupNations().every((id) => allCupsFor(id).every((cup) => !/women|frauen|f[eé]minine/i.test(cup.name)))
);

// The manifest, printed rather than kept somewhere else: this script is the one place that knows every
// key, so it is the right place to ask "what do I name the artwork?". League trophies are not listed -
// their keys come from the save's own league ids, which `scripts/probe-trophies.ts` prints.
console.log(`\nARTWORK MANIFEST (${everyKey.length} files, all in public/trophies/):`);
for (const cup of catalogueCups()) {
  const holders = knownCupNations().filter((id) =>
    allCupsFor(id).some((candidate) => candidate.key === cup.key)
  );
  const shared =
    holders.length > 3
      ? `${holders.length} nations`
      : holders.map((id) => nations.get(id) ?? String(id)).join(", ");
  console.log(`  ${`${cup.key}.png`.padEnd(32)} ${cup.name.padEnd(28)} ${shared}`);
}

console.log(
  `\n${passed} check${passed === 1 ? "" : "s"} passed, ${failures.length} failed` +
    (failures.length > 0 ? `\n  ${failures.join("\n  ")}` : "")
);

if (failures.length > 0) process.exit(1);
