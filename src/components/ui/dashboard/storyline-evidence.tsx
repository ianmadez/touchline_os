"use client";

/**
 * The evidence view for one storyline - the app's one permitted second level.
 *
 * It lives in the shell rather than at a route (the same way the player drawer does), because the
 * navigation rule for this project is that level 2 is an expansion of what you were looking at, not
 * a new place you can be. A thread's card is the level-1 summary; every fact behind it is here.
 *
 * Three things make it a real view rather than a panel: an explicit Back action, Escape, and the
 * open thread id kept in the session so a refresh lands back on it.
 */
import React, { useEffect } from "react";
import type { StorylineItem } from "@/lib/events/types";
import type { AppTab } from "@/lib/session";
import {
  categoryLabel,
  eventLabel,
  severityLabel,
  statusLabel,
  storylineDestination,
  storylineDestinationLabel,
  storylineDestinationSubTab,
  type SeasonSubTab,
} from "@/lib/ui/labels";
import { formatEventDate, provenanceLabel, summariseEvent } from "@/lib/ui/events";

const SEVERITY_STYLES: Record<string, string> = {
  WATCH: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  WARNING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  CRITICAL: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

export function StorylineEvidence({
  storyline,
  onClose,
  onNavigateTab,
}: {
  storyline: StorylineItem | null;
  onClose: () => void;
  onNavigateTab: (tab: AppTab, seasonSubTab?: SeasonSubTab | null) => void;
}) {
  // Escape is part of being a dialog. The player drawer does not have this; there is no reason for
  // a second view to inherit the omission.
  useEffect(() => {
    if (!storyline) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [storyline, onClose]);

  if (!storyline) return null;

  const facts = storyline.evidenceEvents ?? [];
  const destination = storylineDestination(storyline.category);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storyline-evidence-title"
    >
      {/* Click-away, kept as a sibling so the panel itself never swallows an accidental click. */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl animate-drawer-in dark:border-slate-800 dark:bg-slate-900/95">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded-md border border-slate-500/30 bg-slate-500/15 px-2 py-0.5 font-sub text-[10px] font-bold text-slate-600 dark:text-slate-300">
              {categoryLabel(storyline.category)}
            </span>
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 font-sub text-[10px] font-bold ${
                SEVERITY_STYLES[storyline.severity] ?? SEVERITY_STYLES.WATCH
              }`}
            >
              {severityLabel(storyline.severity)}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-10 shrink-0 rounded-lg px-3 font-sub text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:text-[#E11D48] cursor-pointer dark:text-slate-400 dark:hover:text-[#FF8C7A]"
          >
            ← Back
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="space-y-1.5">
            <h2
              id="storyline-evidence-title"
              className="font-heading text-lg uppercase tracking-wide text-slate-900 dark:text-slate-100"
            >
              {storyline.title}
            </h2>
            <p className="font-sub text-[11px] text-slate-400">
              {storyline.status === "ACTIVE"
                ? `${storyline.daysActive ?? 1} day${(storyline.daysActive ?? 1) === 1 ? "" : "s"} open`
                : statusLabel(storyline.status)}
              <span aria-hidden="true"> · </span>
              opened {formatEventDate(storyline.openedAt)}
              {storyline.resolvedAt ? (
                <>
                  <span aria-hidden="true"> · </span>
                  closed {formatEventDate(storyline.resolvedAt)}
                </>
              ) : null}
            </p>
          </div>

          {/* The composed report: what the situation is, how it got there, and the call it implies. */}
          <p className="font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            {storyline.body}
          </p>

          {/* A severity a manager cannot account for is one they learn to ignore, so the reason the
              thread is as loud as it is sits with it rather than in a tooltip. */}
          {storyline.severityReason ? (
            <p className="rounded-lg border border-slate-200 px-3 py-2 font-sub text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {storyline.severityReason}
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
              What we know ({facts.length})
            </h3>
            {facts.length === 0 ? (
              <p className="font-sub text-xs italic text-slate-500">
                Nothing recorded on this thread yet.
              </p>
            ) : (
              facts.map((fact) => (
                <div
                  key={fact.id}
                  className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <p className="font-sans text-xs text-slate-700 dark:text-slate-300">
                    {summariseEvent(fact)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 font-sub text-[10px] text-slate-400">
                    <span>{provenanceLabel(fact.source)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{eventLabel(fact.eventType)}</span>
                    <span aria-hidden="true">·</span>
                    {/* The save's own date where the fact has one - when it happened in the career,
                        which is not the same question as when we noticed it. */}
                    {fact.inGameDate ? (
                      <span>
                        {fact.inGameDate}
                        <span className="text-slate-300 dark:text-slate-600">
                          {" "}
                          (recorded {formatEventDate(fact.timestamp)})
                        </span>
                      </span>
                    ) : (
                      <span>{formatEventDate(fact.timestamp)}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>

        {/* A thread you cannot act on from here is decoration, so the destination stays reachable. */}
        <footer className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onNavigateTab(destination, storylineDestinationSubTab(storyline.category))}
            className="w-full rounded-xl bg-[#E11D48] px-4 py-3 font-sub text-xs font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-[#FF8C7A] cursor-pointer"
          >
            {storylineDestinationLabel(storyline.category)} →
          </button>
        </footer>
      </div>
    </div>
  );
}
