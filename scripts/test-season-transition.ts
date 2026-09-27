/**
 * Proves the end-of-season transition, on a COPY of the database.
 *
 * Run against a copy so the live career is never touched:
 *
 *   Copy-Item data/touchline.db data/touchline.season-test.db
 *   $env:DATABASE_URL="<abs path>/data/touchline.season-test.db"
 *   npx tsx scripts/test-season-transition.ts
 *
 * It checks the three things the transition must do, and then checks that running it again does
 * nothing at all - the idempotency that keeps hydration from manufacturing spine events.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careerEvents, careerObjectives, seasonHistory, storylines } from "../src/lib/db/schema";
import { SeasonService } from "../src/lib/services/season-service";

const CAREER = "career_club_1917";

async function snapshot(label: string) {
  const objectives = await db.select().from(careerObjectives).where(eq(careerObjectives.careerId, CAREER));
  const threads = await db.select().from(storylines).where(eq(storylines.careerId, CAREER));
  const events = await db.select().from(careerEvents).where(eq(careerEvents.careerId, CAREER));

  console.log(`\n--- ${label} ---`);
  console.log(
    "objectives:",
    objectives.map((o) => `s${o.seasonNumber}/${o.source}=${o.status}${o.outcome ? ` :: ${o.outcome}` : ""}`)
  );
  console.log(
    "storylines:",
    threads.map((s) => `${s.category}/${s.status}${s.seasonNumber !== null ? ` (s${s.seasonNumber})` : ""}`)
  );
  console.log("events:", events.length, events.map((e) => e.eventType));
}

async function main() {
  if (!process.env.DATABASE_URL?.includes("season-test")) {
    console.error("Refusing to run: DATABASE_URL must point at a season-test copy, not the live database.");
    process.exit(1);
  }

  const service = new SeasonService();

  // Pass 1: the season is still running, so only the opening thread should be created.
  const before = await service.evaluateSeasonTransition(CAREER);
  await snapshot(`pass 1 - season still in progress (changes=${before})`);

  const repeatBefore = await service.evaluateSeasonTransition(CAREER);
  console.log(`\nidempotency check (pass 2, changes=${repeatBefore}) - expect 0`);

  // Simulate the save writing a finishing position: 4th. The user objective targets 6th or better,
  // so a correct pass judges it MET rather than merely closing it.
  await db
    .update(seasonHistory)
    .set({ tablePosition: 4, leagueObjectiveResult: 2 })
    .where(and(eq(seasonHistory.careerId, CAREER), eq(seasonHistory.season, 3)));

  // A fourth season opens, which is what the save would show after rolling over.
  await db
    .insert(seasonHistory)
    .values({
      id: `${CAREER}_s4`,
      careerId: CAREER,
      season: 4,
      leagueId: 14,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      tablePosition: 0,
      leagueObjective: 9,
      leagueObjectiveResult: 0,
      provenance: "SAVE",
    })
    .onConflictDoNothing();

  const changes = await service.evaluateSeasonTransition(CAREER);
  await snapshot(`pass 3 - after season end (changes=${changes})`);

  const repeatAfter = await service.evaluateSeasonTransition(CAREER);
  await snapshot(`pass 4 - idempotent re-run (changes=${repeatAfter}) - expect 0`);

  console.log(
    `\nRESULT: transition=${changes} changes, re-runs=${repeatBefore}+${repeatAfter} (both must be 0)`
  );
}

void main();
