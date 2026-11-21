"use client";

/**
 * Squad → Stats. Every player's record at the club, kept after the game forgets it.
 *
 * The list is the same dense, column-priority table as the squad list. Opening a player swaps the list for
 * his record, with inner tabs: Overview, Seasons, Matches, Development. Ratings and minutes are the save's;
 * goals, assists and the match context are what the manager logged in debriefs, and the page says so.
 */
import React, { useMemo, useState } from "react";

import { SubTabs, type SubTabOption } from "@/components/ui/sub-tabs";
import type { HistoryMatch, PlayerHistory, PlayerHistoryPayload } from "@/lib/squad/history";
import { formatRating } from "@/lib/squad/performance";
import {
  compareSortValues,
  naturalAscending,
  positionSortKey,
  tiebreak,
  type SortValue,
} from "@/lib/squad/sort";
import { venueLabel } from "@/lib/ui/labels";
import { PlayerFace } from "./player-face";
import { RatingBadge } from "./rating-sparkline";

type InnerTab = "OVERVIEW" | "SEASONS" | "MATCHES" | "DEVELOPMENT";

const INNER_TABS: ReadonlyArray<SubTabOption<InnerTab>> = [
  { id: "OVERVIEW", label: "Overview" },
  { id: "SEASONS", label: "Seasons" },
  { id: "MATCHES", label: "Matches" },
  { id: "DEVELOPMENT", label: "Development" },
];

type SortKey =
  | "name"
  | "position"
  | "seasons"
  | "appearances"
  | "minutes"
  | "averageRating"
  | "goals"
  | "assists"
  | "overall";

const HEAD = "py-2 px-1.5 text-center cursor-pointer select-none hover:text-amber-500";
const CELL = "py-1.5 px-1.5 text-center tabular-nums";

