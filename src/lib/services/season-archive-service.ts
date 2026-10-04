/**
 * The season dossier: everything the app can honestly say about ONE season.
 *
 * The design problem here is coverage, not display. `season_history` mirrors the save's own summary
 * for every season the file recorded - including seasons that had already finished before TouchlineOS
 * was ever installed. Everything else in the database (snapshots, squad movement, storylines, the
 * position log) only exists for the span in which the app was actually running. So a dossier is built
 * in two halves and the halves are never blended:
 *
 *   fromSave  - the save's own summary. Always present, for every season, including ones we never saw.
 *   observed  - what TouchlineOS watched, or `null`.
 *
 * `observed: null` is a real answer, and the screen is required to say why rather than pad itself with
 * zeros. That is how "you started this save halfway through" is handled honestly.
 *
 * How a season's observation window is derived
 * -------------------------------------------
 * There is no season column on snapshots or events, and the save carries no season start/end dates
 * (`career_calendar` decodes to its own default values), so the window comes from `career_objectives`:
 * every sync opens a SAVE objective for whichever season was current at that moment, and `opened_at`
 * is written once and never moved (the sync's upsert deliberately only touches `updated_at`). The
 * season-end pass then stamps `closed_at` when it closes that season out. Therefore:
 *
 *   first time we saw this season = MIN(opened_at) for that season_number
 *   last  time we saw it           = MAX(closed_at), or null while any row is still open
 *
 * A season with no objective row has no window, so it gets no observed half. A season whose window
 * opens later than the season began cannot be detected from dates - the save does not date its own
 * seasons - but it CAN be detected from the record: the earliest SAVE position hint for that season
 * carries the save's points/games at the moment we first looked, so a season we joined late says so
 * with a number ("the save already had 20 matches played when we started").
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  boardObjectives,
  careerEvents,
  careerObjectives,
  careerSnapshots,
  clubFinanceSnapshots,
  leaguePositions,
  playerSnapshots,
  seasonHistory,
  storylineEvents,
  storylines,
} from "../db/schema";
import { EventService, type ParsedCareerEvent } from "./event-service";
import { LeagueService, leagueNameOf } from "./league-service";
import { tallyDebriefEvents, type DebriefRecord } from "./league-model-service";

/** The save's own summary of a season, exactly as `career_managerhistory` records it. */
export interface SeasonSaveHalf {
  leagueId: number | null;
  /** The save's own name for that season's competition, or null when it has none. */
  leagueName: string | null;
  /** ALL-COMPETITION totals - see `SeasonRecord`. Never league form. */
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  /** Final league position - the one league-only value the save keeps. */
  tablePosition: number | null;
  /** EA's own board objective code and result code, both unmapped enums shown as codes. */
  boardObjectiveCode: number | null;
  boardObjectiveResult: number | null;
  domesticCupObjective: number | null;
  europeCupObjective: number | null;
  leagueTrophies: number | null;
  biggestSigning: { name: string; fee: number | null } | null;
  biggestSale: { name: string; fee: number | null } | null;
}

/** Whether, and from when, TouchlineOS was running during a season. */
export interface SeasonCoverage {
  observed: boolean;
  /** Real-world timestamp of the first sync that saw this season. Null when never observed. */
  from: string | null;
  /** Real-world timestamp the season-end pass closed it out, or null while it is still open. */
  to: string | null;
  /**
   * The save's own record at the moment we first looked at this season, from the earliest SAVE
   * position hint. Present only when we were watching, and it is what tells the screen we joined
   * partway through.
   */
  saveRecordWhenFirstSeen: { played: number | null; points: number | null; position: number | null } | null;
}

