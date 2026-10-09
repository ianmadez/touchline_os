"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The academy: the save's own unpromoted prospects.
 *
 * This replaces a panel that showed the first-team squad filtered to 21 and under. That was a proxy,
 * not an academy - it could never show a 15-year-old, because a 15-year-old is not in the squad, and it
 * showed senior players who merely happened to be young. The rows here come from `career_youthplayers`,
 * the save's own academy table.
 *
 * Two things shape how it reads.
 *
 * The first is that some prospects are assessed more than once and the assessments DISAGREE, with
 * nothing in the save to say which is current. Those fields are shown as the observed range and carry
 * the dashed "not settled" treatment the transfer-value bands already use. A prospect with a single
 * reading gets a plain value and no range styling, because inventing uncertainty where the save gave
 * one reading is its own kind of lie.
 *
 * The second is `swingLowPotential`, which is a DELTA and can be negative. A negative swing low is the
 * game saying the player may never reach his headline potential, so it is shown next to the potential
 * rather than buried - a prospect whose range straddles zero is a genuine gamble, and the panel should
 * say so instead of printing 95 and letting the manager assume.
 */

interface Prospect {
  playerId: number;
  name: string | null;
  nameSource: string;
  primaryPosition: string | null;
  age: number | null;
  overallRating: number | null;
  potentialRating: number | null;
  tierLow: number | null;
  tierHigh: number | null;
  swingLowMin: number | null;
  swingLowMax: number | null;
  varianceMin: number | null;
  varianceMax: number | null;
  monthsInSquad: number | null;
  assessmentCount: number;
  goals: number | null;
  appearances: number | null;
}

interface Summary {
  total: number;
  multiAssessed: number;
  unnamed: number;
  bestPotential: number | null;
}

/** A positive potential swing is an upside, so it is signed. A bare "10" reads as a rating. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * An observed value, or the range across disagreeing readings.
 *
 * A single reading renders as a plain value with no styling, because there is no uncertainty to
 * signal. Two or more that agree are also a single value - a range of "2 to 2" is noise.
 */
function Observed({
  low,
  high,
  format,
}: {
  low: number | null;
  high: number | null;
  format?: (value: number) => string;
}) {
  const render = format ?? String;
  if (low === null && high === null) {
    return <span className="font-sub text-xs text-slate-400">not recorded</span>;
  }
  if (low === null || high === null || low === high) {
    return (
      <span className="font-sub text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
        {render((low ?? high) as number)}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-dashed border-slate-400/60 bg-slate-500/5 px-1.5 py-0.5 font-sub text-xs font-bold tabular-nums text-slate-600 dark:border-slate-600 dark:text-slate-300">
      {render(low)} to {render(high)}
    </span>
  );
}

export function YouthAcademyPanel({ careerId, query }: { careerId: string; query: string }) {
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/youth?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          success?: boolean;
          prospects?: Prospect[];
          summary?: Summary;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.success) {
          setError(body.error ?? `Could not read the academy (${response.status}).`);
          return;
        }
        setRows(body.prospects ?? []);
        setSummary(body.summary ?? null);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [careerId]);

  if (error) {
    return (
      <p className="font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>
    );
  }

  if (rows === null) {
    return (
      <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Loading your academy…</p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          No academy rows in this save
        </h3>
        <p className="mt-1 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Either this club has no unpromoted prospects on file, or your save does not carry the
          academy table. Nothing is being hidden from you — this is an empty set, not a failed read.
        </p>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) => (row.name ?? "").toLowerCase().includes(needle))
    : rows;

  return (
    <div className="space-y-4">
      <div data-tour="youth-summary" className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          Academy
        </h2>
        {summary && (
          <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
            {summary.total} prospect{summary.total === 1 ? "" : "s"}
            {summary.bestPotential !== null ? ` · best potential ${summary.bestPotential}` : ""}
            {summary.unnamed > 0 ? ` · ${summary.unnamed} unnamed in the save` : ""}
          </span>
        )}
      </div>

      <ul data-tour="youth-list" className="space-y-2">
        {visible.map((row) => (
          <li
            key={row.playerId}
            className="rounded-xl border border-slate-200 bg-white/90 p-4 shadow-xs dark:border-slate-800/80 dark:bg-slate-900/90"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-sm text-slate-900 dark:text-slate-100">
                  {row.name ?? "Name not stored in the save"}
                </span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {row.primaryPosition || "—"}
                </span>
              </div>
              <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
                {row.age !== null ? `Age ${row.age}` : "Age unknown"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="flex items-center gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Ability
                </span>
                <span className="font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                  {row.overallRating ?? "—"}
                </span>
                <span className="text-slate-400">→</span>
                <span className="font-heading text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                  {row.potentialRating ?? "—"}
                </span>
              </span>

              <span className="flex items-center gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tier
                </span>
                <Observed low={row.tierLow} high={row.tierHigh} />
              </span>

              <span className="flex items-center gap-2">
                <span
                  className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  title="How far below his headline potential he may fall. A negative swing means the game is warning he might never reach it."
                >
                  Swing
                </span>
                <Observed low={row.swingLowMin} high={row.swingLowMax} format={signed} />
              </span>

              <span className="font-sub text-label text-slate-500 dark:text-slate-400">
                {row.monthsInSquad !== null
                  ? `${row.monthsInSquad} month${row.monthsInSquad === 1 ? "" : "s"} in the academy`
                  : "Tenure not recorded"}
              </span>
            </div>

            {row.assessmentCount > 1 && (
              <p className="mt-2 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Your save scouted him {row.assessmentCount} times and the reports disagree, so tier and
                swing above are shown as the range rather than one report picked out as correct.
              </p>
            )}
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
          No prospect in your academy matches that name.
        </p>
      )}
    </div>
  );
}
