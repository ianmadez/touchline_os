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

/**
 * The praise-derived trust a player has earned, computed by the evaluator from the rolling debrief
 * window. Written only where the manager has not set a value by hand.
 */
export interface PraiseTrustEvaluation {
  eaPlayerId: number;
  trustLevel: "HIGH" | "MEDIUM" | "LOW";
  importanceMarker: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS" | null;
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

    // Which track owns the trust fields. Supplying either one by hand marks the row as the
    // manager's, which is what stops a derived pass from ever revising it afterwards.
    const managerOwnsTrust =
      input.trustLevel !== undefined || input.importanceMarker !== undefined;

    if (existing) {
      await db
        .update(playerUserProfiles)
        .set({
          assignedRole: input.assignedRole !== undefined ? input.assignedRole : existing.assignedRole,
          trustLevel: input.trustLevel !== undefined ? input.trustLevel : existing.trustLevel,
          importanceMarker:
            input.importanceMarker !== undefined ? input.importanceMarker : existing.importanceMarker,
          trustSource: managerOwnsTrust ? "USER" : existing.trustSource,
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
        trustSource: managerOwnsTrust ? "USER" : null,
        userNotes: input.userNotes,
        primaryPosition: input.primaryPosition,
        provenance: "USER",
      });
    }
  }

  /**
   * Writes the praise-derived trust overlay for a squad.
   *
   * Two rules, both deliberate:
   *
   * 1. **A manager's own setting always wins.** A row whose `trustSource` is `USER` is never touched -
   *    the same discipline the objective tracks use, where a derived value must never silently
   *    overwrite the manager's. Where the manager has not set one, the derived value is written to
   *    the same `trustLevel` / `importanceMarker` columns, so every existing screen keeps working
   *    unchanged.
   * 2. **Only real changes are written.** A player at baseline with no row is left alone, and an
   *    unchanged value is not rewritten, so a page load does not churn `updatedAt` on every player.
   *
   * Baseline is `MEDIUM` with no marker. Decay is a single step back to that baseline: a player who
   * reached the marker tier does not pass through HIGH-without-a-marker on the way down. The window
   * either still carries enough praise for him or it does not - there is no half-elevated state to
   * drop back to, and inventing one would read as an oversight rather than a rule.
   */
  async syncPraiseTrust(input: {
    careerId: string;
    evaluations: PraiseTrustEvaluation[];
  }): Promise<void> {
    const { careerId, evaluations } = input;
    if (evaluations.length === 0) return;

    const existingRows = await db
      .select()
      .from(playerUserProfiles)
      .where(eq(playerUserProfiles.careerId, careerId));
    const byPlayerId = new Map(existingRows.map((row) => [row.playerId, row]));

    for (const evaluation of evaluations) {
      const playerId = `${careerId}_${evaluation.eaPlayerId}`;
      const existing = byPlayerId.get(playerId);
      const isBaseline = evaluation.trustLevel === "MEDIUM" && evaluation.importanceMarker === null;

      // Ownership is decided from the ROW, not only from the flag.
      //
      // Rows that predate the `trust_source` column carry no flag at all. Before the praise-derived
      // pass existed the only way a trust value could reach a row was the manager setting it by hand,
      // so a value with no flag belongs to him. Treating those as derived is precisely how a
      // hand-set trust level gets silently rewritten on a page load.
      const managerOwnsTrust =
        existing !== undefined &&
        (existing.trustSource === "USER" ||
          (existing.trustSource === null &&
            (existing.trustLevel !== null || existing.importanceMarker !== null)));

      // The manager's own value is never revised, and a baseline player with nothing recorded stays
      // unrecorded rather than gaining a row that says nothing.
      if (managerOwnsTrust) continue;
      if (!existing && isBaseline) continue;
      if (
        existing &&
        existing.trustLevel === evaluation.trustLevel &&
        existing.importanceMarker === evaluation.importanceMarker
      ) {
        continue;
      }

      const updatedAt = new Date().toISOString();
      if (existing) {
        await db
          .update(playerUserProfiles)
          .set({
            trustLevel: evaluation.trustLevel,
            importanceMarker: evaluation.importanceMarker,
            trustSource: "DERIVED",
            updatedAt,
          })
          .where(eq(playerUserProfiles.id, existing.id));
      } else {
        await db.insert(playerUserProfiles).values({
          id: crypto.randomUUID(),
          careerId,
          playerId,
          trustLevel: evaluation.trustLevel,
          importanceMarker: evaluation.importanceMarker,
          trustSource: "DERIVED",
          provenance: "DERIVED",
        });
      }
    }
  }
}