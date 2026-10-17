/**
 * Gathers what the news desk needs, then hands it to the pure engine.
 *
 * All this module does is read. Every judgement about WHICH story to write and HOW to word it lives in
 * `@/lib/news/news-engine`, which takes plain objects and returns plain objects, so the interesting half
 * is testable without a database and this half is a list of queries.
 *
 * MATCHES COME FROM THE MANAGER'S OWN DEBRIEFS, not from the save. That is not a limitation being
 * worked around: the save's fixture ledger is empty on a real career and its cup rows carry no names,
 * so the debriefs are the only record of what actually happened in a match, and they carry more than the
 * save ever did - scorers, assists, goal minutes, shots. A news feed built on them is built on the best
 * evidence in the app.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, careers, leagues, newsItems } from "../db/schema";
import { SquadService } from "./squad-service";
import { SeasonService } from "./season-service";
import { TacticsService } from "./tactics-service";
import { TargetBlockService } from "./target-block-service";
import { TrophyService } from "./trophy-service";
import { YouthService } from "./youth-service";
import { FinanceService } from "./finance-service";
import { ADVISORY_THRESHOLDS } from "../realism";
import {
  buildNews,
  foldName,
  typeOf,
  MAX_EDITION_STORIES,
  type NewsAbsence,
  type NewsDevelopment,
  type NewsInput,
  type NewsMatch,
  type NewsPlayer,
  type PublishedNewsItem,
} from "../news/news-engine";

/**
 * One edition as the desk writes it, before anything is stored.
 *
 * This is deliberately NOT the paper the manager reads. The screen reads the ARCHIVE (see
 * `news-archive.ts`), which is what makes a story survive a reload, get overwritten in time, be dismissed,
 * or be kept forever. This module's job ends at "here are the stories the evidence supports right now".
 */
export interface NewsEdition {
  careerId: string;
  clubName: string;
  managerName: string;
  leagueName: string | null;
  seasonNumber: number;
  inGameDate: string | null;
  /** How many matches the edition was written from, so the screen can say how much evidence there is. */
  matchesConsidered: number;
  /**
   * The matches this edition was written from, newest first.
   *
   * Carried out of the service because the ARCHIVE needs them: a stored story's id ends with the match it
   * was written from, so these are what let the front page work out which of the rows it is holding is about
   * the match just played and which is about a budget. Empty on a career with no logged match yet.
   */
  matchEventIds: readonly string[];
  items: PublishedNewsItem[];
}

export class NewsService {
  /**
   * Writes today's edition from the career's own evidence.
   *
   * Nothing is stored here. Every story returned is either something a condition on real data supports or
   * it does not exist, and the archive decides what to do with the list.
   */
  async buildStories(careerId: string): Promise<NewsEdition | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const catalogue = await db.select().from(leagues).where(eq(leagues.careerId, careerId));
    const currentLeague = catalogue.find((row) => row.leagueId === career.leagueId) ?? null;

    const seasons = await new SeasonService().getSeasonHistory(careerId);

    // The debriefs, newest first, read straight from the event spine. `EventService.getTimeline` is
    // deliberately not used: it caps at 50 events of every type and excludes evidence rows, so a busy
    // career's matches would fall off the end of its own news.
    const rows = await db
      .select()
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")))
      .orderBy(desc(careerEvents.timestamp))
      .limit(40);

    // What the manager said to the press after each match, keyed by the debrief it belongs to. A comment
    // is a separate event rather than a rewrite of the debrief, and a REFUSAL is recorded explicitly, so
    // "he said nothing" and "nobody asked" stay distinguishable in the paper.
    const commentRows = await db
      .select()
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MEDIA_COMMENT")));
    const commentsByDebriefId = new Map<string, { comment: string | null; refused: boolean }>();
    for (const row of commentRows) {
      const payload = safeParse(row.payloadJson);
      const debriefEventId = asText(payload.debriefEventId);
      if (!debriefEventId) continue;
      commentsByDebriefId.set(debriefEventId, {
        comment: asText(payload.comment),
        refused: payload.refused === true || asText(payload.comment) === null,
      });
    }

