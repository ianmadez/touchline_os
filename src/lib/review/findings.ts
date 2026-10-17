/**
 * The rule table.
 *
 * EVERY RULE IS A DECLARATION, NOT A SENTENCE. A rule says which fields it needs, how many matches it needs them
 * for, and what it does when they are missing. That is what keeps the review honest on a block of group logged
 * matches: there are no figures in it, so every rule that needs a figure declines, and the review reads as a
 * scoreline report rather than a report full of zeroes.
 *
 * NO RULE CLAIMS A CAUSE. Every headline states what was counted, every finding carries at least one confound,
 * and the words for a mechanism are deliberately absent from this file. A manager reading "late goals" is being
 * told what happened, not why.
 */
import { weaknessFamily } from "../events/weakness-family";
import { formationDisplayName, sameFormationFamily } from "../events/tactics-stamp";
import { ordinal } from "../ui/format";
import { strengthOf } from "./window";
import type { Finding, ReviewContext, ReviewMatch } from "./types";

/** The fields a rule reads, so the review can say what it needed when it says nothing. */
export type NeededField = "expectedGoals" | "shots" | "possession" | "contributions" | "timing" | "weakness" | "formation";

export interface Rule {
  id: string;
  needs: NeededField[];
  /** True when the finding is only possible with a figure a block row cannot carry. */
  needsFigures: boolean;
  evaluate: (matches: ReviewMatch[], context: ReviewContext) => Finding | null;
}

function scored(matches: ReviewMatch[]): ReviewMatch[] {
  return matches.filter((match) => match.goalsFor !== null && match.goalsAgainst !== null);
}

function withFigure(matches: ReviewMatch[], pick: (match: ReviewMatch) => number | null): Array<{ match: ReviewMatch; value: number }> {
  const out: Array<{ match: ReviewMatch; value: number }> = [];
  for (const match of matches) {
    const value = pick(match);
    if (value !== null) out.push({ match, value });
  }
  return out;
}

