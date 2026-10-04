"use client";

import React, { useCallback, useEffect, useState } from "react";
import { IconNote, IconWhistle } from "@/components/ui/icons";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The group-debrief nudge.
 *
 * Shown on the dashboard, after a sync, and only when the manager has actually asked for a
 * five-match cadence in Settings. It counts what the diary has not caught up with rather than
 * tracking whether a sync happened: if a block's worth of matches has gone unreported, the prompt is
 * true whether the manager syncs ten times or once, and it clears itself the moment the block is
 * written up.
 *
 * The arithmetic is deliberately conservative. `matchesPlayed` comes from the save's own progress
 * series, and the reported count is the number of matches this career has actually had reported in a
 * block - so a block still being filled in counts for exactly what it contains.
 */
export function GroupDebriefPrompt({
  careerId,
  seasonNumber,
  matchesPlayed,
  enabled,
  onOpenDebrief,
}: {
  careerId: string | null;
  seasonNumber: number | null;
  matchesPlayed: number;
  enabled: boolean;
  onOpenDebrief: () => void;
}) {
  const [reportedMatches, setReportedMatches] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!careerId || !enabled || seasonNumber === null) return;
    try {
      // Scoped to the season being counted: `matchesPlayed` is this season's, so a block written
      // last season must not read as covering it.
      const response = await apiFetch(
        `/api/season/blocks?careerId=${encodeURIComponent(careerId)}&season=${seasonNumber}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        blocks?: Array<{ block: { matches: Array<{ goalsFor: number | null }> } }>;
      };
      if (!payload.success || !Array.isArray(payload.blocks)) return;
      const written = payload.blocks.reduce(
        (total, row) =>
          total + row.block.matches.filter((match) => match.goalsFor !== null).length,
        0
      );
      setReportedMatches(written);
    } catch {
      // No prompt is better than a wrong one; the Debrief tab reports its own errors.
    }
  }, [careerId, enabled, seasonNumber]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    if (seasonNumber === null) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, seasonNumber]);

  const outstanding = reportedMatches === null ? 0 : matchesPlayed - reportedMatches;
  if (!enabled || dismissed || outstanding <= 0) return null;

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[#E11D48]/30 bg-[#E11D48]/5 p-5 dark:border-[#FF8C7A]/30 dark:bg-[#FF8C7A]/5">
      <div className="flex items-start gap-3">
        <IconWhistle className="mt-0.5 h-5 w-5 shrink-0 text-[#E11D48] dark:text-[#FF8C7A]" />
        <div className="space-y-1">
          <p className="font-heading text-xs uppercase tracking-wider text-slate-900 dark:text-slate-100">
            {outstanding} {outstanding === 1 ? "match" : "matches"} not written up
          </p>
          <p className="max-w-xl font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            You set your debrief cadence to a Group Debrief every five matches. {reportedMatches ?? 0}{" "}
            of {matchesPlayed} have been reported for this season, so the next block is ready to fill
            in.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenDebrief}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-white shadow-sm shadow-rose-600/20 transition-colors hover:bg-[#c4173d] dark:bg-[#FF8C7A] dark:text-slate-950"
        >
          <IconNote className="h-4 w-4" />
          Write the block
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss this reminder"
          title="Hide this reminder until the next match is played"
          className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
        >
          Later
        </button>
      </div>
    </div>
  );
}
