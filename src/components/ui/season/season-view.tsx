"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SeasonState, SeasonRecord } from "@/lib/services/season-service";
import type { TargetBlock } from "@/lib/services/target-block-service";
import { leagueLabel } from "@/lib/ui/leagues";
import { SeasonPanel } from "@/components/ui/dashboard/season-panel";
import { SeasonVaultView } from "./season-vault-view";
import { BoardObjectivesPanel } from "./board-objectives-panel";

import { apiFetch } from "@/lib/platform/api-client";
interface SeasonViewProps {
  careerId: string;
  seasonState: SeasonState | null;
  onSeasonChange: (next: SeasonState) => void;
  /** An inner tab to open on arrival, when something outside this screen sent the manager here. */
  focusSubTab?: SubTab | null;
}

export type SubTab = "OUTLOOK" | "OBJECTIVES" | "CHARTS" | "VAULT";

/**
 * The inner tabs, in order, with their labels in one place.
 *
 * A record rather than a chain of nested ternaries: adding the objectives tracker used to mean
 * editing the tab list, the label ternary and the body separately, which is exactly how a tab ends
 * up reachable but mislabelled.
 */
const SUB_TABS: readonly SubTab[] = ["OUTLOOK", "OBJECTIVES", "CHARTS", "VAULT"];

const SUB_TAB_LABELS: Record<SubTab, string> = {
  OUTLOOK: "Outlook & Records",
  OBJECTIVES: "Board Objectives",
  CHARTS: "Matchday & Trends",
  VAULT: "Season Vault",
};

// Two independent sample-size gates, deliberately not the same number or the same name as the
// league model's own MIN_OBSERVATIONS_FOR_MODEL: that one governs the position-inference band,
// this one only governs whether a season-over-season chart has enough points to draw a trend.
const MIN_SEASONS_FOR_TREND = 2;

// Mirrors TargetBlockService.MATCHES_PER_BLOCK. Kept as a plain number so this client component
// never has to import a runtime value out of the server-only service module.
const MATCHES_PER_BLOCK = 5;

