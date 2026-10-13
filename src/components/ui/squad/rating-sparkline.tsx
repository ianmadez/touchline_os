"use client";

import React from "react";

import {
  MIN_RATINGS_FOR_TREND,
  RATING_AXIS_MAX,
  RATING_AXIS_MIN,
  formatRating,
  ratingBand,
  ratingBandClasses,
  ratingBandDotClasses,
  type PlayerRatingPoint,
} from "@/lib/squad/performance";

/**
 * A player's match ratings as a line, oldest on the left.
 *
 * Drawn as an SVG polyline rather than a CSS bar column, which is what the rest of the app's charts are.
 * The reason is the question this answers: form is a SHAPE over time - a run of 7s with one 9 in it
 * reads completely differently as a line than as eight bars, and the dossier is where a manager decides
 * whether a player is coming back or going away.
 *
 * The axis is FIXED at 4 to 10 rather than fitted to the player's own range. A fitted axis makes a
 * mediocre run and a brilliant one look identical, which is exactly the misreading this panel exists to
 * prevent. The two guide lines are the badge boundaries, so the colours of the points mean the same
 * thing as the colours of the badges beside them.
 *
 * No chart library: the geometry is arithmetic on a fixed viewBox, and Tailwind classes carry the
 * colour. Fewer than three ratings is not a trend, so it is not drawn at all - the caller says so
 * instead.
 */
export function RatingSparkline({
  ratings,
  className = "",
}: {
  /** Newest first, as the service returns them. */
  ratings: PlayerRatingPoint[];
  className?: string;
}) {
  const points = React.useMemo(() => [...ratings].reverse(), [ratings]);
  if (points.length < MIN_RATINGS_FOR_TREND) return null;

  const width = 240;
  const height = 64;
  const padX = 8;
  const padY = 10;
  const span = RATING_AXIS_MAX - RATING_AXIS_MIN;

  const xAt = (index: number): number =>
    points.length === 1 ? width / 2 : padX + (index * (width - padX * 2)) / (points.length - 1);
  const yAt = (rating: number): number => {
    const clamped = Math.min(RATING_AXIS_MAX, Math.max(RATING_AXIS_MIN, rating));
    return padY + (1 - (clamped - RATING_AXIS_MIN) / span) * (height - padY * 2);
  };

  const coordinates = points.map((point, index) => `${xAt(index)},${yAt(point.rating)}`).join(" ");

  return (
    <div className={className}>
      <svg
        role="img"
        aria-label={`Match ratings, oldest to newest: ${points.map((point) => formatRating(point.rating)).join(", ")}`}
        viewBox={`0 0 ${width} ${height}`}
        className="h-16 w-full"
        preserveAspectRatio="none"
      >
        {/* The badge boundaries, so a point's colour is readable without a legend. */}
        {[6, 7.5].map((line) => (
          <line
            key={line}
            x1={0}
            x2={width}
            y1={yAt(line)}
            y2={yAt(line)}
            strokeDasharray="3 4"
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth={1}
          />
        ))}
        <polyline
          points={coordinates}
          fill="none"
          strokeWidth={1.75}
          className="stroke-slate-400 dark:stroke-slate-500"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.date}-${index}`}
            cx={xAt(index)}
            cy={yAt(point.rating)}
            r={2.75}
            className={ratingBandDotClasses(ratingBand(point.rating))}
          >
            <title>{`${point.date}: ${formatRating(point.rating)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-sub text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
        <span>Oldest</span>
        <span>{points.length} matches</span>
        <span>Latest</span>
      </div>
    </div>
  );
}

/**
 * A rating as a number, in the band's colour.
 *
 * A number rather than a bar: a match rating is a figure a manager reads and quotes ("he was a 7.8"),
 * and the colour is the only part that is a judgement.
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