function resultWord(points: 0 | 1 | 3 | null): string {
  if (points === 3) return "won";
  if (points === 1) return "drew";
  return "lost";
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

const NO_CAUSE = [
  "Opponent strength is not part of this window.",
  "A window this size turns on one match.",
];

/** 1. Result against underlying performance. */
const resultAgainstPerformance: Rule = {
  id: "result-against-performance",
  needs: ["expectedGoals"],
  needsFigures: true,
  evaluate: (matches) => {
    const rows = withFigure(scored(matches), (match) => match.figures.expectedGoals);
    if (rows.length < 3) return null;
    const goals = rows.reduce((total, row) => total + (row.match.goalsFor ?? 0), 0);
    const expected = rows.reduce((total, row) => total + row.value, 0);
    const edge = goals - expected;
    const tone = edge >= 1 ? "GOOD" : edge <= -1 ? "BAD" : "NEUTRAL";
    const headline =
      tone === "GOOD"
        ? `The goals are ahead of the chances across ${rows.length} matches with a figure.`
        : tone === "BAD"
          ? `The goals are behind the chances across ${rows.length} matches with a figure.`
          : `The goals and the chances are level across ${rows.length} matches with a figure.`;
    return {
      id: "result-against-performance",
      tone,
      headline,
      detail: `${goals} scored against ${round1(expected)} expected, a difference of ${edge >= 0 ? "+" : ""}${round1(edge)}.`,
      strength: strengthOf(rows.length),
      needsFigures: true,
      matchIds: rows.map((row) => row.match.id),
      confounds: [
        "The expected goals figure describes the chances, not who took them.",
        ...NO_CAUSE,
      ],
    };
  },
};

/** 2. Best result against worst performance. */
const bestResultWorstPerformance: Rule = {
  id: "best-result-worst-performance",
  needs: ["expectedGoals", "shots"],
  needsFigures: true,
  evaluate: (matches) => {
    const rows = withFigure(scored(matches), (match) =>
      match.figures.expectedGoals !== null && match.figures.shots !== null ? match.figures.expectedGoals : null
    );
    if (rows.length < 3) return null;
    const best = [...rows].sort(
      (left, right) =>
        (right.match.points ?? 0) - (left.match.points ?? 0) ||
        (right.match.goalsFor ?? 0) - (right.match.goalsAgainst ?? 0) - ((left.match.goalsFor ?? 0) - (left.match.goalsAgainst ?? 0))
    )[0];
    const thinnest = [...rows].sort((left, right) => left.value - right.value)[0];
    if (best.match.id === thinnest.match.id) {
      return {
        id: "best-result-worst-performance",
        tone: "NEUTRAL",
        headline: "The best result and the thinnest performance are the same match.",
        detail: `${best.match.opponent}: ${resultWord(best.match.points)}, ${round1(best.value)} expected.`,
        strength: strengthOf(rows.length),
        needsFigures: true,
        matchIds: [best.match.id],
        confounds: ["One match carrying both facts is a coincidence of a small sample.", ...NO_CAUSE],
      };
    }
    return {
      id: "best-result-worst-performance",
      tone: "NEUTRAL",
      headline: "The best result did not come from the strongest performance.",
      detail: `Best result: ${best.match.opponent}, ${resultWord(best.match.points)} at ${round1(best.value)} expected. Thinnest: ${thinnest.match.opponent}, ${resultWord(thinnest.match.points)} at ${round1(thinnest.value)} expected.`,
      strength: strengthOf(rows.length),
      needsFigures: true,
      matchIds: [best.match.id, thinnest.match.id],
      confounds: [
        "Both matches had their own opposition and their own game state.",
        "A result and a performance measure two different things.",
        ...NO_CAUSE,
      ],
    };
  },
};

/** 3. Scoring spread and dependence. */
const scoringSpread: Rule = {
  id: "scoring-spread",
  needs: ["contributions"],
  needsFigures: false,
  evaluate: (matches) => {
    const rows = matches.filter((match) => match.contributions.length > 0);
    if (rows.length === 0) return null;
    const byPlayer = new Map<string, number>();
    for (const match of rows) {
      for (const entry of match.contributions) {
        byPlayer.set(entry.playerName, (byPlayer.get(entry.playerName) ?? 0) + entry.goals);
      }
    }
    const total = [...byPlayer.values()].reduce((sum, value) => sum + value, 0);
    if (total < 3) return null;
    const [topName, topGoals] = [...byPlayer.entries()].sort((left, right) => right[1] - left[1])[0];
    const share = topGoals / total;
    return {
      id: "scoring-spread",
      tone: "NEUTRAL",
      headline:
        share >= 0.5
          ? `${topName} scored ${topGoals} of the ${total} goals you logged.`
          : `The ${total} goals you logged are spread across ${byPlayer.size} players.`,
      detail:
        share >= 0.5
          ? "Half or more of the logged goals came from one player."
          : `Most: ${topName}, ${topGoals} of ${total}.`,
      strength: strengthOf(rows.length),
      needsFigures: false,
      matchIds: rows.map((match) => match.id),
      confounds: [
        "Only goals you named a scorer for are counted.",
        "A squad with one regular starter up front will always look concentrated.",
      ],
    };
  },
};

/** 4. Goals conceded timing. */
const concessionTiming: Rule = {
  id: "concession-timing",
  needs: ["timing"],
  needsFigures: false,
  evaluate: (matches) => {
    const timed = matches.flatMap((match) => match.concededMinutes);
    if (timed.length < 3) return null;
    const late = timed.filter((minute) => minute >= 75).length;
    return {
      id: "concession-timing",
      tone: late >= 2 ? "BAD" : "NEUTRAL",
      headline: `${late} of the ${timed.length} timed goals against came after the 75th minute.`,
      detail: late >= 2 ? "Most of the timed damage arrived late." : "The timed goals are spread through the match.",
      strength: strengthOf(timed.length),
      needsFigures: false,
      matchIds: matches.filter((match) => match.concededMinutes.length > 0).map((match) => match.id),
      confounds: [
        "Only goals you entered a minute for are counted.",
        "Late goals arrive when a side is chasing a game as well as when it is defending one.",
      ],
    };
  },
};

/** 5. Recurring weakness, through the shared family table. */
const recurringWeakness: Rule = {
  id: "recurring-weakness",
  needs: ["weakness"],
  needsFigures: false,
  evaluate: (matches) => {
    const noted = matches.filter((match) => match.weakness !== null);
    if (noted.length < 3) return null;
    const counts = new Map<string, { line: string; matches: ReviewMatch[] }>();
    for (const match of noted) {
      const family = weaknessFamily(match.weakness ?? "");
      if (family === null) continue;
      const entry = counts.get(family.key) ?? { line: family.line, matches: [] };
      entry.matches.push(match);
      counts.set(family.key, entry);
    }
    const top = [...counts.entries()].sort((left, right) => right[1].matches.length - left[1].matches.length)[0];
    if (!top || top[1].matches.length < 2) return null;
    const [key, entry] = top;
    return {
      id: `recurring-weakness-${key}`,
      tone: "BAD",
      headline: `${entry.matches.length} of your ${noted.length} notes are about ${entry.line}.`,
      detail: "The notes were grouped by subject, not counted as identical.",
      strength: strengthOf(entry.matches.length),
      needsFigures: false,
      matchIds: entry.matches.map((match) => match.id),
      confounds: [
        "Two notes about one subject can describe two different problems.",
        "You wrote the notes, so what you noticed shapes what this counts.",
      ],
    };
  },
};

/** 6. Margins, the rule that never needs a figure. */
const margins: Rule = {
  id: "margins",
  needs: [],
  needsFigures: false,
  evaluate: (matches) => {
    const rows = scored(matches);
    if (rows.length < 3) return null;
    const tight = rows.filter((match) => Math.abs((match.goalsFor ?? 0) - (match.goalsAgainst ?? 0)) <= 1).length;
    const goalsFor = rows.reduce((total, match) => total + (match.goalsFor ?? 0), 0);
    const goalsAgainst = rows.reduce((total, match) => total + (match.goalsAgainst ?? 0), 0);
    return {
      id: "margins",
      tone: "NEUTRAL",
      headline:
        tight === rows.length
          ? `Every one of the ${rows.length} matches was drawn or decided by a single goal.`
          : `${tight} of the ${rows.length} matches were drawn or decided by a single goal.`,
      detail: `${goalsFor} scored, ${goalsAgainst} conceded.`,
      strength: strengthOf(rows.length),
      needsFigures: false,
      matchIds: rows.map((match) => match.id),
      confounds: ["A single-goal margin says nothing about how the match was played.", ...NO_CAUSE],
    };
  },
};

/** 7. Venue split. */
const venueSplit: Rule = {
  id: "venue-split",
  needs: [],
  needsFigures: false,
  evaluate: (matches) => {
    const rows = scored(matches).filter((match) => match.venue === "HOME" || match.venue === "AWAY");
    const home = rows.filter((match) => match.venue === "HOME");
    const away = rows.filter((match) => match.venue === "AWAY");
    if (home.length < 2 || away.length < 2) return null;
    const perGame = (list: ReviewMatch[]): number =>
      list.reduce((total, match) => total + (match.points ?? 0), 0) / list.length;
    const homeRate = perGame(home);
    const awayRate = perGame(away);
    const gap = homeRate - awayRate;
    return {
      id: "venue-split",
      tone: gap >= 0.75 ? "GOOD" : gap <= -0.75 ? "BAD" : "NEUTRAL",
      headline:
        Math.abs(gap) < 0.75
          ? "Home and away have produced a similar return."
          : `${gap > 0 ? "Home" : "Away"} matches have produced the better return.`,
      detail: `${round1(homeRate)} points a game at home across ${home.length}, ${round1(awayRate)} away across ${away.length}.`,
      strength: strengthOf(rows.length),
      needsFigures: false,
      matchIds: rows.map((match) => match.id),
      confounds: [
        "The fixtures are not the same set of opponents.",
        "A venue split can follow the order of the fixture list.",
      ],
    };
  },
};

/** 8. Form against the previous block. */
const againstPreviousBlock: Rule = {
  id: "against-previous-block",
  needs: [],
  needsFigures: false,
  evaluate: (matches, context) => {
    const previous = context.previousBlock;
    if (previous === null) return null;
    const rows = scored(matches);
    if (rows.length < 3) return null;
    const points = rows.reduce((total, match) => total + (match.points ?? 0), 0);
    const gap = points - previous.points;
    return {
      id: "against-previous-block",
      tone: gap > 0 ? "GOOD" : gap < 0 ? "BAD" : "NEUTRAL",
      headline:
        gap === 0
          ? `The same points as block ${previous.blockIndex}, from a different set of matches.`
          : `${Math.abs(gap)} points ${gap > 0 ? "more" : "fewer"} than block ${previous.blockIndex}.`,
      detail: `This window: ${points} from ${rows.length}. Block ${previous.blockIndex}: ${previous.points} from ${previous.possible / 3}.`,
      strength: strengthOf(rows.length),
      needsFigures: false,
      matchIds: rows.map((match) => match.id),
      confounds: [
        "The two blocks faced different opponents.",
        "Cup and league matches are counted together here.",
      ],
    };
  },
};

/** 9. Results by formation. */
const resultsByFormation: Rule = {
  id: "results-by-formation",
  needs: ["formation"],
  needsFigures: false,
  evaluate: (matches) => {
    const rows = scored(matches).filter((match) => match.formation !== null);
    const groups = new Map<string, { stamp: NonNullable<ReviewMatch["formation"]>; matches: ReviewMatch[] }>();
    for (const match of rows) {
      const stamp = match.formation;
      if (stamp === null) continue;
      const entry = groups.get(stamp.label) ?? { stamp, matches: [] };
      entry.matches.push(match);
      groups.set(stamp.label, entry);
    }
    if (groups.size < 2) return null;
    const ranked = [...groups.values()]
      .map((group) => ({
        ...group,
        rate: group.matches.reduce((total, match) => total + (match.points ?? 0), 0) / group.matches.length,
      }))
      .sort((left, right) => right.rate - left.rate);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const sameFamily = sameFormationFamily(best.stamp.formationName, worst.stamp.formationName);
    return {
      id: "results-by-formation",
      tone: "NEUTRAL",
      headline: `${formationDisplayName(best.stamp)} has the better return of the ${groups.size} shapes you recorded.`,
      detail: `${round1(best.rate)} points a game across ${best.matches.length} against ${round1(worst.rate)} across ${worst.matches.length} in ${formationDisplayName(worst.stamp)}. ${sameFamily ? "Both are the same family of shape." : "The two shapes are different families."}`,
      strength: strengthOf(rows.length),
      needsFigures: false,
      matchIds: [...best.matches, ...worst.matches].map((match) => match.id),
      confounds: [
        "The shape is one of several things that differed between those matches.",
        "Matches without a recorded shape are left out of this count.",
      ],
    };
  },
};

/** 10. Standouts and praise. */
const standouts: Rule = {
  id: "standouts",
  needs: [],
  needsFigures: false,
  evaluate: (matches) => {
    const counted = new Map<string, number>();
    for (const match of matches) {
      for (const name of match.standouts) counted.set(name, (counted.get(name) ?? 0) + 1);
    }
    const top = [...counted.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!top || top[1] < 2) return null;
    const [name, count] = top;
    return {
      id: "standouts",
      tone: "GOOD",
      headline: `${name} is the player you singled out most, in ${count} of ${matches.length} matches.`,
      detail: "Counted from the standouts you picked after each match.",
      strength: strengthOf(count),
      needsFigures: false,
      matchIds: matches.filter((match) => match.standouts.includes(name)).map((match) => match.id),
      confounds: ["A player you noticed says as much about what you watch for as about the player."],
    };
  },
};

/** 11. Objective progress, or the honest absence of it. */
const objectiveProgress: Rule = {
  id: "objective-progress",
  needs: [],
  needsFigures: false,
  evaluate: (matches, context) => {
    const target = context.objective?.targetPosition ?? null;
    if (target === null) return null;
    if (context.currentPosition === null) {
      return {
        id: "objective-progress",
        tone: "NEUTRAL",
        headline: `Your target of ${ordinal(target)} has no table position behind it yet.`,
        detail: "The objective is yours. The save has not reported a league position to compare it against.",
        strength: "THIN",
        needsFigures: false,
        matchIds: [],
        confounds: ["A target without a current figure cannot be read as on track or off it."],
      };
    }
    const gap = context.currentPosition - target;
    return {
      id: "objective-progress",
      tone: gap <= 0 ? "GOOD" : "BAD",
      headline:
        gap <= 0
          ? `You are ${ordinal(context.currentPosition)} against a target of ${ordinal(target)}.`
          : `You are ${ordinal(context.currentPosition)} against a target of ${ordinal(target)}, ${gap} place${gap === 1 ? "" : "s"} short.`,
      detail: "The position is the save's. The target is yours.",
      strength: "THIN",
      needsFigures: false,
      matchIds: matches.map((match) => match.id),
      confounds: ["A position moves with other clubs' results as well as yours."],
    };
  },
};

/** 12. Control. */
const control: Rule = {
  id: "control",
  needs: ["possession"],
  needsFigures: true,
  evaluate: (matches) => {
    const possession = withFigure(matches, (match) => match.figures.possession);
    if (possession.length < 3) return null;
    const values = possession.map((row) => row.value);
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const low = Math.min(...values);
    const high = Math.max(...values);
    return {
      id: "control",
      tone: "NEUTRAL",
      headline: `Possession averaged ${round1(mean)} percent across ${possession.length} matches.`,
      detail: `The range was ${low} to ${high} percent.`,
      strength: strengthOf(possession.length),
      needsFigures: true,
      matchIds: possession.map((row) => row.match.id),
      confounds: [
        "Possession is recorded as a percentage and says nothing about where the ball was.",
        ...NO_CAUSE,
      ],
    };
  },
};

/** The table, in the order the card shows findings. */
export const RULES: Rule[] = [
  resultAgainstPerformance,
  bestResultWorstPerformance,
  margins,
  concessionTiming,
  recurringWeakness,
  resultsByFormation,
  againstPreviousBlock,
  venueSplit,
  scoringSpread,
  control,
  objectiveProgress,
  standouts,
];

/** Every finding the rules can produce for this window, in table order. */
export function evaluateFindings(matches: ReviewMatch[], context: ReviewContext): Finding[] {
  const out: Finding[] = [];
  for (const rule of RULES) {
    const finding = rule.evaluate(matches, context);
    if (finding !== null) out.push(finding);
  }
  return out;
}
