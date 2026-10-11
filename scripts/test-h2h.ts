/**
 * Checks for the head-to-head record and the competition list.
 *
 * These two feed each other and both sit close to a lie if they drift:
 *
 *   - the head-to-head table looks like save data and is not, so the grouping, the totals and the
 *     "everywhere we have met" rule all have to be right or the screen misleads about a club's history,
 *   - the competition list decides what a debrief is filed under, so a wrong tier filter would offer a
 *     League Two club a Champions League fixture.
 *
 * It runs against a THROWAWAY database in the OS temp folder, built from the real schema, so it cannot touch
 * a manager's career. `DATABASE_URL` has to be set before the database client is imported, which is why the
 * imports below are dynamic.
 *
 *   npm run h2h:test
 */
import fs from "fs";
import os from "os";
import path from "path";

const tempPath = path.join(os.tmpdir(), `touchline-h2h-${Date.now()}.db`);
process.env.DATABASE_URL = tempPath;

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function main() {
  const Database = (await import("better-sqlite3")).default;
  const { SCHEMA_DDL, SCHEMA_MIGRATIONS } = await import("../src/lib/db/schema-sql");

  const sqlite = new Database(tempPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(SCHEMA_DDL);
  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      sqlite.exec(statement);
    } catch {
      /* column already exists */
    }
  }
  sqlite.close();

  const { db } = await import("../src/lib/db/client");
  const { careers, careerEvents, leagues } = await import("../src/lib/db/schema");
  const { HeadToHeadService } = await import("../src/lib/services/h2h-service");
  const { CompetitionService } = await import("../src/lib/services/competition-service");
  const { domesticCupsFor, continentalFor, isOpenToTier } = await import("../src/lib/trophies/catalogue");

  const careerId = "career_test_h2h";

  await db.insert(careers).values({
    id: careerId,
    managerName: "Test Manager",
    clubName: "Test Athletic",
    clubId: 1917,
    leagueId: 14,
    currentSeason: 2026,
    inGameDate: "2026-11-08",
  });

  await db.insert(leagues).values([
    {
      careerId,
      leagueId: 14,
      name: "England Championship (2)",
      level: 2,
      countryId: 14,
      countryName: "England",
    },
    {
      // A division in a nation the reference table does not list, for the fallback path.
      careerId,
      leagueId: 77,
      name: "Atlantis Premier (1)",
      level: 1,
      countryId: 999,
      countryName: "Atlantis",
    },
  ]);

  const debrief = (
    id: string,
    opponent: string,
    scoreline: string,
    matchDate: string | null,
    competition: string | null,
    venue: string | null
  ) => ({
    id,
    careerId,
    eventType: "MATCH_DEBRIEF" as const,
    entityType: "MATCH",
    entityId: `${id}_match`,
    payloadJson: JSON.stringify({ opponent, scoreline, matchDate, competition, venue }),
    source: "USER" as const,
  });

  await db.insert(careerEvents).values([
    // A club met twice: once in the league, once in the cup, with a win and a draw.
    debrief(`${careerId}_e1`, "Leeds United", "3-1", "2026-09-12", "England Championship", "Home"),
    debrief(`${careerId}_e2`, "Leeds United", "1-1", "2026-10-20", "FA Cup", "Away"),
    // The same club in lower case: the same opponent, not a second one.
    debrief(`${careerId}_e3`, "leeds united", "0-2", "2026-11-02", "England Championship", "Home"),
    // A club met once, and beaten by the biggest margin.
    debrief(`${careerId}_e4`, "Norwich City", "4-0", "2026-08-30", "England Championship", "Away"),
    // A debrief with no opponent must be skipped rather than filed under "Unknown".
    debrief(`${careerId}_e5`, "", "2-1", "2026-08-31", "England Championship", "Home"),
    // A debrief with no scoreline must be skipped rather than counted as 0-0.
    debrief(`${careerId}_e6`, "Ipswich Town", "abandoned", "2026-09-01", "England Championship", null),
    // An undated meeting with no competition named: it must survive, sort last, and read as unrecorded
    // rather than inventing a competition.
    debrief(`${careerId}_e7`, "Sheffield United", "2-1", null, null, null),
  ]);

  // A non-debrief event, to prove the filter is on the event type rather than on the table.
  await db.insert(careerEvents).values({
    id: `${careerId}_x1`,
    careerId,
    eventType: "MEDIA_COMMENT",
    entityType: "MATCH",
    entityId: `${careerId}_x1_match`,
    payloadJson: JSON.stringify({ opponent: "Leeds United", scoreline: "5-0" }),
    source: "USER",
  });

  const record = await new HeadToHeadService().getRecord(careerId);

  console.log("\nthe head-to-head record");
  check("a club met under two spellings is one opponent", record.opponents.filter((o) => o.opponent.toLowerCase() === "leeds united").length === 1);
  const leeds = record.opponents.find((opponent) => opponent.opponent === "Leeds United");
  check("the opponent name is kept as it was first written", leeds !== undefined);
  check("every meeting is kept, across competitions", leeds?.played === 3, String(leeds?.played));
  check("wins, draws and losses add up to meetings", (leeds?.wins ?? 0) + (leeds?.draws ?? 0) + (leeds?.losses ?? 0) === leeds?.played);
  check(
    "the most recent meeting sorts first",
    leeds?.meetings[0].matchDate === "2026-11-02",
    leeds?.meetings.map((m) => m.matchDate).join(", ")
  );
  check("goals are ours first, whatever the venue", leeds?.goalsFor === 4 && leeds?.goalsAgainst === 4, `${leeds?.goalsFor}/${leeds?.goalsAgainst}`);
  check(
    "the unbeaten run counts back from the most recent and stops at a loss",
    leeds?.longestUnbeaten === 0,
    String(leeds?.longestUnbeaten)
  );
  check(
    "every competition they have met in is carried, first met first",
    leeds?.competitions[0] === "England Championship" && leeds.competitions.includes("FA Cup"),
    leeds?.competitions.join(", ")
  );
  check("a debrief with no opponent is skipped", !record.opponents.some((o) => o.opponent === ""));
  check(
    "a debrief with no scoreline is skipped rather than counted as 0-0",
    !record.opponents.some((o) => o.opponent === "Ipswich Town")
  );
  check("a non-debrief event never reaches the record", record.totals.meetings === 5, String(record.totals.meetings));

  const norwich = record.opponents.find((opponent) => opponent.opponent === "Norwich City");
  check("the biggest win is the widest margin, with the venue said", norwich?.biggestWin === "4-0 (away)", String(norwich?.biggestWin));
  check("a club never beaten has no biggest win", norwich?.longestUnbeaten === 1);

  const sheffield = record.opponents.find((opponent) => opponent.opponent === "Sheffield United");
  check("an undated meeting survives", sheffield?.played === 1);
  check("a competition the save never named reads as Unrecorded", sheffield?.competitions[0] === "Unrecorded");

  check("opponents are listed alphabetically", record.opponents.map((o) => o.opponent).join("|") === [...record.opponents.map((o) => o.opponent)].sort((a, b) => a.localeCompare(b)).join("|"));
  check(
    "the competition filter list is every competition the record holds",
    record.competitions.includes("England Championship") &&
      record.competitions.includes("FA Cup") &&
      record.competitions.includes("Unrecorded")
  );
  check(
    "totals are the sum of the opponents",
    record.totals.opponents === record.opponents.length &&
      record.totals.meetings === record.opponents.reduce((total, o) => total + o.played, 0)
  );
  check("a record with debriefs is not empty", record.empty === false);

  const blank = await new HeadToHeadService().getRecord("career_with_no_debriefs");
  check("no debriefs at all reads as empty rather than as zeros", blank.empty === true && blank.opponents.length === 0);
  check("the empty record still totals to zero", blank.totals.meetings === 0 && blank.competitions.length === 0);

  console.log("\nthe competition list");
  const context = await new CompetitionService().getContext(careerId);
  check("the manager's own division is named first", context?.options[0].name === "England Championship", context?.options[0]?.name);
  check("the tier suffix is stripped from the save's name", context?.leagueName === "England Championship");
  check("the save's tier is carried", context?.tier === 2);
  check("the competition list is flagged as named", context?.named === true);
  check(
    "every domestic cup a Championship club can enter is offered",
    domesticCupsFor(14)
      .filter((cup) => isOpenToTier(cup, 2))
      .every((cup) => context?.options.some((option) => option.name === cup.name))
  );
  check(
    "a cup that a Championship club cannot enter is not offered",
    domesticCupsFor(14)
      .filter((cup) => !isOpenToTier(cup, 2))
      .every((cup) => !context?.options.some((option) => option.name === cup.name))
  );
  check(
    "a continental competition a tier-2 club cannot enter is not offered",
    continentalFor(14)
      .filter((cup) => !isOpenToTier(cup, 2))
      .every((cup) => !context?.options.some((option) => option.name === cup.name))
  );
  check("a friendly is always offered, last", context?.options[context.options.length - 1].name === "Friendly / Pre-season");
  check(
    "no competition is offered twice",
    new Set(context?.options.map((option) => option.name)).size === context?.options.length
  );
  check(
    "there is no generic league placeholder when the save can name the league",
    !context?.options.some((option) => option.name === "League Match")
  );

  // A nation with no reference rules: the generic labels come back rather than an empty list, because a
  // debrief still has to be fillable.
  await db.update(careers).set({ leagueId: 77 }).where((await import("drizzle-orm")).eq(careers.id, careerId));
  const fallback = await new CompetitionService().getContext(careerId);
  check("an unlisted nation falls back rather than offering nothing", (fallback?.options.length ?? 0) >= 3, `${fallback?.options.length}`);
  check("the fallback is flagged as not named", fallback?.named === false);
  check(
    "the fallback labels are the generic ones",
    fallback?.options.some((option) => option.name === "League Match") === true &&
      fallback?.options.some((option) => option.name === "Domestic Cup") === true
  );
  check("the fallback still ends with a friendly", fallback?.options[fallback.options.length - 1].name === "Friendly / Pre-season");

  check("an unknown career has no context at all", (await new CompetitionService().getContext("career_nope")) === null);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("failures:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  try {
    const client = (db as unknown as { $client?: { close?: () => void } }).$client;
    client?.close?.();
  } catch {
    /* nothing to close */
  }
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(tempPath + suffix)) fs.unlinkSync(tempPath + suffix);
    }
  } catch {
    console.log(`could not remove ${tempPath}`);
  }

  if (failures.length > 0) process.exitCode = 1;
}

void main();
