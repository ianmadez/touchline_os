/**
 * League rules, checked against what is actually on file.
 *
 * THE HONESTY PROBLEM THIS SOLVES. A rule set is easy to write down; deciding whether a club is inside it
 * is not, because the save carries no turnover, no profit figure and no loss figure. So every rule resolves
 * to one of four states, and the state is printed rather than hidden:
 *
 *   OK              we had both sides and the club is inside the line
 *   OVER            we had both sides and the club is past the line
 *   REFERENCE_ONLY  the rule is real, but the figure it is judged on is not in the save
 *   NO_DATA         nothing to compare and no line to compare it to
 *
 * WHERE EACH THING COMES FROM. The squad size and the wage bill are save facts. The club's division, country
 * and tier are save facts. The rule and its limit come from the authored reference file. The tier revenue
 * the percentage rules are divided into is the app's own estimate, which is why a percentage verdict says so
 * in the same sentence as the verdict.
 *
 * STRICT REALISM DECIDES THE WORDING, NOT THE NUMBERS. In strict mode these read as checks with a verdict.
 * Elsewhere the same comparisons are shown as context, because "your wage bill is 78% of the tier estimate"
 * is worth knowing even when nothing is going to be deducted for it.
 *
 * NO HOMEGROWN QUOTA, deliberately: the save records no time-at-club, so it could only be filled in by
 * asking the manager to remember something the game does not show him either.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { appSettings, careers, careerFinanceInputs, leagues, players } from "../db/schema";
import { rulesForLeague, type LeagueRule, type RuleUnit } from "../finance/league-rules";
import { realismModeOf, type RealismMode } from "../realism";
import { TransferLedgerService } from "./transfer-ledger-service";

export type RuleStatus = "OK" | "OVER" | "REFERENCE_ONLY" | "NO_DATA";

export interface RuleVerdict {
  ruleId: string;
  label: string;
  basis: string;
  note: string;
  unit: RuleUnit;
  /** The authored limit. Null when the regulation sets no fixed figure. */
  limit: number | null;
  /** The app's own figure the rule was measured against, when there was one. */
  observed: number | null;
  status: RuleStatus;
  /** Where the observed figure came from, so a verdict can never be read as save data by accident. */
  observedSource: "SAVE" | "USER" | "DERIVED_ESTIMATE" | null;
  /** One sentence covering the comparison and its caveat, or the reason there was no comparison. */
  detail: string;
}

export interface FinanceRulesReport {
  divisionName: string | null;
  tier: number | null;
  /** The authored set's country name, null when the country has no reference data on file. */
  coverage: string | null;
  realismMode: RealismMode;
  /** True only in strict realism: the difference between a check and a bit of context. */
  enforced: boolean;
  coverageNote: string;
  verdicts: RuleVerdict[];
  figures: {
    squadSize: number;
    squadWeeklyWage: number;
    squadAnnualWage: number;
    netSpend: number | null;
    transferBudget: number | null;
    wageBudget: number | null;
  };
  /** Lines the screen prints under the table, so the provenance is never only implied. */
  notes: string[];
}

const WEEKS_PER_YEAR = 52;

export class FinanceRulesService {
  async getReport(careerId: string): Promise<FinanceRulesReport | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const [settings, division, squad, inputs, ledger] = await Promise.all([
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
      new TransferLedgerService().getLedger(careerId),
    ]);

    const wageFormat = settings?.wageFormat === "ANNUAL" ? "ANNUAL" : "WEEKLY";
    const tier = division?.level ?? null;
    const applicable = rulesForLeague(division?.countryId ?? null, tier);

    const paid = squad.filter((player) => (player.wage ?? 0) > 0);
    const squadWeeklyWage = paid.reduce((total, player) => total + (player.wage ?? 0), 0);
    const squadAnnualWage = wageFormat === "WEEKLY" ? squadWeeklyWage * WEEKS_PER_YEAR : squadWeeklyWage;
    const squadSize = squad.length;

    const mode = realismModeOf(settings?.realismLevel);
    const enforced = mode === "STRICT";

    const transferBudget = positiveOrNull(inputs?.transferBudget);
    const wageBudget = positiveOrNull(inputs?.wageBudget);
    // Fees alone, deliberately: a transfer budget is measured against transfer spend, and a loan's wages are
    // not transfer spend. The screen's own totals include them, which is a different question.
    const netSpend = ledger && !ledger.empty ? ledger.feeTotals.net : null;

    // The tier estimate the percentage rules divide into is the app's own model, not a save figure. It is
    // deliberately coarse: a precise per-club revenue would be invented precision.
    const tierRevenue = tier === null ? 8_000_000 : (TIER_REVENUE[tier] ?? 8_000_000);

