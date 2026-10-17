"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import type { ReviewDecisionRecord } from "@/lib/operations/review";
import { DEFAULT_WINDOW_COUNT, MIN_WINDOW_COUNT } from "@/lib/review/window";
import type { Review, ReviewOption, RulesProfile, RulesToggleId } from "@/lib/review/types";
import type { HypothesisProposal, HypothesisWithEvidence } from "@/lib/hypotheses/types";
import type { Assignment, AssignmentProgress, AssignmentProposal } from "@/lib/assignments/types";
import { IconFlag } from "@/components/ui/icons";
import { BlockBandLine, ReviewCard } from "./review-card";
import { ReviewFilteredLine, ReviewOptionCard } from "./review-option";
import { ReviewReport } from "./review-report";
import { AssignmentPanel } from "./assignment-panel";
import { CountChip, HypothesisList } from "./hypothesis-card";
import { HypothesisInbox } from "./hypothesis-inbox";
import { RulesProfilePanel } from "./rules-profile-panel";

/**
 * The Review tab.
 *
 * WHAT IT ASKS THE ENGINE FOR. Nothing here computes a finding: the tab picks a window, asks four operations about it,
 * and renders what comes back. That keeps the reasoning in one pure place and means the same screen shows the same
 * review on every visit, which is the whole promise of the surface.
 *
 * FOUR SOURCES, ONE WINDOW. The review, the questions, the assignments and the rules all read the same block or the
 * same run of matches. All four are asked with the same parameters, so the decision step can never quote one set of
 * matches while the question list quotes another.
 */

type Source = "NEWEST" | "WINDOW";

interface BlockOption {
  id: string;
  blockIndex: number;
  seasonNumber: number;
}

interface HypothesesPayload {
  hypotheses: HypothesisWithEvidence[];
  proposals: HypothesisProposal[];
}

interface AssignmentsPayload {
  active: Array<{ assignment: Assignment; progress: AssignmentProgress }>;
  proposals: AssignmentProposal[];
  positionLine: string | null;
  nextBlockIndex: number;
}

interface RulesPayload {
  profile: RulesProfile;
  toggles: Array<{ id: RulesToggleId; label: string; line: string }>;
  idle: RulesToggleId[];
}