export function SeasonView({ careerId, seasonState, onSeasonChange, focusSubTab }: SeasonViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(focusSubTab ?? "OUTLOOK");
  const [selectedVaultSeason, setSelectedVaultSeason] = useState<number | null>(null);

  // Arriving from a storyline card carries the inner tab with it. Deferred through a timeout rather
  // than set inline: a synchronous setState inside an effect is a lint error in this codebase, and the
  // deferral also lets the click that navigated here finish before the tab moves under the cursor.
  useEffect(() => {
    if (!focusSubTab) return;
    const timer = window.setTimeout(() => setActiveSubTab(focusSubTab), 0);
    return () => window.clearTimeout(timer);
  }, [focusSubTab]);

  const outlook = seasonState?.outlook ?? null;
  // Memoised so the `??` fallback cannot hand `completedSeasons` a fresh empty array on every
  // render, which would make its dependency change even when nothing about the season did.
  const seasons = useMemo(() => seasonState?.seasons ?? [], [seasonState?.seasons]);
  const completedSeasons = useMemo(() => seasons.filter((s) => s.complete), [seasons]);

  // The season the manager is actually IN - the highest ordinal on record. Objectives are judged at
  // the end of a season, so this is the set he is currently being measured against.
  const currentSeason = useMemo(() => {
    const numbers = seasons.map((s) => s.season);
    return numbers.length > 0 ? Math.max(...numbers) : 1;
  }, [seasons]);
  const unreadableDebriefs = seasonState?.table.reconciliation.fromDebriefs.unreadable ?? 0;

  // ---------------------------------------------------------------------------
  // 1.3 — the manager's own block targets, drawn as a cumulative target line.
  // ---------------------------------------------------------------------------
  const [blockRows, setBlockRows] = useState<TargetBlock[]>([]);

  const loadBlockTargets = useCallback(async () => {
    if (!careerId) return;
    try {
      const response = await apiFetch(`/api/season/blocks?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        blocks?: Array<{ block: TargetBlock }>;
      };
      if (response.ok && payload.success && Array.isArray(payload.blocks)) {
        setBlockRows(payload.blocks.map((row) => row.block));
      }
    } catch {
      // No target line is drawn; the 5-Match Blocks tab reports its own errors.
    }
  }, [careerId]);

  // Deferred by a tick: the rule rightly forbids setState synchronously in an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadBlockTargets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadBlockTargets]);

  // Cumulative target points per matchday, in the order the manager planned them: block 1's five
  // matches are matchdays 1-5, block 2's are 6-10, and so on. The line is built only from targets
  // the manager actually set - an unplanned block stops it rather than inventing a number, and it
  // is always labelled as their own plan rather than as something the save states.
  const targetSeries = useMemo(() => {
    const ordered: Array<number | null> = [];
    [...blockRows]
      .sort((a, b) => a.blockIndex - b.blockIndex)
      .forEach((row) => {
        for (let index = 0; index < MATCHES_PER_BLOCK; index += 1) {
          const match = row.matches?.[index];
          ordered.push(match ? match.targetPoints : null);
        }
      });

    const series = new Map<number, number>();
    let cumulative = 0;
    let complete = true;
    ordered.forEach((points, index) => {
      if (points === null || points === undefined) {
        complete = false;
        return;
      }
      cumulative += points;
      if (complete) series.set(index + 1, cumulative);
    });
    return series;
  }, [blockRows]);

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
          {SUB_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveSubTab(tab)}
              className={`cursor-pointer rounded-lg px-4 py-2 text-xs font-sub font-bold uppercase tracking-wider transition-all ${
                activeSubTab === tab
                  ? "bg-[#E11D48] text-white shadow-sm shadow-rose-600/20"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {SUB_TAB_LABELS[tab]}
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

        {activeSubTab === "OBJECTIVES" &&
          (careerId ? (
            <BoardObjectivesPanel careerId={careerId} seasonNumber={currentSeason} />
          ) : (
            <EmptyCard
              title="No career synced yet"
              body="Sync a save from the Portal to record the objectives your board gave you."
            />
          ))}

        {activeSubTab === "CHARTS" && (
          <div className="space-y-6">
            <MatchdayTrajectoryChart
              progressSeries={seasonState?.progressSeries ?? []}
              targetSeries={targetSeries}
            />
            <PointsBySeasonChart seasons={completedSeasons} current={outlook} />
            <FinishBySeasonChart seasons={completedSeasons} />
          </div>
        )}

        {activeSubTab === "VAULT" && (
          <SeasonVaultView
            careerId={careerId}
            seasons={seasons}
            selectedSeason={selectedVaultSeason}
            onSelectSeason={setSelectedVaultSeason}
          />
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
            Every season the save has recorded, in the order it happened. Played, W-D-L and goals are
            its totals across every competition; points are the save&apos;s own season total, and only
            the finish is a league placing.
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
              <th className="px-3 py-2.5">Division</th>
              <th className="px-3 py-2.5">P*</th>
              <th className="px-3 py-2.5">W-D-L*</th>
              <th className="px-3 py-2.5">GF:GA*</th>
              <th className="px-3 py-2.5">GD*</th>
              <th className="px-3 py-2.5">PTS*</th>
              <th className="px-3 py-2.5">League finish</th>
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

      {/* `*` because the save keeps ONE combined record per season: these are not league figures.
          No competition is ever named here - the app runs against saves from any country, so naming
          "the FA Cup" or "the EFL Trophy" would be wrong for most of them. */}
      <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
        <span className="font-bold">*</span> One combined record per season: every match played, in
        whichever competitions the club entered. Not every competition awards points, so the points
        column is the save&apos;s own season total. Only{" "}
        <span className="font-bold">League finish</span> is a league placing, and it is not derived
        from the columns beside it.
      </p>

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

// ---------------------------------------------------------------------------
// Matchday Trajectory Series (Option A)
// ---------------------------------------------------------------------------

function MatchdayTrajectoryChart({
  progressSeries,
  targetSeries,
}: {
  progressSeries: NonNullable<SeasonState["progressSeries"]>;
  targetSeries: Map<number, number>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (progressSeries.length === 0) {
    return (
      <EmptyCard
        title="No matchday progress recorded this season"
        body="As you log debriefs or sync save snapshots across matchdays, your within-season trajectory will plot here in real time."
      />
    );
  }

  // Targets share the scale with actual points, so a target above the best actual still fits.
  const maxPoints = Math.max(
    ...progressSeries.map((p) => p.points),
    ...Array.from(targetSeries.values()),
    1,
  );
  const activePoint = hoveredIndex !== null ? progressSeries[hoveredIndex] : progressSeries.at(-1);
  const activeTarget = activePoint ? targetSeries.get(activePoint.matchday) : undefined;

  return (
    <ChartCard
      title="Matchday Trajectory & Form"
      subtitle="Within-season cumulative points against the target you set for each block, plus position tracking across synced matchdays."
    >
      <div className="space-y-4">
        {/* Interactive Tooltip Card */}
        {activePoint && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/60 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span className="rounded bg-rose-500/10 px-2 py-0.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                Matchday {activePoint.matchday}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {activePoint.inGameDate ? new Date(activePoint.inGameDate).toLocaleDateString() : "Date unrecorded"}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-sub">
              <div>
                <span className="text-slate-400">Record: </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {activePoint.wins}W - {activePoint.draws}D - {activePoint.losses}L
                </span>
              </div>
              <div>
                <span className="text-slate-400">PTS: </span>
                <span className="font-bold text-rose-600 dark:text-rose-400">{activePoint.points}</span>
              </div>
              {activeTarget !== undefined && (
                <div>
                  <span className="text-slate-400">Target: </span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{activeTarget}</span>
                  <span
                    className={`ml-1 font-bold ${
                      activePoint.points >= activeTarget
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {activePoint.points - activeTarget >= 0 ? "+" : ""}
                    {activePoint.points - activeTarget}
                  </span>
                </div>
              )}
              {activePoint.tablePosition && (
                <div>
                  <span className="text-slate-400">Pos: </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    #{activePoint.tablePosition}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Interactive Visual Series */}
        <div>
          <div className="flex h-44 items-stretch gap-2 px-1 pt-4">
            {progressSeries.map((p, idx) => {
              const heightPct = Math.max(8, (p.points / maxPoints) * 100);
              const isHovered = hoveredIndex === idx;
              const target = targetSeries.get(p.matchday);
              const targetPct = target === undefined ? null : Math.max(8, (target / maxPoints) * 100);
              const behindTarget = target !== undefined && p.points < target;

              // Hover HIGHLIGHTS the column; it does not resize anything.
              //
              // The bar used to widen (`scale-x-110`) and the value label below used to grow
              // (`scale-110`). Both are the same mistake: a chart whose geometry moves under the cursor
              // reads as unstable, because the reader can no longer tell whether the bar is that size
              // because of the hover or because of the data. Width and height now encode data ONLY, and
              // the hover is carried by the column band and the fill's saturation - a change of colour
              // rather than of shape.
              //
              // This lives here and NOT as a `{/* */}` above the element: inside `return (` a JSX
              // comment becomes a second sibling expression and the file stops parsing. Made twice now.
              return (
                <div
                  key={p.id}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className={`group flex h-full flex-1 cursor-pointer flex-col items-center rounded-lg px-0.5 transition-colors duration-150 ${
                    isHovered ? "bg-slate-900/[0.05] dark:bg-white/[0.06]" : ""
                  }`}
                >
                  {/* Bar and marker share this box, so the dashed line sits level with the bar top
                      rather than drifting as the label grows. */}
                  <div className="relative w-full flex-1">
                    <div
                      className={`absolute inset-x-0 bottom-0 rounded-t transition-colors duration-150 ${
                        behindTarget
                          ? isHovered ? "bg-amber-500" : "bg-amber-500/70"
                          : isHovered ? "bg-rose-500" : "bg-rose-500/70"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    {targetPct !== null && (
                      <div
                        title={`Your target for matchday ${p.matchday}: ${target} point${target === 1 ? "" : "s"}`}
                        className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-slate-700/70 dark:border-slate-200/80"
                        style={{ bottom: `${targetPct}%` }}
                      />
                    )}
                  </div>
                  <span className="mt-1.5 text-[9px] font-sub text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200">
                    M{p.matchday}
                  </span>
                </div>
              );
            })}
          </div>
          {targetSeries.size > 0 && (
            <p className="mt-3 flex items-start gap-2 text-[10px] font-sub leading-relaxed text-slate-500 dark:text-slate-400">
              <span
                aria-hidden
                className="mt-1.5 inline-block h-0 w-5 shrink-0 border-t-2 border-dashed border-slate-700/70 dark:border-slate-200/80"
              />
              The dashed marker on each matchday is the target you set in your own 5-Match Blocks. A bar
              turns amber while you are behind it. This is your plan, not a figure reported by the save.
            </p>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

function PointsBySeasonChart({
  seasons,
  current,
}: {
  seasons: SeasonRecord[];
  current: SeasonState["outlook"];
}) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const bars = [
    ...seasons.map((s) => ({ label: `S${s.season}`, points: s.points ?? 0, live: false, raw: s })),
    ...(current
      ? [
          {
            label: `S${current.seasonNumber} (live)`,
            points: current.points,
            live: true,
            raw: null,
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
      subtitle="Final points for completed seasons, and points so far this season. Hover any bar to highlight totals."
    >
      <div className="flex h-56 items-end gap-4 px-2">
        {bars.map((b) => {
          const isHovered = hoveredLabel === b.label;
          return (
            <div
              key={b.label}
              onMouseEnter={() => setHoveredLabel(b.label)}
              onMouseLeave={() => setHoveredLabel(null)}
              className={`group flex h-full flex-1 cursor-pointer flex-col items-center rounded-lg px-1 transition-colors duration-150 ${
                isHovered ? "bg-slate-900/[0.05] dark:bg-white/[0.06]" : ""
              }`}
            >
              <span className={`h-5 shrink-0 text-[11px] font-sub font-bold leading-5 tabular-nums transition-colors ${
                isHovered ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"
              }`}>
                {b.points}
                {b.live && (
                  <span className="ml-1 text-[9px] font-normal text-amber-600 dark:text-amber-400">
                    so far
                  </span>
                )}
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                <div
                  className={`w-full rounded-t-md transition-colors duration-200 ${
                    b.live
                      ? isHovered ? "bg-amber-500" : "bg-amber-500/70"
                      : isHovered ? "bg-[#E11D48]" : "bg-[#E11D48]/80"
                  }`}
                  style={{ height: `${Math.max(6, (b.points / max) * 100)}%` }}
                />
              </div>
              <span className="mt-2 shrink-0 text-[10px] font-sub uppercase text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200">
                {b.label}
              </span>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

function FinishBySeasonChart({ seasons }: { seasons: SeasonRecord[] }) {
  const [hoveredSeason, setHoveredSeason] = useState<number | null>(null);

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
    <ChartCard title="Finishing Position by Season" subtitle="Lower is better — bars are scaled to your worst finish on record. Hover to inspect.">
      <div className="flex h-48 items-end gap-4 px-2">
        {seasons.map((s) => {
          const pos = s.tablePosition ?? 0;
          const heightPct = pos > 0 ? Math.max(6, ((worst - pos + 1) / worst) * 100) : 6;
          const isHovered = hoveredSeason === s.season;

          return (
            <div
              key={s.season}
              onMouseEnter={() => setHoveredSeason(s.season)}
              onMouseLeave={() => setHoveredSeason(null)}
              className={`group flex h-full flex-1 cursor-pointer flex-col items-center rounded-lg px-1 transition-colors duration-150 ${
                isHovered ? "bg-slate-900/[0.05] dark:bg-white/[0.06]" : ""
              }`}
            >
              <span className={`h-5 shrink-0 text-[11px] font-sub font-bold leading-5 tabular-nums transition-colors ${
                isHovered ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"
              }`}>
                {pos > 0 ? `${pos}${ordinalSuffix(pos)}` : "—"}
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                <div
                  className={`w-full rounded-t-md transition-colors duration-200 ${
                    isHovered ? "bg-emerald-500" : "bg-emerald-500/70"
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="mt-2 shrink-0 text-[10px] font-sub uppercase text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200">
                S{s.season}
              </span>
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