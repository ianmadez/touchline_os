/**
 * Season history, board objectives and the end-of-season transition.
 *
 * Everything here keys off `season_history`, which mirrors the save's own `career_managerhistory`
 * one row per season. Two facts drive the whole feature:
 *
 *   1. `tablePosition` is 0 until a season completes. There is no SEASON_ENDED flag anywhere in the
 *      save, so a non-zero finishing position is the only reliable "this season is over" signal.
 *   2. The save's own board objective code (`leagueobjective`) is an unmapped 0-31 enum: there is no
 *      lookup table in the schema, and the three `seasonobjective1..3` slots on `career_managerinfo`
 *      read 0 in this save (the reference found the same). So the code is stored and displayed as a
 *      code, and the SAVE objective is never judged met or missed on a guess.
 *
 * The season-end pass is idempotent: it may only write where it actually transitions something, so
 * re-running it over unchanged data produces no rows and no events.
 */
import crypto from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  careerEvents,
  careerObjectives,
  careerSnapshots,
  careers,
  leaguePositions,
  seasonHistory,
  seasonProgress,
  storylines,
  type ObjectiveStatus,
  type SeasonProgressRow,
} from "../db/schema";
import {
  LeagueModelService,
  type PositionInference,
  type RecordReconciliation,
} from "./league-model-service";
import { LeagueService, leagueNameOf, type LeagueDirectory } from "./league-service";

export interface SeasonRecord {
  season: number;
  leagueId: number | null;
  /**
   * The save's own name for the competition that season, resolved through the league catalogue, or
   * null when the save has no name for the id. Carried unformatted - the screen decides the wording.
   */
  leagueName: string | null;
  /**
   * Every field from `gamesPlayed` through `goalsAgainst` is an ALL-COMPETITION total.
   *
   * `career_managerhistory` keeps exactly one W/D/L/points/goals set per season and it covers every
   * competition together - the league plus whichever cups the club's own division feeds into. The app
   * runs against saves from any country, so no competition is ever named in code or in copy.
   * Verified arithmetically on our reference save: seasons 1 and 2 report 55 and 56 games for a
   * 24-club division that plays 46, and `wins + draws + losses` equals `gamesPlayed` exactly in all
   * three seasons. These numbers must never be presented as league form.
   */
  gamesPlayed: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /**
   * Final league position - the one league-only value in the row.
   *
   * 0 or null means the season is still in progress. It is a league placing and has no arithmetic
   * relationship to the all-competition points total above, so the two must never be multiplied,
   * divided or reconciled with one another.
   */
  tablePosition: number | null;
  leagueObjective: number | null;
  leagueObjectiveResult: number | null;
  /** True once the save has written a finishing position, i.e. the season is over. */
  complete: boolean;
  bigBuyPlayerName: string | null;
  bigSellPlayerName: string | null;
}

export interface SeasonOutlook {
  seasonNumber: number;
  /** Display-only label, derived from the career's current year. Never used as a key. */
  seasonLabel: string;
  /**
   * ALL-COMPETITION totals, exactly as the save records them. See `SeasonRecord` for the proof.
   *
   * There is deliberately no projected-points figure here any more. The old one was
   * `points + (points / gamesPlayed) * (2 * (leagueSize - 1) - gamesPlayed)`: an all-competition
   * numerator over an all-competition denominator, extended over a count of LEAGUE games that was
   * itself wrong because `gamesPlayed` is not a league count. Two independent mismatches cannot be
   * cancelled by a caveat, so the number is gone until a genuine league-only numerator exists.
   */
  gamesPlayed: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  /**
   * The save's own points total divided by every match played, in every competition. Null with no
   * matches - a rate needs matches behind it.
   *
   * Not a league rate, and not a per-match reward either: not every competition awards points at
   * all, so this is the save's own season bookkeeping averaged over its matches.
   */
  allCompetitionPointsPerGame: number | null;
  loggedPosition: number | null;
  loggedPositionDisputed: boolean;
}

