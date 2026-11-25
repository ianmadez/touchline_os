/**
 * The manager's academy, read back out of the database.
 *
 * The only judgement this module makes is ORDER, and it is deliberately not a rating. It sorts on
 * potential first, because an academy is about ceilings rather than current ability, and a 15-year-old
 * at 50 overall with 95 potential is the whole point of having one. Prospects the save cannot rate fall
 * to the bottom instead of being dropped - the same rule the scouting list applies to players it cannot
 * value.
 *
 * Everything it returns is a SAVE fact. The ranges are not estimates: they are the disagreement
 * between the save's own repeated assessments of the same prospect, which is why they are carried as
 * ranges and why `assessmentCount` travels with them.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, playerMatchRatings, players, playerUserProfiles, youthProspects, type YouthProspectEntry } from "../db/schema";

/** How a prospect came to be marked as promoted: read off the save, or the manager's own Promote. */
export interface Promotion {
  source: "SAVE" | "USER";
  /** When we recorded it (real time), not an in-game date. */
  recordedAt: string;
}

/** A former academy player now in the first team, with his current squad figures when the save has them. */
export interface Graduate {
  playerId: number;
  name: string | null;
  promotion: Promotion;
  /** Null until a sync places him in the squad (a USER promotion can run ahead of the save). */
  overallRating: number | null;
  potentialRating: number | null;
  primaryPosition: string | null;
  age: number | null;
  /** His academy figures on the day he was promoted. Null for promotions recorded before this was kept. */
  atPromotion: { overallRating: number | null; potentialRating: number | null } | null;
  /** Current overall minus overall at promotion, when both are known. */
  growth: number | null;
  /** First-team matches in the save's rating history, and his average rating (0-10) across them. */
  appearances: number;
  averageRating: number | null;
  /** True while he is still on the books. False once a sync no longer finds him in the squad. */
  inSquad: boolean;
}

/** A prospect who left the academy without a recorded promotion, and what the manager said happened. */
export interface Leaver {
  playerId: number;
  name: string | null;
  primaryPosition: string | null;
  overallRating: number | null;
  potentialRating: number | null;
  /** When the sync noticed he was gone. */
  leftAt: string;
  /** True once the manager declared him released. */
  released: boolean;
}

export const releaseEventId = (careerId: string, playerId: number): string =>
  `evt_youth_released_${careerId}_${playerId}`;

export const promotionEventId = (careerId: string, playerId: number): string =>
  `evt_youth_promoted_${careerId}_${playerId}`;

/** An academy row plus the name the manager typed for it, when the save could not supply one. */
export interface YouthRow extends YouthProspectEntry {
  /**
   * The manager's own name for the player, or null.
   *
   * Read from `player_user_profiles` rather than from the academy row, because the sync deletes every academy
   * row on each parse and would take a name typed onto it with it.
   */
  displayName: string | null;
  /** Set when he has been promoted, by the save or by the manager. Null while he is still academy only. */
  promotion: Promotion | null;
}

export interface YouthSummary {
  total: number;
  /** Prospects the save assesses more than once, whose fields are therefore a range. */
  multiAssessed: number;
  /** How many carry no name in the save, so the UI can explain the gaps rather than hide them. */
  unnamed: number;
  /** The best potential in the academy, or null when nothing is rated. */
  bestPotential: number | null;
}

export class YouthService {
  /**
   * The academy, strongest ceiling first.
   *
   * Sorted in memory rather than in SQL: the academy is a handful of rows, and `NULLS LAST` differs
   * between SQLite versions while a comparator does not.
   */
  async list(careerId: string): Promise<YouthRow[]> {
    const rows = await db
      .select()
      .from(youthProspects)
      .where(eq(youthProspects.careerId, careerId));

    // One extra read for the whole academy rather than a lookup per prospect, and matched on the same id shape
    // the profile service writes: `careerId_playerId`.
    const profiles = await db
      .select({
        playerId: playerUserProfiles.playerId,
        displayName: playerUserProfiles.displayName,
      })
      .from(playerUserProfiles)
      .where(eq(playerUserProfiles.careerId, careerId));
    const nameByPlayer = new Map(
      profiles.map((profile) => [profile.playerId, profile.displayName] as const)
    );

    const promotions = await this.promotions(careerId);

    return [...rows]
      .sort(
        (a, b) =>
          (b.potentialRating ?? -1) - (a.potentialRating ?? -1) ||
          (b.overallRating ?? -1) - (a.overallRating ?? -1) ||
          a.playerId - b.playerId
      )
      .map((row) => ({
        ...row,
        // The save's own `player_id` is not an EA id, so the profile key is built the same way the writer
        // builds it. A miss is simply no override, never a thrown lookup.
        displayName: nameByPlayer.get(`${careerId}_${row.playerId}`) ?? null,
        promotion: promotions.get(row.playerId)?.promotion ?? null,
      }));
  }

