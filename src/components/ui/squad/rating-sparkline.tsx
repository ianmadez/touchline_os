"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MIN_LOGGED_MATCHES_FOR_TREND,
  RATING_AXIS_MAX,
  RATING_AXIS_MIN,
  formatRating,
  ratingBand,
  ratingBandClasses,
  ratingBandDotClasses,
  type PlayerRecentMatch,
} from "@/lib/squad/performance";

/**
 * A player's form, drawn from the matches the manager logged himself.
 *
 * WHY A LINE AND NOT BARS. The question is about direction - is he coming back or going away - and direction
 * is a shape. A run of sevens with one nine in it reads completely differently as a line than as eight bars,
 * and the dossier is where a manager decides whether to keep picking him.
 *
 * WHY THE AXIS IS FIXED at 4 to 10 rather than fitted to his own range: a fitted axis makes a mediocre run
 * and a brilliant one look identical, which is the one misreading this panel exists to prevent. The two
 * dashed rules are the badge boundaries, so a point's colour means the same thing as the badge beside it.
 *
 * WHY IT IS INTERACTIVE. A line can be a beautiful shape and still say nothing - the manager wants to know
 * WHICH match the dip was. So the whole plot is a pointer target: moving across it puts a guide on the
 * nearest match and names it, opponent and score included, because "6.0 against Luton" is a memory and
 * "6.0" is a number.
 *
 * Hand-rolled SVG, like every other chart in the app. No chart library: the geometry is arithmetic on a
 * fixed viewBox and every state is CSS.
 */
