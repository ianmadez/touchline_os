/**
 * Player value.
 *
 * The save contains no player valuation. `players` has no value column, and the single `value`
 * field in the whole schema belongs to Player-Career-Mode history. So every figure here is DERIVED
 * and must be shown as such.
 *
 * The evidence base is `transfer_deals`: agreed transfer fees from `career_presignedcontract`,
 * which records what clubs in this world actually paid. A model is fitted on observed prices and
 * answers with a BAND - never a single number - because a point estimate would imply a precision
 * the data does not have.
 *
 * ## The honest limitation
 *
 * The only attribute the save shares between the deal population and the manager's own squad is
 * WAGE. Deal rows identify a player and a fee but carry no rating, age or position, and `players`
 * only ever holds our own roster, so world players cannot be joined to their attributes. Wage is
 * therefore the bridge, and the comparable neighbourhood is a wage neighbourhood. This is stated
 * in the UI rather than hidden, because it is the weakest part of the estimate.
 *
 * ## Band or nothing
 *
 * A band is only shown when there is real evidence behind it. Below `MIN_COMPARABLE_DEALS`
 * comparable sales, or when the player's wage sits outside the range the model was fitted on, the
 * answer is "no reliable estimate" rather than a technically-computed number. Having a number is
 * not the same as having a number worth showing.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { transferDeals } from "../db/schema";
import type { EnrichedPlayer } from "./squad-service";

/** Below this many comparable sales, no band is shown at all. */
export const MIN_COMPARABLE_DEALS = 8;
/** A comparable is a deal whose wage is within this factor of the player's. */
const COMPARABLE_WAGE_FACTOR = 1.6;
/** ~80% interval. Wide on purpose: the fit is on a modest sample of real prices. */
const BAND_SIGMA_MULTIPLIER = 1.28;

export interface ValueBand {
  available: true;
  low: number;
  mid: number;
  high: number;
  /** How many observed deals sat in the player's wage neighbourhood. */
  comparableCount: number;
  /** True when the player's wage sits outside the range the model was fitted on. */
  extrapolated: boolean;
  explanation: string;
}

export interface ValueUnavailable {
  available: false;
  comparableCount: number;
  reason: string;
}

export type PlayerValuation = ValueBand | ValueUnavailable;

interface FittedModel {
  intercept: number;
  slope: number;
  residualSigma: number;
  minWage: number;
  maxWage: number;
  sampleSize: number;
}

function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number; sigma: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  const covariance = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  const variance = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (variance <= 1e-12) return null;

  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  const residuals = points.map((p) => p.y - (intercept + slope * p.x));
  const sigma = Math.sqrt(
    residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, n - 2)
  );
  return { slope, intercept, sigma };
}

export class ValueService {
  /** Every stored deal for a career. Loaded once per valuation pass, never per player. */
  private async loadDeals(careerId: string) {
    return db.select().from(transferDeals).where(eq(transferDeals.careerId, careerId));
  }

  /**
   * A deal is usable as a price signal when it is a real transfer: a loan made permanent and a
   * swap both produce a fee that is not what the player was worth.
   */
  private isUsable(row: typeof transferDeals.$inferSelect): boolean {
    return (
      !row.isLoanBuy &&
      !row.isExchangePlayer &&
      row.offeredFee > 0 &&
      row.offeredWage !== null &&
      row.offeredWage > 0
    );
  }

  private fitFrom(rows: (typeof transferDeals.$inferSelect)[]): FittedModel | null {
    const usable = rows.filter((row) => this.isUsable(row));
    if (usable.length < MIN_COMPARABLE_DEALS) return null;

    const wages = usable.map((row) => row.offeredWage as number);
    // Fee against wage, both logged: price scales multiplicatively, so a linear fit on raw numbers
    // would be dominated by the handful of enormous deals.
    const fit = linearFit(
      usable.map((row) => ({
        x: Math.log(row.offeredWage as number),
        y: Math.log(row.offeredFee),
      }))
    );
    if (!fit) return null;

    return {
      intercept: fit.intercept,
      slope: fit.slope,
      residualSigma: fit.sigma,
      minWage: Math.min(...wages),
      maxWage: Math.max(...wages),
      sampleSize: usable.length,
    };
  }

  /** Rounds to two significant figures, which is all the precision the fit supports. */
  private tidy(value: number): number {
    if (value < 1000) return Math.round(value);
    const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / magnitude) * magnitude;
  }

  private evaluate(
    player: EnrichedPlayer,
    model: FittedModel | null,
    rows: (typeof transferDeals.$inferSelect)[]
  ): PlayerValuation {
    if (!model) {
      return {
        available: false,
        comparableCount: 0,
        reason: `Fewer than ${MIN_COMPARABLE_DEALS} usable agreed transfers in this save, so there is nothing to estimate from.`,
      };
    }

    if (!player.wage || player.wage <= 0) {
      return {
        available: false,
        comparableCount: 0,
        reason: "No wage recorded for this player, and wage is the only measure the save shares.",
      };
    }

    // The comparable neighbourhood: deals agreed on a similar wage to this player's.
    const comparableCount = rows.filter(
      (row) =>
        this.isUsable(row) &&
        (row.offeredWage as number) >= player.wage / COMPARABLE_WAGE_FACTOR &&
        (row.offeredWage as number) <= player.wage * COMPARABLE_WAGE_FACTOR
    ).length;

    if (comparableCount < MIN_COMPARABLE_DEALS) {
      return {
        available: false,
        comparableCount,
        reason: `Only ${comparableCount} agreed transfers on a similar wage (${MIN_COMPARABLE_DEALS} needed), so any figure would be arithmetic rather than evidence.`,
      };
    }

    const extrapolated = player.wage < model.minWage || player.wage > model.maxWage;
    const predicted = model.intercept + model.slope * Math.log(player.wage);

    return {
      available: true,
      low: this.tidy(Math.exp(predicted - BAND_SIGMA_MULTIPLIER * model.residualSigma)),
      mid: this.tidy(Math.exp(predicted)),
      high: this.tidy(Math.exp(predicted + BAND_SIGMA_MULTIPLIER * model.residualSigma)),
      comparableCount,
      extrapolated,
      explanation: `Based on ${comparableCount} agreed transfers on a similar wage, out of ${model.sampleSize} in this save${
        extrapolated ? ", with this player outside the wage range those deals cover" : ""
      }.`,
    };
  }

  /** Convenience for one player. Prefer `valueSquad` when valuing more than one. */
  async valuePlayer(careerId: string, player: EnrichedPlayer): Promise<PlayerValuation> {
    const rows = await this.loadDeals(careerId);
    return this.evaluate(player, this.fitFrom(rows), rows);
  }

  /**
   * Values the whole squad from a single fit.
   *
   * Fitting once and sharing it matters for correctness as well as speed: refitting per player
   * would let two players in the same squad be valued against slightly different models.
   */
  async valueSquad(
    careerId: string,
    squad: EnrichedPlayer[]
  ): Promise<Record<number, PlayerValuation>> {
    const rows = await this.loadDeals(careerId);
    const model = this.fitFrom(rows);
    return Object.fromEntries(
      squad.map((player) => [player.eaPlayerId, this.evaluate(player, model, rows)])
    );
  }
}