    const verdicts: RuleVerdict[] = [];

    for (const rule of applicable?.rules ?? []) {
      verdicts.push(checkRule(rule, { squadSize, squadAnnualWage, tierRevenue, wageBudget }));
    }

    // Two checks the app owns rather than a league: the manager's own two budgets. Both are always shown,
    // even when no budget has been entered, because the empty line is the invitation to enter one - and
    // because a stored zero is treated as "not stated", which is what the finance model already does with
    // a zero the save writes.
    verdicts.push(
      budgetCheck({
        ruleId: "app-transfer-budget",
        label: "Against your transfer budget",
        note: "Net spend on fees in the ledger compared with the transfer budget you entered in Finance.",
        limit: transferBudget,
        observed: netSpend,
        observedSource: "USER",
        unit: "MONEY",
        over: netSpend !== null && transferBudget !== null && netSpend > transferBudget,
        unset: netSpend === null
          ? "No deal is on the ledger yet, so there is no net spend to compare. Add one and this line fills in."
          : "No transfer budget has been entered, so there is no line to check net spend against. Net spend currently reads as money in, because this club has received more than it has paid.",
        ok: "Net spend is inside the budget you entered. Both sides of this line are your own figures.",
        verdict: "Net spend is past the budget you entered. Both sides of this line are your own figures.",
      }),
      budgetCheck({
        ruleId: "app-wage-budget",
        label: "Against your wage budget",
        note: "The squad's saved wage bill compared with the wage budget you entered in Finance.",
        limit: wageBudget,
        observed: squadWeeklyWage,
        observedSource: "SAVE",
        unit: "MONEY",
        over: wageBudget !== null && squadWeeklyWage > wageBudget,
        unset: squadWeeklyWage === 0
          ? "The save carries no wages for this squad, so there is nothing to compare."
          : "No wage budget has been entered, so there is no line to check the bill against. The saved bill is above.",
        ok: "The saved wage bill is inside the budget you entered. The bill is a save fact; the budget is yours.",
        verdict:
          "The saved wage bill is past the budget you entered. The bill is a save fact; the budget is yours.",
      })
    );

    const notes: string[] = [];
    if (!applicable) {
      notes.push(
        "No authored rule set covers this league yet, so nothing here is a league rule. The reference data lives in one file and can be extended."
      );
    } else {
      notes.push(
        `${applicable.league} rules are authored reference data, not read from the save. Your division is ${division?.name ?? "unknown"} (tier ${tier ?? "unknown"}).`
      );
      if (!applicable.tierCovered) {
        notes.push(
          "The reference data does not cover this tier of that country, so only the country-wide rules are shown."
        );
      }
      if (!enforced) {
        notes.push(
          "Realism is not set to strict, so these are shown as context rather than as checks. Nothing is judged."
        );
      }
    }
    notes.push(
      "Squad size and wage bill are save facts. The revenue a percentage rule divides into is the app's own tier estimate, because the save carries no revenue."
    );
    notes.push("Homegrown quotas are left out on purpose: the save records no time at club, so they cannot be checked honestly.");

    return {
      divisionName: division?.name ?? null,
      tier,
      coverage: applicable?.league ?? null,
      realismMode: mode,
      enforced,
      coverageNote: applicable
        ? `${applicable.rules.length} rule${applicable.rules.length === 1 ? "" : "s"} on file for ${applicable.league}.`
        : "No rule set on file for this league.",
      verdicts,
      figures: {
        squadSize,
        squadWeeklyWage,
        squadAnnualWage,
        netSpend,
        transferBudget,
        wageBudget,
      },
      notes,
    };
  }
}

/** Coarse tier revenue benchmarks, matching the finance model's own scale. Estimates, not save data. */
const TIER_REVENUE: Record<number, number> = {
  1: 300_000_000,
  2: 40_000_000,
  3: 12_000_000,
  4: 6_000_000,
};

/**
 * A budget the manager stated, or null.
 *
 * A stored zero reads as not stated, which is the stance the finance model already takes with a zero the
 * save writes: nobody plans a wage budget of nothing, so a checked line against zero would be a complaint
 * about an empty field rather than about the club.
 */
function positiveOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || value <= 0 ? null : value;
}

interface BudgetCheckInput {
  ruleId: string;
  label: string;
  note: string;
  limit: number | null;
  observed: number | null;
  observedSource: "SAVE" | "USER";
  unit: RuleUnit;
  over: boolean;
  unset: string;
  ok: string;
  verdict: string;
}

