"use client";

import React from "react";

import type { ReviewDecisionRecord } from "@/lib/operations/review";
import { RULES_TOGGLE_LABELS, type ReviewOption } from "@/lib/review/types";

/**
 * One option, with the chips that say what accepting it would create.
 *
 * The chips are the mechanics and the label is the decision, kept apart on purpose: a manager should be able to read
 * the label alone and know what he is choosing, and read the chips to know what lands in the next block.
 *
 * A decision already taken stays visible as taken rather than disappearing. The engine is regenerated on every read,
 * so an option that vanished after being accepted would look like it had been withdrawn.
 */
export function ReviewOptionCard({
  option,
  decision,
  busy,
  onDecide,
}: {
  option: ReviewOption;
  decision: ReviewDecisionRecord | null;
  busy: boolean;
  onDecide: (decision: "ACCEPTED" | "DROPPED" | "PENDING") => void;
}) {
  const taken = decision?.decision === "ACCEPTED";
  const dropped = decision?.decision === "DROPPED";

  return (
    <div
      data-tour="review-option"
      className={`space-y-2 rounded-xl border p-3.5 ${
        taken
          ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
          : dropped
            ? "border-slate-200 bg-slate-50/60 opacity-70 dark:border-slate-800 dark:bg-slate-950/40"
            : "border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[12rem] flex-1">
          <span className="block font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
            {option.label}
          </span>
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
            {option.rationale}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busy || taken}
            onClick={() => onDecide("ACCEPTED")}
            className="cursor-pointer rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950 dark:hover:bg-[#ff7a63]"
          >
            {taken ? "Taken" : "Take it"}
          </button>
          <button
            type="button"
            disabled={busy || dropped}
            onClick={() => onDecide("DROPPED")}
            className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
          >
            {dropped ? "Dropped" : "Drop"}
          </button>
        </div>
      </div>

      <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {option.creates}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {option.chips.map((chip) => (
          <span
            key={chip}
            className="rounded-md bg-slate-100 px-1.5 py-0.5 font-sub text-[10px] uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The line shown when the rules profile removed every option. */
export function ReviewFilteredLine({ toggles }: { toggles: string[] }) {
  const names = toggles
    .map((toggle) => RULES_TOGGLE_LABELS[toggle as keyof typeof RULES_TOGGLE_LABELS] ?? toggle)
    .join(", ");
  return (
    <p className="rounded-xl border border-amber-300 bg-amber-50/70 px-3.5 py-2.5 font-sans text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      Nothing here fits the rules you set, so there is no decision to take. The toggle responsible is {names}.
      You can change it in the rules profile.
    </p>
  );
}
