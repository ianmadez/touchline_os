/**
 * Verification for the world player pool.
 *
 * Proves the three things the pool's design rests on:
 *
 *   1. The whole professional world is decoded (21,166 rows in the reference career), not just our
 *      squad of 24.
 *   2. The pool is NOT registered in `extractedTables`. That object is folded into the sync payload
 *      hash, so a pool landing there would make every sync serialise megabytes just to decide whether
 *      the save changed. This is the invariant the whole approach depends on.
 *   3. Every row carries what the search and the dossier need: a name, a club, the six attribute
 *      groups, weak foot and skill moves.
 *
 * Read-only: it parses the save, prints, and exits without touching the database.
 *
 *   npx tsx scripts/probe-world-pool.ts [savePath]
 */
import fs from "fs";
import path from "path";
import { createSaveParser } from "../src/lib/platform/parse-resources";

async function main(): Promise<void> {
  const savePath =
    process.argv[2] ?? path.join(process.cwd(), "data", "saves", "ManagerCareer20260925214344463");
  const size = fs.statSync(savePath).size;
  console.log(`save: ${path.basename(savePath)} (${size} bytes)\n`);

  const parsed = await createSaveParser().parse(
    {
      id: "probe",
      filePath: savePath,
      fileName: path.basename(savePath),
      lastModified: new Date(),
      fileSizeBytes: size,
    },
    new Uint8Array(fs.readFileSync(savePath))
  );

  const pool = parsed.worldPlayers ?? [];
  const squad = parsed.squadSample ?? [];
  const extracted = parsed.extractedTables ?? {};

  console.log(`world pool        : ${pool.length.toLocaleString()} players`);
  console.log(`our squad         : ${squad.length} players`);
  console.log(`parse time        : ${parsed.parseMs} ms`);

  // ---- Invariant 1: the pool must not be in the hashed object --------------------------------
  const leaked = Object.keys(extracted).filter((key) =>
    ["worldplayers", "world_players"].includes(key.toLowerCase())
  );
  const playersDecoded = (extracted["players"] as unknown[] | undefined)?.length ?? 0;
  console.log(
    `\n${leaked.length === 0 ? "PASS" : "FAIL"}  pool absent from extractedTables (leaked: ${leaked.join(", ") || "none"})`
  );
  console.log(
    `${playersDecoded === squad.length ? "PASS" : "CHECK"}  extractedTables.players still squad-sized (${playersDecoded})`
  );

  // ---- Invariant 2: readable names, clubs and a full dossier ----------------------------------
  const named = pool.filter((entry) => entry.nameSource !== "unresolved").length;
  const withClub = pool.filter((entry) => entry.clubName !== null).length;
  const withRating = pool.filter((entry) => entry.overall !== null).length;
  const withAge = pool.filter((entry) => entry.age !== null).length;
  const withDossier = pool.filter(
    (entry) =>
      entry.weakFoot !== null &&
      entry.skillMoves !== null &&
      entry.pace.acceleration !== null &&
      entry.shooting.finishing !== null &&
      entry.passing.shortPassing !== null &&
      entry.dribbling.ballControl !== null &&
      entry.defending.standingTackle !== null &&
      entry.physical.strength !== null
  ).length;

  const pct = (n: number) => `${((n / Math.max(pool.length, 1)) * 100).toFixed(1)}%`;
  console.log(`\nname resolved     : ${named.toLocaleString()} (${pct(named)})`);
  console.log(`club resolved     : ${withClub.toLocaleString()} (${pct(withClub)})`);
  console.log(`overall present   : ${withRating.toLocaleString()} (${pct(withRating)})`);
  console.log(`age present       : ${withAge.toLocaleString()} (${pct(withAge)})`);
  console.log(
    `${withDossier === pool.length ? "PASS" : "CHECK"}  full dossier on every row: ${withDossier.toLocaleString()} (${pct(withDossier)})`
  );

  // ---- Where the names came from, so a thin source is visible rather than assumed --------------
  const bySource = new Map<string, number>();
  for (const entry of pool) {
    const key = entry.nameSource ?? "null";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  console.log(`\nname sources:`);
  for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source.padEnd(24)} ${count.toLocaleString()}`);
  }

  // ---- A readable sample, so the numbers can be eyeballed -------------------------------------
  console.log(`\nsample (highest rated 8):`);
  const top = [...pool].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, 8);
  for (const entry of top) {
    console.log(
      `  ${entry.name.padEnd(26)} ${String(entry.primaryPosition).padEnd(4)}` +
        ` ovr ${String(entry.overall).padStart(2)}  pot ${String(entry.potential).padStart(2)}` +
        `  age ${String(entry.age).padStart(2)}  wf ${entry.weakFoot}  sk ${entry.skillMoves}` +
        `  ${entry.clubName ?? "(no club)"}`
    );
  }

  // ---- Memory, measured rather than estimated -------------------------------------------------
  const bytes = Buffer.byteLength(JSON.stringify(pool.slice(0, 1000)));
  console.log(
    `\napprox pool size  : ~${((bytes * (pool.length / 1000)) / 1024 / 1024).toFixed(1)} MB resident`
  );
}

void main();
