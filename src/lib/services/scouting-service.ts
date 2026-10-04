/**
 * The scouting board - the manager's own shortlist.
 *
 * This is deliberately a bookkeeping service, not a search engine. The save stores no player
 * valuation anywhere (`players` has no value column) and the parser decodes the players table
 * squad-filtered, so there is no world pool of other clubs' players to query - a "search" over it
 * would have to invent every result it returned.
 *
 * What TouchlineOS can do honestly is the arithmetic the manager would otherwise do in his head: how a
 * price sits against the budget he has stated, how far the asking price is above his own valuation,
 * what the age profile implies, and what that adds up to across a whole shortlist.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { scoutTargets, type ScoutTargetPriority, type ScoutTargetStatus } from "../db/schema";

/** How a price sits against the manager's stated transfer budget. */
export type BudgetFit = "WITHIN_BUDGET" | "STRETCH" | "OVER_BUDGET" | "UNKNOWN";

export type AgeProfile = "DEVELOPING" | "PRIME" | "EXPERIENCED" | "UNKNOWN";

export interface ScoutTarget {
  id: string;
  name: string;
  /** The pool player this came from, or null when the manager typed it in by hand. */
  eaPlayerId: number | null;
  clubName: string | null;
  position: string | null;
  age: number | null;
  overallRating: number | null;
  potentialRating: number | null;
  valueEstimate: number | null;
  askingPrice: number | null;
  wageDemand: number | null;
  priority: ScoutTargetPriority;
  status: ScoutTargetStatus;
  notes: string | null;
  updatedAt: string;
}

export interface ScoutAssessment {
  target: ScoutTarget;
  /** The asking price where there is one, otherwise the manager's own valuation. */
  effectivePrice: number | null;
  budgetFit: BudgetFit;
  /** Budget left over if he were signed at `effectivePrice`. Negative means short. */
  headroom: number | null;
  /** How far the asking price sits above the manager's valuation, as a percentage. */
  valueGapPct: number | null;
  /** Room left between current and potential rating, for a developing player. */
  growthRoom: number | null;
  ageProfile: AgeProfile;
  /** Short, concrete sentences derived from the numbers above - never a new fact. */
  actions: string[];
}

export interface ScoutingBudget {
  /** The manager's stated transfer budget, so every fit verdict has something to be measured against. */
  transferBudget: number | null;
}

export interface ScoutingBoard {
  budget: ScoutingBudget;
  targets: ScoutTarget[];
  assessments: ScoutAssessment[];
  /** What the shortlist would cost if every shortlisted target were signed at his effective price. */
  shortlistCommitment: number | null;
  /** The budget left once that commitment is accounted for. Null when either side is unknown. */
  shortlistHeadroom: number | null;
  /** How many targets are priced at all, which is what makes the totals meaningful. */
  pricedTargets: number;
}

export interface SaveTargetInput {
  careerId: string;
  name: string;
  eaPlayerId?: number | null;
  clubName?: string | null;
  position?: string | null;
  age?: number | null;
  overallRating?: number | null;
  potentialRating?: number | null;
  valueEstimate?: number | null;
  askingPrice?: number | null;
  wageDemand?: number | null;
  priority?: ScoutTargetPriority;
  status?: ScoutTargetStatus;
  notes?: string | null;
}

/** A shortlist is anything the manager has decided to act on, not just what he is still watching. */
const ACTIVE_STATUSES: ReadonlySet<ScoutTargetStatus> = new Set<ScoutTargetStatus>([
  "SHORTLISTED",
  "BID",
  "AGREED",
]);

/** Above this share of the budget a deal is still possible, but it consumes the window. */
const STRETCH_RATIO = 1.25;

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toStatus(value: unknown): ScoutTargetStatus {
  const allowed: ScoutTargetStatus[] = ["WATCHING", "SHORTLISTED", "BID", "AGREED", "SIGNED", "PASSED"];
  return allowed.includes(value as ScoutTargetStatus) ? (value as ScoutTargetStatus) : "WATCHING";
}

function toPriority(value: unknown): ScoutTargetPriority {
  const allowed: ScoutTargetPriority[] = ["DREAM", "TOP", "HIGH", "MEDIUM", "LOW"];
  return allowed.includes(value as ScoutTargetPriority) ? (value as ScoutTargetPriority) : "MEDIUM";
}

