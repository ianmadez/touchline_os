/**
 * Mentor pairing: a senior first-teamer assigned to bring an academy prospect along.
 *
 * The save has no such concept, so this is entirely the manager's record. Each pairing is one
 * USER event with a deterministic id per prospect (a prospect has one mentor at a time), carrying the
 * prospect's figures on the day it began. That snapshot is what makes the pairing measurable: progress
 * is today's overall against the overall at pairing, never a guess at what the mentor contributed.
 *
 * Suggestions are a ranking, not a verdict, and every reason is shown. Ranked on:
 *   - same line of the pitch (a keeper mentors a keeper), with a bonus for the exact position;
 *   - ability, because a prospect learns from someone better than him;
 *   - experience, peaking around 30: old enough to have seen it, young enough to still be playing;
 *   - a HIGH trust marker (set by the manager or the praise pass);
 *   - load: each mentee he already has costs him, so one veteran is not handed the whole academy.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, players, playerUserProfiles, youthProspects } from "../db/schema";

export type PitchLine = "GK" | "DEF" | "MID" | "ATT";

const DEF = new Set(["CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB", "SW"]);
const MID = new Set(["CDM", "LDM", "RDM", "CM", "LCM", "RCM", "LM", "RM", "CAM", "LAM", "RAM"]);

export function pitchLine(position: string | null | undefined): PitchLine | null {
  const code = (position ?? "").toUpperCase();
  if (!code) return null;
  if (code === "GK") return "GK";
  if (DEF.has(code)) return "DEF";
  if (MID.has(code)) return "MID";
  if (["ST", "CF", "LF", "RF", "LW", "RW", "LS", "RS", "LST", "RST"].includes(code)) return "ATT";
  return null;
}

export interface MentorNote {
  at: string;
  text: string;
}

export interface Mentorship {
  prospectId: number;
  prospectName: string | null;
  mentorId: number;
  mentorName: string;
  pairedAt: string;
  atPairing: { overallRating: number | null; potentialRating: number | null };
  /** The prospect's overall today, from the academy or (once promoted) the squad. */
  currentOverall: number | null;
  /** currentOverall minus the overall at pairing, when both are known. */
  progress: number | null;
  notes: MentorNote[];
}

export interface MentorCandidate {
  playerId: number;
  name: string;
  primaryPosition: string;
  overallRating: number;
  age: number | null;
  score: number;
  /** Plain-language reasons, shown beside the suggestion. */
  reasons: string[];
  mentees: number;
}

interface SquadRow {
  eaPlayerId: number;
  name: string;
  primaryPosition: string;
  overallRating: number;
  age: number | null;
}

const MIN_MENTOR_AGE = 25;

