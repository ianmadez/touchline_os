/**
 * Seeds synthetic match debriefs into a THROWAWAY database copy, then prints the season dossier so
 * the digest can be checked with real numbers. The real save has no debriefs logged yet, so without
 * this the goals/assists/praise blocks would only ever be tested as empty strings.
 *
 *   Copy-Item data\touchline.db data\probe-dossier.db -Force        (plus -wal and -shm)
 *   $env:DATABASE_URL="data/probe-dossier.db"
 *   npx tsx scripts/seed-dossier-fixture.ts
 *
 * Refuses to run unless DATABASE_URL points at a path containing "probe", so it cannot touch the
 * save by accident.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { careerEvents, careers } from "../src/lib/db/schema";
import { SeasonService } from "../src/lib/services/season-service";
import { SeasonArchiveService } from "../src/lib/services/season-archive-service";

const target = process.env.DATABASE_URL ?? "";
if (!target.includes("probe")) {
  console.error(
    `Refusing to run: DATABASE_URL is "${target || "(unset)"}". Point it at a probe copy first.`
  );
  process.exit(1);
}

interface Fixture {
  matchDate: string;
  opponent: string;
  scoreline: string;
  result: string;
  venue: string;
  competition: string;
  standouts: string[];
  contributions: { playerId: string; playerName: string; goals: number; assists: number }[];
  weakness?: string;
  reflection?: string;
  prompts?: { id: string; question: string; answer: string }[];
}

// Deliberately loaded with the things only a manager can supply: goals, assists, a goalkeeper the
// manager keeps singling out, a repeated weakness, and two reflections worth quoting back.
const FIXTURES: Fixture[] = [
  {
    matchDate: "2026-09-05",
    opponent: "Coventry City",
    scoreline: "2-1",
    result: "Win",
    venue: "HOME",
    competition: "Championship",
    standouts: ["Bailey Peacock-Farrell"],
    contributions: [
      { playerId: "p_st", playerName: "Tom Cannon", goals: 2, assists: 0 },
      { playerId: "p_lw", playerName: "Josh Windass", goals: 0, assists: 2 },
    ],
    reflection: "Cannon looked sharp with two good finishes.",
  },
  {
    matchDate: "2026-09-12",
    opponent: "Preston North End",
    scoreline: "0-0",
    result: "Draw",
    venue: "AWAY",
    competition: "Championship",
    standouts: ["Bailey Peacock-Farrell"],
    contributions: [],
    weakness: "Could not break down a low block.",
  },
  {
    matchDate: "2026-09-19",
    opponent: "Middlesbrough",
    scoreline: "3-2",
    result: "Win",
    venue: "HOME",
    competition: "Championship",
    standouts: ["Bailey Peacock-Farrell", "Josh Windass"],
    contributions: [
      { playerId: "p_st", playerName: "Tom Cannon", goals: 1, assists: 1 },
      { playerId: "p_lw", playerName: "Josh Windass", goals: 2, assists: 0 },
    ],
    weakness: "Conceded twice from set pieces.",
    reflection: "Windass ran the game from the left.",
  },
  {
    matchDate: "2026-09-26",
    opponent: "Bristol City",
    scoreline: "1-2",
    result: "Loss",
    venue: "AWAY",
    competition: "Championship",
    standouts: ["Bailey Peacock-Farrell"],
    contributions: [{ playerId: "p_st", playerName: "Tom Cannon", goals: 1, assists: 0 }],
    weakness: "Conceded twice from set pieces.",
  },
  {
    matchDate: "2026-10-03",
    opponent: "Wrexham",
    scoreline: "4-0",
    result: "Win",
    venue: "HOME",
    competition: "Carabao Cup",
    standouts: ["Bailey Peacock-Farrell", "Tom Cannon"],
    contributions: [
      { playerId: "p_st", playerName: "Tom Cannon", goals: 3, assists: 0 },
      { playerId: "p_cb", playerName: "Jake Cooper", goals: 1, assists: 0 },
      { playerId: "p_lw", playerName: "Josh Windass", goals: 0, assists: 2 },
    ],
    reflection: "Rotated the squad and it still clicked.",
  },
  {
    matchDate: "2026-10-10",
    opponent: "Cardiff City",
    scoreline: "2-2",
    result: "Draw",
    venue: "NEUTRAL",
    competition: "Carabao Cup",
    standouts: ["Jake Cooper"],
    contributions: [
      { playerId: "p_cb", playerName: "Jake Cooper", goals: 2, assists: 0 },
    ],
    prompts: [
      { id: "anomaly_1", question: "Cooper scored twice - is he your new threat from corners?", answer: "Yes, moved him to the near post." },
    ],
  },
];

async function main() {
  const career = await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get();
  if (!career) {
    console.error("No career rows in this copy.");
    process.exit(1);
  }

  // Reset-then-rerun: clear only the rows this script owns, so a second run must recreate them and
  // add nothing new (proving the seed is idempotent).
  await db
    .delete(careerEvents)
    .where(
      and(eq(careerEvents.careerId, career.id), eq(careerEvents.eventType, "MATCH_DEBRIEF"))
    );

  await db.insert(careerEvents).values(
    FIXTURES.map((fixture, index) => ({
      id: `probe_debrief_${index + 1}`,
      careerId: career.id,
      snapshotId: null,
      // Inside season 3's observation window, which opens 2026-09-27.
      timestamp: `2026-10-${(index + 1).toString().padStart(2, "0")} 12:00:00`,
      eventType: "MATCH_DEBRIEF",
      source: "USER" as const,
      entityType: "MATCH",
      entityId: `probe_match_${index + 1}`,
      payloadJson: JSON.stringify({
        opponent: fixture.opponent,
        scoreline: fixture.scoreline,
        result: fixture.result,
        venue: fixture.venue,
        competition: fixture.competition,
        standoutPlayerNames: fixture.standouts,
        contributions: fixture.contributions,
        weaknessIdentified: fixture.weakness ?? "",
        managerReflection: fixture.reflection ?? "",
        matchDate: fixture.matchDate,
        dynamicPrompts: fixture.prompts ?? [],
      }),
    }))
  );

  // The season ordinal comes from the season rows. `careers.currentSeason` is a CALENDAR YEAR
  // (2026), which is a different scale - passing it here silently returns no dossier at all.
  const seasons = await new SeasonService().getSeasonHistory(career.id);
  const season = seasons.at(-1)?.season;
  if (season === undefined) {
    console.error("No season rows in this copy.");
    process.exit(1);
  }
  const dossier = await new SeasonArchiveService().getSeasonDossier(career.id, season);
  if (!dossier?.observed) {
    console.error("No observed half - the window does not cover this season in the copy.");
    process.exit(1);
  }

  const { ourRecord, debriefs } = dossier.observed;
  console.log(`our record: ${JSON.stringify(ourRecord)}`);
  console.log(`scorers:    ${JSON.stringify(debriefs.scorers)}`);
  console.log(`standouts:  ${JSON.stringify(debriefs.standouts)}`);
  console.log(`weaknesses: ${JSON.stringify(debriefs.weaknesses)}`);
  console.log(`reflections:${JSON.stringify(debriefs.reflections)}`);
  console.log(`prompts:    ${JSON.stringify(debriefs.prompts)}`);
  console.log(`venues:     ${JSON.stringify(debriefs.venues)}`);
  console.log(`comps:      ${JSON.stringify(debriefs.competitions)}`);
  console.log(`goals:      ${debriefs.goalsFor}-${debriefs.goalsAgainst} over ${debriefs.logged} readable`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