  /** Every recorded promotion, keyed by the save's player id. */
  private async promotions(
    careerId: string
  ): Promise<Map<number, { name: string | null; promotion: Promotion; atPromotion: Graduate["atPromotion"] }>> {
    const events = await db
      .select({ entityId: careerEvents.entityId, source: careerEvents.source, payloadJson: careerEvents.payloadJson, timestamp: careerEvents.timestamp })
      .from(careerEvents)
      .where(and(eq(careerEvents.careerId, careerId), eq(careerEvents.eventType, "YOUTH_PROMOTED")));
    const out = new Map<number, { name: string | null; promotion: Promotion; atPromotion: Graduate["atPromotion"] }>();
    for (const event of events) {
      const playerId = Number(event.entityId);
      if (!Number.isFinite(playerId)) continue;
      let name: string | null = null;
      let atPromotion: Graduate["atPromotion"] = null;
      try {
        const parsed = JSON.parse(event.payloadJson) as {
          name?: unknown;
          atPromotion?: { overallRating?: unknown; potentialRating?: unknown };
        };
        name = typeof parsed.name === "string" ? parsed.name : null;
        if (parsed.atPromotion) {
          const num = (v: unknown) => (typeof v === "number" ? v : null);
          atPromotion = { overallRating: num(parsed.atPromotion.overallRating), potentialRating: num(parsed.atPromotion.potentialRating) };
        }
      } catch {
        name = null;
      }
      out.set(playerId, {
        name,
        atPromotion,
        promotion: { source: event.source === "USER" ? "USER" : "SAVE", recordedAt: event.timestamp },
      });
    }
    return out;
  }

  /**
   * Academy graduates: everyone with a recorded promotion, newest first, joined to the squad for his
   * current figures. A player promoted and then sold keeps his place here, because he still came
   * through the academy; his figures simply read as unknown.
   */
  async graduates(careerId: string): Promise<Graduate[]> {
    const promotions = await this.promotions(careerId);
    if (promotions.size === 0) return [];
    const squad = await db
      .select({
        eaPlayerId: players.eaPlayerId,
        name: players.name,
        overallRating: players.overallRating,
        potentialRating: players.potentialRating,
        primaryPosition: players.primaryPosition,
        age: players.age,
      })
      .from(players)
      .where(eq(players.careerId, careerId));
    const bySquadId = new Map(squad.map((row) => [row.eaPlayerId, row] as const));
    const ratings = await db
      .select({ playerId: playerMatchRatings.playerId, rating: playerMatchRatings.rating })
      .from(playerMatchRatings)
      .where(eq(playerMatchRatings.careerId, careerId));
    const form = new Map<number, { apps: number; total: number }>();
    for (const row of ratings) {
      if (!promotions.has(row.playerId) || row.rating === null) continue;
      const entry = form.get(row.playerId) ?? { apps: 0, total: 0 };
      entry.apps++;
      entry.total += row.rating;
      form.set(row.playerId, entry);
    }
    return [...promotions.entries()]
      .map(([playerId, { name, promotion, atPromotion }]) => {
        const current = bySquadId.get(playerId);
        const played = form.get(playerId);
        const overallRating = current?.overallRating ?? null;
        const before = atPromotion?.overallRating ?? null;
        return {
          playerId,
          name: current?.name ?? name,
          promotion,
          overallRating,
          potentialRating: current?.potentialRating ?? null,
          primaryPosition: current?.primaryPosition ?? null,
          age: current?.age ?? null,
          atPromotion,
          growth: overallRating !== null && before !== null ? overallRating - before : null,
          appearances: played?.apps ?? 0,
          averageRating: played ? Math.round((played.total / played.apps) * 100) / 100 : null,
          inSquad: current !== undefined,
        };
      })
      .sort((a, b) => b.promotion.recordedAt.localeCompare(a.promotion.recordedAt));
  }

