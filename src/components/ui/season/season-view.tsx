"use client";

import React, { useMemo, useState } from "react";
import type { SeasonState, SeasonRecord } from "@/lib/services/season-service";
import { leagueLabel } from "@/lib/ui/leagues";
import { SeasonPanel } from "@/components/ui/dashboard/season-panel";

interface SeasonViewProps {
  careerId: string;
  seasonState: SeasonState | null;
  onSeasonChange: (next: SeasonState) => void;
}

type SubTab = "OUTLOOK" | "CHARTS";

// Two independent sample-size gates, deliberately not the same number or the same name as the
// league model's own MIN_OBSERVATIONS_FOR_MODEL: that one governs the position-inference band,
// this one only governs whether a season-over-season chart has enough points to draw a trend.
const MIN_SEASONS_FOR_TREND = 2;

export function SeasonView({ careerId, seasonState, onSeasonChange }: SeasonViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("OUTLOOK");

  const outlook = seasonState?.outlook ?? null;
  const seasons = seasonState?.seasons ?? [];
  const completedSeasons = useMemo(() => seasons.filter((s) => s.complete), [seasons]);
  const unreadableDebriefs = seasonState?.table.reconciliation.fromDebriefs.unreadable ?? 0;

  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden">
      {/* Header + sub-nav — fixed, never scrolls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 dark:shadow-md dark:shadow-slate-950/50">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-sub font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
            <span>{outlook ? outlook.seasonLabel : "No season synced yet"}</span>
          </div>
          <h1 className="font-heading text-2xl uppercase tracking-wide text-slate-900 dark:text-slate-100">
            Campaign Hub
          </h1>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-800 dark:bg-slate-950">
          {(["OUTLOOK", "CHARTS"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveSubTab(tab)}
              className={`cursor-pointer rounded-lg px-5 py-2 text-xs font-sub font-bold uppercase tracking-wider transition-colors ${
                activeSubTab === tab
                  ? "bg-[#E11D48] text-white shadow-sm shadow-rose-600/20"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {tab === "OUTLOOK" ? "Outlook & Records" : "Trends"}
            </button>
          ))}
        </div>
      </div>

      {/* Body — the only scroll region on this screen */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {activeSubTab === "OUTLOOK" && (
          <div className="space-y-6">
            {seasonState && careerId ? (
              <SeasonPanel careerId={careerId} seasonState={seasonState} onSeasonChange={onSeasonChange} />
            ) : (
              <EmptyCard
                title="No career synced yet"
                body="Sync a save from the Portal to see your season outlook, objectives and table position here."
              />
            )}

            <SeasonHistoryTable seasons={seasons} unreadableDebriefs={unreadableDebriefs} />
          </div>
        )}

        {activeSubTab === "CHARTS" && (
          <div className="space-y-6">
            <PointsBySeasonChart seasons={completedSeasons} current={outlook} />
            <FinishBySeasonChart seasons={completedSeasons} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season history table — real rows only, no fabricated defaults.
// ---------------------------------------------------------------------------

function SeasonHistoryTable({
  seasons,
  unreadableDebriefs,
}: {
  seasons: SeasonRecord[];
  unreadableDebriefs: number;
}) {
  if (seasons.length === 0) {
    return (
      <EmptyCard
        title="No completed seasons yet"
        body="Once a season finishes in-game and you sync, it appears here permanently — nothing in this table is ever rewritten."
      />
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 dark:shadow-md dark:shadow-slate-950/50">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Managerial Record
          </h2>
          <p className="text-xs font-sub text-slate-500 dark:text-slate-400">
            Every season the save has recorded, in the order it happened.
          </p>
        </div>
        <span className="rounded border border-[#E11D48]/30 bg-[#E11D48]/15 px-2.5 py-1 text-xs font-sub font-bold text-[#E11D48] dark:text-[#FF8C7A]">
          {seasons.length} season{seasons.length === 1 ? "" : "s"} on record
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sub">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-400 dark:border-slate-800">
              <th className="px-3 py-2.5">Season</th>
              <th className="px-3 py-2.5">League</th>
              <th className="px-3 py-2.5">P</th>
              <th className="px-3 py-2.5">W-D-L</th>
              <th className="px-3 py-2.5">GF:GA</th>
              <th className="px-3 py-2.5">GD</th>
              <th className="px-3 py-2.5">PTS</th>
              <th className="px-3 py-2.5">Finish</th>
              <th className="px-3 py-2.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800 dark:divide-slate-800/60 dark:text-slate-200">
            {seasons.map((s) => {
              const hasGoals = s.goalsFor !== null && s.goalsAgainst !== null;
              const gd = hasGoals ? (s.goalsFor as number) - (s.goalsAgainst as number) : null;
              return (
                <tr key={s.season} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-3 font-bold text-[#E11D48] dark:text-[#FF8C7A]">
                    Season {s.season}
                  </td>
                  <td className="px-3 py-3 font-medium">
                    {leagueLabel(s.leagueName, s.leagueId)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{s.gamesPlayed ?? "—"}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {s.wins !== null && s.draws !== null && s.losses !== null
                      ? `${s.wins}-${s.draws}-${s.losses}`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {hasGoals ? `${s.goalsFor}:${s.goalsAgainst}` : "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                    {gd === null ? "—" : gd > 0 ? `+${gd}` : gd}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-bold text-slate-900 dark:text-slate-100">
                    {s.points ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-bold">
                    {s.complete ? `${s.tablePosition}${ordinalSuffix(s.tablePosition as number)}` : "In progress"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <StatusPill complete={s.complete} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {unreadableDebriefs > 0 && (
        <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
          {unreadableDebriefs} logged debrief{unreadableDebriefs === 1 ? "" : "s"} could not be read for a
          scoreline, so {unreadableDebriefs === 1 ? "it isn't" : "they aren't"} counted in the debrief tally
          above.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts — built only from data that genuinely exists.
//
// A true matchday-by-matchday trajectory needs an append-only progress series we don't persist yet
// (one row per sync, not just the latest per season). Until that lands, the only honest trend
// available is season-over-season, so that's what these two charts show. No promotion/relegation
// benchmark lines are drawn here — those thresholds aren't configured anywhere yet.
// ---------------------------------------------------------------------------

function PointsBySeasonChart({
  seasons,
  current,
}: {
  seasons: SeasonRecord[];
  current: SeasonState["outlook"];
}) {
  const bars = [
    ...seasons.map((s) => ({ label: `S${s.season}`, points: s.points ?? 0, projected: false })),
    ...(current
      ? [
          {
            label: `S${current.seasonNumber} (live)`,
            points: current.projectedPoints ?? current.points,
            projected: current.projectedPoints !== null,
          },
        ]
      : []),
  ];

  if (bars.length < MIN_SEASONS_FOR_TREND) {
    return (
      <EmptyCard
        title="Not enough season history yet"
        body="Points-by-season needs at least two seasons on record. Keep playing and syncing — this fills in on its own."
      />
    );
  }

  const max = Math.max(...bars.map((b) => b.points), 1);

  return (
    <ChartCard
      title="Points by Season"
      subtitle="Final points for completed seasons; the live season shows its points-per-game projection, tagged as such."
    >
      <div className="flex h-56 items-end gap-4 px-2">
        {bars.map((b) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center">
            {/* Fixed-height rail, then a flex track that fills what is left. The bar's percentage
                height resolves against the TRACK: a percentage needs a parent with a definite
                height, and the old column here was sized to its own content (number + label), so
                every bar computed against nothing and rendered empty. */}
            <span className="h-5 shrink-0 text-[11px] font-sub font-bold leading-5 tabular-nums text-slate-700 dark:text-slate-200">
              {b.points}
              {b.projected && <span className="ml-1 text-[9px] font-normal text-amber-600 dark:text-amber-400">projected</span>}
            </span>
            <div className="flex min-h-0 w-full flex-1 items-end justify-center">
              <div
                className={`w-full rounded-t-md ${b.projected ? "bg-amber-500/70" : "bg-[#E11D48]"}`}
                style={{ height: `${Math.max(6, (b.points / max) * 100)}%` }}
              />
            </div>
            <span className="mt-2 shrink-0 text-[10px] font-sub uppercase text-slate-400">{b.label}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

function FinishBySeasonChart({ seasons }: { seasons: SeasonRecord[] }) {
  if (seasons.length < MIN_SEASONS_FOR_TREND) {
    return (
      <EmptyCard
        title="Not enough completed seasons yet"
        body="Finishing position needs at least two completed seasons to plot as a trend."
      />
    );
  }

  const positions = seasons.map((s) => s.tablePosition ?? 0).filter((p) => p > 0);
  const worst = Math.max(...positions, 1);

  return (
    <ChartCard title="Finishing Position by Season" subtitle="Lower is better — bars are scaled to your worst finish on record.">
      <div className="flex h-48 items-end gap-4 px-2">
        {seasons.map((s) => {
          const pos = s.tablePosition ?? 0;
          const heightPct = pos > 0 ? Math.max(6, ((worst - pos + 1) / worst) * 100) : 6;
          return (
            <div key={s.season} className="flex h-full flex-1 flex-col items-center">
              <span className="h-5 shrink-0 text-[11px] font-sub font-bold leading-5 tabular-nums text-slate-700 dark:text-slate-200">
                {pos > 0 ? `${pos}${ordinalSuffix(pos)}` : "—"}
              </span>
              {/* Same fix as the points chart: the percentage needs the track's definite height. */}
              <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                <div className="w-full rounded-t-md bg-emerald-500/70" style={{ height: `${heightPct}%` }} />
              </div>
              <span className="mt-2 shrink-0 text-[10px] font-sub uppercase text-slate-400">S{s.season}</span>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 dark:shadow-md dark:shadow-slate-950/50">
      <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-xs font-sub text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800/80 dark:bg-slate-950/60">
        {children}
      </div>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="font-heading text-sm uppercase text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="mt-1 text-xs font-sub text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

function StatusPill({ complete }: { complete: boolean }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
        complete
          ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "border border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
      }`}
    >
      {complete ? "COMPLETE" : "IN PROGRESS"}
    </span>
  );
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}