function dash(value: number | null | undefined): React.ReactNode {
  return value === null || value === undefined ? <span className="text-slate-400 dark:text-slate-500">–</span> : value;
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function ovrChange(player: PlayerHistory): { from: number; to: number } | null {
  if (player.growth.length === 0) return null;
  return {
    from: player.growth[0].overallRating,
    to: player.growth[player.growth.length - 1].overallRating,
  };
}

function OvrDelta({ from, to }: { from: number; to: number }) {
  const delta = to - from;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {from}→<strong className="text-amber-700 dark:text-amber-400">{to}</strong>
      {delta !== 0 && (
        <span className={`ml-1 text-[10px] ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}

export function PlayerStatsView({
  history,
  query,
}: {
  history: PlayerHistoryPayload | null;
  /** The Squad tab's search box. */
  query: string;
}) {
  const [includeFormer, setIncludeFormer] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("appearances");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const all = useMemo(() => history?.players ?? [], [history]);
  const formerCount = all.filter((player) => !player.currentSquad).length;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = all.filter(
      (player) =>
        (includeFormer || player.currentSquad) &&
        (!needle ||
          player.name.toLowerCase().includes(needle) ||
          (player.primaryPosition ?? "").toLowerCase().includes(needle))
    );
    const value = (player: PlayerHistory): SortValue => {
      if (sortKey === "name") return player.name;
      if (sortKey === "position") return positionSortKey(player.primaryPosition);
      if (sortKey === "overall") return player.growth[player.growth.length - 1]?.overallRating ?? null;
      return player.totals[sortKey];
    };
    const tie = (player: PlayerHistory) => ({
      position: player.primaryPosition,
      overall: player.growth[player.growth.length - 1]?.overallRating ?? null,
      name: player.name,
    });
    return [...filtered].sort(
      (left, right) =>
        compareSortValues(value(left), value(right), sortAsc) || tiebreak(tie(left), tie(right))
    );
  }, [all, includeFormer, query, sortKey, sortAsc]);

  const selected = selectedKey ? all.find((player) => player.playerKey === selectedKey) ?? null : null;
  if (selected) return <PlayerRecord player={selected} onBack={() => setSelectedKey(null)} />;

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortAsc((current) => !current);
    else {
      setSortKey(key);
      setSortAsc(naturalAscending(key));
    }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortAsc ? " ▲" : " ▼") : "");

  if (all.length === 0) {
    return (
      <div data-tour="stats-list" className="rounded-2xl border border-slate-200 bg-white/90 p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300">
        No match record yet. Sync a save after playing a match, and every rating, goal and assist you log
        is kept here, season after season.
      </div>
    );
  }

  return (
    <div
      data-tour="stats-list"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-xl dark:border-slate-800/90 dark:bg-slate-900/90"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800/80">
        <p className="font-sub text-xs text-slate-600 dark:text-slate-300">
          Every match and season at the club. <span className="text-slate-500 dark:text-slate-400">Ratings and minutes from the save; goals and assists from your debriefs.</span>
        </p>
        {formerCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 font-sub text-xs text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={includeFormer}
              onChange={(event) => setIncludeFormer(event.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            Include former players ({formerCount})
          </label>
        )}
      </div>

      <table className="hidden w-full border-collapse text-left md:table">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 font-sub text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/50 dark:text-slate-300">
            <th className="cursor-pointer select-none py-2 pl-4 pr-2 hover:text-amber-500" onClick={() => sortBy("name")}>
              Player{arrow("name")}
            </th>
            <th className={HEAD} onClick={() => sortBy("position")}>
              POS{arrow("position")}
            </th>
            <th className={`${HEAD} hidden lg:table-cell`} onClick={() => sortBy("seasons")} title="Seasons with a match at the club">
              SZN{arrow("seasons")}
            </th>
            <th className={HEAD} onClick={() => sortBy("appearances")} title="Rated matches of 15+ minutes">
              APP{arrow("appearances")}
            </th>
            <th className={`${HEAD} hidden lg:table-cell`} onClick={() => sortBy("minutes")}>
              MINS{arrow("minutes")}
            </th>
            <th className={HEAD} onClick={() => sortBy("averageRating")}>
              AVG{arrow("averageRating")}
            </th>
            <th className={HEAD} onClick={() => sortBy("goals")} title="Logged in your debriefs">
              G{arrow("goals")}
            </th>
            <th className={HEAD} onClick={() => sortBy("assists")} title="Logged in your debriefs">
              A{arrow("assists")}
            </th>
            <th
              className="hidden cursor-pointer select-none py-2 pl-1.5 pr-4 text-center hover:text-amber-500 xl:table-cell"
              onClick={() => sortBy("overall")}
              title="OVR at the first and latest sync. Sorts by the latest."
            >
              OVR{arrow("overall")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-[13px] dark:divide-slate-800/60">
          {rows.map((player) => {
            const change = ovrChange(player);
            return (
              <tr
                key={player.playerKey}
                onClick={() => setSelectedKey(player.playerKey)}
                className="group cursor-pointer text-slate-800 transition-colors hover:bg-slate-100/80 dark:text-slate-200 dark:hover:bg-slate-800/40"
              >
                <td className="py-1.5 pl-4 pr-2 font-bold text-slate-900 group-hover:text-amber-600 dark:text-slate-50 dark:group-hover:text-amber-400">
                  <span className="flex min-w-0 max-w-[18rem] items-center gap-2 2xl:max-w-[26rem]">
                    <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={24} />
                    <span className="min-w-0 truncate" title={player.name}>{player.name}</span>
                    {!player.currentSquad && (
                      <span className="shrink-0 whitespace-nowrap rounded border border-slate-300 px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-600 dark:text-slate-400">
                        Left
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-1.5 px-1.5 text-center font-sub text-[10px] font-bold">{player.primaryPosition ?? "–"}</td>
                <td className={`${CELL} hidden lg:table-cell`}>{player.totals.seasons}</td>
                <td className={CELL}>{player.totals.appearances}</td>
                <td className={`${CELL} hidden lg:table-cell`}>{player.totals.minutes}</td>
                <td className={CELL}>
                  {player.totals.averageRating !== null ? <RatingBadge rating={player.totals.averageRating} /> : dash(null)}
                </td>
                <td className={`${CELL} font-bold`}>{player.totals.goals}</td>
                <td className={`${CELL} font-bold`}>{player.totals.assists}</td>
                <td className={`${CELL} hidden pr-4 xl:table-cell`}>{change ? <OvrDelta {...change} /> : dash(null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="divide-y divide-slate-200 md:hidden dark:divide-slate-800/60">
        {rows.map((player) => (
          <li key={player.playerKey}>
            <button
              type="button"
              onClick={() => setSelectedKey(player.playerKey)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-100 dark:active:bg-slate-800/60"
            >
              <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-slate-100">{player.name}</span>
                  {player.totals.averageRating !== null && <RatingBadge rating={player.totals.averageRating} />}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sub text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                  <span>{player.primaryPosition ?? "–"}</span>
                  <span>{player.totals.appearances} apps</span>
                  <span>{player.totals.goals} G</span>
                  <span>{player.totals.assists} A</span>
                  {!player.currentSquad && <span className="font-bold uppercase text-slate-500">Left</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="p-6 text-center font-sub text-xs text-slate-500 dark:text-slate-400">No player matches that search.</p>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-heading text-xl tabular-nums text-slate-900 dark:text-slate-50">{value}</div>
      {note && <div className="mt-0.5 truncate font-sub text-[10px] text-slate-500 dark:text-slate-400">{note}</div>}
    </div>
  );
}

function PlayerRecord({ player, onBack }: { player: PlayerHistory; onBack: () => void }) {
  const [tab, setTab] = useState<InnerTab>("OVERVIEW");
  const [seasonFilter, setSeasonFilter] = useState<string>("ALL");

  const bestSeason = [...player.seasons]
    .filter((season) => season.averageRating !== null && season.appearances >= 3)
    .sort((left, right) => (right.averageRating ?? 0) - (left.averageRating ?? 0))[0];
  const allMatches = player.seasons.flatMap((season) => season.matches);
  const bestMatch = [...allMatches]
    .filter((match) => match.rating !== null)
    .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0) || right.goals - left.goals)[0];
  const peakOvr = player.growth.reduce<number | null>(
    (peak, point) => (peak === null ? point.overallRating : Math.max(peak, point.overallRating)),
    null
  );
  const shownMatches =
    seasonFilter === "ALL" ? allMatches : player.seasons.find((season) => season.seasonStart === seasonFilter)?.matches ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl dark:border-slate-800/90 dark:bg-slate-900/90">
        <button
          type="button"
          onClick={onBack}
          className="min-h-10 rounded-lg border border-slate-300 px-3 font-sub text-xs font-bold uppercase tracking-wider text-slate-700 hover:border-amber-500 hover:text-amber-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-amber-400"
        >
          ← All players
        </button>
        <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-heading text-lg text-slate-900 dark:text-slate-50">{player.name}</h3>
          <p className="font-sub text-xs text-slate-600 dark:text-slate-300">
            {player.primaryPosition ?? "–"} · {player.totals.seasons} season{player.totals.seasons === 1 ? "" : "s"} at the club
            {!player.currentSquad && " · has left"}
          </p>
        </div>
      </div>

      <SubTabs tabs={INNER_TABS} active={tab} onChange={setTab} />

      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl dark:border-slate-800/90 dark:bg-slate-900/90">
        {tab === "OVERVIEW" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Apps" value={player.totals.appearances} note="15+ min, rated" />
              <Tile label="Minutes" value={player.totals.minutes} />
              <Tile
                label="Avg rating"
                value={player.totals.averageRating !== null ? formatRating(player.totals.averageRating) : "–"}
              />
              <Tile label="Goals" value={player.totals.goals} note="logged" />
              <Tile label="Assists" value={player.totals.assists} note="logged" />
              <Tile label="Peak OVR" value={peakOvr ?? "–"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Tile
                label="Best season"
                value={bestSeason ? bestSeason.label : "–"}
                note={bestSeason ? `${formatRating(bestSeason.averageRating ?? 0)} avg over ${bestSeason.appearances} apps` : "Needs 3+ rated apps in a season"}
              />
              <Tile
                label="Best match"
                value={bestMatch?.rating != null ? formatRating(bestMatch.rating) : "–"}
                note={bestMatch ? `${shortDate(bestMatch.date)}${bestMatch.opponent ? ` vs ${bestMatch.opponent}` : ""}` : undefined}
              />
            </div>
          </div>
        )}

        {tab === "SEASONS" && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 font-sub text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  <th className="py-2 pr-2">Season</th>
                  <th className="py-2 px-1.5 text-center">APP</th>
                  <th className="hidden py-2 px-1.5 text-center sm:table-cell">MINS</th>
                  <th className="py-2 px-1.5 text-center">AVG</th>
                  <th className="hidden py-2 px-1.5 text-center sm:table-cell">BEST</th>
                  <th className="py-2 px-1.5 text-center">G</th>
                  <th className="py-2 px-1.5 text-center">A</th>
                  <th className="hidden py-2 pl-1.5 text-center md:table-cell">OVR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800 dark:divide-slate-800/60 dark:text-slate-200">
                {player.seasons.map((season) => (
                  <tr
                    key={season.seasonStart}
                    onClick={() => {
                      setSeasonFilter(season.seasonStart);
                      setTab("MATCHES");
                    }}
                    className="cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/40"
                    title="Open this season's matches"
                  >
                    <td className="py-2 pr-2 font-bold text-slate-900 dark:text-slate-50">{season.label}</td>
                    <td className={CELL}>{season.appearances}</td>
                    <td className={`${CELL} hidden sm:table-cell`}>{season.minutes}</td>
                    <td className={CELL}>{season.averageRating !== null ? <RatingBadge rating={season.averageRating} /> : dash(null)}</td>
                    <td className={`${CELL} hidden sm:table-cell`}>{season.bestRating !== null ? formatRating(season.bestRating) : dash(null)}</td>
                    <td className={`${CELL} font-bold`}>{season.goals}</td>
                    <td className={`${CELL} font-bold`}>{season.assists}</td>
                    <td className={`${CELL} hidden md:table-cell`}>
                      {season.overallStart !== null && season.overallEnd !== null ? (
                        <OvrDelta from={season.overallStart} to={season.overallEnd} />
                      ) : (
                        dash(null)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {player.seasons.length === 0 && (
              <p className="py-4 text-center font-sub text-xs text-slate-500 dark:text-slate-400">No match recorded for him yet.</p>
            )}
          </div>
        )}

        {tab === "MATCHES" && (
          <div className="space-y-3">
            <label className="flex flex-wrap items-center gap-2 font-sub text-xs font-semibold text-slate-700 dark:text-slate-200">
              Season
              <select
                value={seasonFilter}
                onChange={(event) => setSeasonFilter(event.target.value)}
                className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="ALL">All seasons</option>
                {player.seasons.map((season) => (
                  <option key={season.seasonStart} value={season.seasonStart}>
                    {season.label}
                  </option>
                ))}
              </select>
              <span className="font-normal text-slate-500 dark:text-slate-400">{shownMatches.length} matches</span>
            </label>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {shownMatches.map((match) => (
                <MatchRow key={match.date} match={match} />
              ))}
            </ul>
            {shownMatches.length === 0 && (
              <p className="py-4 text-center font-sub text-xs text-slate-500 dark:text-slate-400">No matches in this season.</p>
            )}
          </div>
        )}

        {tab === "DEVELOPMENT" && <Development player={player} />}
      </div>
    </div>
  );
}

function MatchRow({ match }: { match: HistoryMatch }) {
  return (
    <li className="flex items-center gap-3 py-2 text-[13px]">
      <span className="w-24 shrink-0 font-sub text-xs tabular-nums text-slate-600 dark:text-slate-300">{shortDate(match.date)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-slate-900 dark:text-slate-50">
          {match.opponent ? `vs ${match.opponent}` : <span className="font-normal italic text-slate-500 dark:text-slate-400">Opponent not logged</span>}
        </span>
        <span className="block truncate font-sub text-[11px] text-slate-500 dark:text-slate-400">
          {[match.venue ? venueLabel(match.venue) : null, match.scoreline, match.minutes !== null ? `${match.minutes}'` : null]
            .filter(Boolean)
            .join(" · ") || " "}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 font-sub text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200">
        {match.goals > 0 && <span title="Goals (logged)">{match.goals}G</span>}
        {match.assists > 0 && <span title="Assists (logged)">{match.assists}A</span>}
        {match.rating !== null ? <RatingBadge rating={match.rating} /> : <span className="min-w-[2.75rem] text-center text-slate-400">–</span>}
      </span>
    </li>
  );
}

/** OVR and POT at every sync, as a small inline chart, plus the season-by-season change. */
function Development({ player }: { player: PlayerHistory }) {
  const points = player.growth;
  if (points.length === 0) {
    return <p className="py-4 text-center font-sub text-xs text-slate-500 dark:text-slate-400">No sync has recorded his ratings yet.</p>;
  }
  const width = 640;
  const height = 200;
  const pad = 28;
  const values = points.flatMap((point) => [point.overallRating, point.potentialRating]);
  const min = Math.max(0, Math.min(...values) - 2);
  const max = Math.min(99, Math.max(...values) + 2);
  const x = (index: number) => (points.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (points.length - 1));
  const y = (value: number) => height - pad - ((value - min) / Math.max(1, max - min)) * (height - pad * 2);
  const line = (key: "overallRating" | "potentialRating") =>
    points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 font-sub text-xs text-slate-700 dark:text-slate-200">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-amber-500" />OVR {first.overallRating} → {last.overallRating}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-emerald-500" />POT {first.potentialRating} → {last.potentialRating}</span>
        <span className="text-slate-500 dark:text-slate-400">{points.length} syncs</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-full" role="img" aria-label={`OVR from ${first.overallRating} to ${last.overallRating}`}>
        {[min, Math.round((min + max) / 2), max].map((tick) => (
          <g key={tick}>
            <line x1={pad} x2={width - pad} y1={y(tick)} y2={y(tick)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
            <text x={4} y={y(tick) + 4} className="fill-slate-500 text-[11px]">{tick}</text>
          </g>
        ))}
        <path d={line("potentialRating")} fill="none" className="stroke-emerald-500" strokeWidth={2} strokeDasharray="4 3" />
        <path d={line("overallRating")} fill="none" className="stroke-amber-500" strokeWidth={2.5} />
        {points.map((point, index) => (
          <circle key={point.snapshotNumber} cx={x(index)} cy={y(point.overallRating)} r={3} className="fill-amber-500">
            <title>{`${point.inGameDate ?? `Sync ${point.snapshotNumber}`}: OVR ${point.overallRating}, POT ${point.potentialRating}`}</title>
          </circle>
        ))}
      </svg>
      {player.seasons.some((season) => season.overallStart !== null) && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {player.seasons
            .filter((season) => season.overallStart !== null && season.overallEnd !== null)
            .map((season) => (
              <li key={season.seasonStart} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-[13px] dark:border-slate-800">
                <span className="font-bold text-slate-900 dark:text-slate-50">{season.label}</span>
                <OvrDelta from={season.overallStart as number} to={season.overallEnd as number} />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