export interface ObjectiveTrack {
  id: string;
  source: "USER" | "SAVE";
  /** The manager's own words, or null for the SAVE track. */
  text: string | null;
  /** The unmapped EA objective code, SAVE track only. Shown as a code, never as a meaning. */
  saveObjectiveCode: number | null;
  /** The save's own result code, SAVE track only. 0 on an in-progress season. */
  saveResultCode: number | null;
  targetPosition: number | null;
  status: ObjectiveStatus;
  outcome: string | null;
}

export interface SeasonState {
  seasons: SeasonRecord[];
  outlook: SeasonOutlook | null;
  /** Within-season matchday-by-matchday progress series for trend charts. */
  progressSeries: SeasonProgressRow[];
  /** USER and SAVE tracks for the same season, side by side. Either may be absent. */
  objectivePair: {
    seasonNumber: number | null;
    user: ObjectiveTrack | null;
    save: ObjectiveTrack | null;
  };
  /**
   * Where the club stands in the table, inferred rather than read - the save keeps no live table for
   * our division - plus how the manager's logged debriefs compare with the save's own record.
   */
  table: {
    inference: PositionInference;
    reconciliation: RecordReconciliation;
    recordedPositions: number;
  };
}

function toRecord(
  row: typeof seasonHistory.$inferSelect,
  leagueDirectory: LeagueDirectory
): SeasonRecord {
  const tablePosition = row.tablePosition ?? 0;
  return {
    season: row.season,
    leagueId: row.leagueId,
    leagueName: leagueNameOf(leagueDirectory, row.leagueId),
    gamesPlayed: row.gamesPlayed,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    points: row.points,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    tablePosition: row.tablePosition,
    leagueObjective: row.leagueObjective,
    leagueObjectiveResult: row.leagueObjectiveResult,
    complete: tablePosition > 0,
    bigBuyPlayerName: row.bigBuyPlayerName,
    bigSellPlayerName: row.bigSellPlayerName,
  };
}

export class SeasonService {
  private leagueModel = new LeagueModelService();
  private leagues = new LeagueService();

  async getSeasonHistory(careerId: string): Promise<SeasonRecord[]> {
    // One round trip each, in parallel: the season rows are the fact, the catalogue is what makes
    // their `league_id` mean something. A missing catalogue leaves every `leagueName` null.
    const [rows, leagueDirectory] = await Promise.all([
      db
        .select()
        .from(seasonHistory)
        .where(eq(seasonHistory.careerId, careerId))
        .orderBy(asc(seasonHistory.season)),
      this.leagues.getDirectory(careerId),
    ]);
    return rows.map((row) => toRecord(row, leagueDirectory));
  }

  /** Retrospective seasons, newest first. */
  async getCompletedSeasons(careerId: string): Promise<SeasonRecord[]> {
    const seasons = await this.getSeasonHistory(careerId);
    return seasons.filter((s) => s.complete).reverse();
  }

  private async latestSnapshotId(careerId: string): Promise<string | null> {
    const snapshot = await db
      .select()
      .from(careerSnapshots)
      .where(eq(careerSnapshots.careerId, careerId))
      .orderBy(desc(careerSnapshots.snapshotNumber))
      .limit(1)
      .get();
    return snapshot?.id ?? null;
  }

  /** The calendar year a season ordinal corresponds to, for display only. */
  private labelFor(season: number, latestSeason: number, currentYear: number | null): string {
    if (currentYear === null) return `Season ${season}`;
    const baseYear = currentYear - (latestSeason - season);
    return `Season ${season} (${baseYear}/${(baseYear + 1).toString().slice(-2)})`;
  }

  async getOutlook(careerId: string): Promise<SeasonOutlook | null> {
    const seasons = await this.getSeasonHistory(careerId);
    const latest = seasons.at(-1);
    if (!latest) return null;

    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    const gamesPlayed = latest.gamesPlayed ?? 0;
    const points = latest.points ?? 0;
    // The save's own record spans every competition, so this is an all-competition rate - not a
    // league rate. No projection is derived from it: extending it over league games remaining would
    // multiply a contaminated rate by a contaminated games-left count (see `SeasonOutlook`).
    const allCompetitionPointsPerGame = gamesPlayed > 0 ? points / gamesPlayed : null;

    const logged = await db
      .select()
      .from(leaguePositions)
      .where(and(eq(leaguePositions.careerId, careerId), eq(leaguePositions.source, "USER")))
      .orderBy(asc(leaguePositions.enteredAt));
    const latestLogged = logged.at(-1) ?? null;

    return {
      seasonNumber: latest.season,
      seasonLabel: this.labelFor(latest.season, latest.season, career?.currentSeason ?? null),
      gamesPlayed,
      points,
      goalsFor: latest.goalsFor ?? 0,
      goalsAgainst: latest.goalsAgainst ?? 0,
      goalDifference: (latest.goalsFor ?? 0) - (latest.goalsAgainst ?? 0),
      allCompetitionPointsPerGame,
      loggedPosition: latestLogged?.position ?? null,
      loggedPositionDisputed: latestLogged?.disputed ?? false,
    };
  }

