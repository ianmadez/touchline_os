/**
 * The key contrast: two matches set against each other.
 *
 * WHY THIS EARNS ITS PLACE. A run of five results has an average, and an average hides the thing a manager actually
 * remembers: the day it clicked, and the day it did not. Naming the two matches does not explain either of them,
 * it just puts the reader back in front of the evidence.
 *
 * TWO BASES, ONE ORDER. With figures, the contrast is the best result against the thinnest performance, because
 * that pairing is where the interesting question sits. Without figures, a block of group logged matches has
 * nothing to measure but the scoreline, so the contrast is the biggest win against the heaviest defeat, and the
 * summary says which basis it used rather than quietly implying the first.
 */
import type { ReviewContrastSummary, ReviewMatch } from "./types";

function goalDifference(match: ReviewMatch): number {
  return (match.goalsFor ?? 0) - (match.goalsAgainst ?? 0);
}

function scoreline(match: ReviewMatch): string {
  if (match.goalsFor === null || match.goalsAgainst === null) return "no scoreline";
  return `${match.goalsFor}-${match.goalsAgainst}`;
}

function label(match: ReviewMatch): string {
  return `${match.opponent}, ${scoreline(match)}`;
}

/** The contrast a window can support, or null when there is not enough in it to compare. */
export function buildContrast(matches: ReviewMatch[]): ReviewContrastSummary | null {
  const scored = matches.filter((match) => match.goalsFor !== null && match.goalsAgainst !== null);
  if (scored.length < 2) return null;

  const withFigures = scored.filter((match) => match.figures.expectedGoals !== null);
  if (withFigures.length >= 3) {
    const best = [...withFigures].sort(
      (left, right) => (right.points ?? 0) - (left.points ?? 0) || goalDifference(right) - goalDifference(left)
    )[0];
    const thinnest = [...withFigures].sort(
      (left, right) => (left.figures.expectedGoals ?? 0) - (right.figures.expectedGoals ?? 0)
    )[0];
    if (best.id !== thinnest.id) {
      return {
        basis: "FIGURES",
        bestId: best.id,
        bestLabel: label(best),
        worstId: thinnest.id,
        worstLabel: label(thinnest),
        line: `The best result was ${best.opponent} at ${(best.figures.expectedGoals ?? 0).toFixed(2)} expected; the thinnest was ${thinnest.opponent} at ${(thinnest.figures.expectedGoals ?? 0).toFixed(2)}.`,
      };
    }
  }

  const best = [...scored].sort(
    (left, right) => goalDifference(right) - goalDifference(left) || (right.points ?? 0) - (left.points ?? 0)
  )[0];
  const worst = [...scored].sort(
    (left, right) => goalDifference(left) - goalDifference(right) || (left.points ?? 0) - (right.points ?? 0)
  )[0];
  if (best.id === worst.id) return null;
  return {
    basis: "RESULT",
    bestId: best.id,
    bestLabel: label(best),
    worstId: worst.id,
    worstLabel: label(worst),
    line: `${resultPhrase(best, "BEST")} ${best.opponent} ${scoreline(best)}; ${resultPhrase(worst, "WORST")} ${worst.opponent} ${scoreline(worst)}.`,
  };
}

/**
 * The word for a match's place in a scoreline-only contrast.
 *
 * A window can be all wins, or all draws, and calling a goalless draw the heaviest defeat would be the kind of
 * detail that makes a reader distrust everything else on the card. So the phrase follows the result rather than
 * assuming the run contains both.
 */
function resultPhrase(match: ReviewMatch, side: "BEST" | "WORST"): string {
  const difference = goalDifference(match);
  if (side === "BEST") {
    if (difference > 0) return "Widest win";
    if (difference === 0) return "Best draw";
    return "Closest of the defeats";
  }
  if (difference < 0) return "heaviest defeat";
  if (difference === 0) return "tightest draw";
  return "narrowest win";
}

/** A one-line description of a match, for the sections that list them. */
export function summariseMatch(match: ReviewMatch): string {
  const where = match.venue === null ? "" : ` ${match.venue.toLowerCase()}`;
  const formation = match.formation === null ? "" : `, ${match.formation.label}`;
  const date = match.date === null ? "no date" : match.date;
  return `${match.opponent}${where}, ${scoreline(match)} (${date}${formation})`;
}
