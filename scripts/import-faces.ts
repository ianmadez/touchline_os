/**
 * Downloads squad and youth faces into `public/faces/`.
 *
 *   npx tsx scripts/import-faces.ts [careerId]
 *
 * Safe to re-run: anyone already cached is skipped without touching the network, so this is the
 * same code path the sync uses to pick up a new signing.
 */import { desc } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careers } from "../src/lib/db/schema";
import { ensureFacesForSquad, listCachedFaces } from "../src/lib/services/face-service";

async function main() {
  const explicit = process.argv[2];
  const careerId =
    explicit ??
    (await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get())?.id;

  if (!careerId) {
    console.error("No career found. Sync a save first, or pass a careerId.");
    process.exit(1);
  }

  console.log(`Importing faces for ${careerId}...`);
  const summary = await ensureFacesForSquad(careerId);

  console.log(`\n  squad players checked : ${summary.total}`);
  console.log(`  already cached        : ${summary.cached}`);
  console.log(`  downloaded this run   : ${summary.fetched}`);
  console.log(`  no sprite on the CDN  : ${summary.noSprite}`);
  console.log(`  newgens (never have)  : ${summary.newgen}`);
  console.log(`  errors                : ${summary.errors}`);

  const cached = listCachedFaces();
  const resolved = summary.total - summary.noSprite - summary.newgen;
  console.log(`\n  faces on disk         : ${cached.length}`);
  console.log(
    `  coverage              : ${summary.total === 0 ? 0 : Math.round((resolved / summary.total) * 100)}% of resolvable players`
  );
  console.log(
    `\n  Players without a sprite render an initials disc instead. That is the expected state for\n` +
      `  newgens and lower-league squads, not a failure.\n`
  );
}

void main();
