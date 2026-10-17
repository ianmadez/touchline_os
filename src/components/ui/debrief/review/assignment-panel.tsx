"use client";

import React from "react";

import type { Assignment, AssignmentProgress, AssignmentProposal } from "@/lib/assignments/types";
import { IconCheck, IconFlag, IconTrend, IconUserEntry, IconWallet } from "@/components/ui/icons";

/**
 * The assignments panel.
 *
 * WHAT IT IS FOR. A review ends with a decision; this is where the decision becomes a commitment with a number
 * attached and a way of telling later whether it worked. Every assignment shows its own progress computed from the
 * matches since it was taken, so the panel is never a list of good intentions.
 *
 * The points target is pre-filled into the next block rather than applied silently: the manager sees the band before
 * he saves it, and can change it there like any other band.
 */

const TYPE_LABELS: Record<string, string> = {
  POINTS_TARGET: "Points target",
  TACTICAL_EXPERIMENT: "Tactical experiment",
  PLAYER_WATCH: "Player watch",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  POINTS_TARGET: <IconWallet className="h-3.5 w-3.5" />,
  TACTICAL_EXPERIMENT: <IconFlag className="h-3.5 w-3.5" />,
  PLAYER_WATCH: <IconUserEntry className="h-3.5 w-3.5" />,
};

const OFFER_LABELS: Record<string, string> = {
  RETAIN: "It worked, keep it",
  REVERT: "Go back to what you had",
  EXTEND: "Keep going, more matches needed",
  INCONCLUSIVE: "Too close to call",
};

export function AssignmentPanel({
  active,
  proposals,
  positionLine,
  nextBlockIndex,
  busyKey,
  onAccept,
  onClose,
}: {
  active: Array<{ assignment: Assignment; progress: AssignmentProgress }>;
  proposals: AssignmentProposal[];
  positionLine: string | null;
  nextBlockIndex: number;
  busyKey: string | null;
  onAccept: (proposal: AssignmentProposal) => void;
  onClose: (assignment: Assignment, status: "MET" | "MISSED" | "CONCLUDED") => void;
}) {
  if (active.length === 0 && proposals.length === 0 && positionLine === null) return null;

  return (
    <div data-tour="assignment-panel" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <IconTrend className="h-3.5 w-3.5 text-[#E11D48] dark:text-[#FF8C7A]" />
          What you have taken on
        </span>
        {positionLine !== null && (
          <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">{positionLine}</span>
        )}
      </div>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 font-sans text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Nothing active. Anything you take from a review shows up here with its progress against the matches since.
        </p>
      ) : (
        <div className="space-y-2">
          {active.map(({ assignment, progress }) => (
            <div
              key={assignment.id}
              className="space-y-1.5 rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {TYPE_ICONS[assignment.type]}
                  {TYPE_LABELS[assignment.type] ?? assignment.type}
                  {assignment.formationLabel !== null && (
                    <span className="text-slate-400 dark:text-slate-500">· {assignment.formationLabel}</span>
                  )}
                  {assignment.playerId !== null && (
                    <span className="text-slate-400 dark:text-slate-500">· {assignment.playerId}</span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  {progress.offer !== null && (
                    <button
                      type="button"
                      disabled={busyKey === assignment.id}
                      onClick={() =>
                        onClose(assignment, progress.offer === "RETAIN" ? "MET" : "CONCLUDED")
                      }
                      className="flex cursor-pointer items-center gap-1 rounded-md bg-[#E11D48] px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
                    >
                      <IconCheck className="h-2.5 w-2.5" />
                      {OFFER_LABELS[progress.offer] ?? "Close it"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyKey === assignment.id}
                    onClick={() => onClose(assignment, "CONCLUDED")}
                    className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
                  >
                    Close
                  </button>
                </div>
              </div>
              <p className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {progress.line}
              </p>
              {progress.offerReason !== null && (
                <p className="font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {progress.offerReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((proposal) => (
            <div
              key={proposal.type}
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40"
            >
              <div className="min-w-[12rem] flex-1">
                <p className="font-heading text-xs text-slate-900 dark:text-slate-100">
                  {proposal.type === "POINTS_TARGET"
                    ? `Target ${proposal.value} points for block ${nextBlockIndex}`
                    : proposal.type === "TACTICAL_EXPERIMENT"
                      ? `Run ${proposal.formationLabel} for ${proposal.matchesTarget} matches`
                      : `Watch ${proposal.playerName} for ${proposal.matchesTarget} matches`}
                </p>
                <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {proposal.rationale}
                </p>
                {proposal.type === "POINTS_TARGET" && (
                  <p className="mt-1 font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                    {proposal.stretch !== null
                      ? `A stretch of ${proposal.stretch} is one more than that, offered because you are behind your target place. It is a stretch, not the standard.`
                      : "No stretch is offered: you are not behind your target place."}
                  </p>
                )}
                {proposal.type === "TACTICAL_EXPERIMENT" && (
                  <p className="mt-1 font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                    Judged against {proposal.baselinePointsPerGame} points a game, which is what the shape it replaces
                    returned.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busyKey === `${proposal.type}`}
                onClick={() => onAccept(proposal)}
                className="cursor-pointer rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
              >
                Take it on
              </button>
            </div>
          ))}
        </div>
      )}

      {proposals.some((proposal) => proposal.type === "POINTS_TARGET") && (
        <p className="font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
          A points target fills in the band of the next group debrief when you start it. It never changes the block you
          have already saved.
        </p>
      )}
    </div>
  );
}
