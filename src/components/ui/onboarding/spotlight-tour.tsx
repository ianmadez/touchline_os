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
 * One micro tour per tab, pointing at the real controls through `data-tour` attributes. The page is
 * dimmed into a deep shadow and the one element under discussion is left clear, so a step asks the
 * manager to look at an actual control rather than at a picture of one. Several steps go past the
 * obvious: what a card is for, what it reads, and what to click.
 *
 * Three rules keep it from becoming a nuisance, and each one exists because breaking it was visible:
 *
 * 1. A tour belongs to ONE tab. Left open across a tab change it put a highlight over a screen it was
 *    never about, which is how it came to sit on top of the landing page and hide the footer behind a
 *    dimmed backdrop. It now closes on a tab change and records the tab it belonged to, not the one
 *    just opened.
 * 2. A step whose anchor is not on the page is dropped before the tour starts, so a tour never floats
 *    over nothing and never counts a step it cannot show.
 * 3. The backdrop never swallows the click it is highlighting. The body of the overlay is
 *    `pointer-events-none` and only the four shadow panels opt back in.
 *
 * Copy rules, enforced here rather than left to taste: no em dashes, no paragraphs, and every line
 * either says what something is or tells the manager what to click.
 */

/** Padding around the highlighted element, so the ring is not glued to the control. */
const SPOT_PAD = 8;
/** The card's width, so it can be positioned horizontally without measuring itself first. */
const CARD_WIDTH = 380;
/** Clear space between the card and the page edge. */
const CARD_MARGIN = 16;
/** A step change is measured a few times: the scroll it triggers settles over several frames. */
const SETTLE_DELAYS = [50, 150, 340];
/**
 * The fewest steps worth showing. A tour that survived filtering down to its tab button alone would
 * only announce the tab the manager has just clicked, and because closing a tour records it, spending
 * the tab's one run on that would lose the real tour for good. Two is the floor: one step of content
 * plus something to compare it against.
 */
const MIN_TOUR_STEPS = 2;
/** Tabs that never get a tour: the landing screen, the setup flow and the legacy feed. */
const NO_TOUR_TABS = new Set(["LANDING", "PORTAL", "TIMELINE"]);

export interface TourStep {
  /** Matches a `data-tour` attribute on the page. A step whose anchor is absent is skipped. */
  anchor: string;
  title: string;
  body: string;
}

