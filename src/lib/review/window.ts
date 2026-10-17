/**
 * Choosing the matches a review reads, and turning stored rows into one shape.
 *
 * THE DOUBLE COUNT PROBLEM, AND THE RULE THAT SETTLES IT. A block of five reported results is mirrored into the
 * diary as ordinary `MATCH_DEBRIEF` events, so a manager who also logged one of those matches on its own has two
 * rows describing one fixture. The rule:
 *
 * 1. A mirrored row (`groupDebrief`) is never read as a match in its own right. The block is the source for the
 *    results it holds, so reading the mirror as well would count the same match twice.
 * 2. Where two rows share the same date AND the same folded opponent, they are one fixture. The row carrying more
 *    data wins, so a per match debrief beats a copy of it, and the dropped copy is counted.
 * 3. A row with no date is never merged. Nothing in the store can prove two undated rows are the same match, and
 *    guessing would silently delete a fixture the manager played.
 *
 * Matches are ordered newest first, because that is how a manager remembers a run of games.
 */
import { effectiveExpectedGoals, type MatchStats } from "../events/match-stats";
import { normaliseFormationStamp } from "../events/tactics-stamp";
import type { TargetBlock } from "../services/target-block-service";
import type { MatchFigures, ReviewMatch, ReviewRequest, Strength } from "./types";

/** How many matches a window reads when it is not told. The floor is the smallest sample the review will read. */
export const DEFAULT_WINDOW_COUNT = 5;
export const MIN_WINDOW_COUNT = 3;

/** The subset of a stored event the window needs. Kept narrow so a test can build one by hand. */
export interface WindowEvent {
  id: string;
  timestamp: string;
  entityType: string;
  payload: Record<string, unknown>;
}

export interface WindowInput {
  request: ReviewRequest;
  /** Every `MATCH_DEBRIEF` event for the career, in any order. */
  events: WindowEvent[];
  /** Every block for the career, in any order. */
  blocks: TargetBlock[];
}

export interface WindowResult {
  matches: ReviewMatch[];
  merged: number;
  key: string;
  window: { from: string | null; to: string | null; count: number };
  /** The block being reviewed, when the request named one. */
  block: TargetBlock | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function minuteList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Math.trunc(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 130);
}

/**
 * An opponent name folded for comparison.
 *
 * Case, accents, punctuation and spacing all go, and ampersands become "and", because the same club is written
 * several ways across a save and the manager's own typing. Words are kept: a fold that dropped "City" would merge
 * Birmingham with Bristol, which is a worse mistake than missing a duplicate.
 */
