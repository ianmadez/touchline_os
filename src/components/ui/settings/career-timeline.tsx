"use client";

import React, { useMemo, useState } from "react";
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import { eventLabel } from "@/lib/ui/labels";
import { formatEventDate, provenanceLabel, summariseEvent } from "@/lib/ui/events";
import { IconClock } from "@/components/ui/icons";

/**
 * The career timeline.
 *
 * It used to be a top-level tab, but a flat reverse-chronological list with no filtering was too
 * thin to justify the screen estate - it now lives as an inner tab of Settings. The type filter is
 * the one piece of depth worth adding, because the three most common event types interleave heavily
 * once a save has run for a while.
 */
export function CareerTimeline({ events }: { events: ParsedCareerEvent[] }) {
  const [activeType, setActiveType] = useState<string>("ALL");

  // Ordered by frequency: the types a manager actually wants to isolate come first, and a
  // single-occurrence type does not get the same visual weight as a season's worth of signings.
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [events]);

  const visible = useMemo(
    () => (activeType === "ALL" ? events : events.filter((event) => event.eventType === activeType)),
    [events, activeType],
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl transition-colors">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          <IconClock className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          Career Timeline
        </h3>
        <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
          {visible.length} of {events.length} shown
        </span>
      </div>

      {events.length === 0 ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
          Nothing logged yet. Sync your save and the things that change - signings, ratings,
          budgets - will show up here.
        </p>
      ) : (
        <>
          {types.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <FilterChip
                active={activeType === "ALL"}
                label="All"
                count={events.length}
                onClick={() => setActiveType("ALL")}
              />
              {types.map(([type, count]) => (
                <FilterChip
                  key={type}
                  active={activeType === type}
                  label={eventLabel(type)}
                  count={count}
                  onClick={() => setActiveType(type)}
                />
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              Nothing of that type has been logged yet.
            </p>
          ) : (
            /* Internal scroll, matching the dashboard's storylines card: the card keeps its height
               and the feed scrolls inside it, however long a career runs. */
            <ol className="max-h-[560px] space-y-3 overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
              {visible.map((event) => (
                <li key={event.id} className="space-y-0.5 border-l-2 border-[#E11D48] py-1 pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
                      {eventLabel(event.eventType)}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-sub text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {provenanceLabel(event.source)}
                    </span>
                  </div>
                  <p className="font-sans text-xs text-slate-700 dark:text-slate-300">
                    {summariseEvent(event)}
                  </p>
                  <p className="font-sub text-[10px] text-slate-400 tabular-nums">
                    {formatEventDate(event.timestamp)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors ${
        active
          ? "border-[#E11D48] bg-rose-50 text-[#E11D48] dark:border-[#FF8C7A] dark:bg-rose-500/10 dark:text-[#FF8C7A]"
          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}
