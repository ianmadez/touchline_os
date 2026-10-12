/**
 * Prints which game each save in `data/saves/` identifies as, and how.
 *
 *   npx tsx scripts/probe-game-version.ts [path ...]
 *
 * The point of this probe is the REGRESSION side of multi-game support: adding five datasheets must
 * not move the save the app already reads. It is also the only way to see an identification before it
 * reaches the parser, because once a save has been read, a wrong datasheet looks exactly like a game
 * that records different things.
 *
 * Read-only. Pass paths to check saves outside `data/saves/`.
 */
import fs from "fs";
import path from "path";
import { listSaveTableIds } from "../src/lib/parser/feasibility-parser";
import { chooseGameVersion, type MetaIndex } from "../src/lib/parser/game-versions";
import { nodeMetaSource } from "../src/lib/platform/parse-resources";

const SAVE_DIR = path.join(process.cwd(), "data", "saves");

function targets(): string[] {
  const given = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
  if (given.length > 0) return given;
  if (!fs.existsSync(SAVE_DIR)) return [];
  return fs
    .readdirSync(SAVE_DIR)
    .map((name) => path.join(SAVE_DIR, name))
    .filter((file) => fs.statSync(file).isFile())
    .filter((file) => !file.endsWith(".bin"));
}

const index = nodeMetaSource.index() as MetaIndex | null;
if (!index) {
  console.error("meta-index.json is missing. Run: npx tsx scripts/build-meta-index.ts");
  process.exit(1);
}
console.log(`index: ${index.versions.map((version) => version.id).join(", ")}\n`);

let failures = 0;

for (const file of targets()) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const startedAt = Date.now();

  let tableIds: string[];
  try {
    tableIds = listSaveTableIds(bytes);
  } catch (error) {
    console.log(`${path.basename(file)}  (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  no database: ${(error as Error).message}\n`);
    continue;
  }

  const choice = chooseGameVersion(tableIds, index);
  const ms = Date.now() - startedAt;
  console.log(`${path.basename(file)}  (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${tableIds.length} table ids read in ${ms} ms`);

  if (!choice) {
    console.log("  NOT IDENTIFIED\n");
    failures += 1;
    continue;
  }

  const verdict = choice.confident ? "confident" : "NOT confident";
  console.log(
    `  -> ${choice.descriptor.label} (${choice.descriptor.id}), support=${choice.descriptor.support}: ` +
      `${choice.matched}/${choice.total} tables, ${verdict}`
  );
  console.log(
    `  ranking: ${choice.ranking
      .slice(0, 4)
      .map((entry) => `${entry.id} ${(entry.score * 100).toFixed(0)}%`)
      .join(", ")}`
  );
  if (!choice.confident) failures += 1;
  console.log("");
}

console.log(failures === 0 ? "all saves identified confidently" : `${failures} save(s) not identified`);
process.exit(failures === 0 ? 0 : 1);