export function ReviewTab({
  careerId,
  seasonNumber,
  onProposalCount,
  onPrefillChange,
}: {
  careerId: string;
  /** The season the tab was opened on, so the newest block offered is the current one. */
  seasonNumber: number | null;
  /** Reports how many proposals are waiting, so the tab strip can carry a count. */
  onProposalCount?: (count: number) => void;
  /** Reports the active points target, so the group debrief editor can pre-fill the next band. */
  onPrefillChange?: (target: { points: number; blockIndex: number } | null) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecisionRecord[]>([]);
  const [hypotheses, setHypotheses] = useState<HypothesesPayload>({ hypotheses: [], proposals: [] });
  const [assignments, setAssignments] = useState<AssignmentsPayload | null>(null);
  const [rules, setRules] = useState<RulesPayload | null>(null);
  const [blocks, setBlocks] = useState<BlockOption[]>([]);
  const [source, setSource] = useState<Source>("NEWEST");
  const [blockId, setBlockId] = useState<string>("");
  const [count, setCount] = useState<number>(DEFAULT_WINDOW_COUNT);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingRules, setSavingRules] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ careerId });
    if (source === "WINDOW") {
      params.set("count", String(count));
      if (from !== "") params.set("from", from);
      if (to !== "") params.set("to", to);
    } else if (blockId !== "") {
      params.set("blockId", blockId);
    }
    return params.toString();
  }, [blockId, careerId, count, from, source, to]);

  const loadBlocks = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/season/blocks?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        blocks?: Array<{ block: { id: string; blockIndex: number; seasonNumber: number } }>;
      };
      const list = (payload.blocks ?? []).map((row) => ({
        id: row.block.id,
        blockIndex: row.block.blockIndex,
        seasonNumber: row.block.seasonNumber,
      }));
      setBlocks(list);
      if (list.length > 0) {
        const current = list.find((entry) => entry.seasonNumber === seasonNumber) ?? list[0];
        setBlockId(current.id);
      }
    } catch {
      setBlocks([]);
    }
  }, [careerId, seasonNumber]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reviewRes, hypRes, asgRes, rulesRes] = await Promise.all([
        apiFetch(`/api/review?${query}`, { cache: "no-store" }),
        apiFetch(`/api/hypotheses?${query}`, { cache: "no-store" }),
        apiFetch(`/api/assignments?${query}`, { cache: "no-store" }),
        apiFetch(`/api/rules-profile?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" }),
      ]);

      const reviewBody = (await reviewRes.json()) as {
        success?: boolean;
        review?: Review;
        decisions?: ReviewDecisionRecord[];
        error?: string;
      };
      if (!reviewBody.success || !reviewBody.review) {
        setError(reviewBody.error ?? "Could not build the review.");
        setReview(null);
        return;
      }
      setReview(reviewBody.review);
      setDecisions(reviewBody.decisions ?? []);

      const hypBody = (await hypRes.json()) as {
        success?: boolean;
        hypotheses?: HypothesisWithEvidence[];
        proposals?: HypothesisProposal[];
      };
      if (hypBody.success) {
        setHypotheses({ hypotheses: hypBody.hypotheses ?? [], proposals: hypBody.proposals ?? [] });
        onProposalCount?.((hypBody.proposals ?? []).length);
      }

      const asgBody = (await asgRes.json()) as AssignmentsPayload & { success?: boolean };
      if (asgBody.success) {
        const active = asgBody.active ?? [];
        setAssignments({
          active,
          proposals: asgBody.proposals ?? [],
          positionLine: asgBody.positionLine ?? null,
          nextBlockIndex: asgBody.nextBlockIndex ?? 1,
        });
        const points = active.find((entry) => entry.assignment.type === "POINTS_TARGET");
        onPrefillChange?.(
          points && points.assignment.targetPoints !== null
            ? { points: points.assignment.targetPoints, blockIndex: asgBody.nextBlockIndex ?? 1 }
            : null
        );
      }

      const rulesBody = (await rulesRes.json()) as RulesPayload & { success?: boolean };
      if (rulesBody.success) {
        setRules({
          profile: rulesBody.profile,
          toggles: rulesBody.toggles ?? [],
          idle: rulesBody.idle ?? [],
        });
      }
    } catch {
      setError("Could not reach the review service.");
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [careerId, onPrefillChange, onProposalCount, query]);

  useEffect(() => {
    // Deferred by a task rather than set in the effect body: a synchronous setState here trips the compiler rule,
    // and every other loader in the app does the same thing for the same reason.
    const timer = window.setTimeout(() => void loadBlocks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBlocks]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const decide = async (option: ReviewOption, decision: "ACCEPTED" | "DROPPED" | "PENDING") => {
    if (review === null) return;
    setBusy(option.id);
    try {
      const response = await apiFetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, reviewKey: review.key, optionId: option.id, decision }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        decisions?: ReviewDecisionRecord[];
        error?: string;
      };
      if (!payload.success) {
        setError(payload.error ?? "Could not record that decision.");
        return;
      }
      setDecisions(payload.decisions ?? []);
      setError(null);
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const proposeHypothesis = async (proposal: HypothesisProposal, decline: boolean) => {
    setBusy(proposal.key);
    try {
      const response = await apiFetch("/api/hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, seasonNumber, proposal, decline }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        hypotheses?: HypothesisWithEvidence[];
        error?: string;
      };
      if (!payload.success) {
        setError(payload.error ?? "Could not open that question.");
        return;
      }
      const remaining = hypotheses.proposals.filter((entry) => entry.key !== proposal.key);
      setHypotheses({
        hypotheses: payload.hypotheses ?? hypotheses.hypotheses,
        proposals: remaining,
      });
      onProposalCount?.(remaining.length);
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const hypothesisAction = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const response = await apiFetch("/api/hypotheses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, id, ...body }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        hypotheses?: HypothesisWithEvidence[];
        error?: string;
      };
      if (!payload.success) {
        setError(payload.error ?? "Could not update that question.");
        return;
      }
      if (payload.hypotheses) {
        setHypotheses((current) => ({ ...current, hypotheses: payload.hypotheses as HypothesisWithEvidence[] }));
      }
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const deleteHypothesis = async (id: string) => {
    setBusy(id);
    try {
      await apiFetch(
        `/api/hypotheses?careerId=${encodeURIComponent(careerId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      setHypotheses((current) => ({
        ...current,
        hypotheses: current.hypotheses.filter((entry) => entry.id !== id),
      }));
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const createHypothesis = async (claim: string, question: string | null) => {
    setBusy("new");
    try {
      const response = await apiFetch("/api/hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, seasonNumber, claim, question }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        hypotheses?: HypothesisWithEvidence[];
        error?: string;
      };
      if (!payload.success) {
        setError(payload.error ?? "Could not open that question.");
        return;
      }
      if (payload.hypotheses) {
        setHypotheses((current) => ({ ...current, hypotheses: payload.hypotheses as HypothesisWithEvidence[] }));
      }
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const acceptAssignment = async (proposal: AssignmentProposal) => {
    setBusy(proposal.type);
    try {
      const response = await apiFetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, seasonNumber, reviewKey: review?.key ?? null, proposal }),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!payload.success) {
        setError(payload.error ?? "Could not record that assignment.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const closeAssignment = async (assignment: Assignment, status: "MET" | "MISSED" | "CONCLUDED") => {
    setBusy(assignment.id);
    try {
      await apiFetch("/api/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, id: assignment.id, status }),
      });
      await load();
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setBusy(null);
    }
  };

  const saveRules = async (patch: { toggles?: Partial<Record<RulesToggleId, boolean>>; notes?: string | null }) => {
    setSavingRules(true);
    try {
      const response = await apiFetch("/api/rules-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, ...patch }),
      });
      const payload = (await response.json()) as RulesPayload & { success?: boolean; error?: string };
      if (!payload.success) {
        setError(payload.error ?? "Could not save your rules.");
        return;
      }
      setRules({ profile: payload.profile, toggles: payload.toggles ?? [], idle: payload.idle ?? [] });
      // The options on the card are gated by these toggles, so the review is rebuilt from the same window.
      const reviewRes = await apiFetch(`/api/review?${query}`, { cache: "no-store" });
      const reviewBody = (await reviewRes.json()) as {
        success?: boolean;
        review?: Review;
        decisions?: ReviewDecisionRecord[];
      };
      if (reviewBody.success && reviewBody.review) {
        setReview(reviewBody.review);
        setDecisions(reviewBody.decisions ?? []);
      }
    } catch {
      setError("Could not reach the review service.");
    } finally {
      setSavingRules(false);
    }
  };

  const decisionFor = useMemo(
    () => new Map(decisions.map((record) => [record.optionId, record])),
    [decisions]
  );

  const noMatches = review !== null && review.matches.length === 0;

  // The hint explains the picker the manager is actually looking at, including the case where a
  // block was never saved and the newest matches are read as a window instead.
  let pickerHint = "A window reads the newest logged matches, five by default and never fewer than three.";
  if (source === "NEWEST") {
    pickerHint =
      blocks.length === 0
        ? "No block is saved yet, so this reads your newest matches as a window. Five by default, never fewer than three."
        : "A saved block is the run of matches you closed off, exactly as you logged them.";
  }

  return (
    <div className="space-y-4">
      <div data-tour="review-heading">
        <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          <IconFlag className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          Read this run
          <CountChip count={hypotheses.proposals.length} label="to test" />
        </h2>
        <p className="mt-1 max-w-xl font-sans text-xs text-slate-600 dark:text-slate-400">
          What a run of matches shows, what it does not, and the decisions that follow from it.
        </p>
      </div>

      <div
        data-tour="review-picker"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
      >
        <label className="flex flex-col gap-1">
          <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Read
          </span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value === "WINDOW" ? "WINDOW" : "NEWEST")}
            className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="NEWEST">The newest block</option>
            <option value="WINDOW">A window of matches</option>
          </select>
        </label>

        {source === "NEWEST" ? (
          <label className="flex flex-col gap-1">
            <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Block
            </span>
            <select
              value={blockId}
              onChange={(event) => setBlockId(event.target.value)}
              disabled={blocks.length === 0}
              className="min-w-[11rem] cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {blocks.length === 0 && <option value="">No blocks saved yet</option>}
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  Season {block.seasonNumber}, block {block.blockIndex}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                How many
              </span>
              <input
                type="number"
                min={MIN_WINDOW_COUNT}
                value={count}
                onChange={(event) =>
                  setCount(Math.max(MIN_WINDOW_COUNT, Number(event.target.value) || MIN_WINDOW_COUNT))
                }
                className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                From
              </span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                To
              </span>
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </>
        )}

        <p className="ml-auto max-w-xs font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
          {pickerHint}
        </p>
      </div>

      {error !== null && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      <HypothesisInbox
        proposals={hypotheses.proposals}
        busyKey={busy}
        onAccept={(proposal) => void proposeHypothesis(proposal, false)}
        onDecline={(proposal) => void proposeHypothesis(proposal, true)}
      />

      {loading ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400">Reading the run…</p>
      ) : noMatches ? (
        <p
          data-tour="review-empty"
          className="rounded-2xl border border-slate-200/80 bg-white/90 p-8 text-center font-sans text-xs text-slate-600 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 dark:text-slate-400"
        >
          Log a match, or save a group debrief, and this is where the block gets read back.
        </p>
      ) : review === null ? null : (
        <>
          <ReviewCard review={review} report={<ReviewReport review={review} />}>
            <div
              data-tour="review-decision"
              className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Your call
                </span>
                <BlockBandLine review={review} />
              </div>
              {review.options.length === 0 ? (
                review.blockedBy.length > 0 ? (
                  <ReviewFilteredLine toggles={review.blockedBy} />
                ) : (
                  <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                    Nothing in this run needs a decision yet.
                  </p>
                )
              ) : (
                <div className="space-y-2">
                  {review.options.map((option) => (
                    <ReviewOptionCard
                      key={option.id}
                      option={option}
                      decision={decisionFor.get(option.id) ?? null}
                      busy={busy === option.id}
                      onDecide={(decision) => void decide(option, decision)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ReviewCard>

          {assignments !== null && (
            <AssignmentPanel
              active={assignments.active}
              proposals={assignments.proposals}
              positionLine={assignments.positionLine}
              nextBlockIndex={assignments.nextBlockIndex}
              busyKey={busy}
              onAccept={(proposal) => void acceptAssignment(proposal)}
              onClose={(assignment, status) => void closeAssignment(assignment, status)}
            />
          )}

          <section className="space-y-2">
            <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Questions you are tracking
            </span>
            <HypothesisList
              hypotheses={hypotheses.hypotheses}
              busyId={busy}
              onConfirmVerdict={(id) => void hypothesisAction(id, { action: "verdict" })}
              onDrop={(id) => void hypothesisAction(id, { action: "drop" })}
              onAmend={(id, patch) => void hypothesisAction(id, { action: "amend", ...patch })}
              onDelete={(id) => void deleteHypothesis(id)}
              onCreate={(claim, question) => void createHypothesis(claim, question)}
            />
          </section>

          {rules !== null && (
            <RulesProfilePanel
              profile={rules.profile}
              toggles={rules.toggles}
              idle={rules.idle}
              saving={savingRules}
              onSave={(patch) => void saveRules(patch)}
            />
          )}
        </>
      )}
    </div>
  );
}
