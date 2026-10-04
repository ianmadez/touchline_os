import { eq, and, desc, ne } from "drizzle-orm";
import { db } from "../db/client";
import { careerEvents, Provenance } from "../db/schema";
import { CoreEventType } from "../events/types";

export interface ParsedCareerEvent {
  id: string;
  careerId: string;
  snapshotId: string | null;
  timestamp: string;
  eventType: CoreEventType;
  source: Provenance;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

export class EventService {
  /**
   * Queries the complete, chronological career timeline.
   *
   * Storyline evidence is deliberately excluded. Those rows are supporting detail for a thread -
   * "this contract runs out in 2027" - and there can be many of them, so including them here would
   * push genuine transitions out of the feed to say nothing that the thread itself does not already
   * say. They still reach the screen, through the storyline that owns them.
   */
  async getTimeline(
    careerId: string,
    limit = 50
  ): Promise<ParsedCareerEvent[]> {
    const rawEvents = await db
      .select()
      .from(careerEvents)
      .where(
        and(eq(careerEvents.careerId, careerId), ne(careerEvents.entityType, "EVIDENCE"))
      )
      .orderBy(desc(careerEvents.timestamp))
      .limit(limit);

    return rawEvents.map((evt) => ({
      id: evt.id,
      careerId: evt.careerId,
      snapshotId: evt.snapshotId,
      timestamp: evt.timestamp,
      eventType: evt.eventType as CoreEventType,
      source: evt.source as Provenance,
      entityType: evt.entityType,
      entityId: evt.entityId,
      payload: JSON.parse(evt.payloadJson),
    }));
  }

  /**
   * Queries timeline events filtered by entity (e.g., all events for a specific player).
   */
  async getEntityHistory(
    careerId: string,
    entityId: string
  ): Promise<ParsedCareerEvent[]> {
    const rawEvents = await db
      .select()
      .from(careerEvents)
      .where(
        and(
          eq(careerEvents.careerId, careerId),
          eq(careerEvents.entityId, entityId)
        )
      )
      .orderBy(desc(careerEvents.timestamp));

    return rawEvents.map((evt) => ({
      id: evt.id,
      careerId: evt.careerId,
      snapshotId: evt.snapshotId,
      timestamp: evt.timestamp,
      eventType: evt.eventType as CoreEventType,
      source: evt.source as Provenance,
      entityType: evt.entityType,
      entityId: evt.entityId,
      payload: JSON.parse(evt.payloadJson),
    }));
  }

  /** Appends one raw career event. */
  async appendEvent(event: typeof careerEvents.$inferInsert): Promise<void> {
    await db.insert(careerEvents).values(event);
  }

  /** Appends several raw career events in one statement; a no-op for an empty list. */
  async appendEvents(events: (typeof careerEvents.$inferInsert)[]): Promise<void> {
    if (events.length === 0) return;
    await db.insert(careerEvents).values(events);
  }

  /** Removes every event mirrored from one entity, e.g. one target block's matches. */
  async deleteEventsForEntity(
    careerId: string,
    entityType: string,
    entityId: string
  ): Promise<void> {
    await db
      .delete(careerEvents)
      .where(
        and(
          eq(careerEvents.careerId, careerId),
          eq(careerEvents.entityType, entityType),
          eq(careerEvents.entityId, entityId)
        )
      );
  }

  /**
   * Removes one manager-logged debrief.
   *
   * Deliberately narrow: only a row that is BOTH a `MATCH_DEBRIEF` and USER-sourced can be removed,
   * so a stale id or a crafted request cannot take out a career transition from the spine.
   */
  async deleteUserDebrief(id: string): Promise<{ id: string; careerId: string }[]> {
    return db
      .delete(careerEvents)
      .where(
        and(
          eq(careerEvents.id, id),
          eq(careerEvents.eventType, "MATCH_DEBRIEF"),
          eq(careerEvents.source, "USER")
        )
      )
      .returning({ id: careerEvents.id, careerId: careerEvents.careerId });
  }
}