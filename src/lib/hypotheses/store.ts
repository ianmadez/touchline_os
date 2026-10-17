/**
 * The hypothesis store.
 *
 * Everything the manager owns lives here. The only writes are: accept a proposal, amend a claim, confirm a match as
 * evidence, confirm a verdict, drop it. The engine's own pass (`syncForMatches`) is deliberately narrow - it adds
 * evidence rows for matches it can classify and updates the count, and it never changes a status, a claim or a
 * question. That is the line between what the app may infer and what the manager decides.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db/client";
import {
  careerEvents,
  hypothesisEvidence,
  hypotheses,
  type HypothesisKind,
  type HypothesisStance,
  type HypothesisStatus,
} from "../db/schema";
import { sha1Hex } from "../parser/sha";
import type { ReviewMatch } from "../review/types";
import { evidenceFor, evidenceRowId, isStorableEventId } from "./evidence";
import { verdictFor } from "./verdict";
import type { Hypothesis, HypothesisProposal, HypothesisWithEvidence } from "./types";

function now(): string {
  return new Date().toISOString();
}

/** A stable id for a proposal, so accepting the same proposal twice adopts rather than duplicates. */
export function hypothesisIdFor(careerId: string, key: string): string {
  return `hyp_${sha1Hex([careerId, key].join("|")).slice(0, 24)}`;
}

type Row = typeof hypotheses.$inferSelect;

