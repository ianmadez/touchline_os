"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

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
  /** Optional `data-tour` anchor on this button, so the onboarding tour can point at one tab. */
  tour?: string;
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

/**
 * One row of tabs that scrolls sideways on a phone instead of wrapping into a ragged block.
 *
 * Wrapping was the real defect: with three or four long labels the strip became two rows of
 * different widths, the active pill sat on a line of its own, and the control read as broken.
 * A single scrolling row of compact segments keeps the section's navigation looking like
 * navigation, and the fade plus chevron on the right edge is the only cue needed that there is
 * more along the track. The strip also brings the selected tab into view when it is offscreen,
 * because a section restores its last tab and that tab may be the one past the right edge.
 *
 * All of it is `max-md`: at 768 and above the strip keeps wrapping exactly as it did, which is
 * what the desktop screenshots are measured against.
 */
/**
 * The box an inner tab strip or a small segmented toggle sits in.
 *
 * Two layers in both themes: a thin outline and a fill that is not the card's own. The dark half of that
 * lives in `globals.css` as `.tl-toggle-box`, because the dark overrides there are `!important` and would
 * win over any `dark:` utility written here.
 *
 * Shared rather than repeated so the strip in Debrief, the one in the trophy cabinet and the small
 * toggles beside a form cannot drift apart again.
 */
export const TOGGLE_BOX_CLASS = "tl-toggle-box border border-slate-200 bg-slate-100";

/** The same two layers, for the fills that fade a scrolling track at its edges. */
const TOGGLE_BOX_FADE = "from-slate-100 dark:from-slate-800";
const TOGGLE_BOX_FADE_SOFT = "via-slate-100/90 dark:via-slate-800/90";

export function TabStrip({
  children,
  className = "",
  tour,
  label,
  activeKey,
}: {
  children: React.ReactNode;
  className?: string;
  tour?: string;
  label?: string;
  /** Changes when the selection changes, so the strip scrolls the new tab into view. */
  activeKey?: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const node = track.current;
    if (!node) return;
    const remaining = node.scrollWidth - node.clientWidth - node.scrollLeft;
    const next = { left: node.scrollLeft > 2, right: remaining > 2 };
    setEdges((current) =>
      current.left === next.left && current.right === next.right ? current : next
    );
  }, []);

  useEffect(() => {
    measure();
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  // Only when the selection changes: re-running on every render would drag the track back while the
  // manager is scrolling it by hand.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const active = node.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) return;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < node.scrollLeft) {
      node.scrollTo({ left: Math.max(0, start - 12), behavior: "instant" });
    } else if (end > node.scrollLeft + node.clientWidth) {
      node.scrollTo({ left: end - node.clientWidth + 12, behavior: "instant" });
    }
  }, [activeKey]);

  return (
    <div
      data-tour={tour}
      className={`relative min-w-0 max-w-full rounded-xl ${TOGGLE_BOX_CLASS} ${className}`}
    >
      <div
        ref={track}
        role="tablist"
        aria-label={label}
        onScroll={measure}
        className="no-scrollbar flex flex-wrap items-center gap-1.5 p-1.5 max-md:flex-nowrap max-md:scroll-px-2 max-md:overflow-x-auto max-md:overscroll-x-contain"
      >
        {children}
      </div>
      {edges.left && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-6 rounded-l-xl bg-gradient-to-r ${TOGGLE_BOX_FADE} to-transparent md:hidden`}
        />
      )}
      {edges.right && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-end rounded-r-xl bg-gradient-to-l ${TOGGLE_BOX_FADE} ${TOGGLE_BOX_FADE_SOFT} to-transparent pr-1.5 text-slate-400 md:hidden dark:text-slate-400`}
        >
          <Chevron />
        </span>
      )}
      {edges.left && !edges.right && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end rounded-r-xl bg-gradient-to-l ${TOGGLE_BOX_FADE} to-transparent pr-1.5 text-slate-400 md:hidden dark:text-slate-400`}
        >
          <Chevron flipped />
        </span>
      )}
    </div>
  );
}

function Chevron({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 ${flipped ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** The compact segment every strip uses on a phone, so all of them stay the same height. */
export const TAB_SEGMENT_CLASS =
  "max-md:min-h-9 max-md:shrink-0 max-md:whitespace-nowrap max-md:px-3 max-md:py-1.5 max-md:text-[11px] max-md:tracking-normal";

export function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
  action,
  className = "",
  tour,
}: SubTabsProps<T>) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <TabStrip tour={tour} activeKey={active} className="max-md:w-full">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-compact
              data-tour={tab.tour}
              data-subtab={tab.id}
              onClick={() => onChange(tab.id)}
              className={`${TAB_SEGMENT_CLASS} flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-sub text-xs font-bold uppercase tracking-wider transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-brand)] ${
                isActive
                  ? "bg-[#E11D48] text-white shadow-sm shadow-rose-600/20"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {tab.label}
              {tab.badge ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums max-md:px-1 max-md:text-[9px] ${
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
      </TabStrip>
      {action}
    </div>
  );
}
