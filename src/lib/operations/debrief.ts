import { CareerService } from "../services/career-service";
import { SeasonService } from "../services/season-service";
import { EventService } from "../services/event-service";
import { CompetitionService } from "../services/competition-service";
import { mediaAskFor } from "../news/media";
import { db } from "../db/client";
import { careerEvents, debriefMarks } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { MatchContribution } from "../events/types";
import { normaliseMatchStats, type MatchStats } from "../events/match-stats";
import { at, failed, ok, type OperationResult } from "./types";

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
   * The anomaly prompts the manager answered.
   *
   * The debrief screen already sends these; persisting them is what lets the season digest show
   * what the manager said in answer to a prompt. Omitting the field here silently dropped them.
   */
  dynamicPrompts?: Array<{ id?: string; question?: string; answer?: string }>;
  /**
   * When our goals went in, in match minutes, and when theirs did.
   *
   * Optional, and sparse by design: a goal the manager does not time is simply absent, never stored as
   * zero. These are what let a report say a match was won late rather than only that it was won.
   */
  goalMinutes?: number[] | null;
  concededMinutes?: number[] | null;
  /**
   * What the manager observed after the match: shots, shots inside the box, big chances, possession and
   * passes completed, plus the game's own expected goals when he read it off the Match Facts screen.
   *
   * Stored as entered and nothing else. Expected goals and the finishing figure are worked out on read,
   * from the shared model in `events/match-stats`, so a tweak to a weight cannot leave a stored figure
   * contradicting the one the screen now shows. The reported figure is the exception and is stored,
   * because it is an observation rather than a derivation: the game's number cannot be recomputed from
   * anything the app holds.
   *
   * Provenance stays USER either way. A scanned figure is the manager photographing what the game told
   * him and accepting it, which is his record of what he saw, not the app's read of a save file. The
   * optional `capture` marker records only the method, and its absence means the manager typed it.
   */
  matchStats?: MatchStats | null;
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

/** The manager-logged squad detail, normalised once so an edit cannot drift from a first save. */
interface NormalisedDebrief {
  standoutPlayerIds: string[];
  standoutPlayerNames: string[];
  contributions: MatchContribution[];
  dynamicPrompts: Array<{ id: string; question: string; answer: string }>;
  goalMinutes: number[];
  concededMinutes: number[];
  matchStats: MatchStats | null;
}

/**
 * The longest a match can run, including stoppage.
 *
 * A minute outside this is not a football time, so it is discarded rather than clamped: clamping a
 * typed 900 into the 130th minute would invent a goal time the manager never gave.
 */
const MAX_MATCH_MINUTE = 130;

/**
 * Match minutes, cleaned.
 *
 * Blanks and rubbish are dropped, duplicates collapse, and the list comes back ascending, because a
 * set of goal times is read in the order the goals happened whatever order they were typed in.
 */
