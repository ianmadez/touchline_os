/**
 * Prints the value model's output for every squad player.
 *
 *   npx tsx scripts/value-report.ts [careerId]
 *
 * Exists to keep the model honest: it shows how many players actually clear the comparable-evidence
 * gate, and how wide the resulting bands are. A run where almost nobody gets a figure is a useful
 * result about the data, not a bug to paper over.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careers } from "../src/lib/db/schema";
import { SquadService } from "../src/lib/services/squad-service";
import { ValueService, MIN_COMPARABLE_DEALS } from "../src/lib/services/value-service";

function money(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `£${Math.round(value / 1_000)}k`;
  return `£${value}`;
}

async function main() {
  const careerId =
    process.argv[2] ??
    (await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get())?.id;
  if (!careerId) {
    console.error("No career found.");
    process.exit(1);
  }

  const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
  const squad = await new SquadService().getCurrentSquad(careerId, career?.inGameDate ?? null);
  const valuations = await new ValueService().valueSquad(careerId, squad);

  const rows = squad
    .map((player) => ({
      name: player.name,
      ovr: player.overallRating,
      wage: player.wage,
      valuation: valuations[player.eaPlayerId],
    }))
    .sort((a, b) => b.ovr - a.ovr);

  let estimated = 0;
  let suppressed = 0;

  console.log(`\nValue report for ${careerId} (gate: ${MIN_COMPARABLE_DEALS} comparable deals)\n`);
  for (const row of rows) {
    const v = row.valuation;
    if (v.available) {
      estimated++;
      console.log(
        `  ${row.name.padEnd(22)} OVR ${String(row.ovr).padStart(2)}  wage ${String(row.wage).padStart(6)}  ` +
          `${money(v.low)} – ${money(v.high)}${v.extrapolated ? "  [extrapolated]" : ""}  (${v.comparableCount} comparables)`
      );
    } else {
      suppressed++;
      console.log(
        `  ${row.name.padEnd(22)} OVR ${String(row.ovr).padStart(2)}  wage ${String(row.wage).padStart(6)}  ` +
          `no reliable estimate  (${v.comparableCount} comparables)`
      );
    }
  }

  console.log(
    `\n  ${estimated} of ${rows.length} players got a band; ${suppressed} were suppressed by the gate.\n`
  );
}

void main();
