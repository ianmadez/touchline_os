/**
 * Pre-season friendlies the manager has declared, for the season in progress.
 *
 * Why this exists: the save's season record (`career_managerhistory`) counts EVERY match the club
 * played, and that includes pre-season friendlies. A manager three friendlies into July was being told
 * he had "played 3 matches" as if the league had started. The save keeps no per-match competition we
 * can tie to the club reliably (the `mlop` fixture ledger is keyed by slot, not team), so the only
 * trustworthy source is the manager: a debrief logged with the friendly competition.
 *
 * The record returned here is subtracted from the save's figures wherever they stand in for
 * competitive progress. It never touches the save's own numbers on disk.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, careers, playerMatchRatings } from "../db/schema";
import { inSeason, seasonStartFor } from "../squad/season-scope";

/** Matches the competition names a friendly can carry, including the stock "Friendly / Pre-season". */
export function isFriendlyCompetition(competition: unknown): boolean {
  return typeof competition === "string" && /friendl|pre-?\s?season/i.test(competition);
}

export interface FriendlyRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** What the save would have credited them with, on its usual 3-1-0. */
  points: number;
}

export const NO_FRIENDLIES: FriendlyRecord = {
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  points: 0,
};

/**
 * Pure tally, so it can be tested without a database.
 *
 * A debrief with no match date counts toward the current season: it was almost always logged straight
 * after the match, and dropping it would bring back the exact miscount this exists to fix.
 */
export function tallyFriendlies(payloads: readonly string[], seasonStart: string | null): FriendlyRecord {
  const record = { ...NO_FRIENDLIES };
  for (const raw of payloads) {
    let parsed: { competition?: unknown; homeScore?: unknown; awayScore?: unknown; matchDate?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isFriendlyCompetition(parsed.competition)) continue;
    const date = typeof parsed.matchDate === "string" && parsed.matchDate ? parsed.matchDate : null;
    if (date !== null && !inSeason(date, seasonStart)) continue;
    const ours = Number(parsed.homeScore);
    const theirs = Number(parsed.awayScore);
    if (!Number.isFinite(ours) || !Number.isFinite(theirs)) continue;

    record.played++;
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

/** Debriefs logged for the season in progress, any competition. Undated ones count, as above. */
export function countLoggedThisSeason(payloads: readonly string[], seasonStart: string | null): number {
  let count = 0;
  for (const raw of payloads) {
    try {
      const parsed = JSON.parse(raw) as { matchDate?: unknown };
      const date = typeof parsed.matchDate === "string" && parsed.matchDate ? parsed.matchDate : null;
      if (date === null || inSeason(date, seasonStart)) count++;
    } catch {
      // unreadable payloads are not matches
    }
  }
  return count;
}

/** This season's declared friendlies plus how many matches in total have a debrief. */
export async function seasonLogThisSeason(
  careerId: string
): Promise<{ friendlies: FriendlyRecord; logged: number; unlogged: UnloggedReport }> {
  const career = await db.select({ inGameDate: careers.inGameDate }).from(careers).where(eq(careers.id, careerId)).get();
  const rows = await db
    .select({ payloadJson: careerEvents.payloadJson })
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")));
  const payloads = rows.map((row) => row.payloadJson);
  const start = seasonStartFor(career?.inGameDate ?? null);
  const startNumber = start ? Number(start.replaceAll("-", "")) : 0;
  const ratingDates = await db
    .selectDistinct({ date: playerMatchRatings.date })
    .from(playerMatchRatings)
    .where(and(eq(playerMatchRatings.careerId, careerId), gte(playerMatchRatings.date, startNumber)));
  const toIso = (n: number) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;
  const debriefDates: string[] = [];
  for (const raw of payloads) {
    try {
      const date = (JSON.parse(raw) as { matchDate?: unknown }).matchDate;
      if (typeof date === "string" && date && (start === null || date >= start)) debriefDates.push(date.slice(0, 10));
    } catch {
      // unreadable payloads are not matches
    }
  }
  return {
    friendlies: tallyFriendlies(payloads, start),
    logged: countLoggedThisSeason(payloads, start),
    unlogged: findUnloggedMatches(ratingDates.map((row) => toIso(row.date)), debriefDates),
  };
}

export async function friendlyRecordThisSeason(careerId: string): Promise<FriendlyRecord> {
  const career = await db.select({ inGameDate: careers.inGameDate }).from(careers).where(eq(careers.id, careerId)).get();
  const rows = await db
    .select({ payloadJson: careerEvents.payloadJson })
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")));
  return tallyFriendlies(
    rows.map((row) => row.payloadJson),
    seasonStartFor(career?.inGameDate ?? null)
  );
}

/**
 * When the manager started using TouchlineOS on this career: the match date of the first debrief he
 * ever WROTE (by when it was written, not when it was played). Matches dated before it are history
 * filled in after the fact. Null when nothing dated has been logged.
 */
export function loggingStartedOn(rows: readonly { timestamp: string; payloadJson: string }[]): string | null {
  const first = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
  if (!first) return null;
  try {
    const date = (JSON.parse(first.payloadJson) as { matchDate?: unknown }).matchDate;
    return typeof date === "string" && date ? date.slice(0, 10) : null;
  } catch {
    return null;
  }
}

/** The save's figure with declared friendlies taken out, never below zero. */
export function withoutFriendlies(saveValue: number, friendlyValue: number): number {
  return Math.max(0, saveValue - friendlyValue);
}

export interface UnloggedReport {
  /** Save match dates (YYYY-MM-DD) since the manager started logging this season that have no debrief. */
  missing: string[];
  /** Save matches before the first debrief of the season: history, summarised rather than nagged about. */
  beforeLogging: number;
  /** Unlogged July matches, which are pre-season friendlies in an August-to-May season. */
  likelyPreseason: string[];
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/**
 * Which of the save's matches this season still need a debrief.
 *
 * The save's own per-player rating history carries the date of every match, so this works from real
 * fixtures rather than a bare count. A debrief "covers" a save match when its date is within a day of it
 * (a manager often types the day he played rather than the in-game kick-off day); each debrief covers at
 * most one match. Only matches from the manager's first debrief onwards are reported as missing: asking
 * him to reconstruct twenty games he played before he ever opened the app helps nobody.
 */
export function findUnloggedMatches(saveDates: readonly string[], debriefDates: readonly string[]): UnloggedReport {
  const dates = [...new Set(saveDates)].sort();
  const pool = debriefDates.filter(Boolean).map(dayNumber).sort((a, b) => a - b);
  const unmatched: string[] = [];
  for (const date of dates) {
    const day = dayNumber(date);
    const hit = pool.findIndex((d) => Math.abs(d - day) <= 1);
    if (hit >= 0) pool.splice(hit, 1);
    else unmatched.push(date);
  }
  const likelyPreseason = unmatched.filter((date) => date.slice(5, 7) === "07");
  const firstLogged = debriefDates.filter(Boolean).sort()[0] ?? null;
  if (firstLogged === null) {
    // Nothing logged yet this season: nothing to measure a gap against, so no list to nag with.
    return { missing: [], beforeLogging: unmatched.length - likelyPreseason.length, likelyPreseason };
  }
  const startDay = dayNumber(firstLogged) - 1;
  const competitive = unmatched.filter((date) => !likelyPreseason.includes(date));
  return {
    missing: competitive.filter((date) => dayNumber(date) >= startDay),
    beforeLogging: competitive.filter((date) => dayNumber(date) < startDay).length,
    likelyPreseason,
  };
}