export interface SquadMovement {
  firstSnapshot: { number: number; inGameDate: string | null } | null;
  lastSnapshot: { number: number; inGameDate: string | null } | null;
  sizeFirst: number;
  sizeLast: number;
  arrivals: string[];
  arrivalCount: number;
  departures: string[];
  departureCount: number;
  risers: { name: string; from: number; to: number; delta: number }[];
  fallers: { name: string; from: number; to: number; delta: number }[];
  youthCount: number;
  avgOverallFirst: number | null;
  avgOverallLast: number | null;
  wageBillFirst: number;
  wageBillLast: number;
}

export interface SeasonFinance {
  transferBudget: { first: number | null; last: number | null };
  wageBudget: { first: number | null; last: number | null };
  totalEarnings: { first: number | null; last: number | null };
  recordBuy: number | null;
  recordSale: number | null;
}

export interface DossierStoryline {
  id: string;
  title: string;
  category: string;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  evidenceCount: number;
}

export interface DossierObjective {
  id: string;
  source: "USER" | "SAVE";
  text: string | null;
  targetPosition: number | null;
  status: string;
  outcome: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface DossierPosition {
  source: string;
  basis: string | null;
  position: number;
  points: number | null;
  played: number | null;
  disputed: boolean;
  enteredAt: string;
}

/**
 * What the manager typed, added up. The save holds none of this.
 *
 * Goals, assists, singled-out players, named weaknesses and the reflections are written only in
 * logged match debriefs, so this block exists purely because someone recorded it - and the screen
 * says so. It is the part of a season no other tool can show.
 */
export interface SeasonDebriefDigest {
  logged: number;
  unreadable: number;
  /** Manager-logged goals and assists, biggest contributor first. */
  scorers: { name: string; goals: number; assists: number; matches: number }[];
  /** Players the manager singled out, most-praised first. */
  standouts: { name: string; times: number }[];
  /** Weaknesses the manager named, newest first. */
  weaknesses: { note: string; matchDate: string | null }[];
  /** The manager's own reflections, newest first. */
  reflections: { note: string; matchDate: string | null }[];
  /** Follow-up questions the anomaly engine asked, and the answers given. */
  prompts: { question: string; answer: string }[];
  venues: { home: number; away: number; neutral: number };
  competitions: { name: string; matches: number }[];
  goalsFor: number;
  goalsAgainst: number;
}

/** Everything TouchlineOS itself watched during a season. Null for a season we never saw. */
export interface SeasonObservedHalf {
  snapshots: {
    count: number;
    firstNumber: number | null;
    lastNumber: number | null;
    firstInGameDate: string | null;
    lastInGameDate: string | null;
    /** True when every sync in the window reported byte-identical content. */
    allIdentical: boolean;
  };
  /** Our own tally from logged match debriefs, all-competition like the save's own record. */
  ourRecord: DebriefRecord;
  /** The human detail: only ever as good as what the manager typed. */
  debriefs: SeasonDebriefDigest;
  squad: SquadMovement | null;
  finance: SeasonFinance | null;
  storylines: DossierStoryline[];
  objectives: DossierObjective[];
  /**
   * The manager's own tracked goals for this season, from the Board Objectives tracker.
   *
   * Deliberately NOT folded into `objectives`. That list mirrors the save's own single objective, where
   * the save owns the text and there is one of them per season. These are the five or six the manager
   * wrote for himself, with his own priorities and statuses, and they exist only because he recorded
   * them. Merging the two would make it impossible to tell which rows the save asserted and which the
   * manager did - which is the exact distinction the whole provenance split exists to preserve.
   */
  boardObjectives: DossierBoardObjective[];
  positions: DossierPosition[];
  /** Spine events observed in the window, newest first, already in `ParsedCareerEvent` shape. */
  timeline: ParsedCareerEvent[];
  /**
   * Threads that carry no season of their own and fell outside every window - counted, never
   * guessed into a season.
   */
  unplacedStorylines: number;
}

export interface SeasonDossier {
  season: number;
  complete: boolean;
  /** Whether this is the season the career is currently in. */
  current: boolean;
  fromSave: SeasonSaveHalf;
  coverage: SeasonCoverage;
  observed: SeasonObservedHalf | null;
}

/**
 * A goal the manager set himself, as recorded on the Board Objectives tracker.
 *
 * USER provenance, like the debrief digest: the save knows nothing about these, and they exist only
 * because the manager wrote them down. The vault lists them as his own record of what he set out to
 * do, never as something the game asserted.
 */
export interface DossierBoardObjective {
  id: string;
  /** One of the five EA board categories: domestic, continental, brand, financial, youth. */
  category: string;
  /** 1 is critical and 5 is low. The dossier lists them in this order. */
  priority: number;
  title: string;
  status: string;
  notes: string | null;
}

const MAX_NAMED = 6;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function inWindow(at: string | null, from: string, to: string | null): boolean {
  if (at === null) return false;
  return at >= from && (to === null || at <= to);
}

export class SeasonArchiveService {
  private events = new EventService();
  private leagues = new LeagueService();

