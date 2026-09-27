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
  storylines,
  type ObjectiveStatus,
} from "../db/schema";
import {
  LeagueModelService,
  type PositionInference,
  type RecordReconciliation,
} from "./league-model-service";

export interface SeasonRecord {
  season: number;
  leagueId: number | null;
  gamesPlayed: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** Final league position. 0 or null means the season is still in progress. */
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
  gamesPlayed: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  /** Null with no games played - a rate needs games behind it. */
  pointsPerGame: number | null;
  leagueSize: number | null;
  gamesRemaining: number | null;
  /** Points-per-game extended over the games left. Null when there is no rate or no size. */
  projectedPoints: number | null;
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

function toRecord(row: typeof seasonHistory.$inferSelect): SeasonRecord {
  const tablePosition = row.tablePosition ?? 0;
  return {
    season: row.season,
    leagueId: row.leagueId,
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

  async getSeasonHistory(careerId: string): Promise<SeasonRecord[]> {
    const rows = await db
      .select()
      .from(seasonHistory)
      .where(eq(seasonHistory.careerId, careerId))
      .orderBy(asc(seasonHistory.season));
    return rows.map(toRecord);
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
    return `Season ${currentYear - (latestSeason - season)}`;
  }

  async getOutlook(careerId: string): Promise<SeasonOutlook | null> {
    const seasons = await this.getSeasonHistory(careerId);
    const latest = seasons.at(-1);
    if (!latest) return null;

    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    const gamesPlayed = latest.gamesPlayed ?? 0;
    const points = latest.points ?? 0;
    const pointsPerGame = gamesPlayed > 0 ? points / gamesPlayed : null;

    // A division of N clubs plays 2 x (N - 1) games, so the games left follow from the size the sync
    // counted out of `leagueteamlinks`.
    const leagueSize = career?.leagueSize ?? null;
    const gamesRemaining =
      leagueSize === null || leagueSize < 2
        ? null
        : Math.max(0, 2 * (leagueSize - 1) - gamesPlayed);
    const projectedPoints =
      pointsPerGame === null || gamesRemaining === null
        ? null
        : Math.round(points + pointsPerGame * gamesRemaining);

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
      pointsPerGame,
      leagueSize,
      gamesRemaining,
      projectedPoints,
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

    return {
      seasons,
      outlook: await this.getOutlook(careerId),
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
        note = `The save has you on ${points} points from ${gamesPlayed} games (${rate} per game), which usually sits higher than ${position}.`;
      } else if (perGame <= 0.7 && position <= 6) {
        disputed = true;
        note = `The save has you on ${points} points from ${gamesPlayed} games (${rate} per game), which usually sits lower than ${position}.`;
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
          outcome = `Finished ${season.tablePosition} - the target was ${objective.targetPosition} or better.`;
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
