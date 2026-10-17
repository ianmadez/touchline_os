"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import { Hint } from "@/components/ui/hint";
import type {
  DivisionRow,
  DivisionSummary,
  DivisionTable,
} from "@/lib/services/competition-table-service";

/**
 * The background divisions, inside the Matchday & Trends sub-tab.
 *
 * The manager's OWN division is not the subject here: the save zeroes its record columns, which is why
 * his own standing has to be inferred from his debriefs rather than read. Every OTHER division in the
 * same file is written out properly, and this is where that data finally gets looked at.
 *
 * WHAT IT REFUSES TO DO. Most divisions in a real save carry their order and nothing else - on the
 * reference career the result columns are zero for every club in 39 of 40 divisions. Printing a row of
 * zeroes beside twenty clubs would look like a table and be a lie, so when a division has no record the
 * club column is shown on its own with the reason, and the columns of figures are not drawn at all.
 *
 * EVERY FIGURE IS STAMPED "AS AT THE SAVE". These are the save's numbers at the moment it was written,
 * not a live table: nothing here updates until the manager next syncs, and saying so is the difference
 * between a background table and a wrong one.
 */
export function DivisionTablesPanel({ careerId }: { careerId: string }) {
  const [divisions, setDivisions] = useState<DivisionSummary[]>([]);
  const [asAtSave, setAsAtSave] = useState<string | null>(null);
  const [table, setTable] = useState<DivisionTable | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (leagueId: number | null) => {
      setLoading(true);
      try {
        const query = leagueId === null ? "" : `&leagueId=${leagueId}`;
        const response = await apiFetch(
          `/api/season/divisions?careerId=${encodeURIComponent(careerId)}${query}`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
          asAtSave?: string | null;
          divisions?: DivisionSummary[];
          table?: DivisionTable;
        };
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? `Could not read the divisions (HTTP ${response.status}).`);
        }
        setDivisions(payload.divisions ?? []);
        setAsAtSave(payload.asAtSave ?? null);
        setTable(payload.table ?? null);
        setError(null);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [careerId]
  );

  // Deferred by a tick: the rule forbids setState synchronously in an effect body, and nothing here
  // needs the first paint to wait for the read.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * The divisions the panel offers.
   *
   * The manager's own is dropped rather than shown blank. Everything about it is already on this
   * screen from his own debriefs, and a table of zeroes beside it would invite exactly the comparison
   * the save's blank columns cannot support.
   */
  const offered = useMemo(() => divisions.filter((division) => !division.isOwnLeague), [divisions]);

  // The first division that actually has something to show, so the panel opens on data rather than on
  // whichever competition happens to sort first.
  const defaultDivision = useMemo(
    () => offered.find((division) => division.hasRecord) ?? offered[0] ?? null,
    [offered]
  );

  useEffect(() => {
    if (selected !== null || defaultDivision === null) return;
    const leagueId = defaultDivision.leagueId;
    const timer = window.setTimeout(() => {
      setSelected(leagueId);
      void load(leagueId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultDivision, load, selected]);

  const pickDivision = (leagueId: number) => {
    setSelected(leagueId);
    void load(leagueId);
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Around the divisions
          </h2>
          <p className="mt-1 max-w-2xl font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Your save writes out every other division in full. Your own is the one it leaves blank, so
            it is not offered here - your standing comes from your own debriefs instead.
          </p>
        </div>
        {asAtSave && (
          <span
            className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400"
            title="These are the save's own figures at the moment it was written. Nothing here changes until you sync again."
          >
            As at the save: {asAtSave}
            <Hint label="the save figures">
              These are the save&apos;s own figures at the moment it was written. Nothing here
              changes until you sync again.
            </Hint>
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {offered.length === 0 && !loading && !error && (
        <p className="mt-4 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          This save carries no records for any other division yet. Sync a career from the Portal and
          they appear here.
        </p>
      )}

      {offered.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Competition
              <select
                value={selected ?? ""}
                onChange={(event) => pickDivision(Number(event.target.value))}
                className="ml-2 cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-sub text-xs normal-case tracking-normal text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {offered.map((division) => (
                  <option key={division.leagueId} value={division.leagueId}>
                    {division.name ?? `Division ${division.leagueId}`} ({division.clubs})
                  </option>
                ))}
              </select>
            </label>
            {table && (
              <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {table.division.orderBasis === "SAVE"
                  ? "Order as the save places them"
                  : table.division.hasRecord
                    ? "Order derived from the record"
                    : "Order derived - this save leaves the record blank"}
              </span>
            )}
          </div>

          {table && (
            <div className="mt-4 overflow-x-auto">
              <table className="hidden w-full text-left text-xs font-sub md:table">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-400 dark:border-slate-800">
                    <th className="px-3 py-2.5">{table.division.orderBasis === "SAVE" ? "Pos" : "#"}</th>
                    <th className="px-3 py-2.5">Club</th>
                    {table.division.hasRecord && (
                      <>
                        <th className="px-3 py-2.5 text-center">P</th>
                        <th className="px-3 py-2.5 text-center">W</th>
                        <th className="px-3 py-2.5 text-center">D</th>
                        <th className="px-3 py-2.5 text-center">L</th>
                        <th className="px-3 py-2.5 text-center">GF</th>
                        <th className="px-3 py-2.5 text-center">GA</th>
                        <th className="px-3 py-2.5 text-center">GD</th>
                        <th className="px-3 py-2.5 text-center">PTS</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800 dark:divide-slate-800/60 dark:text-slate-200">
                  {table.rows.map((row: DivisionRow, index: number) => (
                    <tr key={row.teamId} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                        {table.division.orderBasis === "SAVE"
                          ? (row.position ?? "-")
                          : index + 1}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{row.name}</td>
                      {table.division.hasRecord && (
                        <>
                          <td className="px-3 py-2.5 text-center tabular-nums">{row.played ?? "-"}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{row.won ?? "-"}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{row.drawn ?? "-"}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{row.lost ?? "-"}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">{row.goalsFor ?? "-"}</td>
                          <td className="px-3 py-2.5 text-center tabular-nums">
                            {row.goalsAgainst ?? "-"}
                          </td>
                          <td className="px-3 py-2.5 text-center tabular-nums">
                            {row.goalDifference ?? "-"}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold tabular-nums">
                            {row.points ?? "-"}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* The phone reads the same division as a ranked list: club, record, points. */}
              <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/60">
                {table.rows.map((row: DivisionRow, index: number) => (
                  <li key={row.teamId} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-6 shrink-0 text-center font-sub text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {table.division.orderBasis === "SAVE" ? (row.position ?? "-") : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                        {row.name}
                      </span>
                      {table.division.hasRecord && (
                        <span className="mt-0.5 block font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          P {row.played ?? "-"} · W {row.won ?? "-"} D {row.drawn ?? "-"} L{" "}
                          {row.lost ?? "-"} · GD {row.goalDifference ?? "-"}
                        </span>
                      )}
                    </span>
                    {table.division.hasRecord && (
                      <span className="shrink-0 text-right">
                        <span className="block font-heading text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {row.points ?? "-"}
                        </span>
                        <span className="block font-sub text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          PTS
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {!table.division.hasRecord && (
                <p className="mt-3 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Your save records no results for this competition, so only the order it places the clubs
                  in is shown. Printing a column of zeroes would look like a table and would not be one.
                </p>
              )}
              {table.division.orderBasis === "DERIVED" && table.division.hasRecord && (
                <p className="mt-3 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  The save&apos;s own placing for this division is not a clean 1 to {table.division.clubs},
                  so the order here is derived from points, then goal difference, then goals scored.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