  /**
   * Every season we have an observation window for, keyed by season ordinal.
   *
   * Derived from the objectives table rather than stored, because that is where the app already
   * records "this season was live while I was running".
   */
  private async observationWindows(careerId: string): Promise<Map<number, { from: string; to: string | null }>> {
    const rows = await db
      .select()
      .from(careerObjectives)
      .where(eq(careerObjectives.careerId, careerId))
      .orderBy(asc(careerObjectives.seasonNumber));

    const windows = new Map<number, { from: string; to: string | null }>();
    for (const row of rows) {
      const existing = windows.get(row.seasonNumber);
      const from = existing === null || existing === undefined || row.openedAt < existing.from ? row.openedAt : existing.from;
      // A single still-open objective keeps the whole season open.
      const to =
        existing?.to === null || row.closedAt === null
          ? null
          : existing === undefined || row.closedAt > existing.to
            ? row.closedAt
            : existing.to;
      windows.set(row.seasonNumber, { from, to });
    }
    return windows;
  }

  /** The save's half of the dossier - available for every season, observed or not. */
  private async saveHalf(
    careerId: string,
    season: number
  ): Promise<{ half: SeasonSaveHalf; complete: boolean } | null> {
    const [row, directory] = await Promise.all([
      db
        .select()
        .from(seasonHistory)
        .where(and(eq(seasonHistory.careerId, careerId), eq(seasonHistory.season, season)))
        .get(),
      this.leagues.getDirectory(careerId),
    ]);
    if (!row) return null;

    const goalsFor = row.goalsFor;
    const goalsAgainst = row.goalsAgainst;
    return {
      complete: (row.tablePosition ?? 0) > 0,
      half: {
        leagueId: row.leagueId,
        leagueName: leagueNameOf(directory, row.leagueId),
        played: row.gamesPlayed,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        points: row.points,
        goalsFor,
        goalsAgainst,
        goalDifference:
          goalsFor !== null && goalsAgainst !== null ? goalsFor - goalsAgainst : null,
        tablePosition: row.tablePosition,
        boardObjectiveCode: row.leagueObjective,
        boardObjectiveResult: row.leagueObjectiveResult,
        domesticCupObjective: row.domesticCupObjective,
        europeCupObjective: row.europeCupObjective,
        leagueTrophies: row.leagueTrophies,
        biggestSigning: row.bigBuyPlayerName
          ? { name: row.bigBuyPlayerName, fee: row.bigBuyAmount }
          : null,
        biggestSale: row.bigSellPlayerName
          ? { name: row.bigSellPlayerName, fee: row.bigSellAmount }
          : null,
      },
    };
  }

