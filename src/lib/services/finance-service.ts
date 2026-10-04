/**
 * The financial model - the EASY half of Module 0.3.1.
 *
 * Three rules hold this together, and the first is the one that matters most:
 *
 * 1. **A zero budget means UNKNOWN, not "broke".** The live transfer and wage budgets are kept in
 *    memory and writes ZEROS to the save (verified on the reference career: `transfer_budget = 0`,
 *    `wage_budget = 0`, while `total_earnings`, `record_buy` and `record_sale` are all real). Printing
 *    "£0 available" from that would be a fabricated fact, so a zero (or a missing column) is returned
 *    as `null` and every caller must render it as unknown.
 *
 * 2. **Nothing here is a save fact except the numbers the save actually carries.** The raw budgets,
 *    total earnings and record fees are SAVE facts and are passed through untouched. Everything else -
 *    the tier revenue benchmark, the wage-to-turnover ratio, the contract liability - is derived and
 *    labelled `DERIVED_ESTIMATE`.
 *
 * 3. **Advisory only.** The realism level picks the advisory threshold a wage bill is judged
 *    against. It never changes a figure and it never writes back.
 *    (65% strict vs 85% relaxed) and cannot scale a save value.
 *
 * No database writes: this is a read model, computed on demand. That is why the whole module is
 * "easy" - it adds no schema, no migration and no lifecycle.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, careers, careerFinanceInputs, clubFinances, leagues, players } from "../db/schema";
import { ADVISORY_THRESHOLDS, realismModeOf, type RealismMode } from "../realism";

/** Where a number came from. Mirrors the app's SAVE/DERIVED discipline, with the estimate called out. */
export type EstimateProvenance = "SAVE" | "DERIVED_ESTIMATE" | "USER";

/**
 * The two budgets the save refuses to carry.
 *
 * Neither budget is stored in the save file, so there is nothing to read.
 * no fact to read. Rather than print an apology, the app lets the manager state the numbers - an
 * entered figure is information, where an "unavailable" note is only an absence.
 */
export interface FinanceInputs {
  transferBudget: number | null;
  wageBudget: number | null;
  notes: string | null;
  updatedAt: string | null;
}

/** How a derived figure should be read. `OVER` is the only one that wants attention. */
export type AdvisoryLevel = "OK" | "WATCH" | "OVER";

export interface Advisory {
  level: AdvisoryLevel;
  headline: string;
  detail: string;
}

/**
 * League-tier revenue benchmarks.
 *
 * These are TOUCHLINEOS MODEL ESTIMATES, not save data: the save carries no revenue anywhere, so a
 * wage-to-turnover ratio needs a denominator from somewhere and this is it. Keyed by
 * `leagues.level` (the tier the save itself records), which is 1 for a top division down to 4.
 *
 * Deliberately coarse. A precise per-club revenue would be a fabricated precision, and the honest
 * job here is only to answer "is this wage bill large for this division?" - a question a tier
 * benchmark answers well enough to be useful and honestly enough to be caveated.
 */
const TIER_REVENUE_ESTIMATE: Record<number, number> = {
  1: 300_000_000,
  2: 40_000_000,
  3: 12_000_000,
  4: 6_000_000,
};
const FALLBACK_TIER_REVENUE = 8_000_000;

const WEEKS_PER_YEAR = 52;

export interface ContractLiabilityRow {
  /** The season ordinal the commitment falls in. */
  season: number;
  seasonLabel: string;
  /** Annual wage still committed for that season, in the app's currency. */
  committedAnnualWage: number;
  /** How many players are still under contract for it. */
  playersUnderContract: number;
}

export interface NetSpendResult {
  available: boolean;
  reason?: string;
  bought?: number;
  sold?: number;
  net?: number;
}

export interface FinanceReport {
  currency: string;
  wageFormat: "WEEKLY" | "ANNUAL";
  tier: number | null;
  tierLabel: string | null;

  /** SAVE facts, passed through. `null` means the save wrote 0, which is UNKNOWN, not zero. */
  transferBudget: number | null;
  wageBudget: number | null;
  /** Where each of the two budgets came from, so the UI can badge it honestly. Null = nobody knows. */
  transferBudgetSource: "SAVE" | "USER" | null;
  wageBudgetSource: "SAVE" | "USER" | null;
  totalEarnings: number | null;
  recordBuy: number | null;
  recordSale: number | null;

  /** DERIVED_ESTIMATE. */
  squadWeeklyWage: number;
  squadAnnualWage: number;
  estimatedTierRevenue: number;
  /** Annual wage bill divided by the tier revenue estimate. Null when there are no wages at all. */
  wageToTurnover: number | null;
  wageTurnoverAdvisory: Advisory | null;
  contractLiability: ContractLiabilityRow[];
  /** Contract liability one season out, over the tier estimate - the shape a board would ask about. */
  nextSeasonLiabilityToTurnover: number | null;
  /**
   * Which strictness band the career's realism level falls into. Advisory only: it selects the
   * threshold a wage bill is judged against, and labels nothing that came from the save.
   */
  realismMode: RealismMode;
  netSpend: NetSpendResult;

