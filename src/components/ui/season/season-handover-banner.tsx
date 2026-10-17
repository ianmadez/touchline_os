"use client";

import React, { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import type { SeasonReview } from "@/lib/season/handover";
import type { SeasonRecord } from "@/lib/services/season-service";
import { IconArrowOut, IconCheck, IconTrophy } from "@/components/ui/icons";

/**
 * The seam between two seasons.
 *
 * Without this, a season ending is invisible: the table simply resets and the previous year is a name in a picker.
 * The banner appears only when a season has finished and the career has moved past it, and it stops appearing once
 * the manager says he has seen it. It never blocks anything - a manager who ignores it loses no state.
 *
 * The two dates matter. One season finishing and another starting are separate beats, and the copy keeps them apart
 * so the screen does not read as a single "welcome to the new season" message.
 */
export function SeasonHandoverBanner({
  careerId,
  seasons,
  currentSeason,
  onOpenSeason,
}: {
  careerId: string;
  seasons: SeasonRecord[];
  /** The season the career is in now. */
  currentSeason: number;
  onOpenSeason: (season: number) => void;
}) {
  const previous = seasons
    .filter((entry) => entry.complete && entry.season < currentSeason)
    .sort((left, right) => right.season - left.season)[0] ?? null;

  const [state, setState] = useState<{
    season: number;
    review: SeasonReview | null;
    done: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!careerId || previous === null) return;
    try {
      const response = await apiFetch(
        `/api/season/review?careerId=${encodeURIComponent(careerId)}&season=${previous.season}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as {
        success?: boolean;
        review?: SeasonReview | null;
        handoverDone?: boolean;
      };
      if (!body.success) {
        setState({ season: previous.season, review: null, done: true });
        return;
      }
      setState({
        season: previous.season,
        review: body.review ?? null,
        done: body.handoverDone === true,
      });
    } catch {
      setState({ season: previous.season, review: null, done: true });
    }
  }, [careerId, previous]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const markDone = async () => {
    if (previous === null) return;
    setBusy(true);
    try {
      await apiFetch("/api/season/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          season: previous.season,
          items: [{ kind: "HANDOVER", refId: "handover", decision: "ACCEPTED" }],
        }),
      });
      setState((current) => (current === null ? current : { ...current, done: true }));
    } catch {
      /* a failure here costs the banner's dismissal, not the season */
    } finally {
      setBusy(false);
    }
  };

  if (previous === null || state === null || state.season !== previous.season || state.done) return null;

  const carryCount = state.review?.carryOver.length ?? 0;
  const headline = state.review?.headline ?? `Season ${previous.season} finished`;

  return (
    <div
      data-tour="season-handover"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E11D48]/30 bg-[#E11D48]/5 px-4 py-3 dark:border-[#FF8C7A]/30 dark:bg-[#FF8C7A]/10"
    >
      <div className="flex min-w-[16rem] flex-1 items-start gap-2.5">
        <IconTrophy className="mt-0.5 h-4 w-4 shrink-0 text-[#E11D48] dark:text-[#FF8C7A]" />
        <div>
          <p className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
            {headline}. Season {currentSeason} is under way.
          </p>
          <p className="mt-0.5 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
            {carryCount === 0
              ? "Nothing was carried over, so the new season starts clean."
              : `${carryCount} thing${carryCount === 1 ? "" : "s"} came across with you. Check them before the first block is saved.`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenSeason(previous.season)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] dark:bg-[#FF8C7A] dark:text-slate-950 dark:hover:bg-[#ff7a63]"
        >
          <IconArrowOut className="h-3 w-3" />
          See season {previous.season}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void markDone()}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-400 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
        >
          <IconCheck className="h-3 w-3" />
          Done
        </button>
      </div>
    </div>
  );
}
