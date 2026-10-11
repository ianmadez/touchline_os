/**
 * League rules, as reference data.
 *
 * WHERE THIS COMES FROM, and it is not the save. Measured on a real career, the game ships no rules table:
 * nothing in the file states a squad limit, a spending cap or a licensing requirement. So this file is
 * AUTHORED, the same way the cup names are: real regulations as they are written and reported, one place to
 * correct them, and never presented as something read from the save.
 *
 * The screen therefore says "reference" wherever a figure from here appears, and the verdicts are only
 * worded as compliance when the career is being run in a strict realism mode. In a normal career the same
 * numbers are shown as context, because "your wage bill is 78% of turnover" is interesting even when nothing
 * is going to be deducted for it.
 *
 * HOMEGROWN QUOTAS ARE DELIBERATELY ABSENT. They are real rules, but the save does not record how long a
 * player has been at a club, so a homegrown check could only be fed by asking the manager to remember
 * something the game does not show him either. Asking for that is worse than leaving it out, so it is out.
 *
 * EDITING: change a number in this file and every screen follows. Nothing else reads these values.
 */

export type RuleUnit = "PERCENT" | "MONEY" | "COUNT";

export interface LeagueRule {
  id: string;
  /** What the rule is called, the way it is generally known. */
  label: string;
  unit: RuleUnit;
  /**
   * The figure the rule imposes. Null when the regulation exists but sets no fixed number, which is the
   * honest answer for a league that assesses each club individually: a made-up number would be worse than
   * a blank one.
   */
  limit: number | null;
  /** Who imposes it. */
  basis: string;
  /** One sentence of plain English, including what the figure means. */
  note: string;
  /** Which of the app's own figures this should be checked against. */
  against: "WAGE_BILL" | "SQUAD_SIZE" | "NET_SPEND" | "TRANSFER_BUDGET" | "WAGE_BUDGET" | null;
  /**
   * The tiers inside the parent set the rule applies to. Absent means every tier the set covers, which is
   * what a licensing requirement does. A top-flight finance rule names tier 1 and nothing else, because
   * handing a fourth-tier club a Premier League regulation would be worse than saying nothing.
   */
  tiers?: readonly number[];
}

export interface LeagueRuleSet {
  key: string;
  name: string;
  countryId: number;
  /** The save's own tier numbers this applies to. */
  tiers: readonly number[];
  squadSizeLimit: number | null;
  rules: readonly LeagueRule[];
}

const UEFA_SQUAD_COST: LeagueRule = {
  id: "uefa-squad-cost",
  label: "Squad cost ratio",
  unit: "PERCENT",
  limit: 70,
  basis: "UEFA club competitions",
  note: "Wages, transfer amortisation and agent fees may not exceed 70% of revenue for clubs in UEFA competition.",
  against: "WAGE_BILL",
  tiers: [1],
};

const UEFA_SQUAD_SIZE: LeagueRule = {
  id: "uefa-squad-size",
  label: "Competition squad",
  unit: "COUNT",
  limit: 25,
  basis: "UEFA club competitions",
  note: "A maximum of 25 players can be registered for the league phase.",
  against: "SQUAD_SIZE",
  tiers: [1],
};

/**
 * Keyed on the save's country id, then narrowed by tier, so a League Two club is not handed a Premier League
 * rule. The ids are the save's own nation ids, the same ones the nation table and the honours cabinet use.
 */
