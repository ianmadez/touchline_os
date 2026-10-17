/**
 * When a question is answered, and what to ask next.
 *
 * A VERDICT IS NEVER WRITTEN BY THE ENGINE. This file produces the verdict it would offer and the reason for it; the
 * manager confirms it, and only then does the status move. That is the whole difference between a tracked question
 * and a headline: the app can count, but only he decides whether the count settles it.
 *
 * The thresholds are shares of the matches that actually spoke, not of the window. A question that half the matches
 * had nothing to say about is judged on the half that did, and the reason says so.
 */
import type { HypothesisStatus } from "../db/schema";
import type { HypothesisWithEvidence } from "./types";

/** What share of the decisive evidence has to fall one way before a verdict is offered. */
export const VERDICT_SHARE = 0.65;

export interface VerdictOffer {
  status: Extract<HypothesisStatus, "SUPPORTED" | "WEAKENED" | "INCONCLUSIVE">;
  reason: string;
}

/**
 * The verdict the evidence supports, or null when it is too early to offer one.
 *
 * Too early means fewer matches read than the question asked for, which is a number the manager set when he accepted
 * it. A question accepted with a review after three gets an answer after three.
 */
export function verdictFor(hypothesis: HypothesisWithEvidence): VerdictOffer | null {
  if (hypothesis.matchesSeen < hypothesis.reviewAfterMatches) return null;
  const decisive = hypothesis.forCount + hypothesis.againstCount;
  if (decisive === 0) {
    return {
      status: "INCONCLUSIVE",
      reason: `${hypothesis.matchesSeen} matches were read and none of them spoke to the claim.`,
    };
  }
  const forShare = hypothesis.forCount / decisive;
  if (forShare >= VERDICT_SHARE) {
    return {
      status: "SUPPORTED",
      reason: `${hypothesis.forCount} of the ${decisive} matches that spoke to it stand for the claim.`,
    };
  }
  if (forShare <= 1 - VERDICT_SHARE) {
    return {
      status: "WEAKENED",
      reason: `${hypothesis.againstCount} of the ${decisive} matches that spoke to it stand against the claim.`,
    };
  }
  return {
    status: "INCONCLUSIVE",
    reason: `${hypothesis.forCount} for and ${hypothesis.againstCount} against leaves it open.`,
  };
}

/** How far along a question is, as a fraction of the matches it asked for. */
export function progressOf(hypothesis: HypothesisWithEvidence): number {
  if (hypothesis.reviewAfterMatches <= 0) return 1;
  return Math.min(1, hypothesis.matchesSeen / hypothesis.reviewAfterMatches);
}

/**
 * The one extra question after a save.
 *
 * ONE PER SAVE, CHOSEN BY NEED. The need is how close a question is to being answerable: a question at four of five
 * matches is worth a nudge, one that has just been opened is not. A question already at its threshold is skipped,
 * because the right thing there is a verdict, not another match.
 */
export function nextQuestion(
  hypotheses: HypothesisWithEvidence[]
): { hypothesis: HypothesisWithEvidence; question: string } | null {
  const candidates = hypotheses
    .filter((hypothesis) => hypothesis.question !== null && hypothesis.status !== "RESOLVED")
    .filter((hypothesis) => hypothesis.matchesSeen < hypothesis.reviewAfterMatches)
    .sort((left, right) => progressOf(right) - progressOf(left));

  const best = candidates[0];
  if (!best || best.question === null) return null;
  return { hypothesis: best, question: best.question };
}

/**
 * Which open questions a save speaks to.
 *
 * Used by the post-save confirm row: a question is worth confirming only when at least one of the saved matches can
 * carry evidence for or against it. The row is hidden entirely when this comes back empty, which is the common case.
 */
export function questionsThisSaveAnswers(
  hypotheses: HypothesisWithEvidence[],
  matchIds: string[]
): Array<{ hypothesis: HypothesisWithEvidence; matchIds: string[] }> {
  const saved = new Set(matchIds);
  return hypotheses
    .filter((hypothesis) => hypothesis.status !== "RESOLVED")
    .map((hypothesis) => ({
      hypothesis,
      matchIds: hypothesis.evidence
        .map((row) => row.eventId)
        .filter((eventId) => saved.has(eventId)),
    }))
    .filter((entry) => entry.matchIds.length > 0);
}
