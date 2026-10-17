"use client";

import React, { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Hint } from "@/components/ui/hint";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { KNOWN_POSITION_ROLES, UNKNOWN_POSITION } from "@/lib/parser/interface";
import {
  POSITION_GROUP_LABELS,
  TACTICAL_ROLES,
  isKnownRole,
  rolesForPosition,
} from "@/lib/tactics/roles";
import { PlayerFace } from "./player-face";
import { NationFlag } from "./nation-flag";
import { AttributeBars } from "./attribute-bars";
import type { PlayerValuation } from "@/lib/services/value-service";
import type { PlayerPerformance } from "@/lib/squad/performance";
import { RatingBadge, RatingSparkline } from "./rating-sparkline";
import { venueLabel } from "@/lib/ui/labels";
import { formatMoney, formatMoneyExact } from "@/lib/ui/format";
import {
  INJURY_DURATION_PRESETS,
  dayFrom,
  describeTimeOut,
  isInjured,
} from "@/lib/squad/injury";

interface PlayerDrawerProps {
  player: EnrichedPlayer | null;
  /**
   * DERIVED, and never part of the save. The save holds no player valuation at all, so this is
   * estimated from agreed transfer fees in this career and is labelled as an estimate on the card.
   */
  valuation?: PlayerValuation;
  /**
   * This season's record for him: the save's own match ratings, and the goals and assists the manager
   * logged. Absent when the career predates the feature, which reads as "nothing recorded yet" rather
   * than as zeroes.
   */
  performance?: PlayerPerformance | null;
  /**
   * Whether this dossier was opened from the match-stats table rather than from the squad list.
   *
   * The match record is a READING of the manager's own logged matches, and it belongs to the mode he
   * deliberately switched into rather than to every glance at a squad list. Opening a player to set his
   * assigned role does not need a form line in the way.
   */
  showMatchRecord?: boolean;
  /** The save's own clock, which every injury return date is measured against. */
  inGameDate?: string | null;
  onClose: () => void;
  onSaveProfile: (data: {
    eaPlayerId: number;
    assignedRole: string;
    trustLevel: "HIGH" | "MEDIUM" | "LOW";
    importanceMarker: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS";
    userNotes: string;
    /** Manual position override; null clears it. */
    primaryPosition: string | null;
    /** Return date, or null when he is fit again. */
    injuryUntil: string | null;
    injuryNote: string | null;
    /** The manager's own name for a player the save cannot name. Null clears it. */
    displayName: string | null;
  }) => void;
}