const RULE_SETS: readonly LeagueRuleSet[] = [
  {
    key: "england",
    name: "England",
    countryId: 14,
    tiers: [1, 2, 3, 4],
    squadSizeLimit: 25,
    rules: [
      {
        id: "eng-psr",
        label: "Profit and sustainability",
        unit: "MONEY",
        limit: 105_000_000,
        basis: "Premier League",
        note: "Top-flight clubs may lose up to £105m across a rolling three-year window.",
        against: null,
        tiers: [1],
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
      {
        id: "eng-efl-scmp",
        label: "Salary cost protocol",
        unit: "PERCENT",
        limit: 60,
        basis: "EFL League One and Two",
        note: "In the lower divisions, wages are limited to a share of turnover: 60% in League One, 50% in League Two.",
        against: "WAGE_BILL",
        tiers: [3, 4],
      },
      {
        id: "eng-championship-psr",
        label: "Championship sustainability",
        unit: "MONEY",
        limit: 39_000_000,
        basis: "EFL Championship",
        note: "Second-tier clubs may lose up to £39m across a rolling three-year window.",
        against: null,
        tiers: [2],
      },
    ],
  },
  {
    key: "spain",
    name: "Spain",
    countryId: 45,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "esp-squad-cost",
        label: "Squad cost limit",
        unit: "MONEY",
        limit: null,
        basis: "LaLiga",
        note: "LaLiga sets each club its own spending ceiling from its revenue. There is no single figure, so your own budget is what this is measured against.",
        against: "WAGE_BUDGET",
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "germany",
    name: "Germany",
    countryId: 21,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "ger-licensing",
        label: "Licensing",
        unit: "PERCENT",
        limit: null,
        basis: "DFL",
        note: "Clubs are licensed on financial health rather than a fixed cap. No percentage is published, so nothing here is scored against one.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "italy",
    name: "Italy",
    countryId: 27,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "ita-licensing",
        label: "Federal licensing",
        unit: "MONEY",
        limit: null,
        basis: "FIGC",
        note: "Clubs must satisfy solvency and overdue-payment tests at licensing. No expenditure ceiling is set.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "france",
    name: "France",
    countryId: 18,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "fra-dncg",
        label: "Financial control",
        unit: "PERCENT",
        limit: null,
        basis: "DNCG",
        note: "The DNCG reviews budgets, wages and accounts each season and can impose restrictions. It publishes no fixed ratio.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "netherlands",
    name: "Netherlands",
    countryId: 34,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "ned-licensing",
        label: "Licensing",
        unit: "MONEY",
        limit: null,
        basis: "KNVB",
        note: "Licensing is granted on financial criteria rather than a spending cap.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "portugal",
    name: "Portugal",
    countryId: 38,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "por-licensing",
        label: "Licensing",
        unit: "MONEY",
        limit: null,
        basis: "Liga Portugal",
        note: "Licensing is granted on financial criteria rather than a spending cap.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
  {
    key: "denmark",
    name: "Denmark",
    countryId: 13,
    tiers: [1, 2],
    squadSizeLimit: 25,
    rules: [
      {
        id: "den-licensing",
        label: "Licensing",
        unit: "MONEY",
        limit: null,
        basis: "Divisionsforeningen",
        note: "Clubs are licensed on financial criteria each season rather than against a published spending cap.",
        against: null,
      },
      UEFA_SQUAD_COST,
      UEFA_SQUAD_SIZE,
    ],
  },
];

/** The rules that apply to a club, from the country and tier the save records for its division. */
export interface ApplicableRules {
  /** The set this came from, named for the country. */
  league: string;
  countryId: number;
  /** The save's own tier number for the manager's division. */
  tier: number | null;
  /** True when the set names this tier explicitly rather than only covering the country. */
  tierCovered: boolean;
  squadSizeLimit: number | null;
  /** The rules that apply to this tier, in the order a manager would care about them. */
  rules: readonly LeagueRule[];
}

export function rulesForLeague(countryId: number | null, tier: number | null): ApplicableRules | null {
  if (countryId === null) return null;
  const set = RULE_SETS.find((entry) => entry.countryId === countryId);
  if (!set) return null;

  const tierCovered = tier !== null && set.tiers.includes(tier);
  const rules = set.rules.filter((rule) => {
    const applies = rule.tiers ?? set.tiers;
    if (tier === null) return rule.tiers === undefined;
    return applies.includes(tier);
  });

  return {
    league: set.name,
    countryId: set.countryId,
    tier,
    tierCovered,
    squadSizeLimit: tierCovered ? set.squadSizeLimit : null,
    rules,
  };
}

/** Every rule set, for a screen that wants to show what is on file. */
export function allRuleSets(): readonly LeagueRuleSet[] {
  return RULE_SETS;
}

/** How many leagues the reference data covers, for the honesty line in the UI. */
export function ruleSetCount(): number {
  return RULE_SETS.length;
}
