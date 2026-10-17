"use client";

import React, { useState } from "react";

import { evidenceLine, type HypothesisWithEvidence } from "@/lib/hypotheses/types";
import { progressOf, verdictFor } from "@/lib/hypotheses/verdict";
import { IconCheck, IconNote, IconPlus, IconSpark, IconTarget, IconTrash } from "@/components/ui/icons";

/**
 * One tracked question.
 *
 * The card answers four things in order: what is being claimed, how much has been read against it, what would settle
 * it, and what the manager can do next. The verdict is offered rather than applied, and the reason the engine would
 * give is shown beside the button so he is not agreeing to a word he cannot see.
 */

const STATUS_STYLES: Record<string, string> = {
  EMERGING: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  INVESTIGATING: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  SUPPORTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  WEAKENED: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  RESOLVED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  INCONCLUSIVE: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
};

const STATUS_LABELS: Record<string, string> = {
  EMERGING: "Emerging",
  INVESTIGATING: "Investigating",
  SUPPORTED: "Supported",
  WEAKENED: "Weakened",
  RESOLVED: "Closed",
  INCONCLUSIVE: "Inconclusive",
};

export function HypothesisCard({
  hypothesis,
  busy,
  onConfirmVerdict,
  onDrop,
  onAmend,
  onDelete,
}: {
  hypothesis: HypothesisWithEvidence;
  busy: boolean;
  onConfirmVerdict: () => void;
  onDrop: () => void;
  onAmend: (patch: { claim?: string; question?: string | null; managerNote?: string | null }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState(hypothesis.claim);
  const [question, setQuestion] = useState(hypothesis.question ?? "");
  const offer = verdictFor(hypothesis);
  const progress = Math.round(progressOf(hypothesis) * 100);
  const closed = hypothesis.status === "RESOLVED";

  return (
    <article
      data-tour="hypothesis-card"
      className="space-y-2.5 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[12rem] flex-1">
          {editing ? (
            <textarea
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          ) : (
            <p className="font-heading text-xs leading-snug text-slate-900 dark:text-slate-100">
              {hypothesis.claim}
            </p>
          )}
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {evidenceLine(hypothesis)}
          </p>
        </div>
        <span
          className={`rounded-lg px-2 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[hypothesis.status] ?? STATUS_STYLES.EMERGING}`}
        >
          {STATUS_LABELS[hypothesis.status] ?? hypothesis.status}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between font-sub text-[9px] uppercase tracking-wider text-slate-400">
          <span>
            {hypothesis.matchesSeen} of {hypothesis.reviewAfterMatches} matches before a verdict
          </span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-[#E11D48] transition-[width] duration-500 dark:bg-[#FF8C7A]"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              The question to ask after a save
            </span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onAmend({ claim, question: question.trim() === "" ? null : question.trim() });
                setEditing(false);
              }}
              className="cursor-pointer rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setClaim(hypothesis.claim);
                setQuestion(hypothesis.question ?? "");
              }}
              className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {hypothesis.question !== null && (
            <p className="flex items-start gap-1.5 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              <IconNote className="mt-0.5 h-3 w-3 shrink-0" />
              {hypothesis.question}
            </p>
          )}
          {offer !== null && !closed && (
            <p className="rounded-lg bg-slate-100/70 px-2.5 py-2 font-sans text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
              The evidence reads as <strong>{STATUS_LABELS[offer.status].toLowerCase()}</strong>: {offer.reason}
            </p>
          )}
          {closed && hypothesis.verdictReason !== null && (
            <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {hypothesis.verdictReason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {offer !== null && !closed && (
              <button
                type="button"
                data-tour="hypothesis-confirm-verdict"
                disabled={busy}
                onClick={onConfirmVerdict}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
              >
                <IconCheck className="h-3 w-3" />
                Confirm {STATUS_LABELS[offer.status].toLowerCase()}
              </button>
            )}
            {!closed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
              >
                Amend
              </button>
            )}
            {!closed && (
              <button
                type="button"
                disabled={busy}
                onClick={onDrop}
                className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
              >
                Drop
              </button>
            )}
            {hypothesis.origin === "MANAGER" && (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                aria-label="Delete this question"
                className="cursor-pointer rounded-lg border border-slate-300 p-1.5 text-slate-400 disabled:opacity-50 dark:border-slate-700"
              >
                <IconTrash className="h-3 w-3" />
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

/**
 * The open questions list, plus the one place a manager can write his own.
 *
 * Nothing here is generated: the list is what he accepted, and the box at the end is the only way a question appears
 * that the engine did not think of.
 */
export function HypothesisList({
  hypotheses,
  busyId,
  onConfirmVerdict,
  onDrop,
  onAmend,
  onDelete,
  onCreate,
}: {
  hypotheses: HypothesisWithEvidence[];
  busyId: string | null;
  onConfirmVerdict: (id: string) => void;
  onDrop: (id: string) => void;
  onAmend: (id: string, patch: { claim?: string; question?: string | null }) => void;
  onDelete: (id: string) => void;
  onCreate: (claim: string, question: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftQuestion, setDraftQuestion] = useState("");
  const open = hypotheses.filter((hypothesis) => hypothesis.status !== "RESOLVED");
  const closed = hypotheses.filter((hypothesis) => hypothesis.status === "RESOLVED");

  return (
    <div data-tour="hypothesis-list" className="space-y-3">
      {open.length === 0 && closed.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-center font-sans text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No questions are being tracked yet. Accept a proposal above, or write one of your own.
        </p>
      ) : (
        <>
          {open.map((hypothesis) => (
            <HypothesisCard
              key={hypothesis.id}
              hypothesis={hypothesis}
              busy={busyId === hypothesis.id}
              onConfirmVerdict={() => onConfirmVerdict(hypothesis.id)}
              onDrop={() => onDrop(hypothesis.id)}
              onAmend={(patch) => onAmend(hypothesis.id, patch)}
              onDelete={() => onDelete(hypothesis.id)}
            />
          ))}
          {closed.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
              <summary className="cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {closed.length} closed question{closed.length === 1 ? "" : "s"}
              </summary>
              <div className="mt-2 space-y-2">
                {closed.map((hypothesis) => (
                  <div key={hypothesis.id} className="space-y-0.5">
                    <p className="font-sans text-[11px] text-slate-600 dark:text-slate-300">{hypothesis.claim}</p>
                    <p className="font-sans text-[10px] text-slate-400 dark:text-slate-500">
                      {hypothesis.verdictReason ?? "Closed."}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-white/80 p-3.5 dark:border-slate-800/80 dark:bg-slate-900/60">
        <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <IconPlus className="h-3 w-3" />
          Your own question
        </span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Something you want the app to keep reading the matches against"
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <input
          value={draftQuestion}
          onChange={(event) => setDraftQuestion(event.target.value)}
          placeholder="The question it should ask you after a save (optional)"
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          type="button"
          disabled={draft.trim() === ""}
          onClick={() => {
            onCreate(draft.trim(), draftQuestion.trim() === "" ? null : draftQuestion.trim());
            setDraft("");
            setDraftQuestion("");
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#FF8C7A] dark:text-slate-950"
        >
          <IconTarget className="h-3 w-3" />
          Track it
        </button>
      </div>
    </div>
  );
}

/** A small chip used beside the section headings, e.g. how many proposals are waiting. */
export function CountChip({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
      <IconSpark className="h-2.5 w-2.5" />
      {count} {label}
    </span>
  );
}