  async getObjectives(careerId: string): Promise<ObjectiveTrack[]> {
    const rows = await db
      .select()
      .from(careerObjectives)
      .where(eq(careerObjectives.careerId, careerId))
      .orderBy(asc(careerObjectives.seasonNumber));

    const bySeason = new Map((await this.getSeasonHistory(careerId)).map((s) => [s.season, s]));

    return rows.map((row) => {
      const season = bySeason.get(row.seasonNumber);
      const isSave = row.source === "SAVE";
      return {
        id: row.id,
        source: row.source as "USER" | "SAVE",
        text: row.text,
        saveObjectiveCode: isSave ? (season?.leagueObjective ?? null) : null,
        saveResultCode: isSave ? (season?.leagueObjectiveResult ?? null) : null,
        targetPosition: row.targetPosition,
        status: row.status as ObjectiveStatus,
        outcome: row.outcome,
      };
    });
  }

  /** Fetch within-season progress series for a specific season ordinal. */
  async getSeasonProgress(careerId: string, seasonNumber?: number): Promise<SeasonProgressRow[]> {
    const seasons = await this.getSeasonHistory(careerId);
    const targetSeason = seasonNumber ?? seasons.at(-1)?.season;
    if (!targetSeason) return [];

    return db
      .select()
      .from(seasonProgress)
      .where(and(eq(seasonProgress.careerId, careerId), eq(seasonProgress.seasonNumber, targetSeason)))
      .orderBy(asc(seasonProgress.matchday));
  }

  /** Record or update a matchday progress entry in the season series. */
  async recordMatchdayProgress(
    careerId: string,
    input: {
      seasonNumber: number;
      matchday: number;
      inGameDate?: string | null;
      points: number;
      tablePosition?: number | null;
      tablePositionHigh?: number | null;
      played: number;
      wins: number;
      draws: number;
      losses: number;
      goalsFor: number;
      goalsAgainst: number;
      form?: string | null;
    }
  ): Promise<void> {
    const id = `${careerId}_s${input.seasonNumber}_m${input.matchday}`;
    const snapshotId = await this.latestSnapshotId(careerId);

    await db
      .insert(seasonProgress)
      .values({
        id,
        careerId,
        snapshotId,
        seasonNumber: input.seasonNumber,
        matchday: input.matchday,
        inGameDate: input.inGameDate ?? null,
        points: input.points,
        tablePosition: input.tablePosition ?? null,
        tablePositionHigh: input.tablePositionHigh ?? null,
        played: input.played,
        wins: input.wins,
        draws: input.draws,
        losses: input.losses,
        goalsFor: input.goalsFor,
        goalsAgainst: input.goalsAgainst,
        form: input.form ?? null,
        provenance: "DERIVED",
      })
      .onConflictDoUpdate({
        target: [seasonProgress.careerId, seasonProgress.seasonNumber, seasonProgress.matchday],
        set: {
          snapshotId,
          inGameDate: input.inGameDate ?? null,
          points: input.points,
          tablePosition: input.tablePosition ?? null,
          tablePositionHigh: input.tablePositionHigh ?? null,
          played: input.played,
          wins: input.wins,
          draws: input.draws,
          losses: input.losses,
          goalsFor: input.goalsFor,
          goalsAgainst: input.goalsAgainst,
          form: input.form ?? null,
        },
      });
  }