  /** The observed half, or null when no window covers this season. */
  private async observedHalf(
    careerId: string,
    window: { from: string; to: string | null },
    season: number
  ): Promise<SeasonObservedHalf> {
    const snapshots = await db
      .select()
      .from(careerSnapshots)
      .where(eq(careerSnapshots.careerId, careerId))
      .orderBy(asc(careerSnapshots.snapshotNumber));

    const ours = snapshots.filter((s) => inWindow(s.createdAt, window.from, window.to));
    const first = ours[0] ?? null;
    const last = ours.at(-1) ?? null;

    // "Nothing changed" is a fact worth stating rather than an empty state: every sync in the window
    // reported the same payload hash.
    const allIdentical =
      ours.length > 1 && ours.every((s) => s.rawPayloadHash === ours[0].rawPayloadHash);

    const timelineRaw = await this.events.getTimeline(careerId, 500);
    const timeline = timelineRaw.filter((e) => inWindow(e.timestamp, window.from, window.to));

    // Debriefs are read on their own, not carved out of the timeline: the timeline is capped at the
    // newest 500 events, so on a long season the earliest logged matches would silently vanish from
    // the manager's own goal and assist totals. This is the manager's data, so it is read whole.
    const debriefRows = await db
      .select()
      .from(careerEvents)
      .where(
        and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF"))
      )
      .orderBy(desc(careerEvents.timestamp));
    const debriefRowsInWindow = debriefRows.filter((row) =>
      inWindow(row.timestamp, window.from, window.to)
    );
    // Same shape `getTimeline` returns, so one parser feeds the tally and the digest.
    const debriefs: ParsedCareerEvent[] = debriefRowsInWindow.map((row) => ({
      id: row.id,
      careerId: row.careerId,
      snapshotId: row.snapshotId,
      timestamp: row.timestamp,
      eventType: row.eventType as ParsedCareerEvent["eventType"],
      source: row.source as ParsedCareerEvent["source"],
      entityType: row.entityType,
      entityId: row.entityId,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    }));
    const ourRecord = tallyDebriefEvents(
      debriefRowsInWindow.map((row) => ({ payloadJson: row.payloadJson }))
    );

    const positionRows = await db
      .select()
      .from(leaguePositions)
      .where(eq(leaguePositions.careerId, careerId))
      .orderBy(asc(leaguePositions.enteredAt));
    const positions: DossierPosition[] = positionRows
      .filter((p) => inWindow(p.enteredAt, window.from, window.to))
      .map((p) => ({
        source: p.source,
        basis: p.basis,
        position: p.position,
        points: p.points,
        played: p.played,
        disputed: p.disputed,
        enteredAt: p.enteredAt,
      }));

    const objectiveRows = await db
      .select()
      .from(careerObjectives)
      .where(eq(careerObjectives.careerId, careerId))
      .orderBy(asc(careerObjectives.openedAt));
    const objectives: DossierObjective[] = objectiveRows
      .filter((o) => o.seasonNumber === season)
      .map((o) => ({
        id: o.id,
        source: o.source as "USER" | "SAVE",
        text: o.text,
        targetPosition: o.targetPosition,
        status: o.status,
        outcome: o.outcome,
        openedAt: o.openedAt,
        closedAt: o.closedAt,
      }));

    const threadRows = await db
      .select()
      .from(storylines)
      .where(eq(storylines.careerId, careerId))
      .orderBy(asc(storylines.openedAt));
    // Bounded to this career's threads rather than the whole link table: the count is only ever read
    // for threads we are already showing.
    const threadIds = threadRows.map((t) => t.id);
    const evidenceRows = threadIds.length
      ? await db
          .select()
          .from(storylineEvents)
          .where(inArray(storylineEvents.storylineId, threadIds))
      : [];
    const evidenceCount = new Map<string, number>();
    for (const link of evidenceRows) {
      evidenceCount.set(link.storylineId, (evidenceCount.get(link.storylineId) ?? 0) + 1);
    }

    const dossierStorylines: DossierStoryline[] = threadRows
      .filter(
        (t) =>
          t.seasonNumber === season ||
          (t.seasonNumber === null && inWindow(t.openedAt, window.from, window.to))
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        status: t.status,
        openedAt: t.openedAt,
        resolvedAt: t.resolvedAt,
        evidenceCount: evidenceCount.get(t.id) ?? 0,
      }));

