/**
 * The league table model.
 *
 * Why this exists: the save keeps no live table for the manager's own division. `leagueteamlinks`
 * is zeroed for it on points and results (other divisions are fully populated), and every other
 * club's current-season record is simply absent. So a position cannot be read - it has to be
 * inferred, and anything inferred has to say what it stands on.
 *
 * Three sources feed it, in order of trust:
 *
 *   1. `save-hint`      - the save's own `currenttableposition` for our club. A real SAVE fact, but
 *                         the reference project measured it as disagreeing with the game's own
 *                         screen, so it is a seed rather than an answer.
 *   2. `ppm-model`      - a points-per-game curve fitted on positions the manager has recorded over
 *                         time. This is the part that corrects itself: each confirmed position is
   *                         another observation, and the model refits. One compromise is stated rather
   *                         than hidden: the only rate the save carries is an all-competition one, so
   *                         the fit is documented with `ALL_COMPETITION_FORM_CAVEAT` everywhere it is
   *                         shown.
 *   3. `debrief-record` - our own results added up from logged match debriefs. Cross-checked against
 *                         the save's own season record rather than replacing it.
 *
 * Nothing here is ever presented as a save fact. An inferred position is shown as a band with its
 * basis and its observation count, or not at all.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, careers, leaguePositions, seasonHistory, seasonProgress } from "../db/schema";

export interface DebriefRecord {
  /** How many debriefs were added up. */
  logged: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** Matches with an unreadable scoreline, excluded rather than counted as a loss. */
  unreadable: number;
}

export interface RecordReconciliation {
  fromDebriefs: DebriefRecord;
  fromSave: {
    played: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  /** True only when every logged debrief can be squared with the save's own totals. */
  agrees: boolean;
  note: string;
}

export interface PositionInference {
  /** Band, inclusive. Null when nothing supports a number. */
  low: number | null;
  high: number | null;
  basis: "save-hint" | "ppm-model" | "none";
  /** How many recorded positions the model was fitted on. */
  evidenceCount: number;
  /** The save's own field, shown alongside so a disagreement is visible rather than hidden. */
  saveHint: number | null;
  /** The save's own "highest probable finish" for our club, when it carries one. */
  saveProjectedBest: number | null;
  explanation: string;
  /**
   * The standing compromise in this band, or null when the band rests on the save's own league-only
   * field. Set for `ppm-model` only. Screens must show it rather than presenting the band as clean.
   */
  caveat: string | null;
}

interface Observation {
  position: number;
  /**
   * Points per game across EVERY competition, because that is the only points/games pair the save
   * carries - see `SeasonService`'s `SeasonRecord` for the proof. Fitting a league finish against it
   * is the model's known compromise, documented by `ALL_COMPETITION_FORM_CAVEAT`.
   */
  allCompetitionPointsPerGame: number;
}

const MIN_OBSERVATIONS_FOR_MODEL = 3;

/**
 * The one compromise in this model, worded once so every surface says the same thing.
 *
 * Our own completed seasons are the only (rate, finish) pairs available, and the rate is an
 * all-competition one: a cup run adds matches without adding league points, which pushes the rate
 * down. So the band reads as "sides with an overall scoring rate like yours finished around here",
 * not as a league calculation - and it stays honest only while that is said out loud.
 */
export const ALL_COMPETITION_FORM_CAVEAT =
  "Calibrated on scoring rates across every competition, not league-only form: cup games add matches without adding league points, so the rate reads lower than league form would. Treat it as a rough guide, not a league reading.";

/**
 * Adds up logged match debriefs.
 *
 * Extracted from the position model so the season dossier tallies the same rows the same way: one
 * season must never be described as two different records depending on which screen is asking. Only
 * the scoreline decides the result - it is arithmetic, while the manager's own result label is an
 * observation that can disagree with it.
 */
export function tallyDebriefEvents(rows: { payloadJson: string }[]): DebriefRecord {
  const record: DebriefRecord = {
    logged: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    unreadable: 0,
  };

  for (const row of rows) {
    let parsed: { scoreline?: unknown; result?: unknown };
    try {
      parsed = JSON.parse(row.payloadJson) as { scoreline?: unknown; result?: unknown };
    } catch {
      record.unreadable++;
      continue;
    }

    const scoreline = typeof parsed.scoreline === "string" ? parsed.scoreline : "";
    const match = scoreline.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) {
      record.unreadable++;
      continue;
    }

    const ours = Number(match[1]);
    const theirs = Number(match[2]);
    record.logged++;
    record.goalsFor += ours;
    record.goalsAgainst += theirs;

    if (ours > theirs) {
      record.wins++;
      record.points += 3;
    } else if (ours === theirs) {
      record.draws++;
      record.points += 1;
    } else {
      record.losses++;
    }
  }

  return record;
}