const TOURS: Record<string, TourStep[]> = {
  DASHBOARD: [
    {
      anchor: "tab-DASHBOARD",
      title: "Your dashboard",
      body: "The app opens here after a sync. Every figure on this screen comes out of your save file.",
    },
    {
      anchor: "dashboard-season",
      title: "Where the season stands",
      body: "Your board objective, the save's own record across all competitions, and your logged league position. View Season Hub opens the full picture.",
    },
    {
      anchor: "dashboard-storylines",
      title: "What matters right now",
      body: "Threads the save threw up on its own: form, depth, contract pressure. Click a title to see the facts behind it, and dismiss any that do not concern you.",
    },
    {
      anchor: "dashboard-squad-report",
      title: "Squad report",
      body: "Your starting eleven average, your bench average, and any role where you have fewer than two real options.",
    },
    {
      anchor: "dashboard-activity",
      title: "Recent activity",
      body: "Everything TouchlineOS has recorded for this career, newest first. The full feed lives in Settings under Career Timeline.",
    },
  ],
  SEASON: [
    {
      anchor: "tab-SEASON",
      title: "The season tab",
      body: "One season, looked at from four angles.",
    },
    {
      anchor: "season-subtabs",
      title: "Four views of it",
      body: "Outlook is the record, Objectives is what the board asked for, Charts is how it is trending, and the Vault is every match you have logged.",
    },
    {
      anchor: "season-outlook",
      title: "The outlook",
      body: "Points and points per match across every competition, plus the objective the save holds for this season.",
    },
    {
      anchor: "season-history",
      title: "Managerial record",
      body: "Every completed season, oldest first. Columns marked with a star are save totals across all competitions rather than league-only figures.",
    },
  ],
  DEBRIEF: [
    {
      anchor: "tab-DEBRIEF",
      title: "The debrief tab",
      body: "Log a match here, and the season, the storylines and the charts all move with it.",
    },
    {
      anchor: "debrief-meta",
      title: "Match details",
      body: "Opponent, the date you actually played, and the competition. Choose Another club for a cup tie or a friendly.",
    },
    {
      anchor: "debrief-standouts",
      title: "Standout performers",
      body: "Click a player to mark him. Pick as many as you like, then sort the list by pitch position or by the ones you picked.",
    },
    {
      anchor: "debrief-contributions",
      title: "Goals and assists",
      body: "Add each scorer, then his assister if there was one. The line underneath counts off the goals you have still to account for.",
    },
    {
      anchor: "debrief-notes",
      title: "Your notes",
      body: "A weakness you spotted and anything worth remembering. Only you read these.",
    },
    {
      anchor: "debrief-history",
      title: "Your debriefs",
      body: "Every match you have logged. Open one to edit it in place, or delete it and log it again.",
    },
  ],
  SQUAD: [
    {
      anchor: "tab-SQUAD",
      title: "The squad tab",
      body: "What you have, what you are looking at, and what acting on it costs.",
    },
    {
      anchor: "squad-search",
      title: "One search box",
      body: "It narrows the squad list, the scouting board and the academy between them, so a name you type here keeps working as you move.",
    },
    {
      anchor: "squad-subtabs",
      title: "Four views",
      body: "Squad, Scouting, Transfers and Youth. The scouting board and the transfers desk are two views of one shortlist rather than two lists.",
    },
    {
      anchor: "squad-table",
      title: "The squad list",
      body: "Click any column heading to sort it. Click a player to open his profile, where his tactical role is set.",
    },
  ],
  TACTICS: [
    {
      anchor: "tab-TACTICS",
      title: "The tactics tab",
      body: "The pitch your team lines up on, and the formations you keep alongside it.",
    },
    {
      anchor: "tactics-formations",
      title: "Your formations",
      body: "Keep as many as you like. The one marked XI is the shape every other screen reads, so Make current XI is how you change what the rest of the app sees.",
    },
    {
      anchor: "tactics-shape",
      title: "Pick a shape",
      body: "Choose a shape and the pitch redraws. Players keep their slots wherever the new shape still has one for them.",
    },
    {
      anchor: "tactics-bench",
      title: "The bench",
      body: "Click a player on the bench, then click a slot on the pitch to place him. Sort the bench by any column to find who you want.",
    },
  ],
  FINANCE: [
    {
      anchor: "tab-FINANCE",
      title: "The finance tab",
      body: "Where the money comes from and where it goes.",
    },
    {
      anchor: "finance-summary",
      title: "Every figure is labelled",
      body: "SAVE means the save file says it. DERIVED means TouchlineOS worked it out and can tell you how. USER means you typed it in.",
    },
    {
      anchor: "finance-budgets",
      title: "Your two budgets",
      body: "Transfer and wage budgets are not in the save file, so there is nothing to read. Type them in and the wage to turnover figure has something real to measure against.",
    },
  ],
  SETTINGS: [
    {
      anchor: "tab-SETTINGS",
      title: "Settings",
      body: "Everything that is about the app rather than about your club.",
    },
    {
      anchor: "settings-subtabs",
      title: "Two halves",
      body: "Preferences is how the app behaves. Career Timeline is the record of everything it has logged for this career.",
    },
    {
      anchor: "settings-appearance",
      title: "Appearance",
      body: "Light, dark or follow your system. The theme applies straight away and saves without a button.",
    },
    {
      anchor: "settings-data",
      title: "Data management",
      body: "What is actually stored, how to export a copy of your career, and where a career is reset from. Everything else on this screen is safe to change.",
    },
  ],
};

/** The measured highlight and the viewport it was measured against. */
interface Spot {
  hole: { top: number; left: number; width: number; height: number };
  viewportWidth: number;
  viewportHeight: number;
}

interface SpotlightTourProps {
  /** Null until a career exists, so a tour never runs on the landing screen. */
  careerId: string | null;
  /** The tab currently on screen. A change closes any tour in progress. */
  tab: string;
  /** False until setup is finished, so a tour never competes with the first run. */
  enabled: boolean;
}

/**
 * Steps whose anchor is actually on the page. A missing anchor is dropped, never shown over nothing,
 * and a tab left with too little to say is skipped entirely rather than half-explained.
 */
