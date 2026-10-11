/**
 * Verification for nationality, against a real career save.
 *
 * The unit checks in `scripts/test-nations.ts` prove the reference table parses. They cannot prove the
 * table's ids are the SAME ids the save writes into `players.nationality`, and that is the one failure
 * that would be invisible: a wrong-but-plausible country on every player, with nothing on screen to
 * suggest anything is off.
 *
 * So this measures three independent things:
 *
 *   1. Every nationality code the save's own squad carries resolves to a name (or is reported).
 *   2. The pool's codes resolve too, over 20,000 players rather than 24.
 *   3. Well-known real players carry the nation a reader would expect. This one is the cross-check that
 *      does not depend on the reference table at all - it compares the file's mapping against public
 *      knowledge, so a systematically shifted table would fail it.
 *
 * Read-only: parses the save, prints, exits. No database, no writes.
 *
 *   npx tsx scripts/probe-nationality.ts [savePath]
 */
import fs from "fs";
import path from "path";
import { createSaveParser } from "../src/lib/platform/parse-resources";

/** Names to look for in the pool, with the nation a reader would expect. Case-insensitive contains. */
const KNOWN_PLAYERS: { name: string; nation: string }[] = [
  { name: "Erling Haaland", nation: "Norway" },
  { name: "Kylian Mbapp", nation: "France" },
  { name: "Jude Bellingham", nation: "England" },
  { name: "Lamine Yamal", nation: "Spain" },
  { name: "Mohamed Salah", nation: "Egypt" },
  { name: "Vinicius", nation: "Brazil" },
  { name: "Lionel Messi", nation: "Argentina" },
  { name: "Robert Lewandowski", nation: "Poland" },
  { name: "Alisson", nation: "Brazil" },
  { name: "Antoine Griezmann", nation: "France" },
];

function tally(values: (string | null)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "(no name)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

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

  const squad = parsed.squadSample ?? [];
  const pool = parsed.worldPlayers ?? [];
  const youths = parsed.youthProspects ?? [];
  const extracted = parsed.extractedTables ?? {};
  const rawPlayers = (extracted["players"] as Record<string, unknown>[] | undefined) ?? [];

  console.log(`nation table      : ${parsed.nationTableSource ?? "NOT LOADED"}`);
  console.log(`world pool        : ${pool.length.toLocaleString()} players`);
  console.log(`our squad         : ${squad.length} players`);
  console.log(`our academy       : ${youths.length} prospects`);
  console.log(`players decoded   : ${rawPlayers.length} rows\n`);

  // ---- 1. The squad, which is what the player dossier renders --------------------------------
  const squadWithCode = squad.filter((entry) => entry.nationalityId !== null);
  const squadNamed = squadWithCode.filter((entry) => entry.nationality !== null);
  const unresolved = squadWithCode.filter((entry) => entry.nationality === null);

  console.log("SQUAD");
  console.log(`  carry a code    : ${squadWithCode.length} of ${squad.length}`);
  console.log(`  resolved to name: ${squadNamed.length}`);
  console.log(
    `  ${unresolved.length === 0 ? "PASS" : "FAIL"}  every squad code resolves` +
      (unresolved.length > 0
        ? ` (unresolved: ${[...new Set(unresolved.map((e) => e.nationalityId))].join(", ")})`
        : "")
  );
  for (const [name, count] of tally(squad.map((entry) => entry.nationality))) {
    console.log(`    ${String(count).padStart(3)} x ${name}`);
  }

  // ---- 2. The pool, which is what the scouting dossier renders --------------------------------
  const poolWithCode = pool.filter((entry) => entry.nationalityId !== null);
  const poolUnresolved = poolWithCode.filter((entry) => entry.nationality === null);
  const codes = new Set(poolWithCode.map((entry) => entry.nationalityId));

  console.log("\nWORLD POOL");
  console.log(`  carry a code    : ${poolWithCode.length.toLocaleString()} of ${pool.length.toLocaleString()}`);
  console.log(`  distinct codes  : ${codes.size}`);
  console.log(
    `  ${poolUnresolved.length === 0 ? "PASS" : "FAIL"}  every pool code resolves` +
      (poolUnresolved.length > 0
        ? ` (${poolUnresolved.length} players, ${new Set(poolUnresolved.map((e) => e.nationalityId)).size} unnamed codes)`
        : "")
  );
  // Named individually, because "3 codes do not resolve" is not actionable on its own: a code with
  // thousands of players behind it means the reference table is wrong, while three codes with a
  // handful are a gap in it.
  const codesWithNoName: number[] = [];
  for (const entry of poolUnresolved) {
    const code = entry.nationalityId;
    if (code !== null && !codesWithNoName.includes(code)) codesWithNoName.push(code);
  }
  for (const code of codesWithNoName.sort((left, right) => left - right)) {
    const affected = poolUnresolved.filter((entry) => entry.nationalityId === code);
    const sample = affected
      .slice(0, 3)
      .map((entry) => `${entry.name} (${entry.clubName ?? "no club"})`)
      .join(", ");
    console.log(`      code ${code}: ${affected.length} player(s) - ${sample}`);
  }
  const top = tally(pool.map((entry) => entry.nationality)).slice(0, 12);
  console.log("  most common nations:");
  for (const [name, count] of top) {
    console.log(`    ${String(count).padStart(6)} ${name}`);
  }

  // ---- 3. Real players, checked against something other than our own table --------------------
  console.log("\nKNOWN PLAYERS (independent cross-check of the mapping)");
  const byName = pool.filter((entry) => entry.nameSource !== "unresolved");
  let agreed = 0;
  let found = 0;
  for (const probe of KNOWN_PLAYERS) {
    const needle = probe.name.toLowerCase();
    const matches = byName.filter((entry) => entry.name.toLowerCase().includes(needle));
    if (matches.length === 0) {
      console.log(`  --    ${probe.name} not in this save`);
      continue;
    }
    const match = matches.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
    found += 1;
    const ok = match.nationality === probe.nation;
    if (ok) agreed += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${match.name} -> ${match.nationality ?? "nothing"} (expected ${probe.nation})`
    );
  }
  console.log(
    `\n  ${found === 0 || agreed === found ? "PASS" : "FAIL"}  ${agreed} of ${found} found players agree with public knowledge`
  );

  // ---- 4. The academy, which is the table the flag is being added to --------------------------
  const youthWithCode = youths.filter((row) => row.nationalityId !== null);
  console.log("\nACADEMY");
  console.log(`  carry a code    : ${youthWithCode.length} of ${youths.length}`);
  for (const row of youths) {
    console.log(
      `    ${(row.name ?? "(unnamed)").padEnd(28)} ${String(row.nationalityId ?? "-").padStart(4)}  ${row.nationality ?? ""}`
    );
  }

  // ---- 5. The raw rows agree with the resolved entries ---------------------------------------
  // The resolved squad reads `players`, and the sync writes from it, so a mismatch here would mean
  // the dossier and the database disagree about the same player.
  const rawByPlayer = new Map<number, number | null>();
  for (const row of rawPlayers) {
    const id = Number(row.playerid);
    if (Number.isFinite(id)) rawByPlayer.set(id, row.nationality === undefined ? null : Number(row.nationality));
  }
  const disagreements = squad.filter((entry) => {
    const raw = rawByPlayer.get(entry.playerId);
    return raw !== undefined && raw !== entry.nationalityId;
  });
  console.log(
    `\n${disagreements.length === 0 ? "PASS" : "FAIL"}  resolved squad codes match the raw players rows (${disagreements.length} disagreements)`
  );
}

void main();
