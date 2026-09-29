"use client";

import React, { useState } from "react";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { UNKNOWN_POSITION } from "@/lib/parser/interface";
import { PlayerFace } from "./player-face";

interface SquadTableProps {
  players: EnrichedPlayer[];
  onSelectPlayer: (player: EnrichedPlayer) => void;
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

export function SquadTable({ players, onSelectPlayer }: SquadTableProps) {
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortableField>("overallRating");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

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

  return (
    <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800/90 rounded-2xl backdrop-blur-xl shadow-xl overflow-hidden transition-colors">
      {/* Table Filter Controls */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {["ALL", "YOUTH", "UNTOUCHABLE", "SURPLUS"].map((f) => (
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
        </div>

        <span className="font-sub text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="text-amber-400 font-bold">{sortedPlayers.length}</span> squad members
        </span>
      </div>

      {/* Table Surface */}
      <div className="overflow-x-auto">
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
      </div>

      {players.length === 0 && (
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