  /** Every figure the manager has stated for this career, for the editable cards. */
  inputs: FinanceInputs;
  provenance: {
    transferBudget: EstimateProvenance;
    wageBudget: EstimateProvenance;
    squadWeeklyWage: EstimateProvenance;
    estimatedTierRevenue: EstimateProvenance;
    wageToTurnover: EstimateProvenance;
    contractLiability: EstimateProvenance;
  };
  /** One line per figure the save does not support, so the UI can say so instead of guessing. */
  unavailable: string[];
}

/** A zero from the save means "not recorded", so it reads as unknown rather than as zero. */
function saveAmount(value: number | null | undefined): number | null {
  return value === null || value === undefined || value === 0 ? null : value;
}

export class FinanceService {
  async getReport(careerId: string): Promise<FinanceReport | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const [finances, settings, tierRow, squad, inputsRow] = await Promise.all([
      db.select().from(clubFinances).where(eq(clubFinances.careerId, careerId)).get(),
      db.select().from(appSettings).get(),
      career.leagueId === null
        ? Promise.resolve(undefined)
        : db
            .select()
            .from(leagues)
            .where(and(eq(leagues.careerId, careerId), eq(leagues.leagueId, career.leagueId)))
            .get(),
      db.select().from(players).where(eq(players.careerId, careerId)),
      db.select().from(careerFinanceInputs).where(eq(careerFinanceInputs.careerId, careerId)).get(),
    ]);

