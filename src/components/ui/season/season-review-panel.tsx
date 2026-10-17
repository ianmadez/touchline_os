"use client";

import React, { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import type { SeasonReview, SeasonReviewSection } from "@/lib/season/handover";
import { carryOverOptionId } from "@/lib/season/handover";
import {
  IconArrowIn,
  IconCalendar,
  IconCheck,
  IconFlag,
  IconNote,
  IconPerson,
  IconSliders,
  IconSpark,
  IconTable,
  IconTarget,
  IconTrend,
  IconTrophy,
  IconUnavailable,
  IconWallet,
} from "@/components/ui/icons";

/**
 * The season, read back.
 *
 * This is the page that closes a season. Without it a new season simply starts on top of the old one: the table
 * resets, the objectives disappear and nothing says what happened. Every section names which half it came from,
 * because the save's record and the manager's own notes are two different kinds of fact and this is the screen where
 * confusing them would do the most damage.
 *
 * Nothing here blocks the next season. The carry-over rows default to keep, the answer is only a preference about
 * what follows him, and the season-end pass has already run by the time this renders.
 */

const PROVENANCE_LABELS: Record<SeasonReviewSection["provenance"], string> = {
  SAVE: "From your save",
  OBSERVED: "What we watched",
  USER: "Your notes",
};

const PROVENANCE_STYLES: Record<SeasonReviewSection["provenance"], string> = {
  SAVE: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  OBSERVED: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  USER: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

const KIND_LABELS: Record<string, string> = {
  OBJECTIVE: "Objective",
  HYPOTHESIS: "Question",
  ASSIGNMENT: "Assignment",
  FORMATION: "Shape",
};

/**
 * A section's mark.
 *
 * Eight cards of equal weight read as a wall of text, so each one is identified by a shape before it is read: the
 * record is the table, objectives are the target, money is the wallet. The icon repeats what the title says rather
 * than replacing it, and it is hidden from assistive tech because the title is right beside it.
 */
const SECTION_ICONS: Record<SeasonReviewSection["id"], React.ReactNode> = {
  RECORD: <IconTable className="h-3.5 w-3.5" />,
  OBJECTIVES: <IconTarget className="h-3.5 w-3.5" />,
  TACTICS: <IconSliders className="h-3.5 w-3.5" />,
  SQUAD: <IconPerson className="h-3.5 w-3.5" />,
  PATTERNS: <IconTrend className="h-3.5 w-3.5" />,
  QUESTIONS: <IconCalendar className="h-3.5 w-3.5" />,
  YOUTH: <IconSpark className="h-3.5 w-3.5" />,
  MONEY: <IconWallet className="h-3.5 w-3.5" />,
};

/** The carry-over list's own marks, so a row's kind is visible before the label is read. */
const KIND_ICONS: Record<string, React.ReactNode> = {
  OBJECTIVE: <IconTarget className="h-3 w-3" />,
  HYPOTHESIS: <IconFlag className="h-3 w-3" />,
  ASSIGNMENT: <IconNote className="h-3 w-3" />,
  FORMATION: <IconSliders className="h-3 w-3" />,
};

export function SeasonReviewPanel({
  careerId,
  season,
}: {
  careerId: string;
  /** The season the vault is showing. */
  season: number;
}) {
  const [review, setReview] = useState<SeasonReview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "ACCEPTED" | "DROPPED">>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitionNote, setTransitionNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!careerId) return;
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/season/review?careerId=${encodeURIComponent(careerId)}&season=${season}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as {
        success?: boolean;
        review?: SeasonReview | null;
        decisions?: Array<{ optionId: string; decision: string }>;
        error?: string;
      };
      if (!body.success) {
        setError(body.error ?? "Could not read this season back.");
        setReview(null);
        return;
      }
      setReview(body.review ?? null);
      setDecisions(
        Object.fromEntries(
          (body.decisions ?? [])
            .filter((entry) => entry.decision === "ACCEPTED" || entry.decision === "DROPPED")
            .map((entry) => [entry.optionId, entry.decision as "ACCEPTED" | "DROPPED"])
        )
      );
      setError(null);
    } catch {
      setError("Could not reach the season service.");
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [careerId, season]);

  useEffect(() => {
    // Deferred by a task rather than set in the effect body, like every other loader in the app.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const decide = async (optionId: string, decision: "ACCEPTED" | "DROPPED", kind: string, refId: string) => {
    setBusy(optionId);
    try {
      const response = await apiFetch("/api/season/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, season, items: [{ kind, refId, decision }] }),
      });
      const body = (await response.json()) as { success?: boolean; error?: string };
      if (!body.success) {
        setError(body.error ?? "Could not record that answer.");
        return;
      }
      setDecisions((current) => ({ ...current, [optionId]: decision }));
      setError(null);
    } catch {
      setError("Could not reach the season service.");
    } finally {
      setBusy(null);
    }
  };

  const runTransition = async () => {
    setBusy("transition");
    try {
      const response = await apiFetch(
        `/api/season/review?careerId=${encodeURIComponent(careerId)}&action=transition`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as { success?: boolean; changes?: number; error?: string };
      if (!body.success) {
        setError(body.error ?? "Could not close the season out.");
        return;
      }
      setTransitionNote(
        body.changes === 0
          ? "Nothing left to close. This season was already closed out."
          : `Closed ${body.changes} thing${body.changes === 1 ? "" : "s"} out: objectives judged, threads settled, the boundary marked.`
      );
      await load();
    } catch {
      setError("Could not reach the season service.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 font-sans text-xs text-slate-600 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/90 dark:text-slate-400">
        Reading the season back…
      </p>
    );
  }

  if (error !== null && review === null) {
    return (
      <p className="rounded-2xl border border-rose-300 bg-rose-50 p-5 font-sans text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </p>
    );
  }

  if (review === null) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 font-sans text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
        This season has no record yet. Once the save writes one, it is read back here.
      </p>
    );
  }

  const kept = review.carryOver.filter(
    (item) => decisions[carryOverOptionId(item.kind, item.refId)] !== "DROPPED"
  ).length;

  return (
    <section
      data-tour="season-review"
      className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
            <IconTrophy className="h-3.5 w-3.5" />
            The season, read back
          </span>
          <h3 className="mt-1 font-heading text-lg uppercase tracking-wide text-slate-900 dark:text-slate-100">
            {review.headline}
          </h3>
          {review.subhead !== "" && (
            <p className="mt-1 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {review.subhead}
            </p>
          )}
        </div>
        {review.complete ? (
          <button
            type="button"
            disabled={busy === "transition"}
            onClick={() => void runTransition()}
            className="cursor-pointer rounded-xl border border-slate-300 px-3.5 py-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
          >
            {busy === "transition" ? "Closing out…" : `Close season ${review.season} out`}
          </button>
        ) : (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Still running
          </span>
        )}
      </header>

      {transitionNote !== null && (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50/70 px-3.5 py-2.5 font-sans text-[11px] leading-relaxed text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
          {transitionNote}
        </p>
      )}

      {review.closing !== null && (
        <blockquote className="border-l-2 border-[#E11D48]/40 pl-3 font-sans text-[11px] leading-relaxed text-slate-600 italic dark:border-[#FF8C7A]/40 dark:text-slate-400">
          Your last note of the season: {review.closing}
        </blockquote>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {review.sections.map((section) => (
          <div
            key={section.id}
            className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 font-heading text-[11px] uppercase tracking-wide text-slate-800 dark:text-slate-200">
                <span aria-hidden="true" className="text-[#E11D48] dark:text-[#FF8C7A]">
                  {SECTION_ICONS[section.id]}
                </span>
                {section.title}
              </h4>
              <span
                className={`rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${PROVENANCE_STYLES[section.provenance]}`}
              >
                {PROVENANCE_LABELS[section.provenance]}
              </span>
            </div>
            {section.lines.map((line, index) => (
              <p
                key={`${section.id}-${index}`}
                className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
              >
                {line}
              </p>
            ))}
            {section.counts.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {section.counts.map((count) => (
                  <span
                    key={count.label}
                    className="font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500"
                  >
                    {count.label}{" "}
                    <span className="font-bold text-slate-700 tabular-nums dark:text-slate-200">{count.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {review.carryOver.length > 0 && (
        <div data-tour="season-carry-over" className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <IconArrowIn className="h-3.5 w-3.5" />
              What follows you into season {review.season + 1}
            </span>
            <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">
              {kept} of {review.carryOver.length} kept. Nothing here holds the new season up.
            </span>
          </div>
          <div className="space-y-1.5">
            {review.carryOver.map((item) => {
              const optionId = carryOverOptionId(item.kind, item.refId);
              const decision = decisions[optionId] ?? "ACCEPTED";
              return (
                <div
                  key={optionId}
                  className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 ${
                    decision === "DROPPED"
                      ? "border-slate-200 bg-slate-100/60 opacity-70 dark:border-slate-800 dark:bg-slate-950/50"
                      : "border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/60"
                  }`}
                >
                  <div className="min-w-[12rem] flex-1">
                    <span className="flex items-center gap-1 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      <span aria-hidden="true">{KIND_ICONS[item.kind]}</span>
                      {KIND_LABELS[item.kind] ?? item.kind}
                    </span>
                    <p className="font-sans text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {item.label}
                    </p>
                    <p className="font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                      {item.detail}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy === optionId || decision === "ACCEPTED"}
                      onClick={() => void decide(optionId, "ACCEPTED", item.kind, item.refId)}
                      className="flex cursor-pointer items-center gap-1 rounded-md bg-slate-900 px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
                    >
                      <IconCheck className="h-2.5 w-2.5" />
                      Keep
                    </button>
                    <button
                      type="button"
                      disabled={busy === optionId || decision === "DROPPED"}
                      onClick={() => void decide(optionId, "DROPPED", item.kind, item.refId)}
                      className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400"
                    >
                      <IconUnavailable className="h-2.5 w-2.5" />
                      Drop
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error !== null && (
        <p className="font-sans text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <p className="flex items-start gap-1.5 font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
        <IconFlag className="mt-0.5 h-3 w-3 shrink-0" />
        Kept items carry forward on their own. Dropping one only means it will not be suggested again.
      </p>

      {review.carryOver.length === 0 && (
        <p className="flex items-center gap-1.5 font-sans text-[11px] text-slate-500 dark:text-slate-400">
          <IconSpark className="h-3 w-3" />
          Nothing carried over from this season.
        </p>
      )}
    </section>
  );
}
