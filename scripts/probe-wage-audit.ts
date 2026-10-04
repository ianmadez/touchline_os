/**
 * PHASE 0, DIAGNOSTIC 1 - wage data reliability audit.
 *
 * Read-only. Answers with a number, not an opinion: is the save's wage data dense and coherent
 * enough to build financial advisories on, or does it need a heuristic fallback?
 *
 *   npx tsx scripts/probe-wage-audit.ts
 *
 * GATE: at least 70% of senior players (age >= 18) carrying a finite, non-zero wage.
 *   >= 70%  -> use the save's wages.
 *   <  70%  -> a DERIVED_HEURISTIC wage model (f(OVR, position, division)) is required, because a
 *              wage-to-turnover ratio computed off a mostly-empty column is a fabricated ratio
 *              wearing the costume of a measured one.
 *
 * The second measurement matters as much as the first: density says whether the column is FULL,
 * correlation with overall rating says whether it is COHERENT. A column that is 100% populated but
 * uncorrelated with ability is worse than an empty one, because it looks trustworthy.
 */
import { desc } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careers, players, playerSnapshots } from "../src/lib/db/schema";

const SENIOR_AGE = 18;
const GATE = 0.7;

interface Row {
  age: number | null;
  wage: number | null;
  ovr: number | null;
}

interface Audit {
  label: string;
  rows: number;
  senior: number;
  paid: number;
  zero: number;
  missing: number;
  density: number;
  min: number | null;
  median: number | null;
  max: number | null;
  correlation: number | null;
}

/** Pearson r. Returns null rather than 0 when there is not enough spread to say anything. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((total, value) => total + value, 0) / n;
  const my = ys.reduce((total, value) => total + value, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - mx;
    const dy = ys[index] - my;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function audit(label: string, rows: Row[]): Audit {
  // An unknown age is treated as senior: excluding it would inflate density by quietly dropping
  // rows we cannot classify.
  const senior = rows.filter((row) => row.age === null || row.age >= SENIOR_AGE);
  const numeric = senior.filter(
    (row) => typeof row.wage === "number" && Number.isFinite(row.wage as number)
  );
  const paid = numeric.filter((row) => (row.wage as number) > 0);
  const wages = paid.map((row) => row.wage as number).sort((a, b) => a - b);
  const paired = paid.filter((row) => row.ovr !== null);
  return {
    label,
    rows: rows.length,
    senior: senior.length,
    paid: paid.length,
    zero: numeric.length - paid.length,
    missing: senior.length - numeric.length,
    density: senior.length === 0 ? 0 : paid.length / senior.length,
    min: wages[0] ?? null,
    median: wages.length === 0 ? null : wages[Math.floor(wages.length / 2)],
    max: wages[wages.length - 1] ?? null,
    correlation: pearson(
      paired.map((row) => row.ovr as number),
      paired.map((row) => row.wage as number)
    ),
  };
}

function report(result: Audit) {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log(`\n=== ${result.label} ===`);
  console.log(`  rows                : ${result.rows}`);
  console.log(`  senior (age >= ${SENIOR_AGE})    : ${result.senior}`);
  console.log(`  usable wage         : ${result.paid}`);
  console.log(`  recorded as zero    : ${result.zero}`);
  console.log(`  no wage at all      : ${result.missing}`);
  console.log(`  DENSITY             : ${pct(result.density)}   (gate ${pct(GATE)})`);
  console.log(
    `  min / median / max  : ${result.min ?? "\u2014"} / ${result.median ?? "\u2014"} / ${result.max ?? "\u2014"}`
  );
  console.log(
    `  corr(wage, OVR)     : ${
      result.correlation === null ? "not computable" : result.correlation.toFixed(3)
    }`
  );
}

async function main() {
  const career = await db
    .select()
    .from(careers)
    .orderBy(desc(careers.updatedAt))
    .limit(1)
    .get();
  if (!career) {
    console.log("No career rows.");
    return;
  }
  console.log(`career ${career.id}  currentSeason=${career.currentSeason}  date=${career.inGameDate}`);

  const squadRows = await db.select().from(players);
  const current = audit(
    "players (current state, all careers)",
    squadRows.map((row) => ({ age: row.age, wage: row.wage, ovr: row.overallRating }))
  );
  report(current);

  // How the app currently TAGS the wage it stores. A column tagged DERIVED is not a save fact, and
  // the advisory wording has to match whichever it is.
  const provenance = new Map<string, number>();
  for (const row of squadRows) {
    const key = String(row.wageProvenance ?? "none");
    provenance.set(key, (provenance.get(key) ?? 0) + 1);
  }
  console.log(
    `  wageProvenance      : ${[...provenance.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`
  );

  const snapshotRows = await db.select().from(playerSnapshots);
  report(
    audit(
      "player_snapshots (history)",
      snapshotRows.map((row) => ({ age: row.age, wage: row.wage, ovr: row.overallRating }))
    )
  );

  console.log("\n=== VERDICT ===");
  const pass = current.density >= GATE;
  console.log(
    `  density ${(current.density * 100).toFixed(1)}% vs gate ${(GATE * 100).toFixed(0)}% -> ` +
      (pass ? "PASS: use the save's wage values." : "FAIL: a DERIVED_HEURISTIC wage model is required.")
  );
  if (pass && current.correlation !== null && Math.abs(current.correlation) < 0.3) {
    console.log(
      `  WARNING: density passes but corr(wage, OVR) is only ${current.correlation.toFixed(3)}. ` +
        "A populated column that does not track ability cannot support a wage advisory."
    );
  }
}

void main();