function minutesOf(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const minutes = new Set<number>();
  for (const entry of value) {
    const minute = Math.trunc(Number(entry));
    if (!Number.isFinite(minute) || minute < 1 || minute > MAX_MATCH_MINUTE) continue;
    minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

/**
 * Normalises the manager-logged squad detail.
 *
 * Rows with neither a goal nor an assist are dropped rather than stored as empty noise, negative and
 * hostile numbers are clamped, and an unanswered prompt is dropped rather than stored blank, which is
 * how the season digest reads them.
 */
function normaliseDebrief(body: MatchDebriefPayload): NormalisedDebrief {
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
  const dynamicPrompts = (Array.isArray(body.dynamicPrompts) ? body.dynamicPrompts : [])
    .filter(
      (prompt): prompt is { id?: string; question: string; answer: string } =>
        Boolean(prompt) &&
        typeof prompt.question === "string" &&
        typeof prompt.answer === "string"
    )
    .map((prompt) => ({
      id: typeof prompt.id === "string" ? prompt.id : "",
      question: prompt.question.trim(),
      answer: prompt.answer.trim(),
    }))
    .filter((prompt) => prompt.question.length > 0 && prompt.answer.length > 0);
  const goalMinutes = minutesOf(body.goalMinutes);
  const concededMinutes = minutesOf(body.concededMinutes);
  const matchStats = normaliseMatchStats(body.matchStats);
  return { standoutPlayerIds, standoutPlayerNames, contributions, dynamicPrompts, goalMinutes, concededMinutes, matchStats };
}

/**
 * The stored payload.
 *
 * Shared between logging and editing on purpose: an edit that assembled its own payload could
 * quietly write a different shape from a first save, which every reader would then have to tolerate.
 */
function composeDebriefPayload(body: MatchDebriefPayload, normalised: NormalisedDebrief): string {
  const goalsLogged = normalised.contributions.reduce((sum, entry) => sum + entry.goals, 0);
  return JSON.stringify({
    opponent: body.opponent,
    scoreline: `${body.homeScore} - ${body.awayScore}`,
    homeScore: body.homeScore,
    awayScore: body.awayScore,
    venue: body.venue,
    competition: body.competition || "League",
    tacticalAdherence: body.tacticalAdherence || 3,
    standoutPlayerIds: normalised.standoutPlayerIds,
    standoutPlayerNames: normalised.standoutPlayerNames,
    contributions: normalised.contributions,
    // Surfaced so the debrief UI (and later analytics) can show whether the manager accounted for
    // every goal, without pretending the two figures came from the same source.
    goalsLogged,
    unloggedGoals: Math.max(0, body.homeScore - goalsLogged),
    weaknessIdentified: body.weaknessIdentified || "",
    managerReflection: body.managerReflection || "",
    dynamicPrompts: normalised.dynamicPrompts,
    goalMinutes: normalised.goalMinutes,
    concededMinutes: normalised.concededMinutes,
    matchStats: normalised.matchStats,
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
}

/**
 * The debriefs the manager starred.
 *
 * Returned as a plain list of event ids, because that is all the screen needs: the debriefs themselves come
 * from the career hydrate, and a star is a fact about one of them.
 */
export async function readDebriefMarks(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) return at(400, { success: false, error: "careerId is required." });

  try {
    const rows = await db
      .select({ eventId: debriefMarks.eventId })
      .from(debriefMarks)
      .where(eq(debriefMarks.careerId, careerId));
    return ok({ success: true, eventIds: rows.map((row) => row.eventId) });
  } catch (error) {
    console.error("[api/debrief-marks] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your starred debriefs.");
  }
}

/**
 * Stars or unstars one debrief.
 *
 * A row IS the star, so starring inserts and unstarring deletes. The event id is checked against the spine
 * first: a star that pointed at nothing would show as a memorable match with no match behind it.
 */
export async function setDebriefStar(rawBody: string): Promise<OperationResult<unknown>> {
  let body: { careerId?: string; eventId?: string; starred?: boolean };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  const { careerId, eventId, starred } = body;
  if (!careerId || !eventId || typeof starred !== "boolean") {
    return at(400, { success: false, error: "careerId, eventId and starred are required." });
  }

  try {
    if (starred) {
      const found = await db
        .select({ id: careerEvents.id })
        .from(careerEvents)
        .where(and(eq(careerEvents.id, eventId), eq(careerEvents.careerId, careerId)));
      if (found.length === 0) {
        return at(404, { success: false, error: "That debrief no longer exists." });
      }
      await db
        .insert(debriefMarks)
        .values({ id: `${careerId}_${eventId}`, careerId, eventId, createdAt: new Date().toISOString() })
        .onConflictDoNothing();
    } else {
      await db
        .delete(debriefMarks)
        .where(and(eq(debriefMarks.careerId, careerId), eq(debriefMarks.eventId, eventId)));
    }
    return ok({ success: true, eventId, starred });
  } catch (error) {
    console.error("[api/debrief-marks] write failed:", error);
    return failed(500, (error as Error).message ?? "Could not change that star.");
  }
}

/**
 * Writes a structured MATCH_DEBRIEF event into career_events.
 *
 * Takes the raw body text rather than a parsed object because the route parsed it inside its own
 * `try`, so a body that is not JSON produced a 500 rather than a 400. Parsing here keeps that.
 */
export async function logMatchDebrief(rawBody: string): Promise<OperationResult<unknown>> {
  // Parsed in its own guard, BEFORE the main `try`, so a body that is not JSON is the caller's 400.
  //
  // The comment above promises exactly this and the code did not deliver it: every `SyntaxError` fell
  // into the catch below and came back as a 500, which made "you sent nonsense" indistinguishable
  // from "the server is broken". Doing it here rather than by testing `instanceof SyntaxError` in the
  // outer catch matters - that would also swallow a `SyntaxError` thrown by something INTERNAL, and
  // report our own bug as the caller's mistake.
  let body: MatchDebriefPayload;
  try {
    body = JSON.parse(rawBody) as MatchDebriefPayload;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    if (!body.careerId || !body.opponent || typeof body.homeScore !== "number" || typeof body.awayScore !== "number") {
      return at(400, { success: false, error: "Missing required debrief fields (careerId, opponent, scores)." });
    }

    const eventId = `evt_debrief_${crypto.randomUUID()}`;
    const normalised = normaliseDebrief(body);
    const payloadJson = composeDebriefPayload(body, normalised);

    await new EventService().appendEvent({
      id: eventId,
      careerId: body.careerId,
      eventType: "MATCH_DEBRIEF",
      source: "USER",
      entityType: "MATCH",
      entityId: `match_${Date.now()}`,
      payloadJson,
      timestamp: new Date().toISOString(),
    });

    const seasonService = new SeasonService();
    await seasonService.recordMatchdayProgress(body.careerId);

    const careerService = new CareerService();
    const updatedPayload = await careerService.hydrate(body.careerId);

    // Whether the press room comes looking, worked out here rather than in the screen: the trigger is a
    // property of the match, and the screen has no business deciding what is newsworthy. The prompt is
    // only offered when the answer is yes, and both the answer and the reason are returned so the screen
    // has nothing to guess.
    //
    // The context is what makes the QUESTION worth asking. A reporter in a room asks about the scorers, the
    // competition and the minute it turned, so all three are passed in: without them the prompt can only
    // ever be a generic one, which is how the first version ended up reading like a notification.
    const pressContext = await new CompetitionService().getContext(body.careerId);
    const media = mediaAskFor(eventId, {
      opponent: body.opponent,
      ourScore: body.homeScore,
      theirScore: body.awayScore,
      goalMinutes: normalised.goalMinutes,
      concededMinutes: normalised.concededMinutes,
      competition: typeof body.competition === "string" ? body.competition : null,
      venue: typeof body.venue === "string" ? body.venue : null,
      scorers: (body.contributions ?? [])
        .filter((entry) => (entry.goals ?? 0) > 0)
        .sort((left, right) => (right.goals ?? 0) - (left.goals ?? 0))
        .map((entry) => entry.playerName),
      clubName: updatedPayload?.clubName ?? undefined,
      countryId: pressContext?.countryId ?? null,
    });

    return ok({
      success: true,
      message: "Match debrief logged successfully.",
      eventId,
      media,
      ...updatedPayload,
    });
  } catch (error) {
    console.error("[api/debrief] Failed to log match debrief:", error);
    return failed(500, (error as Error).message ?? "Failed to save debrief.");
  }
}

/**
 * Edits one match debrief in place.
 *
 * In place rather than delete and re-create: the event id is what the debrief list, the delete
 * button and the season digest all key on, so a replacement row would make an edit read as a new
 * match and would move the debrief in the timeline. Only the payload is rewritten, so the record's
 * own timestamp still says when it was first written.
 */
export async function updateDebrief(
  id: string | null,
  rawBody: string
): Promise<OperationResult<unknown>> {
  if (!id) return at(400, { success: false, error: "Missing debrief id." });

  let body: MatchDebriefPayload;
  try {
    body = JSON.parse(rawBody) as MatchDebriefPayload;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  try {
    if (!body.careerId || !body.opponent || typeof body.homeScore !== "number" || typeof body.awayScore !== "number") {
      return at(400, { success: false, error: "Missing required debrief fields (careerId, opponent, scores)." });
    }

    const updated = await new EventService().updateUserDebrief(
      id,
      composeDebriefPayload(body, normaliseDebrief(body))
    );

    if (updated.length === 0) {
      return at(404, { success: false, error: "That debrief no longer exists." });
    }

    // Re-hydrate so the caller gets the same shape it gets from every other write, rather than
    // having to guess what the timeline looks like now.
    const seasonService = new SeasonService();
    await seasonService.recordMatchdayProgress(body.careerId);

    const careerService = new CareerService();
    const updatedPayload = await careerService.hydrate(body.careerId);

    return ok({
      success: true,
      message: "Match debrief updated.",
      ...updatedPayload,
    });
  } catch (error) {
    console.error("[api/debrief] Failed to update match debrief:", error);
    return failed(500, (error as Error).message ?? "Failed to update debrief.");
  }
}

/**
 * Removes one match debrief. Deliberately narrow: it will only ever delete a row that is both a
 * `MATCH_DEBRIEF` and USER-sourced, so a stale id or a crafted request cannot take out a career
 * transition from the spine. Deleting a debrief is a correction of something the manager typed, and
 * the rest of the timeline is not theirs to erase.
 */
export async function deleteDebrief(
  id: string | null,
  careerId: string | null
): Promise<OperationResult<unknown>> {
  try {
    if (!id) {
      return at(400, { success: false, error: "A debrief id is required." });
    }

    const deleted = await new EventService().deleteUserDebrief(id);

    if (deleted.length === 0) {
      return at(404, { success: false, error: "That debrief no longer exists." });
    }

    // Re-hydrate so the caller gets the same shape it gets from every other write, rather than
    // having to guess what the timeline looks like now.
    const targetCareer = careerId ?? deleted[0].careerId;
    const seasonService = new SeasonService();
    await seasonService.recordMatchdayProgress(targetCareer);

    const careerService = new CareerService();
    const updatedPayload = await careerService.hydrate(targetCareer);

    return ok({
      success: true,
      message: "Debrief deleted.",
      ...updatedPayload,
    });
  } catch (error) {
    console.error("[api/debrief] Failed to delete match debrief:", error);
    return failed(500, (error as Error).message ?? "Failed to delete debrief.");
  }
}