    return this.build(career.currentSeason, career, finances, settings, tierRow, squad, inputsRow);
  }

  /**
   * Records the two budgets the save does not carry.
   *
   * USER provenance throughout: these are the manager's own figures, and no surface may present them
   * as something the file said. An omitted key keeps whatever was there before; an explicit null
   * clears it.
   */
  async saveInputs(
    careerId: string,
    patch: { transferBudget?: number | null; wageBudget?: number | null; notes?: string | null }
  ): Promise<FinanceInputs> {
    const existing = await db
      .select()
      .from(careerFinanceInputs)
      .where(eq(careerFinanceInputs.careerId, careerId))
      .get();

    const values = {
      transferBudget:
        patch.transferBudget === undefined ? existing?.transferBudget ?? null : patch.transferBudget,
      wageBudget: patch.wageBudget === undefined ? existing?.wageBudget ?? null : patch.wageBudget,
      notes: patch.notes === undefined ? existing?.notes ?? null : patch.notes,
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.update(careerFinanceInputs).set(values).where(eq(careerFinanceInputs.id, existing.id));
    } else {
      await db.insert(careerFinanceInputs).values({
        id: crypto.randomUUID(),
        careerId,
        provenance: "USER",
        ...values,
      });
    }

    return {
      transferBudget: values.transferBudget,
      wageBudget: values.wageBudget,
      notes: values.notes,
      updatedAt: values.updatedAt,
    };
  }

  /**
   * Pure assembly, kept separate from the queries so it can be driven from a fixture in a gate test.
   */
  build(
    currentSeason: number,
    career: typeof careers.$inferSelect,
    finances: typeof clubFinances.$inferSelect | undefined,
    settings: typeof appSettings.$inferSelect | undefined,
    tierRow: typeof leagues.$inferSelect | undefined,
    squad: (typeof players.$inferSelect)[],
    inputsRow?: typeof careerFinanceInputs.$inferSelect
  ): FinanceReport {
    const currency = settings?.currencySymbol ?? "GBP";
    const wageFormat = (settings?.wageFormat === "ANNUAL" ? "ANNUAL" : "WEEKLY") as
      | "WEEKLY"
      | "ANNUAL";
    const tier = tierRow?.level ?? null;
    const estimatedTierRevenue =
      tier !== null ? (TIER_REVENUE_ESTIMATE[tier] ?? FALLBACK_TIER_REVENUE) : FALLBACK_TIER_REVENUE;

    const paid = squad.filter((player) => (player.wage ?? 0) > 0);
    const squadWeeklyWage = paid.reduce((sum, player) => sum + (player.wage ?? 0), 0);
    const squadAnnualWage =
      wageFormat === "WEEKLY" ? squadWeeklyWage * WEEKS_PER_YEAR : squadWeeklyWage;

    const wageToTurnover = squadAnnualWage > 0 ? squadAnnualWage / estimatedTierRevenue : null;
    // The advisory line comes from the realism level, and it only ever moves the THRESHOLD - the
    // figures it is applied to are untouched save facts regardless of the mode.
    const mode = realismModeOf(settings?.realismLevel);
    const thresholds = ADVISORY_THRESHOLDS[mode];

    let wageTurnoverAdvisory: Advisory | null = null;
    if (wageToTurnover !== null) {
      const pct = (value: number) => `${Math.round(value * 100)}%`;
      if (wageToTurnover >= thresholds.wageTurnoverCritical) {
        wageTurnoverAdvisory = {
          level: "OVER",
          headline: "Wage bill over the safe share of turnover",
          detail: `The squad's annual wage bill is about ${pct(
            wageToTurnover
          )} of the estimated revenue for this tier (the limit is ${pct(
            thresholds.wageTurnoverCritical
          )}). The revenue figure is a Touchline model estimate, not save data.`,
        };
      } else if (wageToTurnover >= thresholds.wageTurnoverWarning) {
        wageTurnoverAdvisory = {
          level: "WATCH",
          headline: "Wage bill approaching the safe share of turnover",
          detail: `About ${pct(wageToTurnover)} of estimated tier revenue, against a warning line of ${pct(
            thresholds.wageTurnoverWarning
          )}. Estimated revenue is a Touchline model figure.`,
        };
      } else {
        wageTurnoverAdvisory = {
          level: "OK",
          headline: "Wage bill within the safe share of turnover",
          detail: `About ${pct(wageToTurnover)} of estimated tier revenue, under the warning line of ${pct(
            thresholds.wageTurnoverWarning
          )}.`,
        };
      }
    }

    const contractLiability: ContractLiabilityRow[] = [];
    for (let offset = 0; offset < 3; offset += 1) {
      const season = currentSeason + offset;
      const committed = paid.filter(
        (player) => (player.contractValidUntil ?? 0) >= season
      );
      contractLiability.push({
        season,
        seasonLabel: `Season ${season}`,
        committedAnnualWage: committed.reduce((sum, player) => sum + (player.wage ?? 0), 0) *
          (wageFormat === "WEEKLY" ? WEEKS_PER_YEAR : 1),
        playersUnderContract: committed.length,
      });
    }

    const nextSeason = contractLiability[1] ?? contractLiability[0];
    const nextSeasonLiabilityToTurnover =
      nextSeason && estimatedTierRevenue > 0
        ? nextSeason.committedAnnualWage / estimatedTierRevenue
        : null;

    const inputs: FinanceInputs = {
      transferBudget: inputsRow?.transferBudget ?? null,
      wageBudget: inputsRow?.wageBudget ?? null,
      notes: inputsRow?.notes ?? null,
      updatedAt: inputsRow?.updatedAt ?? null,
    };

    // The save wins where it actually carries a figure; the manager's own number fills the gap the
    // file leaves. `??` rather than `||`, so an entered zero stays a deliberate zero instead of
    // reading as unset.
    const saveTransferBudget = saveAmount(finances?.transferBudget);
    const saveWageBudget = saveAmount(finances?.wageBudget);
    const transferBudgetSource: "SAVE" | "USER" | null =
      saveTransferBudget !== null ? "SAVE" : inputs.transferBudget !== null ? "USER" : null;
    const wageBudgetSource: "SAVE" | "USER" | null =
      saveWageBudget !== null ? "SAVE" : inputs.wageBudget !== null ? "USER" : null;

    // Only two gaps remain worth naming, and both are now closable by the manager typing a number -
    // so this list is a to-do rather than a set of apologies.
    const unavailable: string[] = [];
    if (transferBudgetSource === null) {
      unavailable.push("Transfer budget: the save writes 0 and you have not entered one");
    }
    if (wageBudgetSource === null) {
      unavailable.push("Wage budget: the save writes 0 and you have not entered one");
    }

    return {
      realismMode: mode,
      currency,
      wageFormat,
      tier,
      tierLabel: tierRow?.name ?? null,
      transferBudget: saveTransferBudget ?? inputs.transferBudget,
      wageBudget: saveWageBudget ?? inputs.wageBudget,
      transferBudgetSource,
      wageBudgetSource,
      totalEarnings: saveAmount(finances?.totalEarnings),
      recordBuy: saveAmount(finances?.recordBuy),
      recordSale: saveAmount(finances?.recordSale),
      squadWeeklyWage,
      squadAnnualWage,
      estimatedTierRevenue,
      wageToTurnover,
      wageTurnoverAdvisory,
      contractLiability,
      nextSeasonLiabilityToTurnover,
      netSpend: {
        // Deliberately unavailable rather than 0: on the reference career only 1 of 38 observed deals
        // involves our club, so a net-spend figure would be arithmetic dressed up as evidence.
        available: false,
        reason:
          "Fewer than three observed deals involve this club, so a net-spend figure would not be evidence.",
      },
      inputs,
      provenance: {
        transferBudget: transferBudgetSource === "USER" ? "USER" : "SAVE",
        wageBudget: wageBudgetSource === "USER" ? "USER" : "SAVE",
        squadWeeklyWage: "SAVE",
        estimatedTierRevenue: "DERIVED_ESTIMATE",
        wageToTurnover: "DERIVED_ESTIMATE",
        contractLiability: "DERIVED_ESTIMATE",
      },
      unavailable,
    };
  }
}
