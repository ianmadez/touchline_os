/**
 * Where a proposed question comes from.
 *
 * A proposal is a REPEATED SIGNAL, not a single match. One late goal is a coincidence; three in five is a pattern
 * worth naming. Each rule below counts the same thing the review's findings count, and only proposes when the count
 * clears a floor - which is why the inbox is empty most of the time and means something when it is not.
 *
 * Proposals are recomputed from the current window on every read. Nothing is stored until the manager accepts, so a
 * proposal cannot go stale, and a signal that stops repeating stops being offered.
 */
import { weaknessFamily } from "../events/weakness-family";
import { formationDisplayName } from "../events/tactics-stamp";
import type { Review, ReviewMatch } from "../review/types";
import type { HypothesisProposal } from "./types";

/** How many matches a proposal needs before it is worth the manager's attention. */
export const PROPOSAL_FLOOR = 3;

/** How many matches a hypothesis is given before a verdict is offered. */
export const DEFAULT_REVIEW_AFTER = 5;

function foldedKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function lateGoals(match: ReviewMatch): number {
  return match.concededMinutes.filter((minute) => minute >= 75).length;
}

/**
 * The proposals this window can support.
 *
 * `existing` is the set of hypothesis keys already tracked, so a proposal the manager has accepted (or dropped and
 * re-accepted) is not offered a second time. The competition - two questions about the same weakness - is resolved
 * by key, not by wording.
 */
export function proposeFromReview(review: Review, existingKeys: string[]): HypothesisProposal[] {
  const taken = new Set(existingKeys);
  const proposals: HypothesisProposal[] = [];
  const matches = review.matches;
  const withTiming = matches.filter((match) => match.concededMinutes.length > 0);

  // 1. Late goals. Three timed goals against after the 75th is the signal; the count is of goals, not matches,
  // because one bad afternoon can supply all three and saying so is more honest than counting the afternoon once.
  const late = withTiming.flatMap((match) => match.concededMinutes.filter((minute) => minute >= 75));
  if (late.length >= PROPOSAL_FLOOR) {
    const key = "performance:late-goals";
    if (!taken.has(key)) {
      proposals.push({
        key,
        kind: "PERFORMANCE",
        claim: `We concede late: ${late.length} of our timed goals against came after the 75th minute.`,
        question: "Who was on the pitch when the late goals went in?",
        why: `${late.length} timed goals against arrived after the 75th minute, across ${withTiming.length} matches that had a timing.`,
        reviewAfterMatches: DEFAULT_REVIEW_AFTER,
        supporting: withTiming.filter((match) => lateGoals(match) > 0).map((match) => match.id),
        contradicting: withTiming.filter((match) => lateGoals(match) === 0).map((match) => match.id),
        formationLabel: null,
      });
    }
  }

  // 2. A recurring weakness, through the shared family table. The family key is part of the proposal key, so two
  // different weaknesses become two different questions rather than one vague one.
  const noted = matches.filter((match) => match.weakness !== null);
  const families = new Map<string, { line: string; matches: ReviewMatch[] }>();
  for (const match of noted) {
    const family = weaknessFamily(match.weakness ?? "");
    if (family === null) continue;
    const entry = families.get(family.key) ?? { line: family.line, matches: [] };
    entry.matches.push(match);
    families.set(family.key, entry);
  }
  for (const [familyKey, entry] of families) {
    if (entry.matches.length < PROPOSAL_FLOOR) continue;
    const key = `set-piece:${foldedKey(familyKey)}`;
    if (taken.has(key)) continue;
    proposals.push({
      key,
      kind: familyKey === "set-pieces" ? "SET_PIECE" : "PERFORMANCE",
      claim: `${entry.line.charAt(0).toUpperCase()}${entry.line.slice(1)} is the recurring problem: I noted it in ${entry.matches.length} of ${noted.length} matches.`,
      question: "Which of those matches was the same problem twice?",
      why: `${entry.matches.length} of your ${noted.length} notes are about ${entry.line}.`,
      reviewAfterMatches: DEFAULT_REVIEW_AFTER,
      supporting: entry.matches.map((match) => match.id),
      contradicting: noted
        .filter((match) => {
          const other = weaknessFamily(match.weakness ?? "");
          return other !== null && other.key !== familyKey;
        })
        .map((match) => match.id),
      formationLabel: null,
    });
  }

  // 3. Result against performance, inverted. The floor is three matches with a figure, because two is a mood.
  const withFigures = matches.filter(
    (match) => match.figures.expectedGoals !== null && match.goalsFor !== null
  );
  if (withFigures.length >= 3) {
    const under = withFigures.filter(
      (match) => (match.figures.expectedGoals ?? 0) - (match.goalsFor ?? 0) >= 0.5
    );
    if (under.length >= PROPOSAL_FLOOR - 1) {
      const key = "performance:chances-not-goals";
      if (!taken.has(key)) {
        proposals.push({
          key,
          kind: "PERFORMANCE",
          claim: `The chances are not turning into goals: ${under.length} of ${withFigures.length} matches with a figure finished under it.`,
          question: "Were the chances falling to the players you would want taking them?",
          why: `${under.length} of ${withFigures.length} matches finished with fewer goals than expected.`,
          reviewAfterMatches: DEFAULT_REVIEW_AFTER,
          supporting: under.map((match) => match.id),
          contradicting: withFigures
            .filter((match) => !under.includes(match))
            .map((match) => match.id),
          formationLabel: null,
        });
      }
    }
  }

  // 4. A shape contrast. Two shapes, a gap of three points or more, and the worse of the two is the question.
  const byShape = new Map<string, { stamp: NonNullable<ReviewMatch["formation"]>; matches: ReviewMatch[] }>();
  for (const match of matches) {
    if (match.formation === null || match.points === null) continue;
    const entry = byShape.get(match.formation.label) ?? { stamp: match.formation, matches: [] };
    entry.matches.push(match);
    byShape.set(match.formation.label, entry);
  }
  if (byShape.size >= 2) {
    const ranked = [...byShape.values()]
      .map((group) => ({
        ...group,
        points: group.matches.reduce((total, match) => total + (match.points ?? 0), 0),
      }))
      .sort((left, right) => right.points - left.points);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best.points - worst.points >= 3) {
      const key = `tactical:shape-${foldedKey(worst.stamp.label)}`;
      if (!taken.has(key)) {
        proposals.push({
          key,
          kind: "TACTICAL",
          claim: `${formationDisplayName(worst.stamp)} is costing us: ${worst.points} points from ${worst.matches.length} against ${best.points} from ${best.matches.length} in ${formationDisplayName(best.stamp)}.`,
          question: "Were the two shapes used against similar opposition?",
          why: `The gap between your two shapes is ${best.points - worst.points} points.`,
          reviewAfterMatches: 3,
          supporting: worst.matches.map((match) => match.id),
          contradicting: best.matches.map((match) => match.id),
          formationLabel: worst.stamp.label,
        });
      }
    }
  }

  return proposals;
}

/** The key a manager-written hypothesis gets, so it never collides with a rule's proposal. */
export function managerKey(claim: string): string {
  return `manager:${foldedKey(claim).slice(0, 60)}`;
}
