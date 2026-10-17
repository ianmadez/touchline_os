"use client";

import React from "react";
import { matchStatLabel } from "@/lib/ui/labels";
import {
  MATCH_STAT_KEYS,
  STAT_BOX_CLASS,
  type MatchStatDraft,
  type MatchStatKey,
  type StatSource,
} from "@/lib/ui/match-figures";
import { LOW_CONFIDENCE } from "@/lib/ocr/extract";

/**
 * What one of the five boxes has to show for itself.
 *
 * A box is filled from a screen's facts, so this is the REVIEW view of one figure: what was read, how sure the
 * read was, whether it was worked out from a sum rather than seen, and which image it came off.
 */
export interface BoxObservation {
  value: number;
  confidence: number;
  derived: boolean;
  imageIndex: number;
  words: import("@/lib/ocr/engine").OcrWord[];
  /** Set when the screen carried this figure but the read could not safely use it. */
  reason?: string | null;
}

/**
 * The figures, as the screenshot pane shows them.
 *
 * The same boxes the manual pane uses, with one question answered beside each: where did this come from? A
 * figure the manager typed is not touched and says so, a figure a read produced says which image it came off,
 * and a figure a read produced but could not safely use is offered rather than taken.
 *
 * The distinction that matters is between "not read" and "read but not used". A manager who is told the second
 * when the first is true goes looking for a problem with his screenshot that does not exist, so the two carry
 * different words and the same field is never described both ways at once.
 */
export interface ScanFieldsProps {
  draft: MatchStatDraft;
  sources: Record<MatchStatKey, StatSource>;
  /** What the reads produced, keyed by box. Absent means no read covered this figure. */
  observations: Map<MatchStatKey, BoxObservation>;
  /** Which boxes the screens that were read are meant to carry. */
  carried: ReadonlySet<string>;
  /** The figure whose words are being highlighted, if any. */
  activeKey: MatchStatKey | null;
  onFocusKey: (key: MatchStatKey | null) => void;
  onChange: (key: MatchStatKey, value: string) => void;
  /** Put a read value in a box it did not land in, because the manager asked. */
  onUseRead: (key: MatchStatKey) => void;
}

/** True when the box currently holds exactly what the read produced. */
function holdsReadValue(draft: MatchStatDraft, key: MatchStatKey, observation: BoxObservation | undefined): boolean {
  if (!observation) return false;
  return draft[key].trim() === String(observation.value);
}

/** The small right-hand chip, or null when there is nothing worth saying. */
function chipFor(input: {
  key: MatchStatKey;
  draft: MatchStatDraft;
  source: StatSource;
  observation: BoxObservation | undefined;
  carried: boolean;
}): { text: string; tone: "slate" | "amber" } | null {
  const { key, draft, source, observation, carried } = input;
  if (observation) {
    if (holdsReadValue(draft, key, observation)) {
      return {
        text: observation.derived ? "Worked out from the sums" : `Image ${observation.imageIndex}`,
        tone: observation.confidence < LOW_CONFIDENCE ? "amber" : "slate",
      };
    }
    return {
      text: `Read ${observation.value}`,
      tone: observation.confidence < LOW_CONFIDENCE ? "amber" : "slate",
    };
  }
  if (!carried) return null;
  if (source === "EDITED") return { text: "Already yours", tone: "slate" };
  // A figure the screen is meant to carry and nothing read. Said plainly, because "the scanner missed it" and
  // "the scanner was never going to see it" are different answers to the same silence.
  return { text: "Not read", tone: "slate" };
}

export function ScanFields({
  draft,
  sources,
  observations,
  carried,
  activeKey,
  onFocusKey,
  onChange,
  onUseRead,
}: ScanFieldsProps) {
  return (
    <ul className="space-y-2">
      {MATCH_STAT_KEYS.map((key) => {
        const observation = observations.get(key);
        const chip = chipFor({ key, draft, source: sources[key], observation, carried: carried.has(key) });
        const lowConfidence = observation !== undefined && observation.confidence < LOW_CONFIDENCE;
        const offersRead = observation !== undefined && !holdsReadValue(draft, key, observation);
        const decimal = key === "expectedGoalsReported";
        return (
          <li
            key={key}
            className={`rounded-xl border p-2.5 transition-colors duration-150 ${
              activeKey === key
                ? "border-[#E11D48] bg-[#E11D48]/5 dark:border-[#E11D48]"
                : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            }`}
          >
            <div className="flex items-start gap-3">
              <label className="w-24 shrink-0 pt-1" title={decimal ? "The game's own figure, if you can see it." : undefined}>
                <span className="block font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {matchStatLabel(key)}
                </span>
              </label>
              <input
                type="text"
                inputMode={decimal ? "decimal" : "numeric"}
                placeholder="–"
                aria-label={`${matchStatLabel(key)}, read from a screenshot`}
                value={draft[key]}
                onChange={(event) => onChange(key, event.target.value)}
                onFocus={() => onFocusKey(key)}
                onBlur={() => onFocusKey(null)}
                className={`mt-0 max-w-28 ${STAT_BOX_CLASS}`}
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 pt-1.5">
                {chip ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-sub text-[10px] uppercase tracking-wide ${
                      chip.tone === "amber"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {chip.text}
                  </span>
                ) : null}
                {offersRead ? (
                  <button
                    type="button"
                    onClick={() => onUseRead(key)}
                    className="cursor-pointer rounded px-1.5 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wide text-[#E11D48] underline decoration-dotted underline-offset-2 hover:text-rose-700 dark:hover:text-rose-400"
                  >
                    Use the read figure
                  </button>
                ) : null}
              </div>
            </div>
            {lowConfidence ? (
              <p className="mt-1.5 font-sans text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                Check this one: {observation?.reason ?? "the read was not clear."}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
