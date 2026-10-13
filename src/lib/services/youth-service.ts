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

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { playerUserProfiles, youthProspects, type YouthProspectEntry } from "../db/schema";

/** An academy row plus the name the manager typed for it, when the save could not supply one. */
export interface YouthRow extends YouthProspectEntry {
  /**
   * The manager's own name for the player, or null.
   *
   * Read from `player_user_profiles` rather than from the academy row, because the sync deletes every academy
   * row on each parse and would take a name typed onto it with it.
   */
  displayName: string | null;
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
      }));
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
