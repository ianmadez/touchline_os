/**
 * In-browser session persistence for the app shell.
 *
 * Everything a refresh needs to put the user back exactly where they were lives under a
 * single versioned key. The pre-paint theme script in `layout.tsx` reads the same key, so
 * the dark class is applied before first paint (no light -> dark flash).
 */

export const SESSION_STORAGE_KEY = "touchline.session.v1";
export const SESSION_VERSION = 1;

export type AppTab =
  | "LANDING"
  | "PORTAL"
  | "DASHBOARD"
  | "SEASON"
  | "SQUAD"
  | "TACTICS"
  | "DEBRIEF"
  | "FINANCE"
  | "SETTINGS"
  /**
   * Legacy. The flat event feed was too thin to hold a top-level slot, so it now renders as an
   * inner tab of Settings. Kept in the union so a session persisted before the move still restores
   * (it is redirected to Settings below) instead of landing on a blank screen.
   */
  | "TIMELINE";

export const APP_TABS: readonly AppTab[] = [
  "LANDING",
  "PORTAL",
  "DASHBOARD",
  "SEASON",
  "SQUAD",
  "TACTICS",
  "DEBRIEF",
  "FINANCE",
  "SETTINGS",
  "TIMELINE",
] as const;

/**
 * Where a tab restored from storage should actually land. Only legacy values need rewriting.
 */
export const TAB_RESTORE_REDIRECT: Partial<Record<AppTab, AppTab>> = {
  TIMELINE: "SETTINGS",
};

/**
 * `"system"` follows the operating system until the user picks light or dark explicitly.
 * The default stays `"light"` deliberately: silently following a dark OS would flip the app's
 * carefully-tuned light palette without the user ever asking for it.
 */
export type ThemeMode = "light" | "dark" | "system";

export interface TouchlineSession {
  version: number;
  careerId: string | null;
  activeTab: AppTab;
  theme: ThemeMode;
  onboardingComplete: boolean;
  formationId: string;
  savePath: string | null;
  saveId: string | null;
  clubName: string;
  clubLogoUrl: string;
  managerName: string;
  /**
   * The storyline whose evidence view is open, if any.
   *
   * Level-2 detail lives in the shell rather than at a route, so this field is what lets a refresh
   * land back on the thread the manager was reading instead of dropping them on the dashboard.
   * Cleared when the view closes.
   */
  openStorylineId: string | null;
}

export const DEFAULT_SESSION: TouchlineSession = {
  version: SESSION_VERSION,
  careerId: null,
  activeTab: "LANDING",
  theme: "light",
  onboardingComplete: false,
  formationId: "4-3-3-holding",
  savePath: null,
  saveId: null,
  clubName: "",
  clubLogoUrl: "",
  managerName: "",
  openStorylineId: null,
};

export function isAppTab(value: unknown): value is AppTab {
  return typeof value === "string" && (APP_TABS as readonly string[]).includes(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads and validates the stored session. Returns null for anything untrustworthy. */
export function readSession(): TouchlineSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<TouchlineSession>;
    if (candidate.version !== SESSION_VERSION) {
      // Unknown/legacy shape: drop it rather than hydrating a half-valid state.
      clearSession();
      return null;
    }

    return {
      version: SESSION_VERSION,
      careerId: asNullableString(candidate.careerId),
      activeTab: isAppTab(candidate.activeTab) ? candidate.activeTab : "LANDING",
      theme:
        candidate.theme === "dark" || candidate.theme === "light" || candidate.theme === "system"
          ? candidate.theme
          : DEFAULT_SESSION.theme,
      onboardingComplete: candidate.onboardingComplete === true,
      formationId: asString(candidate.formationId, DEFAULT_SESSION.formationId),
      savePath: asNullableString(candidate.savePath),
      saveId: asNullableString(candidate.saveId),
      clubName: asString(candidate.clubName),
      clubLogoUrl: asString(candidate.clubLogoUrl),
      managerName: asString(candidate.managerName),
      openStorylineId: asNullableString(candidate.openStorylineId),
    };
  } catch {
    return null;
  }
}