  /**
   * The two tracks for the current season, side by side.
   *
   * They answer a similar question from different provenances, so a disagreement between them is
   * shown as a difference rather than resolved - one must never silently overwrite the other.
   */
  async getState(careerId: string): Promise<SeasonState> {
    const seasons = await this.getSeasonHistory(careerId);
    const objectives = await this.getObjectives(careerId);
    const currentSeason = seasons.at(-1)?.season ?? null;
    const forSeason = objectives.filter((o) => o.id.includes(`_s${currentSeason}_`));
    const progressSeries = currentSeason ? await this.getSeasonProgress(careerId, currentSeason) : [];

    return {
      seasons,
      outlook: await this.getOutlook(careerId),
      progressSeries,
      objectivePair: {
        seasonNumber: currentSeason,
        user: forSeason.find((o) => o.source === "USER") ?? null,
        save: forSeason.find((o) => o.source === "SAVE") ?? null,
      },
      table: await this.leagueModel.getTableState(careerId),
    };
  }

  /**
   * Creates or refreshes the manager's own objective for the current season.
   *
   * `targetPosition` is what makes an objective machine-judgeable at season end. Without a target the
   * outcome is still recorded, but nothing ever claims it was met or missed.
   */
  async setUserObjective(
    careerId: string,
    text: string,
    targetPosition: number | null
  ): Promise<void> {
    const latest = (await this.getSeasonHistory(careerId)).at(-1);
    if (!latest) return;

    await db
      .insert(careerObjectives)
      .values({
        id: `${careerId}_s${latest.season}_USER`,
        careerId,
        seasonNumber: latest.season,
        source: "USER",
        text,
        targetPosition,
        status: "ACTIVE",
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [careerObjectives.careerId, careerObjectives.seasonNumber, careerObjectives.source],
        set: { text, targetPosition, updatedAt: new Date().toISOString() },
      });
  }

  /**
   * Logs the manager's own league position.
   *
   * The save holds no live table for our division - `leagueteamlinks` is zeroed for it - so this is
   * USER data. It is cross-checked against what the save genuinely gives us, our own club's points
   * and games, and a mismatch is recorded as a flag rather than used to overwrite what was typed.
   * A disagreement is information, not an error to silently correct.
   *
   * The cross-check is deliberately soft, because the save's record it compares against counts every
   * competition: cup games dilute that rate, so a mismatch can mean "the save's overall record looks
   * different from your league placing" rather than anything being wrong with either figure. The
   * note says so in as many words.
   */
  async logUserPosition(
    careerId: string,
    position: number
  ): Promise<{ disputed: boolean; note: string | null }> {
    const latest = (await this.getSeasonHistory(careerId)).at(-1);
    const gamesPlayed = latest?.gamesPlayed ?? 0;
    const points = latest?.points ?? 0;

    let disputed = false;
    let note: string | null = null;

    if (gamesPlayed > 0) {
      const perGame = points / gamesPlayed;
      const rate = perGame.toFixed(2);
      // A position is only implausible relative to the record behind it: a side averaging 1.6 a game
      // cannot realistically be bottom-half, and one averaging 0.7 cannot realistically be top six.
      if (perGame >= 1.6 && position > 8) {
        disputed = true;
        note = `The save's overall record is ${points} points from ${gamesPlayed} matches (${rate} per match across all competitions), which usually sits higher than ${position}.`;
      } else if (perGame <= 0.7 && position <= 6) {
        disputed = true;
        note = `The save's overall record is ${points} points from ${gamesPlayed} matches (${rate} per match across all competitions), which usually sits lower than ${position}.`;
      }
    }

    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();

    await db.insert(leaguePositions).values({
      id: crypto.randomUUID(),
      careerId,
      snapshotId: await this.latestSnapshotId(careerId),
      seasonYear: career?.currentSeason ?? null,
      position,
      source: "USER",
      points: latest?.points ?? null,
      played: latest?.gamesPlayed ?? null,
      goalDifference:
        latest && latest.goalsFor !== null && latest.goalsAgainst !== null
          ? latest.goalsFor - latest.goalsAgainst
          : null,
      disputed,
      note,
    });

    return { disputed, note };
  }

