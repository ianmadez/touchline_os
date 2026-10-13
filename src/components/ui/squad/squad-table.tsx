"use client";

import React, { useMemo, useState } from "react";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { UNKNOWN_POSITION } from "@/lib/parser/interface";
import { describeTimeOut, isInjured } from "@/lib/squad/injury";
import type { PlayerPerformancePayload } from "@/lib/squad/performance";
import { PlayerFace } from "./player-face";
import { RatingBadge } from "./rating-sparkline";
import { IconTrend } from "@/components/ui/icons";

interface SquadTableProps {
  players: EnrichedPlayer[];
  /** The save's own clock: every return date is a comparison against it. */
  inGameDate?: string | null;
  onSelectPlayer: (player: EnrichedPlayer) => void;
  /**
   * The season's per-player record: the save's ratings and the manager's logged goals and assists.
   *
   * Optional so the table still renders on a hydration payload that predates it, in which case the
   * match-stats view says there is nothing to show rather than inventing zeroes.
   */
  playerPerformance?: PlayerPerformancePayload | null;
}

type SortableField =
  | "name"
  | "primaryPosition"
  | "overallRating"
  | "potentialRating"
  | "age"
  | "assignedRole"
  | "trustLevel"
  | "importanceMarker";

/** What the match-stats table can be ordered by. All but the rating are counts of what happened. */
type StatsSortField = "appearances" | "minutes" | "averageRating" | "goals" | "assists";

const TRUST_RANK: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const STATUS_RANK: Record<string, number> = {
  UNTOUCHABLE: 4,
  KEY_PLAYER: 3,
  ROTATION: 2,
  SURPLUS: 1,
};

// Back to front: GK lowest, attackers highest. Ascending sort reads GK -> DEF -> MID -> ATT;
// descending reads ATT -> MID -> DEF -> GK. Unrecognised/unknown codes rank below GK so they
// surface at the very top or bottom rather than scattering alphabetically through the list.
const POSITION_GROUP_RANK: Record<string, number> = {
  GK: 1,
  LB: 2,
  LCB: 2,
  CB: 2,
  RCB: 2,
  RB: 2,
  LWB: 2,
  RWB: 2,
  CDM: 3,
  LDM: 3,
  RDM: 3,
  LM: 3,
  LCM: 3,
  CM: 3,
  RCM: 3,
  RM: 3,
  CAM: 3,
  LAM: 3,
  RAM: 3,
  LW: 4,
  RW: 4,
  LF: 4,
  RF: 4,
  CF: 4,
  LST: 4,
  ST: 4,
  RST: 4,
};

function positionRank(position: string | null | undefined): number {
  if (!position) return 0;
  return POSITION_GROUP_RANK[position] ?? 0;
}

function roleRank(role: string | null | undefined): number {
  if (!role) return 0;
  const baseCode = role.split(" ")[0].toUpperCase();
  return POSITION_GROUP_RANK[role] ?? POSITION_GROUP_RANK[baseCode] ?? 5;
}

