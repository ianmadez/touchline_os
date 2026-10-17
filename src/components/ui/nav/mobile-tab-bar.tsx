"use client";

import React, { useState } from "react";

import type { AppTab } from "@/lib/session";
import { MoreSheet } from "./more-sheet";
import { appTabsFor, PRIMARY_TAB_IDS } from "./tab-items";

/**
 * The phone navigation.
 *
 * Below 768px the desktop strip in the header is hidden, which used to leave the app with no
 * navigation at all. Four tabs sit permanently in a bottom bar and the rest live behind More. The
 * buttons carry the same `data-tour="tab-*"` anchors as the desktop strip, so the tours keep
 * working without a mobile-only vocabulary.
 */
export function MobileTabBar({
  activeTab,
  onSelectTab,
  isOnboardingComplete,
}: {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  isOnboardingComplete: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = appTabsFor(isOnboardingComplete);
  const primary = tabs.filter((tab) => PRIMARY_TAB_IDS.includes(tab.id));
  const overflow = tabs.filter((tab) => !PRIMARY_TAB_IDS.includes(tab.id));
  const overflowActive = overflow.some((tab) => tab.id === activeTab);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
      >
        <div className="grid grid-cols-5">
          {primary.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                data-tour={`tab-${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelectTab(tab.id)}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  isActive
                    ? "text-[#E11D48] dark:text-[#FF8C7A]"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{tab.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            data-mobile-more
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              overflowActive
                ? "text-[#E11D48] dark:text-[#FF8C7A]"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
            >
              <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
            </svg>
            <span>More</span>
          </button>
        </div>
      </nav>

      <MoreSheet
        open={moreOpen}
        tabs={overflow}
        activeTab={activeTab}
        onSelect={onSelectTab}
        onClose={() => setMoreOpen(false)}
      />
    </>
  );
}