  /**
   * The end-of-season pass.
   *
   * Closes every objective belonging to a completed season, stales any season-scoped thread nothing
   * resolved, and makes sure the current season has an open thread. Returns the number of state
   * changes, so a caller can tell a real transition from an idempotent re-run.
   */
  async evaluateSeasonTransition(careerId: string): Promise<number> {
    const seasons = await this.getSeasonHistory(careerId);
    const latestSeason = seasons.at(-1);
    if (!latestSeason) return 0;

    let changes = 0;

    for (const season of seasons.filter((s) => s.complete)) {
      const open = await db
        .select()
        .from(careerObjectives)
        .where(
          and(
            eq(careerObjectives.careerId, careerId),
            eq(careerObjectives.seasonNumber, season.season),
            eq(careerObjectives.status, "ACTIVE")
          )
        );

      for (const objective of open) {
        let status: ObjectiveStatus;
        let outcome: string;

        if (objective.source === "USER" && objective.targetPosition !== null) {
          // The one objective type that can be judged mechanically, because it carries a target.
          const met = (season.tablePosition ?? Number.MAX_SAFE_INTEGER) <= objective.targetPosition;
          status = met ? "MET" : "MISSED";
          outcome = `Finished ${season.tablePosition}, target was ${objective.targetPosition} or better.`;
        } else if (objective.source === "SAVE") {
          // The save's result code has no decoded meaning, so it is recorded verbatim and the
          // objective is closed without a verdict rather than guessed at.
          status = "CLOSED";
          outcome = `Season ended, you finished ${season.tablePosition}. EA's objective result code: ${season.leagueObjectiveResult ?? "not recorded"}.`;
        } else {
          status = "CLOSED";
          outcome = `Season ended, you finished ${season.tablePosition}. No position target was set, so this was not judged.`;
        }

        const now = new Date().toISOString();
        await db
          .update(careerObjectives)
          .set({ status, outcome, closedAt: now, updatedAt: now })
          .where(eq(careerObjectives.id, objective.id));
        changes++;
      }
    }

    // A season-scoped thread still open after its season closed was resolved by nothing.
    const staleable = await db
      .select()
      .from(storylines)
      .where(
        and(
          eq(storylines.careerId, careerId),
          eq(storylines.category, "SEASON_OBJECTIVE"),
          eq(storylines.status, "ACTIVE")
        )
      );
    for (const thread of staleable) {
      if (thread.seasonNumber === null || thread.seasonNumber >= latestSeason.season) continue;
      const now = new Date().toISOString();
      await db
        .update(storylines)
        .set({ status: "STALE", resolvedAt: now, updatedAt: now })
        .where(eq(storylines.id, thread.id));
      await this.emit(careerId, "STORYLINE_STALE", thread.id, {
        storylineId: thread.id,
        title: thread.title,
        category: thread.category,
      });
      changes++;
    }

    const hasOpenThread = await db
      .select()
      .from(storylines)
      .where(
        and(
          eq(storylines.careerId, careerId),
          eq(storylines.category, "SEASON_OBJECTIVE"),
          eq(storylines.status, "ACTIVE"),
          eq(storylines.seasonNumber, latestSeason.season)
        )
      )
      .get();

    if (!hasOpenThread) {
      const userTrack = (await this.getObjectives(careerId)).find((o) => o.source === "USER");
      const title = userTrack?.text
        ? `${userTrack.text} (season ${latestSeason.season})`
        : `Board objective (season ${latestSeason.season})`;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(storylines).values({
        id,
        careerId,
        title,
        category: "SEASON_OBJECTIVE",
        status: "ACTIVE",
        openedAt: now,
        seasonNumber: latestSeason.season,
        updatedAt: now,
      });
      await this.emit(careerId, "STORYLINE_OPENED", id, {
        storylineId: id,
        title,
        category: "SEASON_OBJECTIVE",
      });
      changes++;
    }

    return changes;
  }

  /** Writes a spine event. Only ever called on a genuine state transition. */
  private async emit(
    careerId: string,
    eventType: string,
    entityId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await db.insert(careerEvents).values({
      id: crypto.randomUUID(),
      careerId,
      snapshotId: await this.latestSnapshotId(careerId),
      eventType,
      source: "DERIVED",
      entityType: "STORYLINE",
      entityId,
      payloadJson: JSON.stringify({ careerId, ...payload }),
    });
  }
}