    const matches = rows
      .map((row) => ({
        match: toMatch(row.id, safeParse(row.payloadJson), commentsByDebriefId),
        // The chronology of the paper is the manager's own match dates, not the moment they happened to
        // type the debrief up. A manager who logs last month's game today must not have it reported as
        // the latest result, so the rows are re-sorted on the match date and fall back to the log time
        // only when the manager left the date blank.
        chronology: Date.parse(asText(safeParse(row.payloadJson).matchDate) ?? row.timestamp),
      }))
      .filter((entry): entry is { match: NewsMatch; chronology: number } => entry.match !== null)
      .sort((left, right) => right.chronology - left.chronology)
      .map((entry) => entry.match);

    // Rating movements the SAVE recorded between two snapshots. This is the one piece of player news
    // that needs nobody's opinion: an event exists only because two snapshots disagreed, so a story
    // built on it cannot be a guess.
    const movementRows = await db
      .select()
      .from(careerEvents)
      .where(
        and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "PLAYER_OVR_CHANGED"))
      )
      .orderBy(desc(careerEvents.timestamp))
      .limit(20);
    const developments: NewsDevelopment[] = movementRows.flatMap((row) => {
      const payload = safeParse(row.payloadJson);
      const name = asText(payload.name);
      const oldOverall = asNumber(payload.oldOvr);
      const newOverall = asNumber(payload.newOvr);
      if (!name || oldOverall === null || newOverall === null) return [];
      return [
        {
          id: row.id,
          name,
          position: asText(payload.primaryPosition) ?? "UNKNOWN",
          oldOverall,
          newOverall,
          delta: newOverall - oldOverall,
          isProspect: payload.isYouthProspect === true,
          isBreakthrough: payload.isBreakthrough === true,
          // No in-game date exists for a rating movement: the payload records the two values and the
          // event records when the sync noticed. That is a real-world moment, not a date in the season,
          // so the story is published undated rather than stamped with the wrong kind of time.
          on: null,
        },
      ];
    });

    const squad = await new SquadService().getCurrentSquad(careerId, career.inGameDate);
    const players: NewsPlayer[] = squad.map((player) => ({
      name: player.name,
      role: player.primaryPosition,
      age: player.age,
      overall: player.overallRating,
      potential: player.potentialRating,
      contractValidUntil: player.contractValidUntil,
      isKeeper: player.primaryPosition === "GK",
    }));

    //
    // Who is under treatment, straight off the squad's own injury rows.
    //
    // Every player with a date on file is passed through, including the ones whose date has already passed:
    // the desk needs the expired ones to write the return story, and deciding which is which is the desk's
    // job, not this one's. A row with no date carries no news at all and is left out.
    //
    // The XI comes with it, because the desk's injury copy turns on it: the same absence is a selection
    // problem for a starter and a depth problem for a squad player, and the wrong one of those two sentences
    // is the kind of error a manager does not forgive. This is the manager's OWN saved shape, so an empty
    // slot means "not a starter" rather than a guess drawn from a rating.
    //
    const tacticalSystem = await new TacticsService().getTacticalSystem(careerId);
    const starterIds = new Set(
      tacticalSystem.slots
        .map((slot) => slot.playerId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    );

    const injuries: NewsAbsence[] = squad.flatMap((player) => {
      const injury = player.userProfile?.injury;
      if (!injury?.until) return [];
      return [
        {
          name: player.name,
          role: player.primaryPosition,
          age: player.age,
          until: injury.until,
          note: injury.note,
          reportedOn: injury.reportedOn,
          isStarter: starterIds.has(player.id),
        },
      ];
    });

    // Trophies, flattened newest first: the cabinet already merges what the save reports with what the
    // manager recorded, so the feed never has to know about that split.
    const cabinet = await new TrophyService().getCabinet(careerId);
    const trophies = (cabinet ? [...cabinet.leagues, ...cabinet.cups] : [])
      .filter((trophy) => trophy.won)
      .flatMap((trophy) => trophy.seasonsWon.map((season) => ({ name: trophy.name, season })))
      .sort((left, right) => right.season - left.season);

    const prospects = await new YouthService().list(careerId);
    const best = prospects[0] ?? null;

    const seasonNumber =
      seasons.length > 0 ? Math.max(...seasons.map((season) => season.season)) : 1;

    let block: NewsInput["block"] = null;
    try {
      const blocks = await new TargetBlockService().listBlocks(careerId, seasonNumber);
      const latest = blocks[blocks.length - 1] ?? null;
      if (latest) {
        const played = latest.matches.filter((match) => match.actualPoints !== null);
        block = {
          gamesPlayed: played.length,
          points: played.reduce((total, match) => total + (match.actualPoints ?? 0), 0),
        };
      }
    } catch {
      // No block on file is a normal state, not a failure: the story simply does not run.
      block = null;
    }

    // Only a position the SAVE states is used. Mid-season it records 0, and printing last season's
    // placing as the current table would be a lie dressed as news.
    const currentSeasonRow = seasons.find((season) => season.season === seasonNumber) ?? null;
    const position =
      currentSeasonRow && currentSeasonRow.tablePosition !== null && currentSeasonRow.tablePosition > 0
        ? { value: currentSeasonRow.tablePosition, basis: "season record", disputed: false }
        : null;

    /**
     * How far into the season the club is, and over how many matches a full one runs.
     *
     * The match count comes from the save's own per-season record, which counts every competition, and the
     * division's size from the career row: `2 x (size - 1)` is what a full league campaign is, and it is
     * arithmetic rather than a guess. BOTH halves are required, and neither is filled in when it is
     * missing: with no size on file the desk says nothing about the time of year rather than working from a
     * typical division, and with no games played there is nothing to place the club against. That is what
     * keeps a phase word in the copy grounded in the save rather than in an assumption about it.
     */
    const leagueSize = career.leagueSize ?? null;
    const playedThisSeason = currentSeasonRow?.gamesPlayed ?? null;
    const progress =
      leagueSize !== null && leagueSize >= 4 && playedThisSeason !== null && playedThisSeason > 0
        ? { matchday: playedThisSeason, expectedGames: 2 * (leagueSize - 1) }
        : null;

    /**
     * The club's money, and the only story source in the desk that rests on an ESTIMATE.
     *
     * Read defensively: a career with no finance report at all simply gets no finance stories rather than a
     * guessed one. The wage-to-turnover level is worked out HERE from the ratio and the thresholds this
     * career's realism mode sets, rather than parsed back out of an advisory sentence - the advisory is
     * prose, and prose is the wrong thing to branch on.
     */
    let finance: NewsInput["finance"] = null;
    try {
      const report = await new FinanceService().getReport(careerId);
      if (report) {
        const thresholds = ADVISORY_THRESHOLDS[report.realismMode];
        const ratio = report.wageToTurnover;
        finance = {
          currency: report.currency,
          wageFormat: report.wageFormat,
          tier: report.tier,
          squadWeeklyWage: report.squadWeeklyWage,
          squadAnnualWage: report.squadAnnualWage,
          estimatedTierRevenue: report.estimatedTierRevenue,
          wageToTurnover: ratio,
          wageTurnoverWarning: thresholds.wageTurnoverWarning,
          wageTurnoverCritical: thresholds.wageTurnoverCritical,
          wageTurnoverLevel:
            ratio === null
              ? null
              : ratio >= thresholds.wageTurnoverCritical
                ? "CRITICAL"
                : ratio >= thresholds.wageTurnoverWarning
                  ? "WARNING"
                  : "OK",
          transferBudget: report.transferBudget,
          transferBudgetSource: report.transferBudgetSource,
          wageBudget: report.wageBudget,
          wageBudgetSource: report.wageBudgetSource,
          recordBuy: report.recordBuy,
          recordSale: report.recordSale,
          nextSeasonLiabilityToTurnover: report.nextSeasonLiabilityToTurnover,
          realismMode: report.realismMode,
        };
      }
    } catch {
      // No finance report is a normal state for a career the manager has not filled in, not a failure.
      finance = null;
    }

    /**
     * What the last editions already ran, so the front page can move on.
     *
     * Only the archive knows this: the desk cannot tell a story it printed yesterday from one it has never
     * printed, because the same facts support both. Read from the CURRENT rows, which is what the manager has
     * actually seen - a story dropped by the cap is not stored, so it stays available and surfaces on a later
     * read once the types around it have been used.
     */
    const recentRows = await db
      .select({ id: newsItems.id })
      .from(newsItems)
      .where(eq(newsItems.careerId, careerId))
      .orderBy(desc(newsItems.edition), asc(newsItems.sortIndex))
      .limit(MAX_EDITION_STORIES * 2);
    const recentTypes = [...new Set(recentRows.map((row) => typeOf(row.id)))];

    const input: NewsInput = {
      clubName: career.clubName,
      managerName: career.managerName,
      leagueName: currentLeague?.name ? stripTierSuffix(currentLeague.name) : null,
      // Which nation's press this career is filed with. The save names the country on the division row, so a
      // Danish career is written about by Danish football papers rather than by invented English ones.
      countryId: currentLeague?.countryId ?? null,
      seasonNumber,
      // `careers.currentSeason` is a CALENDAR YEAR, which is exactly what a contract comparison needs
      // and exactly what a season ordinal must never be. See the note in the trophy service.
      inGameYear: career.currentSeason,
      inGameDate: career.inGameDate,
      progress,
      finance,
      /**
       * Matches in charge, straight off the save's own per-season record.
       *
       * Summed rather than counted from the debriefs, because the debriefs are only what the manager has
       * typed up and stop at forty. Null rather than zero when the save carries no rows at all, so a career
       * the app has only just met does not claim the manager has never worked.
       */
      gamesInCharge:
        seasons.length > 0
          ? seasons.reduce((total, season) => total + (season.gamesPlayed ?? 0), 0)
          : null,
      recentTypes,
      matches,
      squad: players,
      developments,
      injuries,
      seasons: seasons.map((season) => ({
        season: season.season,
        tablePosition: season.tablePosition,
        complete: season.complete,
      })),
      position,
      trophies,
      academy: best
        ? {
            name: best.name,
            age: best.age,
            potential: best.potentialRating,
            goals: best.goals,
            appearances: best.appearances,
          }
        : null,
      block,
    };

    // Names to ids, from the three places a story can get a name from: the squad, the academy, and the
    // save's own rating-movement events. A name that resolves to nothing simply has no picture, which is
    // the normal state for a newgen and is not worth a story being withheld over.
    //
    // Keyed on the folded name, because a goal recorded as "C. Patino" has to find the squad's "C. Patiño":
    // the two spellings are one footballer, and a lookup that says otherwise leaves a blank disc in a
    // story that is otherwise correct.
    const eaIdByName = new Map<string, number>();
    for (const player of squad) eaIdByName.set(foldName(player.name), player.eaPlayerId);
    for (const prospect of prospects) {
      if (prospect.name) eaIdByName.set(foldName(prospect.name), prospect.playerId);
    }
    for (const row of movementRows) {
      const payload = safeParse(row.payloadJson);
      const name = asText(payload.name);
      const eaPlayerId = asNumber(payload.eaPlayerId);
      if (name && eaPlayerId !== null) eaIdByName.set(foldName(name), eaPlayerId);
    }

    const items: PublishedNewsItem[] = buildNews(input).map((item) => ({
      ...item,
      playerIds: item.playerNames
        .map((name) => eaIdByName.get(foldName(name)))
        .filter((eaPlayerId): eaPlayerId is number => typeof eaPlayerId === "number"),
    }));

    return {
      careerId,
      clubName: career.clubName,
      managerName: career.managerName,
      leagueName: input.leagueName,
      seasonNumber,
      inGameDate: career.inGameDate,
      matchesConsidered: matches.length,
      matchEventIds: matches.map((match) => match.eventId),
      items,
    };
  }
}

