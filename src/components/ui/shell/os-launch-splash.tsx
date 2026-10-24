"use client";

import React from "react";

/**
 * The moment between the menu and the app.
 *
 * It is the entry splash's own language carried straight over: same light surface, same dotted grid, the brand
 * wordmark and the club under it. Nothing here is decorative beyond that, because the two screens sit 760ms apart and
 * a second visual idea inside that window would read as a different product.
 *
 * The timings are owned by the parent, not by this file. The overlay is purely presentational: it appears, plays its
 * sequence, and is unmounted once the app behind it has painted. Nothing here waits on data, so a slow career load can
 * never leave a manager staring at a logo instead of the reason he is here.
 */
export function OsLaunchSplash({
  clubName,
  closing = false,
}: {
  clubName?: string | null;
  /** True while the cover is on its way out, so it fades over the app rather than vanishing. */
  closing?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tour="os-launch"
      className={`${closing ? "animate-os-cover-out" : "animate-os-cover"} fixed inset-0 z-[70] flex flex-col items-center justify-center bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-white`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] opacity-50 dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px]"
      />

      <div className="relative flex flex-col items-center gap-2 px-6 text-center">
        <span className="animate-os-mark font-heading text-3xl tracking-wider text-slate-900 sm:text-4xl dark:text-slate-100">
          TOUCHLINE<span className="text-[#E11D48] dark:text-[#FF8C7A]">OS</span>
        </span>
        <span className="animate-os-word font-sub text-[10px] font-bold uppercase tracking-[0.4em] text-slate-400 [animation-delay:90ms]">
          Starting your session
        </span>
        {clubName ? (
          <span className="animate-os-word font-sub text-xs font-semibold uppercase tracking-wider text-slate-500 [animation-delay:170ms] dark:text-slate-400">
            {clubName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