export function RatingSparkline({
  matches,
  className = "",
}: {
  /** The logged matches, newest first, as the service returns them. */
  matches: PlayerRecentMatch[];
  className?: string;
}) {
  /**
   * Oldest on the left, because time reads left to right.
   *
   * The service hands them over newest-first for the list beside this, and reversing here rather than at
   * the call site keeps the two orders from having to agree with each other.
   */
  const series = useMemo(() => [...matches].reverse(), [matches]);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /**
   * Whether the line has drawn itself in yet.
   *
   * A transition rather than a keyframe, so it can be interrupted by a re-render without snapping. Set from
   * a deferred tick because a synchronous setState in an effect body is a lint error here - and deferred is
   * also what makes this an ENTRANCE: the panel it lives in is only mounted when a player is pressed, so it
   * runs on that press rather than on page load.
   */
  const [drawn, setDrawn] = useState(false);
  const plot = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(true), 30);
    return () => window.clearTimeout(timer);
  }, []);

  const width = 320;
  const height = 104;
  const padX = 10;
  const padY = 14;
  const span = RATING_AXIS_MAX - RATING_AXIS_MIN;

  const xAt = useCallback(
    (index: number): number =>
      series.length <= 1 ? width / 2 : padX + (index * (width - padX * 2)) / (series.length - 1),
    [series.length]
  );
  const yAt = useCallback(
    (rating: number): number => {
      const clamped = Math.min(RATING_AXIS_MAX, Math.max(RATING_AXIS_MIN, rating));
      return padY + (1 - (clamped - RATING_AXIS_MIN) / span) * (height - padY * 2);
    },
    [span]
  );

  /**
   * The line as a smooth curve rather than a set of segments.
   *
   * Catmull-Rom control points converted to cubic beziers, with the tension pulled back to a sixth of the
   * gap so the curve cannot overshoot a real value: a form line that invents a 7.9 between two sevens is a
   * chart lying about the data it is drawn from. A flat run therefore stays flat and a spike stays a spike,
   * which is the whole point of reading form off a line.
   */
  const linePath = useMemo(() => {
    if (series.length === 0) return "";
    const points = series.map((match, index) => ({ x: xAt(index), y: yAt(match.rating) }));
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const before = points[index - 1] ?? current;
      const after = points[index + 2] ?? next;
      const c1x = current.x + (next.x - before.x) / 6;
      const c1y = current.y + (next.y - before.y) / 6;
      const c2x = next.x - (after.x - current.x) / 6;
      const c2y = next.y - (after.y - current.y) / 6;
      path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${next.x} ${next.y}`;
    }
    return path;
  }, [series, xAt, yAt]);

  const areaPath = useMemo(() => {
    if (series.length < 2) return "";
    const floor = height - padY;
    return `${linePath} L ${xAt(series.length - 1)} ${floor} L ${xAt(0)} ${floor} Z`;
  }, [linePath, series.length, xAt]);

  /** Which match the pointer is nearest, read off the plot's own box rather than from per-point hit areas. */
  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const box = plot.current?.getBoundingClientRect();
      if (!box || box.width === 0 || series.length === 0) return;
      const fraction = (event.clientX - box.left) / box.width;
      const index = Math.round(fraction * (series.length - 1));
      setActiveIndex(Math.min(series.length - 1, Math.max(0, index)));
    },
    [series.length]
  );

  const active = activeIndex === null ? null : (series[activeIndex] ?? null);

  // The gate counts the manager's own logged matches, and the message says which state he is in rather than
  // drawing an empty axis.
  if (matches.length < MIN_LOGGED_MATCHES_FOR_TREND) {
    return (
      <p className={className}>
        {matches.length === 0
          ? "You have not logged a match for him yet. Three logged matches is where a run of form becomes readable."
          : `${matches.length} logged ${matches.length === 1 ? "match" : "matches"} so far. Three is where a run of form becomes readable, so no line is drawn yet.`}
      </p>
    );
  }

  const newest = series[series.length - 1];
  const oldest = series[0];
  const trend = newest.rating - oldest.rating;

  return (
    <div className={className}>
      <svg
        ref={plot}
        role="img"
        aria-label={`Form across ${series.length} logged matches, oldest first: ${series
          .map((match) => formatRating(match.rating))
          .join(", ")}`}
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full touch-none select-none"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="form-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E11D48" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#E11D48" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The badge boundaries, so a point's colour is readable without a legend. */}
        {[6, 7.5].map((line) => (
          <line
            key={line}
            x1={padX / 2}
            x2={width - padX / 2}
            y1={yAt(line)}
            y2={yAt(line)}
            strokeDasharray="2 5"
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth={1}
          />
        ))}

        {/* The guide for the match under the pointer. Behind the line, so it never cuts it in half. */}
        {activeIndex !== null && (
          <line
            x1={xAt(activeIndex)}
            x2={xAt(activeIndex)}
            y1={padY / 2}
            y2={height - padY / 2}
            className="stroke-slate-400/70 dark:stroke-slate-500/70"
            strokeWidth={1}
          />
        )}

        {areaPath && (
          <path
            d={areaPath}
            fill="url(#form-fill)"
            className="transition-opacity duration-500 ease-out"
            style={{ opacity: drawn ? 1 : 0 }}
          />
        )}

        <path
          d={linePath}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-[#E11D48] transition-[stroke-dashoffset] duration-700 ease-out dark:stroke-[#FF8C7A]"
          style={{ strokeDasharray: 2000, strokeDashoffset: drawn ? 0 : 2000 }}
        />

        {series.map((match, index) => {
          const isActive = index === activeIndex;
          return (
            <circle
              key={`${match.date}-${index}`}
              cx={xAt(index)}
              cy={yAt(match.rating)}
              // The active point grows; every point fades in behind the drawn line.
              r={isActive ? 5 : 3.25}
              strokeWidth={isActive ? 2 : 1.5}
              className={`${
                isActive ? "stroke-white dark:stroke-slate-900" : "stroke-white/70 dark:stroke-slate-900/70"
              } transition-[r,opacity] duration-200 ease-out ${ratingBandDotClasses(ratingBand(match.rating))}`}
              style={{ opacity: drawn ? 1 : 0 }}
            />
          );
        })}
      </svg>

      {/* The reading sits BELOW the plot rather than floating over it: a tooltip that follows the pointer
          covers the next three points, which is exactly what the reader is trying to compare. */}
      <div className="mt-1.5 flex min-h-[2.25rem] items-center justify-between gap-3">
        <div className="min-w-0">
          {active ? (
            <p className="truncate font-sans text-xs text-slate-700 dark:text-slate-200">
              <span className="font-bold">{active.opponent}</span>
              {active.venue && (
                <span className="ml-1.5 font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {active.venue === "HOME" ? "Home" : active.venue === "AWAY" ? "Away" : "Neutral"}
                </span>
              )}
              {active.scoreline && (
                <span className="ml-1.5 font-sub text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                  {active.scoreline}
                </span>
              )}
              <span className="ml-1.5 tabular-nums text-slate-400 dark:text-slate-500">{active.date}</span>
            </p>
          ) : (
            <p className="font-sans text-xs text-slate-400 dark:text-slate-500">
              {series.length} logged {series.length === 1 ? "match" : "matches"}. Point at the line to name one.
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 font-sub text-[11px] font-bold tabular-nums ${
            active
              ? ratingBandClasses(ratingBand(active.rating))
              : "border-transparent text-slate-400 dark:text-slate-500"
          }`}
        >
          {active ? formatRating(active.rating) : `${trend > 0 ? "+" : ""}${formatRating(trend)}`}
        </span>
      </div>
    </div>
  );
}

/**
 * A rating as a number, in the band's colour.
 *
 * A number rather than a bar: a match rating is a figure a manager reads and quotes ("he was a 7.8"), and the
 * colour is the only part that is a judgement.
 */
export function RatingBadge({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <span
      className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-md border px-1.5 py-0.5 font-sub text-[11px] font-bold tabular-nums ${ratingBandClasses(ratingBand(rating))} ${className}`}
    >
      {formatRating(rating)}
    </span>
  );
}
