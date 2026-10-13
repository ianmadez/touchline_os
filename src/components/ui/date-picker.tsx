"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * The date field, as a calendar this app draws itself.
 *
 * Replaces `<input type="date">`, which is the one control in the app that looked nothing like the rest of it:
 * the browser owns the calendar, so it arrives in the operating system's colours, its own font, its own
 * spacing, and it changes shape between Chrome, Edge and Firefox. A match date is the single most-typed field
 * in the diary and it sat in the middle of a form that is otherwise entirely house style.
 *
 * WHAT IT IS NOT is a date library. Every value crossing this boundary is the plain `YYYY-MM-DD` string the
 * database already stores, dates are split by hand rather than through `new Date(iso)` (which reads a bare date
 * as UTC and prints the previous day west of Greenwich), and the grid is arithmetic on the month's length. No
 * timezone, no locale lookup, no dependency.
 *
 * Weeks start on MONDAY, because this is a British football diary: a run of fixtures is read Monday to Sunday,
 * and a calendar that starts on Sunday puts the weekend across a fold.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday first, which is what `publishedOn` and every fixture list in the app are ordered by. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The earliest and latest year the header chevrons will walk to, as a guard against a stuck click. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

interface Parts {
  year: number;
  month: number;
  day: number;
}

/** Splits `YYYY-MM-DD` by hand. Anything else is not a date this control will claim to hold. */
function parseValue(value: string | null | undefined): Parts | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const pad = (value: number): string => String(value).padStart(2, "0");

const toValue = (parts: Parts): string =>
  `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;

/** Days in a month, the long way round, because February is not a fixed length. */
function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/** Sunday is 0 in the JavaScript weekday, and this grid starts on Monday. */
const mondayIndex = (weekday: number): number => (weekday + 6) % 7;

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  describedBy,
  className = "",
  disabled = false,
}: {
  id?: string;
  /** A plain `YYYY-MM-DD` string, or null for "nothing chosen yet". */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** The id of any help text or error beside the field, so the button is announced with it. */
  describedBy?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseValue(value);
  const today = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }, []);

  // The month the grid is SHOWING, which is not necessarily the month that is selected: the reader can page
  // away from his own date and back without changing the value.
  const [view, setView] = useState<{ year: number; month: number }>(() => ({
    year: (selected ?? today).year,
    month: (selected ?? today).month,
  }));

  const wrapper = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  /**
   * Whether the grid hangs below the field or above it.
   *
   * Decided WHEN IT OPENS rather than from a class, because whether there is room below depends on
   * where the field is on screen at that moment. The dossier is the case that forced this: its panel is
   * a scroll container, so a field near the bottom of it opened a calendar downwards into space that
   * was not there, and the reader had to scroll to see a control they had just opened.
   *
   * The measurement happens in the click handler, not in an effect, which is also why this does not
   * fight the rule against setting state inside one.
   */
  const [opensUpward, setOpensUpward] = useState(false);

  // Reopening lands on the month of the value, which is what a reader expects after picking one.
  const openCalendar = () => {
    const anchor = selected ?? today;
    setView({ year: anchor.year, month: anchor.month });
    const rect = trigger.current?.getBoundingClientRect() ?? null;
    if (rect) {
      // The panel is about 24rem tall including its header and footer; below that and it will not fit.
      const PANEL_HEIGHT = 384;
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpensUpward(spaceBelow < PANEL_HEIGHT && rect.top > spaceBelow);
    }
    setOpen(true);
  };

  /**
   * A popover that does not take the page with it.
   *
   * Closing on a click outside, on Escape, and on a scroll of anything behind it: a calendar anchored to a
   * field that has moved is worse than one that closes. Escape also returns focus to the trigger, so a
   * keyboard reader is not dropped at the top of the document.
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const raw = current.month + delta;
      const year = current.year + Math.floor((raw - 1) / 12);
      const month = ((((raw - 1) % 12) + 12) % 12) + 1;
      if (year < MIN_YEAR || year > MAX_YEAR) return current;
      return { year, month };
    });
  };

  const commit = (next: string | null) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const days = daysInMonth(view.year, view.month);
  // The blank cells before the 1st, so the 1st lands under its own weekday.
  const leading = mondayIndex(new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay());
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];

  const label = selected
    ? `${pad(selected.day)}/${pad(selected.month)}/${selected.year}`
    : placeholder;

  return (
    <div ref={wrapper} className={`relative ${className}`}>
      <button
        id={id}
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedBy}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left font-sub text-sm tabular-nums text-slate-900 transition-[border-color,background-color] duration-200 ease-[var(--ease-brand)] hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-700"
      >
        <span className={selected ? "" : "text-slate-400 dark:text-slate-500"}>{label}</span>
        {/* A drawn calendar rather than an emoji or a font glyph: one stroke weight, `currentColor`, and it
            lines up with the icon set the rest of the app uses. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
        >
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Choose a date"
          className={`animate-panel-in absolute left-0 z-50 w-[19rem] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 ${
            opensUpward ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.5rem)]"
          }`}
        >
          {/* Header: the month, with a year that can be stepped on its own so a career can jump a season. */}
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="font-heading text-sm uppercase tracking-[0.14em] text-slate-900 dark:text-slate-50">
                {MONTHS[view.month - 1]}
              </span>
              <span className="font-sub text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {view.year}
              </span>
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>

          {/* The double rule from the masthead, so the calendar reads as part of the paper's family. */}
          <div className="mt-2 border-t-2 border-[#E11D48]/70" />
          <div className="mt-[3px] border-t border-[#E11D48]/25" />

          <div className="mt-2 grid grid-cols-7 gap-y-1">
            {WEEKDAYS.map((weekday, index) => (
              <span
                key={weekday}
                className={`text-center font-sub text-[10px] font-bold uppercase tracking-wider ${
                  index >= 5 ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {weekday}
              </span>
            ))}

            {cells.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} aria-hidden="true" />;
              const isSelected =
                selected !== null &&
                selected.year === view.year &&
                selected.month === view.month &&
                selected.day === day;
              const isToday =
                today.year === view.year && today.month === view.month && today.day === day;
              const weekday = index % 7;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => commit(toValue({ year: view.year, month: view.month, day }))}
                  aria-label={`${day} ${MONTHS[view.month - 1]} ${view.year}`}
                  aria-current={isSelected ? "date" : undefined}
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg font-sub text-xs tabular-nums transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-brand)] cursor-pointer ${
                    isSelected
                      ? "bg-[#E11D48] font-bold text-white shadow-sm"
                      : isToday
                        ? "ring-1 ring-inset ring-[#E11D48]/50 text-[#E11D48] hover:bg-[#E11D48]/10 dark:text-[#FF8C7A]"
                        : weekday >= 5
                          ? "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                commit(toValue(today));
              }}
              className="inline-flex min-h-9 items-center rounded-lg px-2.5 font-sub text-[11px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => commit(null)}
              className="inline-flex min-h-9 items-center rounded-lg px-2.5 font-sub text-[11px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 cursor-pointer dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
