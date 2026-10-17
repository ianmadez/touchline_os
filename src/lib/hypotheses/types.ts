/**
 * The question the manager has chosen to keep asking.
 *
 * WHY A HYPOTHESIS IS NOT A STORYLINE. A storyline is what the app noticed and can withdraw when the data moves. A
 * hypothesis is what the manager decided to test: it has a status only he can move, a count of matches read against
 * it, and an evidence list that says which matches stand for it and which against. Nothing in this folder is written
 * by the storyline evaluator, and nothing here rewrites a claim the manager edited.
 *
 * WHAT MAKES ONE. Either the engine proposes it from a repeated signal in a review and the manager accepts, or he
 * writes one himself. Proposals are recomputed on every read from the current window, so a proposal is never stale:
 * it stands or falls with the data that produced it.
 */
import type { HypothesisKind, HypothesisStance, HypothesisStatus } from "../db/schema";
import type { ReviewMatch } from "../review/types";

/** How a hypothesis came to exist. */
export type HypothesisOrigin = "RULE" | "ACCEPTED" | "MANAGER";

/** One match read against one question. */
export interface EvidenceRow {
  eventId: string;
  stance: HypothesisStance;
  note: string | null;
}

/** A hypothesis as the engine and the screen treat it. */
export interface Hypothesis {
  id: string;
  careerId: string;
  seasonNumber: number | null;
  claim: string;
  question: string | null;
  /** The rule that proposed it, or null for one the manager wrote. */
  ruleKey: string | null;
  origin: HypothesisOrigin;
  status: HypothesisStatus;
  kind: HypothesisKind;
  reviewAfterMatches: number;
  matchesSeen: number;
  formationLabel: string | null;
  playerIds: string[];
  objectiveId: string | null;
  storylineId: string | null;
  managerNote: string | null;
  verdictReason: string | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** A hypothesis plus the evidence read against it, which is what the screen actually shows. */
export interface HypothesisWithEvidence extends Hypothesis {
  forCount: number;
  againstCount: number;
  evidence: EvidenceRow[];
}

/**
 * A proposal: a question the engine thinks is worth asking, before the manager has agreed to it.
 *
 * The `key` is derived from what the proposal is about, not from the wording, so the same signal does not offer
 * itself twice with different phrasing and accepting it twice adopts rather than duplicates.
 */
export interface HypothesisProposal {
  key: string;
  kind: HypothesisKind;
  claim: string;
  /** The one extra question this proposal would ask after a save. Null when the kind has nothing worth asking. */
  question: string | null;
  /** Why it is being proposed, with the count that supports it. */
  why: string;
  reviewAfterMatches: number;
  /** The matches that support it today, and the ones that argue against. */
  supporting: string[];
  contradicting: string[];
  formationLabel: string | null;
}

/** Whether a status still wants answering. `RESOLVED` is the only closed one. */
export function isOpen(status: HypothesisStatus): boolean {
  return status !== "RESOLVED";
}

/** The strength of the evidence so far, as the sentence a reader needs. */
export function evidenceLine(hypothesis: HypothesisWithEvidence): string {
  if (hypothesis.matchesSeen === 0) return "No match has been read against this yet.";
  const total = hypothesis.forCount + hypothesis.againstCount;
  if (total === 0) return `${hypothesis.matchesSeen} matches read, none of them speaking to the claim.`;
  return `${hypothesis.forCount} for, ${hypothesis.againstCount} against, across ${hypothesis.matchesSeen} matches read.`;
}

/** A match as the evidence writer needs it, kept narrow so the engine stays pure. */
export type EvidenceMatch = ReviewMatch;
