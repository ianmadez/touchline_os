/**
 * Read-only probe for the season dossier. Prints what each season would actually show, so the
 * coverage split (save half vs observed half) can be eyeballed against the real save.
 *
 *   npx tsx scripts/probe-season-dossier.ts
 */
import { desc } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careers } from "../src/lib/db/schema";
import { SeasonService } from "../src/lib/services/season-service";
import { SeasonArchiveService } from "../src/lib/services/season-archive-service";

async function main() {
  const career = await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get();
  if (!career) {
    console.log("No career rows.");
    return;
  }
  console.log(`career ${career.id}  currentSeason=${career.currentSeason}  date=${career.inGameDate}`);

  const seasons = await new SeasonService().getSeasonHistory(career.id);
  console.log(`seasons: ${seasons.map((s) => `S${s.season}${s.complete ? "" : "*"}`).join(", ")}`);

  const archive = new SeasonArchiveService();
  for (const season of seasons) {
    const dossier = await archive.getSeasonDossier(career.id, season.season);
    if (!dossier) {
      console.log(`\n=== S${season.season}: no dossier ===`);
      continue;
    }

    const { fromSave, coverage, observed } = dossier;
    console.log(`\n=== S${season.season}${dossier.complete ? "" : " (in progress)"} ===`);
    console.log(
      `  save: ${fromSave.leagueName ?? "—"} | ${fromSave.played ?? "—"}p ${fromSave.wins ?? "—"}W ` +
        `${fromSave.draws ?? "—"}D ${fromSave.losses ?? "—"}L ${fromSave.points ?? "—"}pts ` +
        `GF ${fromSave.goalsFor ?? "—"} GA ${fromSave.goalsAgainst ?? "—"} pos ${fromSave.tablePosition ?? "—"}`
    );
    console.log(
      `  coverage: observed=${coverage.observed} from=${coverage.from ?? "—"} to=${coverage.to ?? "—"} ` +
        `firstSeen=${coverage.saveRecordWhenFirstSeen ? JSON.stringify(coverage.saveRecordWhenFirstSeen) : "—"}`
    );

    if (!observed) {
      console.log("  observed half: NONE");
      continue;
    }

    const r = observed.ourRecord;
    console.log(`  our record: ${r.logged} logged, ${r.unreadable} unreadable, ${r.points}pts, ${r.goalsFor}-${r.goalsAgainst}`);
    const d = observed.debriefs;
    console.log(`  digest: ${d.logged} readable | venues ${JSON.stringify(d.venues)} | comps ${d.competitions.length}`);
    console.log(`    scorers:   ${d.scorers.slice(0, 5).map((s) => `${s.name} ${s.goals}g/${s.assists}a (${s.matches}m)`).join(", ") || "—"}`);
    console.log(`    standouts: ${d.standouts.slice(0, 5).map((s) => `${s.name} x${s.times}`).join(", ") || "—"}`);
    console.log(`    weakness:  ${d.weaknesses.length} | reflections: ${d.reflections.length} | prompts: ${d.prompts.length}`);
    console.log(`  snapshots: ${observed.snapshots.count} (${observed.snapshots.firstNumber}→${observed.snapshots.lastNumber}) identical=${observed.snapshots.allIdentical}`);
    if (observed.squad) {
      const s = observed.squad;
      console.log(`    squad ${s.sizeFirst}→${s.sizeLast}, +${s.arrivalCount}/-${s.departureCount}, youth ${s.youthCount}`);
      console.log(`    in:  ${s.arrivals.join(", ") || "—"}`);
      console.log(`    out: ${s.departures.join(", ") || "—"}`);
      console.log(`    risers: ${s.risers.map((p) => `${p.name} +${p.delta}`).join(", ") || "—"}`);
    }
    if (observed.finance) {
      console.log(`  finance: ${JSON.stringify(observed.finance)}`);
    }
    console.log(`  storylines: ${observed.storylines.length} | objectives: ${observed.objectives.length} | positions: ${observed.positions.length} | events: ${observed.timeline.length} | unplaced threads: ${observed.unplacedStorylines}`);
    for (const s of observed.storylines) console.log(`    [${s.status}] ${s.category} ${s.title} (${s.evidenceCount} facts)`);
    for (const o of observed.objectives) console.log(`    objective ${o.source}: ${o.text ?? "code"} → ${o.status}${o.outcome ? ` (${o.outcome})` : ""}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
