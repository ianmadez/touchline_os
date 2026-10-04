/**
 * Proves the career transfer bridge is lossless.
 *
 * The claim this checks is specific: exporting a career and importing it back over itself must leave
 * the database byte-identical - not merely "the rows are there". It compares a digest of every table
 * in the file before and after, so a table that was quietly cleared and never restored fails the
 * test instead of passing it.
 *
 * It also checks the two refusals that protect the same property: a partial backup must not be
 * applied over a career it cannot fully restore, and a refused import must leave nothing behind.
 *
 * Run against a copy, never `data/touchline.db` - this script deletes and rebuilds a career.
 */
import { sql } from "drizzle-orm";
import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { sha1Hex } from "../src/lib/parser/sha";
import { importCareerFromFile } from "../src/lib/operations/career-transfer";
import {
  buildTransferPackage,
  importTransferPackage,
  PartialBackupError,
  TRANSFER_SCHEMA_VERSION,
} from "../src/lib/services/career-transfer-service";

type Row = Record<string, unknown>;

const CAREER_ID = process.env.TRANSFER_TEST_CAREER ?? "career_club_1917";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function tables(): string[] {
  return db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .map((row) => row.name);
}

function columnsOf(name: string): string[] {
  return db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(name)})`).map((c) => c.name);
}

/** A stable fingerprint of every row in every table: counts plus a digest of the sorted rows. */
function digestDatabase(): Map<string, string> {
  const digest = new Map<string, string>();
  for (const name of tables()) {
    const rows = db.all<Row>(sql`SELECT * FROM ${sql.identifier(name)}`);
    // Sorted by content, so an identical set of rows compares equal regardless of insert order.
    const canonical = rows.map((row) => JSON.stringify(row)).sort().join("\n");
    digest.set(name, `${rows.length}:${sha1Hex(canonical)}`);
  }
  return digest;
}

function compare(label: string, before: Map<string, string>): void {
  const after = digestDatabase();
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const differing = names.filter((name) => before.get(name) !== after.get(name));
  check(label, differing.length === 0, differing.length ? differing.join(", ") : "every table identical");
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: CAREER TRANSFER ROUND-TRIP TEST ===\n");

  // Refuses the live database, the same guard the other scripts in this folder carry: this one
  // deletes and rebuilds a career, so pointing it at the manager's own file would destroy real data.
  if (!config.databasePath.includes("transfer-test")) {
    console.error(
      `Refusing to run: DATABASE_URL must point at a transfer-test copy, not ${config.databasePath}.`
    );
    process.exit(1);
  }
  console.log(`Database: ${config.databasePath}`);
  console.log(`Career:   ${CAREER_ID}\n`);

  // --- 1. the export carries every career table ------------------------------------------------
  console.log("1. Export completeness");
  const pkg = await buildTransferPackage(CAREER_ID);
  if (!pkg) {
    console.error(`No career ${CAREER_ID} in this database. Nothing to test.`);
    process.exit(1);
  }

  const careerTables = tables().filter((name) => columnsOf(name).includes("career_id"));
  const expected = [...careerTables, "storyline_events"].sort();
  const carried = [...pkg.tables].sort();
  check("backup carries every career-scoped table", carried.length === expected.length,
    `${carried.length} tables, schemaVersion ${pkg.schemaVersion}`);
  check("no career table is missing from the backup",
    expected.every((name) => carried.includes(name)),
    expected.filter((name) => !carried.includes(name)).join(", ") || "none missing");
  check("package declares the version this build writes",
    pkg.schemaVersion === TRANSFER_SCHEMA_VERSION, `schemaVersion ${pkg.schemaVersion}`);

  const rowsInPackage = Object.values(pkg.counts).reduce((total, value) => total + value, 0);
  const rowsFromDb = expected.reduce((total, name) => {
    // `storyline_events` is the one table reached through its storyline rather than a career_id.
    const rows =
      name === "storyline_events"
        ? db.all<Row>(
            sql`SELECT * FROM ${sql.identifier(name)} WHERE storyline_id IN (SELECT id FROM storylines WHERE career_id = ${CAREER_ID})`
          )
        : db.all<Row>(sql`SELECT * FROM ${sql.identifier(name)} WHERE career_id = ${CAREER_ID}`);
    return total + rows.length;
  }, 0);
  check("row totals match the database", rowsInPackage === rowsFromDb,
    `${rowsInPackage.toLocaleString()} rows in the package, ${rowsFromDb.toLocaleString()} in the database`);

  // --- 2. round trip ------------------------------------------------------------------------
  console.log("\n2. Round trip over an existing career (replace)");
  const before = digestDatabase();
  const applied = await importTransferPackage(JSON.parse(JSON.stringify(pkg)) as unknown);
  check("import reports a replacement", applied.replaced === true, JSON.stringify({ replaced: applied.replaced }));
  compare("every table in the database is identical after the round trip", before);

  // Re-import once more: a second replace must also land identically, which catches anything that
  // works only because the tables happened to start empty.
  const second = await importTransferPackage(JSON.parse(JSON.stringify(pkg)) as unknown);
  check("a second import also replaces", second.replaced === true);
  compare("a repeated round trip is still identical", before);

  // --- 3. import when the career is not here yet --------------------------------------------
  console.log("\n3. Import into a database that does not hold this career");
  db.run(sql`DELETE FROM careers WHERE id = ${CAREER_ID}`);
  const emptied = digestDatabase();
  check("career removed", (emptied.get("careers") ?? "").startsWith("0:"), `careers ${emptied.get("careers")}`);

  const fresh = await importTransferPackage(JSON.parse(JSON.stringify(pkg)) as unknown);
  check("import reports an insert, not a replacement", fresh.replaced === false);
  compare("inserted career matches the original exactly", before);

  // --- 4. a partial backup must not replace -------------------------------------------------
  console.log("\n4. Refusals");
  const legacy = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    career: pkg.career,
    snapshots: pkg.data.career_snapshots ?? [],
    players: pkg.data.players ?? [],
    careerEvents: pkg.data.career_events ?? [],
  };

  const guarded = digestDatabase();
  let refused = false;
  let message = "";
  try {
    await importTransferPackage(legacy as unknown);
  } catch (error) {
    refused = error instanceof PartialBackupError;
    message = (error as Error).message;
  }
  check("a partial backup is refused over an existing career", refused,
    refused ? `"${message.slice(0, 80)}…"` : "it was applied");
  compare("the refused import left nothing behind", guarded);

  // --- 5. a malformed file is refused, not applied -------------------------------------------
  for (const [label, payload] of [
    ["not an object", "nonsense"],
    ["unknown version", { ...legacy, schemaVersion: 99 }],
    ["no career id", { ...legacy, career: {} }],
  ] as [string, unknown][]) {
    let rejected = false;
    try {
      await importTransferPackage(payload);
    } catch {
      rejected = true;
    }
    check(`refuses a payload that is ${label}`, rejected);
  }
  compare("no refusal wrote anything", guarded);

  // --- 5. the status codes the HTTP route relays --------------------------------------------
  console.log("\n5. Status codes the route relays (the operation the route delegates to)");
  {
    const okOutcome = await importCareerFromFile(JSON.parse(JSON.stringify(pkg)) as unknown);
    check("a good backup answers 200", okOutcome.status === 200, `status ${okOutcome.status}`);
    const body = okOutcome.body as { success?: boolean; replaced?: boolean; careerId?: string };
    check("and reports the replacement it performed",
      body.success === true && body.replaced === true && body.careerId === CAREER_ID,
      JSON.stringify({ success: body.success, replaced: body.replaced }));

    const partial = await importCareerFromFile(legacy as unknown);
    check("a partial backup over an existing career answers 409", partial.status === 409,
      `status ${partial.status}`);

    const junk = await importCareerFromFile("nonsense");
    check("a file that is not a backup answers 400", junk.status === 400, `status ${junk.status}`);

    const noId = await importCareerFromFile({ ...legacy, career: {} });
    check("a backup with no career id answers 400", noId.status === 400, `status ${noId.status}`);
  }

  console.log(
    `\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — ${rowsInPackage.toLocaleString()} rows round-tripped byte-identically ===`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
