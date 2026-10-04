/**
 * The world value model.
 *
 * ## What changed, and why this model can exist at all
 *
 * `ValueService` fits price on WAGE, and its own header documents the weakness: deal rows identify a
 * player and a fee but carry no rating, age or position, and `players` only ever held our own roster,
 * so a world player could not be joined to his attributes. Wage was the only bridge.
 *
 * The world pool removes that limitation. `transfer_deals.player_id` now joins to
 * `world_players.ea_player_id`, so the same observed fees can be fitted against the thing that
 * actually drives price - rating, age and growth - instead of a proxy for it.
 *
 * ## Band or nothing, and what "nothing" means here
 *
 * The band discipline is unchanged and non-negotiable: a valuation is never a point estimate.
 *
 * `ValueService` answers "no reliable estimate" below its comparable threshold. That is right for a
 * single player, and useless for a search over 21,166 of them - a search that returns nothing is not
 * a search. The resolution is not to lower the bar but to LABEL the answer:
 *
 *  - fitted on real observed fees  -> the band comes from the fit's own residual spread.
 *  - too few deals to fit          -> a stated PRIOR curve, marked `LOW` confidence with the basis
 *                                     saying plainly that it is a prior and not a fit.
 *
 * Either way the caller gets a band and a confidence, so a reader can tell evidence from a
 * placeholder at a glance. What is never allowed is a single precise-looking number.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { transferDeals, worldPlayers } from "../db/schema";

/** Below this many joinable deals there is no fit, only the prior. */
export const MIN_FITTED_DEALS = 15;
/** ~80% interval, the same convention `ValueService` uses. */
const BAND_SIGMA_MULTIPLIER = 1.28;
/** The prior's own spread. Wide on purpose: it is a shape, not a measurement. */
const PRIOR_SIGMA = 0.55;
/**
 * Above this residual spread, a fit explains so little that presenting it as evidence is misleading.
 *
 * Measured on the reference career: fitting 20-odd observed fees against rating, age and growth gives
 * a residual sigma around 1.6, which is a band spanning about eight times either side of the
 * midpoint - a genuine measurement of almost nothing. Beyond this threshold the stated curve's
 * tighter spread is used instead, and the basis text says why. The fit is not hidden; it is reported
 * as having failed to explain the prices.
 */
const MAX_USABLE_SIGMA = 0.7;

/** Rating that anchors the prior curve, and its price in the save's currency units. */
const PRIOR_ANCHOR_RATING = 70;
const PRIOR_ANCHOR_VALUE = 1_200_000;
/**
 * Each rating point multiplies price by e^0.16 (~1.17x).
 *
 * This was 0.28, which compounded to a £2.6 BILLION band top for a 94-rated 23-year-old - the tell
 * that an exponential in rating has no ceiling while a real market plainly does: 70 -> 94 at 0.28 is
 * a factor of 270, and no club pays 270 times a journeyman's fee for a world-class player. 0.16 puts
 * a 94 at roughly £60m before the band, which is the right order of magnitude.
 */
const PRIOR_RATING_STEP = 0.16;
/**
 * Age as a log offset. A player's price is about what he will do next, so the curve rises to a peak
 * and falls away: the same rating is worth several times more at 23 than at 34. These are the shape
 * of a market, stated as a shape rather than dressed up as fitted coefficients.
 */
const PRIOR_AGE_STEPS: ReadonlyArray<{ maxAge: number; offset: number }> = [
  { maxAge: 21, offset: 0.35 },
  { maxAge: 24, offset: 0.25 },
  { maxAge: 27, offset: 0.15 },
  { maxAge: 29, offset: 0.0 },
  { maxAge: 31, offset: -0.2 },
  { maxAge: 33, offset: -0.4 },
  { maxAge: 99, offset: -0.65 },
];

export type ValueConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface ValueBasis {
  /** Rating, age and growth are all present, so the model can be evaluated. */
  evaluable: boolean;
  reason?: string;
}

interface FittedWorldModel {
  fitted: true;
  /** [intercept, overall, age, growth] in log-fee space. */
  coefficients: number[];
  residualSigma: number;
  sampleSize: number;
  minRating: number;
  maxRating: number;
  minAge: number;
  maxAge: number;
}

interface PriorWorldModel {
  fitted: false;
  sampleSize: number;
}

type WorldModel = FittedWorldModel | PriorWorldModel;

export interface WorldValue {
  low: number;
  mid: number;
  high: number;
  confidence: ValueConfidence;
  /** A sentence naming what the band rests on. Shown, not hidden. */
  basis: string;
}

