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
import { fetchFlag, isUsableNationId } from "../src/lib/services/nation-source";
import { fetchSprite } from "../src/lib/services/face-source";

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

// ---------------------------------------------------------------------------------------------
// What the CDN request is allowed to carry
// ---------------------------------------------------------------------------------------------
//
// The bug this pins down: the fetch used to attach a User-Agent, on the assumption that a browser
// drops it. Chromium does; FIREFOX DOES NOT. Firefox therefore had to preflight, the CDN answers a
// preflight with 405 and no CORS headers, and `fetch` rejected - so faces and flags loaded in Edge
// and not in Firefox, with no request in the log to explain it.
//
// Both call sites are driven for real, under a stubbed `window` and a stubbed `fetch`, because the
// rule lives at the call site and not in the builder: a helper nobody calls would pass this test and
// still break the app.

console.log("\nwhat the sprite and flag request carries");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(600).fill(0)]);

/** Runs one real fetch through a stub and reports the init it was handed. */
async function captured(
  call: () => Promise<unknown>,
  asBrowser: boolean
): Promise<RequestInit | null> {
  const globals = globalThis as { window?: unknown; fetch?: typeof fetch };
  const realFetch = globalThis.fetch;
  let seen: RequestInit | null = null;

  globals.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen = init ?? null;
    return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  if (asBrowser) globals.window = {};
  else delete globals.window;

  try {
    await call();
  } finally {
    globals.fetch = realFetch;
    delete globals.window;
  }
  return seen;
}

/** The header names a request may not carry in a browser: any one of them forces a preflight. */
const NON_SIMPLE = ["user-agent", "x-probe", "authorization", "content-type"];

const headersOf = (init: RequestInit | null): string[] =>
  Object.keys((init?.headers ?? {}) as Record<string, string>).map((name) => name.toLowerCase());

// Wrapped rather than top-level await: this script is built as CommonJS.
void (async () => {
  const flagInBrowser = await captured(() => fetchFlag(14), true);
  const faceInBrowser = await captured(() => fetchSprite(231866), true);
  const flagInNode = await captured(() => fetchFlag(14), false);

  check(
    "a browser sends a flag request with no headers at all",
    flagInBrowser !== null && headersOf(flagInBrowser).length === 0,
    `sent ${JSON.stringify(headersOf(flagInBrowser))}`
  );
  check(
    "and a face request the same way, because that is what keeps it a simple CORS GET",
    faceInBrowser !== null && headersOf(faceInBrowser).length === 0,
    `sent ${JSON.stringify(headersOf(faceInBrowser))}`
  );
  check(
    "neither sends a User-Agent, which is the header Firefox keeps and Chromium drops",
    headersOf(flagInBrowser).every((name) => name !== "user-agent") &&
      headersOf(faceInBrowser).every((name) => name !== "user-agent")
  );
  check(
    "and no other header arrives that would force a preflight either",
    [...headersOf(flagInBrowser), ...headersOf(faceInBrowser)].every((name) => !NON_SIMPLE.includes(name))
  );
  check(
    "the timeout signal still goes with them, because a signal is not a header",
    flagInBrowser?.signal instanceof AbortSignal && faceInBrowser?.signal instanceof AbortSignal
  );
  check(
    "Node still identifies itself, since no CORS rule applies there",
    headersOf(flagInNode).includes("user-agent"),
    `sent ${JSON.stringify(headersOf(flagInNode))}`
  );

  console.log(
    `\n${passed} check${passed === 1 ? "" : "s"} passed, ${failures.length} failed` +
      (failures.length > 0 ? `\n  ${failures.join("\n  ")}` : "")
  );

  if (failures.length > 0) process.exit(1);
})();
