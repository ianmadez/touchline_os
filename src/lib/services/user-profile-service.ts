import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { playerUserProfiles } from "../db/schema";

export interface SetPlayerProfileInput {
  careerId: string;
  eaPlayerId: number;
  assignedRole?: string;
  trustLevel?: "HIGH" | "MEDIUM" | "LOW";
  importanceMarker?: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS";
  userNotes?: string;
  /** Manual position override. `null` clears it; `undefined` leaves it untouched. */
  primaryPosition?: string | null;
}

export class UserProfileService {
  /**
   * Updates or creates a user annotation overlay for a player.
   */
  async setPlayerProfile(input: SetPlayerProfileInput): Promise<void> {
    const playerId = `${input.careerId}_${input.eaPlayerId}`;

    const existing = await db
      .select()
      .from(playerUserProfiles)
      .where(
        and(
          eq(playerUserProfiles.careerId, input.careerId),
          eq(playerUserProfiles.playerId, playerId)
        )
      )
      .get();

    if (existing) {
      await db
        .update(playerUserProfiles)
        .set({
          assignedRole: input.assignedRole !== undefined ? input.assignedRole : existing.assignedRole,
          trustLevel: input.trustLevel !== undefined ? input.trustLevel : existing.trustLevel,
          importanceMarker:
            input.importanceMarker !== undefined ? input.importanceMarker : existing.importanceMarker,
          userNotes: input.userNotes !== undefined ? input.userNotes : existing.userNotes,
          primaryPosition:
            input.primaryPosition !== undefined ? input.primaryPosition : existing.primaryPosition,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(playerUserProfiles.id, existing.id));
    } else {
      await db.insert(playerUserProfiles).values({
        id: crypto.randomUUID(),
        careerId: input.careerId,
        playerId,
        assignedRole: input.assignedRole,
        trustLevel: input.trustLevel,
        importanceMarker: input.importanceMarker,
        userNotes: input.userNotes,
        primaryPosition: input.primaryPosition,
        provenance: "USER",
      });
    }
  }
}