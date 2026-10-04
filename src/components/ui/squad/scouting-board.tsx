"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ScoutAssessment } from "@/lib/services/scouting-service";
import type { ScoutTargetPriority, ScoutTargetStatus } from "@/lib/db/schema";
import { IconCheck, IconTrash, IconUserEntry } from "@/components/ui/icons";

/**
 * The shortlist - a hand-picked layer on top of the world search.
 *
 * Distinct from the search on purpose. The search answers "who fits this question"; the shortlist is
 * the manager's own handful, with his stage, his priority and his reasoning, surviving against a
 * changing search. A player pulled from a result arrives fully populated - rating, club, age,
 * position - so the ONLY things he types are the judgement calls, which is the whole point of wiring
 * the two together rather than asking him to retype what the save already knows.
 *
 * The status vocabularies are exported because the transfers desk renders the same stages.
 */
export const STATUS_LABELS: Record<ScoutTargetStatus, string> = {
  WATCHING: "Watching",
  SHORTLISTED: "Shortlisted",
  BID: "Bid made",
  AGREED: "Fee agreed",
  SIGNED: "Signed",
  PASSED: "Passed",
};

export const STATUS_STYLES: Record<ScoutTargetStatus, string> = {
  WATCHING: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  SHORTLISTED: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  BID: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  AGREED: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  SIGNED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  PASSED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

export const PRIORITY_LABELS: Record<ScoutTargetPriority, string> = {
  DREAM: "Dream target",
  TOP: "Top priority",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

/** Stages that mean the manager has decided to act, as opposed to merely watching. */
export const ACTIVE_SCOUT_STATUSES: ReadonlySet<ScoutTargetStatus> = new Set<ScoutTargetStatus>([
  "SHORTLISTED",
  "BID",
  "AGREED",
]);

/** A rejection reason is only offered once he has actually been passed on. */
const REJECTION_HINT = "Why you passed on him - the fee, his age, a better option elsewhere.";

export function ShortlistPanel({
  careerId,
  /** Bumped by the search when a player is pinned, so the list refreshes without a full reload. */
  refreshKey = 0,
}: {
  careerId: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<ScoutAssessment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/scouting?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        board?: { assessments: ScoutAssessment[] };
        error?: string;
      };
      if (payload.success && payload.board) {
        setEntries(payload.board.assessments);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read your shortlist.");
      }
    } catch {
      setError("Could not reach the shortlist service.");
    } finally {
      setLoading(false);
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const mutate = useCallback(
    async (init: RequestInit & { url: string }) => {
      const response = await fetch(init.url, init);
      const payload = (await response.json()) as {
        success?: boolean;
        board?: { assessments: ScoutAssessment[] };
        error?: string;
      };
      if (payload.success && payload.board) {
        setEntries(payload.board.assessments);
        setError(null);
      } else {
        setError(payload.error ?? "That change could not be saved.");
      }
    },
    []
  );

  const patch = useCallback(
    async (assessment: ScoutAssessment, changes: Partial<ScoutAssessment["target"]>) => {
      const t = assessment.target;
      setBusyId(t.id);
      try {
        await mutate({
          url: "/api/scouting",
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            careerId,
            name: t.name,
            eaPlayerId: t.eaPlayerId,
            clubName: t.clubName,
            position: t.position,
            age: t.age,
            overallRating: t.overallRating,
            potentialRating: t.potentialRating,
            valueEstimate: t.valueEstimate,
            askingPrice: t.askingPrice,
            wageDemand: t.wageDemand,
            priority: changes.priority ?? t.priority,
            status: changes.status ?? t.status,
            notes: changes.notes === undefined ? t.notes : changes.notes,
          }),
        });
      } finally {
        setBusyId(null);
      }
    },
    [careerId, mutate]
  );

  const grouped = useMemo(() => {
    const order: ScoutTargetStatus[] = ["SHORTLISTED", "BID", "AGREED", "WATCHING", "SIGNED", "PASSED"];
    return [...entries].sort((a, b) => order.indexOf(a.target.status) - order.indexOf(b.target.status));
  }, [entries]);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          <IconUserEntry className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          Your shortlist
        </h2>
        <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
          {grouped.length} {grouped.length === 1 ? "player" : "players"}
        </span>
      </div>

      {error && (
        <p className="m-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="p-5 font-sans text-xs text-slate-600 dark:text-slate-400">Reading your shortlist…</p>
      ) : grouped.length === 0 ? (
        <p className="p-5 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          Nothing pinned yet. Find someone in the search above and use{" "}
          <span className="font-bold">Pin to shortlist</span> — his rating, club, age and position come
          across automatically, so you only add your own stage and reasoning.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {grouped.map(({ target }) => (
            <li key={target.id} className="space-y-2.5 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
                      {target.name}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[target.status]}`}
                    >
                      {STATUS_LABELS[target.status]}
                    </span>
                    {target.eaPlayerId !== null && (
                      <span
                        title="Pinned from the scouting search"
                        className="rounded bg-slate-100 px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      >
                        From search
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
                    {target.clubName ?? "Club unrecorded"}
                    {target.position ? ` · ${target.position}` : ""}
                    {target.age !== null ? ` · age ${target.age}` : ""}
                    {target.overallRating !== null ? ` · OVR ${target.overallRating}` : ""}
                    {target.potentialRating !== null ? ` → ${target.potentialRating}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    <span className="sr-only">Stage</span>
                    <select
                      value={target.status}
                      disabled={busyId === target.id}
                      onChange={(event) =>
                        void patch(
                          { target } as ScoutAssessment,
                          { status: event.target.value as ScoutTargetStatus }
                        )
                      }
                      className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 focus:border-[#E11D48] focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {(Object.keys(STATUS_LABELS) as ScoutTargetStatus[]).map((key) => (
                        <option key={key} value={key}>
                          {STATUS_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="sr-only">Priority</span>
                    <select
                      value={target.priority}
                      disabled={busyId === target.id}
                      onChange={(event) =>
                        void patch(
                          { target } as ScoutAssessment,
                          { priority: event.target.value as ScoutTargetPriority }
                        )
                      }
                      className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 focus:border-[#E11D48] focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {(Object.keys(PRIORITY_LABELS) as ScoutTargetPriority[]).map((key) => (
                        <option key={key} value={key}>
                          {PRIORITY_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${target.name} from the shortlist`}
                    title="Remove from the shortlist"
                    onClick={() =>
                      void mutate({
                        url: `/api/scouting?careerId=${encodeURIComponent(careerId)}&id=${encodeURIComponent(target.id)}`,
                        method: "DELETE",
                      })
                    }
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-500/50 dark:hover:text-rose-400"
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <textarea
                defaultValue={target.notes ?? ""}
                onBlur={(event) => {
                  const next = event.target.value.trim() || null;
                  if (next !== (target.notes ?? null)) {
                    void patch({ target } as ScoutAssessment, { notes: next });
                  }
                }}
                rows={2}
                placeholder={
                  target.status === "PASSED"
                    ? REJECTION_HINT
                    : "What you think of him, who else wants him, what would change your mind."
                }
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 border-t border-slate-200 px-5 py-3 font-sans text-[10px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <IconCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          The shortlist is yours - stage, priority and notes are all recorded as your own, and nothing
          derived from the save or the model will ever overwrite them.
        </span>
      </p>
    </section>
  );
}
