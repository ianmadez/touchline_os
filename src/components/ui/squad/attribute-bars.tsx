"use client";

import React from "react";

/**
 * The face stats, grouped exactly as the game groups them.
 *
 * Shared by the scouting dossier and the squad drawer so one player's numbers read identically
 * wherever he is looked at. Before this the groups and the colour scale were declared inside the
 * scouting search, which meant the squad had no way to show the same detail without a second,
 * drifting copy of both.
 */

export interface AttributeGroupView {
  key: string;
  label: string;
  fields: ReadonlyArray<{ key: string; label: string }>;
}

/**
 * Goalkeeping is last, and it is the reason the group list is not just the six outfield faces: the
 * panel only renders a group that actually has numbers in it, so without this entry a keeper's
 * dossier showed no attributes whatsoever.
 */
export const ATTRIBUTE_GROUPS: ReadonlyArray<AttributeGroupView> = [
  {
    key: "pace",
    label: "Pace",
    fields: [
      { key: "acceleration", label: "Acceleration" },
      { key: "sprintSpeed", label: "Sprint Speed" },
    ],
  },
  {
    key: "shooting",
    label: "Shooting",
    fields: [
      { key: "positioning", label: "Positioning" },
      { key: "finishing", label: "Finishing" },
      { key: "shotPower", label: "Shot Power" },
      { key: "longShots", label: "Long Shots" },
      { key: "volleys", label: "Volleys" },
      { key: "penalties", label: "Penalties" },
    ],
  },
  {
    key: "passing",
    label: "Passing",
    fields: [
      { key: "vision", label: "Vision" },
      { key: "crossing", label: "Crossing" },
      { key: "freeKickAccuracy", label: "FK Accuracy" },
      { key: "shortPassing", label: "Short Pass" },
      { key: "longPassing", label: "Long Pass" },
      { key: "curve", label: "Curve" },
    ],
  },
  {
    key: "dribbling",
    label: "Dribbling",
    fields: [
      { key: "agility", label: "Agility" },
      { key: "balance", label: "Balance" },
      { key: "reactions", label: "Reactions" },
      { key: "ballControl", label: "Ball Control" },
      { key: "dribbling", label: "Dribbling" },
      { key: "composure", label: "Composure" },
    ],
  },
  {
    key: "defending",
    label: "Defending",
    fields: [
      { key: "interceptions", label: "Interceptions" },
      { key: "headingAccuracy", label: "Heading Acc." },
      { key: "defensiveAwareness", label: "Def. Aware." },
      { key: "standingTackle", label: "Standing Tackle" },
      { key: "slidingTackle", label: "Sliding Tackle" },
    ],
  },
  {
    key: "physical",
    label: "Physical",
    fields: [
      { key: "jumping", label: "Jumping" },
      { key: "stamina", label: "Stamina" },
      { key: "strength", label: "Strength" },
      { key: "aggression", label: "Aggression" },
    ],
  },
  {
    key: "goalkeeping",
    label: "Goalkeeping",
    fields: [
      { key: "diving", label: "Diving" },
      { key: "handling", label: "Handling" },
      { key: "kicking", label: "Kicking" },
      { key: "positioning", label: "Positioning" },
      { key: "reflexes", label: "Reflexes" },
    ],
  },
];

/**
 * A sequence, not a traffic light.
 *
 * The old scale went straight to red below 50, so a perfectly ordinary lower-league squad rendered
 * as a wall of red - the same colour the app reserves for genuine errors - and the eye had nowhere
 * to settle. Weak-but-normal now reads as dim, developing as sky, strong as emerald. Nothing here is
 * an alarm.
 */
export function attributeTone(value: number | null): string {
  if (value === null) return "bg-slate-200 dark:bg-slate-800";
  if (value < 50) return "bg-slate-400 dark:bg-slate-600";
  if (value < 65) return "bg-sky-400 dark:bg-sky-500";
  if (value < 80) return "bg-emerald-500 dark:bg-emerald-500";
  return "bg-emerald-600 dark:bg-emerald-400";
}

/** Deliberately loose: the JSON comes out of storage, so callers pass whatever shape they hold. */
export type FaceStats = Record<string, unknown>;

/**
 * Every face stat that has a number, in the game's own groups. A group the save left empty is
 * skipped rather than rendered as a row of dashes.
 */
export function AttributeBars({
  attributes,
  position,
}: {
  attributes: FaceStats;
  /** Used only to decide whether the Goalkeeping block belongs on screen. */
  position?: string | null;
}) {
  // The save records goalkeeping numbers for EVERY player - a central midfielder carries Diving 14,
  // Handling 9 - so showing the group unconditionally buries a real outfield profile under five
  // meaningless single digits. It belongs to a keeper only. The keeper still gets the outfield
  // groups, because those numbers are real for him too.
  const isKeeper = (position ?? "").toUpperCase() === "GK";

  return (
    <div className="space-y-5">
      {ATTRIBUTE_GROUPS.map((group) => {
        if (group.key === "goalkeeping" && !isKeeper) return null;
        const bag = (attributes[group.key] ?? {}) as Record<string, unknown>;
        const hasAny = group.fields.some((field) => typeof bag[field.key] === "number");
        if (!hasAny) return null;
        return (
          <div key={group.key}>
            <h4 className="mb-2 font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {group.label}
            </h4>
            <ul className="space-y-1.5">
              {group.fields.map((field) => {
                const raw = bag[field.key];
                const value = typeof raw === "number" ? raw : null;
                return (
                  <li key={field.key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate font-sans text-dense text-slate-600 dark:text-slate-300">
                      {field.label}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <span
                        className={`block h-full rounded-full ${attributeTone(value)}`}
                        style={{ width: `${Math.max(2, Math.min(100, ((value ?? 0) / 99) * 100))}%` }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right font-sub text-dense font-bold text-slate-700 tabular-nums dark:text-slate-200">
                      {value ?? "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