export function PlayerDrawer({
  player,
  valuation,
  performance = null,
  showMatchRecord = false,
  inGameDate = null,
  onClose,
  onSaveProfile,
}: PlayerDrawerProps) {
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
  const [injuryUntil, setInjuryUntil] = useState<string | null>(
    player?.userProfile?.injury.until ?? null
  );
  const [injuryNote, setInjuryNote] = useState<string>(player?.userProfile?.injury.note ?? "");
  const [displayName, setDisplayName] = useState<string>(player?.userProfile?.displayName ?? "");

  // This drawer is keyed by player id in `page.tsx`, so selecting a different player remounts the
  // component and every field below re-initialises from props. A sync effect here would be
  // redundant, and React flags setState-inside-an-effect for causing cascading renders.

  if (!player) return null;

  // The role list follows the position the manager is looking at, so changing the override above
  // immediately reshapes the roles offered below it.
  const effectivePosition = positionOverride || player.primaryPosition || UNKNOWN_POSITION;
  const { group, primary, other } = rolesForPosition(effectivePosition);
  const selectedRoleHint = TACTICAL_ROLES.find((role) => role.label === assignedRole)?.hint ?? null;

  //
  // Availability is a comparison against the save's own clock, not a stored flag, so a past return
  // date reads as fit without anyone clearing it. The switch below only writes the date.
  //
  const isOut = isInjured(
    { until: injuryUntil, note: injuryNote || null, reportedOn: null },
    inGameDate
  );
  const timeOut = isOut ? describeTimeOut(injuryUntil, inGameDate) : null;

  /** Flipping it on lands on two weeks: the shortest absence that is really a report, and short enough to change. */
  const toggleAvailability = () => {
    if (isOut) {
      setInjuryUntil(null);
      setInjuryNote("");
      return;
    }
    const anchor = inGameDate ?? new Date().toISOString().slice(0, 10);
    setInjuryUntil(dayFrom(anchor, 14));
  };

  const handleSave = () => {
    onSaveProfile({
      eaPlayerId: player.eaPlayerId,
      assignedRole,
      trustLevel,
      importanceMarker,
      userNotes,
      primaryPosition: positionOverride || null,
      injuryUntil,
      injuryNote: injuryNote.trim() || null,
      displayName: displayName.trim() || null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300">
      {/* Click outside backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Drawer Container */}
      <div className="w-full max-w-md bg-white/95 dark:bg-slate-900/95 border-l border-slate-200 dark:border-slate-800 shadow-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] flex flex-col justify-between overflow-y-auto overscroll-contain animate-drawer-in">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
            <div>
              <span className="font-sub text-[10px] text-amber-700 dark:text-amber-400 uppercase tracking-widest block">
                Player Profile Dossier
              </span>
              <h2 className="font-heading text-xl text-slate-900 dark:text-slate-100">
                {displayName.trim() || player.name}
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
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 text-xs">
                      <span className="text-slate-400">Nationality</span>
                      <span className="flex items-center gap-2">
                        <NationFlag nationId={player.nationalityId} name={player.nationality} height={13} />
                        {player.nationality ? (
                          <span className="font-bold text-slate-100">{player.nationality}</span>
                        ) : (
                          /*
                           * Two different silences, and they must not read as one. A save that carries
                           * no nationality at all says so; a save that carries a code our country table
                           * does not name says THAT instead of claiming the save is empty, which would be
                           * a false statement about the manager's own file. The flag still renders for the
                           * latter, because the code is real and the CDN serves it.
                           */
                          <span
                            className="text-slate-500"
                            title={
                              player.nationalityId === null
                                ? "Your save records no nationality for this player."
                                : `Your save records nationality code ${player.nationalityId}, which this build's country list does not name.`
                            }
                          >
                            {player.nationalityId === null ? "Not in this save" : "Recorded, not named here"}
                          </span>
                        )}
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
                        className="flex shrink-0 items-center gap-1 text-slate-400"
                        title="Derived from the transfer fees this world has actually paid. The save itself stores no player value."
                      >
                        Estimated value
                        <Hint label="the estimated value">
                          Derived from the transfer fees this world has actually paid. The save
                          itself stores no player value, so this is a range rather than a fact.
                          {valuation?.available
                            ? ` ${formatMoneyExact(valuation.low)} to ${formatMoneyExact(valuation.high)}. ${valuation.explanation}`
                            : ""}
                        </Hint>
                      </span>
                      {valuation?.available ? (
                        <span className="text-right font-bold text-slate-100 tabular-nums">
                          {formatMoney(valuation.low)} – {formatMoney(valuation.high)}
                          <span className="ml-1.5 align-middle text-[9px] font-sub font-bold uppercase px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            Estimate
                          </span>
                          {valuation.extrapolated && (
                            <span className="ml-1 align-middle text-[9px] font-sub font-bold uppercase px-1.5 py-0.5 rounded-md bg-slate-500/20 text-slate-300 border border-slate-500/40">
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

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
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

                    {/*
                      Availability, as a switch rather than two date fields.

                      The save's own `injury` column read 0 for every player on the reference
                      career, so there is nothing to read and nothing to derive: the manager is the
                      only source, exactly as he is for the transfer budget. He flips this and picks
                      a duration, and the return date is worked out from the save's clock.

                      It is a switch and not a status dropdown because availability is binary in the
                      only place it matters: a player can be picked, or he cannot. How long is a
                      second question, asked only once the first one is answered.
                    */}
                    <div>
                      <label className="mb-1 block font-sub text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Availability
                        {inGameDate && (
                          <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                            save date {inGameDate}
                          </span>
                        )}
                      </label>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOut}
                        onClick={toggleAvailability}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors active:scale-[0.98] ${
                          isOut
                            ? "border-rose-300 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10"
                            : "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                        }`}
                      >
                        <span className="min-w-0">
                          <span
                            className={`block font-sub text-[11px] font-bold uppercase tracking-wider ${
                              isOut
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-emerald-700 dark:text-emerald-300"
                            }`}
                          >
                            {isOut ? "Out injured" : "Fit to play"}
                          </span>
                          <span className="block truncate text-[10px] text-slate-600 dark:text-slate-400">
                            {isOut
                              ? [timeOut, injuryUntil ? `back ${injuryUntil}` : null]
                                  .filter(Boolean)
                                  .join(", ")
                              : "Available to be picked"}
                          </span>
                        </span>
                        <span
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            isOut ? "bg-rose-500" : "bg-emerald-500/40"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              isOut ? "translate-x-[1.15rem]" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                      </button>

                      {isOut && (
                        <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
                          <span className="block font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            How long is he out?
                          </span>

                          {inGameDate ? (
                            <div className="grid grid-cols-3 gap-1.5">
                              {INJURY_DURATION_PRESETS.map((preset) => {
                                const until = dayFrom(inGameDate, preset.days);
                                const isPicked = until !== null && until === injuryUntil;
                                return (
                                  <button
                                    key={preset.key}
                                    type="button"
                                    onClick={() => until && setInjuryUntil(until)}
                                    className={`cursor-pointer rounded-lg border px-1 py-1.5 text-[10px] font-sub transition-colors ${
                                      isPicked
                                        ? "border-amber-500 bg-amber-500/15 font-bold text-amber-700 dark:text-amber-400"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            /* No save clock to count from, so the date is asked for plainly. */
                            <DatePicker
                              value={injuryUntil}
                              onChange={setInjuryUntil}
                              placeholder="Pick the return date"
                            />
                          )}

                          <input
                            type="text"
                            placeholder="What is it? Hamstring, knock in training..."
                            value={injuryNote}
                            onChange={(e) => setInjuryNote(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                      )}
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
                          Name
                        </label>
                        <span className="text-[10px] font-sub text-slate-400">
                          {displayName.trim().length > 0 ? "yours" : "from the save"}
                        </span>
                      </div>
                      {/*
                        For a player the save cannot name. One academy prospect resolves from nowhere, because the
                        id table covering the low half of the nameid space is absent from the career save and from
                        every Squads file on this machine. The manager can see him, so he can name him, and this is
                        stored on his own profile rather than on the academy row, which the sync rewrites.
                      */}
                      <input
                        type="text"
                        maxLength={60}
                        placeholder={player.name ?? "Type the name you know him by"}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-400"
                      />
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

          {/*
            The match record, above the raw attributes: what he has actually done this season is the
            thing a manager opens a dossier to find out, and the face stats below it are reference.
            The save supplies the ratings; the manager supplies the goals and assists, because the save
            records no scorer for anything.
          */}
          {showMatchRecord && performance && (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Form
                </h3>
                {performance.appearances > 0 && (
                  <span className="font-sub text-[10px] uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
                    {performance.appearances} rated · {performance.minutes} mins
                  </span>
                )}
              </div>

              {/* The line is built from the manager's own logged matches, so every point on it is a match
                  he can name. See `RatingSparkline`: it says plainly when there are not three of those yet
                  rather than drawing an axis with nothing on it. */}
              <RatingSparkline
                matches={performance.recentMatches}
                className="font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-300"
              />

              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div>
                  <dt className="font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Average
                  </dt>
                  <dd className="mt-1">
                    {performance.averageRating === null ? (
                      <span className="font-sub text-xs text-slate-400 dark:text-slate-500">-</span>
                    ) : (
                      <RatingBadge rating={performance.averageRating} />
                    )}
                  </dd>
                </div>
                <div>
                  <dt
                    className="flex items-center gap-1 font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    title="Goals you logged in a match debrief. The save records no scorer."
                  >
                    Goals
                    <Hint label="goals">
                      Goals you logged in a match debrief. The save records no scorer.
                    </Hint>
                  </dt>
                  <dd className="mt-1 font-heading text-lg tabular-nums text-slate-900 dark:text-slate-100">
                    {performance.goals}
                  </dd>
                </div>
                <div>
                  <dt
                    className="flex items-center gap-1 font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    title="Assists you logged in a match debrief."
                  >
                    Assists
                    <Hint label="assists">Assists you logged in a match debrief.</Hint>
                  </dt>
                  <dd className="mt-1 font-heading text-lg tabular-nums text-slate-900 dark:text-slate-100">
                    {performance.assists}
                  </dd>
                </div>
              </dl>

              {performance.recentMatches.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-200 pt-3 dark:border-slate-800">
                  {performance.recentMatches.map((match) => (
                    <li
                      key={`${match.date}-${match.rating}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0 font-sans text-xs text-slate-700 dark:text-slate-200">
                        <span className="min-w-0 flex-1 break-words">{match.opponent}</span>
                        {match.venue && (
                          <span className="ml-1.5 font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            {venueLabel(match.venue)}
                          </span>
                        )}
                        {match.scoreline && (
                          <span className="ml-1.5 font-sub text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                            {match.scoreline}
                          </span>
                        )}
                        <span className="ml-1.5 tabular-nums text-slate-400 dark:text-slate-500">
                          {match.date}
                        </span>
                      </span>
                      <RatingBadge rating={match.rating} />
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-3 font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                The ratings are your save&apos;s own; the opponent, the venue and the score are what you
                logged. A match you did not log is not on the line, because it is not a match you can name.
              </p>
            </section>
          )}

          {/* Every face stat, grouped as the game groups them, BELOW the notebook. The card is what
              the manager acts on; the numbers are reference he consults after it. Read from the
              world pool by EA player id - the squad table carries no attribute column. */}
          {player.attributes && (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <h3 className="mb-3 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Attributes
              </h3>
              <AttributeBars attributes={player.attributes} position={player.primaryPosition} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}