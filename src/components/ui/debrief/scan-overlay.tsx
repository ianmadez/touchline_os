"use client";

import React from "react";
import type { OcrWord } from "@/lib/ocr/engine";
import type { TableRegion } from "@/lib/ocr/preprocess";

/**
 * The screenshot, with the words that produced one figure drawn over them.
 *
 * The overlay exists to make a read checkable rather than to be looked at. A manager who sees "158" and a
 * rectangle sitting on the wrong row knows immediately which of the two is wrong, and that costs one glance
 * instead of comparing two screens. So the highlight is the only decoration here: the rest of the image is
 * dimmed rather than annotated, and nothing is labelled on the image itself.
 *
 * Word boxes arrive in the prepared table's coordinates, which are cropped to `region` and scaled by `scale`,
 * so every box is mapped back to the original image before it is drawn. On a 4K capture the scale is well
 * under one along both axes and drawing the raw boxes would pile them all into the top left corner.
 */
export interface ScanOverlayProps {
  /** An object URL for the image the manager chose. Revoked by the pane, not here. */
  src: string;
  /** The words to highlight. Empty draws the image plain, at full brightness. */
  words: readonly OcrWord[];
  /**
   * Where the table was, and what it was scaled to, or null when no read produced a value to place.
   *
   * Absent rather than zeroed: a read that failed has no rectangle, and drawing a box at 0,0 to say so would look
   * like a highlight that missed.
   */
  frame: { region: TableRegion; scale: number; width: number; height: number } | null;
  /** What the highlight is over, for the screen reader. The image itself is decorative. */
  label: string;
}

/** One word's box, as percentages of the image, so the overlay scales with the image. */
function asPercent(word: OcrWord, region: TableRegion, scale: number, width: number, height: number) {
  return {
    left: ((region.left + word.x0 / scale) / width) * 100,
    top: ((region.top + word.y0 / scale) / height) * 100,
    right: ((region.left + word.x1 / scale) / width) * 100,
    bottom: ((region.top + word.y1 / scale) / height) * 100,
  };
}

export function ScanOverlay({ src, words, frame, label }: ScanOverlayProps) {
  const boxes =
    frame === null
      ? []
      : words.map((word, index) => {
          const box = asPercent(word, frame.region, frame.scale, frame.width, frame.height);
          return { key: `${word.text}-${index}`, ...box };
        });

  const band =
    boxes.length === 0
      ? null
      : {
          left: Math.min(...boxes.map((box) => box.left)),
          top: Math.min(...boxes.map((box) => box.top)),
          right: Math.max(...boxes.map((box) => box.right)),
          bottom: Math.max(...boxes.map((box) => box.bottom)),
        };

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={`block w-full transition-opacity duration-150 ${band ? "opacity-60" : "opacity-100"}`}
      />
      {band ? (
        <div
          className="pointer-events-none absolute rounded border-2 border-[#E11D48] bg-[#E11D48]/10 transition-[left,top,width,height] duration-150 ease-[var(--ease-brand)]"
          style={{
            left: `${band.left}%`,
            top: `${band.top}%`,
            width: `${Math.max(0, band.right - band.left)}%`,
            height: `${Math.max(0, band.bottom - band.top)}%`,
          }}
        >
          {boxes.map((box) => (
            <span
              key={box.key}
              className="absolute rounded-sm bg-[#E11D48]/25"
              style={{
                left: `${((box.left - band.left) / Math.max(0.0001, band.right - band.left)) * 100}%`,
                top: `${((box.top - band.top) / Math.max(0.0001, band.bottom - band.top)) * 100}%`,
                width: `${((box.right - box.left) / Math.max(0.0001, band.right - band.left)) * 100}%`,
                height: `${((box.bottom - box.top) / Math.max(0.0001, band.bottom - band.top)) * 100}%`,
              }}
            />
          ))}
        </div>
      ) : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}
