/**
 * Reading a match against a question.
 *
 * THE ONE PROPERTY THAT MATTERS. Writing the same match twice must write nothing the second time. Evidence ids are
 * derived from the pair (hypothesis, match) rather than generated, so a save that re-reads the last five matches
 * after every debrief cannot accumulate duplicates, and `matches_seen` counts matches rather than saves.
 *
 * WHAT THIS DOES NOT DO. It does not decide anything. A match is either FOR, AGAINST, or silent - silence being the
 * common case, because most matches say nothing about most questions. A question with no rule behind it (one the
 * manager wrote himself) is only ever fed by him confirming a match by hand.
 */
import { sha1Hex } from "../parser/sha";
import { weaknessFamily } from "../events/weakness-family";
import type { HypothesisStance } from "../db/schema";
import type { ReviewMatch } from "../review/types";

/** A stable id for one match read against one question, so a re-save is a no-op. */
export function evidenceRowId(hypothesisId: string, eventId: string): string {
  return `hev_${sha1Hex([hypothesisId, eventId].join("|")).slice(0, 24)}`;
}

const LATE_MINUTE = 75;

/** The xG edge a match needs before it says anything about finishing. */
const FINISHING_EDGE = 0.5;

/**
 * What one match says about one question.
 *
 * `ruleKey` names the rule that proposed the hypothesis; `formationLabel` names the shape a tactical question is
 * about. Both come from the stored row, so the classification depends on state rather than on the wording of a claim
 * the manager may since have edited.
 */
export function stanceFor(
  ruleKey: string | null,
  formationLabel: string | null,
  match: ReviewMatch
): HypothesisStance | null {
  if (ruleKey === null) return null;

  if (ruleKey === "performance:late-goals") {
    if (match.concededMinutes.length === 0) return null;
    return match.concededMinutes.some((minute) => minute >= LATE_MINUTE) ? "FOR" : "AGAINST";
  }

  if (ruleKey === "performance:chances-not-goals") {
    const expected = match.figures.expectedGoals;
    if (expected === null || match.goalsFor === null) return null;
    return expected - match.goalsFor >= FINISHING_EDGE ? "FOR" : "AGAINST";
  }

  if (ruleKey.startsWith("set-piece:") || ruleKey.startsWith("weakness:")) {
    const family = ruleKey.split(":").slice(1).join(":");
    if (match.weakness === null) return null;
    const noted = weaknessFamily(match.weakness);
    if (noted === null) return null;
    return noted.key === family ? "FOR" : "AGAINST";
  }

  if (ruleKey.startsWith("tactical:shape-")) {
    if (formationLabel === null || match.formation === null) return null;
    return match.formation.label === formationLabel ? "FOR" : "AGAINST";
  }

  return null;
}

/**
 * Every match in a window that speaks to a question, as rows ready to write.
 *
 * Silence is dropped here rather than stored as a third stance, because "this match had nothing to say" is the
 * absence of evidence and a row for it would inflate the count of matches read.
 */
export function evidenceFor(
  hypothesisId: string,
  ruleKey: string | null,
  formationLabel: string | null,
  matches: ReviewMatch[]
): Array<{ id: string; eventId: string; stance: HypothesisStance }> {
  const rows: Array<{ id: string; eventId: string; stance: HypothesisStance }> = [];
  for (const match of matches) {
    const stance = stanceFor(ruleKey, formationLabel, match);
    if (stance === null) continue;
    rows.push({ id: evidenceRowId(hypothesisId, match.id), eventId: match.id, stance });
  }
  return rows;
}

/** Whether a match id can be stored as evidence: only a row that exists in `career_events` has a foreign key to. */
export function isStorableEventId(id: string): boolean {
  return id.startsWith("evt_") || id.startsWith("grp_");
}
