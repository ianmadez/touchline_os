/**
 * The head-to-head record, built from the manager's own debriefs.
 *
 * This is the one part of a club's history that the save cannot supply at all. The game records no fixtures
 * and no results for the manager's own division, so every meeting in here exists because he wrote it up.
 * The screen says so, because a head-to-head table that looks like save data would be a lie about where the
 * numbers came from.
 *
 * "Everywhere it has been faced" is the rule: a meeting counts whatever competition it was in, and the
 * competition is carried on the meeting so the screen can filter by it. A club met in the league and in the
 * cup appears in both, and the totals say which is which.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { careerEvents } from "../db/schema";

export interface HeadToHeadMeeting {
  /** The debrief it came from, so the screen can open the record itself. */
  eventId: string;
  matchDate: string | null;
  competition: string | null;
  venue: string | null;
  /** Our goals first, always. */
  goalsFor: number;
  goalsAgainst: number;
  result: "WIN" | "DRAW" | "LOSS";
  scoreline: string;
}

export interface HeadToHeadOpponent {
  opponent: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** The biggest winning margin, or null when he has never beaten them. */
  biggestWin: string | null;
  /** Consecutive meetings without defeat, counting the most recent run backwards. */
  longestUnbeaten: number;
  /** Every competition these two have met in, in the order they first met there. */
  competitions: string[];
  /** Newest first. */
  meetings: HeadToHeadMeeting[];
}

export interface HeadToHeadRecord {
  careerId: string;
  opponents: HeadToHeadOpponent[];
  /** Every competition a debrief has been logged under, for the filter. */
  competitions: string[];
  totals: {
    opponents: number;
    meetings: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  /** True when there is not a single debrief to build from, so the screen can explain itself. */
  empty: boolean;
}

export class HeadToHeadService {
  async getRecord(careerId: string): Promise<HeadToHeadRecord> {
    const rows = await db
      .select()
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "MATCH_DEBRIEF")));

    const byOpponent = new Map<string, { opponent: string; meetings: HeadToHeadMeeting[] }>();

    for (const row of rows) {
      const payload = safeParse(row.payloadJson);
      const opponent = typeof payload.opponent === "string" ? payload.opponent.trim() : "";
      if (opponent.length === 0) continue;

      const scoreline = typeof payload.scoreline === "string" ? payload.scoreline : "";
      const numbers = scoreline.match(/\d+/g);
      if (!numbers || numbers.length < 2) continue;
      // Ours first, which is the convention the debrief itself stores and the season digest reads.
      const goalsFor = Number(numbers[0]);
      const goalsAgainst = Number(numbers[1]);
      const result: HeadToHeadMeeting["result"] =
        goalsFor > goalsAgainst ? "WIN" : goalsFor < goalsAgainst ? "LOSS" : "DRAW";

      const meeting: HeadToHeadMeeting = {
        eventId: row.id,
        matchDate: typeof payload.matchDate === "string" ? payload.matchDate : null,
        competition: typeof payload.competition === "string" && payload.competition.length > 0
          ? payload.competition
          : null,
        venue: typeof payload.venue === "string" ? payload.venue : null,
        goalsFor,
        goalsAgainst,
        result,
        scoreline: `${goalsFor}-${goalsAgainst}`,
      };

      const key = opponent.toLowerCase();
      const existing = byOpponent.get(key);
      if (existing) existing.meetings.push(meeting);
      else byOpponent.set(key, { opponent, meetings: [meeting] });
    }

    const opponents: HeadToHeadOpponent[] = [];
    for (const entry of byOpponent.values()) {
      const meetings = entry.meetings;
      // Newest first everywhere else in the app, and here too: the most recent meeting is the one a
      // manager is looking for. The undated ones go last rather than being dropped.
      const ordered = [...meetings].sort((left, right) => {
        if (left.matchDate === null && right.matchDate === null) return 0;
        if (left.matchDate === null) return 1;
        if (right.matchDate === null) return -1;
        return right.matchDate.localeCompare(left.matchDate);
      });

      const wins = ordered.filter((meeting) => meeting.result === "WIN").length;
      const draws = ordered.filter((meeting) => meeting.result === "DRAW").length;
      const losses = ordered.filter((meeting) => meeting.result === "LOSS").length;
      const goalsFor = ordered.reduce((total, meeting) => total + meeting.goalsFor, 0);
      const goalsAgainst = ordered.reduce((total, meeting) => total + meeting.goalsAgainst, 0);

      const winsByMargin = ordered
        .filter((meeting) => meeting.result === "WIN")
        .sort(
          (left, right) =>
            right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst)
        );
      const best = winsByMargin[0] ?? null;

      let longestUnbeaten = 0;
      for (const meeting of ordered) {
        if (meeting.result === "LOSS") break;
        longestUnbeaten += 1;
      }

      const competitions: string[] = [];
      for (const meeting of ordered) {
        const name = meeting.competition ?? "Unrecorded";
        if (!competitions.includes(name)) competitions.push(name);
      }

      opponents.push({
        opponent: entry.opponent,
        played: ordered.length,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
        biggestWin: best ? `${best.scoreline}${best.venue ? ` (${best.venue.toLowerCase()})` : ""}` : null,
        longestUnbeaten,
        competitions,
        meetings: ordered,
      });
    }

    const competitions: string[] = [];
    for (const opponent of opponents) {
      for (const name of opponent.competitions) {
        if (!competitions.includes(name)) competitions.push(name);
      }
    }
    competitions.sort((left, right) => left.localeCompare(right));

    opponents.sort((left, right) => left.opponent.localeCompare(right.opponent));

    return {
      careerId,
      opponents,
      competitions,
      totals: {
        opponents: opponents.length,
        meetings: opponents.reduce((total, entry) => total + entry.played, 0),
        wins: opponents.reduce((total, entry) => total + entry.wins, 0),
        draws: opponents.reduce((total, entry) => total + entry.draws, 0),
        losses: opponents.reduce((total, entry) => total + entry.losses, 0),
        goalsFor: opponents.reduce((total, entry) => total + entry.goalsFor, 0),
        goalsAgainst: opponents.reduce((total, entry) => total + entry.goalsAgainst, 0),
      },
      empty: opponents.length === 0,
    };
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
