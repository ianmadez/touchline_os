"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navbar } from "@/components/ui/nav/navbar";
import { LandingPage } from "@/components/ui/landing/landing-page";
import { Footer } from "@/components/ui/landing/footer";
import { OnboardingWizard, OnboardingSubmission } from "@/components/ui/onboarding/onboarding-wizard";
import { SquadView } from "@/components/ui/squad/squad-view";
import { PlayerDrawer } from "@/components/ui/squad/player-drawer";
import { LandingFooter } from "@/components/ui/landing/landing-footer";
import { Pitch2D } from "@/components/ui/squad/pitch-2d";
import { DashboardView } from "@/components/ui/dashboard/dashboard-view";
import { GroupDebriefPrompt } from "@/components/ui/dashboard/group-debrief-prompt";
import { SeasonView } from "@/components/ui/season/season-view";
import type { SeasonSubTab } from "@/lib/ui/labels";
import { StorylineEvidence } from "@/components/ui/dashboard/storyline-evidence";
import { DebriefView } from "@/components/ui/debrief/debrief-view";
import { FinanceView } from "@/components/ui/finance/finance-view";
import { SettingsView, Diagnostics, ActionResult } from "@/components/ui/settings/settings-view";
import { SquadTableSkeleton } from "@/components/ui/skeleton";
import type { SaveCandidate } from "@/lib/parser/interface";
import type { EnrichedPlayer } from "@/lib/services/squad-service";
import type { PitchSlotAssignment, TacticalSystemState } from "@/lib/services/tactics-service";
import type { CareerHydrationPayload, LeagueTeamSummary } from "@/lib/services/career-service";
import type { SeasonState } from "@/lib/services/season-service";
import type { PlayerValuation } from "@/lib/services/value-service";
import { currencySymbolFor } from "@/lib/ui/format";
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import type { StorylineItem } from "@/lib/events/types";
import { LegalModal, LegalDocType } from "@/components/ui/landing/legal-modal";
import {
  AppTab,
  DEFAULT_SESSION,
  TAB_RESTORE_REDIRECT,
  ThemeMode,
  applyThemeClass,
  clearSession,
  patchSession,
  readSession,
  resolveTheme,
  watchSystemTheme,
} from "@/lib/session";
import type { AppSettingsPatch, ClientAppSettings } from "@/lib/settings-vocabulary";

import { apiFetch } from "@/lib/platform/api-client";
interface HydrationResponse extends Partial<CareerHydrationPayload> {
  success: boolean;
  error?: string;
  warnings?: string[];
  /** Sync-only fields returned by POST /api/parse-save (not part of the hydration payload). */
  syncStatus?: string;
  snapshotNumber?: number;
  eventsEmitted?: number;
  syncEvents?: Array<{ eventType: string; payload: unknown }>;
  saveFileName?: string;
}

/** Summary of the sync run from the entry splash, shown before the manager steps inside. */
interface EntrySyncSummary {
  status: string;
  snapshotNumber: number | null;
  eventsEmitted: number;
  events: Array<{ eventType: string; payload: unknown }>;
  warnings: string[];
  fileName: string;
}

/** Must stay in sync with `.animate-page-out` in globals.css. */
const TAB_FADE_OUT_MS = 170;

/**
 * Which of the three surfaces is showing: the landing site, the setup wizard, or the app shell.
 *
 * One value rather than a handful of booleans, because "which surface am I on" was previously
 * inferred from the combination of `displayedTab`, `isRestoring`, `isOnboardingComplete` and
 * `hasEntered` - which is what let the app paint the landing page on its way to the dashboard, and
 * what let an unresolved onboarding flag route a set-up manager back into the wizard.
 */
type BootPhase = "booting" | "landing" | "portal" | "app";