export function SquadTable({
  players,
  inGameDate = null,
  onSelectPlayer,
  playerPerformance = null,
}: SquadTableProps) {
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortableField>("overallRating");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  /**
   * The match-stats mode, switched from the chip beside the squad filters.
   *
   * A MODE rather than a filter chip, because it changes what the table IS: the squad filters narrow a
   * list of players by what the manager has marked, while this replaces the list with what each player
   * has actually done. Leaving both on at once would make "SURPLUS" and "match stats" look like the same
   * kind of control, and they are not.
   */
  const [statsMode, setStatsMode] = useState(false);
  const [statsSortField, setStatsSortField] = useState<StatsSortField>("averageRating");
  const [statsSortAsc, setStatsSortAsc] = useState<boolean>(false);

  const handleSort = (field: SortableField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const cleanLabel = (text: string | null | undefined): string => {
    if (!text) return "";
    return text.replace(/_/g, " ").trim();
  };

  const filteredPlayers = players.filter((p) => {
    // A placeholder name is not a name. Every list here excludes a player the save never named, with
    // one exception on purpose: the Youth academy, where he can actually be given one.
    if (!p.nameResolved) return false;
    if (filterRole === "INJURED") return isInjured(p.userProfile?.injury, inGameDate);
    if (filterRole === "YOUTH") return p.isYouthProspect;
    if (filterRole === "UNTOUCHABLE") return p.userProfile?.importanceMarker === "UNTOUCHABLE";
    if (filterRole === "SURPLUS") return p.userProfile?.importanceMarker === "SURPLUS";
    return true;
  });

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    let valA: string | number = 0;
    let valB: string | number = 0;

    if (sortField === "trustLevel") {
      valA = TRUST_RANK[a.userProfile?.trustLevel || ""] ?? 0;
      valB = TRUST_RANK[b.userProfile?.trustLevel || ""] ?? 0;
    } else if (sortField === "primaryPosition") {
      valA = positionRank(a.primaryPosition);
      valB = positionRank(b.primaryPosition);
    } else if (sortField === "importanceMarker") {
      valA = STATUS_RANK[a.userProfile?.importanceMarker || ""] ?? 0;
      valB = STATUS_RANK[b.userProfile?.importanceMarker || ""] ?? 0;
    } else if (sortField === "assignedRole") {
      const roleA = a.userProfile?.assignedRole;
      const roleB = b.userProfile?.assignedRole;
      valA = roleRank(roleA);
      valB = roleRank(roleB);

      if (valA === valB) {
        const strA = roleA || "";
        const strB = roleB || "";
        if (strA !== strB) {
          return sortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
        }
        return a.name.localeCompare(b.name);
      }
    } else {
      valA = a[sortField] ?? 0;
      valB = b[sortField] ?? 0;
    }

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const renderSortIndicator = (field: SortableField) => {
    const isActive = sortField === field;
    return (
      <span className={`inline-block ml-1 text-[10px] transition-opacity ${isActive ? "opacity-100 text-amber-500 font-bold" : "opacity-30 group-hover:opacity-70"}`}>
        {isActive ? (sortAsc ? "▲" : "▼") : "↕"}
      </span>
    );
  };

  const handleStatsSort = (field: StatsSortField) => {
    if (statsSortField === field) {
      setStatsSortAsc(!statsSortAsc);
    } else {
      setStatsSortField(field);
      setStatsSortAsc(false);
    }
  };

  /**
   * The squad as the match-stats table reads it.
   *
   * EVERY resolved player is listed, not only the ones with a record, so the manager can see the whole
   * squad in one place and tell "he has not played" from "he is not in the list". A player with no
   * record sorts below every player who has one, whichever column is chosen: an absent figure is not a
   * small figure, and letting a missing average sort as zero would put the men who never played at the
   * bottom of a list ranked by how badly they played.
   */
  const statsRows = useMemo(() => {
    const valueOf = (record: { [key in StatsSortField]: number | null } | null): number => {
      if (record === null) return -1;
      const value = record[statsSortField];
      return value === null ? -1 : value;
    };
    return players
      .filter((player) => player.nameResolved)
      .map((player) => ({ player, record: playerPerformance?.byPlayer[player.id] ?? null }))
      .sort((a, b) => {
        const left = valueOf(a.record);
        const right = valueOf(b.record);
        if (left < right) return statsSortAsc ? -1 : 1;
        if (left > right) return statsSortAsc ? 1 : -1;
        return a.player.name.localeCompare(b.player.name);
      });
  }, [players, playerPerformance, statsSortField, statsSortAsc]);

  const statsSortIndicator = (field: StatsSortField) => {
    const isActive = statsSortField === field;
    return (
      <span className={`inline-block ml-1 text-[10px] transition-opacity ${isActive ? "opacity-100 text-amber-500 font-bold" : "opacity-30 group-hover:opacity-70"}`}>
        {isActive ? (statsSortAsc ? "▲" : "▼") : "↕"}
      </span>
    );
  };

  const withRecord = statsRows.filter((row) => row.record !== null).length;

  return (
    <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800/90 rounded-2xl backdrop-blur-xl shadow-xl overflow-hidden transition-colors">
      {/* Table Filter Controls */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!statsMode &&
            ["ALL", "INJURED", "YOUTH", "UNTOUCHABLE", "SURPLUS"].map((f) => (
              <button
                key={f}
                onClick={() => setFilterRole(f)}
                className={`px-3 py-1.5 rounded-lg font-sub text-xs uppercase tracking-wider transition-[background-color,color] cursor-pointer ${
                  filterRole === f
                    ? "bg-amber-500/15 border border-amber-500/60 text-amber-700 dark:text-amber-400 font-bold"
                    : "bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                {f}
              </button>
            ))}
          {/*
            The mode switch, beside the filters it replaces. Pressing it swaps the whole table rather
            than narrowing it, which is why it is drawn with an icon and a pressed state instead of the
            flat chip the filters use.
          */}
          <button
            type="button"
            onClick={() => setStatsMode((current) => !current)}
            aria-pressed={statsMode}
            title="Show what each player has actually done this season, from the save's match ratings and your logged debriefs"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-sub text-xs uppercase tracking-wider transition-[background-color,color] cursor-pointer ${
              statsMode
                ? "border-[#E11D48] bg-[#E11D48]/15 font-bold text-[#E11D48] dark:text-[#FF8C7A]"
                : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <IconTrend className="h-3.5 w-3.5" />
            Match stats
          </button>
        </div>

        <span className="font-sub text-xs text-slate-500 dark:text-slate-400">
          {statsMode ? (
            <>
              Season record for <span className="text-amber-400 font-bold">{withRecord}</span> of{" "}
              {statsRows.length} squad members
            </>
          ) : (
            <>
              Showing <span className="text-amber-400 font-bold">{sortedPlayers.length}</span> squad
              members
            </>
          )}
        </span>
      </div>

      {/* Table Surface */}
      <div className="overflow-x-auto">
        {statsMode && (
          /*
            The match-stats table. Same row click as the squad list, so a player is always one action
            from his dossier - and the dossier is where his form line lives, which is the whole point of
            the mode. The columns are the save's own record plus the manager's log, and the caption at
            the foot says which is which.
          */
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 text-[11px] font-sub text-slate-500 dark:text-slate-400 uppercase tracking-wider select-none">
                <th className="py-3 px-4">Player</th>
                <th className="py-3 px-2 text-center">POS</th>
                <th
                  onClick={() => handleStatsSort("appearances")}
                  className="py-3 px-3 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Matches the save rated in full, so a cameo under 15 minutes is not counted"
                >
                  APP {statsSortIndicator("appearances")}
                </th>
                <th
                  onClick={() => handleStatsSort("minutes")}
                  className="py-3 px-3 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                >
                  MINS {statsSortIndicator("minutes")}
                </th>
                <th
                  onClick={() => handleStatsSort("averageRating")}
                  className="py-3 px-3 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Mean of the save's own match ratings, 0 to 10"
                >
                  AVG {statsSortIndicator("averageRating")}
                </th>
                <th
                  onClick={() => handleStatsSort("goals")}
                  className="py-3 px-3 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Goals you logged in a match debrief. The save records no scorer."
                >
                  GOALS {statsSortIndicator("goals")}
                </th>
                <th
                  onClick={() => handleStatsSort("assists")}
                  className="py-3 px-3 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Assists you logged in a match debrief."
                >
                  ASSISTS {statsSortIndicator("assists")}
                </th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 text-sm font-sans">
              {statsRows.map(({ player, record }) => (
                <tr
                  key={player.id}
                  onClick={() => onSelectPlayer(player)}
                  className="group hover:bg-slate-100/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors duration-150"
                >
                  <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={28} />
                      <span className="truncate">{player.userProfile?.displayName || player.name}</span>
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-sub text-[10px] font-bold text-slate-700 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-300">
                      {player.primaryPosition || UNKNOWN_POSITION}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center font-sub tabular-nums text-slate-700 dark:text-slate-300">
                    {record ? record.appearances : "-"}
                  </td>
                  <td className="py-3 px-3 text-center font-sub tabular-nums text-slate-700 dark:text-slate-300">
                    {record ? record.minutes : "-"}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {record?.averageRating !== null && record?.averageRating !== undefined ? (
                      <RatingBadge rating={record.averageRating} />
                    ) : (
                      <span className="font-sub text-xs text-slate-400 dark:text-slate-600">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {record ? record.goals : "-"}
                  </td>
                  <td className="py-3 px-3 text-center font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {record ? record.assists : "-"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-xs font-sub text-amber-600 dark:text-amber-400 group-hover:translate-x-1 inline-block transition-transform">
                      Inspect →
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!statsMode && (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 text-[11px] font-sub text-slate-500 dark:text-slate-400 uppercase tracking-wider select-none">
              <th
                onClick={() => handleSort("name")}
                className="py-3 px-4 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Player Name {renderSortIndicator("name")}
              </th>
              <th
                onClick={() => handleSort("primaryPosition")}
                className="py-3 px-2 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                POS {renderSortIndicator("primaryPosition")}
              </th>
              <th
                onClick={() => handleSort("overallRating")}
                className="py-3 px-3 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                OVR {renderSortIndicator("overallRating")}
              </th>
              <th
                onClick={() => handleSort("potentialRating")}
                className="py-3 px-3 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                POT {renderSortIndicator("potentialRating")}
              </th>
              <th
                onClick={() => handleSort("age")}
                className="py-3 px-3 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                Age {renderSortIndicator("age")}
              </th>
              {/*
                Fitness sits with the facts about the player, not with the manager's own labels, so
                it reads left of Assigned Role. Most of the column says the same short word, which is
                deliberate: a squad list is scanned for the players who are NOT available, and a
                column of quiet Fit chips makes the two loud ones find themselves.
              */}
              <th className="py-3 px-3 text-center">Fitness</th>
              <th
                onClick={() => handleSort("assignedRole")}
                className="py-3 px-4 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Assigned Role {renderSortIndicator("assignedRole")}
              </th>
              <th
                onClick={() => handleSort("trustLevel")}
                className="py-3 px-4 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Trust {renderSortIndicator("trustLevel")}
              </th>
              <th
                onClick={() => handleSort("importanceMarker")}
                className="py-3 px-4 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Status {renderSortIndicator("importanceMarker")}
              </th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 text-sm font-sans">
            {sortedPlayers.map((player) => (
              <tr
                key={player.id}
                onClick={() => onSelectPlayer(player)}
                className="group hover:bg-slate-100/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors duration-150"
              >
                <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={28} />
                    <span className="truncate">{player.name}</span>
                  </span>
                </td>
                <td className="py-3 px-2 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-sub font-bold border ${
                      (player.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION
                        ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-500/50"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80"
                    }`}
                    title={
                      (player.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION
                        ? "This save gave no usable position code. Set one in the player dossier."
                        : undefined
                    }
                  >
                    {player.primaryPosition || UNKNOWN_POSITION}
                  </span>
                </td>
                <td className="py-3 px-3 text-center font-heading font-bold text-amber-600 dark:text-amber-400">
                  {player.overallRating}
                </td>
                <td className="py-3 px-3 text-center font-sub text-emerald-600 dark:text-emerald-400 font-bold">
                  {player.potentialRating}
                </td>
                <td className="py-3 px-3 text-center text-slate-700 dark:text-slate-300 font-sub">
                  {player.age ?? "-"}
                </td>
                <td className="py-3 px-3 text-center">
                  {(() => {
                    const injury = player.userProfile?.injury;
                    const out = isInjured(injury, inGameDate);
                    if (!out) {
                      return (
                        <span className="inline-flex items-center gap-1.5 font-sub text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Fit
                        </span>
                      );
                    }
                    const timeOut = describeTimeOut(injury?.until ?? null, inGameDate);
                    return (
                      /*
                        No truncation and no max width. This pill was cut to "OUT A COUPLE ...", which is
                        the one word in the row that has to be readable - a squad table is scanned for who
                        is NOT available, and a half-said injury is worse than no column at all. The table
                        already scrolls sideways, so the width costs nothing.
                      */
                      <span
                        title={[injury?.note, injury?.until ? `Back ${injury.until}` : null]
                          .filter(Boolean)
                          .join(". ")}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        {timeOut ? `Out ${timeOut}` : "Out"}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-3 px-4 text-xs font-sub text-slate-700 dark:text-slate-300">
                  {player.userProfile?.assignedRole || (
                    <span className="text-slate-400 dark:text-slate-600 italic">Unassigned</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {player.userProfile?.trustLevel ? (
                    <span
                      className={`text-[10px] font-sub px-2.5 py-1 rounded-md uppercase font-bold tracking-wider inline-flex items-center gap-1 shadow-2xs ${
                        player.userProfile.trustLevel === "HIGH"
                          ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                          : player.userProfile.trustLevel === "MEDIUM"
                          ? "bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                          : "bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {cleanLabel(player.userProfile.trustLevel)}
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-600 text-xs">-</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {player.userProfile?.importanceMarker ? (
                    <span
                      className={`text-[10px] font-sub px-2.5 py-1 rounded-md uppercase font-bold tracking-wider inline-flex items-center gap-1 shadow-2xs ${
                        player.userProfile.importanceMarker === "UNTOUCHABLE"
                          ? "bg-purple-500/10 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30"
                          : player.userProfile.importanceMarker === "KEY_PLAYER"
                          ? "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                          : player.userProfile.importanceMarker === "ROTATION"
                          ? "bg-sky-500/10 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30"
                          : "bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {cleanLabel(player.userProfile.importanceMarker)}
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500 text-xs">Standard</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="text-xs font-sub text-amber-600 dark:text-amber-400 group-hover:translate-x-1 inline-block transition-transform">
                    Inspect →
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {statsMode && statsRows.length > 0 && (
        <p className="border-t border-slate-200 px-4 py-3 font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800/80 dark:text-slate-500">
          Appearances, minutes and the average come from your save&apos;s own match ratings, and a match
          under 15 minutes is not counted. Goals and assists come from the debriefs you logged - your
          save records no scorer.
          {playerPerformance?.seasonScoped === false &&
            " Your save carries no date yet, so these figures cover everything logged rather than one season."}
        </p>
      )}

      {statsMode && statsRows.length === 0 && (
        <div className="p-8 text-center space-y-2">
          <p className="font-heading text-sm text-slate-900 dark:text-slate-100 uppercase">
            No squad to show
          </p>
          <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-md mx-auto">
            Sync a career from the Portal and the save&apos;s own match ratings appear here.
          </p>
        </div>
      )}

      {!statsMode && players.length === 0 && (
        <div className="p-8 text-center space-y-2">
          <p className="font-heading text-sm text-slate-900 dark:text-slate-100 uppercase">
            No squad data synced yet
          </p>
          <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-md mx-auto">
            Open the Portal and run the manager appointment protocol to parse your save. The
            parser reads the roster straight from the save file — nothing is typed by hand.
          </p>
        </div>
      )}
    </div>
  );
}