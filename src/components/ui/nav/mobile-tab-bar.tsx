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
        data-chrome="bar"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 md:hidden [transform:translateZ(0)]"
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
                className={`mx-1 my-1 flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] cursor-pointer ${
                  isActive
                    ? "bg-slate-200/80 text-[#E11D48] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_0_rgba(15,23,42,0.10),1px_1px_0_rgba(15,23,42,0.05)] dark:bg-slate-800 dark:text-[#FF8C7A] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_0_rgba(0,0,0,0.6)]"
                    : "text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-slate-800/60"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full whitespace-nowrap leading-tight">{tab.shortLabel}</span>
              </button>
            );
          })}

          <button
            type="button"
            data-mobile-more
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={`mx-1 my-1 flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97] cursor-pointer ${
              overflowActive
                ? "bg-slate-200/80 text-[#E11D48] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_0_rgba(15,23,42,0.10),1px_1px_0_rgba(15,23,42,0.05)] dark:bg-slate-800 dark:text-[#FF8C7A] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_0_rgba(0,0,0,0.6)]"
                : "text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-slate-800/60"
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
            <span className="whitespace-nowrap leading-tight">More</span>
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

