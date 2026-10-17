"use client";

import React, { useEffect, useRef } from "react";

import type { AppTab } from "@/lib/session";
import { portal, useScrollLock } from "../portal";
import type { AppTabItem } from "./tab-items";

/**
 * The phone's overflow menu.
 *
 * A bottom sheet rather than a dropdown: the trigger sits at the bottom of the screen, so a panel
 * that grows from it stays inside the thumb's reach and never covers the status bar. It keeps the
 * real `data-tour` anchors for the tabs it holds, which is what lets a tour point at Tactics or
 * Settings on a phone without inventing a second anchor vocabulary.
 */
export function MoreSheet({
  open,
  tabs,
  activeTab,
  onSelect,
  onClose,
}: {
  open: boolean;
  tabs: readonly AppTabItem[];
  activeTab: AppTab;
  onSelect: (tab: AppTab) => void;
  onClose: () => void;
}) {
  useScrollLock(open);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return portal(
    <div
      className="fixed inset-0 z-[58] flex items-end bg-slate-950/60 backdrop-blur-sm animate-overlay-in md:hidden"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg mx-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl animate-panel-in dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2
            id="mobile-more-title"
            className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100"
          >
            More
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 font-sub text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-900 cursor-pointer dark:text-slate-400 dark:hover:text-white"
          >
            Close
          </button>
        </div>

        <ul className="space-y-1 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  data-more-tab={tab.id}
                  data-tour={`tab-${tab.id}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    onSelect(tab.id);
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer ${
                    isActive
                      ? "bg-[#E11D48] text-white"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="font-sub text-sm font-semibold">{tab.label}</span>
                  {isActive ? (
                    <span className="ml-auto font-sub text-[10px] font-bold uppercase tracking-wider">
                      Here
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
