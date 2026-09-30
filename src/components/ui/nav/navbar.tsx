"use client";

import React, { useSyncExternalStore } from "react";
import { AppTab } from "@/lib/session";

/**
 * Whether the page has scrolled past the nav's own height.
 *
 * Read through `useSyncExternalStore` rather than a state + effect pair: the scroll offset is
 * external browser state, and subscribing directly keeps the first paint correct for a restored
 * scroll position without a setState inside an effect.
 */
const SCROLL_THRESHOLD = 8;
function subscribeToScroll(onChange: () => void): () => void {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
function readScrolled(): boolean {
  return window.scrollY > SCROLL_THRESHOLD;
}
function readScrolledOnServer(): boolean {
  return false;
}

interface NavbarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  activeClubName?: string;
  activeClubLogoUrl?: string;
  activeSeason?: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  isOnboardingComplete?: boolean;
}

export function Navbar({
  activeTab,
  onSelectTab,
  activeClubName,
  activeClubLogoUrl,
  activeSeason,
  theme,
  onToggleTheme,
  isOnboardingComplete = false,
}: NavbarProps) {
  const isLanding = activeTab === "LANDING";
  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    readScrolled,
    readScrolledOnServer
  );

  // A badge may arrive as an uploaded data URL or a remote link; trim so whitespace never renders as
  // a broken image. The badge and the club name are independent - a career can have either.
  const clubBadgeUrl = (activeClubLogoUrl ?? "").trim();
  const hasClubName = Boolean(activeClubName && activeClubName.trim() !== "");

  const appTabs: { id: AppTab; label: string }[] = [
    // Setup is one-time: the portal disappears once a career exists, so nobody is offered the
    // onboarding wizard again after they have already completed it.
    ...(isOnboardingComplete ? [] : [{ id: "PORTAL" as AppTab, label: "Portal" }]),
    { id: "DASHBOARD", label: "Dashboard" },
    { id: "SEASON", label: "Season" },
    { id: "SQUAD", label: "Squad" },
    { id: "TACTICS", label: "Tactics" },
    { id: "DEBRIEF", label: "Debrief" },
    { id: "TIMELINE", label: "Timeline" },
    { id: "SETTINGS", label: "Settings" },
  ];

  return (
    // Sticky, so it stays put on every page while the content scrolls underneath it. The
    // translucent backdrop is what makes content visibly duck UNDER rather than pass over: the
    // blur plus the near-opaque fill hides whatever is sliding beneath, and the border and shadow
    // only appear once there is something to separate the bar from - so the resting page looks flat
    // and the scrolled page has a defined edge.
    <header
      className={`sticky top-0 z-50 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b px-4 py-3 text-slate-900 transition-[background-color,border-color,box-shadow] duration-200 dark:text-white ${
        scrolled
          ? "bg-white/95 dark:bg-slate-950/95 border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-sm dark:shadow-2xl"
          : "bg-white/80 dark:bg-slate-950/70 border-transparent backdrop-blur-md"
      }`}
    >
      {/* Brand Logo */}
      <div
        onClick={() => onSelectTab("LANDING")}
        className="flex items-center gap-2 min-w-0 cursor-pointer group justify-self-start"
      >
        <span className="font-heading text-lg sm:text-xl text-slate-900 dark:text-white tracking-wider shrink-0">
          TOUCHLINE<span className="text-[#E11D48]">OS</span>
        </span>
        {!isLanding && (clubBadgeUrl !== "" || hasClubName) && (
          <span className="text-xs font-sub text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-800 pl-2.5 ml-1 hidden md:inline-flex items-center gap-2 min-w-0">
            {clubBadgeUrl !== "" && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={clubBadgeUrl}
                alt={activeClubName ? `${activeClubName} badge` : "Club badge"}
                className="w-9 h-9 sm:w-10 sm:h-10 object-contain shrink-0 drop-shadow-sm"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            )}
            {hasClubName && (
              <span className="truncate">
                {activeClubName} {activeSeason ? `· S${activeSeason}` : ""}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Dead-Centered Navigation Bar */}
      <nav className="justify-self-center min-w-0">
        {isLanding ? (
          <div className="hidden md:flex items-center gap-6 lg:gap-8 font-sub text-xs uppercase tracking-widest text-slate-600 dark:text-slate-300 font-semibold">
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Features
            </a>
            <a href="#roadmap" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Roadmap
            </a>
            <a href="#faq" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              FAQ
            </a>
          </div>
        ) : (
          <div
            className={`hidden md:flex items-center gap-0.5 lg:gap-1 bg-slate-100 dark:bg-slate-900 p-0.5 lg:p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner transition-[background-color,border-color] duration-300 ${
              !isOnboardingComplete
                ? "blur-[3px] opacity-40 pointer-events-none select-none cursor-not-allowed"
                : ""
            }`}
          >
            {appTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`py-1.5 px-2.5 lg:px-4 rounded-lg font-sub text-[10px] lg:text-xs uppercase tracking-normal lg:tracking-wider transition-[background-color,color,box-shadow] duration-200 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? "bg-[#E11D48] text-white font-bold shadow-md shadow-rose-600/30"
                      : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 font-semibold"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </nav>

      {/* Right Action Cluster */}
      <div className="flex items-center gap-2 sm:gap-3 justify-self-end shrink-0">
        {/*
          Landing only, and inside this cluster rather than as its own grid child: as a separate
          child it was the header's fourth item in a three-column grid, so it pushed the theme
          toggle onto an implicit second row. Sitting immediately left of that toggle keeps the
          whole right-hand side one aligned row, and the app itself shows no support ask.
        */}
        {isLanding && (
          <a
            href="https://ko-fi.com/ianmadezoss"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center justify-center min-h-10 whitespace-nowrap rounded-xl bg-amber-400 px-3 lg:px-4 py-2 font-sub text-[10px] lg:text-xs font-bold uppercase tracking-wider text-slate-950 shadow-xs transition-[background-color,transform] duration-200 hover:scale-[1.02] hover:bg-amber-300 active:scale-[0.96]"
          >
            {/* The full label only where there is room for it; a phone keeps the short one. */}
            <span className="hidden lg:inline">Support! (Ko-Fi)</span>
            <span className="lg:hidden">Ko-Fi</span>
          </a>
        )}

        <button
          onClick={onToggleTheme}
          aria-label="Toggle Light/Dark Theme"
          className="inline-flex items-center justify-center min-h-10 min-w-10 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-600 transition-colors cursor-pointer"
        >
          {theme === "light" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>

        {isLanding && (
          <button
            onClick={() => onSelectTab("PORTAL")}
            className="px-4 py-2 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-xs font-bold uppercase rounded-xl shadow-md transition-[background-color,box-shadow,transform] duration-200 hover:scale-102 active:scale-[0.96] hover:-translate-y-0.5 cursor-pointer"
          >
            Enter Portal →
          </button>
        )}
      </div>
    </header>
  );
}