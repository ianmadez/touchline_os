"use client";

import React, { useState } from "react";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { ParsedCareerEvent } from "@/lib/services/event-service";
import { PitchSlotAssignment } from "@/lib/services/tactics-service";
import { AppTab } from "@/lib/session";
import { UNKNOWN_POSITION } from "@/lib/parser/interface";
import { StorylineItem } from "@/lib/events/types";
import type { SeasonState } from "@/lib/services/season-service";
import {
  categoryLabel,
  eventLabel,
  statusLabel,
  storylineDestination,
  storylineDestinationLabel,
} from "@/lib/ui/labels";
import { formatEventDate, provenanceLabel, summariseEvent } from "@/lib/ui/events";
import { SeasonPanel } from "./season-panel";

interface DashboardViewProps {
  careerId: string;
  managerName: string;
  clubName: string;
  season?: number;
  inGameDate?: string | null;
  players: EnrichedPlayer[];
  recentEvents: ParsedCareerEvent[];
  storylines?: StorylineItem[];
  seasonState?: SeasonState | null;
  onSeasonChange?: (next: SeasonState) => void;
  tacticsSlots: PitchSlotAssignment[];
  onNavigateTab: (tab: AppTab) => void;
  onSelectPlayer: (player: EnrichedPlayer) => void;
}

