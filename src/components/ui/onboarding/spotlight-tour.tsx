"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  getTourServerSnapshot,
  getTourSnapshot,
  markTourDone,
  subscribeTour,
  toursDoneFor,
} from "@/lib/session";

/**
 * Spotlight tours.
 *
 * One micro tour per primary tab, pointing at real controls through `data-tour` attributes. The page
 * is dimmed into a deep shadow and the one element under discussion is left clear and still usable, so
 * a step asks the manager to click the actual thing rather than to fill in a dummy form.
 *
 * Copy rules, deliberately enforced here rather than left to taste: no em dashes, no paragraphs, and
 * every line either says what something is or tells the manager what to click.
 */

/** Padding around the highlighted element, so the ring is not glued to the control. */
const SPOT_PAD = 8;
/** Tabs that never get a tour: the landing screen and the one-time setup flow. */
const NO_TOUR_TABS = new Set(["LANDING", "PORTAL", "TIMELINE"]);

export interface TourStep {
  /** Matches a `data-tour` attribute on the page. A step whose anchor is absent is skipped. */
  anchor: string;
  title: string;
  body: string;
}

const TOURS: Record<string, TourStep[]> = {
  DASHBOARD: [
    { anchor: "tab-DASHBOARD", title: "Your dashboard", body: "This is where the app opens after a sync." },
    { anchor: "dashboard-summary", title: "This is your season", body: "Played, points and goals, taken from your save." },
    { anchor: "dashboard-storylines", title: "Storylines", body: "These are threads that need a decision from you." },
  ],
  SEASON: [
    { anchor: "tab-SEASON", title: "The season tab", body: "This is where the season is tracked." },
    { anchor: "season-outlook", title: "Your record", body: "Points here are the save's own season total across all competitions." },
    { anchor: "season-vault", title: "The vault", body: "Every logged match joins the season story here." },
  ],
  DEBRIEF: [
    { anchor: "tab-DEBRIEF", title: "The debrief tab", body: "This is where you log a match." },
    { anchor: "debrief-form", title: "Log a match", body: "Pick the opponent, set the score, and add the date." },
    { anchor: "debrief-standouts", title: "Standout performers", body: "Click here to mark who played well. You can pick more than one." },
    { anchor: "debrief-contributions", title: "Goals and assists", body: "Add them here. Assists are optional." },
    { anchor: "debrief-history", title: "Your debriefs", body: "Every logged match sits here. Edit or delete any of them." },
  ],
  SQUAD: [
    { anchor: "tab-SQUAD", title: "The squad tab", body: "Every player the save has given you." },
    { anchor: "squad-table", title: "The squad list", body: "Click a column heading to sort. Click a player for their full profile." },
    { anchor: "squad-youth", title: "The academy", body: "Prospects from your youth setup appear here." },
  ],
  TACTICS: [
    { anchor: "tab-TACTICS", title: "The tactics tab", body: "This is the pitch your team lines up on." },
    { anchor: "tactics-bench", title: "The bench", body: "Click a player on the bench, then click a pitch slot to place him." },
  ],
  FINANCE: [
    { anchor: "tab-FINANCE", title: "The finance tab", body: "Where the money comes from and where it goes." },
    { anchor: "finance-summary", title: "This is the summary", body: "Transfer budget and wage budget, read from your save." },
  ],
  SETTINGS: [
    { anchor: "tab-SETTINGS", title: "Settings", body: "Everything that is about the app rather than your club." },
    { anchor: "settings-panel", title: "Preferences", body: "Theme, sync behaviour and your save file live here." },
    { anchor: "settings-timeline", title: "Career timeline", body: "This lists every recorded transition in your career." },
  ],
};

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SpotlightTourProps {
  /** Null until a career exists, so a tour never runs on the landing screen. */
  careerId: string | null;
  /** The tab currently on screen. */
  tab: string;
  /** False until setup is finished, so a tour never competes with the first run. */
  enabled: boolean;
}

/** Steps whose anchor is actually on the page. A missing anchor is skipped, never shown over nothing. */
function availableSteps(tab: string): TourStep[] {
  if (NO_TOUR_TABS.has(tab)) return [];
  return (TOURS[tab] ?? []).filter(
    (step) => document.querySelector(`[data-tour="${step.anchor}"]`) !== null
  );
}