/** One of the two app-owned checks, so the shape and the statuses cannot drift apart. */
function budgetCheck(input: BudgetCheckInput): RuleVerdict {
  const nothingToCompare = input.limit === null || input.observed === null || input.observed === 0;
  return {
    ruleId: input.ruleId,
    label: input.label,
    basis: "Your own figure",
    note: input.note,
    unit: input.unit,
    limit: input.limit,
    observed: input.observed,
    observedSource: nothingToCompare ? null : input.observedSource,
    status: nothingToCompare ? "NO_DATA" : input.over ? "OVER" : "OK",
    detail: nothingToCompare ? input.unset : input.over ? input.verdict : input.ok,
  };
}

interface Observations {
  squadSize: number;
  squadAnnualWage: number;
  tierRevenue: number;
  wageBudget: number | null;
}

function checkRule(rule: LeagueRule, observed: Observations): RuleVerdict {
  const base = {
    ruleId: rule.id,
    label: rule.label,
    basis: rule.basis,
    note: rule.note,
    unit: rule.unit,
    limit: rule.limit,
  };

  if (rule.against === "SQUAD_SIZE" && rule.limit !== null) {
    const over = observed.squadSize > rule.limit;
    return {
      ...base,
      observed: observed.squadSize,
      observedSource: "SAVE",
      status: over ? "OVER" : "OK",
      detail: over
        ? `${observed.squadSize} players are on the books against a limit of ${rule.limit}. The squad count is a save fact.`
        : `${observed.squadSize} players are on the books, inside the limit of ${rule.limit}. The squad count is a save fact.`,
    };
  }

  if (rule.against === "WAGE_BILL" && rule.limit !== null && rule.unit === "PERCENT") {
    if (observed.squadAnnualWage === 0) {
      return {
        ...base,
        observed: null,
        observedSource: null,
        status: "NO_DATA",
        detail: "The save carries no wages for this squad, so there is no bill to measure.",
      };
    }
    const ratio = observed.squadAnnualWage / observed.tierRevenue;
    const over = ratio > rule.limit / 100;
    return {
      ...base,
      observed: Math.round(ratio * 1000) / 10,
      // The percentage is the app's arithmetic over an estimated denominator, so it says so on the row.
      observedSource: "DERIVED_ESTIMATE",
      status: over ? "OVER" : "OK",
      detail: over
        ? `The annual bill is about ${Math.round(ratio * 100)}% of the tier revenue estimate, past the ${rule.limit}% line. The bill is a save fact; the revenue it is divided by is the app's estimate.`
        : `The annual bill is about ${Math.round(ratio * 100)}% of the tier revenue estimate, inside the ${rule.limit}% line. The bill is a save fact; the revenue it is divided by is the app's estimate.`,
    };
  }

  if (rule.against === "WAGE_BUDGET" && observed.wageBudget !== null) {
    const annualBudget = observed.wageBudget * WEEKS_PER_YEAR;
    const ratio = annualBudget > 0 ? observed.squadAnnualWage / annualBudget : null;
    if (ratio === null) {
      return {
        ...base,
        observed: null,
        observedSource: null,
        status: "NO_DATA",
        detail: "The wage budget on file is zero, so there is no line to measure the bill against.",
      };
    }
    return {
      ...base,
      observed: Math.round(ratio * 1000) / 10,
      observedSource: "DERIVED_ESTIMATE",
      status: ratio > 1 ? "OVER" : "OK",
      detail:
        ratio > 1
          ? `The annual bill is about ${Math.round(ratio * 100)}% of the wage budget you entered. The bill is a save fact; the budget is yours.`
          : `The annual bill is about ${Math.round(ratio * 100)}% of the wage budget you entered. The bill is a save fact; the budget is yours.`,
    };
  }

  // Anything left is a real regulation whose own input is not in the file: a loss figure, a turnover, or a
  // club-specific limit the league sets privately. Said plainly rather than scored against a guess.
  return {
    ...base,
    observed: null,
    observedSource: null,
    status: "REFERENCE_ONLY",
    detail: missingBasis(rule),
  };
}

function missingBasis(rule: LeagueRule): string {
  if (rule.limit === null && rule.against === "WAGE_BUDGET") {
    return "This league sets the limit per club, so there is no fixed figure to check. Enter a wage budget in Finance and the bill is measured against that instead.";
  }
  if (rule.unit === "MONEY") {
    return "Checking this needs a profit or loss figure, and the save carries none, so the rule is listed for reference only.";
  }
  return "Nothing on file supports a comparison for this rule, so it is listed for reference only.";
}