export function foldOpponent(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .replace(/\b(fc|afc|cf|sc|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pointsFrom(goalsFor: number | null, goalsAgainst: number | null): 0 | 1 | 3 | null {
  if (goalsFor === null || goalsAgainst === null) return null;
  if (goalsFor > goalsAgainst) return 3;
  return goalsFor === goalsAgainst ? 1 : 0;
}

function scoreOf(payload: Record<string, unknown>): { for: number | null; against: number | null } {
  const home = num(payload.homeScore);
  const away = num(payload.awayScore);
  if (home !== null && away !== null) return { for: home, against: away };
  const scoreline = text(payload.scoreline);
  if (scoreline !== null) {
    const parts = scoreline.split(/[-–:]/).map((part) => num(part.trim()));
    if (parts.length === 2 && parts[0] !== null && parts[1] !== null) {
      return { for: parts[0], against: parts[1] };
    }
  }
  return { for: null, against: null };
}

function figuresFrom(stats: MatchStats | null): { figures: MatchFigures; hasFigures: boolean } {
  const figures: MatchFigures = {
    expectedGoals: stats === null ? null : effectiveExpectedGoals(stats),
    shots: stats?.shots ?? null,
    shotsInsideBox: stats?.shotsInsideBox ?? null,
    possession: stats?.possession ?? null,
    passesCompleted: stats?.passesCompleted ?? null,
  };
  const hasFigures = Object.values(figures).some((value) => value !== null);
  return { figures, hasFigures };
}

function contributionsFrom(value: unknown): ReviewMatch["contributions"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = entry as { playerName?: unknown; goals?: unknown; assists?: unknown };
      const playerName = text(record.playerName);
      if (playerName === null) return null;
      return {
        playerName,
        goals: Math.max(0, Math.trunc(num(record.goals) ?? 0)),
        assists: Math.max(0, Math.trunc(num(record.assists) ?? 0)),
      };
    })
    .filter((entry): entry is ReviewMatch["contributions"][number] => entry !== null);
}

function standoutsFrom(payload: Record<string, unknown>): string[] {
  const names = payload.standoutPlayerNames;
  if (Array.isArray(names)) {
    return names.map((name) => text(name)).filter((name): name is string => name !== null);
  }
  const single = text(payload.standoutPlayerName);
  return single !== null && single !== "None Selected" ? [single] : [];
}

/** A per match debrief as one fixture. */
export function matchFromEvent(event: WindowEvent): ReviewMatch {
  const payload = event.payload;
  const score = scoreOf(payload);
  const stats = (payload.matchStats ?? null) as MatchStats | null;
  const { figures, hasFigures } = figuresFrom(stats);
  const opponent = text(payload.opponent) ?? "Opponent not named";
  const venue = text(payload.venue);
  return {
    id: event.id,
    date: text(payload.matchDate),
    opponent,
    foldedOpponent: foldOpponent(opponent),
    venue: venue === "HOME" || venue === "AWAY" || venue === "NEUTRAL" ? venue : null,
    competition: text(payload.competition),
    goalsFor: score.for,
    goalsAgainst: score.against,
    points: pointsFrom(score.for, score.against),
    formation: normaliseFormationStamp(payload.formation),
    figures,
    hasFigures,
    goalMinutes: minuteList(payload.goalMinutes),
    concededMinutes: minuteList(payload.concededMinutes),
    weakness: text(payload.weaknessIdentified),
    standouts: standoutsFrom(payload),
    contributions: contributionsFrom(payload.contributions),
    source: "DEBRIEF",
  };
}

/**
 * One row of a block as one fixture.
 *
 * Date and venue are null by construction rather than by omission: a block records a matchday, not a date, and
 * inventing either would make this row mergeable with a debrief it may not describe.
 */
export function matchFromBlockMatch(
  block: TargetBlock,
  index: number
): ReviewMatch | null {
  const match = block.matches[index];
  if (!match) return null;
  if (match.goalsFor === null || match.goalsAgainst === null) return null;
  const opponent = match.opponent ?? "Opponent not named";
  return {
    id: `grp_${block.id}_${match.matchday}`,
    date: null,
    opponent,
    foldedOpponent: foldOpponent(opponent),
    venue: null,
    competition: "League Match",
    goalsFor: match.goalsFor,
    goalsAgainst: match.goalsAgainst,
    points: pointsFrom(match.goalsFor, match.goalsAgainst),
    formation: match.formation,
    figures: {
      expectedGoals: null,
      shots: null,
      shotsInsideBox: null,
      possession: null,
      passesCompleted: null,
    },
    hasFigures: false,
    goalMinutes: [],
    concededMinutes: [],
    weakness: null,
    standouts: [],
    contributions: [],
    source: "BLOCK",
  };
}

/** Newest first, and undated rows last, because an undated fixture cannot be placed in a run of results. */
function byDateDesc(left: ReviewMatch, right: ReviewMatch): number {
  if (left.date === null && right.date === null) return 0;
  if (left.date === null) return 1;
  if (right.date === null) return -1;
  return right.date.localeCompare(left.date);
}

/** True when a row is the mirror of a block report rather than a match logged in its own right. */
export function isMirror(event: WindowEvent): boolean {
  if (event.entityType === "TARGET_BLOCK") return true;
  const group = event.payload.groupDebrief;
  return typeof group === "object" && group !== null;
}

/**
 * Folds fixtures that describe the same match into one, keeping the copy that carries the most.
 *
 * "The most" is measured on what the review can actually use, in this order: figures, then minutes, then the row
 * with a formation. A per match debrief almost always wins, which is what the rule asks for.
 */
function mergeDuplicates(matches: ReviewMatch[]): { matches: ReviewMatch[]; merged: number } {
  const kept: ReviewMatch[] = [];
  let merged = 0;
  for (const match of matches) {
    if (match.date === null) {
      kept.push(match);
      continue;
    }
    const existing = kept.findIndex(
      (candidate) => candidate.date === match.date && candidate.foldedOpponent === match.foldedOpponent
    );
    if (existing === -1) {
      kept.push(match);
      continue;
    }
    merged += 1;
    const current = kept[existing];
    if (weight(match) > weight(current)) kept[existing] = match;
  }
  return { matches: kept, merged };
}

function weight(match: ReviewMatch): number {
  return (
    (match.hasFigures ? 8 : 0) +
    (match.concededMinutes.length + match.goalMinutes.length > 0 ? 4 : 0) +
    (match.formation !== null ? 2 : 0) +
    (match.contributions.length > 0 ? 1 : 0)
  );
}

function windowKey(matches: ReviewMatch[]): string {
  const dates = matches.map((match) => match.date).filter((date): date is string => date !== null);
  if (dates.length === 0) return `window:undated:${matches.length}`;
  const sorted = [...dates].sort();
  return `window:${sorted[0]}:${sorted[sorted.length - 1]}`;
}

/**
 * The window the review should read.
 *
 * A block request reads the block's five rows. A window request reads the newest per match debriefs, filtered by
 * date when a range is given, capped at the requested count with the floor applied. Mirrored block rows are
 * dropped before either, because the block is their source.
 */
export function buildWindow(input: WindowInput): WindowResult {
  const ownMatches = input.events.filter((event) => !isMirror(event)).map(matchFromEvent);
  const request = input.request;

  if (request.kind === "BLOCK") {
    const block = input.blocks.find((candidate) => candidate.id === request.blockId) ?? null;
    const rows = block === null
      ? []
      : block.matches
          .map((_, index) => matchFromBlockMatch(block, index))
          .filter((match): match is ReviewMatch => match !== null);
    return {
      matches: rows,
      merged: 0,
      key: block === null ? "block:missing" : block.id,
      window: {
        from: null,
        to: null,
        count: rows.length,
      },
      block,
    };
  }

  const count = Math.max(MIN_WINDOW_COUNT, Math.trunc(request.count ?? DEFAULT_WINDOW_COUNT));
  const from = request.from ?? null;
  const to = request.to ?? null;
  const inRange = ownMatches.filter((match) => {
    if (from !== null && (match.date === null || match.date < from)) return false;
    if (to !== null && (match.date === null || match.date > to)) return false;
    return true;
  });
  const sorted = [...inRange].sort(byDateDesc);
  const chosen = sorted.slice(0, count);
  const { matches, merged } = mergeDuplicates(chosen);
  const ordered = [...matches].sort(byDateDesc);
  return {
    matches: ordered,
    merged,
    key: windowKey(ordered),
    window: {
      from: from ?? ordered.map((match) => match.date).filter((date): date is string => date !== null).sort()[0] ?? null,
      to: to ?? ordered.map((match) => match.date).filter((date): date is string => date !== null).sort().at(-1) ?? null,
      count: ordered.length,
    },
    block: null,
  };
}

/**
 * How strong a finding is, from a count.
 *
 * Three bands and no percentages: a manager reading "SOLID" wants to know the sample is five matches, not that
 * some model is 82 percent sure of a sentence it wrote itself.
 */
export function strengthOf(sampleSize: number): Strength {
  if (sampleSize >= 5) return "SOLID";
  return sampleSize >= 3 ? "BUILDING" : "THIN";
}
