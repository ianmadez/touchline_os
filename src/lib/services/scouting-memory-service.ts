/**
 * Scouting memory: what the manager rejected, why, and whether anything has actually changed.
 *
 * The point of this module is that a rejection is INFORMATION, and it is information that decays. A
 * target turned down for being too expensive is worth revisiting the moment he gets cheaper; a target
 * turned down for being the wrong age never is, because age only moves one way. Storing a name and a
 * "no" without the reason gives you a graveyard, not a memory.
 *
 * So the archive records the REASON and the STATE AT THE TIME (value, budget), and this service
 * re-tests that state on demand. The comparison is against what was true when the manager said no,
 * never against a re-derived figure - comparing today's model to today's model would always report no
 * change and the feature would be inert.
 *
 * The comparables gate is the part that keeps it honest. "He has got cheaper" is a claim about the
 * MARKET, and a single player's fitted value is not evidence about a market. Below the stated number
 * of similar players this returns NO_RELIABLE_ESTIMATE and surfaces nothing, rather than raising an
 * alert off one number that may have moved for model reasons alone.
 *
 * WHAT IS DELIBERATELY NOT IMPLEMENTED
 * Two triggers from the original specification cannot be built from what the save holds, and are left
 * out rather than approximated:
 *
 * - "target enters the final 12 months of his contract" - the world pool (`world_players`) carries no
 *   contract column at all. Contract expiry exists only for the manager's OWN squad. A scouting target
 *   is a player in another club's squad, so there is nothing to read and the trigger would have to be
 *   invented.
 * - "a key starter at their position is sold" - this needs a departure linked to a position, which
 *   means diffing squad snapshots and inferring that a specific departure is what makes this target
 *   relevant again. That is a real feature on its own, and guessing at it here would produce alerts
 *   that cannot be explained to the manager seeing them.
 */

