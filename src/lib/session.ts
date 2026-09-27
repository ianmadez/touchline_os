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
  | "SQUAD"
  | "TACTICS"
  | "TIMELINE"
  | "DEBRIEF"
  | "SETTINGS";

export const APP_TABS: readonly AppTab[] = [
  "LANDING",
  "PORTAL",
  "DASHBOARD",
  "SQUAD",
  "TACTICS",
  "TIMELINE",
  "DEBRIEF",
  "SETTINGS",
] as const;

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
