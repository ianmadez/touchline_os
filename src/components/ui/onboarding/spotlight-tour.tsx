"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  getTourServerSnapshot,
  getTourSnapshot,
  markTourDone,
  reconcileTourRevision,
  subscribeTour,
  toursDoneFor,
} from "@/lib/session";

/**
 * Spotlight tours.
 *
 * One tour per tab, pointing at the real controls through `data-tour` attributes. The page is dimmed
 * into a deep shadow and the one element under discussion is left clear, so a step asks the manager to
 * look at an actual control rather than at a picture of one. Every tab gets a tour worth sitting
 * through: several steps, in the order a manager would actually meet the screen, ending on the thing
 * they came to do.
 *
 * Four rules keep it from becoming a nuisance, and each one exists because breaking it was visible:
 *
 * 1. A tour belongs to ONE tab. Left open across a tab change it put a highlight over a screen it was
 *    never about, which is how it came to sit on top of the landing page and hide the footer behind a
 *    dimmed backdrop. It now closes on a tab change and records the tab it belonged to, not the one
 *    just opened.
 * 2. A step whose anchor is not on the page is dropped before the tour starts, so a tour never floats
 *    over nothing and never counts a step it cannot show.
 * 3. The backdrop never swallows the click it is highlighting. The body of the overlay is
 *    `pointer-events-none` and only the four shadow panels opt back in.
 * 4. It never opens over the entry splash. The splash owns the screen until the manager chooses to step
 *    inside, and a tour that dimmed it would be introducing a menu before it had been entered.
 *
 * Inner tabs get their own tours. A screen's strip is the second half of its navigation, so `SEASON`
 * covers the tab and `SEASON::VAULT` covers the Vault, and each is remembered separately. The inner tab
 * is read from the DOM rather than passed down, because the strips already mark their own selection and
 * no screen should have to report upwards just to be explained.
 *
 * Copy rules, enforced here rather than left to taste: short lines, no paragraphs, and every line
 * either says what something is or tells the manager what to click. The voice is a helpful colleague,
 * not a manual.
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
 * How the step list is decided, and why it is not decided immediately.
 *
 * Several screens fetch their own data, so a panel can arrive a beat after its tab does: the Vault's
 * dossier and the academy are fetched, and the finance report too. Resolving on the first frame, or on
 * the first frame where there is merely enough to show, produced tours that were quietly missing the
 * steps they were written around. Instead the tour keeps looking until the DOM has been still for a
 * moment, keeps the largest list it has seen, and gives up only after a generous ceiling.
 */
const OPEN_POLL_MS = 250;
const OPEN_QUIET_MS = 400;
const OPEN_MAX_WAIT_MS = 3000;
/**
 * How long a tour must have been on screen before leaving it counts as having seen it.
 *
 * Entering the app swaps to the Dashboard a frame or two after the splash closes, which was enough to
 * open the restored tab's tour and immediately record it - spent without ever being read. A tour nobody
 * could have read is offered again instead.
 */
const MIN_READ_MS = 900;

/**
 * Which revision of the copy below this is.
 *
 * Bump it whenever the tours change enough that they are worth showing again, and every career -
 * existing or brand new - gets them once more on its next visit. That is what makes a tour improvement
 * visible to the people who already sat through the old one. Clearing the record lives in
 * `reconcileTourRevision`, which takes this value rather than deriving one, because "worth reshowing"
 * is an editorial call and cannot be computed.
 */
