"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import { NationFlag } from "./nation-flag";
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
  /**
   * The name the manager typed, which outranks the save's own when the save has none.
   *
   * Set from the player dossier's Notebook, reached from the squad table's YOUTH filter. Null when he has not
   * named the player yet.
   */
  displayName?: string | null;
  name: string | null;
  nameSource: string;
  primaryPosition: string | null;
  age: number | null;
  /** The save's own nationality code, plus the country name our reference table gives it. */
  nationalityId: number | null;
  nationality: string | null;
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
  const [namingId, setNamingId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/youth?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        success?: boolean;
        prospects?: Prospect[];
        summary?: Summary;
        error?: string;
      };
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not read the academy (${response.status}).`);
        return;
      }
      setRows(body.prospects ?? []);
      setSummary(body.summary ?? null);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * Names a prospect the save cannot.
   *
   * The academy is the ONE list where such a player stays visible, which makes this the one place the
   * manager can do something about it: everywhere else he is absent rather than shown as a placeholder.
   * Written through the same profile route the dossier uses, so the name is stored the same way and
   * survives the sync that rewrites every academy row.
   */
  const saveName = async (playerId: number) => {
    const displayName = nameDraft.trim().slice(0, 60);
    if (displayName.length === 0) return;
    setSavingName(true);
    try {
      const response = await apiFetch("/api/career", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, playerProfile: { eaPlayerId: playerId, displayName } }),
      });
      const body = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not save that name (${response.status}).`);
        return;
      }
      setNamingId(null);
      setNameDraft("");
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSavingName(false);
    }
  };

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
                  {row.displayName || row.name || "Name not stored in the save"}
                </span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {row.primaryPosition || "—"}
                </span>
                {(row.nationality !== null || row.nationalityId !== null) && (
                  <span
                    className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-800 dark:bg-slate-900"
                    title={
                      row.nationality
                        ? `Nationality recorded by your save: ${row.nationality}`
                        : `Your save records nationality code ${row.nationalityId}, which this build's country list does not name.`
                    }
                  >
                    <NationFlag nationId={row.nationalityId} name={row.nationality} height={11} />
                    {/* No name to print for a code this build cannot name; the flag and the tooltip
                        carry what is actually known rather than a placeholder country. */}
                    {row.nationality && (
                      <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {row.nationality}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
                {row.age !== null ? `Age ${row.age}` : "Age unknown"}
              </span>
            </div>

            {/* The one place an unnamed player is still shown, and therefore the one place he can be
                named. Every other list leaves him out, so "go here to add his name" has to be true. */}
            {!row.displayName && !row.name && (
              <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                {namingId === row.playerId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`youth-name-${row.playerId}`}>
                      Name for this prospect
                    </label>
                    <input
                      id={`youth-name-${row.playerId}`}
                      type="text"
                      autoFocus
                      maxLength={60}
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder="Type his name"
                      className="min-w-40 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={savingName || nameDraft.trim().length === 0}
                      onClick={() => void saveName(row.playerId)}
                      className="cursor-pointer rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingName ? "Saving" : "Save name"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNamingId(null);
                        setNameDraft("");
                      }}
                      className="cursor-pointer rounded-lg px-2 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-sans text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                      Your save does not name him. Give him one here, and it is kept for this career.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setNamingId(row.playerId);
                        setNameDraft("");
                      }}
                      className="cursor-pointer rounded-lg border border-amber-500/60 bg-white px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-slate-950/40 dark:text-amber-300"
                    >
                      Give him a name
                    </button>
                  </div>
                )}
              </div>
            )}

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