function toTarget(row: typeof scoutTargets.$inferSelect): ScoutTarget {
  return {
    id: row.id,
    name: row.name,
    eaPlayerId: row.eaPlayerId,
    clubName: row.clubName,
    position: row.position,
    age: row.age,
    overallRating: row.overallRating,
    potentialRating: row.potentialRating,
    valueEstimate: row.valueEstimate,
    askingPrice: row.askingPrice,
    wageDemand: row.wageDemand,
    priority: toPriority(row.priority),
    status: toStatus(row.status),
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

export class ScoutingService {
  async listTargets(careerId: string): Promise<ScoutTarget[]> {
    const rows = await db
      .select()
      .from(scoutTargets)
      .where(eq(scoutTargets.careerId, careerId))
      .orderBy(asc(scoutTargets.name));
    return rows.map(toTarget);
  }

  /** Creates or updates one target, keyed by (career, name). */
  async saveTarget(input: SaveTargetInput): Promise<ScoutTarget> {
    const name = input.name.trim();
    if (!name) throw new Error("A scouting target needs a name.");

    const values = {
      eaPlayerId: input.eaPlayerId === undefined ? null : input.eaPlayerId,
      clubName: trimOrNull(input.clubName),
      position: trimOrNull(input.position),
      age: toOptionalInt(input.age),
      overallRating: toOptionalInt(input.overallRating),
      potentialRating: toOptionalInt(input.potentialRating),
      valueEstimate: toOptionalInt(input.valueEstimate),
      askingPrice: toOptionalInt(input.askingPrice),
      wageDemand: toOptionalInt(input.wageDemand),
      priority: toPriority(input.priority),
      status: toStatus(input.status),
      notes: trimOrNull(input.notes),
      updatedAt: new Date().toISOString(),
    };

    const existing = await db
      .select()
      .from(scoutTargets)
      .where(and(eq(scoutTargets.careerId, input.careerId), eq(scoutTargets.name, name)))
      .get();

    if (existing) {
      await db.update(scoutTargets).set(values).where(eq(scoutTargets.id, existing.id));
      return toTarget({ ...existing, ...values });
    }

    const id = crypto.randomUUID();
    await db.insert(scoutTargets).values({
      id,
      careerId: input.careerId,
      name,
      provenance: "USER",
      ...values,
    });
    const inserted = await db.select().from(scoutTargets).where(eq(scoutTargets.id, id)).get();
    return toTarget(inserted!);
  }

  async deleteTarget(careerId: string, id: string): Promise<void> {
    await db.delete(scoutTargets).where(and(eq(scoutTargets.careerId, careerId), eq(scoutTargets.id, id)));
  }

  /**
   * The whole board: every target judged against the budget the manager has stated.
   *
   * `transferBudget` is passed in rather than looked up so this stays pure and testable - the caller
   * already has the finance report, and one query for the budget here would be a second source of
   * truth for the same figure.
   */
  assess(targets: ScoutTarget[], transferBudget: number | null): ScoutAssessment[] {
    return targets.map((target) => {
      const effectivePrice = target.askingPrice ?? target.valueEstimate;

      let budgetFit: BudgetFit = "UNKNOWN";
      let headroom: number | null = null;
      if (effectivePrice !== null && transferBudget !== null) {
        headroom = transferBudget - effectivePrice;
        if (effectivePrice <= transferBudget) budgetFit = "WITHIN_BUDGET";
        else if (effectivePrice <= transferBudget * STRETCH_RATIO) budgetFit = "STRETCH";
        else budgetFit = "OVER_BUDGET";
      }

      const valueGapPct =
        target.askingPrice !== null && target.valueEstimate !== null && target.valueEstimate > 0
          ? (target.askingPrice - target.valueEstimate) / target.valueEstimate
          : null;

      const growthRoom =
        target.overallRating !== null && target.potentialRating !== null
          ? target.potentialRating - target.overallRating
          : null;

      const ageProfile: AgeProfile =
        target.age === null
          ? "UNKNOWN"
          : target.age <= 21
            ? "DEVELOPING"
            : target.age <= 28
              ? "PRIME"
              : "EXPERIENCED";

      return {
        target,
        effectivePrice,
        budgetFit,
        headroom,
        valueGapPct,
        growthRoom,
        ageProfile,
        actions: buildActions({ target, effectivePrice, budgetFit, headroom, valueGapPct, growthRoom, ageProfile, transferBudget }),
      };
    });
  }

  /** Assesses the board and totals what the active shortlist would cost. */
  build(targets: ScoutTarget[], transferBudget: number | null): ScoutingBoard {
    const assessments = this.assess(targets, transferBudget);
    const active = assessments.filter((entry) => ACTIVE_STATUSES.has(entry.target.status));
    const priced = active.filter((entry) => entry.effectivePrice !== null);

    // The commitment is only stated when EVERY active target is priced - a partial total presented
    // as a total is worse than no total, because it reads as the whole bill.
    const complete = priced.length === active.length && active.length > 0;
    const shortlistCommitment = complete
      ? priced.reduce((sum, entry) => sum + (entry.effectivePrice ?? 0), 0)
      : null;

    return {
      budget: { transferBudget },
      targets,
      assessments,
      shortlistCommitment,
      shortlistHeadroom:
        shortlistCommitment !== null && transferBudget !== null
          ? transferBudget - shortlistCommitment
          : null,
      pricedTargets: assessments.filter((entry) => entry.effectivePrice !== null).length,
    };
  }
}

/**
 * Concrete consequences of the numbers already on the row.
 *
 * Nothing here introduces a new claim. Each sentence is a restatement of an arithmetic relation the
 * manager can check by looking at the two figures it names - which is the only kind of advice a
 * booking-keeping tool is entitled to give.
 */
function buildActions(input: {
  target: ScoutTarget;
  effectivePrice: number | null;
  budgetFit: BudgetFit;
  headroom: number | null;
  valueGapPct: number | null;
  growthRoom: number | null;
  ageProfile: AgeProfile;
  transferBudget: number | null;
}): string[] {
  const { target, effectivePrice, budgetFit, headroom, valueGapPct, growthRoom, ageProfile, transferBudget } =
    input;
  const actions: string[] = [];
  const money = (value: number) => `£${Math.round(value / 100_000) / 10}m`;

  if (target.status === "SIGNED" || target.status === "PASSED") {
    // A closed file does not need advice.
    return actions;
  }

  if (budgetFit === "WITHIN_BUDGET" && headroom !== null) {
    actions.push(`At ${money(effectivePrice!)} he fits, leaving ${money(headroom)} of your budget.`);
  } else if (budgetFit === "STRETCH" && headroom !== null) {
    actions.push(
      `At ${money(effectivePrice!)}, ${money(Math.abs(headroom))} more than your budget - possible, but it would take the whole window.`
    );
  } else if (budgetFit === "OVER_BUDGET" && headroom !== null) {
    actions.push(
      `At ${money(effectivePrice!)} he is ${money(Math.abs(headroom))} beyond your budget, so a sale would have to come first.`
    );
  } else if (effectivePrice === null) {
    actions.push("No price recorded yet, so there is nothing to measure against the budget.");
  } else if (transferBudget === null) {
    actions.push("Set a transfer budget on the Finances screen and his affordability is measured here.");
  }

  if (valueGapPct !== null && valueGapPct > 0.15) {
    actions.push(
      `His club want ${Math.round(valueGapPct * 100)}% more than your own valuation, so the negotiation starts a long way apart.`
    );
  } else if (valueGapPct !== null && valueGapPct < -0.1) {
    actions.push(
      `The asking price is ${Math.round(Math.abs(valueGapPct) * 100)}% below your valuation, which is worth checking before it moves.`
    );
  }

  if (ageProfile === "DEVELOPING" && growthRoom !== null && growthRoom >= 4) {
    actions.push(
      `${growthRoom} points of growth left, so he is a project rather than a starter for this season.`
    );
  } else if (ageProfile === "EXPERIENCED" && growthRoom !== null && growthRoom <= 0) {
    actions.push("No growth left in him, so the fee buys the present and nothing else.");
  }

  return actions;
}