const TOUR_REVISION = "2026-10-10";

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
      anchor: "dashboard-welcome",
      title: "Welcome to TouchlineOS",
      body: "This is your hub. Everything on this screen is read straight out of your save file, so you can look around freely. Nothing is ever written back to it.",
    },
    {
      anchor: "tab-DASHBOARD",
      title: "Your home base",
      body: "The red tab is where you are. The rest of the bar is the rest of your career: the season, the squad, the tactics board, match debriefs, the money, and settings.",
    },
    {
      anchor: "dashboard-season",
      title: "Where the season stands",
      body: "Your board's target, your record across every competition as the save has it, and the position it records for you. View Season Hub opens the long version.",
    },
    {
      anchor: "dashboard-storylines",
      title: "What matters right now",
      body: "Threads TouchlineOS noticed on its own: a contract running down, a slump, a squad grown thin. Click a title to see the evidence. Dismiss anything you are not fussed about and it stops asking.",
    },
    {
      anchor: "dashboard-squad-report",
      title: "Squad report",
      body: "Your strongest eleven's average, your bench's average, and any position where you are down to fewer than two real options. Handy before a busy week.",
    },
    {
      anchor: "dashboard-activity",
      title: "Recent activity",
      body: "Everything the app has written down for this career, newest first. The full history lives in Settings, under Career Timeline.",
    },
  ],
  SEASON: [
    {
      anchor: "tab-SEASON",
      title: "The season tab",
      body: "One season, looked at four different ways. Take a minute here, it is the room you will come back to most.",
    },
    {
      anchor: "season-subtabs",
      title: "Four views of it",
      body: "Outlook is the record, Objectives is what the board asked of you, Charts is how it is trending, and the Vault keeps every match you have logged.",
    },
    {
      anchor: "season-outlook",
      title: "The outlook",
      body: "Points and points per match across every competition, as the save counts them, plus the objective it holds for this season.",
    },
    {
      anchor: "season-history",
      title: "Your managerial record",
      body: "Every season the save kept, oldest first. Columns with a star are totals across all competitions rather than league-only figures.",
    },
    {
      anchor: "season-subtab-VAULT",
      title: "The Vault",
      body: "Open this when you want a season match by match. Once a season is written down it is never overwritten, so the record stays honest.",
    },
  ],
  DEBRIEF: [
    {
      anchor: "tab-DEBRIEF",
      title: "The debrief tab",
      body: "Log a match here and the season, the storylines and the charts all move with it. This is the one place you tell the app something it cannot read from the save.",
    },
    {
      anchor: "debrief-meta",
      title: "Match details",
      body: "Opponent, the date you actually played, and the competition. Pick Another club for a cup tie or a friendly.",
    },
    {
      anchor: "debrief-standouts",
      title: "Standout performers",
      body: "Click a player to mark him. Mark as many as you like, then sort the list by where he plays or by who you picked.",
    },
    {
      anchor: "debrief-contributions",
      title: "Goals and assists",
      body: "Add each scorer, then his assister if there was one. The line underneath ticks off the goals you still owe an explanation for.",
    },
    {
      anchor: "debrief-notes",
      title: "Your notes",
      body: "A weakness you spotted, and anything you want to remember about this one. Only you ever see these.",
    },
    {
      anchor: "debrief-history",
      title: "Your debriefs",
      body: "Every match you have logged so far. Open one to edit it in place, or delete it and write it again.",
    },
  ],
  SQUAD: [
    {
      anchor: "tab-SQUAD",
      title: "The squad tab",
      body: "What you have, what you are eyeing up, and what it would cost you.",
    },
    {
      anchor: "squad-search",
      title: "One search box",
      body: "It narrows the squad list, the scouting board and the academy together, so a name you type in here keeps working as you wander between them.",
    },
    {
      anchor: "squad-subtabs",
      title: "Four rooms",
      body: "Squad, Scouting, Transfers and Youth. Scouting and Transfers are two views of the same shortlist rather than two separate lists.",
    },
    {
      anchor: "squad-subtab-SCOUTING",
      title: "Scouting",
      body: "Every professional in your save, ranked the way a manager actually shops, with a value band and a confidence tag on each one. Budget in, shortlist out.",
    },
    {
      anchor: "squad-subtab-YOUTH",
      title: "The academy",
      body: "Your youth prospects, read from the save's own academy table. A boy who is not in the senior squad yet still shows up in here.",
    },
    {
      anchor: "squad-table",
      title: "The squad list",
      body: "Click any column heading to sort it. Click a player to open his profile, which is where his tactical role and your notes about him live.",
    },
  ],
  TACTICS: [
    {
      anchor: "tab-TACTICS",
      title: "The tactics tab",
      body: "The pitch your team lines up on, and every formation you keep alongside it.",
    },
    {
      anchor: "tactics-formations",
      title: "Your formations",
      body: "Keep as many as you like. The one marked XI is the shape the rest of the app reads, so Make current XI is how you change what every other screen sees.",
    },
    {
      anchor: "tactics-shape",
      title: "Pick a shape",
      body: "Choose a shape and the pitch redraws itself. Players keep their place wherever the new shape still has a slot for them.",
    },
    {
      anchor: "tactics-pitch",
      title: "The pitch",
      body: "Eleven slots. Click one and then a player from the bench to fill it, or click a filled slot to move him somewhere else.",
    },
    {
      anchor: "tactics-bench",
      title: "The bench",
      body: "Sort the bench by any column to find who you are after, then click him and click the slot he belongs in. Click him again to take him back off.",
    },
  ],
  FINANCE: [
    {
      anchor: "tab-FINANCE",
      title: "The finance tab",
      body: "Where the money comes from, and where it goes. Short and sweet, this one.",
    },
    {
      anchor: "finance-summary",
      title: "Every figure is labelled",
      body: "SAVE means the file says so. DERIVED means TouchlineOS worked it out and will happily tell you how. USER means you typed it in yourself.",
    },
    {
      anchor: "finance-budgets",
      title: "Your two budgets",
      body: "The game does not store transfer or wage budgets, so there is genuinely nothing here to read. Type them in and the wage to turnover line suddenly has something real to argue with.",
    },
    {
      anchor: "finance-figures",
      title: "The interesting ones",
      body: "Estimated tier revenue, wage to turnover measured against your realism level, and your record buy and sale exactly as the save recorded them.",
    },
    {
      anchor: "finance-contract",
      title: "Contract commitment",
      body: "What you are already on the hook for over the seasons to come, worked out from your squad's own contract end dates. Worth a look before you promise anybody anything.",
    },
  ],
  SETTINGS: [
    {
      anchor: "tab-SETTINGS",
      title: "Settings",
      body: "Everything about the app rather than about your club. Nothing you change here touches your save.",
    },
    {
      anchor: "settings-subtabs",
      title: "Two halves",
      body: "Preferences is how the app behaves. Career Timeline is the record of everything it has written down for you, newest first.",
    },
    {
      anchor: "settings-appearance",
      title: "Appearance",
      body: "Light, dark, or follow whatever your machine is doing. It applies the moment you click and saves itself, no button needed.",
    },
    {
      anchor: "settings-career",
      title: "Career and display",
      body: "Realism level sets the advisory lines you will meet elsewhere in the app, and the currency settings decide how your money reads. Change them whenever you like.",
    },
    {
      anchor: "settings-data",
      title: "Data management",
      body: "What is actually stored, how to take a copy of your career, and where to start over. Everything else on this screen is safe to poke at.",
    },
  ],

  // ---------------------------------------------------------------------------------------------
  // Inner tabs. Keyed `TAB::SUBTAB`, and remembered separately from the outer tour, so a manager who
  // has sat through the Season tour still gets the Vault explained the first time they open it.
  // ---------------------------------------------------------------------------------------------
  "SEASON::OBJECTIVES": [
    {
      anchor: "objectives-summary",
      title: "What the board asked for",
      body: "The objectives you recorded, counted by how each one stands, with whichever the board weighs heaviest called out underneath.",
    },
    {
      anchor: "objectives-add",
      title: "Add one when you are given it",
      body: "Pick a category, give it a title, set how much the board cares. It joins the list the moment you add it.",
    },
    {
      anchor: "objectives-list",
      title: "The running list",
      body: "Each objective carries its own status box. Mark them off as the season goes and the board's view of you keeps up with you.",
    },
    {
      anchor: "objectives-empty",
      title: "Nothing on the list yet",
      body: "The save stores a board objective as a bare code with no wording, so the phrasing has to be yours. Start with the one you were given in the game and the rest can follow.",
    },
  ],
  "SEASON::CHARTS": [
    {
      anchor: "season-chart-trajectory",
      title: "Your season as a line",
      body: "Cumulative points against the target you set for each block of five. Bars turn amber when you are behind the plan you made.",
    },
    {
      anchor: "season-chart-points",
      title: "Points by season",
      body: "Every completed season on one chart, so a good year and a bad one sit next to each other instead of in your memory.",
    },
    {
      anchor: "season-chart-finish",
      title: "Finishing positions",
      body: "Lower is better here. The bars are scaled to your worst finish on record, so the shape of the trend is what you are reading.",
    },
  ],
  "SEASON::VAULT": [
    {
      anchor: "season-vault",
      title: "The Vault",
      body: "Every completed season, kept as it finished. Once a season is written down it is never rewritten, so the record stays honest.",
    },
    {
      anchor: "vault-seasons",
      title: "Pick a season",
      body: "Switch between the seasons the save kept. One still in progress is marked live.",
    },
    {
      anchor: "vault-header",
      title: "How the season ended",
      body: "Where you finished, how the record read, and the trophies if there were any. Short and to the point.",
    },
    {
      anchor: "vault-save-half",
      title: "What the save says",
      body: "Straight from your own file, including seasons that finished before you installed TouchlineOS. Nothing here is estimated.",
    },
  ],
  "SQUAD::SCOUTING": [
    {
      anchor: "scout-strategies",
      title: "Five ways to shop",
      body: "Suggested fills your gaps. Balanced, Immediate, Prospect and Value each weigh ability, age and money differently. Click one and the shortlist reorders around it.",
    },
    {
      anchor: "scout-results",
      title: "The list itself",
      body: "Every professional in your save, each with a value band and a confidence tag. Click a row to open his dossier.",
    },
    {
      anchor: "scout-dossier",
      title: "The dossier",
      body: "Ratings, attributes, his club, and what he would cost you. If you like what you see, pin him from here.",
    },
    {
      anchor: "scouting-memory",
      title: "Scouting memory",
      body: "Players you set aside, with the reason you set them aside. It taps you on the shoulder when something about one of them has changed.",
    },
  ],
  "SQUAD::TRANSFERS": [
    {
      anchor: "transfers-heading",
      title: "The transfers desk",
      body: "What acting on your shortlist would cost you, and what you would have left afterwards.",
    },
    {
      anchor: "transfers-figures",
      title: "Three numbers",
      body: "Your budget, the whole shortlist's commitment, and the gap. The commitment stays blank until every player on it has a price, because half a total reads as the whole bill.",
    },
    {
      anchor: "transfers-shortlist",
      title: "Who you are acting on",
      body: "Everyone you have shortlisted, with his cost beside him. Nothing here is a decision TouchlineOS makes for you.",
    },
  ],
  "SQUAD::YOUTH": [
    {
      anchor: "squad-youth",
      title: "The academy",
      body: "Your prospects, read from the save's own academy table rather than guessed at from birthdays.",
    },
    {
      anchor: "youth-summary",
      title: "The group at a glance",
      body: "How many prospects you have and the best potential among them, with a count of any the save never gave a name.",
    },
    {
      anchor: "youth-list",
      title: "One row per prospect",
      body: "Tier, potential swing and how long he has been with you. Where two assessments disagree you get a range instead of a tidy single number.",
    },
  ],
  "DEBRIEF::GROUP": [
    {
      anchor: "group-heading",
      title: "Group debriefs",
      body: "Five matches at a time instead of one: set the points you wanted from each, then come back and report what actually happened.",
    },
    {
      anchor: "group-new",
      title: "Start a block",
      body: "Begin the next five fixtures. Set what you are hoping for from each one while it is still a hope, because that is the bit the app cannot read from your save.",
    },
    {
      anchor: "group-empty",
      title: "Nothing recorded yet",
      body: "Take five fixtures and write down the points you want. TouchlineOS adds the block up and shows it back to you as one run of form.",
    },
    {
      anchor: "group-blocks",
      title: "Your blocks",
      body: "Each block adds up to one run of form you can point at. Open one to correct it, or delete it and write it again.",
    },
  ],
  "SETTINGS::TIMELINE": [
    {
      anchor: "timeline-card",
      title: "Your career timeline",
      body: "Everything TouchlineOS has recorded for this career, newest first, each entry labelled with where it came from.",
    },
    {
      anchor: "timeline-filters",
      title: "Filter by kind",
      body: "Narrow the feed to signings, rating moves, budgets and so on. The little numbers show how much of each there is.",
    },
    {
      anchor: "timeline-feed",
      title: "The feed",
      body: "The card keeps its height and the list scrolls inside it, however long a career runs. Nothing is ever trimmed off the end.",
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
  /**
   * False until the manager has actually stepped inside, and while a screen is still settling. The
   * caller owns this: the entry splash is not a tab, so only the caller knows whether the screen
   * behind the tour is the one the tour is about.
   */
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

/** The inner tab the manager is on, taken from whichever strip marks itself as selected. */
function activeSubTab(): string | null {
  return (
    document
      .querySelector('[data-subtab][aria-selected="true"]')
      ?.getAttribute("data-subtab") ?? null
  );
}

/**
 * Which tour applies right now.
 *
 * An inner tab with a tour of its own wins, because a strip is the second half of the navigation and
 * arriving on a screen through one is a deliberate move to that screen. Everything else falls back to
 * the outer tab, which is what keeps a tab's own tour working on the inner tab it happens to open on.
 */
function resolveTourKey(tab: string, subTab: string | null): string {
  if (subTab === null) return tab;
  const composed = `${tab}::${subTab}`;
  return TOURS[composed] === undefined ? tab : composed;
}

export function SpotlightTour({ careerId, tab, enabled }: SpotlightTourProps) {
  const raw = useSyncExternalStore(subscribeTour, getTourSnapshot, getTourServerSnapshot);
  const done = useMemo(() => toursDoneFor(raw, careerId), [raw, careerId]);
  /** The inner tab on screen, or null where the screen has no strip. Read from the DOM, not props. */
  const [subTab, setSubTab] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  /** The tour this run belongs to. Read on close so leaving mid-tour never marks another one seen. */
  const [ownedTab, setOwnedTab] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  /** When this run was put on screen, so a tour that was never readable is not recorded as seen. */
  const openedAtRef = useRef(0);

  /*
    Declared first so it runs before the tour can decide to open. When the copy has moved on this empties
    the record of what has been seen, and the store notification re-renders with an empty list.
  */
  useEffect(() => {
    reconcileTourRevision(TOUR_REVISION);
  }, []);

  /*
    Follows the inner strip. A MutationObserver is needed rather than a plain read, because clicking a
    tab does not re-render this component: the tour would otherwise keep believing it was still on the
    tab it opened on. `setSubTab` with an unchanged value is a no-op, so a busy DOM costs nothing, and
    only the selection attribute is watched rather than every attribute on every node.
  */
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setSubTab(activeSubTab());
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(read);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled]);

  const tourKey = useMemo(() => resolveTourKey(tab, subTab), [tab, subTab]);

  const close = useCallback(
    (remember: boolean) => {
      setOpen(false);
      setSpot(null);
      setOwnedTab(null);
      // Remembering is the default: a tour that returns after being dismissed is a nuisance, and Skip
      // exists for the manager who does not want it at all. The one exception is a tour that was on
      // screen for less time than it takes to read a line, which nobody could have taken in.
      const readable = Date.now() - openedAtRef.current >= MIN_READ_MS;
      if (remember && readable && ownedTab !== null) markTourDone(careerId, ownedTab);
      const previous = restoreFocusRef.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    },
    [careerId, ownedTab]
  );

  /**
   * Opens once per tour per career, once the screen has settled.
   *
   * Mutations only mark the moment the DOM last changed; the polling loop does the reading, and takes
   * the largest list it has seen. That is what stops a fetched panel from being left out of its own
   * tour: the dossier under the Vault, the academy's rows and the finance report all arrive after the
   * tab does, and a single look would have settled for a two-step tour about a four-step screen.
   */
  useEffect(() => {
    if (!enabled || careerId === null) return;
    if (open || ownedTab !== null) return;
    if (done.includes(tourKey)) return;

    let cancelled = false;
    let timer = 0;
    let best: TourStep[] = [];
    let lastChange = Date.now();
    const startedAt = Date.now();

    const check = () => {
      if (cancelled) return;
      const ready = availableSteps(tourKey);
      if (ready.length > best.length) best = ready;
      const elapsed = Date.now() - startedAt;
      const quiet = Date.now() - lastChange >= OPEN_QUIET_MS;
      if (best.length > 0 && (quiet || elapsed >= OPEN_MAX_WAIT_MS)) {
        restoreFocusRef.current = document.activeElement;
        setSteps(best);
        setIndex(0);
        setOwnedTab(tourKey);
        openedAtRef.current = Date.now();
        setOpen(true);
        return;
      }
      if (elapsed >= OPEN_MAX_WAIT_MS) return;
      timer = window.setTimeout(check, OPEN_POLL_MS);
    };

    const observer = new MutationObserver(() => {
      lastChange = Date.now();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(check, OPEN_POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [enabled, careerId, tourKey, done, open, ownedTab]);

  // A tour belongs to one screen, so moving on - to another tab or into another inner tab - ends it.
  // Marking the tour it belonged to is the point: recording the newly opened one instead silently spent
  // a tour the manager never saw.
  useEffect(() => {
    if (!open || ownedTab === null || ownedTab === tourKey) return;
    const timer = window.setTimeout(() => close(true), 0);
    return () => window.clearTimeout(timer);
  }, [open, ownedTab, tourKey, close]);

  // Something took the screen away mid-tour - the entry splash reappearing, or a load starting. The
  // steps were never read, so this one is not remembered and the tour gets its full run later.
  useEffect(() => {
    if (!open || enabled) return;
    const timer = window.setTimeout(() => close(false), 0);
    return () => window.clearTimeout(timer);
  }, [open, enabled, close]);

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