  /** Prospects the sync saw leave, minus any later recorded as promoted. Newest first. */
  async leavers(careerId: string): Promise<Leaver[]> {
    const events = await db
      .select({ eventType: careerEvents.eventType, entityId: careerEvents.entityId, payloadJson: careerEvents.payloadJson, timestamp: careerEvents.timestamp })
      .from(careerEvents)
      .where(eq(careerEvents.careerId, careerId));
    const promoted = new Set(events.filter((e) => e.eventType === "YOUTH_PROMOTED").map((e) => e.entityId));
    const released = new Set(events.filter((e) => e.eventType === "YOUTH_RELEASED").map((e) => e.entityId));
    const out: Leaver[] = [];
    for (const event of events) {
      if (event.eventType !== "YOUTH_LEFT" || promoted.has(event.entityId)) continue;
      let row: Partial<Leaver> = {};
      try {
        row = JSON.parse(event.payloadJson) as Partial<Leaver>;
      } catch {
        row = {};
      }
      out.push({
        playerId: Number(event.entityId),
        name: row.name ?? null,
        primaryPosition: row.primaryPosition ?? null,
        overallRating: row.overallRating ?? null,
        potentialRating: row.potentialRating ?? null,
        leftAt: event.timestamp,
        released: released.has(event.entityId),
      });
    }
    return out.sort((a, b) => b.leftAt.localeCompare(a.leftAt));
  }

  /** The manager's word that a departed prospect was released, or the undo of it. */
  async setReleased(careerId: string, playerId: number, released: boolean): Promise<void> {
    if (!released) {
      await db.delete(careerEvents).where(eq(careerEvents.id, releaseEventId(careerId, playerId)));
      return;
    }
    await db
      .insert(careerEvents)
      .values({
        id: releaseEventId(careerId, playerId),
        careerId,
        eventType: "YOUTH_RELEASED",
        source: "USER",
        entityType: "PLAYER",
        entityId: String(playerId),
        payloadJson: JSON.stringify({ playerId }),
        timestamp: new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  /** The manager's Promote button. Idempotent: the id is the same one a sync would write. */
  async promote(careerId: string, playerId: number, name: string | null): Promise<void> {
    const prospect = await db
      .select({ overallRating: youthProspects.overallRating, potentialRating: youthProspects.potentialRating })
      .from(youthProspects)
      .where(and(eq(youthProspects.careerId, careerId), eq(youthProspects.playerId, playerId)))
      .get();
    await db
      .insert(careerEvents)
      .values({
        id: promotionEventId(careerId, playerId),
        careerId,
        eventType: "YOUTH_PROMOTED",
        source: "USER",
        entityType: "PLAYER",
        entityId: String(playerId),
        payloadJson: JSON.stringify({ playerId, name, via: "USER", atPromotion: prospect ?? null }),
        timestamp: new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  /** Undo a Promote the manager pressed. A promotion the save itself showed is not his to take back. */
  async unpromote(careerId: string, playerId: number): Promise<void> {
    await db
      .delete(careerEvents)
      .where(and(eq(careerEvents.id, promotionEventId(careerId, playerId)), eq(careerEvents.source, "USER")));
  }

  summarise(rows: readonly YouthProspectEntry[]): YouthSummary {
    const potentials = rows
      .map((row) => row.potentialRating)
      .filter((value): value is number => value !== null);

    return {
      total: rows.length,
      multiAssessed: rows.filter((row) => row.assessmentCount > 1).length,
      unnamed: rows.filter((row) => !row.name).length,
      bestPotential: potentials.length > 0 ? Math.max(...potentials) : null,
    };
  }
}
