"use client";

import React, { useState } from "react";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { KNOWN_POSITION_ROLES, UNKNOWN_POSITION } from "@/lib/parser/interface";
import {
  POSITION_GROUP_LABELS,
  TACTICAL_ROLES,
  isKnownRole,
  rolesForPosition,
} from "@/lib/tactics/roles";
import { PlayerFace } from "./player-face";
import type { PlayerValuation } from "@/lib/services/value-service";
import { formatMoney, formatMoneyExact } from "@/lib/ui/format";

interface PlayerDrawerProps {
  player: EnrichedPlayer | null;
  /**
   * DERIVED, and never part of the save. The save holds no player valuation at all, so this is
   * estimated from agreed transfer fees in this career and is labelled as an estimate on the card.
   */
  valuation?: PlayerValuation;
  onClose: () => void;
  onSaveProfile: (data: {
    eaPlayerId: number;
    assignedRole: string;
    trustLevel: "HIGH" | "MEDIUM" | "LOW";
    importanceMarker: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS";
    userNotes: string;
    /** Manual position override; null clears it. */
    primaryPosition: string | null;
  }) => void;
}

export function PlayerDrawer({ player, valuation, onClose, onSaveProfile }: PlayerDrawerProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [assignedRole, setAssignedRole] = useState(player?.userProfile?.assignedRole || "");
  const [trustLevel, setTrustLevel] = useState<"HIGH" | "MEDIUM" | "LOW">(
    (player?.userProfile?.trustLevel as "HIGH" | "MEDIUM" | "LOW") || "MEDIUM"
  );
  const [importanceMarker, setImportanceMarker] = useState<
    "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS"
  >(
    (player?.userProfile?.importanceMarker as
      | "UNTOUCHABLE"
      | "KEY_PLAYER"
      | "ROTATION"
      | "SURPLUS") || "ROTATION"
  );
  const [userNotes, setUserNotes] = useState(player?.userProfile?.userNotes || "");
  const [positionOverride, setPositionOverride] = useState<string>(
    player?.userProfile?.positionOverride || ""
  );

  // This drawer is keyed by player id in `page.tsx`, so selecting a different player remounts the
  // component and every field below re-initialises from props. A sync effect here would be
  // redundant, and React flags setState-inside-an-effect for causing cascading renders.

  if (!player) return null;

  // The role list follows the position the manager is looking at, so changing the override above
  // immediately reshapes the roles offered below it.
  const effectivePosition = positionOverride || player.primaryPosition || UNKNOWN_POSITION;
  const { group, primary, other } = rolesForPosition(effectivePosition);
  const selectedRoleHint = TACTICAL_ROLES.find((role) => role.label === assignedRole)?.hint ?? null;

  const handleSave = () => {
    onSaveProfile({
      eaPlayerId: player.eaPlayerId,
      assignedRole,
      trustLevel,
      importanceMarker,
      userNotes,
      primaryPosition: positionOverride || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300">
      {/* Click outside backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Drawer Container */}
      <div className="w-full max-w-md bg-white/95 dark:bg-slate-900/95 border-l border-slate-200 dark:border-slate-800 shadow-2xl p-6 flex flex-col justify-between overflow-y-auto animate-drawer-in">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
            <div>
              <span className="font-sub text-[10px] text-amber-700 dark:text-amber-400 uppercase tracking-widest block">
                Player Profile Dossier
              </span>
              <h2 className="font-heading text-xl text-slate-900 dark:text-slate-100">
                {player.name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center min-h-10 min-w-10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* 3D Flip Card Container */}
          <div className="perspective-1000 mb-6">
            <div
              className={`relative w-full aspect-[4/5] rounded-2xl transition-transform duration-400 transform-style-3d ${
                isFlipped ? "rotate-y-180" : ""
              }`}
            >
              {/* CARD FRONT: Official Save Data */}
              <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-slate-700/80 rounded-2xl p-6 flex flex-col justify-between backface-hidden shadow-2xl">
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <PlayerFace eaPlayerId={player.eaPlayerId} name={player.name} size={64} />
                      <div className="min-w-0">
                        <span className="font-heading text-5xl text-amber-400 font-bold block leading-none tabular-nums">
                          {player.overallRating}
                        </span>
                        <span className="font-sub text-xs text-emerald-400 uppercase tracking-wider font-bold">
                          POT: {player.potentialRating}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-sub text-xs text-slate-400 block">Age</span>
                      <span className="font-heading text-lg text-slate-200 tabular-nums">
                        {player.age ?? "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Player Key Metrics */}
                  <div className="mt-8 space-y-3 font-sans">
                    <div className="flex justify-between border-b border-slate-800/80 pb-2 text-xs">
                      <span className="text-slate-400">Position</span>
                      <span
                        className={`font-bold font-sub uppercase ${
                          (player.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION
                            ? "text-amber-400"
                            : "text-slate-100"
                        }`}
                      >
                        {(player.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION
                          ? "UNMAPPED - SET ON REVERSE"
                          : player.primaryPosition}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2 text-xs">
                      <span className="text-slate-400">Official Wage</span>
                      <span className="text-slate-100 font-bold">
                        £{player.wage ? player.wage.toLocaleString() : "0"}/wk
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-3 border-b border-slate-800/80 pb-2 text-xs">
                      <span
                        className="text-slate-400 shrink-0"
                        title="Derived from the transfer fees this world has actually paid. The save itself stores no player value."
                      >
                        Estimated value
                      </span>
                      {valuation?.available ? (
                        <span
                          className="text-right font-bold text-slate-100 tabular-nums"
                          title={`${formatMoneyExact(valuation.low)} to ${formatMoneyExact(valuation.high)}. ${valuation.explanation}`}
                        >
                          {formatMoney(valuation.low)} – {formatMoney(valuation.high)}
                          <span
                            className="ml-1.5 align-middle text-[9px] font-sub font-bold uppercase px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            title="Not a save fact. An estimate, so it is shown as a range."
                          >
                            Estimate
                          </span>
                          {valuation.extrapolated && (
                            <span
                              className="ml-1 align-middle text-[9px] font-sub font-bold uppercase px-1.5 py-0.5 rounded-md bg-slate-500/20 text-slate-300 border border-slate-500/40"
                              title="This player's wage sits outside the range the observed deals cover."
                            >
                              Extrapolated
                            </span>
                          )}
                        </span>
                      ) : (
                        <span
                          className="text-right text-slate-400 font-normal"
                          title={valuation?.reason ?? "No valuation available."}
                        >
                          No reliable estimate
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2 text-xs">
                      <span className="text-slate-400">Academy Status</span>
                      <span className="text-slate-100 font-bold">
                        {player.isYouthProspect ? "Youth Prospect" : "First Team"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/80 pb-2 text-xs">
                      <span className="text-slate-400">Data Source</span>
                      <span className="text-emerald-400 font-sub text-[10px] uppercase font-bold">
                        Career save
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setIsFlipped(true)}
                  className="w-full bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 text-slate-200 font-sub text-xs py-2.5 rounded-xl uppercase tracking-wider transition-[background-color,box-shadow,transform] duration-200 hover:shadow-lg active:scale-[0.96] cursor-pointer"
                >
                  Flip to Manager Assessment ↺
                </button>
              </div>

              {/* CARD BACK: Manager Notebook */}
              <div className="absolute inset-0 bg-slate-50 dark:bg-slate-950 border border-amber-500/60 rounded-2xl p-6 flex flex-col rotate-y-180 backface-hidden shadow-2xl">
                {/*
                  The card's height is fixed by the shell's `aspect-[4/5]`, so the fields scroll
                  instead of the layout pushing the Save button out of the padding. Before this the
                  button was positioned by `justify-between` inside a box too short for its
                  contents: adding one more field to the notebook - the role list - was enough to
                  shove it clean past the card's edge.

                  The header stays outside the scroller on purpose. It holds the only way back to
                  the front of the card, and a control that scrolls out of sight is a control the
                  manager has to hunt for.
                */}
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                    <span className="font-sub text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      Manager&apos;s Notebook
                    </span>
                    <button
                      onClick={() => setIsFlipped(false)}
                      className="text-xs font-sub text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                    >
                      ← Front
                    </button>
                  </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-3 text-left">
                    <div>
                      <label className="block font-sub text-[11px] text-slate-600 dark:text-slate-300 mb-1 font-semibold">
                        Position Override
                        {(player.primaryPosition || UNKNOWN_POSITION) === UNKNOWN_POSITION && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">
                            not in save, set manually
                          </span>
                        )}
                        {positionOverride && (
                          <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                            overrides {player.primaryPosition || UNKNOWN_POSITION}
                          </span>
                        )}
                      </label>
                      <select
                        value={positionOverride}
                        onChange={(e) => setPositionOverride(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 cursor-pointer"
                      >
                        <option value="">Use save value ({player.primaryPosition || UNKNOWN_POSITION})</option>
                        {KNOWN_POSITION_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="dossier-assigned-role"
                        className="block font-sub text-[11px] text-slate-600 dark:text-slate-300 mb-1 font-semibold"
                      >
                        Assigned Tactical Role
                        {group && (
                          <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                            {POSITION_GROUP_LABELS[group]} roles
                          </span>
                        )}
                      </label>
                      {/*
                        A controlled list rather than free text. The old box collected "9", "ten",
                        "CB" and "Backup RB" because it was the only place to put a position or a
                        squad status; those now have their own fields, so this one can mean one thing.

                        Other positions stay reachable under their own heading. A centre-back
                        stepping into midfield as an anchor, or a winger playing as a wide
                        midfielder, are both real - a list that refused them would be wrong more
                        often than it was tidy.
                      */}
                      <select
                        id="dossier-assigned-role"
                        value={assignedRole}
                        onChange={(e) => setAssignedRole(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 cursor-pointer"
                      >
                        <option value="">No role assigned</option>

                        {/* Anything the manager recorded before the list existed stays visible and
                            selectable, so it can be replaced on purpose rather than vanishing. */}
                        {assignedRole && !isKnownRole(assignedRole) && (
                          <optgroup label="Previously recorded">
                            <option value={assignedRole}>{assignedRole.trim()}</option>
                          </optgroup>
                        )}

                        <optgroup
                          label={group ? POSITION_GROUP_LABELS[group] : "All roles"}
                        >
                          {primary.map((role) => (
                            <option key={role.label} value={role.label}>
                              {role.label}
                            </option>
                          ))}
                        </optgroup>

                        {other.length > 0 && (
                          <optgroup label="Other positions">
                            {other.map((role) => (
                              <option key={role.label} value={role.label}>
                                {role.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {selectedRoleHint && (
                        <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                          {selectedRoleHint}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block font-sub text-[11px] text-slate-600 dark:text-slate-300 mb-1 font-semibold">
                        Trust Rating
                      </label>
                      <select
                        value={trustLevel}
                        onChange={(e) =>
                          setTrustLevel(e.target.value as "HIGH" | "MEDIUM" | "LOW")
                        }
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 cursor-pointer"
                      >
                        <option value="HIGH">High Trust</option>
                        <option value="MEDIUM">Medium Trust</option>
                        <option value="LOW">Low Trust</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-sub text-[11px] text-slate-600 dark:text-slate-300 mb-1 font-semibold">
                        Transfer Priority Marker
                      </label>
                      <select
                        value={importanceMarker}
                        onChange={(e) =>
                          setImportanceMarker(
                            e.target.value as
                              | "UNTOUCHABLE"
                              | "KEY_PLAYER"
                              | "ROTATION"
                              | "SURPLUS"
                          )
                        }
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 cursor-pointer"
                      >
                        <option value="UNTOUCHABLE">Untouchable</option>
                        <option value="KEY_PLAYER">Key Player</option>
                        <option value="ROTATION">Rotation</option>
                        <option value="SURPLUS">Surplus to Requirements</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block font-sub text-[11px] text-slate-600 dark:text-slate-300 font-semibold">
                          Observations & Notes
                        </label>
                        <span className="text-[10px] font-sub text-slate-400">
                          {userNotes.length} chars
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        placeholder="Add scouting observations, physical condition, renewal thoughts..."
                        value={userNotes}
                        onChange={(e) => setUserNotes(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 resize-none leading-relaxed"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  className="mt-4 w-full shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-950 font-heading text-xs py-2.5 rounded-xl uppercase font-bold transition-[background-color,box-shadow,transform] duration-200 hover:shadow-lg active:scale-[0.96] cursor-pointer"
                >
                  Save Assessment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}