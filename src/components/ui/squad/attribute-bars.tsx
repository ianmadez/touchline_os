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
 * The colour ramp for one face stat, as a sequence of bands.
 *
 * Five steps, read low to high: dim slate, then the oranges warming up, then green for the range a
 * first-team player is actually expected to live in. It is deliberately NOT a traffic light - nothing
 * here ever reaches red, which the app reserves for genuine errors, because a lower-league squad is
 * full of perfectly ordinary 45s and dressing them as alarms made the whole panel unreadable.
 *
 * The bands are DATA, so they can be retuned in one place. `upTo` is exclusive, so band `40` starts
 * at 40 and the last band is open-ended.
 */
export interface AttributeBand {
  /** Exclusive upper bound. Null on the final band, which has no ceiling. */
  readonly upTo: number | null;
  readonly light: string;
  readonly dark: string;
  /** Read back by the legend, so the scale is never described twice. */
  readonly label: string;
}

export const ATTRIBUTE_BANDS: ReadonlyArray<AttributeBand> = [
  { upTo: 40, light: "bg-slate-400", dark: "dark:bg-slate-600", label: "Under 40" },
  { upTo: 50, light: "bg-orange-600", dark: "dark:bg-orange-600", label: "40 to 49" },
  { upTo: 60, light: "bg-orange-500", dark: "dark:bg-orange-500", label: "50 to 59" },
  { upTo: 70, light: "bg-orange-400", dark: "dark:bg-orange-400", label: "60 to 69" },
  { upTo: 80, light: "bg-emerald-400", dark: "dark:bg-emerald-500", label: "70 to 79" },
  { upTo: null, light: "bg-emerald-600", dark: "dark:bg-emerald-400", label: "80 and above" },
];

/** The band a value falls in. Null values get the inert track colour, which is not a band. */
export function attributeBand(value: number | null): AttributeBand | null {
  if (value === null) return null;
  return ATTRIBUTE_BANDS.find((band) => band.upTo === null || value < band.upTo) ?? null;
}

export function attributeTone(value: number | null): string {
  const band = attributeBand(value);
  if (!band) return "bg-slate-200 dark:bg-slate-800";
  return `${band.light} ${band.dark}`;
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
                    <span className="w-32 shrink-0 truncate font-sans text-dense text-slate-600 max-md:w-24 max-md:overflow-visible max-md:whitespace-normal dark:text-slate-300">
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
