"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ScoutingBoard as Board } from "@/lib/services/scouting-service";
import {
  ACTIVE_SCOUT_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/components/ui/squad/scouting-board";
import { IconAlert, IconCheck, IconTrend, IconUserEntry, IconWallet } from "@/components/ui/icons";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The transfers desk.
 *
 * Scouting asks "is he any good and can we afford him"; this asks "what does acting on it cost, and
 * what is left". It reads the same board rather than a copy of it, so the two tabs can never
 * disagree about a price.
 *
 * What it deliberately does NOT show: a net-spend figure or a fee history. The save carries only the
 * deals it has already seen, and on the reference career 1 of 38 involve our club - so a "spend to
 * date" number would be arithmetic about a sample, presented as a fact about the window.
 */
export function TransferDesk({ careerId, currencySymbol = "£" }: { careerId: string; currencySymbol?: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/scouting?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { success?: boolean; board?: Board; error?: string };
      if (payload.success && payload.board) {
        setBoard(payload.board);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read the transfer picture.");
      }
    } catch {
      setError("Could not reach the transfer service.");
    } finally {
      setLoading(false);
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const shortlist = useMemo(
    () => (board?.assessments ?? []).filter((entry) => ACTIVE_SCOUT_STATUSES.has(entry.target.status)),
    [board]
  );

  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${currencySymbol}${Math.round(value / 100_000) / 10}m`;

  if (loading) {
    return (
      <p className="font-sans text-xs text-slate-600 dark:text-slate-400">Reading your transfer picture…</p>
    );
  }

  const budget = board?.budget.transferBudget ?? null;
  const commitment = board?.shortlistCommitment ?? null;
  const headroom = board?.shortlistHeadroom ?? null;

  return (
    <div className="space-y-5">
      <div data-tour="transfers-heading">
        <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          <IconWallet className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          Transfers
        </h2>
        <p className="mt-1 max-w-xl font-sans text-xs text-slate-600 dark:text-slate-400">
          What acting on your shortlist costs, and what would be left afterwards.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      <section data-tour="transfers-figures" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure
          label="Transfer budget"
          value={budget === null ? "Not set" : money(budget)}
          unknown={budget === null}
          note={budget === null ? "Set it on the Finances screen." : "Your own figure, from Finances."}
        />
        <Figure
          label="Shortlist commitment"
          value={commitment === null ? "Cannot total yet" : money(commitment)}
          unknown={commitment === null}
          note={
            commitment === null
              ? "Only totalled once every shortlisted player has a price, because a partial total reads as the whole bill."
              : `${shortlist.length} shortlisted ${shortlist.length === 1 ? "player" : "players"}.`
          }
        />
        <Figure
          label="Left if all signed"
          value={headroom === null ? "—" : money(headroom)}
          unknown={headroom === null}
          tone={headroom !== null && headroom < 0 ? "bad" : "good"}
          note={
            headroom !== null && headroom < 0
              ? "Short of the whole shortlist, so a sale or a priority cut is needed."
              : undefined
          }
        />
      </section>

      {budget === null && (
        <p className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-sans text-xs text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The transfer budget is not stored in the save file, so TouchlineOS has nothing to read.
            Enter it on the Finances screen and both this tab and the scouting board come alive.
          </span>
        </p>
      )}

      <section data-tour="transfers-shortlist" className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <h3 className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3 font-heading text-sm uppercase tracking-wider text-slate-900 dark:border-slate-800 dark:text-slate-100">
          <span>Who you are acting on</span>
          <span className="font-sub text-[10px] tracking-wider text-slate-400 tabular-nums">
            {shortlist.length} shortlisted
          </span>
        </h3>

        {shortlist.length === 0 ? (
          <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
            Nobody is shortlisted yet. Move a player past &quot;Watching&quot; on the Scouting board and
            he appears here with his cost.
          </p>
        ) : (
          <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
            {shortlist.map((entry) => (
              <li
                key={entry.target.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
                      {entry.target.name}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[entry.target.status]}`}
                    >
                      {STATUS_LABELS[entry.target.status]}
                    </span>
                    <span className="font-sub text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      {PRIORITY_LABELS[entry.target.priority]}
                    </span>
                  </div>
                  <p className="mt-0.5 font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
                    {entry.target.clubName ?? "Club unrecorded"}
                    {entry.target.age !== null ? ` · age ${entry.target.age}` : ""}
                    {entry.target.position ? ` · ${entry.target.position}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-heading text-sm text-slate-800 tabular-nums dark:text-slate-200">
                    {money(entry.effectivePrice)}
                  </span>
                  <span
                    className={`font-sub text-[10px] font-bold uppercase tracking-wider tabular-nums ${
                      entry.headroom !== null && entry.headroom < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {entry.headroom === null ? "Needs a budget" : `${money(entry.headroom)} left`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <h3 className="flex items-center gap-2 border-b border-slate-200 pb-3 font-heading text-sm uppercase tracking-wider text-slate-900 dark:border-slate-800 dark:text-slate-100">
          <IconTrend className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          What this tab does not claim
        </h3>
        <ul className="space-y-2.5">
          <Caveat icon={<IconCheck className="h-3.5 w-3.5" />}>
            Every price here is a figure you recorded, so the arithmetic is checkable against the
            numbers you typed rather than against a model.
          </Caveat>
          <Caveat icon={<IconAlert className="h-3.5 w-3.5" />}>
            There is no net-spend or fee history, because the save only carries the deals it has seen
            and almost none of them involve your club. A window total built from that would describe
            the market, not your business.
          </Caveat>
          <Caveat icon={<IconUserEntry className="h-3.5 w-3.5" />}>
            Nothing here writes to the save. Signing a player happens in the game; you record it here
            afterwards by moving his stage to Signed.
          </Caveat>
        </ul>
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  unknown = false,
  note,
  tone,
}: {
  label: string;
  value: string;
  unknown?: boolean;
  note?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        unknown
          ? "border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/60"
          : "border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
      }`}
    >
      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <p
        className={`mt-1.5 font-heading text-lg tabular-nums ${
          unknown
            ? "text-slate-400 dark:text-slate-500"
            : tone === "bad"
              ? "text-rose-600 dark:text-rose-400"
              : tone === "good"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </p>
      {note && (
        <p className="mt-2 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          {note}
        </p>
      )}
    </div>
  );
}

function Caveat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
