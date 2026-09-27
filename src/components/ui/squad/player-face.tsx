"use client";

import React, { useState } from "react";

/**
 * Derives initials for the fallback disc: "C. Patiño" and "Ronan Darcy" both give two letters.
 */
function initialsFor(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/[\s.]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface PlayerFaceProps {
  eaPlayerId: number;
  name: string;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
}

/**
 * A player's face, with a deliberate fallback.
 *
 * Roughly a third of a real squad has no sprite - newgens never do - so the fallback is not an edge
 * case, it is a normal state and has to look intentional. It is a initials disc built from the
 * same geometry as the image, so a squad that is half newgens reads as a design choice rather than
 * a wall of broken images. The disc is `aria-hidden` because the name is always adjacent.
 *
 * The sprite is loaded lazily and never blocks render: a face that is missing or fails simply
 * swaps to the disc, which is why no server route is needed to serve them.
 */
export function PlayerFace({ eaPlayerId, name, size = 40, className = "" }: PlayerFaceProps) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  // Pure black at 10% in light mode and pure white at 10% in dark, never a tinted neutral: a tinted
  // outline picks up the surface underneath and reads as dirt on the edge.
  const ring = "ring-1 ring-black/10 dark:ring-white/10";

  if (failed || !Number.isFinite(eaPlayerId) || eaPlayerId <= 0) {
    return (
      <span
        aria-hidden="true"
        style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.36)) }}
        className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-heading text-slate-600 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300 ${ring} ${className}`}
      >
        {initialsFor(name)}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/faces/${eaPlayerId}.png`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={box}
      className={`shrink-0 rounded-full bg-slate-100 object-cover dark:bg-slate-800 ${ring} ${className}`}
    />
  );
}
