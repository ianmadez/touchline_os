"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardObjective } from "@/lib/services/board-objective-service";
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DEFAULT_PRIORITY,
  OBJECTIVE_CATALOGUE,
  OBJECTIVE_CATEGORIES,
  OBJECTIVE_STATUSES,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_LABELS,
  STATUS_STYLES,
  type ObjectiveCategory,
  type ObjectiveStatus,
} from "@/lib/objectives-vocabulary";
import { IconCheck, IconFlag, IconPlus, IconTarget, IconTrash } from "@/components/ui/icons";

/**
 * The board-objective tracker.
 *
 * The save carries ONE numeric objective code and no wording at all, so there is nothing to derive
 * these from and nobody but the manager knows what he was actually given. That is why the flow is
 * pick-then-track rather than read-then-display.
 *
 * The "help" here is deliberate and bounded: it orders his objectives the way the board does (by
 * priority), it names the single most urgent one that is not yet done, and it refuses to invent
 * progress it cannot measure. A tracker that claimed "62% complete" off a heuristic would be worse
 * than one that says "you judge this one".
 */
export function BoardObjectivesPanel({
  careerId,
  seasonNumber,
}: {
  careerId: string;
  seasonNumber: number;
}) {
  const [objectives, setObjectives] = useState<BoardObjective[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Draft state for the add form.
  const [category, setCategory] = useState<ObjectiveCategory>("DOMESTIC");
  const [title, setTitle] = useState<string>(OBJECTIVE_CATALOGUE.DOMESTIC[0]);
  const [priority, setPriority] = useState<number>(DEFAULT_PRIORITY);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!careerId) return;
    try {
      const response = await fetch(
        `/api/objectives?careerId=${encodeURIComponent(careerId)}&season=${seasonNumber}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        objectives?: BoardObjective[];
        error?: string;
      };
      if (payload.success && payload.objectives) {
        setObjectives(payload.objectives);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read your objectives.");
      }
    } catch {
      setError("Could not reach the objectives service.");
    } finally {
      setLoading(false);
    }
  }, [careerId, seasonNumber]);

  // Deferred a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const send = useCallback(
    async (url: string, init: RequestInit): Promise<void> => {
      const response = await fetch(url, init);
      const payload = (await response.json()) as {
        success?: boolean;
        objectives?: BoardObjective[];
        error?: string;
      };
      if (payload.success && payload.objectives) {
        setObjectives(payload.objectives);
        setError(null);
      } else {
        setError(payload.error ?? "That change could not be saved.");
      }
    },
    []
  );

  const add = useCallback(async () => {
    if (title.trim() === "") return;
    setAdding(true);
    try {
      await send("/api/objectives", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, seasonNumber, category, priority, title }),
      });
    } finally {
      setAdding(false);
    }
  }, [careerId, seasonNumber, category, priority, title, send]);

  const summary = useMemo(() => {
    const counts: Record<ObjectiveStatus, number> = { ON_TRACK: 0, AT_RISK: 0, ACHIEVED: 0, FAILED: 0 };
    for (const objective of objectives) counts[objective.status] += 1;
    // The one thing worth surfacing unprompted: the highest-priority objective still open. If two
    // share a priority the earlier one in the list wins, which is the server's own order.
    const open = objectives.filter((o) => o.status === "ON_TRACK" || o.status === "AT_RISK");
    const focus = open.length > 0 ? open.reduce((worst, o) => (o.priority < worst.priority ? o : worst)) : null;
    return { counts, focus };
  }, [objectives]);

  const catalogue = OBJECTIVE_CATALOGUE[category];

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sans text-dense text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* ---- The summary: what the board actually asked for, in order of pressure ---- */}
      <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            <IconTarget className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            Board objectives
          </h2>
          <span className="font-sub text-label uppercase tracking-wider text-slate-400 tabular-nums">
            Season {seasonNumber}
          </span>
        </header>

        {objectives.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-sub text-dense tabular-nums">
            {OBJECTIVE_STATUSES.map((status) => (
              <span key={status} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className={`rounded-md px-2 py-0.5 font-bold uppercase text-label tracking-wider ${STATUS_STYLES[status]}`}>
                  {STATUS_LABELS[status]}
                </span>
                {summary.counts[status]}
              </span>
            ))}
          </div>
        )}

        {summary.focus && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 font-sans text-dense leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
            <IconFlag className="mt-0.5 h-4 w-4 shrink-0 text-[#E11D48] dark:text-[#FF8C7A]" />
            <span>
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {PRIORITY_LABELS[summary.focus.priority]}
              </span>{" "}
              &mdash; {summary.focus.title} is the most demanding objective still open. The board weighs
              this one heaviest.
            </span>
          </p>
        )}

        {/* ---- Add: pick what you were given ---- */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Category
            </span>
            <select
              value={category}
              onChange={(event) => {
                const next = event.target.value as ObjectiveCategory;
                setCategory(next);
                // The catalogue changes with the category, so the previous title is now nonsense.
                setTitle(OBJECTIVE_CATALOGUE[next][0]);
              }}
              className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-dense text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {OBJECTIVE_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-sans text-dense text-slate-500 dark:text-slate-400">
              {CATEGORY_HINTS[category]}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Priority the board set
            </span>
            <select
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-dense text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {PRIORITY_ORDER.map((value) => (
                <option key={value} value={value}>
                  {value} &middot; {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-sans text-dense text-slate-500 dark:text-slate-400">
              The game scales this by club size and history - set it to whatever your board shows.
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Objective
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              list={`objective-catalogue-${category}`}
              placeholder="Pick one or type your own wording"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-dense text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <datalist id={`objective-catalogue-${category}`}>
              {catalogue.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>

          <button
            type="button"
            onClick={() => void add()}
            disabled={adding || title.trim() === ""}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#E11D48] px-4 py-2 font-heading text-dense font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] disabled:opacity-40 sm:col-span-2 dark:bg-[#FF8C7A] dark:text-slate-950"
          >
            <IconPlus className="h-4 w-4" />
            {adding ? "Adding" : "Add objective"}
          </button>
        </div>
      </section>

      {/* ---- The list ---- */}
      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 font-sans text-dense text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Reading your objectives&hellip;
        </p>
      ) : objectives.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 font-sans text-dense leading-relaxed text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Nothing recorded yet. Pick the objectives your board handed you above and they will be
          tracked here, ordered by how much the board cares about each one.
        </p>
      ) : (
        <ul className="space-y-2">
          {objectives.map((objective) => (
            <li
              key={objective.id}
              className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
                      {objective.title}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {objective.priority} &middot; {PRIORITY_LABELS[objective.priority]}
                    </span>
                  </div>
                  <p className="mt-1 font-sub text-label uppercase tracking-wider text-slate-400">
                    {CATEGORY_LABELS[objective.category]}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label>
                    <span className="sr-only">Status</span>
                    <select
                      value={objective.status}
                      disabled={busyId === objective.id}
                      onChange={(event) => {
                        setBusyId(objective.id);
                        void send("/api/objectives", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: objective.id,
                            careerId,
                            seasonNumber,
                            category: objective.category,
                            priority: objective.priority,
                            title: objective.title,
                            status: event.target.value as ObjectiveStatus,
                            notes: objective.notes,
                          }),
                        }).finally(() => setBusyId(null));
                      }}
                      className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-sub text-label font-bold uppercase tracking-wider text-slate-700 focus:border-[#E11D48] focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {OBJECTIVE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${objective.title}`}
                    title="Remove this objective"
                    onClick={() =>
                      void send(
                        `/api/objectives?careerId=${encodeURIComponent(careerId)}&season=${seasonNumber}&id=${encodeURIComponent(objective.id)}`,
                        { method: "DELETE" }
                      )
                    }
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-500/50 dark:hover:text-rose-400"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <textarea
                defaultValue={objective.notes ?? ""}
                onBlur={(event) => {
                  const next = event.target.value.trim() || null;
                  if (next === (objective.notes ?? null)) return;
                  void send("/api/objectives", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: objective.id,
                      careerId,
                      seasonNumber,
                      category: objective.category,
                      priority: objective.priority,
                      title: objective.title,
                      status: objective.status,
                      notes: next,
                    }),
                  });
                }}
                rows={2}
                placeholder="What the board wants in your own words, and how you plan to get there."
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-dense leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 font-sans text-dense leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
        <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          The save stores a single board-objective code and no wording, so these are yours &mdash;
          recorded and edited by you, never derived or overwritten. Status is your judgement, not a
          calculated figure.
        </span>
      </p>
    </div>
  );
}
