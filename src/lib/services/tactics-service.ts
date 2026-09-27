import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { tacticalSystems } from "../db/schema";
import { getFormationById } from "../tactics/formations";

export interface PitchSlotAssignment {
  slotIndex: number;
  role: string;
  label: string;
  playerId: string | null;
  eaPlayerId: number | null;
  playerName: string | null;
  overallRating: number | null;
}

export interface TacticalSystemState {
  careerId: string;
  formationName: string;
  slots: PitchSlotAssignment[];
  inPossessionShape?: string | null;
  outOfPossessionShape?: string | null;
  pressingStyle?: string | null;
  buildUpStyle?: string | null;
  notes?: string | null;
}

export class TacticsService {
  async getTacticalSystem(careerId: string): Promise<TacticalSystemState> {
    const record = await db
      .select()
      .from(tacticalSystems)
      .where(eq(tacticalSystems.careerId, careerId))
      .get();

    if (!record) {
      // Default initial 4-3-3 Holding setup
      const defaultDef = getFormationById("4-3-3-holding");
      const defaultSlots: PitchSlotAssignment[] = defaultDef.slots.map((s) => ({
        slotIndex: s.slotIndex,
        role: s.role,
        label: s.label,
        playerId: null,
        eaPlayerId: null,
        playerName: null,
        overallRating: null,
      }));

      return {
        careerId,
        formationName: defaultDef.id,
        slots: defaultSlots,
      };
    }

    return {
      careerId: record.careerId,
      formationName: record.formationName,
      slots: JSON.parse(record.baseShapeJson) as PitchSlotAssignment[],
      inPossessionShape: record.inPossessionShape,
      outOfPossessionShape: record.outOfPossessionShape,
      pressingStyle: record.pressingStyle,
      buildUpStyle: record.buildUpStyle,
      notes: record.notes,
    };
  }

  async saveTacticalSystem(state: TacticalSystemState): Promise<void> {
    const existing = await db
      .select()
      .from(tacticalSystems)
      .where(eq(tacticalSystems.careerId, state.careerId))
      .get();

    const baseShapeJson = JSON.stringify(state.slots);

    if (existing) {
      await db
        .update(tacticalSystems)
        .set({
          formationName: state.formationName,
          baseShapeJson,
          inPossessionShape: state.inPossessionShape,
          outOfPossessionShape: state.outOfPossessionShape,
          pressingStyle: state.pressingStyle,
          buildUpStyle: state.buildUpStyle,
          notes: state.notes,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tacticalSystems.id, existing.id));
    } else {
      await db.insert(tacticalSystems).values({
        id: crypto.randomUUID(),
        careerId: state.careerId,
        formationName: state.formationName,
        baseShapeJson,
        inPossessionShape: state.inPossessionShape,
        outOfPossessionShape: state.outOfPossessionShape,
        pressingStyle: state.pressingStyle,
        buildUpStyle: state.buildUpStyle,
        notes: state.notes,
        provenance: "USER",
      });
    }
  }
}