/**
 * The save's competition name without the tier suffix the catalogue stores: "England Championship (2)"
 * reads as "England Championship" in a headline. Deliberately NOT the display alias map, because a news
 * sentence naming a competition should use the save's own words.
 */
function stripTierSuffix(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .map((entry) => Math.round(entry))
    .filter((entry) => entry >= 0 && entry <= 130)
    .sort((left, right) => left - right);
}

/**
 * One debrief into the shape the stories read, or null when it cannot support a story.
 *
 * A scoreline that will not parse means the result is unknown, and a story that guesses the score is
 * worse than a match nobody writes about, so that match is dropped rather than defaulted to 0-0.
 */
function toMatch(
  eventId: string,
  payload: Record<string, unknown>,
  comments: Map<string, { comment: string | null; refused: boolean }>
): NewsMatch | null {
  const scoreline = asText(payload.scoreline);
  const numbers = scoreline ? (scoreline.match(/\d+/g) ?? []).map(Number) : [];
  if (numbers.length < 2) return null;
  const [goalsFor, goalsAgainst] = numbers;

  const resultText = asText(payload.result)?.toUpperCase() ?? null;
  const result: NewsMatch["result"] =
    resultText === "WIN" || resultText === "LOSS" || resultText === "DRAW"
      ? (resultText as NewsMatch["result"])
      : goalsFor > goalsAgainst
        ? "WIN"
        : goalsFor < goalsAgainst
          ? "LOSS"
          : "DRAW";

  // Contributions arrive as one row per player with a count, so they are expanded back into a list an
  // occurrence at a time. Everything downstream counts entries, which is how "his 3rd goal" works.
  const scorers: string[] = [];
  const assisters: string[] = [];
  const contributions = Array.isArray(payload.contributions) ? payload.contributions : [];
  for (const entry of contributions) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = asText(record.playerName);
    if (!name) continue;
    for (let index = 0; index < (asNumber(record.goals) ?? 0); index += 1) scorers.push(name);
    for (let index = 0; index < (asNumber(record.assists) ?? 0); index += 1) assisters.push(name);
  }

  const standouts = Array.isArray(payload.standoutPlayerNames)
    ? payload.standoutPlayerNames.filter((name): name is string => typeof name === "string")
    : asText(payload.standoutPlayerName) && asText(payload.standoutPlayerName) !== "None Selected"
      ? [asText(payload.standoutPlayerName) as string]
      : [];

  const stats = (payload.matchStats ?? null) as Record<string, unknown> | null;

  return {
    eventId,
    matchDate: asText(payload.matchDate),
    opponent: asText(payload.opponent),
    competition: asText(payload.competition),
    venue: asText(payload.venue),
    result,
    goalsFor,
    goalsAgainst,
    scorers,
    assisters,
    standouts,
    weakness: asText(payload.weaknessIdentified),
    goalMinutes: asMinutes(payload.goalMinutes),
    concededMinutes: asMinutes(payload.concededMinutes),
    shots: stats ? asNumber(stats.shots) : null,
    shotsInsideBox: stats ? asNumber(stats.shotsInsideBox) : null,
    // Read for one reason only: the expected goals figure of a row logged before the game's own figure had a box.
    // Nothing writes a big chance count any more, so this is null on every current debrief.
    bigChances: stats ? asNumber(stats.bigChances) : null,
    expectedGoalsReported: stats ? asNumber(stats.expectedGoalsReported) : null,
    comment: comments.get(eventId)?.comment ?? null,
    commentRefused: comments.get(eventId)?.refused ?? false,
  };
}
