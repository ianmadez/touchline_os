"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ScoutStrategy, ScoutSearchResult, ScoutSearchRow, ScoutDossier } from "@/lib/services/scouting-search-service";
import { formatMoney } from "@/lib/ui/format";
import {
  IconAlert,
  IconCheck,
  IconFlag,
  IconPerson,
  IconPlus,
  IconSearch,
  IconSpark,
  IconTarget,
  IconTrend,
  IconUnknown,
  IconWallet,
} from "@/components/ui/icons";
import { ShortlistPanel } from "@/components/ui/squad/scouting-board";
import { AttributeBars } from "@/components/ui/squad/attribute-bars";

/**
 * Scouting search over the world pool.
 *
 * Two columns: the search on the left, the dossier on the right. The dossier is fetched one player at
 * a time rather than shipped with every result row - 34 face stats across a 20-row page is a lot of
 * payload for numbers that are read one player at a time.
 *
 * Every value rendered here comes from `describeValueBand`, which is the only formatter for a
 * valuation anywhere in the app. That is deliberate: twenty rows in a table is exactly the pressure
 * that would otherwise produce one clean, fake-precise number per row.
 */

const STRATEGY_ORDER: readonly ScoutStrategy[] = ["SUGGESTED", "BALANCED", "IMMEDIATE", "PROSPECT", "VALUE"];

const STRATEGY_ICONS: Record<ScoutStrategy, React.ReactNode> = {
  SUGGESTED: <IconFlag className="h-4 w-4" />,
  BALANCED: <IconTrend className="h-4 w-4" />,
  IMMEDIATE: <IconTarget className="h-4 w-4" />,
  PROSPECT: <IconSpark className="h-4 w-4" />,
  VALUE: <IconWallet className="h-4 w-4" />,
};

const POSITION_OPTIONS = [
  { value: "", label: "Select a position" },
  { value: "GK", label: "Goalkeeper" },
  { value: "DEF", label: "Defenders" },
  { value: "MID", label: "Midfielders" },
  { value: "ATT", label: "Attackers" },
  { value: "CB", label: "CB only" },
  { value: "CM", label: "CM only" },
  { value: "ST", label: "ST only" },
];

const BUDGET_PRESETS = [10_000_000, 25_000_000, 50_000_000, 100_000_000];

const AFFORDABILITY_STYLES: Record<ScoutSearchRow["affordability"], string> = {
  WITHIN: "text-emerald-600 dark:text-emerald-400",
  STRETCH: "text-amber-600 dark:text-amber-400",
  OVER: "text-rose-600 dark:text-rose-400",
  UNKNOWN: "text-slate-400",
};

