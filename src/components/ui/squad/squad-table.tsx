"use client";

import React, { useMemo, useState } from "react";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { UNKNOWN_POSITION, eaDaysToDate } from "@/lib/parser/interface";
import {
  compareSortValues,
  naturalAscending,
  positionSortKey,
  tiebreak,
  type SortValue,
} from "@/lib/squad/sort";
import { describeTimeOut, isInjured } from "@/lib/squad/injury";
import type { PlayerPerformancePayload } from "@/lib/squad/performance";
import { PlayerFace } from "./player-face";
import { RatingBadge } from "./rating-sparkline";
import { IconTrend } from "@/components/ui/icons";

/** "On loan" and "name needed" markers, shared by the desktop rows and the phone cards. */
function PlayerStatusTags({ player }: { player: EnrichedPlayer }) {
  const loanEnd = formatSaveDate(player.loanEndDate);
  return (
    <>
      {player.onLoanTeamId !== null && (
        <span
          className="inline-flex min-w-0 max-w-[11rem] shrink items-center whitespace-nowrap rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
          title={
            `On loan${player.onLoanTeamName ? ` at ${player.onLoanTeamName}` : ""}` +
            (loanEnd ? ` until ${loanEnd}` : "")
          }
        >
          <span className="shrink-0">On loan</span>
          {player.onLoanTeamName && (
            <span className="ml-1 min-w-0 truncate normal-case tracking-normal">· {player.onLoanTeamName}</span>
          )}
        </span>
      )}
      {!player.nameResolved && (
        <span
          className="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          title="This save does not store his name. Open him to add it."
        >
          Name needed
        </span>
      )}
    </>
  );
}