    const placed = new Set(dossierStorylines.map((t) => t.id));
    const unplaced = threadRows.filter((t) => t.seasonNumber === null && !placed.has(t.id)).length;

    // The manager's own tracker, scoped by the season it was written for. Ordered by priority so the
    // vault lists them the way the tracker does, rather than in insertion order.
    const boardRows = await db
      .select()
      .from(boardObjectives)
      .where(eq(boardObjectives.careerId, careerId))
      .orderBy(asc(boardObjectives.priority));
    const dossierBoardObjectives: DossierBoardObjective[] = boardRows
      .filter((o) => o.seasonNumber === season)
      .map((o) => ({
        id: o.id,
        category: o.category,
        priority: o.priority,
        title: o.title,
        status: o.status,
        notes: o.notes,
      }));

    const squad = await this.squadMovement(careerId, first?.id ?? null, last?.id ?? null, first, last);
    const finance = await this.finance(careerId, first?.id ?? null, last?.id ?? null);

    return {
      snapshots: {
        count: ours.length,
        firstNumber: first?.snapshotNumber ?? null,
        lastNumber: last?.snapshotNumber ?? null,
        firstInGameDate: first?.inGameDate ?? null,
        lastInGameDate: last?.inGameDate ?? null,
        allIdentical,
      },
      ourRecord,
      debriefs: this.debriefDigest(debriefs),
      squad,
      finance,
      storylines: dossierStorylines,
      objectives,
      boardObjectives: dossierBoardObjectives,
      positions,
      timeline: timeline.slice(0, 40),
      unplacedStorylines: unplaced,
    };
  }

  /**
   * The human half of a season, read out of logged debriefs.
   *
   * Every field here is USER provenance - the save records no scorers, no assists, no ratings, no
   * weaknesses and no manager's notes. Tolerant of the earlier single-standout payload shape, the
   * same way the debrief form itself is, so an old row still counts instead of vanishing.
   *
   * `events` arrives newest first (the order the table is read in), and the lists below keep that
   * order deliberately - the latest thing the manager said is the most useful thing to show.
   */
  private debriefDigest(events: ParsedCareerEvent[]): SeasonDebriefDigest {
    const contributions = new Map<
      string,
      { name: string; goals: number; assists: number; matches: number }
    >();
    const standouts = new Map<string, number>();
    const weaknesses: { note: string; matchDate: string | null }[] = [];
    const reflections: { note: string; matchDate: string | null }[] = [];
    const prompts: { question: string; answer: string }[] = [];
    const competitions = new Map<string, number>();
    const venues = { home: 0, away: 0, neutral: 0 };

    let logged = 0;
    let unreadable = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    for (const event of events) {
      const payload = event.payload;
      const matchDate = typeof payload.matchDate === "string" ? payload.matchDate : null;
      const scoreline = typeof payload.scoreline === "string" ? payload.scoreline : "";
      const score = scoreline.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (!score) {
        unreadable++;
        continue;
      }

      logged++;
      goalsFor += Number(score[1]);
      goalsAgainst += Number(score[2]);

      const venue = String(payload.venue ?? "").toUpperCase();
      if (venue === "AWAY") venues.away++;
      else if (venue === "NEUTRAL") venues.neutral++;
      else venues.home++;

      const competition =
        typeof payload.competition === "string" && payload.competition.trim()
          ? payload.competition.trim()
          : "Not recorded";
      competitions.set(competition, (competitions.get(competition) ?? 0) + 1);

      const entries = Array.isArray(payload.contributions) ? payload.contributions : [];
      for (const entry of entries) {
        const row = entry as { playerId?: unknown; playerName?: unknown; goals?: unknown; assists?: unknown };
        const name =
          typeof row.playerName === "string" && row.playerName.trim()
            ? row.playerName.trim()
            : typeof row.playerId === "string"
              ? row.playerId
              : null;
        if (name === null) continue;
        const tally = contributions.get(name) ?? { name, goals: 0, assists: 0, matches: 0 };
        tally.goals += typeof row.goals === "number" ? row.goals : 0;
        tally.assists += typeof row.assists === "number" ? row.assists : 0;
        tally.matches += 1;
        contributions.set(name, tally);
      }

      const named = [
        ...(Array.isArray(payload.standoutPlayerNames)
          ? payload.standoutPlayerNames.filter((name): name is string => typeof name === "string")
          : []),
        ...(typeof payload.standoutPlayerName === "string" ? [payload.standoutPlayerName] : []),
      ];
      for (const name of named) standouts.set(name, (standouts.get(name) ?? 0) + 1);

      if (typeof payload.weaknessIdentified === "string" && payload.weaknessIdentified.trim()) {
        weaknesses.push({ note: payload.weaknessIdentified.trim(), matchDate });
      }
      if (typeof payload.managerReflection === "string" && payload.managerReflection.trim()) {
        reflections.push({ note: payload.managerReflection.trim(), matchDate });
      }
      if (Array.isArray(payload.dynamicPrompts)) {
        for (const raw of payload.dynamicPrompts) {
          const prompt = raw as { question?: unknown; answer?: unknown };
          if (
            typeof prompt.question === "string" &&
            typeof prompt.answer === "string" &&
            prompt.answer.trim()
          ) {
            prompts.push({ question: prompt.question, answer: prompt.answer.trim() });
          }
        }
      }
    }

    return {
      logged,
      unreadable,
      scorers: [...contributions.values()].sort(
        (a, b) => b.goals - a.goals || b.assists - a.assists
      ),
      standouts: [...standouts.entries()]
        .map(([name, times]) => ({ name, times }))
        .sort((a, b) => b.times - a.times),
      weaknesses: weaknesses.slice(0, 8),
      reflections: reflections.slice(0, 6),
      prompts: prompts.slice(0, 8),
      venues,
      competitions: [...competitions.entries()]
        .map(([name, matches]) => ({ name, matches }))
        .sort((a, b) => b.matches - a.matches),
      goalsFor,
      goalsAgainst,
    };
  }

  /**
   * Who came, who left, who moved - between the first and last snapshot of the season.
   *
   * Read from `player_snapshots` rather than from the diff engine's events, because those events are
   * only emitted when a sync actually detects a change: a season where nothing moved produces no
   * events at all, and the honest answer there is "nothing moved", not an empty screen.
   */
  private async squadMovement(
    careerId: string,
    firstSnapshotId: string | null,
    lastSnapshotId: string | null,
    first: { snapshotNumber: number; inGameDate: string | null } | undefined | null,
    last: { snapshotNumber: number; inGameDate: string | null } | undefined | null
  ): Promise<SquadMovement | null> {
    if (!firstSnapshotId || !lastSnapshotId) return null;

    const rows = await db
      .select()
      .from(playerSnapshots)
      .where(inArray(playerSnapshots.snapshotId, [firstSnapshotId, lastSnapshotId]));

    const firstSquad = rows.filter((r) => r.snapshotId === firstSnapshotId);
    const lastSquad = rows.filter((r) => r.snapshotId === lastSnapshotId);
    const byEaId = (list: typeof rows) => new Map(list.map((r) => [r.eaPlayerId, r]));
    const before = byEaId(firstSquad);
    const after = byEaId(lastSquad);

    const arrivals = lastSquad.filter((r) => !before.has(r.eaPlayerId)).map((r) => r.name);
    const departures = firstSquad.filter((r) => !after.has(r.eaPlayerId)).map((r) => r.name);

    const moves = [...after.values()]
      .map((player) => {
        const previous = before.get(player.eaPlayerId);
        if (!previous) return null;
        const delta = player.overallRating - previous.overallRating;
        return delta === 0
          ? null
          : { name: player.name, from: previous.overallRating, to: player.overallRating, delta };
      })
      .filter((m): m is { name: string; from: number; to: number; delta: number } => m !== null);

    const risers = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
    const fallers = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);

    return {
      firstSnapshot: first ? { number: first.snapshotNumber, inGameDate: first.inGameDate } : null,
      lastSnapshot: last ? { number: last.snapshotNumber, inGameDate: last.inGameDate } : null,
      sizeFirst: firstSquad.length,
      sizeLast: lastSquad.length,
      arrivals: arrivals.slice(0, MAX_NAMED),
      arrivalCount: arrivals.length,
      departures: departures.slice(0, MAX_NAMED),
      departureCount: departures.length,
      risers,
      fallers,
      youthCount: lastSquad.filter((r) => r.isYouthProspect).length,
      avgOverallFirst: average(firstSquad.map((r) => r.overallRating)),
      avgOverallLast: average(lastSquad.map((r) => r.overallRating)),
      wageBillFirst: firstSquad.reduce((sum, r) => sum + r.wage, 0),
      wageBillLast: lastSquad.reduce((sum, r) => sum + r.wage, 0),
    };
  }

  /** The money the save reports, at the start and end of the window. */
  private async finance(
    careerId: string,
    firstSnapshotId: string | null,
    lastSnapshotId: string | null
  ): Promise<SeasonFinance | null> {
    if (!firstSnapshotId || !lastSnapshotId) return null;

    const rows = await db
      .select()
      .from(clubFinanceSnapshots)
      .where(inArray(clubFinanceSnapshots.snapshotId, [firstSnapshotId, lastSnapshotId]));

    const first = rows.find((r) => r.snapshotId === firstSnapshotId) ?? null;
    const last = rows.find((r) => r.snapshotId === lastSnapshotId) ?? null;
    if (!first && !last) return null;

    return {
      transferBudget: { first: first?.transferBudget ?? null, last: last?.transferBudget ?? null },
      wageBudget: { first: first?.wageBudget ?? null, last: last?.wageBudget ?? null },
      totalEarnings: { first: first?.totalEarnings ?? null, last: last?.totalEarnings ?? null },
      recordBuy: last?.recordBuy ?? first?.recordBuy ?? null,
      recordSale: last?.recordSale ?? first?.recordSale ?? null,
    };
  }

  /** The dossier for one season. Null when the save holds no such season. */
  async getSeasonDossier(careerId: string, season: number): Promise<SeasonDossier | null> {
    const save = await this.saveHalf(careerId, season);
    if (!save) return null;

    const windows = await this.observationWindows(careerId);
    const window = windows.get(season) ?? null;

    const allSeasons = await db
      .select()
      .from(seasonHistory)
      .where(eq(seasonHistory.careerId, careerId))
      .orderBy(asc(seasonHistory.season));
    const latestSeason = allSeasons.at(-1)?.season ?? null;

    let coverage: SeasonCoverage = {
      observed: false,
      from: null,
      to: null,
      saveRecordWhenFirstSeen: null,
    };

    let observed: SeasonObservedHalf | null = null;
    if (window) {
      // The first SAVE hint written inside this window is the save's record at the moment we looked.
      const hints = await db
        .select()
        .from(leaguePositions)
        .where(eq(leaguePositions.careerId, careerId))
        .orderBy(asc(leaguePositions.enteredAt));
      const firstHint = hints.find(
        (h) => h.source === "SAVE" && inWindow(h.enteredAt, window.from, window.to)
      );

      coverage = {
        observed: true,
        from: window.from,
        to: window.to,
        saveRecordWhenFirstSeen: firstHint
          ? { played: firstHint.played, points: firstHint.points, position: firstHint.position }
          : null,
      };
      observed = await this.observedHalf(careerId, window, season);
    }

    return {
      season,
      complete: save.complete,
      current: season === latestSeason,
      fromSave: save.half,
      coverage,
      observed,
    };
  }
}