const AFFORDABILITY_LABELS: Record<ScoutSearchRow["affordability"], string> = {
  WITHIN: "Fits",
  STRETCH: "Stretch",
  OVER: "Over",
  UNKNOWN: "No budget",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/**
 * The fit advisory, in the app's calm palette rather than a traffic light: emerald when it works,
 * neutral when it is mixed, amber when something blocks it. No red - the manager is reading an
 * opinion, not an error.
 */
const ADVISORY_STYLES: Record<"GOOD" | "MIXED" | "POOR", string> = {
  GOOD: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
  MIXED: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200",
  POOR: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
};

/** Same calm sequence as the attribute bars: dim, developing, strong. */
function fitTone(score: number | null): string {
  if (score === null) return "bg-slate-200 dark:bg-slate-800";
  if (score < 35) return "bg-slate-400 dark:bg-slate-600";
  if (score < 65) return "bg-sky-400 dark:bg-sky-500";
  if (score < 85) return "bg-emerald-500";
  return "bg-emerald-600 dark:bg-emerald-400";
}

export function ScoutSearch({ careerId, query }: { careerId: string; query: string }) {
  const [strategy, setStrategy] = useState<ScoutStrategy>("BALANCED");
  const [budgetInput, setBudgetInput] = useState("");
  const [position, setPosition] = useState("");
  const [includeUnnamed, setIncludeUnnamed] = useState(false);
  const [minRating, setMinRating] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(0);

  const [result, setResult] = useState<ScoutSearchResult | null>(null);
  const [budgetSource, setBudgetSource] = useState<{
    combined: number | null;
    transferBudget: number | null;
    wageBudget: number | null;
    overridden: boolean;
  } | null>(null);
  const [dossier, setDossier] = useState<ScoutDossier | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pinningId, setPinningId] = useState<number | null>(null);
  /** Bumped on every pin so the shortlist below re-reads itself. */
  const [shortlistKey, setShortlistKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingFoot, setSavingFoot] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ careerId, strategy, page: String(page), pageSize: "20" });
      if (budgetInput.trim() !== "") params.set("budget", budgetInput.trim());
      if (position) params.set("position", position);
      if (query.trim()) params.set("query", query.trim());
      if (includeUnnamed) params.set("includeUnnamed", "true");
      if (minRating.trim()) params.set("minRating", minRating.trim());
      if (maxAge.trim()) params.set("maxAge", maxAge.trim());

      const response = await fetch(`/api/scouting/search?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        success?: boolean;
        result?: ScoutSearchResult;
        budgetSource?: typeof budgetSource;
        error?: string;
      };
      if (payload.success && payload.result) {
        setResult(payload.result);
        setBudgetSource(payload.budgetSource ?? null);
        setError(null);
      } else {
        setError(payload.error ?? "Could not run that search.");
      }
    } catch {
      setError("Could not reach the scouting service.");
    } finally {
      setLoading(false);
    }
  }, [careerId, strategy, page, budgetInput, position, query, includeUnnamed, minRating, maxAge]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Back to page one whenever the question changes: staying on page 4 of a different search shows an
  // arbitrary slice, which reads as a bug.
  // Deferred by a tick: setState must not run synchronously inside an effect body. Changing any of
  // these filters makes the old page number meaningless, so the list returns to the first page.
  useEffect(() => {
    const timer = window.setTimeout(() => setPage(0), 0);
    return () => window.clearTimeout(timer);
  }, [strategy, budgetInput, position, query, includeUnnamed, minRating, maxAge]);

  const openDossier = useCallback(
    async (eaPlayerId: number) => {
      setSelectedId(eaPlayerId);
      try {
        const response = await fetch(
          `/api/scouting/search?careerId=${encodeURIComponent(careerId)}&playerId=${eaPlayerId}`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as { success?: boolean; dossier?: ScoutDossier };
        if (payload.success && payload.dossier) setDossier(payload.dossier);
      } catch {
        /* the panel keeps whatever it was showing */
      }
    },
    [careerId]
  );

  /**
   * Pins a search result onto the shortlist.
   *
   * Everything the save knows comes across with it - rating, potential, club, age, position - so the
   * manager only adds the judgement calls. A row with no NAME in the save is pinned under its id,
   * because the shortlist needs a unique label and inventing a name for him would be worse.
   */
  const pinToShortlist = useCallback(
    async (row: ScoutSearchRow) => {
      setPinningId(row.eaPlayerId);
      try {
        await fetch("/api/scouting", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            careerId,
            name: row.nameResolved ? row.name : `#${row.eaPlayerId}`,
            eaPlayerId: row.eaPlayerId,
            clubName: row.clubName,
            position: row.primaryPosition,
            age: row.age,
            overallRating: row.overallRating,
            potentialRating: row.potentialRating,
            status: "SHORTLISTED",
          }),
        });
        setShortlistKey((current) => current + 1);
      } finally {
        setPinningId(null);
      }
    },
    [careerId]
  );

  const setFoot = useCallback(
    async (foot: number | null) => {
      if (selectedId === null) return;
      setSavingFoot(true);
      try {
        const response = await fetch("/api/scouting/search", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ careerId, eaPlayerId: selectedId, preferredFoot: foot }),
        });
        const payload = (await response.json()) as { success?: boolean; dossier?: ScoutDossier };
        if (payload.success && payload.dossier) setDossier(payload.dossier);
      } finally {
        setSavingFoot(false);
      }
    },
    [careerId, selectedId]
  );

  const rows = result?.rows ?? [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  const headerLine = useMemo(() => {
    if (!result) return "";
    const parts = [
      position ? POSITION_OPTIONS.find((o) => o.value === position)?.label ?? position : "All positions",
      result.weights.label,
      result.budget !== null ? `Budget ${formatMoney(result.budget)}` : "No budget set",
    ];
    // A capped total is a cap, not a count, and saying "of 4,000" as though it were the real number of
    // matches would be a quiet lie about how much of the save was ranked.
    const totalText = result.capped
      ? `the first ${result.total.toLocaleString()}+ matching players`
      : `${result.total.toLocaleString()} players`;
    return `${parts.join(" · ")} · Top ${Math.min(rows.length, result.pageSize)} of ${totalText}`;
  }, [result, position, rows.length]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-5">
        {/* ---- Recommendation strategy -------------------------------------------------- */}
        <section>
          <h3 className="mb-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Recommendation strategy
          </h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {STRATEGY_ORDER.map((id) => {
              const weights = result?.weights;
              const isActive = strategy === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStrategy(id)}
                  aria-pressed={isActive}
                  title={id === strategy ? weights?.optimisesFor : undefined}
                  className={`cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                    isActive
                      ? "border-[#E11D48] bg-rose-50 dark:border-[#FF8C7A] dark:bg-rose-500/10"
                      : "border-slate-200 bg-white/90 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-slate-700"
                  }`}
                >
                  <span
                    className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-lg ${
                      isActive
                        ? "bg-[#E11D48] text-white dark:bg-[#FF8C7A] dark:text-slate-950"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {STRATEGY_ICONS[id]}
                  </span>
                  <span className="block font-heading text-[11px] uppercase tracking-wide text-slate-900 dark:text-slate-100">
                    {STRATEGY_LABELS[id]}
                  </span>
                  <span className="mt-0.5 block font-sans text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                    {STRATEGY_SUMMARIES[id]}
                  </span>
                </button>
              );
            })}
          </div>
          {result && (
            <p className="mt-2 font-sans text-[11px] text-slate-500 dark:text-slate-400">
              {result.weights.optimisesFor}
            </p>
          )}
        </section>

        {/* ---- Budget and filters ------------------------------------------------------- */}
        <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Budget
          </h3>
          <input
            type="number"
            min={0}
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            placeholder={
              budgetSource?.combined
                ? `e.g. 50000000 — blank uses your combined ${formatMoney(budgetSource.combined)}`
                : "e.g. 50000000"
            }
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {BUDGET_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBudgetInput(String(preset))}
                className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
              >
                {formatMoney(preset)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setBudgetInput("")}
              className="cursor-pointer rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-700 transition-colors dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              {budgetSource?.combined
                ? `Your max (${formatMoney(budgetSource.combined)})`
                : "Use my budgets"}
            </button>
          </div>
          {budgetSource && (
            <p className="font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              {budgetSource.combined === null
                ? "No transfer or wage budget is set, so affordability is not constraining this search. Set them on the Finances screen."
                : `Blank uses your transfer budget${budgetSource.transferBudget !== null ? ` (${formatMoney(budgetSource.transferBudget)})` : ""} plus your wage budget${budgetSource.wageBudget !== null ? ` (${formatMoney(budgetSource.wageBudget)})` : ""}, because a signing costs both.`}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Position
              </span>
              <select
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="mt-4 cursor-pointer self-end rounded-lg border border-slate-300 px-3 py-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
            >
              {showAdvanced ? "Hide advanced" : "Show advanced filters"}
            </button>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
              <label className="block">
                <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Minimum rating
                </span>
                <input
                  type="number"
                  value={minRating}
                  onChange={(event) => setMinRating(event.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Maximum age
                </span>
                <input
                  type="number"
                  value={maxAge}
                  onChange={(event) => setMaxAge(event.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            </div>
          )}

          {/* Off by default: a table of rows reading "name not in this save" looks broken, and a
              name search cannot find them anyway. Opt in only when digging for them deliberately. */}
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
            <input
              type="checkbox"
              checked={includeUnnamed}
              onChange={(event) => setIncludeUnnamed(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[#E11D48]"
            />
            <span className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              Show unnamed players
              <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">
                Some players in the save have no name stored. They are real players with full ratings
                and attributes, but a name search can never find them.
              </span>
            </span>
          </label>
        </section>

        {/* ---- Results ------------------------------------------------------------------ */}
        <section className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
              <IconSearch className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
              Recommended players
            </h2>
            <p className="mt-1 font-sans text-[11px] text-slate-500 dark:text-slate-400">{headerLine}</p>
          </div>

          {error && (
            <p className="m-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}

          {loading && rows.length === 0 ? (
            <p className="p-5 font-sans text-xs text-slate-600 dark:text-slate-400">Searching the save…</p>
          ) : rows.length === 0 ? (
            <p className="p-5 font-sans text-xs text-slate-600 dark:text-slate-400">
              No player matches those filters.
            </p>
          ) : (
            <>
              <div className="max-h-[560px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-white/95 backdrop-blur dark:bg-slate-900/95">
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      {["Rank", "Player", "OVR", "POT", "Age", "Value", "Fits", ""].map((heading, index) => (
                        <th
                          key={`${heading}-${index}`}
                          className="px-4 py-2 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-400"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.eaPlayerId}
                        onClick={() => void openDossier(row.eaPlayerId)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-950/50 ${
                          selectedId === row.eaPlayerId ? "bg-rose-50/60 dark:bg-rose-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-heading text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.rank}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.nameResolved ? (
                            <>
                              <span className="block font-bold text-xs text-slate-900 dark:text-slate-100">
                                {row.name}
                              </span>
                              <span className="mt-0.5 block font-sub text-[10px] uppercase tracking-wider text-slate-400">
                                {row.clubName ?? "Club unrecorded"}
                              </span>
                            </>
                          ) : (
                            /* Deliberately loud. A bare label in the name position reads as a bug;
                               this has to read as a known state of the save. */
                            <>
                              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                                <IconAlert className="h-3.5 w-3.5" />
                                Name not in this save
                              </span>
                              <span className="mt-1 block font-sub text-[10px] uppercase tracking-wider text-slate-400">
                                {row.clubName ?? "Club unrecorded"} · id {row.eaPlayerId}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-heading text-xs text-[#E11D48] tabular-nums dark:text-[#FF8C7A]">
                          {row.overallRating ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 font-sub text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.potentialRating ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 font-sub text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.age ?? "—"}
                        </td>
                        <td className="px-4 py-2.5" title={row.value.title}>
                          <span className="block font-heading text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
                            {row.value.text}
                          </span>
                          <span
                            className={`mt-0.5 inline-block rounded px-1 py-0.5 font-sub text-[8px] font-bold uppercase tracking-wider ${
                              CONFIDENCE_STYLES[row.value.confidence]
                            }`}
                          >
                            {row.value.confidence} · estimated
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 font-sub text-[10px] font-bold uppercase tracking-wider ${AFFORDABILITY_STYLES[row.affordability]}`}>
                          {AFFORDABILITY_LABELS[row.affordability]}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* stopPropagation: the row itself opens the dossier. */}
                          <button
                            type="button"
                            disabled={pinningId === row.eaPlayerId}
                            onClick={(event) => {
                              event.stopPropagation();
                              void pinToShortlist(row);
                            }}
                            title="Add to your shortlist, with his rating and club filled in"
                            aria-label={`Pin ${row.nameResolved ? row.name : `player ${row.eaPlayerId}`} to your shortlist`}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-[#FF8C7A] dark:hover:text-[#FF8C7A]"
                          >
                            <IconPlus className="h-3.5 w-3.5" />
                            {pinningId === row.eaPlayerId ? "Pinning" : "Pin"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={page === 0}
                    className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                  >
                    Previous
                  </button>
                  <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                    disabled={page >= totalPages - 1}
                    className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {result && result.notes.length > 0 && (
            <ul className="space-y-1.5 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              {result.notes.map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-2 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400"
                >
                  <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ShortlistPanel careerId={careerId} refreshKey={shortlistKey} />
      </div>

      {/* ---- Dossier ------------------------------------------------------------------ */}
      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <DossierPanel dossier={dossier} savingFoot={savingFoot} onSetFoot={(foot) => void setFoot(foot)} />
      </aside>
    </div>
  );
}

const STRATEGY_LABELS: Record<ScoutStrategy, string> = {
  SUGGESTED: "Suggested",
  BALANCED: "Balanced",
  IMMEDIATE: "Immediate",
  PROSPECT: "Prospect",
  VALUE: "Value",
};

const STRATEGY_SUMMARIES: Record<ScoutStrategy, string> = {
  SUGGESTED: "Fills your gaps",
  BALANCED: "Well-rounded picks",
  IMMEDIATE: "Ready to play now",
  PROSPECT: "Future growth",
  VALUE: "Cost-efficient",
};

const FOOT_LABELS: Record<number, string> = { 1: "Right", 2: "Left" };

function DossierPanel({
  dossier,
  savingFoot,
  onSetFoot,
}: {
  dossier: ScoutDossier | null;
  savingFoot: boolean;
  onSetFoot: (foot: number | null) => void;
}) {
  // Two faces on one card: the summary, and the full attribute set. Swiping is the gesture, but the
  // segmented control is the real affordance - motion must never be the only way to reach a state.
  const [face, setFace] = useState<"overview" | "attributes" | "fit">("overview");

  if (!dossier) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center dark:border-slate-700 dark:bg-slate-950/60">
        <IconPerson className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-3 font-heading text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          No player selected
        </p>
        <p className="mx-auto mt-2 max-w-xs font-sans text-dense leading-relaxed text-slate-500 dark:text-slate-400">
          Pick a row to see his full dossier: every face stat, weak foot, skill moves and the band his
          value sits in.
        </p>
      </div>
    );
  }

  const effectiveFoot = dossier.preferredFootOverride ?? dossier.preferredFoot;

  // Pointer-based swipe for the mouse and for touch alike. The origin is parked on the element's own
  // dataset rather than in a ref, so a drag never re-renders the panel.
  const swipe = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.dataset.dragFrom = String(event.clientX);
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      const from = Number(event.currentTarget.dataset.dragFrom);
      if (Number.isNaN(from)) return;
      const travel = event.clientX - from;
      // 40px is far enough that a sloppy tap, a text selection or a stray click never counts.
      if (Math.abs(travel) < 40) return;
      setFace(travel < 0 ? "attributes" : "overview");
    },
  };

  // touch-pan-y keeps vertical scrolling inside the attribute list working; without it the browser
  // claims every drag for the page and the list feels stuck.
  return (
    <div
      {...swipe}
      className="touch-pan-y overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >

      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-950/50">
        {(
          [
            ["overview", "Overview"],
            ["fit", "Fit"],
            ["attributes", "Attributes"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFace(id)}
            aria-pressed={face === id}
            className={`min-h-9 flex-1 cursor-pointer rounded-lg px-3 font-sub text-label font-bold uppercase tracking-wider transition-colors ${
              face === id
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {face === "overview" && (
        <div className="p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[#E11D48]/30 dark:border-[#FF8C7A]/30">
            <span className="font-heading text-lg text-slate-900 tabular-nums dark:text-slate-100">
              {dossier.overallRating ?? "—"}
            </span>
            <span className="font-sub text-[8px] font-bold uppercase tracking-wider text-slate-400">OVR</span>
          </span>
          <div className="min-w-0">
            <h3 className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
              {dossier.nameResolved ? dossier.name : "Name not in this save"}
            </h3>
            <p className="mt-0.5 font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 tabular-nums">
              {dossier.primaryPosition}
              {dossier.age !== null ? ` · ${dossier.age} yrs` : ""}
              {dossier.potentialRating !== null ? ` · POT ${dossier.potentialRating}` : ""}
            </p>
            <p className="mt-0.5 font-sub text-[10px] text-slate-400">
              {dossier.clubName ?? "Club unrecorded"}
            </p>
            {!dossier.nameResolved && (
              <p className="mt-1.5 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                The save stores no name for him, so a name search will not find him. Every other figure
                below is read straight from the file.
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Stars label="Weak foot" value={dossier.weakFoot} />
          <Stars label="Skill moves" value={dossier.skillMoves} />
          {dossier.heightCm !== null && (
            <span className="font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 tabular-nums">
              {dossier.heightCm} cm
            </span>
          )}
        </div>

        {dossier.value && (
          <p className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800" title={dossier.value.title}>
            <span className="font-heading text-sm text-emerald-600 tabular-nums dark:text-emerald-400">
              {dossier.value.text}
            </span>
            <span
              className={`ml-2 rounded px-1 py-0.5 font-sub text-[8px] font-bold uppercase tracking-wider ${
                CONFIDENCE_STYLES[dossier.value.confidence]
              }`}
            >
              {dossier.value.confidence} · estimated
            </span>
            <span className="mt-1 block font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              {dossier.value.basis}
            </span>
          </p>
        )}

        {/* ---- The manager's own foot, kept apart from the save's -------------------- */}
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Foot
          </span>
          <div className="mt-1.5 flex items-center gap-1.5">
            {[1, 2].map((foot) => (
              <button
                key={foot}
                type="button"
                disabled={savingFoot}
                onClick={() => onSetFoot(dossier.preferredFootOverride === foot ? null : foot)}
                className={`cursor-pointer rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
                  dossier.preferredFootOverride === foot
                    ? "border-[#E11D48] bg-rose-50 text-[#E11D48] dark:border-[#FF8C7A] dark:bg-rose-500/10 dark:text-[#FF8C7A]"
                    : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                {FOOT_LABELS[foot]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            {dossier.preferredFootOverride !== null
              ? `You set this. The save says ${dossier.preferredFoot !== null ? FOOT_LABELS[dossier.preferredFoot] ?? "unknown" : "nothing"}.`
              : `Taken from the save${effectiveFoot !== null ? ` (${FOOT_LABELS[effectiveFoot] ?? "unknown"})` : ""}. Set your own if it is wrong.`}
          </p>
        </div>
        </div>
      )}

      {/* ---- Fit: why him, for THIS squad and system ---------------------------------- */}
      {face === "fit" && (
        <div className="max-h-[560px] space-y-5 overflow-y-auto overscroll-contain p-5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
          <div className={`rounded-xl border p-4 ${ADVISORY_STYLES[dossier.fits.advisory.tone]}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-heading text-sm uppercase tracking-wide">
                {dossier.fits.advisory.headline}
              </span>
              {dossier.fits.overall !== null && (
                <span className="font-heading text-lg tabular-nums">{dossier.fits.overall}</span>
              )}
            </div>
            <p className="mt-1 font-sans text-dense leading-relaxed">
              {dossier.fits.advisory.detail}
            </p>
          </div>

          <ul className="space-y-4">
            {dossier.fits.dimensions.map((dimension) => (
              <li key={dimension.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                  <span className="flex items-center gap-2">
                    <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      {dimension.label}
                    </span>
                    {dimension.disqualifying && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        Rules it out
                      </span>
                    )}
                  </span>
                  <span className="font-sub text-label font-bold tabular-nums text-slate-700 dark:text-slate-200">
                    {dimension.score === null ? "\u2014" : `${dimension.score}%`}
                  </span>
                </div>
                <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <span
                    className={`block h-full rounded-full ${fitTone(dimension.score)}`}
                    style={{ width: `${dimension.score ?? 0}%` }}
                  />
                </span>
                <p className="mt-1.5 font-sans text-dense leading-relaxed text-slate-500 dark:text-slate-400">
                  {dimension.explanation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Every face stat, in the game's own groups ------------------------------ */}
      {face === "attributes" && (
        <div className="max-h-[560px] space-y-5 overflow-y-auto overscroll-contain p-5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
        <AttributeBars attributes={dossier.attributes} position={dossier.primaryPosition} />
        </div>
      )}

      <p className="flex items-start gap-2 border-t border-slate-200 px-5 py-3.5 font-sans text-dense leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          Ratings, face stats, weak foot and skill moves are read from the save file and shown exactly
          as stored. Only the value band is estimated, and it always says so.
        </span>
      </p>
    </div>
  );
}

function Stars({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-sub text-label uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      <span className="flex items-center gap-0.5" aria-label={value === null ? `${label} unknown` : `${label} ${value} of 5`}>
        {[1, 2, 3, 4, 5].map((step) => (
          <svg key={step} viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8z"
              fill={value !== null && step <= value ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.6}
              className={value !== null && step <= value ? "text-amber-500" : "text-slate-300 dark:text-slate-700"}
            />
          </svg>
        ))}
      </span>
      {value === null && <IconUnknown className="h-3.5 w-3.5 text-slate-400" />}
    </span>
  );
}