/** A deal is a usable price signal only when it is a real transfer of a real rating. */
function isUsableDeal(row: typeof transferDeals.$inferSelect): boolean {
  return (
    !row.isLoanBuy &&
    !row.isExchangePlayer &&
    row.offeredFee > 0 &&
    row.offeredWage !== null &&
    row.offeredWage > 0
  );
}

/**
 * Least squares via the normal equations.
 *
 * Four predictors and a few dozen rows: small enough that a closed-form solve is both faster and far
 * less code than anything iterative. Returns null when the system is singular, which is the honest
 * answer for perfectly collinear predictors rather than a fabricated coefficient.
 */
function solveNormalEquations(rows: number[][], y: number[]): number[] | null {
  const k = rows[0]?.length ?? 0;
  if (k === 0 || rows.length < k + 1) return null;

  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a] += rows[i][a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += rows[i][a] * rows[i][b];
    }
  }

  const m = xtx.map((row, i) => [...row, xty[i]]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= k; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

function ageOffset(age: number): number {
  for (const step of PRIOR_AGE_STEPS) {
    if (age <= step.maxAge) return step.offset;
  }
  return PRIOR_AGE_STEPS[PRIOR_AGE_STEPS.length - 1].offset;
}

/** Two significant figures: all the precision either a fit or a prior can support. */
function tidy(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return Math.round(value);
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

export class WorldValueModelService {
  private cached: { careerId: string; model: WorldModel } | null = null;

  /**
   * Fits the model once per career per process.
   *
   * A search evaluates the band for every returned row, and a re-fit per row would be a few dozen
   * regressions per page instead of one.
   */
  async model(careerId: string): Promise<WorldModel> {
    if (this.cached?.careerId === careerId) return this.cached.model;

    const deals = await db.select().from(transferDeals).where(eq(transferDeals.careerId, careerId));
    const pool = await db
      .select({
        eaPlayerId: worldPlayers.eaPlayerId,
        overallRating: worldPlayers.overallRating,
        potentialRating: worldPlayers.potentialRating,
        age: worldPlayers.age,
      })
      .from(worldPlayers)
      .where(eq(worldPlayers.careerId, careerId));
    const byId = new Map(pool.map((row) => [row.eaPlayerId, row]));

    // THE join that the old model could not make: each observed fee now carries the rating, age and
    // growth of the player it was paid for.
    const samples: { fee: number; rating: number; age: number; growth: number }[] = [];
    for (const deal of deals) {
      if (!isUsableDeal(deal)) continue;
      const player = byId.get(deal.playerId);
      if (!player) continue;
      if (player.overallRating === null || player.age === null) continue;
      samples.push({
        fee: deal.offeredFee,
        rating: player.overallRating,
        age: player.age,
        growth: (player.potentialRating ?? player.overallRating) - player.overallRating,
      });
    }

    let model: WorldModel;
    if (samples.length < MIN_FITTED_DEALS) {
      model = { fitted: false, sampleSize: samples.length };
    } else {
      const coefficients = solveNormalEquations(
        samples.map((s) => [1, s.rating, s.age, s.growth]),
        samples.map((s) => Math.log(s.fee))
      );
      if (!coefficients) {
        model = { fitted: false, sampleSize: samples.length };
      } else {
        const residuals = samples.map(
          (s) =>
            Math.log(s.fee) -
            (coefficients[0] +
              coefficients[1] * s.rating +
              coefficients[2] * s.age +
              coefficients[3] * s.growth)
        );
        const sigma = Math.sqrt(
          residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, samples.length - 4)
        );
        const ratings = samples.map((s) => s.rating);
        const ages = samples.map((s) => s.age);
        model = {
          fitted: true,
          coefficients,
          residualSigma: sigma,
          sampleSize: samples.length,
          minRating: Math.min(...ratings),
          maxRating: Math.max(...ratings),
          minAge: Math.min(...ages),
          maxAge: Math.max(...ages),
        };
      }
    }

    this.cached = { careerId, model };
    return model;
  }

  /**
   * The band for one player.
   *
   * Returns null only when nothing can be said at all (no rating), which is a different thing from
   * "not confident" - that is what the confidence tag is for.
   */
  evaluate(
    model: WorldModel,
    player: { overallRating: number | null; potentialRating: number | null; age: number | null }
  ): WorldValue | null {
    const rating = player.overallRating;
    if (rating === null) return null;
    const age = player.age;
    const growth = (player.potentialRating ?? rating) - rating;

    const priorLnMid =
      Math.log(PRIOR_ANCHOR_VALUE) +
      (rating - PRIOR_ANCHOR_RATING) * PRIOR_RATING_STEP +
      (age === null ? 0 : ageOffset(age));

    if (model.fitted) {
      // A thin sample, an awkward player, or a spread the fit itself admits to all widen the band.
      const samplePenalty = model.sampleSize >= 30 ? 1 : model.sampleSize >= 20 ? 1.2 : 1.45;
      const usable = model.residualSigma <= MAX_USABLE_SIGMA;
      // The midpoint follows the SAME rule as the spread. A degenerate fit on noisy fees happily
      // concludes that an ageing player is worth more than a young one - observed here as an 85-rated
      // 37-year-old out-pricing the same rating at 22. Trusting its midpoint would turn a wide band
      // into a backwards ranking, which is far worse than a wide band.
      const lnMid = usable
        ? model.coefficients[0] +
          model.coefficients[1] * rating +
          model.coefficients[2] * (age ?? 26) +
          model.coefficients[3] * growth
        : priorLnMid;
      const sigma = (usable ? model.residualSigma : PRIOR_SIGMA) * samplePenalty;
      const extrapolated =
        age !== null && (age < model.minAge || age > model.maxAge || rating < model.minRating || rating > model.maxRating);

      const mid = Math.exp(lnMid);
      return {
        low: tidy(mid * Math.exp(-BAND_SIGMA_MULTIPLIER * sigma)),
        mid: tidy(mid),
        high: tidy(mid * Math.exp(BAND_SIGMA_MULTIPLIER * sigma)),
        confidence: !usable || extrapolated ? "LOW" : model.sampleSize >= 30 ? "HIGH" : "MEDIUM",
        basis: !usable
          ? `Fitted on ${model.sampleSize} observed transfers, but they disagree by so much that the fit explains almost nothing about price. The band uses TouchlineOS's stated rating-and-age curve instead.`
          : extrapolated
            ? `Fitted on ${model.sampleSize} observed transfers in this save, but this player sits outside the ratings and ages that fit covers.`
            : `Fitted on ${model.sampleSize} observed transfers in this save, priced against rating, age and growth.`,
      };
    }

    // ---- The prior. Labelled as a prior, everywhere it is used. --------------------------------
    const mid = Math.exp(priorLnMid);
    return {
      low: tidy(mid * Math.exp(-BAND_SIGMA_MULTIPLIER * PRIOR_SIGMA)),
      mid: tidy(mid),
      high: tidy(mid * Math.exp(BAND_SIGMA_MULTIPLIER * PRIOR_SIGMA)),
      confidence: "LOW",
      basis:
        model.sampleSize === 0
          ? "No observed transfer in this save could be priced against a rating, so this is TouchlineOS's stated rating-and-age curve, not a measurement."
          : `Only ${model.sampleSize} observed transfer${model.sampleSize === 1 ? "" : "s"} in this save could be priced against a rating, which is too few to fit, so this is TouchlineOS's stated rating-and-age curve.`,
    };
  }
}

// ---------------------------------------------------------------------------
// The formatter. The ONLY legal way to render a valuation.
// ---------------------------------------------------------------------------

export interface ValueBandView {
  /** Compact band text, e.g. "£3.2-4.1M". Never a single figure. */
  text: string;
  /** Always true. A valuation is never a save fact, so it must always be tagged. */
  estimated: true;
  confidence: ValueConfidence;
  basis: string;
  /** Full-precision figures plus the basis, for a tooltip. */
  title: string;
}

function compact(value: number, symbol: string): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    const millions = Math.round((value / 1_000_000) * 10) / 10;
    return `${symbol}${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (absolute >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${Math.round(value)}`;
}

/**
 * Renders a band, tagged, with its basis.
 *
 * Deliberately the only money formatting for a valuation anywhere in the app. The search results
 * table shows 20 rows at a time and the pull toward one clean number per row is real - routing every
 * one of them through here is what makes that impossible rather than merely discouraged.
 */
export function describeValueBand(
  value: { low: number; mid: number; high: number; confidence: ValueConfidence; basis: string },
  symbol = "£"
): ValueBandView {
  const exact = `${symbol}${value.low.toLocaleString()} - ${symbol}${value.high.toLocaleString()}`;
  return {
    text: `${compact(value.low, symbol)}-${compact(value.high, symbol)}`,
    estimated: true,
    confidence: value.confidence,
    basis: value.basis,
    title: `Estimated ${exact} (midpoint ${symbol}${value.mid.toLocaleString()}). ${value.confidence} confidence. ${value.basis}`,
  };
}