/** Best-effort write; private-mode / quota failures must never break the app. */
export function writeSession(session: TouchlineSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — session simply will not persist */
  }
}

export function patchSession(patch: Partial<TouchlineSession>): void {
  const current = readSession() ?? DEFAULT_SESSION;
  writeSession({ ...current, ...patch, version: SESSION_VERSION });
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Dismissed dashboard cards
//
// A dismissal is a VIEW preference, not career data, so it lives in localStorage beside the rest of
// the session state rather than in the database - where it would need a table, an API field and a
// place in every hydration payload to say the same thing. It uses its OWN key so that rewriting the
// session (which happens on every tab change) can never drop it.
//
// Keyed BY careerId, because a dismissal is a statement about one career's threads: switching saves
// must not hide a new career's cards just because two threads happen to share an id.
//
// The ordering this solves: the dashboard re-fetches `/api/career` on every load AND after every
// debrief, and each fetch returns the full lists again. So a dismissal can only ever be applied at
// RENDER time by filtering the hydrated arrays - never by mutating the payload.
// ---------------------------------------------------------------------------

const DISMISSED_STORAGE_KEY = "touchline.dismissed.v1";

export interface DismissedState {
  storylines: string[];
  events: string[];
}

const EMPTY_DISMISSED: DismissedState = { storylines: [], events: [] };

function readAllDismissed(): Record<string, DismissedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, DismissedState>) : {};
  } catch {
    return {};
  }
}

function writeAllDismissed(all: Record<string, DismissedState>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(all));
    for (const listener of [...dismissedListeners]) listener();
  } catch {
    /* storage unavailable — the dismissal simply will not persist */
  }
}

let dismissedListeners: Array<() => void> = [];

/** Lets `useSyncExternalStore` re-render the dashboard the moment a card is dismissed. */
export function subscribeDismissed(listener: () => void): () => void {
  dismissedListeners.push(listener);
  return () => {
    dismissedListeners = dismissedListeners.filter((entry) => entry !== listener);
  };
}

/**
 * The raw stored string, which is a primitive: `useSyncExternalStore` compares snapshots by
 * identity, so building a fresh object here would re-render forever.
 */
export function getDismissedSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Parses one career's dismissals out of a snapshot. Never throws on a corrupt store. */
export function dismissedForCareer(raw: string | null, careerId: string | null): DismissedState {
  if (!raw || !careerId) return EMPTY_DISMISSED;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<DismissedState>> | null;
    const entry = parsed?.[careerId];
    if (!entry) return EMPTY_DISMISSED;
    return {
      storylines: Array.isArray(entry.storylines)
        ? entry.storylines.filter((id): id is string => typeof id === "string")
        : [],
      events: Array.isArray(entry.events)
        ? entry.events.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return EMPTY_DISMISSED;
  }
}

export function dismissStoryline(careerId: string, storylineId: string): void {
  const all = readAllDismissed();
  const current = all[careerId] ?? EMPTY_DISMISSED;
  if (current.storylines.includes(storylineId)) return;
  all[careerId] = { ...current, storylines: [...current.storylines, storylineId] };
  writeAllDismissed(all);
}

export function dismissEvent(careerId: string, eventId: string): void {
  const all = readAllDismissed();
  const current = all[careerId] ?? EMPTY_DISMISSED;
  if (current.events.includes(eventId)) return;
  all[careerId] = { ...current, events: [...current.events, eventId] };
  writeAllDismissed(all);
}

/** Puts every dismissed card back. Scoped to one career, like the dismissals themselves. */
export function restoreDismissed(careerId: string): void {
  const all = readAllDismissed();
  if (!all[careerId]) return;
  all[careerId] = { ...EMPTY_DISMISSED };
  writeAllDismissed(all);
}

