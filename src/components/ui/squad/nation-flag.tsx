"use client";

import React, { useEffect, useState } from "react";
import { fetchFlag, isUsableNationId } from "@/lib/services/nation-source";

/**
 * One session's worth of resolved flags.
 *
 * A flag never changes for a given nation id, and it is shared by every player of that nation, so a
 * blob URL is created once and kept. The in-flight map is the same guard the face URL resolver uses:
 * an academy list and a dossier can render the same nation in one tick, and without it both would miss
 * the cache and fetch the same 456 bytes twice.
 */
const objectUrls = new Map<number, string>();
const inFlight = new Map<number, Promise<string | null>>();

async function resolveFlag(nationId: number): Promise<string | null> {
  const bytes = await fetchFlag(nationId);
  if (!bytes) return null;

  // `Uint8Array.from` narrows to `Uint8Array<ArrayBuffer>`, which is what a Blob accepts.
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
  objectUrls.set(nationId, url);
  return url;
}

function flagUrl(nationId: number): Promise<string | null> {
  const cached = objectUrls.get(nationId);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(nationId);
  if (pending) return pending;

  const promise = resolveFlag(nationId).finally(() => inFlight.delete(nationId));
  inFlight.set(nationId, promise);
  return promise;
}

interface NationFlagProps {
  /** The save's own nationality code, exactly as the player row carries it. */
  nationId: number | null | undefined;
  /** The resolved country name. Never rendered here, only used where a description is needed. */
  name?: string | null;
  /** Rendered height in pixels. The flag's own 104x62 shape is kept. */
  height?: number;
  className?: string;
}

/**
 * A nation's flag, or nothing at all.
 *
 * Rendering NOTHING is the deliberate failure mode, and it is the difference between this and the
 * player-face disc. A face needs a fallback because it stands alone on the card - a missing one would
 * leave a hole. A flag never stands alone: the country name is always printed beside or beneath it, so
 * a flag that cannot be fetched removes decoration and loses no information. A placeholder here would
 * be an empty box claiming to be a picture, which is worse than the name on its own.
 *
 * The bytes come from an in-memory map rather than the network on every render, and the image is only
 * requested for nations actually on screen. Newgens and club-less players have no effect on this - it
 * is keyed by nation, not by player - so a squad of any size asks for at most one request per country.
 */
export function NationFlag({ nationId, name, height = 14, className = "" }: NationFlagProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isUsableNationId(nationId)) return;
    let cancelled = false;
    void flagUrl(nationId).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [nationId]);

  if (!isUsableNationId(nationId) || !src) return null;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={name ? `${name} flag` : ""}
      // The source is 104x62, so one dimension fixes the other and no layout shift is possible.
      style={{ height, width: Math.round((height * 104) / 62) }}
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-[2px] object-cover ring-1 ring-black/10 dark:ring-white/10 ${className}`}
    />
  );
}