export class LeagueModelService {
  /** Our own results, added up from match debriefs the manager logged. */
  async getDebriefRecord(careerId: string): Promise<DebriefRecord> {
    const rows = await db
      .select()
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")))
      .orderBy(asc(careerEvents.timestamp));

    return tallyDebriefEvents(rows.map((row) => ({ payloadJson: row.payloadJson })));
  }

  /**
   * Our debrief tally against the save's own record.
   *
   * The two sides are like-for-like: a logged debrief covers a match in whatever competition the
   * manager played, and the save's W/D/L/points are its totals across every competition too. Unlike
   * the position band, nothing here needs a caveat - but the wording says so, because "the save's
   * record" would otherwise read as a league record.
   */
  async reconcileRecord(careerId: string): Promise<RecordReconciliation> {
    const fromDebriefs = await this.getDebriefRecord(careerId);

    const latest = await db
      .select()
      .from(seasonHistory)
      .where(eq(seasonHistory.careerId, careerId))
      .orderBy(desc(seasonHistory.season))
      .limit(1)
      .get();

    const fromSave = {
      played: latest?.gamesPlayed ?? 0,
      wins: latest?.wins ?? 0,
      draws: latest?.draws ?? 0,
      losses: latest?.losses ?? 0,
      points: latest?.points ?? 0,
      goalsFor: latest?.goalsFor ?? 0,
      goalsAgainst: latest?.goalsAgainst ?? 0,
    };

    let agrees = false;
    let note: string;

    if (fromDebriefs.logged === 0) {
      note = "No match debriefs logged yet, so there is nothing to check the save against.";
    } else if (
      fromDebriefs.wins === fromSave.wins &&
      fromDebriefs.draws === fromSave.draws &&
      fromDebriefs.losses === fromSave.losses
    ) {
      // Only meaningful when the debriefs actually cover the whole season.
      agrees = fromDebriefs.logged >= fromSave.played;
      note = agrees
        ? "Your logged debriefs add up to exactly the save's own record, across every competition."
        : `Your debriefs match the save's results so far, but cover ${fromDebriefs.logged} of ${fromSave.played} matches.`;
    } else {
      note = `Your debriefs add up to ${fromDebriefs.wins}W ${fromDebriefs.draws}D ${fromDebriefs.losses}L; the save records ${fromSave.wins}W ${fromSave.draws}D ${fromSave.losses}L. The save's record covers every match played, in any competition, so the gap is most likely debriefs not yet logged.`;
    }

    return { fromDebriefs, fromSave, agrees, note };
  }

  /**
   * Every (scoring rate, position) pair available.
   *
   * Two sources, and the first matters more than it looks: our own completed seasons are real
   * finishing positions for a real scoring rate in this very division, read straight from the save.
   * They are what lets the model say anything before the manager has confirmed a position at all.
   *
   * Confirmations made within a single season all carry the same rate, so on their own they have no
   * spread to fit against and teach the model nothing - which is exactly why the history is included
   * rather than waiting for several seasons of typing.
   *
   * BOTH sources carry an all-competition rate, not a league one: a season row's points and games are
   * the save's overall totals, and a USER position row stores that same overall record as it stood
   * when the position was logged (`SeasonService.logUserPosition`). Neither can be made league-only
   * from the save today, so both are used and the resulting band carries
   * `ALL_COMPETITION_FORM_CAVEAT`.
   */
  private async observations(careerId: string): Promise<Observation[]> {
    const history = await db
      .select()
      .from(seasonHistory)
      .where(eq(seasonHistory.careerId, careerId))
      .orderBy(asc(seasonHistory.season));
    const fromHistory: Observation[] = history
      .filter((row) => (row.tablePosition ?? 0) > 0 && (row.gamesPlayed ?? 0) > 0)
      .map((row) => ({
        position: row.tablePosition as number,
        allCompetitionPointsPerGame: (row.points ?? 0) / (row.gamesPlayed as number),
      }));

    const userRows = await db
      .select()
      .from(leaguePositions)
      .where(and(eq(leaguePositions.careerId, careerId), eq(leaguePositions.source, "USER")))
      .orderBy(asc(leaguePositions.enteredAt));
    const fromUser: Observation[] = userRows
      .filter((row) => row.points !== null && row.played !== null && row.played > 0)
      .map((row) => ({
        position: row.position,
        allCompetitionPointsPerGame: (row.points as number) / (row.played as number),
      }));

    // Include position observations captured from within-season matchday progress entries
    const progressRows = await db
      .select()
      .from(seasonProgress)
      .where(eq(seasonProgress.careerId, careerId))
      .orderBy(asc(seasonProgress.matchday));
    const fromProgress: Observation[] = progressRows
      .filter((row) => row.tablePosition !== null && row.played > 0)
      .map((row) => ({
        position: row.tablePosition as number,
        allCompetitionPointsPerGame: row.points / row.played,
      }));

    return [...fromHistory, ...fromUser, ...fromProgress];
  }

