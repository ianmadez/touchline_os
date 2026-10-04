import { and, asc, desc, eq } from "drizzle-orm";
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
  /** The manager's own name for this formation. It is the identity that keys the row. */
  label: string;
  /** The registry id of the shape (e.g. "4-3-3-holding"). */
  formationName: string;
  /** True for the formation the rest of the app treats as the manager's current XI. */
  isDefault: boolean;
  slots: PitchSlotAssignment[];
  inPossessionShape?: string | null;
  outOfPossessionShape?: string | null;
  pressingStyle?: string | null;
  buildUpStyle?: string | null;
  notes?: string | null;
}

export class TacticsService {
  /**
   * Every formation this manager has saved, default first.
   *
   * Read-only on purpose: an empty list is returned as-is rather than seeding a row, so a plain page
   * load never writes. `getTacticalSystem` is the accessor that synthesises an unsaved shape.
   */
  async listFormations(careerId: string): Promise<TacticalSystemState[]> {
    const rows = await db
      .select()
      .from(tacticalSystems)
      .where(eq(tacticalSystems.careerId, careerId))
      .orderBy(desc(tacticalSystems.isDefault), asc(tacticalSystems.label));
    return rows.map((row) => this.toState(row));
  }

  /**
   * The formation the rest of the app treats as the manager's current XI.
   *
   * The marked default when there is one, otherwise the first saved formation, otherwise a synthetic
   * 4-3-3 Holding with empty slots so a brand-new career still has a pitch to look at.
   */
  async getTacticalSystem(careerId: string): Promise<TacticalSystemState> {
    const rows = await db
      .select()
      .from(tacticalSystems)
      .where(eq(tacticalSystems.careerId, careerId))
      .orderBy(desc(tacticalSystems.isDefault), asc(tacticalSystems.label));
    const preferred = rows.find((row) => row.isDefault) ?? rows[0];
    if (preferred) return this.toState(preferred);
    return this.emptyFormation(careerId, "Primary", "4-3-3-holding", true);
  }

  /**
   * Upserts one formation, keyed by its label.
   *
   * Deliberately does NOT touch `isDefault` on an existing row: saving a formation is not the same
   * act as making it the current XI, and conflating the two would silently switch the manager's XI
   * every time they edited a Plan B.
   */
  async saveTacticalSystem(state: TacticalSystemState): Promise<void> {
    const existing = await db
      .select()
      .from(tacticalSystems)
      .where(
        and(eq(tacticalSystems.careerId, state.careerId), eq(tacticalSystems.label, state.label))
      )
      .get();

    const values = {
      formationName: state.formationName,
      baseShapeJson: JSON.stringify(state.slots),
      inPossessionShape: state.inPossessionShape ?? null,
      outOfPossessionShape: state.outOfPossessionShape ?? null,
      pressingStyle: state.pressingStyle ?? null,
      buildUpStyle: state.buildUpStyle ?? null,
      notes: state.notes ?? null,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.update(tacticalSystems).set(values).where(eq(tacticalSystems.id, existing.id));
    } else {
      await db.insert(tacticalSystems).values({
        id: crypto.randomUUID(),
        careerId: state.careerId,
        label: state.label,
        isDefault: state.isDefault,
        ...values,
        provenance: "USER",
      });
    }
  }

  /** Adds a formation from a registry shape, with every slot empty. Labels are always unique. */
  async createFormation(
    careerId: string,
    input: { formationName: string; label?: string }
  ): Promise<TacticalSystemState> {
    const existing = await this.listFormations(careerId);
    const label = this.uniqueLabel(
      input.label?.trim() || "New formation",
      existing.map((formation) => formation.label)
    );
    // The very first formation a career has is its current XI by definition.
    const state = this.emptyFormation(careerId, label, input.formationName, existing.length === 0);
    await this.saveTacticalSystem(state);
    return state;
  }

  async renameFormation(careerId: string, label: string, nextLabel: string): Promise<void> {
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === label) return;
    const all = await this.listFormations(careerId);
    if (!all.some((formation) => formation.label === label)) return;
    const unique = this.uniqueLabel(
      trimmed,
      all.filter((formation) => formation.label !== label).map((formation) => formation.label)
    );
    await db
      .update(tacticalSystems)
      .set({ label: unique, updatedAt: new Date().toISOString() })
      .where(and(eq(tacticalSystems.careerId, careerId), eq(tacticalSystems.label, label)));
  }

  /** Removes one formation. The last remaining one is never deleted, and the default is handed on. */
  async deleteFormation(careerId: string, label: string): Promise<void> {
    const all = await this.listFormations(careerId);
    if (all.length <= 1) return;
    const target = all.find((formation) => formation.label === label);
    if (!target) return;
    await db
      .delete(tacticalSystems)
      .where(and(eq(tacticalSystems.careerId, careerId), eq(tacticalSystems.label, label)));
    if (target.isDefault) {
      const next = all.find((formation) => formation.label !== label);
      if (next) await this.setDefaultFormation(careerId, next.label);
    }
  }

  /** Marks one formation as the current XI, clearing the flag on every other row. */
  async setDefaultFormation(careerId: string, label: string): Promise<void> {
    await db
      .update(tacticalSystems)
      .set({ isDefault: false })
      .where(eq(tacticalSystems.careerId, careerId));
    await db
      .update(tacticalSystems)
      .set({ isDefault: true, updatedAt: new Date().toISOString() })
      .where(and(eq(tacticalSystems.careerId, careerId), eq(tacticalSystems.label, label)));
  }

  private toState(row: typeof tacticalSystems.$inferSelect): TacticalSystemState {
    return {
      careerId: row.careerId,
      label: row.label,
      formationName: row.formationName,
      isDefault: row.isDefault,
      slots: JSON.parse(row.baseShapeJson) as PitchSlotAssignment[],
      inPossessionShape: row.inPossessionShape,
      outOfPossessionShape: row.outOfPossessionShape,
      pressingStyle: row.pressingStyle,
      buildUpStyle: row.buildUpStyle,
      notes: row.notes,
    };
  }

  private emptyFormation(
    careerId: string,
    label: string,
    formationName: string,
    isDefault = false
  ): TacticalSystemState {
    const definition = getFormationById(formationName);
    return {
      careerId,
      label,
      formationName: definition.id,
      isDefault,
      slots: definition.slots.map((slot) => ({
        slotIndex: slot.slotIndex,
        role: slot.role,
        label: slot.label,
        playerId: null,
        eaPlayerId: null,
        playerName: null,
        overallRating: null,
      })),
    };
  }

  /** "Plan B" -> "Plan B 2" when the name is taken, so a create never fails on a clash. */
  private uniqueLabel(desired: string, taken: string[]): string {
    if (!taken.includes(desired)) return desired;
    let suffix = 2;
    while (taken.includes(`${desired} ${suffix}`)) suffix += 1;
    return `${desired} ${suffix}`;
  }
}