// ---------------------------------------------------------------------------
// Seen markers
// ---------------------------------------------------------------------------
//
// A count badge on a section behaves like an app notification: it counts what has arrived since the
// manager last looked, and looking is what clears it.
//
// Stored as a per-surface TIMESTAMP rather than a list of seen ids, which keeps the store bounded -
// a career that runs for ten seasons accumulates nothing here. It also means the badge is honest
// about arrival time rather than about which ids happened to be rendered.

const SEEN_STORAGE_KEY = "touchline.seen.v1";

export type SeenSurface = "STORYLINES" | "TIMELINE";
type SeenState = Partial<Record<SeenSurface, string>>;

/** Never looked at - everything counts as new. */
const NEVER = 0;

function readAllSeen(): Record<string, SeenState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, SeenState>) : {};
  } catch {
    return {};
  }
}

function writeAllSeen(all: Record<string, SeenState>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(all));
    for (const listener of [...seenListeners]) listener();
  } catch {
    /* storage unavailable - the marker simply will not persist */
  }
}

let seenListeners: Array<() => void> = [];

/** Lets a badge re-render the moment its section is marked as looked at. */
export function subscribeSeen(listener: () => void): () => void {
  seenListeners.push(listener);
  return () => {
    seenListeners = seenListeners.filter((entry) => entry !== listener);
  };
}

/** The raw stored string: a primitive, so `useSyncExternalStore` can compare snapshots safely. */
export function getSeenSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * One career's markers as epoch milliseconds.
 *
 * A surface that has never been opened resolves to 0, so everything in it reads as new - which is
 * the right first impression for a manager who has just synced their first save.
 */
export function seenForCareer(
  raw: string | null,
  careerId: string | null
): Record<SeenSurface, number> {
  const never = { STORYLINES: NEVER, TIMELINE: NEVER };
  if (!raw || !careerId) return never;
  try {
    const parsed = JSON.parse(raw) as Record<string, SeenState> | null;
    const entry = parsed?.[careerId];
    if (!entry) return never;
    const at = (value: string | undefined) => {
      const parsedDate = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(parsedDate) ? parsedDate : NEVER;
    };
    return { STORYLINES: at(entry.STORYLINES), TIMELINE: at(entry.TIMELINE) };
  } catch {
    return never;
  }
}

/** Records that the manager has looked at a surface now. */
export function markSeen(careerId: string | null, surface: SeenSurface, at?: string): void {
  if (!careerId) return;
  const all = readAllSeen();
  all[careerId] = { ...(all[careerId] ?? {}), [surface]: at ?? new Date().toISOString() };
  writeAllSeen(all);
}

/**
 * Counts items that arrived after the manager last looked.
 *
 * An item with no usable timestamp is treated as NOT new rather than as new, because the opposite
 * default would produce a badge that can never be cleared.
 */
export function countUnseen(
  timestamps: Array<string | null | undefined>,
  since: number
): number {
  let count = 0;
  for (const value of timestamps) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > since) count += 1;
  }
  return count;
}

/** Resolves a stored preference into the concrete theme currently in effect. */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeClass(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(mode) === "dark");
}

/**
 * Subscribes to operating-system theme changes. Callers should only subscribe while the stored
 * mode is `"system"` - an explicit choice must never be overridden by the OS.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => onChange();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/**
 * Pre-paint script: applies the stored theme before the document first paints.
 *
 * `"system"` has to be resolved with matchMedia here rather than in React, otherwise a dark-OS
 * user choosing "system" would see a light flash on every load.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
  SESSION_STORAGE_KEY
)});var s=raw?JSON.parse(raw):null;var mode=s&&s.theme?s.theme:"light";var dark=mode==="dark"||(mode==="system"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark){document.documentElement.classList.add("dark");}}catch(e){}})();`;
