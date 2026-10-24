"use client";

import React from "react";
import { SUPPORT_LINE } from "@/lib/ui/compatibility";

export function Footer() {
  return (
    <footer className="relative z-10 w-full bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 py-6 px-6 mt-auto max-md:pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span className="font-heading text-sm text-slate-900 dark:text-slate-100">
            TOUCHLINE<span className="text-[#E11D48]">OS</span>
          </span>
          <p className="font-sub text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
            It reads your save, remembers every squad change it finds, and reads each block of matches
            back to you: what the numbers support, what they do not, and what is worth testing next.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center font-sub text-xs text-slate-500 sm:gap-6 dark:text-slate-400">
          <span className="whitespace-nowrap">Runs On Your PC</span>
          <span aria-hidden="true">•</span>
          <span className="whitespace-nowrap">Full History Kept</span>
          <span aria-hidden="true">•</span>
          <span className="cursor-help whitespace-nowrap" title={SUPPORT_LINE}>
            FC 25 and FC 26 saves
          </span>
          <span aria-hidden="true">•</span>
          <span className="whitespace-nowrap">Nothing Rewritten</span>
        </div>
      </div>
    </footer>
  );
}