export default function TouchlineApp() {
  const [activeTab, setActiveTab] = useState<AppTab>("LANDING");
  // The tab actually rendered. `activeTab` stays the immediate source of truth (navbar highlight,
  // session persistence), while the visible panel swaps one fade later so a tab change reads as
  // fade-out -> swap -> fade-in instead of an instant replacement.
  const [displayedTab, setDisplayedTab] = useState<AppTab>("LANDING");
  //
  // Set when something OUTSIDE the Season screen sends the manager to a particular inner tab - the
  // board objective thread's card. Cleared on every other navigation, so it applies to that arrival
  // and does not silently decide the Season tab for the rest of the session.
  const [seasonFocus, setSeasonFocus] = useState<SeasonSubTab | null>(null);
  const [tabPhase, setTabPhase] = useState<"in" | "out">("in");
  const tabSwapTimeout = useRef<number | null>(null);

  // Entry splash: the branded screen that carries the save-sync prompt. `hasEntered` stays false
  // until the manager steps inside and is re-armed whenever they return to the landing page or
  // portal, so a landing -> app transition can never skip the splash.
  const [hasEntered, setHasEntered] = useState(false);
  const [entrySync, setEntrySync] = useState<EntrySyncSummary | null>(null);
  const [entrySyncError, setEntrySyncError] = useState<string | null>(null);

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Navigates between in-app pages with a fade. Repeated clicks mid-fade retarget the pending swap
   * rather than queueing, so a rapid sequence of clicks still ends on the last tab chosen.
   */
  const switchTab = (next: AppTab) => {
    // An onboarded manager must never be routed back into the setup wizard.
    const portalResolved = next === "PORTAL" && isOnboardingComplete ? "DASHBOARD" : next;
    // A tab that has since been folded into another section must land on its new home - this covers
    // the navbar, a dashboard link and a restored session with one rule, so a stale destination can
    // never leave the manager staring at an empty screen.
    const effectiveNext = TAB_RESTORE_REDIRECT[portalResolved] ?? portalResolved;

    setActiveTab(effectiveNext);
    // LANDING and PORTAL sit outside the app shell, so arriving there re-arms the entry splash.
    if (effectiveNext === "LANDING" || effectiveNext === "PORTAL") {
      setHasEntered(false);
      setBootPhase(effectiveNext === "LANDING" ? "landing" : "portal");
      setDisplayedTab(effectiveNext);
      setTabPhase("in");
      return;
    }
    setBootPhase("app");
    if (effectiveNext === displayedTab) return;

    if (prefersReducedMotion()) {
      setDisplayedTab(effectiveNext);
      setTabPhase("in");
      return;
    }

    setTabPhase("out");
    if (tabSwapTimeout.current !== null) window.clearTimeout(tabSwapTimeout.current);
    tabSwapTimeout.current = window.setTimeout(() => {
      setDisplayedTab(effectiveNext);
      setTabPhase("in");
      tabSwapTimeout.current = null;
    }, TAB_FADE_OUT_MS);
  };

  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  // Starts as "booting" and stays there until the server has answered. Nothing is painted before
  // that, so the first paint never has to guess which surface the manager should see.
  const [bootPhase, setBootPhase] = useState<BootPhase>("booting");
  // Set only when the boot request failed in a way that leaves the answer UNKNOWN - a 5xx or a
  // dropped connection. Unknown is not the same as "not onboarded", and must never clear stored state.
  const [bootError, setBootError] = useState<string | null>(null);
  const [saveCandidates, setSaveCandidates] = useState<SaveCandidate[]>([]);
  const [saveScanComplete, setSaveScanComplete] = useState(false);
  const [savesUnavailableReason, setSavesUnavailableReason] = useState<string | null>(null);
  const [saveSourceMode, setSaveSourceMode] = useState<"folders" | "picker">("folders");
  const [squad, setSquad] = useState<EnrichedPlayer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<EnrichedPlayer | null>(null);
  // The storyline whose evidence view is open. Kept in the session as well, so a refresh lands
  // back on the thread instead of dropping the manager on the dashboard.
  const [selectedStorylineId, setSelectedStorylineId] = useState<string | null>(null);
  const [tacticsSlots, setTacticsSlots] = useState<PitchSlotAssignment[]>([]);
  const [formationId, setFormationId] = useState<string>(DEFAULT_SESSION.formationId);
  const [formations, setFormations] = useState<TacticalSystemState[]>([]);
  const [activeFormationLabel, setActiveFormationLabel] = useState<string>("Primary");
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocType>(null);
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_SESSION.theme);
  // The theme actually painted. `theme` may be "system", so anything visual (the navbar icon in
  // particular) must read this instead of the stored preference.
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Settings and storage diagnostics for the Settings tab.
  const [appSettings, setAppSettings] = useState<ClientAppSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  // Guards the ON_LAUNCH auto-sync so it can only ever fire once per page load.
  const autoSyncAttempted = useRef(false);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [careerId, setCareerId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ParsedCareerEvent[]>([]);
  const [storylines, setStorylines] = useState<StorylineItem[]>([]);
  // The clubs in the manager's division, so opponents can be picked by name rather than typed.
  const [leagueTeams, setLeagueTeams] = useState<LeagueTeamSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [lastSubmission, setLastSubmission] = useState<OnboardingSubmission | null>(null);
  const [careerInfo, setCareerInfo] = useState<{
    managerName: string;
    clubName: string;
    clubLogoUrl: string;
    season: number | null;
    inGameDate: string | null;
  }>({
    managerName: "",
    clubName: "",
    clubLogoUrl: "",
    season: null,
    inGameDate: null,
  });

  const [seasonState, setSeasonState] = useState<SeasonState | null>(null);
  const [valuations, setValuations] = useState<Record<number, PlayerValuation>>({});

  const applyHydration = useCallback((payload: Partial<CareerHydrationPayload>) => {
    if (Array.isArray(payload.players)) setSquad(payload.players);
    if (Array.isArray(payload.tacticsSlots)) setTacticsSlots(payload.tacticsSlots);
    if (Array.isArray(payload.recentEvents)) setTimeline(payload.recentEvents);
    if (Array.isArray(payload.storylines)) setStorylines(payload.storylines);
    if (Array.isArray(payload.leagueTeams)) setLeagueTeams(payload.leagueTeams);
    if (payload.seasonState) setSeasonState(payload.seasonState);
    if (payload.valuations) setValuations(payload.valuations);
    if (typeof payload.formationId === "string" && payload.formationId) {
      setFormationId(payload.formationId);
    }
    const incomingFormations = payload.formations;
    if (Array.isArray(incomingFormations) && incomingFormations.length > 0) {
      setFormations(incomingFormations);
      // Keep the tab the manager is already on when it still exists, so a save does not yank them
      // back to the current XI; otherwise fall back to whichever formation IS the current XI.
      setActiveFormationLabel((current) =>
        incomingFormations.some((formation) => formation.label === current)
          ? current
          : (incomingFormations.find((formation) => formation.isDefault) ?? incomingFormations[0])
              .label
      );
    }
    if (typeof payload.careerId === "string" && payload.careerId) {
      setCareerId(payload.careerId);
    }
    // The club badge is USER data persisted with the onboarding profile. Hydration must only ever
    // fill it in, never blank it - the payload legitimately omits it for a career with no
    // onboarding row, and it used to wipe a locally-held badge on every single hydration.
    const persistedBadge = payload.onboarding?.clubLogoUrl ?? null;
    setCareerInfo((prev) => ({
      managerName: payload.managerName ?? "",
      clubName: payload.clubName ?? "",
      clubLogoUrl: persistedBadge ?? prev.clubLogoUrl,
      // The season and in-game date the save actually carries. These used to be hardcoded to 1 and
      // null at the DashboardView call site, so the hero read "Season 1" forever and never showed
      // a date even though the parser had derived both.
      season: payload.season ?? prev.season,
      inGameDate: payload.inGameDate ?? prev.inGameDate,
    }));
    // State setters are stable for the lifetime of the component, so declaring them keeps this
    // callback's identity stable (the boot effects depend on it) while satisfying the React
    // Compiler's rule that every inferred dependency must be declared.
  }, [
    setSquad,
    setTacticsSlots,
    setTimeline,
    setStorylines,
    setLeagueTeams,
    setSeasonState,
    setValuations,
    setFormationId,
    setFormations,
    setActiveFormationLabel,
    setCareerId,
    setCareerInfo,
  ]);

  const loadSaveCandidates = useCallback(async () => {
    setSaveScanComplete(false);
    try {
      const res = await apiFetch("/api/saves", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `Save scan failed (HTTP ${res.status}).`);
      }
      const candidates = (data.saves ?? []) as Array<
        Omit<SaveCandidate, "lastModified"> & { lastModified: string }
      >;
      setSavesUnavailableReason(
        typeof data.unavailableReason === "string" ? data.unavailableReason : null
      );
      setSaveSourceMode(data.saveSourceMode === "picker" ? "picker" : "folders");
      setSaveCandidates(
        candidates.map((candidate) => ({
          ...candidate,
          lastModified: new Date(candidate.lastModified),
        }))
      );
    } catch (error) {
      setSaveCandidates([]);
      setAppError((error as Error).message);
    } finally {
      setSaveScanComplete(true);
    }
    // Setters are stable, so declaring them keeps this callback's identity stable.
  }, [
    setSaveCandidates,
    setSaveScanComplete,
    setSavesUnavailableReason,
    setSaveSourceMode,
    setAppError,
  ]);

  // Restore persisted session and prevent re-entering onboarding wizard if career exists
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const session = readSession();

      if (session) {
        setTheme(session.theme);
        applyThemeClass(session.theme);
        setFormationId(session.formationId);
        setCareerInfo({
          managerName: session.managerName,
          clubName: session.clubName,
          clubLogoUrl: session.clubLogoUrl || "",
          // Not carried in localStorage: the server is the source of truth for these, and it is
          // asked unconditionally a moment later.
          season: null,
          inGameDate: null,
        });
        setIsOnboardingComplete(session.onboardingComplete);
      }

      // Always ask the server, even with no stored career id: with no id, GET /api/career returns the
      // most recently updated career. Onboarding completion therefore reflects what is actually in
      // the database rather than localStorage, so clearing site data (or opening a different browser)
      // can no longer drop an already set-up manager back into the onboarding wizard.
      setIsLoading(true);
      try {
        const query = session?.careerId
          ? `?careerId=${encodeURIComponent(session.careerId)}`
          : "";
        const res = await apiFetch(`/api/career${query}`, { cache: "no-store" });
        const data: HydrationResponse = await res.json();
        if (cancelled) return;

        if (res.ok && data.success) {
          applyHydration(data);
          setIsOnboardingComplete(true);
          // Restore the stored active tab if valid for the app shell, defaulting to DASHBOARD. A
          // tab that has since been folded into another section (Timeline -> Settings) is rewritten
          // to its new home rather than restored to a slot that no longer exists.
          const restoredTab =
            session?.activeTab &&
            session.activeTab !== "LANDING" &&
            session.activeTab !== "PORTAL"
              ? (TAB_RESTORE_REDIRECT[session.activeTab] ?? session.activeTab)
              : "DASHBOARD";
          setActiveTab(restoredTab);
          setDisplayedTab(restoredTab);
          setBootPhase("app");
          // Reopen the thread the manager was reading, if it still exists. A stale id resolves to
          // null and simply shows nothing - it is never an error.
          setSelectedStorylineId(session?.openStorylineId ?? null);
          patchSession({
            careerId: data.careerId ?? null,
            onboardingComplete: true,
            activeTab: "DASHBOARD",
          });
        } else if (res.status === 404) {
          // The server definitively says no career exists. This is the ONLY response allowed to
          // clear the stored onboarding flag.
          setCareerId(null);
          setIsOnboardingComplete(false);
          setSquad([]);
          setTacticsSlots([]);
          setTimeline([]);
          setActiveTab("LANDING");
          setDisplayedTab("LANDING");
          setBootPhase("landing");
          patchSession({ careerId: null, onboardingComplete: false, activeTab: "LANDING" });
        } else {
          // A 5xx or a malformed response. The answer is UNKNOWN, not "no career", so stored state
          // is left exactly as it is and the phase stays "booting" with a retry offered. Clearing
          // the flag here is what used to drop an already set-up manager back into the wizard after
          // a single failed request - and we have seen a genuine 500 from a missing table.
          // The server's own message is a raw Error string, so it goes to the console rather than
          // the screen.
          console.error("[boot] career hydration failed:", data.error);
          setBootError("We couldn't load your career data.");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[boot] career request failed:", error);
          setBootError("We couldn't reach the server.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      if (cancelled) return;
      setIsRestoring(false);
      void loadSaveCandidates();
    })();

    return () => {
      cancelled = true;
    };
  }, [applyHydration, loadSaveCandidates]);

  useEffect(() => {
    if (isRestoring) return;
    patchSession({
      careerId,
      activeTab,
      theme,
      onboardingComplete: isOnboardingComplete,
      formationId,
      clubName: careerInfo.clubName,
      clubLogoUrl: careerInfo.clubLogoUrl,
      managerName: careerInfo.managerName,
    });
  }, [isRestoring, careerId, activeTab, theme, isOnboardingComplete, formationId, careerInfo]);

  // Safety guard: if onboarding is marked complete while PORTAL is displayed, route immediately to DASHBOARD.
  useEffect(() => {
    if (isOnboardingComplete && (displayedTab === "PORTAL" || activeTab === "PORTAL")) {
      setActiveTab("DASHBOARD");
      setDisplayedTab("DASHBOARD");
      setBootPhase("app");
      setHasEntered(true);
    }
  }, [isOnboardingComplete, displayedTab, activeTab]);

  // Applies the stored preference, and while it is "system" follows OS changes live.
  useEffect(() => {
    const apply = () => {
      applyThemeClass(theme);
      setResolvedTheme(resolveTheme(theme));
    };
    apply();

    if (theme !== "system") return;
    return watchSystemTheme(apply);
  }, [theme]);

  /** Sets an explicit theme preference (from the Settings tab). */
  const handleSetTheme = (mode: ThemeMode) => {
    setTheme(mode);
  };

  /**
   * The navbar's quick flip. From "system" it switches to the opposite of what is currently on
   * screen, so the button always does what the icon implies.
   */
  const toggleTheme = () => {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  };

  /** Newest detected save by modification time - what "sync latest save" acts on. */
  const latestSaveCandidate = useMemo(() => {
    if (saveCandidates.length === 0) return null;
    return [...saveCandidates].sort(
      (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
    )[0];
  }, [saveCandidates]);

  /**
   * Syncs the newest save from the entry gate. Deliberately sends no `onboarding` payload, so a
   * routine re-sync can never overwrite the manager profile captured during setup.
   */
  const handleEntrySync = useCallback(async () => {
    if (!latestSaveCandidate) return;
    setIsLoading(true);
    setEntrySyncError(null);

    try {
      const res = await apiFetch("/api/parse-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savePath: latestSaveCandidate.filePath,
          saveId: latestSaveCandidate.id,
        }),
      });
      const payload: HydrationResponse = await res
        .json()
        .catch(() => ({ success: false }) as HydrationResponse);

      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? `Sync failed (HTTP ${res.status}).`);
      }

      applyHydration(payload);
      setIsOnboardingComplete(true);
      patchSession({
        savePath: latestSaveCandidate.filePath,
        saveId: latestSaveCandidate.id,
        careerId: payload.careerId ?? null,
        onboardingComplete: true,
      });

      setEntrySync({
        status: payload.syncStatus ?? "SYNCED",
        snapshotNumber: payload.snapshotNumber ?? payload.latestSnapshotNumber ?? null,
        eventsEmitted: payload.eventsEmitted ?? 0,
        events: payload.syncEvents ?? [],
        warnings: payload.warnings ?? [],
        fileName: payload.saveFileName ?? latestSaveCandidate.fileName,
      });

      // Re-scan so the gate shows the freshly touched file's mtime/size.
      void loadSaveCandidates();
    } catch (error) {
      setEntrySyncError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [
    latestSaveCandidate,
    applyHydration,
    loadSaveCandidates,
    setEntrySync,
    setEntrySyncError,
    setIsLoading,
    setIsOnboardingComplete,
  ]);

  // ON_LAUNCH: run the entry sync automatically, once, as soon as the splash has a save to act on.
  useEffect(() => {
    if (autoSyncAttempted.current) return;
    if (!isOnboardingComplete || hasEntered || isRestoring || isLoading) return;
    if (appSettings?.syncTrigger !== "ON_LAUNCH") return;
    if (!saveScanComplete || !latestSaveCandidate) return;
    autoSyncAttempted.current = true;
    // Deferred by a frame for two reasons: the sync's own setIsLoading(true) would otherwise be a
    // synchronous setState inside this effect (React flags that as a cascading render), and the
    // splash gets to paint before the spinner appears.
    const timer = window.setTimeout(() => void handleEntrySync(), 0);
    return () => window.clearTimeout(timer);
  }, [
    appSettings,
    isOnboardingComplete,
    hasEntered,
    isRestoring,
    isLoading,
    saveScanComplete,
    latestSaveCandidate,
    handleEntrySync,
  ]);

  /** Loads the persisted settings once on mount. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/settings", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
        setAppSettings(data.settings as ClientAppSettings);
      } catch (error) {
        if (!cancelled) setSettingsError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const res = await apiFetch("/api/diagnostics", { cache: "no-store" });
      // A route that fails before its handler runs answers with a 500 and an empty body, so
      // `res.json()` would surface the browser's own "unexpected end of data" message instead of
      // the status that actually explains the failure.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDiagnostics(data as Diagnostics);
      // Cleared on success rather than up-front, so this function has no synchronous setState and
      // can be safely called from an effect.
      setDiagnosticsError(null);
    } catch (error) {
      setDiagnosticsError((error as Error).message);
    }
  }, [setDiagnostics, setDiagnosticsError]);

  // Storage numbers change with every sync, so re-read them whenever Settings becomes visible.
  useEffect(() => {
    if (displayedTab !== "SETTINGS" || !isOnboardingComplete) return;
    // Deferred for the same reason as the launch sync: calling refreshDiagnostics directly would
    // be a synchronous setState inside the effect body.
    const timer = window.setTimeout(() => void refreshDiagnostics(), 0);
    return () => window.clearTimeout(timer);
  }, [displayedTab, isOnboardingComplete, refreshDiagnostics]);

  const handleUpdateSetting = async (field: string, patch: AppSettingsPatch) => {
    setSavingField(field);
    setSettingsError(null);
    try {
      const res = await apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAppSettings(data.settings as ClientAppSettings);
    } catch (error) {
      setSettingsError((error as Error).message);
    } finally {
      setSavingField(null);
    }
  };

  const handleExportCareer = async (): Promise<ActionResult> => {
    if (!careerId) return { ok: false, message: "No active career to export." };
    try {
      const res = await apiFetch(
        `/api/career/export?careerId=${encodeURIComponent(careerId)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Delivered HERE, for both builds, instead of inside the platform layer.
      //
      // `assetStore.writeExport` is a build-time switch point: the Node build wrote the file to
      // `data/exports/` and returned a path, while the browser build triggered the download itself.
      // So on a local server, clicking Export produced a file on disk and nothing in the browser -
      // which reads as "the button does nothing", and was reported as exactly that. Downloading here
      // means the user gets the file in both runtimes; the local build additionally keeps its copy.
      const contents = typeof data.contents === "string" ? data.contents : null;
      if (!contents) throw new Error("The export produced no file contents to download.");

      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Released on the next task, once the download has been handed to the browser.
      setTimeout(() => URL.revokeObjectURL(url), 0);

      const counts = (data.counts ?? {}) as Record<string, number>;
      const rows = Object.values(counts).reduce((total, value) => total + value, 0);
      // Only mentioned when it is a real path. In the browser build `filePath` is just the file name,
      // and telling a manager his download is "also at career_club_1917_....json" is noise.
      const serverCopy =
        typeof data.filePath === "string" && data.filePath !== data.fileName
          ? data.filePath
          : null;
      return {
        ok: true,
        message: `Downloaded ${data.fileName} — ${data.counts.career_snapshots} snapshot(s), ${data.counts.career_events} event(s), ${rows.toLocaleString()} rows across ${Object.keys(counts).length} tables (${(data.sizeBytes / (1024 * 1024)).toFixed(1)} MB).${serverCopy ? ` A copy is also kept on the server at ${serverCopy}.` : ""}`,
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  };

  /**
   * Applies a career backup the manager picked in Settings.
   *
   * The mirror of `handleExportCareer`: one file, chosen by hand, in the format the export writes.
   * Nothing is read from disk on the app's own initiative and nothing transfers automatically.
   */
  const handleImportCareer = async (contents: string): Promise<ActionResult> => {
    try {
      const res = await apiFetch("/api/career/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: contents,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      // The career arrived without a page reload, so the shell has to be told about it: hydrate from
      // the operation's own follow-up, or the manager would be looking at the career that was there
      // before the import.
      const hydrated = await apiFetch(
        `/api/career?careerId=${encodeURIComponent(data.careerId)}`,
        { cache: "no-store" }
      );
      const payload: HydrationResponse = await hydrated.json();
      if (hydrated.ok && payload.success) {
        applyHydration(payload);
        setIsOnboardingComplete(true);
      }

      const counts = (data.imported ?? {}) as Record<string, number>;
      const tables = Object.values(counts).filter((value) => value > 0).length;
      const rows = Object.values(counts).reduce((total, value) => total + value, 0);
      return {
        ok: true,
        message: `${data.replaced ? "Replaced" : "Imported"} ${data.careerId} — ${tables} tables, ${rows.toLocaleString()} rows.`,
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  };

  const handleResetCareer = async (): Promise<ActionResult> => {
    if (!careerId) return { ok: false, message: "No active career to reset." };
    try {
      const res = await apiFetch(`/api/career?careerId=${encodeURIComponent(careerId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      // The career row is gone, so every client-side trace of it must go as well - otherwise the
      // app would keep showing squad rows that no longer exist in the database.
      clearSession();
      setCareerId(null);
      setSquad([]);
      setTacticsSlots([]);
      setTimeline([]);
      setStorylines([]);
      setLastSubmission(null);
      setIsOnboardingComplete(false);
      setDiagnostics(null);
      setEntrySync(null);
      setHasEntered(false);
      switchTab("LANDING");
      return {
        ok: true,
        message: "Career data removed. Connect a save again from the portal when you are ready.",
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  };

  const handleCompleteOnboarding = async (data: OnboardingSubmission) => {
    setLastSubmission(data);
    setIsLoading(true);
    setAppError(null);
    setStatusMessage(null);

    try {
      const res = await apiFetch("/api/parse-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savePath: data.selectedSave.filePath,
          saveId: data.selectedSave.id,
          onboarding: {
            managerName: data.managerName,
            nationality: data.nationality,
            tacticalPhilosophy: data.tacticalPhilosophy,
            favFormations: data.favFormations,
            managerObjective: data.managerObjective,
            boardObjective: data.boardObjective,
            personalObjective: data.personalObjective,
            clubLogoUrl: data.clubLogoUrl,
          },
        }),
      });
      const payload: HydrationResponse = await res
        .json()
        .catch(() => ({ success: false }) as HydrationResponse);

      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? `Save parsing failed (HTTP ${res.status}).`);
      }

      applyHydration(payload);

      // Realism is app-level settings rather than anything the save carries, so it is written through
      // the settings endpoint instead of riding along in the parse payload. Deliberately after a
      // successful parse: a failed parse should not leave a preference behind from an onboarding that
      // never completed. Failure is swallowed because a settings write is not worth failing the
      // onboarding over - the manager can still set it in Settings.
      await apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realismLevel: data.realismLevel }),
      }).catch(() => null);

      setIsOnboardingComplete(true);
      setActiveTab("DASHBOARD");
      setDisplayedTab("DASHBOARD");
      setBootPhase("app");
      patchSession({
        savePath: data.selectedSave.filePath,
        saveId: data.selectedSave.id,
        careerId: payload.careerId ?? null,
        onboardingComplete: true,
        activeTab: "DASHBOARD",
      });

      if (data.clubLogoUrl) {
        setCareerInfo((prev) => ({ ...prev, clubLogoUrl: data.clubLogoUrl }));
      }

      const playerCount = Array.isArray(payload.players) ? payload.players.length : 0;
      setStatusMessage(
        `Synced ${data.selectedSave.fileName} · ${playerCount} squad member${
          playerCount === 1 ? "" : "s"
        } indexed · snapshot #${payload.latestSnapshotNumber ?? 1}${
          payload.warnings?.length ? ` · ${payload.warnings.length} parser warning(s)` : ""
        }`
      );

      // The splash re-appears on its own: onboarding is complete but `hasEntered` is still false.
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePlayerProfile = (profileData: {
    eaPlayerId: number;
    assignedRole: string;
    trustLevel: "HIGH" | "MEDIUM" | "LOW";
    importanceMarker: "UNTOUCHABLE" | "KEY_PLAYER" | "ROTATION" | "SURPLUS";
    userNotes: string;
    primaryPosition: string | null;
  }) => {
    setSquad((prev) =>
      prev.map((p) => {
        if (p.eaPlayerId === profileData.eaPlayerId) {
          return {
            ...p,
            // Apply the override optimistically so the table updates without a refetch.
            primaryPosition: profileData.primaryPosition ?? p.primaryPosition,
            userProfile: {
              assignedRole: profileData.assignedRole,
              trustLevel: profileData.trustLevel,
              importanceMarker: profileData.importanceMarker,
              userNotes: profileData.userNotes,
              positionOverride: profileData.primaryPosition,
            },
          };
        }
        return p;
      })
    );

    const targetCareerId = careerId;
    if (!targetCareerId) return;
    void apiFetch("/api/career", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ careerId: targetCareerId, playerProfile: profileData }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Saving player notes failed (HTTP ${res.status}).`);
      })
      .catch((error: Error) => setAppError(error.message));
  };

  /**
   * Closes the evidence view and forgets it in the session.
   *
   * Stable across renders because the view subscribes to it for its Escape handler; a new function
   * every render would make that subscription churn for no reason.
   */
  const handleCloseStoryline = useCallback(() => {
    setSelectedStorylineId(null);
    patchSession({ openStorylineId: null });
  }, [setSelectedStorylineId]);

  /**
   * Saves the slots of ONE formation. `label` selects which, so editing a Plan B can never touch the
   * current XI - or any other formation.
   */
  const handleSaveTactics = (
    label: string,
    nextFormationId: string,
    nextSlots: PitchSlotAssignment[]
  ) => {
    // Optimistic locally: the pitch must not flicker back to the stored shape while the write is in
    // flight. Only the formation being edited moves.
    setFormations((prev) =>
      prev.map((formation) =>
        formation.label === label
          ? { ...formation, formationName: nextFormationId, slots: nextSlots }
          : formation
      )
    );
    setFormationId(nextFormationId);
    setTacticsSlots(nextSlots);

    const targetCareerId = careerId;
    if (!targetCareerId) return;
    void apiFetch("/api/career", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        careerId: targetCareerId,
        tactics: { formationId: nextFormationId, slots: nextSlots, label },
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Saving tactics failed (HTTP ${res.status}).`);
      })
      .catch((error: Error) => setAppError(error.message));
  };

  /** Formation library actions. The response is the same hydration shape every other write returns. */
  const handleFormationAction = (
    action: "CREATE" | "RENAME" | "DELETE" | "SET_DEFAULT",
    label: string,
    extra?: { nextLabel?: string; formationId?: string }
  ) => {
    const targetCareerId = careerId;
    if (!targetCareerId) return;
    setAppError(null);
    void apiFetch("/api/career", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        careerId: targetCareerId,
        formations: {
          action,
          label,
          nextLabel: extra?.nextLabel,
          formationId: extra?.formationId,
        },
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as Partial<CareerHydrationPayload> & {
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? `Formation update failed (HTTP ${res.status}).`);
        }
        applyHydration(data);
        // A rename moves the label out from under the active tab, and promoting sets the XI.
        if (action === "RENAME" && extra?.nextLabel) setActiveFormationLabel(extra.nextLabel);
        if (action === "SET_DEFAULT") setActiveFormationLabel(label);
      })
      .catch((error: Error) => setAppError(error.message));
  };

  // The splash covers the app shell - but never the landing page or the portal wizard, which live
  // outside it. Derived from the boot phase, so the splash and the dashboard can never be painted in
  // the same commit: the phase resolves once, and only then is either chosen. Previously the
  // dashboard painted in full - entrance animation and all - one commit before the splash covered it.
  const splashVisible = bootPhase === "app" && !hasEntered;

  // Back-compat: a career with no saved formation rows still hydrates a synthetic default (via
  // `getTacticalSystem`), so there is always exactly one formation to show before anything has been
  // saved; the first write then persists it under its label.
  const formationsForUi: TacticalSystemState[] =
    formations.length > 0
      ? formations
      : [
          {
            careerId: careerId ?? "",
            label: "Primary",
            formationName: formationId,
            isDefault: true,
            slots: tacticsSlots,
          },
        ];
  const activeFormation =
    formationsForUi.find((formation) => formation.label === activeFormationLabel) ??
    formationsForUi[0];

  // Landing and the setup wizard are marketing and onboarding surfaces rather than app pages, so
  // they sit outside the app shell's gutter and headroom treatment.
  const isAppSurface = bootPhase === "app";

  // Nothing renders until the phase is resolved. This is what removes the flash rather than merely
  // delaying it: the landing page is never a waypoint on the road to the dashboard, and the
  // dashboard can never paint behind the splash.
  if (bootPhase === "booting") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <span className="block font-heading text-2xl tracking-wider text-slate-900 dark:text-slate-100">
            TOUCHLINE<span className="text-[#E11D48]">OS</span>
          </span>
          {bootError ? (
            <>
              <p className="text-xs text-rose-600 dark:text-rose-400">{bootError}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Your career is still set up. This is only a loading problem.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 min-h-10 bg-[#E11D48] hover:bg-[#FF8C7A] text-white text-xs font-sub font-bold uppercase tracking-wider rounded-xl transition-[background-color,transform] duration-200 active:scale-[0.96] shadow-md cursor-pointer"
              >
                Try again
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Loading your career…</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative flex flex-col">

      {displayedTab === "LANDING" || displayedTab === "PORTAL" || displayedTab === "DASHBOARD" ? (
        <div className="fixed inset-0 bg-[url('/stadium-bg.jpg')] bg-cover bg-center opacity-30 dark:opacity-15 blur-[1px] pointer-events-none transition-opacity duration-300" />
      ) : (
        <div className="fixed inset-0 bg-slate-100 dark:bg-[#090D16] pointer-events-none transition-colors duration-300" />
      )}

      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => switchTab(tab)}
        activeClubName={careerInfo.clubName}
        activeClubLogoUrl={careerInfo.clubLogoUrl}
        theme={resolvedTheme}
        onToggleTheme={toggleTheme}
        isOnboardingComplete={isOnboardingComplete}
      />

      {/* Full-Screen Splash Screen Overlay */}
      {splashVisible && (
        <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col justify-between p-4 sm:p-8 lg:p-10 overflow-hidden animate-overlay-in">
          {/* Subtle Ambient Grid & Light Glow Background */}
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-50 pointer-events-none" />
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Top Bar */}
          <div className="relative z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 animate-slide-in-top">
            <span className="font-heading text-xl tracking-wider text-slate-900 dark:text-slate-100">
              TOUCHLINE<span className="text-[#E11D48]">OS</span>
            </span>
            <span className="font-sub text-xs text-slate-400 font-bold uppercase tracking-widest">
              START TRACKING YOUR SAVE
            </span>
          </div>

          {/* Expansive Main Menu Grid */}
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center max-w-6xl w-full mx-auto my-auto py-8">
            {/* Left: the mark sits beside the words, both flush to the same left edge. The asset is
                pre-cropped (public/touchlineOS-mark.png) because the original carried roughly 55%
                transparent padding, which made every height setting look small. */}
            <div className="lg:col-span-7 flex items-center gap-5 sm:gap-8 text-left animate-slide-in-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/touchlineOS-mark.png"
                alt="TouchlineOS"
                className="h-24 sm:h-36 lg:h-44 w-auto shrink-0 animate-splash-logo drop-shadow-2xl"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
              <div className="space-y-1.5 min-w-0">
                <span className="font-sub text-xs text-[#E11D48] font-bold uppercase tracking-widest block">
                  Turn Your Save Into A Living Managerial Career.
                </span>
                <h1 className="font-heading text-3xl sm:text-5xl text-slate-900 dark:text-slate-100 uppercase tracking-tight leading-none break-words">
                  {careerInfo.clubName || "TOUCHLINE HUB"}
                </h1>
                <p className="font-sub text-sm text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider pt-1">
                  MANAGER: {careerInfo.managerName || "UNASSIGNED"}
                </p>
              </div>
            </div>

            {/* Right Column: save sync, then the game-style action stack */}
            <div className="lg:col-span-5 flex flex-col space-y-3 w-full max-w-sm ml-auto animate-slide-in-bottom [animation-delay:200ms]">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-4 py-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Latest detected save
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadSaveCandidates()}
                    disabled={isLoading}
                    className="font-sub text-[10px] font-bold uppercase text-[#E11D48] dark:text-[#FF8C7A] hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saveSourceMode === "picker" ? "Choose save file…" : "Re-scan"}
                  </button>
                </div>

                {!saveScanComplete ? (
                  <p className="font-sub text-xs text-slate-500 dark:text-slate-400">
                    {saveSourceMode === "picker" ? "Waiting for a save file…" : "Scanning your save folders…"}
                  </p>
                ) : latestSaveCandidate ? (
                  <p className="font-sub text-xs font-bold text-slate-900 dark:text-slate-100 break-all">
                    {latestSaveCandidate.fileName}
                    <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                      {(latestSaveCandidate.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </p>
                ) : (
                  <p className="font-sub text-xs text-amber-600 dark:text-amber-400">
                    {savesUnavailableReason ??
                      "No career save found. You can still enter with the career already loaded."}
                  </p>
                )}

                {entrySyncError && (
                  <p className="font-sub text-xs text-rose-600 dark:text-rose-400">
                    {entrySyncError}
                  </p>
                )}

                {entrySync && (
                  <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Snapshot #{entrySync.snapshotNumber ?? "—"}
                      </span>
                      <span
                        className={`font-sub text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          entrySync.status === "SYNCED"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-slate-500/15 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {entrySync.status === "NO_CHANGE" ? "Up to date" : entrySync.status}
                      </span>
                    </div>
                    {entrySync.events.length > 0 ? (
                      <ul className="space-y-1">
                        {entrySync.events.slice(0, 4).map((event, index) => (
                          <li
                            key={`${event.eventType}-${index}`}
                            className="font-sub text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48] shrink-0" />
                            {event.eventType.replace(/_/g, " ").toLowerCase()}
                          </li>
                        ))}
                        {entrySync.events.length > 4 && (
                          <li className="font-sub text-[11px] text-slate-500 dark:text-slate-400 pl-3.5">
                            +{entrySync.events.length - 4} more
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="font-sub text-xs text-slate-600 dark:text-slate-300">
                        {entrySync.status === "NO_CHANGE"
                          ? "Save is byte-identical to the last snapshot."
                          : "No squad, transfer or finance changes detected."}
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleEntrySync()}
                  disabled={isLoading || !latestSaveCandidate}
                  className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-sub text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-colors hover:bg-[#E11D48] dark:hover:bg-[#FF8C7A] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? "Syncing…" : entrySync ? "Sync again" : "Sync latest save"}
                </button>
              </div>

              <button
                onClick={() => {
                  setHasEntered(true);
                  switchTab("DASHBOARD");
                }}
                className="w-full py-4 px-6 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-base font-bold uppercase tracking-widest rounded-2xl shadow-xl shadow-rose-600/20 hover:shadow-2xl hover:shadow-[#FF8C7A]/30 transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 active:scale-[0.97] cursor-pointer flex items-center justify-between group animate-fade-in-up [animation-delay:170ms]"
              >
                <span>ENTER OS</span>
                <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
              </button>

              <button
                onClick={() => {
                  setHasEntered(true);
                  switchTab("SETTINGS");
                }}
                className="w-full py-3.5 px-6 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-heading text-xs font-bold uppercase tracking-wider rounded-2xl transition-colors duration-200 cursor-pointer flex items-center justify-between shadow-xs animate-fade-in-up [animation-delay:280ms]"
              >
                <span>⚙ SYSTEM SETTINGS</span>
                <span className="text-slate-400 text-xs font-sub">OPEN</span>
              </button>
            </div>
          </div>

          {/* Footer Copyright */}
          <div className="relative z-10 border-t border-slate-200 dark:border-slate-800 pt-4 text-center font-sub text-[10px] text-slate-400 dark:text-slate-500 space-y-0.5 animate-fade-in-up [animation-delay:380ms]">
            <p>© 2026 TouchlineOS. All rights reserved. Read-only EA FC career companion app.</p>
            <p>Not affiliated with or endorsed by Electronic Arts Inc.</p>
          </div>
        </div>
      )}

      {statusMessage && (
        <AppNotice
          tone="success"
          message={statusMessage}
          onDismiss={() => setStatusMessage(null)}
        />
      )}
      {appError && (
        <AppNotice
          tone="error"
          message={appError}
          onDismiss={() => setAppError(null)}
          onRetry={
            lastSubmission
              ? () => {
                  setAppError(null);
                  void handleCompleteOnboarding(lastSubmission);
                }
              : undefined
          }
        />
      )}

      {/*
        Every tab renders inside this one container, so it is where the app shell lives.

        The nav is sticky and occupies its own 65px of layout, so content starts below it and then
        scrolls underneath. Inner pages get a consistent gutter, more headroom under the nav, and
        bottom space so the last card is never clipped against the viewport edge. The landing page
        and the setup wizard keep their own full-bleed treatment, because they are marketing and
        onboarding surfaces rather than app pages.
      */}
      <div
        key={displayedTab}
        className={`flex-1 w-full mx-auto z-10 ${
          isAppSurface
            ? "max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 lg:pt-8 pb-20"
            : "max-w-7xl p-4 sm:p-6"
        } ${tabPhase === "in" ? "animate-page-in" : "animate-page-out"}`}
      >
        {displayedTab === "LANDING" && (
          <LandingPage
            saveCandidate={saveCandidates[0] || null}
            noSaveDetected={saveScanComplete && saveCandidates.length === 0}
            onRescan={() => void loadSaveCandidates()}
            saveSourceMode={saveSourceMode}
            onEnterPortal={() => {
              if (isOnboardingComplete) {
                setHasEntered(true);
                switchTab("DASHBOARD");
              } else {
                switchTab("PORTAL");
              }
            }}
          />
        )}

        {displayedTab === "PORTAL" && !isOnboardingComplete && (
          <OnboardingWizard
            saveCandidates={saveCandidates}
            saveScanComplete={saveScanComplete}
            saveSourceMode={saveSourceMode}
            savesUnavailableReason={savesUnavailableReason}
            onRescan={() => void loadSaveCandidates()}
            onCompleteOnboarding={handleCompleteOnboarding}
          />
        )}

        {displayedTab === "DASHBOARD" && (
          <div>
            <GroupDebriefPrompt
              careerId={careerId}
              seasonNumber={seasonState?.outlook?.seasonNumber ?? null}
              matchesPlayed={seasonState?.progressSeries?.at(-1)?.matchday ?? 0}
              enabled={appSettings?.debriefFrequency === "EVERY_5_MATCHES"}
              onOpenDebrief={() => switchTab("DEBRIEF")}
            />
            <DashboardView
            careerId={careerId ?? ""}
            managerName={careerInfo.managerName}
            clubName={careerInfo.clubName}
            season={careerInfo.season ?? 1}
            inGameDate={careerInfo.inGameDate}
            players={squad}
            recentEvents={timeline}
            storylines={storylines}
            seasonState={seasonState}
            tacticsSlots={activeFormation?.slots ?? tacticsSlots}
            onNavigateTab={(tab, seasonSubTab) => {
              setSeasonFocus(seasonSubTab ?? null);
              switchTab(tab);
            }}
            onSelectPlayer={(player) => setSelectedPlayer(player)}
            onOpenStoryline={(storylineId) => {
              setSelectedStorylineId(storylineId);
              patchSession({ openStorylineId: storylineId });
            }}
            />
          </div>
        )}

        {displayedTab === "SEASON" && (
          <SeasonView
            careerId={careerId ?? ""}
            seasonState={seasonState}
            onSeasonChange={setSeasonState}
            focusSubTab={seasonFocus}
          />
        )}

        {displayedTab === "SQUAD" && (
          <div>
            {isLoading || isRestoring ? (
              <SquadTableSkeleton />
            ) : (
              <SquadView
                careerId={careerId}
                players={squad}
                onSelectPlayer={(player) => setSelectedPlayer(player)}
                currencySymbol={currencySymbolFor(appSettings?.currencySymbol)}
              />
            )}
          </div>
        )}

        {displayedTab === "TACTICS" && (
          <Pitch2D
            key={activeFormationLabel}
            squad={squad}
            formations={formationsForUi}
            activeFormationLabel={activeFormationLabel}
            onSelectFormation={setActiveFormationLabel}
            onSaveTactics={handleSaveTactics}
            onFormationAction={handleFormationAction}
          />
        )}

        {displayedTab === "DEBRIEF" && (
          <DebriefView
            careerId={careerId}
            players={squad}
            recentEvents={timeline}
            leagueTeams={leagueTeams}
            clubName={careerInfo.clubName}
            inGameDate={careerInfo.inGameDate}
            seasonNumber={seasonState?.outlook?.seasonNumber ?? null}
            onDebriefSubmitted={() => {
              if (careerId) {
                apiFetch(`/api/career?careerId=${encodeURIComponent(careerId)}`)
                  .then((res) => res.json())
                  .then((data) => {
                    if (data.success) applyHydration(data);
                  });
              }
            }}
          />
        )}

        {displayedTab === "FINANCE" && <FinanceView careerId={careerId} />}

        {displayedTab === "SETTINGS" && (
          <SettingsView
            settings={appSettings}
            settingsError={settingsError}
            savingField={savingField}
            diagnostics={diagnostics}
            diagnosticsError={diagnosticsError}
            themeMode={theme}
            timeline={timeline}
            onUpdateSetting={(field, patch) => void handleUpdateSetting(field, patch)}
            onSetTheme={handleSetTheme}
            onRefreshDiagnostics={() => void refreshDiagnostics()}
            onExport={handleExportCareer}
            onImport={handleImportCareer}
            onResetCareer={handleResetCareer}
          />
        )}
      </div>

      <PlayerDrawer
        key={selectedPlayer?.id ?? "no-player"}
        player={selectedPlayer}
        valuation={selectedPlayer ? valuations[selectedPlayer.eaPlayerId] : undefined}
        onClose={() => setSelectedPlayer(null)}
        onSaveProfile={handleSavePlayerProfile}
      />

      {/* Mounted beside the tab wrapper, not inside it: the wrapper is keyed by tab, so anything
          rendered within would be torn down and re-animated on every tab change. */}
      <StorylineEvidence
        key={selectedStorylineId ?? "no-storyline"}
        storyline={storylines.find((story) => story.id === selectedStorylineId) ?? null}
        onClose={handleCloseStoryline}
        onNavigateTab={(tab) => {
          handleCloseStoryline();
          switchTab(tab);
        }}
      />

      {displayedTab === "LANDING" ? (
        <LandingFooter onOpenLegal={(doc) => setActiveLegalDoc(doc)} />
      ) : (
        <Footer />
      )}

      <LegalModal
        activeDoc={activeLegalDoc}
        onClose={() => setActiveLegalDoc(null)}
      />
    </main>
  );
}

function AppNotice({
  tone,
  message,
  onDismiss,
  onRetry,
}: {
  tone: "success" | "error";
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const toneClasses =
    tone === "error"
      ? "border-rose-300 dark:border-rose-900/70 bg-rose-50/95 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200"
      : "border-emerald-300 dark:border-emerald-900/70 bg-emerald-50/95 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200";

  return (
    <div className="relative z-20 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-3">
      <div
        role="status"
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 font-sans text-xs backdrop-blur-md ${toneClasses}`}
      >
        <span className="flex-1 leading-relaxed">{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 px-3 py-1 rounded-lg border border-current font-sub uppercase tracking-wider hover:opacity-80 transition-opacity cursor-pointer"
          >
            Retry sync
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 px-2 leading-none font-bold hover:opacity-70 transition-opacity cursor-pointer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}