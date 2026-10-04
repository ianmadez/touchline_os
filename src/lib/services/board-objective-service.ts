import crypto from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { boardObjectives } from "../db/schema";
import {
  DEFAULT_PRIORITY,
  OBJECTIVE_CATEGORIES,
  OBJECTIVE_STATUSES,
  type ObjectiveCategory,
  type ObjectiveStatus,
} from "../objectives-vocabulary";

/**
 * The manager's board objectives.
 *
 * USER provenance throughout, which is the whole point: the save carries a single numeric objective
 * code with no wording, so there is nothing to derive these from. The manager is the authority on
 * what he was given and how it is going, and this service only stores and orders that.
 */

export interface BoardObjective {
  id: string;
  careerId: string;
  seasonNumber: number;
  category: ObjectiveCategory;
  /** 1 Critical .. 5 Low. */
  priority: number;
  title: string;
  status: ObjectiveStatus;
  notes: string | null;
  updatedAt: string;
}

export interface SaveObjectiveInput {
  /** Present to update an existing objective, absent to create one. */
  id?: string | null;
  careerId: string;
  seasonNumber: number;
  category: string;
  priority?: number;
  title: string;
  status?: string;
  notes?: string | null;
}

function toObjective(row: typeof boardObjectives.$inferSelect): BoardObjective {
  return {
    id: row.id,
    careerId: row.careerId,
    seasonNumber: row.seasonNumber,
    category: row.category as ObjectiveCategory,
    priority: row.priority,
    title: row.title,
    status: row.status as ObjectiveStatus,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

/**
 * Priority ordering, then category, then title.
 *
 * Priority first because that is the question the manager has: a Critical objective at risk matters
 * more than anything filed under a tidier heading.
 */
function ordered(rows: BoardObjective[]): BoardObjective[] {
  const categoryRank = new Map(OBJECTIVE_CATEGORIES.map((category, index) => [category, index]));
  return [...rows].sort(
    (a, b) =>
      a.priority - b.priority ||
      (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99) ||
      a.title.localeCompare(b.title)
  );
}

export class BoardObjectiveService {
  async list(careerId: string, seasonNumber: number | null): Promise<BoardObjective[]> {
    const rows = await db
      .select()
      .from(boardObjectives)
      .where(
        seasonNumber === null
          ? eq(boardObjectives.careerId, careerId)
          : and(
              eq(boardObjectives.careerId, careerId),
              eq(boardObjectives.seasonNumber, seasonNumber)
            )
      )
      .orderBy(asc(boardObjectives.priority), asc(boardObjectives.title));
    return ordered(rows.map(toObjective));
  }

  /**
   * Create or update one objective, then return the whole refreshed list.
   *
   * Returning the list rather than the single row is deliberate: every screen that shows objectives
   * shows them ordered against each other, so a caller that only got its own row back would have to
   * re-sort and could disagree with the server about the order.
   */
  async save(input: SaveObjectiveInput): Promise<BoardObjective[]> {
    const title = input.title.trim();
    if (title === "") throw new Error("An objective needs a title.");

    // The vocabulary is the contract. Storing an unknown category would make the row invisible to
    // every grouped view, so it is rejected at the boundary instead of written and forgotten.
    if (!OBJECTIVE_CATEGORIES.includes(input.category as ObjectiveCategory)) {
      throw new Error(`Unknown objective category: ${input.category}`);
    }
    const status = (input.status ?? "ON_TRACK") as ObjectiveStatus;
    if (!OBJECTIVE_STATUSES.includes(status)) {
      throw new Error(`Unknown objective status: ${status}`);
    }
    const priority = Math.min(5, Math.max(1, Math.trunc(input.priority ?? DEFAULT_PRIORITY)));

    const values = {
      careerId: input.careerId,
      seasonNumber: input.seasonNumber,
      category: input.category,
      priority,
      title,
      status,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      updatedAt: new Date().toISOString(),
    };

    if (input.id) {
      // Scoped by careerId so one career can never write into another's tracker.
      await db
        .update(boardObjectives)
        .set(values)
        .where(and(eq(boardObjectives.id, input.id), eq(boardObjectives.careerId, input.careerId)));
    } else {
      await db.insert(boardObjectives).values({ id: crypto.randomUUID(), ...values });
    }

    return this.list(input.careerId, input.seasonNumber);
  }

  async remove(careerId: string, id: string, seasonNumber: number): Promise<BoardObjective[]> {
    await db
      .delete(boardObjectives)
      .where(and(eq(boardObjectives.id, id), eq(boardObjectives.careerId, careerId)));
    return this.list(careerId, seasonNumber);
  }
}