/** Pure so it can be tested: ranks the squad as mentors for one prospect. */
export function rankMentors(
  prospect: { primaryPosition: string | null; overallRating: number | null },
  squad: readonly SquadRow[],
  menteeCount: ReadonlyMap<number, number>,
  trusted: ReadonlySet<number>,
  limit = 3
): MentorCandidate[] {
  const line = pitchLine(prospect.primaryPosition);
  const out: MentorCandidate[] = [];
  for (const player of squad) {
    if ((player.age ?? 0) < MIN_MENTOR_AGE) continue;
    const playerLine = pitchLine(player.primaryPosition);
    if (line !== null && playerLine !== line) continue;
    const reasons: string[] = [];
    let score = player.overallRating;

    const exact = (prospect.primaryPosition ?? "").toUpperCase() === player.primaryPosition.toUpperCase();
    if (exact) {
      score += 5;
      reasons.push(`Plays his position (${player.primaryPosition})`);
    } else if (playerLine) {
      reasons.push(`Same line (${playerLine})`);
    }

    if (prospect.overallRating !== null) {
      const gap = player.overallRating - prospect.overallRating;
      if (gap > 0) reasons.push(`${gap} rating points ahead of him`);
    }

    const age = player.age ?? MIN_MENTOR_AGE;
    // Experience peaks at 30 and tails off either side.
    const experience = Math.max(0, 6 - Math.abs(30 - age));
    score += experience;
    if (age >= 29) reasons.push(`Experienced head at ${age}`);

    if (trusted.has(player.eaPlayerId)) {
      score += 3;
      reasons.push("High trust");
    }

    const mentees = menteeCount.get(player.eaPlayerId) ?? 0;
    score -= mentees * 6;
    if (mentees > 0) reasons.push(`Already mentoring ${mentees}`);

    out.push({
      playerId: player.eaPlayerId,
      name: player.name,
      primaryPosition: player.primaryPosition,
      overallRating: player.overallRating,
      age: player.age,
      score,
      reasons,
      mentees,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.overallRating - a.overallRating).slice(0, limit);
}

export const mentorshipEventId = (careerId: string, prospectId: number): string =>
  `evt_youth_mentor_${careerId}_${prospectId}`;

interface StoredMentorship {
  prospectId: number;
  prospectName: string | null;
  mentorId: number;
  mentorName: string;
  pairedAt: string;
  atPairing: { overallRating: number | null; potentialRating: number | null };
  notes: MentorNote[];
}

export class MentorService {
  private async stored(careerId: string): Promise<StoredMentorship[]> {
    const rows = await db
      .select({ payloadJson: careerEvents.payloadJson })
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "YOUTH_MENTOR")));
    const out: StoredMentorship[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.payloadJson) as StoredMentorship);
      } catch {
        // An unreadable pairing is skipped rather than failing the whole academy.
      }
    }
    return out;
  }

  private async squad(careerId: string): Promise<SquadRow[]> {
    return db
      .select({
        eaPlayerId: players.eaPlayerId,
        name: players.name,
        primaryPosition: players.primaryPosition,
        overallRating: players.overallRating,
        age: players.age,
      })
      .from(players)
      .where(eq(players.careerId, careerId));
  }

  /** Current pairings plus the top suggestions for every academy prospect still without a mentor. */
  async overview(careerId: string): Promise<{ mentorships: Mentorship[]; suggestions: Record<number, MentorCandidate[]> }> {
    const [stored, squad, academy, profiles] = await Promise.all([
      this.stored(careerId),
      this.squad(careerId),
      db.select().from(youthProspects).where(eq(youthProspects.careerId, careerId)),
      db
        .select({ playerId: playerUserProfiles.playerId, trustLevel: playerUserProfiles.trustLevel })
        .from(playerUserProfiles)
        .where(eq(playerUserProfiles.careerId, careerId)),
    ]);

    const squadById = new Map(squad.map((row) => [row.eaPlayerId, row] as const));
    const academyById = new Map(academy.map((row) => [row.playerId, row] as const));
    const menteeCount = new Map<number, number>();
    for (const pair of stored) menteeCount.set(pair.mentorId, (menteeCount.get(pair.mentorId) ?? 0) + 1);
    const trusted = new Set(
      profiles
        .filter((p) => p.trustLevel === "HIGH")
        .map((p) => Number(p.playerId.slice(careerId.length + 1)))
        .filter(Number.isFinite)
    );

    const mentorships: Mentorship[] = stored
      .map((pair) => {
        const current = academyById.get(pair.prospectId)?.overallRating ?? squadById.get(pair.prospectId)?.overallRating ?? null;
        const before = pair.atPairing?.overallRating ?? null;
        return {
          ...pair,
          mentorName: squadById.get(pair.mentorId)?.name ?? pair.mentorName,
          currentOverall: current,
          progress: current !== null && before !== null ? current - before : null,
          notes: pair.notes ?? [],
        };
      })
      .sort((a, b) => b.pairedAt.localeCompare(a.pairedAt));

    const paired = new Set(stored.map((pair) => pair.prospectId));
    const academyIds = new Set(academy.map((row) => row.playerId));
    const eligibleSquad = squad.filter((row) => !academyIds.has(row.eaPlayerId));
    const suggestions: Record<number, MentorCandidate[]> = {};
    for (const prospect of academy) {
      if (paired.has(prospect.playerId)) continue;
      suggestions[prospect.playerId] = rankMentors(prospect, eligibleSquad, menteeCount, trusted);
    }
    return { mentorships, suggestions };
  }

  /** Pair (or re-pair) a prospect. Re-pairing restarts the clock and the baseline. */
  async pair(careerId: string, prospectId: number, mentorId: number): Promise<void> {
    const [prospect, mentor] = await Promise.all([
      db
        .select()
        .from(youthProspects)
        .where(and(eq(youthProspects.careerId, careerId), eq(youthProspects.playerId, prospectId)))
        .get(),
      db
        .select({ name: players.name })
        .from(players)
        .where(and(eq(players.careerId, careerId), eq(players.eaPlayerId, mentorId)))
        .get(),
    ]);
    if (!mentor) throw new Error("That mentor is not in your squad.");
    const payload: StoredMentorship = {
      prospectId,
      prospectName: prospect?.name ?? null,
      mentorId,
      mentorName: mentor.name,
      pairedAt: new Date().toISOString(),
      atPairing: { overallRating: prospect?.overallRating ?? null, potentialRating: prospect?.potentialRating ?? null },
      notes: [],
    };
    const payloadJson = JSON.stringify(payload);
    await db
      .insert(careerEvents)
      .values({
        id: mentorshipEventId(careerId, prospectId),
        careerId,
        eventType: "YOUTH_MENTOR",
        source: "USER",
        entityType: "PLAYER",
        entityId: String(prospectId),
        payloadJson,
        timestamp: payload.pairedAt,
      })
      .onConflictDoUpdate({ target: careerEvents.id, set: { payloadJson, timestamp: payload.pairedAt } });
  }

  async end(careerId: string, prospectId: number): Promise<void> {
    await db.delete(careerEvents).where(eq(careerEvents.id, mentorshipEventId(careerId, prospectId)));
  }

  /** A progress note on a pairing, newest last. Capped so a pairing cannot grow without bound. */
  async addNote(careerId: string, prospectId: number, text: string): Promise<void> {
    const id = mentorshipEventId(careerId, prospectId);
    const row = await db.select({ payloadJson: careerEvents.payloadJson }).from(careerEvents).where(eq(careerEvents.id, id)).get();
    if (!row) throw new Error("He has no mentor to write a note against.");
    const pair = JSON.parse(row.payloadJson) as StoredMentorship;
    pair.notes = [...(pair.notes ?? []), { at: new Date().toISOString(), text: text.slice(0, 280) }].slice(-20);
    await db.update(careerEvents).set({ payloadJson: JSON.stringify(pair) }).where(eq(careerEvents.id, id));
  }
}