  /**
   * The inferred position, as a band.
   *
   * A band and never a single number: with few observations the honest output is a range, and where
   * nothing supports a number the answer is no number at all rather than a confident guess.
   */
  async inferPosition(careerId: string): Promise<PositionInference> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    const leagueSize = career?.leagueSize ?? null;

    const hintRow = await db
      .select()
      .from(leaguePositions)
      .where(and(eq(leaguePositions.careerId, careerId), eq(leaguePositions.source, "SAVE")))
      .orderBy(desc(leaguePositions.enteredAt))
      .limit(1)
      .get();

    const saveHint = hintRow?.position ?? null;
    const saveProjectedBest = hintRow?.projectedBest ?? null;

    const latestSeason = await db
      .select()
      .from(seasonHistory)
      .where(eq(seasonHistory.careerId, careerId))
      .orderBy(desc(seasonHistory.season))
      .limit(1)
      .get();

    const played = latestSeason?.gamesPlayed ?? 0;
    const points = latestSeason?.points ?? 0;

    if (played === 0) {
      return {
        low: null,
        high: null,
        basis: "none",
        evidenceCount: 0,
        saveHint,
        saveProjectedBest,
        explanation: "No matches played yet this season, so there is no rate to place.",
        caveat: null,
      };
    }

    const observations = await this.observations(careerId);
    const clamp = (value: number): number =>
      leagueSize === null ? Math.max(1, Math.round(value)) : Math.min(leagueSize, Math.max(1, Math.round(value)));

    if (observations.length >= MIN_OBSERVATIONS_FOR_MODEL) {
      // Ordinary least squares on (all-competition points per game, position). Two parameters, so
      // three points is the minimum that can disagree with the fit at all. The rate is the save's
      // overall one, which is the compromise this model states in its caveat rather than hides.
      const n = observations.length;
      const meanX = observations.reduce((sum, o) => sum + o.allCompetitionPointsPerGame, 0) / n;
      const meanY = observations.reduce((sum, o) => sum + o.position, 0) / n;
      const covariance = observations.reduce(
        (sum, o) => sum + (o.allCompetitionPointsPerGame - meanX) * (o.position - meanY),
        0
      );
      const varianceX = observations.reduce(
        (sum, o) => sum + (o.allCompetitionPointsPerGame - meanX) ** 2,
        0
      );

      // A flat rate teaches nothing about position, so fall through to the save's own field.
      if (varianceX > 1e-9) {
        const slope = covariance / varianceX;
        const intercept = meanY - slope * meanX;
        const rate = points / played;
        const predicted = intercept + slope * rate;

        const residuals = observations.map(
          (o) => o.position - (intercept + slope * o.allCompetitionPointsPerGame)
        );
        const residualSpread = Math.sqrt(
          residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, n - 2)
        );
        // Widen enough to actually cover the observed scatter, and never narrower than one place.
        const halfWidth = Math.max(1, Math.ceil(residualSpread));

        return {
          low: clamp(predicted - halfWidth),
          high: clamp(predicted + halfWidth),
          basis: "ppm-model",
          evidenceCount: n,
          saveHint,
          saveProjectedBest,
          explanation: `Inferred from ${n} readings in this division - your own past seasons and the positions you have confirmed - against your current rate of ${rate.toFixed(2)} points per match. The rates it was fitted on, and your current rate, are the save's totals across every competition it entered.`,
          caveat: ALL_COMPETITION_FORM_CAVEAT,
        };
      }
    }

    if (saveHint !== null) {
      // Only the save's own field to go on. It is a real save fact, but a single uncalibrated one,
      // so the band stays wide and says why.
      const shortfall = MIN_OBSERVATIONS_FOR_MODEL - observations.length;
      return {
        low: clamp(saveHint - 3),
        high: clamp(saveHint + 3),
        basis: "save-hint",
        evidenceCount: observations.length,
        saveHint,
        saveProjectedBest,
        explanation: `The save's own table position is ${saveHint}, but a save measured as unreliable on this field and ${observations.length} calibration reading${observations.length === 1 ? "" : "s"} is not enough to correct it. Confirm your real position${shortfall > 0 ? ` ${shortfall} more time${shortfall === 1 ? "" : "s"}` : ""} and it will infer on its own.`,
        caveat: null,
      };
    }

    return {
      low: null,
      high: null,
      basis: "none",
      evidenceCount: 0,
      saveHint: null,
      saveProjectedBest,
      explanation: "Nothing supports a position yet: no recorded position and the save carries no table field for this division.",
      caveat: null,
    };
  }

  /** Everything the season panel needs to describe where the club stands. */
  async getTableState(careerId: string) {
    const [inference, reconciliation, observations] = await Promise.all([
      this.inferPosition(careerId),
      this.reconcileRecord(careerId),
      this.observations(careerId),
    ]);

    return { inference, reconciliation, recordedPositions: observations.length };
  }
}