export function SpotlightTour({ careerId, tab, enabled }: SpotlightTourProps) {
  const raw = useSyncExternalStore(subscribeTour, getTourSnapshot, getTourServerSnapshot);
  const done = useMemo(() => toursDoneFor(raw, careerId), [raw, careerId]);

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [box, setBox] = useState<Box | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const finish = useCallback(() => {
    setOpen(false);
    setBox(null);
    // Skip counts as done. A tour that reappears after being dismissed is a nuisance, not a guide.
    markTourDone(careerId, tab);
    const previous = restoreFocusRef.current;
    if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
  }, [careerId, tab]);

  // Start the tour once per tab per career. Deferred by a frame so the anchors are mounted before the
  // tour decides whether it has anything to point at.
  useEffect(() => {
    if (!enabled || careerId === null) return;
    if (done.includes(tab)) return;
    const frame = window.requestAnimationFrame(() => {
      if (open) return;
      const ready = availableSteps(tab);
      if (ready.length === 0) return;
      restoreFocusRef.current = document.activeElement;
      setSteps(ready);
      setIndex(0);
      setOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, careerId, tab, done, open]);

  // Keep the highlight on the target: scroll it in first, then measure, and re-measure on resize and
  // on any scroll. Deferred by a frame because a synchronous setState in an effect body trips
  // `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!open) return;
    const step = steps[index];
    if (step === undefined) return;
    let frame = 0;
    const measure = () => {
      const target = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (target === null) {
        setBox(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const target = document.querySelector(`[data-tour="${step.anchor}"]`);
    if (target instanceof HTMLElement) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, index, steps]);

  // Escape leaves, and the next button takes focus so the tour is usable from the keyboard alone.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    nextRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, finish]);

  if (!open) return null;
  const step = steps[index];
  if (step === undefined) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const hole =
    box === null
      ? null
      : {
          top: Math.max(0, box.top - SPOT_PAD),
          left: Math.max(0, box.left - SPOT_PAD),
          width: box.width + SPOT_PAD * 2,
          height: box.height + SPOT_PAD * 2,
        };

  const shadow = "fixed z-[100] bg-slate-950/75 backdrop-blur-sm";
  const last = index === steps.length - 1;

  // Below the target when there is room, above it otherwise, and centred when there is no target.
  const cardTop =
    hole === null
      ? Math.max(16, viewportHeight / 2 - 100)
      : hole.top + hole.height + 200 < viewportHeight
        ? hole.top + hole.height + 16
        : Math.max(16, hole.top - 200);
  const cardLeft =
    hole === null
      ? Math.max(16, viewportWidth / 2 - 190)
      : Math.min(Math.max(16, hole.left), Math.max(16, viewportWidth - 396));

  return (
    <div className="fixed inset-0 z-[100]">
      {hole === null ? (
        <div className={`${shadow} inset-0`} aria-hidden="true" />
      ) : (
        <>
          {/* Four panels around the target, rather than one panel with a hole painted in it: this way
              the real control stays clickable exactly where the manager can see it. */}
          <div className={shadow} style={{ top: 0, left: 0, right: 0, height: hole.top }} aria-hidden="true" />
          <div
            className={shadow}
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
            aria-hidden="true"
          />
          <div
            className={shadow}
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
            aria-hidden="true"
          />
          <div
            className={shadow}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
            aria-hidden="true"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[101] rounded-xl ring-2 ring-[#E11D48] shadow-[0_0_0_6px_rgba(225,29,72,0.25)]"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        className="fixed z-[102] w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="tour-step-title"
            className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100"
          >
            {step.title}
          </h2>
          <button
            type="button"
            onClick={finish}
            className="shrink-0 rounded-lg px-2 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
          >
            Skip
          </button>
        </div>

        <p className="mt-2 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((entry, position) => (
              <span
                key={entry.anchor}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${
                  position === index ? "w-4 bg-[#E11D48]" : "w-1.5 bg-slate-300 dark:bg-slate-700"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                className="rounded-lg px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
              >
                Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              onClick={() => (last ? finish() : setIndex((current) => current + 1))}
              className="rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white transition-[background-color,transform] duration-200 hover:bg-[#c8173d] active:scale-[0.96] cursor-pointer"
            >
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