export function DashboardView({
  careerId,
  managerName,
  clubName,
  season = 1,
  inGameDate,
  players,
  recentEvents,
  storylines = [],
  seasonState = null,
  onSeasonChange,
  tacticsSlots,
  onNavigateTab,
  onSelectPlayer,
}: DashboardViewProps) {
  const [expandedStorylineId, setExpandedStorylineId] = useState<string | null>(null);

  // 1. Unassigned / Flagged Players
  const unassignedPlayers = players.filter((p) => !p.userProfile?.assignedRole);
  const lowTrustPlayers = players.filter((p) => p.userProfile?.trustLevel === "LOW");
  const surplusPlayers = players.filter((p) => p.userProfile?.importanceMarker === "SURPLUS");

  // Deduplicate flagged players to prevent duplicate React keys
  const flaggedPlayersMap = new Map<string, EnrichedPlayer>();
  [...lowTrustPlayers, ...surplusPlayers].forEach((p) => flaggedPlayersMap.set(p.id, p));
  const flaggedPlayers = Array.from(flaggedPlayersMap.values());

  // 2. Active Formation & Pitch XI Interconnectedness
  const startingPlayerIds = new Set(
    tacticsSlots.map((s) => s.playerId).filter(Boolean) as string[]
  );
  const startingPlayers = players.filter((p) => startingPlayerIds.has(p.id));
  const benchPlayers = players.filter((p) => !startingPlayerIds.has(p.id));

  const startingAvgOvr =
    startingPlayers.length > 0
      ? Math.round(startingPlayers.reduce((acc, p) => acc + p.overallRating, 0) / startingPlayers.length)
      : 0;

  const benchAvgOvr =
    benchPlayers.length > 0
      ? Math.round(benchPlayers.reduce((acc, p) => acc + p.overallRating, 0) / benchPlayers.length)
      : 0;

  const filledSlotsCount = tacticsSlots.filter((s) => s.playerId).length;
  const totalSlotsCount = tacticsSlots.length || 11;

  // 3. Positional Depth Gaps against Active Formation
  const activeFormationRoles = Array.from(new Set(tacticsSlots.map((s) => s.role)));
  const depthGaps = activeFormationRoles.filter((role) => {
    const totalCoverage = players.filter(
      (p) => p.primaryPosition === role || p.userProfile?.assignedRole?.includes(role)
    );
    return totalCoverage.length < 2;
  });

  // 4. Data quality: players whose save position could not be mapped to a role.
  const unmappedPositionCount = players.filter(
    (p) => (p.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION
  ).length;

  const displayEvents = recentEvents.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Hero Operational Banner */}
      <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-sub uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A] font-bold mb-1">
            <span>Season {season}</span>
            <span>•</span>
            <span>{inGameDate || "Active Save Connected"}</span>
          </div>
          <h1 className="font-heading text-2xl text-slate-900 dark:text-slate-100 uppercase tracking-wide">
            {clubName || "Career Hub"} <span className="text-slate-400 dark:text-slate-500 font-normal">| {managerName || "Manager"}</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigateTab("TACTICS")}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-sub font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
          >
            Tactics Board
          </button>
          <button
            onClick={() => onNavigateTab("SQUAD")}
            className="px-4 py-2.5 bg-[#E11D48] hover:bg-[#FF8C7A] text-white text-xs font-sub font-bold uppercase tracking-wider rounded-xl transition-colors shadow-md cursor-pointer"
          >
            View Squad ({players.length})
          </button>
        </div>
      </div>

      {/* Season, board objective and promotion outlook. Full width: it is the context every
          card below it reads against. */}
      {seasonState && careerId && (
        <SeasonPanel
          careerId={careerId}
          seasonState={seasonState}
          onSeasonChange={onSeasonChange ?? (() => {})}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Alerts & Operational Focus */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dynamic Storylines Feed: What Matters Right Now */}
          <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>What Matters Right Now</span>
                <span className="text-[10px] font-sub font-bold px-2 py-0.5 rounded bg-[#E11D48]/15 text-[#E11D48] dark:text-[#FF8C7A] border border-[#E11D48]/30">
                  {storylines.filter((s) => s.status === "ACTIVE").length} Open
                </span>
              </h2>
              <span className="text-xs font-sub text-slate-400">Tracked from your save</span>
            </div>

            {storylines.length > 0 ? (
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                {storylines.map((story) => {
                  const isExpanded = expandedStorylineId === story.id;
                  const destination = storylineDestination(story.category);

                  const categoryColors: Record<string, string> = {
                    SQUAD_DEPTH: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
                    CONTRACT: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
                    FORM: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
                    TACTICAL: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
                    DEVELOPMENT: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
                    SEASON_OBJECTIVE: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
                  };

                  return (
                    <div
                      key={story.id}
                      className="group rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-[border-color,box-shadow] duration-200"
                    >
                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`shrink-0 text-[10px] font-sub font-bold px-2 py-0.5 rounded-md border ${
                                categoryColors[story.category] || categoryColors.SQUAD_DEPTH
                              }`}
                            >
                              {categoryLabel(story.category)}
                            </span>
                            <span className="text-[10px] font-sub text-slate-400 truncate">
                              {story.status === "ACTIVE"
                                ? `${story.daysActive ?? 1} day${(story.daysActive ?? 1) === 1 ? "" : "s"} open`
                                : statusLabel(story.status)}
                            </span>
                          </div>
                          {story.evidenceEvents && story.evidenceEvents.length > 0 && (
                            <button
                              onClick={() => setExpandedStorylineId(isExpanded ? null : story.id)}
                              aria-expanded={isExpanded}
                              className="shrink-0 min-h-10 px-2 text-xs font-sub text-slate-500 dark:text-slate-400 hover:text-[#E11D48] dark:hover:text-[#FF8C7A] font-semibold transition-colors cursor-pointer"
                            >
                              {isExpanded
                                ? "Hide evidence"
                                : `Evidence (${story.evidenceEvents.length})`}
                            </button>
                          )}
                        </div>

                        {/* The whole title is the affordance: a card you cannot act on is decoration. */}
                        <button
                          type="button"
                          onClick={() => onNavigateTab(destination)}
                          className="w-full text-left cursor-pointer"
                          title={`Go to ${destination.toLowerCase()}`}
                        >
                          <h3 className="font-heading text-sm text-slate-900 dark:text-slate-100 tracking-wide group-hover:text-[#E11D48] dark:group-hover:text-[#FF8C7A] transition-colors">
                            {story.title}
                          </h3>
                          <span className="mt-1 inline-block text-[11px] font-sub font-semibold text-slate-500 dark:text-slate-400 group-hover:text-[#E11D48] dark:group-hover:text-[#FF8C7A] transition-colors">
                            {storylineDestinationLabel(story.category)} →
                          </span>
                        </button>

                        {isExpanded && story.evidenceEvents && (
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5 animate-fade-in-up">
                            <span className="text-[10px] font-sub font-bold uppercase tracking-wider text-slate-400">
                              What we know
                            </span>
                            {/* The fact itself, not a category word. A row that only says
                                "Contract running out" tells the manager nothing they could act on. */}
                            {story.evidenceEvents.map((evt) => (
                              <div
                                key={evt.id}
                                className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1"
                              >
                                <p className="text-xs text-slate-700 dark:text-slate-300">
                                  {/*
                                    The opening row is composed here rather than read from the
                                    stored payload. What the event records is that this thread
                                    opened; the sentence is presentation, and reading it back from
                                    storage would let the card's heading and its own opening line
                                    drift apart the moment one of them was reworded.
                                  */}
                                  {evt.eventType === "STORYLINE_OPENED"
                                    ? `Opened: ${story.title}.`
                                    : summariseEvent(evt)}
                                </p>
                                <div className="flex items-center gap-1.5 text-[10px] font-sub text-slate-400">
                                  <span>{provenanceLabel(evt.source)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{eventLabel(evt.eventType)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{formatEventDate(evt.timestamp)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                Nothing flagged. Your squad is in good shape.
              </p>
            )}
          </div>

          {/* Action Required Banner (Styled with Touchline Crimson Theme) */}
          {unassignedPlayers.length > 0 && (
            <div className="bg-slate-900/95 dark:bg-slate-950/95 border border-[#E11D48]/40 rounded-2xl p-5 backdrop-blur-xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-white">
              <div className="space-y-1">
                <span className="text-[10px] font-sub uppercase font-bold text-[#FF8C7A] tracking-wider flex items-center gap-1.5">
                  Needs You
                </span>
                <p className="text-sm font-sans font-bold text-slate-100">
                  {unassignedPlayers.length} squad members require tactical role assignment
                </p>
                <p className="text-xs text-slate-400">
                  Assign tactical roles in the squad tab to establish clear expectations and trust anchors.
                </p>
              </div>
              <button
                onClick={() => onNavigateTab("SQUAD")}
                className="px-4 py-2.5 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-sub font-bold text-xs uppercase tracking-wider rounded-xl shrink-0 transition-colors shadow-md cursor-pointer"
              >
                Assign Roles →
              </button>
            </div>
          )}

          {/* Operational Squad Intelligence */}
          <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
            <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center justify-between">
              <span>Squad Report</span>
              <span className="text-xs font-sub font-normal text-slate-500 dark:text-slate-400">Live from your save</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Active Formation XI Analysis */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-sub font-bold uppercase text-slate-700 dark:text-slate-300">
                    Active Formation XI
                  </span>
                  <span className="text-[10px] font-sub font-bold px-2 py-0.5 rounded bg-[#E11D48]/15 text-[#E11D48] dark:text-[#FF8C7A] border border-[#E11D48]/30">
                    {filledSlotsCount}/{totalSlotsCount} Pitch Slots
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 pt-1">
                  <span>Starting XI Avg: <strong className="text-slate-900 dark:text-slate-100">{startingAvgOvr || "-"} OVR</strong></span>
                  <span>Bench Avg: <strong className="text-slate-900 dark:text-slate-100">{benchAvgOvr || "-"} OVR</strong></span>
                </div>
              </div>

              {/* Positional Depth */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-sub font-bold uppercase text-slate-700 dark:text-slate-300">
                    Positional Depth
                  </span>
                  <span
                    className={`text-[10px] font-sub font-bold px-2 py-0.5 rounded ${
                      depthGaps.length > 0
                        ? "bg-amber-500/15 text-amber-600 border border-amber-500/30"
                        : "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                    }`}
                  >
                    {depthGaps.length > 0 ? `${depthGaps.length} Depth Gaps` : "Balanced Coverage"}
                  </span>
                </div>
                {depthGaps.length > 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Thin coverage for:{" "}
                    <span className="font-bold text-amber-600 dark:text-amber-400">
                      {depthGaps.join(", ")}
                    </span>
                    . Consider rotation or market additions.
                  </p>
                ) : (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    All active pitch roles have at least 2 squad options available.
                  </p>
                )}
                {unmappedPositionCount > 0 && (
                  <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                    <span className="font-bold">{unmappedPositionCount}</span> player
                    {unmappedPositionCount === 1 ? "" : "s"} have no mappable position in this save.
                    Set them from the Squad tab to sharpen depth analysis.
                  </p>
                )}
              </div>
            </div>

            {/* Flagged Player Quick List (Deduplicated) */}
            {flaggedPlayers.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
                    Worth a Look
                  </span>
                  <span className="text-[10px] font-sub text-rose-500 font-bold">
                    {lowTrustPlayers.length} Low Trust • {surplusPlayers.length} Surplus
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {flaggedPlayers.slice(0, 8).map((player) => (
                    <button
                      key={player.id}
                      onClick={() => onSelectPlayer(player)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-[#E11D48]/15 text-xs font-sub font-medium text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                      {player.name} ({player.primaryPosition})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Activity Spine */}
        <div className="h-fit bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Recent Activity
            </h2>
            <button
              onClick={() => onNavigateTab("TIMELINE")}
              className="text-xs font-sub text-[#E11D48] dark:text-[#FF8C7A] hover:underline cursor-pointer"
            >
              See all →
            </button>
          </div>

          <div className="space-y-3">
            {displayEvents.length > 0 ? (
              displayEvents.map((evt) => (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => onNavigateTab("TIMELINE")}
                  className="w-full text-left p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 space-y-1 transition-[border-color,transform] duration-200 active:scale-[0.96] cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] font-sub font-bold uppercase tracking-wider">
                    <span className="text-[#E11D48] dark:text-[#FF8C7A] truncate">
                      {eventLabel(evt.eventType)}
                    </span>
                    <span className="shrink-0 text-slate-400 dark:text-slate-500 normal-case font-medium tracking-normal">
                      {formatEventDate(evt.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-sans line-clamp-2">
                    {summariseEvent(evt)}
                  </p>
                  <span className="block text-[10px] font-sub text-slate-400">
                    {provenanceLabel(evt.source)}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                Nothing here yet. Sync your save to start the timeline.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}