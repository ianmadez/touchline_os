"use client";

import React, { useState } from "react";

import { ordinal } from "@/lib/ui/format";
import { windowPhrase } from "@/lib/review/copy";
import type { Finding, Review } from "@/lib/review/types";
import { IconFlag, IconNote, IconSpark } from "@/components/ui/icons";

/**
 * The short card: the record, the key contrast, a few findings and the decision step.
 *
 * THE ORDER IS DELIBERATE. A manager opens this after a run of matches and wants three things in this order: how it
 * went, what stands out, and what to do about it. The full report is one press away rather than open by default,
 * because eight sections of evidence is what he asks for when he doubts the card, not what he wants on arrival.
 */

const TONE_STYLES: Record<Finding["tone"], string> = {
  GOOD: "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10",
  BAD: "border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10",
  NEUTRAL: "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40",
};

const TONE_LABELS: Record<Finding["tone"], string> = {
  GOOD: "Going well",
  BAD: "Worth a look",
  NEUTRAL: "What the data shows",
};

/** The strength of a finding, as a word rather than a score. */
export function StrengthChip({ finding }: { finding: Finding }) {
  return (
    <span className="rounded-md bg-white/70 px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
      {finding.strength.toLowerCase()}
    </span>
  );
}

/** One finding, with the figures behind it. */
export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className={`space-y-1 rounded-xl border p-3 ${TONE_STYLES[finding.tone]}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {TONE_LABELS[finding.tone]}
        </span>
        <StrengthChip finding={finding} />
      </div>
      <p className="font-heading text-xs leading-snug text-slate-900 dark:text-slate-100">
        {finding.headline}
      </p>
      <p className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
        {finding.detail}
      </p>
    </div>
  );
}

/** The card's own summary of the run, shared with the report's first section. */
export function RecordLine({ review }: { review: Review }) {
  const { record } = review;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-heading text-xs text-slate-800 tabular-nums dark:text-slate-200">
      <span>
        {record.points} / {record.possible} pts
      </span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span>
        {record.wins}W {record.draws}D {record.losses}L
      </span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span>GF {record.goalsFor}</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span>GA {record.goalsAgainst}</span>
    </div>
  );
}

export function ReviewCard({
  review,
  children,
  report,
}: {
  review: Review;
  /** The decision step, rendered by the tab so the card stays about the evidence. */
  children?: React.ReactNode;
  /** The expanded report, shown when the manager asks for it. */
  report?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const top = [...review.findings].sort((left, right) => rank(left) - rank(right)).slice(0, 3);

  return (
    <div
      data-tour="review-card"
      className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
            <IconFlag className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            {review.kind === "BLOCK" ? `Block ${review.block?.blockIndex ?? ""} review` : "Window review"}
          </h3>
          <p className="mt-1 font-sans text-[11px] text-slate-500 dark:text-slate-400">
            {windowPhrase(review.window.count, review.window.from, review.window.to)}
            {review.mergedBothWays > 0
              ? ` · ${review.mergedBothWays} logged both ways and counted once`
              : ""}
          </p>
        </div>
        {review.block !== null && (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {review.block.verdict.replace(/_/g, " ").toLowerCase()} · {review.block.points} of{" "}
            {review.block.possible}
          </span>
        )}
      </div>

      <RecordLine review={review} />

      {review.thin && (
        <p className="flex items-start gap-2 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <IconNote className="mt-0.5 h-3 w-3 shrink-0" />
          {review.resting.withFigures === 0
            ? "No match here has a figure behind it, so this reads the scorelines only."
            : `${review.resting.withFigures} of ${review.matches.length} matches have a figure behind them, so this sample is thin.`}
        </p>
      )}

      {review.contrast !== null && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
          <span className="font-sub text-[9px] font-bold uppercase tracking-wider text-slate-400">
            The key contrast
          </span>
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
            {review.contrast.line}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {top.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>

      {children}

      {report !== undefined && (
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <button
            type="button"
            data-tour="review-full-report"
            onClick={() => setOpen((current) => !current)}
            className="flex cursor-pointer items-center gap-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <IconSpark className="h-3.5 w-3.5" />
            {open ? "Close the full report" : "Open the full report"}
          </button>
          {open && <div className="mt-3 space-y-4">{report}</div>}
        </div>
      )}
    </div>
  );
}

/** Bad news first, measured findings before remembered ones. */
function rank(finding: Finding): number {
  const tone = finding.tone === "BAD" ? 0 : finding.tone === "GOOD" ? 1 : 2;
  const measured = finding.needsFigures ? 0 : 1;
  return tone * 10 + measured;
}

/** A one-line summary of a block's own band, used above the decision step. */
export function BlockBandLine({ review }: { review: Review }) {
  if (review.block === null) return null;
  const { block } = review;
  return (
    <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
      Block {block.blockIndex} was judged against {block.targetMin} to {block.targetMax} pts
      {block.tablePosition === null ? "" : `, and left you ${ordinal(block.tablePosition)}`}. This review reads the
      same five matches.
    </p>
  );
}