function availableSteps(tab: string): TourStep[] {
  if (NO_TOUR_TABS.has(tab)) return [];
  const present = (TOURS[tab] ?? []).filter(
    (step) => document.querySelector(`[data-tour="${step.anchor}"]`) !== null
  );
  return present.length >= MIN_TOUR_STEPS ? present : [];
}

/** The anchor's box in viewport coordinates, or null when it is absent or has no size. */
function anchorRect(anchor: string): { top: number; left: number; width: number; height: number } | null {
  const target = document.querySelector(`[data-tour="${anchor}"]`);
  if (target === null) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function SpotlightTour({ careerId, tab, enabled }: SpotlightTourProps) {
  const raw = useSyncExternalStore(subscribeTour, getTourSnapshot, getTourServerSnapshot);
  const done = useMemo(() => toursDoneFor(raw, careerId), [raw, careerId]);

  const [open, setOpen] = useState(false);
  /** The tab this tour belongs to. Read on close so leaving mid-tour never marks the new tab seen. */
  const [ownedTab, setOwnedTab] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const close = useCallback(
    (remember: boolean) => {
      setOpen(false);
      setSpot(null);
      setOwnedTab(null);
      // Remembering is the default: a tour that returns after being dismissed is a nuisance, and Skip
      // exists for the manager who does not want it at all.
      if (remember && ownedTab !== null) markTourDone(careerId, ownedTab);
      const previous = restoreFocusRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    },
    [careerId, ownedTab]
  );

  // Open once per tab per career. Deferred by a frame so the anchors are mounted before the tour
  // decides whether it has anything to point at.
  useEffect(() => {
    if (!enabled || careerId === null) return;
    if (open || ownedTab !== null) return;
    if (done.includes(tab)) return;
    const frame = window.requestAnimationFrame(() => {
      const ready = availableSteps(tab);
      if (ready.length === 0) return;
      restoreFocusRef.current = document.activeElement;
      setSteps(ready);
      setIndex(0);
      setOwnedTab(tab);
      setOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, careerId, tab, done, open, ownedTab]);

  // A tour belongs to one tab, so navigating away ends it. Marking the tab it belonged to is the
  // point: recording the newly opened tab instead silently spent a tour the manager never saw.
  useEffect(() => {
    if (!open || ownedTab === null || ownedTab === tab) return;
    const timer = window.setTimeout(() => close(true), 0);
    return () => window.clearTimeout(timer);
  }, [open, ownedTab, tab, close]);

  // The same rule for an anchor that disappears under the tour, which a sub-tab switch can do without
  // the tab itself changing, is enforced inside the measurement pass below. It cannot live in an
  // effect that depends on render state: removing a node does not re-render this component, so such an
  // effect simply would not run.

  /**
   * Follows the current target: scroll it into view, then measure, and keep measuring while that
   * scroll settles.
   *
   * Two details carry most of the smoothness. The scroll is forced to `instant` because this app sets
   * `scroll-behavior: smooth` globally, and measuring during an animation is what made the ring look
   * like it was chasing the page. And measurements are coalesced into one animation frame per burst,
   * so wheeling down a long page does not re-render on every event.
   */
  useEffect(() => {
    if (!open) return;
    const step = steps[index];
    if (step === undefined) return;

    let frame = 0;
    let cancelled = false;

    const read = () => {
      frame = 0;
      if (cancelled) return;
      // Every anchor the tour advertises is checked, not just the current one. A step pointing at an
      // element that has gone is worse than no step at all, and dropping the whole tour is the honest
      // answer when the screen underneath has changed shape.
      let rect: { top: number; left: number; width: number; height: number } | null = null;
      for (const entry of steps) {
        const measured = anchorRect(entry.anchor);
        if (measured === null) {
          close(true);
          return;
        }
        if (entry === step) rect = measured;
      }
      if (rect === null) {
        close(true);
        return;
      }
      // Clamped to the viewport so the four panels always tile it exactly. An anchor taller than the
      // screen would otherwise push a panel past the edge and overlap another, and two stacked
      // backdrop blurs leave a visible seam.
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const top = Math.max(0, rect.top - SPOT_PAD);
      const left = Math.max(0, rect.left - SPOT_PAD);
      const bottom = Math.min(viewportHeight, rect.top + rect.height + SPOT_PAD);
      const right = Math.min(viewportWidth, rect.left + rect.width + SPOT_PAD);
      const next: Spot = {
        hole: { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
        viewportWidth,
        viewportHeight,
      };
      // Returning the current object when nothing moved lets React bail out, which keeps a scroll that
      // does not move the target from re-rendering.
      setSpot((current) => {
        if (
          current !== null &&
          current.viewportWidth === next.viewportWidth &&
          current.viewportHeight === next.viewportHeight &&
          current.hole.top === next.hole.top &&
          current.hole.left === next.hole.left &&
          current.hole.width === next.hole.width &&
          current.hole.height === next.hole.height
        ) {
          return current;
        }
        return next;
      });
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(read);
    };

    const target = document.querySelector(`[data-tour="${step.anchor}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }

    schedule();
    const catches = SETTLE_DELAYS.map((delay) => window.setTimeout(schedule, delay));
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    /*
      Watching the document, not just the scroll position. A sub-tab switch replaces the target with a
      different panel and does not re-render this component, so nothing here would previously notice
      that the anchor had gone: the ring would sit on empty space until the manager happened to scroll.
      Mutations are funnelled through the same one-frame `schedule`, so a burst costs a single measure,
      and a measure that finds nothing changed returns the current state so no further render follows.
    */
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      for (const id of catches) window.clearTimeout(id);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, index, steps, close]);

  // Escape leaves, and the Next button takes focus so the tour works from the keyboard alone. The
  // `preventScroll` matters: a normal focus scrolls the page, which dragged a freshly placed highlight
  // off its target a frame later.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("keydown", onKey);
    nextRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, close]);

  if (!open || spot === null) return null;
  const step = steps[index];
  if (step === undefined) return null;

  const { hole, viewportWidth, viewportHeight } = spot;
  const last = index === steps.length - 1;

  /*
    Placement is a decision about which half of the screen is free, not a measurement of the card.
    A target in the top half gets the card at the bottom and the other way round, so the card never
    sits on the thing it is describing. When the target covers most of the screen neither half is
    free, so the card centres and the highlight gives way instead.
  */
  const coversMost = hole.height > viewportHeight * 0.55;
  const targetInTopHalf = hole.top + hole.height / 2 < viewportHeight / 2;
  const justifyContent = coversMost ? "center" : targetInTopHalf ? "flex-end" : "flex-start";

  // Aligned to the target's left edge, then pulled back inside the viewport. Clamping rather than
  // centring keeps the card in the same place as the tour steps down a column of cards.
  const cardLeft = Math.min(
    Math.max(CARD_MARGIN, hole.left),
    Math.max(CARD_MARGIN, viewportWidth - CARD_WIDTH - CARD_MARGIN)
  );

  const shadow = "pointer-events-auto fixed z-[100] bg-slate-950/78 backdrop-blur-sm";

  return (
    // `pointer-events-none` on this wrapper is what keeps the highlighted control usable: without it
    // this full screen box is itself the click target and the hole becomes decorative.
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {/* Four panels around the target rather than one panel with a hole painted into it: this way the
          hole is a real gap in the hit region, so the control inside it stays clickable. */}
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

      <div className="pointer-events-none fixed inset-0 z-[102] flex flex-col p-4" style={{ justifyContent }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-step-title"
          aria-live="polite"
          className="animate-panel-in pointer-events-auto w-[380px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={{ marginLeft: cardLeft, maxHeight: `calc(100vh - ${CARD_MARGIN * 2}px)` }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="tour-step-title"
              className="font-heading text-sm tracking-wider text-slate-900 uppercase dark:text-slate-100"
            >
              {step.title}
            </h2>
            <button
              type="button"
              onClick={() => close(true)}
              className="shrink-0 cursor-pointer rounded-lg px-2 py-1 font-sub text-[10px] font-bold tracking-wider text-slate-500 uppercase transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
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
              <span className="font-sub text-[10px] font-bold tracking-wider text-slate-400 uppercase tabular-nums">
                {index + 1} of {steps.length}
              </span>
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => setIndex((current) => Math.max(0, current - 1))}
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 font-sub text-[10px] font-bold tracking-wider text-slate-500 uppercase transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  Back
                </button>
              )}
              <button
                ref={nextRef}
                type="button"
                onClick={() => (last ? close(true) : setIndex((current) => current + 1))}
                className="cursor-pointer rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[10px] font-bold tracking-wider text-white uppercase transition-[background-color,transform] duration-200 hover:bg-[#c8173d] active:scale-[0.96]"
              >
                {last ? "Got it" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
