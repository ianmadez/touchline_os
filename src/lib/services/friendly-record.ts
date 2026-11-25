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
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, careers } from "../db/schema";
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
export async function seasonLogThisSeason(careerId: string): Promise<{ friendlies: FriendlyRecord; logged: number }> {
  const career = await db.select({ inGameDate: careers.inGameDate }).from(careers).where(eq(careers.id, careerId)).get();
  const rows = await db
    .select({ payloadJson: careerEvents.payloadJson })
    .from(careerEvents)
    .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")));
  const payloads = rows.map((row) => row.payloadJson);
  const start = seasonStartFor(career?.inGameDate ?? null);
  return { friendlies: tallyFriendlies(payloads, start), logged: countLoggedThisSeason(payloads, start) };
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

/** The save's figure with declared friendlies taken out, never below zero. */
export function withoutFriendlies(saveValue: number, friendlyValue: number): number {
  return Math.max(0, saveValue - friendlyValue);
}
