"use client";

import React from "react";

/**
 * The inner tab strip used inside a top-level section (Settings, Season, Debrief).
 *
 * Deliberately shipped as one shared component rather than re-styled per screen: these strips are
 * the app's only "you are here" affordance below the navbar, so if their weight, radius or active
 * treatment drifts between sections the whole navigation reads as inconsistent.
 */
export interface SubTabOption<T extends string> {
  id: T;
  label: string;
  /** Small right-hand count, e.g. how many entries the tab holds. Omitted when it adds nothing. */
  badge?: string;
}

interface SubTabsProps<T extends string> {
  tabs: ReadonlyArray<SubTabOption<T>>;
  active: T;
  onChange: (tab: T) => void;
  /** Right-aligned slot for the tab's primary action, keeping it on the strip's baseline. */
  action?: React.ReactNode;
  className?: string;
  /** Optional `data-tour` anchor, so the onboarding tour can point at this strip. */
  tour?: string;
}

export function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
  action,
  className = "",
  tour,
}: SubTabsProps<T>) {
  return (
    <div data-tour={tour} className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div
        role="tablist"
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-800 dark:bg-slate-950"
      >
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-sub text-xs font-bold uppercase tracking-wider transition-all ${
                isActive
                  ? "bg-[#E11D48] text-white shadow-sm shadow-rose-600/20"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {action}
    </div>
  );
}