/** A save date (EA day count, the game's DATE field) as "12 Jan 2027", or null when absent. */
function formatSaveDate(value: number | null): string | null {
  if (value === null || value <= 0) return null;
  const date = eaDaysToDate(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface SquadTableProps {
  players: EnrichedPlayer[];
  /** The save's own clock: every return date is a comparison against it. */
  inGameDate?: string | null;
  onSelectPlayer: (player: EnrichedPlayer) => void;
  /**
   * Opening a player from the match-stats table, where the dossier should also show his form.
   *
   * A separate callback rather than a second argument, so the squad list cannot pass "show his form" by
   * accident and keeps its one simple contract.
   */
  onSelectPlayerFromStats?: (player: EnrichedPlayer) => void;
  /**
   * The season's per-player record: the save's ratings and the manager's logged goals and assists.
   *
   * Optional so the table still renders on a hydration payload that predates it, in which case the
   * match-stats view says there is nothing to show rather than inventing zeroes.
   */
  playerPerformance?: PlayerPerformancePayload | null;
}

type SortableField =
  | "jersey"
  | "name"
  | "primaryPosition"
  | "overallRating"
  | "potentialRating"
  | "age"
  | "assignedRole"
  | "trustLevel"
  | "importanceMarker";

/** What the match-stats table can be ordered by. All but the rating are counts of what happened. */
type StatsSortField =
  | "name"
  | "primaryPosition"
  | "appearances"
  | "minutes"
  | "averageRating"
  | "goals"
  | "assists";

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

/** A tactical role sorts by the line it plays in (GK first), or null when none is assigned. */
function roleRank(role: string | null | undefined): number | null {
  if (!role) return null;
  const baseCode = role.split(" ")[0].toUpperCase();
  return POSITION_GROUP_RANK[role] ?? POSITION_GROUP_RANK[baseCode] ?? 5;
}

/** The value a squad column sorts by. Null is "no value", which always sorts last. */
function squadSortValue(player: EnrichedPlayer, field: SortableField): SortValue {
  switch (field) {
    case "name":
      return player.name;
    case "primaryPosition":
      return positionSortKey(player.primaryPosition);
    case "jersey":
      return player.jersey;
    case "age":
      return player.age;
    case "overallRating":
      return player.overallRating;
    case "potentialRating":
      return player.potentialRating;
    case "trustLevel":
      return TRUST_RANK[player.userProfile?.trustLevel || ""] ?? null;
    case "importanceMarker":
      return STATUS_RANK[player.userProfile?.importanceMarker || ""] ?? null;
    case "assignedRole":
      return roleRank(player.userProfile?.assignedRole);
  }
}

const tiebreakOf = (player: EnrichedPlayer) => ({
  position: player.primaryPosition,
  overall: player.overallRating,
  name: player.name,
});

export function SquadTable({
  players,
  inGameDate = null,
  onSelectPlayer,
  onSelectPlayerFromStats,
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
      setSortAsc(naturalAscending(field));
    }
  };

  const cleanLabel = (text: string | null | undefined): string => {
    if (!text) return "";
    return text.replace(/_/g, " ").trim();
  };

  const loanCount = players.filter((p) => p.onLoanTeamId !== null).length;
  const unnamedCount = players.filter((p) => !p.nameResolved).length;
  const filterChips = [
    "ALL",
    "INJURED",
    "YOUTH",
    "UNTOUCHABLE",
    "SURPLUS",
    ...(loanCount > 0 ? ["ON LOAN"] : []),
    ...(unnamedCount > 0 ? ["UNNAMED"] : []),
  ];

  const filteredPlayers = players.filter((p) => {
    // Unnamed players stay in the squad list. Hiding them made real squad members (modded or
    // generated players the name tables don't cover) look like the save had lost them.
    if (filterRole === "ON LOAN") return p.onLoanTeamId !== null;
    if (filterRole === "UNNAMED") return !p.nameResolved;
    // "All" is the whole registered squad, loanees included, because that is how a manager counts it.
    // Every narrower view is about who is actually at the club, so loanees drop out of those.
    if (filterRole !== "ALL" && p.onLoanTeamId !== null) return false;
    if (filterRole === "INJURED") return isInjured(p.userProfile?.injury, inGameDate);
    if (filterRole === "YOUTH") return p.isYouthProspect;
    if (filterRole === "UNTOUCHABLE") return p.userProfile?.importanceMarker === "UNTOUCHABLE";
    if (filterRole === "SURPLUS") return p.userProfile?.importanceMarker === "SURPLUS";
    return true;
  });

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    const primary = compareSortValues(squadSortValue(a, sortField), squadSortValue(b, sortField), sortAsc);
    if (primary !== 0) return primary;
    // Two players in the same role line read in role-name order before the general tiebreak.
    if (sortField === "assignedRole") {
      const byRole = compareSortValues(a.userProfile?.assignedRole, b.userProfile?.assignedRole, true);
      if (byRole !== 0) return byRole;
    }
    return tiebreak(tiebreakOf(a), tiebreakOf(b));
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
      setStatsSortAsc(naturalAscending(field));
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
    const valueOf = (
      player: EnrichedPlayer,
      record: { [key in Exclude<StatsSortField, "name" | "primaryPosition">]: number | null } | null
    ): SortValue => {
      if (statsSortField === "name") return player.name;
      if (statsSortField === "primaryPosition") return positionSortKey(player.primaryPosition);
      return record === null ? null : record[statsSortField];
    };
    // Every player is listed, unnamed ones included, so the stats table never looks like it lost anyone.
    return players
      .map((player) => ({ player, record: playerPerformance?.byPlayer[player.id] ?? null }))
      .sort(
        (a, b) =>
          compareSortValues(valueOf(a.player, a.record), valueOf(b.player, b.record), statsSortAsc) ||
          tiebreak(tiebreakOf(a.player), tiebreakOf(b.player))
      );
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
            filterChips.map((f) => (
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
              {filterRole === "ALL" && loanCount > 0 ? ` · ${loanCount} out on loan` : ""}
            </>
          )}
        </span>
      </div>

      {!statsMode && unnamedCount > 0 && (
        <button
          type="button"
          onClick={() => setFilterRole("UNNAMED")}
          className="flex w-full items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-left font-sub text-xs text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/15 cursor-pointer"
        >
          <span aria-hidden="true">✎</span>
          <span>
            <strong>
              {unnamedCount} player{unnamedCount === 1 ? " has" : "s have"} no name in this save
            </strong>{" "}
            (usually generated or modded players). Open one and type his name: it is saved to your
            career and kept on every sync.
          </span>
        </button>
      )}

      {/* The headers are the desktop sort controls, and they vanish with the table on a phone.
          This is the same state, with a plain select, so sorting survives the card layout. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 md:hidden dark:border-slate-800/80">
        <label className="flex items-center gap-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Sort by
          <select
            value={statsMode ? statsSortField : sortField}
            onChange={(event) => {
              const field = event.target.value;
              if (statsMode) {
                setStatsSortField(field as StatsSortField);
                setStatsSortAsc(naturalAscending(field));
              } else {
                setSortField(field as SortableField);
                setSortAsc(naturalAscending(field));
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-sub text-xs normal-case tracking-normal text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {statsMode ? (
              <>
                <option value="averageRating">Average rating</option>
                <option value="name">Name</option>
                <option value="primaryPosition">Position</option>
                <option value="appearances">Appearances</option>
                <option value="minutes">Minutes</option>
                <option value="goals">Goals</option>
                <option value="assists">Assists</option>
              </>
            ) : (
              <>
                <option value="overallRating">Overall rating</option>
                <option value="potentialRating">Potential</option>
                <option value="name">Name</option>
                <option value="primaryPosition">Position</option>
                <option value="jersey">Shirt number</option>
                <option value="age">Age</option>
                <option value="assignedRole">Assigned role</option>
                <option value="trustLevel">Trust</option>
                <option value="importanceMarker">Status</option>
              </>
            )}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            if (statsMode) setStatsSortAsc((current) => !current);
            else setSortAsc((current) => !current);
          }}
          aria-label="Reverse the sort order"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
        >
          {statsMode
            ? statsSortAsc
              ? "Ascending"
              : "Descending"
            : sortAsc
              ? "Ascending"
              : "Descending"}
        </button>
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
          <table className="hidden w-full text-left border-collapse md:table">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 text-[11px] font-sub font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider select-none">
                <th
                  onClick={() => handleStatsSort("name")}
                  className="py-2 px-3 cursor-pointer hover:text-amber-500 transition-colors group"
                >
                  Player {statsSortIndicator("name")}
                </th>
                <th
                  onClick={() => handleStatsSort("primaryPosition")}
                  className="py-1.5 px-1.5 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                >
                  POS {statsSortIndicator("primaryPosition")}
                </th>
                <th
                  onClick={() => handleStatsSort("appearances")}
                  className="py-1.5 px-2 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Matches the save rated in full, so a cameo under 15 minutes is not counted"
                >
                  APP {statsSortIndicator("appearances")}
                </th>
                <th
                  onClick={() => handleStatsSort("minutes")}
                  className="py-1.5 px-2 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                >
                  MINS {statsSortIndicator("minutes")}
                </th>
                <th
                  onClick={() => handleStatsSort("averageRating")}
                  className="py-1.5 px-2 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Mean of the save's own match ratings, 0 to 10"
                >
                  AVG {statsSortIndicator("averageRating")}
                </th>
                <th
                  onClick={() => handleStatsSort("goals")}
                  className="py-1.5 px-2 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Goals you logged in a match debrief. The save records no scorer."
                >
                  GOALS {statsSortIndicator("goals")}
                </th>
                <th
                  onClick={() => handleStatsSort("assists")}
                  className="py-1.5 px-2 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                  title="Assists you logged in a match debrief."
                >
                  ASSISTS {statsSortIndicator("assists")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 text-[13px] font-sans">
              {statsRows.map(({ player, record }) => (
                <tr
                  key={player.id}
                  onClick={() => (onSelectPlayerFromStats ?? onSelectPlayer)(player)}
                  className="group hover:bg-slate-100/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors duration-150"
                >
                  <td className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    <span className="flex min-w-0 max-w-[18rem] items-center gap-2 2xl:max-w-[26rem]">
                      <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={24} />
                      <span className="min-w-0 truncate">{player.userProfile?.displayName || player.name}</span>
                    </span>
                  </td>
                  <td className="py-1.5 px-1.5 text-center">
                    <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-sub text-[10px] font-bold text-slate-700 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-300">
                      {player.primaryPosition || UNKNOWN_POSITION}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center font-sub tabular-nums text-slate-800 dark:text-slate-200">
                    {record ? record.appearances : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-center font-sub tabular-nums text-slate-800 dark:text-slate-200">
                    {record ? record.minutes : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    {record?.averageRating !== null && record?.averageRating !== undefined ? (
                      <RatingBadge rating={record.averageRating} />
                    ) : (
                      <span className="font-sub text-xs text-slate-400 dark:text-slate-600">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-center font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {record ? record.goals : "-"}
                  </td>
                  <td className="py-1.5 px-2 text-center font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {record ? record.assists : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!statsMode && (
        <table className="hidden w-full text-left border-collapse md:table">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 text-[11px] font-sub font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider select-none">
              <th
                onClick={() => handleSort("jersey")}
                className="w-10 py-2 pl-3 pr-1 text-center cursor-pointer hover:text-amber-500 transition-colors group"
                title="Shirt number"
              >
                #{renderSortIndicator("jersey")}
              </th>
              <th
                onClick={() => handleSort("name")}
                className="py-2 px-2 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Player {renderSortIndicator("name")}
              </th>
              <th
                onClick={() => handleSort("primaryPosition")}
                className="py-2 px-1.5 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                POS {renderSortIndicator("primaryPosition")}
              </th>
              <th
                onClick={() => handleSort("overallRating")}
                className="py-2 px-1.5 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                OVR {renderSortIndicator("overallRating")}
              </th>
              <th
                onClick={() => handleSort("potentialRating")}
                className="py-2 px-1.5 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                POT {renderSortIndicator("potentialRating")}
              </th>
              <th
                onClick={() => handleSort("age")}
                className="py-2 px-1.5 cursor-pointer hover:text-amber-500 transition-colors text-center group"
              >
                Age {renderSortIndicator("age")}
              </th>
              {/*
                Fitness sits with the facts about the player, not with the manager's own labels, so
                it reads left of Assigned Role. Most of the column says the same short word, which is
                deliberate: a squad list is scanned for the players who are NOT available, and a
                column of quiet Fit chips makes the two loud ones find themselves.
              */}
              <th className="py-2 px-1.5 text-center">Fitness</th>
              <th
                onClick={() => handleSort("assignedRole")}
                className="hidden xl:table-cell py-2 px-2 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Role {renderSortIndicator("assignedRole")}
              </th>
              <th
                onClick={() => handleSort("trustLevel")}
                className="hidden lg:table-cell py-2 px-2 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Trust {renderSortIndicator("trustLevel")}
              </th>
              <th
                onClick={() => handleSort("importanceMarker")}
                className="hidden lg:table-cell py-2 pl-2 pr-3 cursor-pointer hover:text-amber-500 transition-colors group"
              >
                Status {renderSortIndicator("importanceMarker")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60 text-[13px] font-sans">
            {sortedPlayers.map((player) => (
              <tr
                key={player.id}
                onClick={() => onSelectPlayer(player)}
                className="group hover:bg-slate-100/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors duration-150"
              >
                <td className="w-10 py-1.5 pl-3 pr-1 text-center font-sub text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {player.jersey ?? <span className="text-slate-400 dark:text-slate-500">–</span>}
                </td>
                <td className="py-1.5 px-2 font-bold text-slate-900 dark:text-slate-50 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  <span className="flex min-w-0 max-w-[15rem] items-center gap-2 lg:max-w-[18rem] 2xl:max-w-[26rem]">
                    <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={24} />
                    <span className="min-w-0 truncate" title={player.name}>{player.name}</span>
                    <PlayerStatusTags player={player} />
                  </span>
                </td>
                <td className="py-1.5 px-1.5 text-center">
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
                <td className="py-1.5 px-1.5 text-center font-heading font-bold tabular-nums text-amber-700 dark:text-amber-400">
                  {player.overallRating}
                </td>
                <td className="py-1.5 px-1.5 text-center font-sub font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {player.potentialRating}
                </td>
                <td className="py-1.5 px-1.5 text-center font-sub tabular-nums text-slate-800 dark:text-slate-200">
                  {player.age ?? "-"}
                </td>
                <td className="py-1.5 px-1.5 text-center">
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
                        is NOT available, and a half-said injury is worse than no column at all. Lower-priority
                        columns hide at narrower widths, so this one keeps its room.
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
                <td className="hidden xl:table-cell max-w-[11rem] truncate py-1.5 px-2 text-xs font-sub text-slate-800 dark:text-slate-200">
                  {player.userProfile?.assignedRole || (
                    <span className="text-slate-500 dark:text-slate-400 italic">Unassigned</span>
                  )}
                </td>
                <td className="hidden lg:table-cell py-1.5 px-2">
                  {player.userProfile?.trustLevel ? (
                    <span
                      className={`text-[10px] font-sub px-2 py-0.5 rounded-md uppercase font-bold tracking-wider inline-flex items-center gap-1 whitespace-nowrap ${
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
                    <span className="text-slate-500 dark:text-slate-400 text-xs">-</span>
                  )}
                </td>
                <td className="hidden lg:table-cell py-1.5 pl-2 pr-3">
                  {player.userProfile?.importanceMarker ? (
                    <span
                      className={`text-[10px] font-sub px-2 py-0.5 rounded-md uppercase font-bold tracking-wider inline-flex items-center gap-1 whitespace-nowrap ${
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
                    <span className="text-slate-500 dark:text-slate-400 text-xs">Standard</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {/*
        Below 768px the eleven columns become one card per player. The table stays the desktop
        surface; the card carries the same facts in the order a squad list is read (face, name,
        rating, availability) and opens the same dossier on tap.
      */}
      {!statsMode && sortedPlayers.length > 0 && (
        <ul className="divide-y divide-slate-200 md:hidden dark:divide-slate-800/60">
          {sortedPlayers.map((player) => {
            const injury = player.userProfile?.injury;
            const out = isInjured(injury, inGameDate);
            const timeOut = out ? describeTimeOut(injury?.until ?? null, inGameDate) : null;
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => onSelectPlayer(player)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-100 dark:active:bg-slate-800/60"
                >
                  <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="break-words text-sm font-bold text-slate-900 dark:text-slate-100">
                        {player.name}
                      </span>
                      <span className="shrink-0 font-heading text-sm font-bold text-amber-600 dark:text-amber-400">
                        {player.overallRating}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <PlayerStatusTags player={player} />
                      <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-300">
                        {player.primaryPosition || UNKNOWN_POSITION}
                      </span>
                      <span>POT {player.potentialRating}</span>
                      <span>{player.age ?? "-"} yrs</span>
                      <span
                        className={
                          out
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-700 dark:text-emerald-400"
                        }
                      >
                        {out ? `Out ${timeOut ?? ""}`.trim() : "Fit"}
                      </span>
                    </span>
                    {(player.userProfile?.assignedRole ||
                      player.userProfile?.trustLevel ||
                      player.userProfile?.importanceMarker) && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {player.userProfile?.assignedRole ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-sub text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {player.userProfile.assignedRole}
                          </span>
                        ) : null}
                        {player.userProfile?.trustLevel ? (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Trust {cleanLabel(player.userProfile.trustLevel)}
                          </span>
                        ) : null}
                        {player.userProfile?.importanceMarker ? (
                          <span className="rounded bg-purple-500/10 px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                            {cleanLabel(player.userProfile.importanceMarker)}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-amber-600 dark:text-amber-400">
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {statsMode && statsRows.length > 0 && (
        <ul className="divide-y divide-slate-200 md:hidden dark:divide-slate-800/60">
          {statsRows.map(({ player, record }) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => (onSelectPlayerFromStats ?? onSelectPlayer)(player)}
                className="w-full px-4 py-3 text-left transition-colors active:bg-slate-100 dark:active:bg-slate-800/60"
              >
                <span className="flex items-center gap-3">
                  <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-bold text-slate-900 dark:text-slate-100">
                      {player.userProfile?.displayName || player.name}
                    </span>
                    <span className="mt-0.5 block font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {player.primaryPosition || UNKNOWN_POSITION}
                    </span>
                  </span>
                  {record?.averageRating !== null && record?.averageRating !== undefined ? (
                    <RatingBadge rating={record.averageRating} />
                  ) : null}
                </span>
                <span className="mt-2 grid grid-cols-4 gap-2">
                  {[
                    ["APP", record?.appearances],
                    ["MINS", record?.minutes],
                    ["GOALS", record?.goals],
                    ["ASSISTS", record?.assists],
                  ].map(([label, value]) => (
                    <span key={String(label)} className="rounded-lg bg-slate-50 px-2 py-1.5 text-center dark:bg-slate-950/60">
                      <span className="block font-sub text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {label}
                      </span>
                      <span className="block font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                        {value ?? "-"}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

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