function toHypothesis(row: Row): Hypothesis {
  let playerIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.playerIdsJson);
    if (Array.isArray(parsed)) playerIds = parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    /* an unreadable list costs the names, not the question */
  }
  return {
    id: row.id,
    careerId: row.careerId,
    seasonNumber: row.seasonNumber,
    claim: row.claim,
    question: row.question,
    ruleKey: row.ruleKey,
    origin: row.origin as Hypothesis["origin"],
    status: row.status as HypothesisStatus,
    kind: row.kind as HypothesisKind,
    reviewAfterMatches: row.reviewAfterMatches,
    matchesSeen: row.matchesSeen,
    formationLabel: row.formationLabel,
    playerIds,
    objectiveId: row.objectiveId,
    storylineId: row.storylineId,
    managerNote: row.managerNote,
    verdictReason: row.verdictReason,
    openedAt: row.openedAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

export class HypothesisStore {
  /** Every question for a career, newest first, with its evidence counted. */
  async list(careerId: string): Promise<HypothesisWithEvidence[]> {
    const rows = await db.select().from(hypotheses).where(eq(hypotheses.careerId, careerId));
    if (rows.length === 0) return [];

    const evidence = await db
      .select()
      .from(hypothesisEvidence)
      .where(inArray(hypothesisEvidence.hypothesisId, rows.map((row) => row.id)));

    return rows
      .map((row) => {
        const mine = evidence.filter((entry) => entry.hypothesisId === row.id);
        return {
          ...toHypothesis(row),
          evidence: mine.map((entry) => ({
            eventId: entry.eventId,
            stance: entry.stance as HypothesisStance,
            note: entry.note,
          })),
          forCount: mine.filter((entry) => entry.stance === "FOR").length,
          againstCount: mine.filter((entry) => entry.stance === "AGAINST").length,
        };
      })
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt));
  }

  /**
   * Accepting a proposal, or writing one by hand.
   *
   * Idempotent on the key: a second accept finds the row and returns it rather than opening a twin. A dropped
   * question that is proposed again is reopened rather than duplicated, because the manager changing his mind is not
   * the same as a new question.
   */
  async accept(
    careerId: string,
    input: {
      key: string;
      kind: HypothesisKind;
      claim: string;
      question: string | null;
      ruleKey: string | null;
      seasonNumber: number | null;
      formationLabel: string | null;
      reviewAfterMatches: number;
      origin: Hypothesis["origin"];
    }
  ): Promise<Hypothesis> {
    const id = hypothesisIdFor(careerId, input.key);
    const existing = await db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
    if (existing) {
      await db
        .update(hypotheses)
        .set({ status: "INVESTIGATING", resolvedAt: null, updatedAt: now() })
        .where(eq(hypotheses.id, id));
      const refreshed = await db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
      return toHypothesis(refreshed ?? existing);
    }

    const stamp = now();
    await db.insert(hypotheses).values({
      id,
      careerId,
      seasonNumber: input.seasonNumber,
      claim: input.claim,
      question: input.question,
      ruleKey: input.ruleKey,
      origin: input.origin,
      status: "INVESTIGATING",
      kind: input.kind,
      reviewAfterMatches: Math.max(1, input.reviewAfterMatches),
      matchesSeen: 0,
      formationLabel: input.formationLabel,
      playerIdsJson: "[]",
      objectiveId: null,
      storylineId: null,
      managerNote: null,
      verdictReason: null,
      openedAt: stamp,
      updatedAt: stamp,
      resolvedAt: null,
    });
    const created = await db.select().from(hypotheses).where(eq(hypotheses.id, id)).get();
    return toHypothesis(created as Row);
  }

  /**
   * Reads a window of matches against every open question that has a rule behind it.
   *
   * Writes only rows that are not already there, so a save that re-reads the last five matches after every debrief
   * converges instead of growing. Returns how many rows were actually added, which is what the confirm row reports.
   */
  async syncForMatches(
    careerId: string,
    matches: ReviewMatch[]
  ): Promise<{ added: number; updated: string[] }> {
    const open = (await this.list(careerId)).filter(
      (hypothesis) => hypothesis.status !== "RESOLVED" && hypothesis.ruleKey !== null
    );
    if (open.length === 0 || matches.length === 0) return { added: 0, updated: [] };

    const storable = matches.filter((match) => isStorableEventId(match.id));
    if (storable.length === 0) return { added: 0, updated: [] };

    let added = 0;
    const updated: string[] = [];
    for (const hypothesis of open) {
      const rows = evidenceFor(hypothesis.id, hypothesis.ruleKey, hypothesis.formationLabel, storable);
      if (rows.length === 0) continue;

      const existing = await db
        .select({ eventId: hypothesisEvidence.eventId })
        .from(hypothesisEvidence)
        .where(eq(hypothesisEvidence.hypothesisId, hypothesis.id));
      const known = new Set(existing.map((entry) => entry.eventId));
      const fresh = rows.filter((row) => !known.has(row.eventId));
      if (fresh.length === 0) continue;

      await db
        .insert(hypothesisEvidence)
        .values(
          fresh.map((row) => ({
            id: row.id,
            hypothesisId: hypothesis.id,
            eventId: row.eventId,
            stance: row.stance,
            note: null,
            createdAt: now(),
          }))
        )
        .onConflictDoNothing();

      const total = known.size + fresh.length;
      await db
        .update(hypotheses)
        .set({ matchesSeen: total, updatedAt: now() })
        .where(eq(hypotheses.id, hypothesis.id));
      added += fresh.length;
      updated.push(hypothesis.id);
    }
    return { added, updated };
  }

  /** Confirms the manager's own reading of one match, on any question, including one he wrote himself. */
  async confirmEvidence(
    hypothesisId: string,
    eventId: string,
    stance: HypothesisStance,
    note: string | null
  ): Promise<HypothesisWithEvidence | null> {
    const row = await db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).get();
    if (!row) return null;
    // The event has to exist: evidence cites a match, and a citation of a match that is not there would be worse than
    // a refusal. A stale id from a deleted debrief therefore does nothing rather than throwing.
    const event = await db
      .select({ id: careerEvents.id })
      .from(careerEvents)
      .where(eq(careerEvents.id, eventId))
      .get();
    if (!event) return null;

    await db
      .insert(hypothesisEvidence)
      .values({
        id: evidenceRowId(hypothesisId, eventId),
        hypothesisId,
        eventId,
        stance,
        note,
        createdAt: now(),
      })
      .onConflictDoUpdate({
        target: hypothesisEvidence.id,
        set: { stance, note },
      });

    const counts = await db
      .select()
      .from(hypothesisEvidence)
      .where(eq(hypothesisEvidence.hypothesisId, hypothesisId));
    await db
      .update(hypotheses)
      .set({ matchesSeen: counts.length, updatedAt: now() })
      .where(eq(hypotheses.id, hypothesisId));

    const list = await this.list(row.careerId);
    return list.find((entry) => entry.id === hypothesisId) ?? null;
  }

  /** Amends the wording. The manager owns the claim, so this is allowed even after it has been read against. */
  async amend(
    hypothesisId: string,
    patch: {
      claim?: string;
      question?: string | null;
      managerNote?: string | null;
      reviewAfterMatches?: number;
    }
  ): Promise<Hypothesis | null> {
    const row = await db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).get();
    if (!row) return null;
    await db
      .update(hypotheses)
      .set({
        claim: patch.claim?.trim() ? patch.claim.trim() : row.claim,
        question: patch.question === undefined ? row.question : patch.question,
        managerNote: patch.managerNote === undefined ? row.managerNote : patch.managerNote,
        reviewAfterMatches:
          patch.reviewAfterMatches === undefined
            ? row.reviewAfterMatches
            : Math.max(1, Math.trunc(patch.reviewAfterMatches)),
        updatedAt: now(),
      })
      .where(eq(hypotheses.id, hypothesisId));
    const refreshed = await db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).get();
    return refreshed ? toHypothesis(refreshed) : null;
  }

  /**
   * Closes a question with the verdict the evidence supports.
   *
   * The status is recomputed here rather than taken from the request: a browser can ask to confirm, but it cannot
   * declare a question supported when the count says otherwise. If it is too early, nothing moves and the caller is
   * told so.
   */
  async confirmVerdict(
    hypothesisId: string
  ): Promise<{ hypothesis: HypothesisWithEvidence | null; closed: boolean; reason: string }> {
    const list = await this.list((await this.ownerOf(hypothesisId)) ?? "");
    const found = list.find((entry) => entry.id === hypothesisId) ?? null;
    if (!found) return { hypothesis: null, closed: false, reason: "No such question." };

    const offer = verdictFor(found);
    if (offer === null) {
      return {
        hypothesis: found,
        closed: false,
        reason: `It needs ${found.reviewAfterMatches} matches before a verdict; ${found.matchesSeen} have been read.`,
      };
    }

    const stamp = now();
    await db
      .update(hypotheses)
      .set({ status: offer.status, verdictReason: offer.reason, resolvedAt: stamp, updatedAt: stamp })
      .where(eq(hypotheses.id, hypothesisId));
    const refreshed = await this.list(found.careerId);
    return {
      hypothesis: refreshed.find((entry) => entry.id === hypothesisId) ?? null,
      closed: true,
      reason: offer.reason,
    };
  }

  /** Drops a question. Kept rather than deleted, so the inbox does not immediately propose it again. */
  async drop(hypothesisId: string): Promise<HypothesisWithEvidence | null> {
    const row = await db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).get();
    if (!row) return null;
    const stamp = now();
    await db
      .update(hypotheses)
      .set({
        status: "RESOLVED",
        verdictReason: "Dropped. The question stands unanswered.",
        resolvedAt: stamp,
        updatedAt: stamp,
      })
      .where(eq(hypotheses.id, hypothesisId));
    const list = await this.list(row.careerId);
    return list.find((entry) => entry.id === hypothesisId) ?? null;
  }

  /** Removes a question and its evidence outright. Only for one the manager wrote himself and wants gone. */
  async remove(hypothesisId: string): Promise<boolean> {
    const row = await db.select().from(hypotheses).where(eq(hypotheses.id, hypothesisId)).get();
    if (!row) return false;
    await db.delete(hypotheses).where(eq(hypotheses.id, hypothesisId));
    return true;
  }

  /** Deletes every question for a career. Used when a career is replaced wholesale. */
  async removeAll(careerId: string): Promise<void> {
    await db.delete(hypotheses).where(eq(hypotheses.careerId, careerId));
  }

  /** The career that owns a question, needed by the verdict path which starts from an id. */
  private async ownerOf(hypothesisId: string): Promise<string | null> {
    const row = await db
      .select({ careerId: hypotheses.careerId })
      .from(hypotheses)
      .where(eq(hypotheses.id, hypothesisId))
      .get();
    return row?.careerId ?? null;
  }
}

/** The keys already tracked, so a proposal the manager accepted is not offered again. */
export function trackedKeys(list: HypothesisWithEvidence[]): string[] {
  return list
    .filter((hypothesis) => hypothesis.ruleKey !== null)
    .map((hypothesis) => hypothesis.ruleKey as string);
}

/** A proposal as the store needs it. */
export function acceptInputFor(
  careerId: string,
  proposal: HypothesisProposal,
  seasonNumber: number | null
): Parameters<HypothesisStore["accept"]>[1] {
  void careerId;
  return {
    key: proposal.key,
    kind: proposal.kind,
    claim: proposal.claim,
    question: proposal.question,
    ruleKey: proposal.key,
    seasonNumber,
    formationLabel: proposal.formationLabel,
    reviewAfterMatches: proposal.reviewAfterMatches,
    origin: "ACCEPTED",
  };
}

/** Whether a row belongs to a career, for the routes that take an id on its own. */
export async function hypothesisBelongsTo(careerId: string, hypothesisId: string): Promise<boolean> {
  const row = await db
    .select({ id: hypotheses.id })
    .from(hypotheses)
    .where(and(eq(hypotheses.careerId, careerId), eq(hypotheses.id, hypothesisId)))
    .get();
  return row !== undefined;
}
