import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { careerEvents } from "@/lib/db/schema";
import { CareerService } from "@/lib/services/career-service";
import { MatchContribution } from "@/lib/events/types";
import crypto from "crypto";

export const runtime = "nodejs";

export interface MatchDebriefPayload {
  careerId: string;
  opponent: string;
  homeScore: number;
  awayScore: number;
  venue: "HOME" | "AWAY" | "NEUTRAL";
  competition: string;
  tacticalAdherence: number; // 1 - 5
  /** One or more standout performers (replaces the earlier single-standout field). */
  standoutPlayerIds?: string[];
  standoutPlayerNames?: string[];
  /** Manager-logged goals and assists. There is no save-side match data to reconcile against. */
  contributions?: MatchContribution[];
  weaknessIdentified: string;
  managerReflection: string;
  /**
   * The in-game date the match was played, as the manager records it. Deliberately separate from
   * the event's own timestamp: that is when the debrief was written, which is a different thing and
   * often days later.
   */
  matchDate?: string | null;
  /** The club faced, when picked from the manager's own division. Null for a cup or friendly. */
  opponentTeamId?: number | null;
  /**
   * Where the two clubs stood in the league when they met.
   *
   * All four values are USER provenance, and that is not a limitation to work around - it is the
   * only possible source. The save zeroes points and results for **every** club in the manager's
   * own division, so a rival's record cannot be parsed from the file at all. The manager reading it
   * off the league screen is the measurement. Nothing downstream may present these as save facts.
   */
  leagueSnapshot?: {
    opponentPosition?: number | null;
    opponentPoints?: number | null;
    ownPosition?: number | null;
    ownPoints?: number | null;
  };
}

/** Truncates anything number-like to an integer, and turns blanks/garbage into null rather than 0. */
function asInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Accepts only a plain `YYYY-MM-DD`; anything else is treated as not recorded. */
function asMatchDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * POST /api/debrief
 * Writes a structured MATCH_DEBRIEF event into career_events table.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MatchDebriefPayload;

    if (!body.careerId || !body.opponent || typeof body.homeScore !== "number" || typeof body.awayScore !== "number") {
      return NextResponse.json(
        { success: false, error: "Missing required debrief fields (careerId, opponent, scores)." },
        { status: 400 }
      );
    }

    const eventId = `evt_debrief_${crypto.randomUUID()}`;

    // Normalise the manager-logged squad detail. Rows with neither a goal nor an assist are
    // dropped rather than stored as empty noise, and negative/hostile numbers are clamped.
    const standoutPlayerIds = (Array.isArray(body.standoutPlayerIds) ? body.standoutPlayerIds : [])
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const standoutPlayerNames = (Array.isArray(body.standoutPlayerNames) ? body.standoutPlayerNames : [])
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    const contributions: MatchContribution[] = (
      Array.isArray(body.contributions) ? body.contributions : []
    )
      .filter((entry) => entry && typeof entry.playerId === "string" && entry.playerId.length > 0)
      .map((entry) => ({
        playerId: entry.playerId,
        playerName: entry.playerName || "Unknown player",
        goals: Math.max(0, Math.floor(Number(entry.goals) || 0)),
        assists: Math.max(0, Math.floor(Number(entry.assists) || 0)),
      }))
      .filter((entry) => entry.goals > 0 || entry.assists > 0);

    // Surfaced so the debrief UI (and later analytics) can show whether the manager accounted for
    // every goal, without pretending the two figures came from the same source.
    const goalsLogged = contributions.reduce((sum, entry) => sum + entry.goals, 0);

    const payloadJson = JSON.stringify({
      opponent: body.opponent,
      scoreline: `${body.homeScore} - ${body.awayScore}`,
      homeScore: body.homeScore,
      awayScore: body.awayScore,
      venue: body.venue,
      competition: body.competition || "League",
      tacticalAdherence: body.tacticalAdherence || 3,
      standoutPlayerIds,
      standoutPlayerNames,
      contributions,
      goalsLogged,
      unloggedGoals: Math.max(0, body.homeScore - goalsLogged),
      weaknessIdentified: body.weaknessIdentified || "",
      managerReflection: body.managerReflection || "",
      result: body.homeScore > body.awayScore ? "WIN" : body.homeScore < body.awayScore ? "LOSS" : "DRAW",
      matchDate: asMatchDate(body.matchDate),
      opponentTeamId: asInt(body.opponentTeamId),
      // Grouped rather than flattened so a reader can see at a glance that these four came in
      // together, from one observation of the league table, and are not save data.
      leagueSnapshot: {
        opponentPosition: asInt(body.leagueSnapshot?.opponentPosition),
        opponentPoints: asInt(body.leagueSnapshot?.opponentPoints),
        ownPosition: asInt(body.leagueSnapshot?.ownPosition),
        ownPoints: asInt(body.leagueSnapshot?.ownPoints),
      },
    });

    await db.insert(careerEvents).values({
      id: eventId,
      careerId: body.careerId,
      eventType: "MATCH_DEBRIEF",
      source: "USER",
      entityType: "MATCH",
      entityId: `match_${Date.now()}`,
      payloadJson,
      timestamp: new Date().toISOString(),
    });

    const careerService = new CareerService();
    const updatedPayload = await careerService.hydrate(body.careerId);

    return NextResponse.json({
      success: true,
      message: "Match debrief logged successfully.",
      ...updatedPayload,
    });
  } catch (error) {
    console.error("[api/debrief] Failed to log match debrief:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Failed to save debrief." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/debrief?id=...&careerId=...
 *
 * Removes one match debrief. Deliberately narrow: it will only ever delete a row that is both a
 * `MATCH_DEBRIEF` and USER-sourced, so a stale id or a crafted request cannot take out a career
 * transition from the spine. Deleting a debrief is a correction of something the manager typed, and
 * the rest of the timeline is not theirs to erase.
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const careerId = url.searchParams.get("careerId");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "A debrief id is required." },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(careerEvents)
      .where(
        and(
          eq(careerEvents.id, id),
          eq(careerEvents.eventType, "MATCH_DEBRIEF"),
          eq(careerEvents.source, "USER")
        )
      )
      .returning({ id: careerEvents.id, careerId: careerEvents.careerId });

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "That debrief no longer exists." },
        { status: 404 }
      );
    }

    // Re-hydrate so the caller gets the same shape it gets from every other write, rather than
    // having to guess what the timeline looks like now.
    const targetCareer = careerId ?? deleted[0].careerId;
    const careerService = new CareerService();
    const updatedPayload = await careerService.hydrate(targetCareer);

    return NextResponse.json({
      success: true,
      message: "Debrief deleted.",
      ...updatedPayload,
    });
  } catch (error) {
    console.error("[api/debrief] Failed to delete match debrief:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Failed to delete debrief." },
      { status: 500 }
    );
  }
}