import { and, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { careers, scoutTargets, worldPlayers, type ScoutArchiveReason } from "../db/schema";

/** A valuation view needs this many similar players behind it before we will act on it. */
export const MIN_COMPARABLES = 3;
/** How far the price must fall before a rejection on money is worth revisiting. */
const VALUE_DROP = 0.15;
/** How far the budget must rise before a postponed target is worth revisiting. */
const BUDGET_RISE = 1.25;
/** How close in rating a player has to be to count as a comparable. */
const COMPARABLE_RATING_BAND = 3;
/** Bounded so the panel cannot issue one count query per archived target forever. */
const MAX_ASSESSED = 40;

export const ARCHIVE_REASON_LABELS: Record<ScoutArchiveReason, string> = {
  TOO_EXPENSIVE: "Too expensive",
  WAGE_HIGH: "Wages too high",
  AGE_MISMATCH: "Wrong age",
  POSTPONED: "Postponed",
};

export const ARCHIVE_REASON_HINTS: Record<ScoutArchiveReason, string> = {
  TOO_EXPENSIVE: "Watch the price. Surfaces if similar players get cheaper.",
  WAGE_HIGH: "Watch the price. Surfaces if similar players get cheaper.",
  AGE_MISMATCH: "Never surfaces automatically - age only moves one way.",
  POSTPONED: "Watch your budget. Surfaces once the money improves.",
};

export type ResurfaceTrigger = "VALUE_DROP" | "BUDGET_RISE" | "NONE";
export type MemoryConfidence = "RELIABLE" | "NO_RELIABLE_ESTIMATE";

export interface ArchivedTarget {
  id: string;
  name: string;
  eaPlayerId: number | null;
  clubName: string | null;
  position: string | null;
  age: number | null;
  overallRating: number | null;
  archiveReason: ScoutArchiveReason;
  archivedAt: string | null;
  valueAtArchive: number | null;
  budgetAtArchive: number | null;
  notes: string | null;
}

export interface MemoryAssessment {
  target: ArchivedTarget;
  trigger: ResurfaceTrigger;
  shouldResurface: boolean;
  /** Current value midpoint from the pool, or null when the pool has no row for him. */
  currentValue: number | null;
  /** How many similarly-rated players at his position support a valuation view. */
  comparables: number;
  confidence: MemoryConfidence;
  detail: string;
}

function money(value: number | null, symbol: string): string {
  return value === null ? "nothing" : `${symbol}${(value / 1_000_000).toFixed(1)}M`;
}

export class ScoutingMemoryService {
  /** Everything the manager has set aside, most recently archived first. */
  async archived(careerId: string): Promise<ArchivedTarget[]> {
    const rows = await db
      .select()
      .from(scoutTargets)
      .where(and(eq(scoutTargets.careerId, careerId), isNotNull(scoutTargets.archiveReason)));

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        eaPlayerId: row.eaPlayerId,
        clubName: row.clubName,
        position: row.position,
        age: row.age,
        overallRating: row.overallRating,
        archiveReason: row.archiveReason as ScoutArchiveReason,
        archivedAt: row.archivedAt,
        valueAtArchive: row.valueAtArchive,
        budgetAtArchive: row.budgetAtArchive,
        notes: row.notes,
      }))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))
      .slice(0, MAX_ASSESSED);
  }

  /**
   * How many similarly-rated players at his position carry a value band.
   *
   * This is the sample size behind the valuation claim, not a count of "players like him" in any
   * looser sense - the band is deliberately narrow, because a comparables count that includes a
   * 60-rated centre-back would justify any number at all.
   */
  private async comparables(
    careerId: string,
    position: string | null,
    rating: number | null,
    excludeEaPlayerId: number | null
  ): Promise<number> {
    if (!position || rating === null) return 0;

    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(worldPlayers)
      .where(
        and(
          eq(worldPlayers.careerId, careerId),
          eq(worldPlayers.primaryPosition, position),
          gte(worldPlayers.overallRating, rating - COMPARABLE_RATING_BAND),
          lte(worldPlayers.overallRating, rating + COMPARABLE_RATING_BAND),
          isNotNull(worldPlayers.valueMid),
          excludeEaPlayerId === null
            ? sql`1 = 1`
            : ne(worldPlayers.eaPlayerId, excludeEaPlayerId)
        )
      )
      .get();

    return Number(rows?.n ?? 0);
  }

  /** The pool's current value midpoint for a target, or null when the pool has no row for him. */
  private async currentValue(careerId: string, eaPlayerId: number | null): Promise<number | null> {
    if (eaPlayerId === null) return null;
    const row = await db
      .select({ valueMid: worldPlayers.valueMid })
      .from(worldPlayers)
      .where(
        and(eq(worldPlayers.careerId, careerId), eq(worldPlayers.eaPlayerId, eaPlayerId))
      )
      .get();
    return row?.valueMid ?? null;
  }

  /**
   * Re-test every archived target against today's numbers.
   *
   * `budget` is passed in rather than read from settings here, because the caller already has it and
   * two sources for the same figure is how the panel and the search start disagreeing.
   */
  async assess(
    careerId: string,
    budget: number | null,
    symbol = "£"
  ): Promise<MemoryAssessment[]> {
    const archived = await this.archived(careerId);
    const out: MemoryAssessment[] = [];

    for (const target of archived) {
      const [comparables, current] = await Promise.all([
        this.comparables(careerId, target.position, target.overallRating, target.eaPlayerId),
        this.currentValue(careerId, target.eaPlayerId),
      ]);

      const base = { target, currentValue: current, comparables };
      const enough = comparables >= MIN_COMPARABLES;
      const confidence: MemoryConfidence = enough ? "RELIABLE" : "NO_RELIABLE_ESTIMATE";

      // Age is terminal. There is no version of "he got younger", so this reason is a decision rather
      // than a deferral and must never surface again.
      if (target.archiveReason === "AGE_MISMATCH") {
        out.push({
          ...base,
          trigger: "NONE",
          shouldResurface: false,
          confidence,
          detail: "Set aside on age. Age only moves one way, so this will not surface again.",
        });
        continue;
      }

      if (target.archiveReason === "POSTPONED") {
        const before = target.budgetAtArchive;
        if (before !== null && budget !== null && budget > before * BUDGET_RISE) {
          out.push({
            ...base,
            trigger: "BUDGET_RISE",
            shouldResurface: true,
            confidence,
            detail: `You had ${money(before, symbol)} when you postponed him and you have ${money(
              budget,
              symbol
            )} now. Worth another look.`,
          });
          continue;
        }
        out.push({
          ...base,
          trigger: "NONE",
          shouldResurface: false,
          confidence,
          detail:
            before === null || budget === null
              ? "No budget was recorded when he was postponed, so there is nothing to compare against."
              : `You had ${money(before, symbol)} when you postponed him, against ${money(
                  budget,
                  symbol
                )} now. Not enough of a change yet.`,
        });
        continue;
      }

      // The two money reasons. A claim that he has got cheaper is a claim about the market, so it
      // needs a market behind it before it is allowed to raise an alert.
      if (!enough) {
        out.push({
          ...base,
          trigger: "NONE",
          shouldResurface: false,
          confidence,
          detail: `Not enough similar players to judge the price: ${comparables} of the ${MIN_COMPARABLES} needed. No view is offered rather than a guess.`,
        });
        continue;
      }

      if (current === null || target.valueAtArchive === null) {
        out.push({
          ...base,
          trigger: "NONE",
          shouldResurface: false,
          confidence,
          detail: "One of the two prices is missing, so no comparison can be made.",
        });
        continue;
      }

      const drop = (target.valueAtArchive - current) / target.valueAtArchive;
      if (drop > VALUE_DROP) {
        out.push({
          ...base,
          trigger: "VALUE_DROP",
          shouldResurface: true,
          confidence,
          detail: `Was ${money(target.valueAtArchive, symbol)} when you said no, now around ${money(
            current,
            symbol
          )} - down ${Math.round(drop * 100)}%, measured against ${comparables} similar players.`,
        });
        continue;
      }

      out.push({
        ...base,
        trigger: "NONE",
        shouldResurface: false,
        confidence,
        detail:
          drop > 0
            ? `Down ${Math.round(drop * 100)}% since you said no - not yet the ${Math.round(
                VALUE_DROP * 100
              )}% that would make it worth revisiting.`
            : `No cheaper than when you said no (${money(target.valueAtArchive, symbol)} then, ${money(
                current,
                symbol
              )} now).`,
      });
    }

    // Anything worth acting on leads. Within that, the biggest fall first, because that is the one the
    // manager is most likely to want to see before he starts reading.
    return out.sort((a, b) => {
      if (a.shouldResurface !== b.shouldResurface) return a.shouldResurface ? -1 : 1;
      const fall = (m: MemoryAssessment) =>
        m.currentValue !== null && m.target.valueAtArchive
          ? (m.target.valueAtArchive - m.currentValue) / m.target.valueAtArchive
          : 0;
      return fall(b) - fall(a);
    });
  }

  /**
   * Set a target aside, recording why and what was true at the time.
   *
   * `valueAtArchive` and `budgetAtArchive` are supplied by the caller, which has both figures in hand
   * at the moment of the click. Reading them here would be a second source for the same number.
   */
  async archive(input: {
    careerId: string;
    targetId: string;
    reason: ScoutArchiveReason;
    valueAtArchive?: number | null;
    budgetAtArchive?: number | null;
  }): Promise<void> {
    const row = await db
      .select({ eaPlayerId: scoutTargets.eaPlayerId })
      .from(scoutTargets)
      .where(and(eq(scoutTargets.careerId, input.careerId), eq(scoutTargets.id, input.targetId)))
      .get();
    if (!row) return;

    // The price he was at when the manager said no, read from the pool rather than trusted from the
    // caller. A caller-supplied figure is one more place for the panel to disagree with the search.
    const valueAtArchive =
      input.valueAtArchive ?? (await this.currentValue(input.careerId, row.eaPlayerId));

    await db
      .update(scoutTargets)
      .set({
        status: "PASSED",
        archiveReason: input.reason,
        archivedAt: new Date().toISOString(),
        valueAtArchive,
        budgetAtArchive: input.budgetAtArchive ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(scoutTargets.careerId, input.careerId), eq(scoutTargets.id, input.targetId))
      );
  }

  /**
   * Bring a target back to the board and clear its memory.
   *
   * The archive fields are nulled rather than kept, because a target returned to the board with a
   * stale reason attached would be re-assessed against a comparison from a rejection that no longer
   * describes why he is being watched.
   */
  async restore(careerId: string, targetId: string): Promise<void> {
    await db
      .update(scoutTargets)
      .set({
        status: "WATCHING",
        archiveReason: null,
        archivedAt: null,
        valueAtArchive: null,
        budgetAtArchive: null,
        resurfacedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(scoutTargets.careerId, careerId), eq(scoutTargets.id, targetId)));
  }

  /** The in-game date, so the panel can say what "now" means without inventing one. */
  async inGameDate(careerId: string): Promise<string | null> {
    const row = await db
      .select({ inGameDate: careers.inGameDate })
      .from(careers)
      .where(eq(careers.id, careerId))
      .get();
    return row?.inGameDate ?? null;
  }
}
