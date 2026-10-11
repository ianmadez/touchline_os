/**
 * Checks for the nation id table and for the flag fetch's input rules.
 *
 * Run with `npm run nations:test`. Needs no database and no save file: everything here is either a
 * pure function or a file committed to the repository. That is deliberate - the mapping from a save
 * nationality code to a country name is the one part of this feature that cannot be checked against
 * the save itself, so it has to be checkable on its own.
 *
 * The end-to-end half (does a real save's player actually get a country?) is `scripts/probe-nationality.ts`,
 * which parses a real career read-only.
 */
import fs from "fs";
import path from "path";
import { parseNationTable } from "../src/lib/parser/feasibility-parser";
import { isUsableNationId } from "../src/lib/services/nation-source";

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

console.log("\nparseNationTable");

// Comment lines and a header that has to be FOUND rather than assumed to be line 1.
const withComments = parseNationTable(
  [
    "# a comment",
    "# another",
    "nation_id,name",
    "14,England",
    "36,Norway",
  ].join("\n")
);
check("skips comment lines to find the header", withComments.get(14) === "England");
check("second data row is read too", withComments.get(36) === "Norway");

// A header found after a blank line, and CRLF line endings: the file came off a Windows machine.
const messy = parseNationTable("nation_id,name\r\n\r\n3,Armenia\r\n");
check("tolerates blank lines and CRLF", messy.get(3) === "Armenia");

// A UTF-8 BOM before the header is common in files edited on Windows and would break the column
// lookup silently, naming nothing, which looks exactly like an empty table.
const bom = parseNationTable("\uFEFFnation_id,name\n5,Azerbaijan\n");
check("strips a UTF-8 BOM from the header", bom.get(5) === "Azerbaijan");

// A name that CONTAINS a comma must not be truncated by a naive split.
const quoted = parseNationTable('nation_id,name\n1,"Korea, Republic of"\n');
check("a quoted name keeps its comma", quoted.get(1) === "Korea, Republic of");

// Ids that cannot name a nation are dropped rather than stored under a nonsense key.
const junk = parseNationTable("nation_id,name\n0,Zero\n-4,Negative\nabc,Text\n7,Belgium\n");
check("drops a zero id", !junk.has(0));
check("drops a negative id", !junk.has(-4));
check("drops a non-numeric id", junk.size === 1, `size ${junk.size}`);
check("keeps the valid row beside them", junk.get(7) === "Belgium");

// An empty name is not a country, and storing it would render as a blank cell that looks like a bug.
const blank = parseNationTable("nation_id,name\n9,\n10,   \n11,Denmark\n");
check("drops a blank name", blank.size === 1, `size ${blank.size}`);
check("keeps the named row", blank.get(11) === "Denmark");

// First wins. A duplicated id must not flip a name between syncs.
const dupes = parseNationTable("nation_id,name\n5,First\n5,Second\n");
check("a duplicate id keeps the first name", dupes.get(5) === "First");

// Wrong or missing columns mean NO mapping, not a mapping keyed by whatever the first column is.
check("no header row means no mapping", parseNationTable("14,England\n").size === 0);
check("missing the name column means no mapping", parseNationTable("nation_id\n14\n").size === 0);
check("empty input means no mapping", parseNationTable("").size === 0);

console.log("\nthe committed nation table");

const resourcePath = path.join(process.cwd(), "public", "parse-resources", "nations_fc26.csv");
check("public/parse-resources/nations_fc26.csv exists", fs.existsSync(resourcePath));

const committed = parseNationTable(fs.readFileSync(resourcePath, "utf8"));
check("it parses to a real mapping", committed.size >= 150, `${committed.size} nations`);

// Spot checks against the codes the reference career's own players carry. If the file were swapped
// for a different dataset this is what would catch it.
const spotChecks: [number, string][] = [
  [14, "England"],
  [36, "Norway"],
  [42, "Scotland"],
  [7, "Belgium"],
  [27, "Italy"],
  [54, "Brazil"],
];
for (const [id, name] of spotChecks) {
  check(`nation ${id} is ${name}`, committed.get(id) === name, `got ${committed.get(id) ?? "nothing"}`);
}

// No name should be an empty string, and no name should arrive with stray whitespace, because both
// would be rendered as a country that looks mis-typed rather than mis-sourced.
const names = [...committed.values()];
check("no empty names", names.every((name) => name.length > 0));
check("no names with surrounding whitespace", names.every((name) => name === name.trim()));

console.log("\nisUsableNationId");

check("accepts a positive integer", isUsableNationId(14));
check("rejects null", !isUsableNationId(null));
check("rejects undefined", !isUsableNationId(undefined));
check("rejects zero", !isUsableNationId(0));
check("rejects a negative", !isUsableNationId(-3));
check("rejects a fraction", !isUsableNationId(14.5));
check("rejects NaN", !isUsableNationId(Number.NaN));

console.log(
  `\n${passed} check${passed === 1 ? "" : "s"} passed, ${failures.length} failed` +
    (failures.length > 0 ? `\n  ${failures.join("\n  ")}` : "")
);

if (failures.length > 0) process.exit(1);
