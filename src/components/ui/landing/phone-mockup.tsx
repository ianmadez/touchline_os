"use client";

/**
 * A phone, with the dashboard in it.
 *
 * Drawn in markup rather than shipped as a screenshot, for the same reason the bento images are captured
 * from the running app: a picture of a product that does not exist yet is a promise, and this one has to
 * stay true. Markup also survives dark mode, a 2x screen and a browser zoom, and it adds no image weight
 * to the landing page.
 *
 * It is a `role="img"` with a written description instead of a nesting of tiny live text, because a
 * screen reader should hear what the picture shows rather than thirty fragments of dashboard.
 */
import React from "react";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] bg-slate-100 dark:bg-slate-800 px-1 py-[1px] font-sub text-[6px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {children}
    </span>
  );
}

export function PhoneMockup() {
  return (
    <div
      className="relative mx-auto w-[234px] sm:w-[258px]"
      role="img"
      aria-label="The TouchlineOS dashboard on a phone: Wigan Athletic in season 2026, the promotion objective at 43 points, a squad report, and an open storyline about A. Aznou's rating."
    >
      {/* The glow does the work of lifting the frame off the card behind it. */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 -inset-y-6 rounded-[3.5rem] bg-[#E11D48]/12 blur-2xl dark:bg-[#E11D48]/18"
      />

      <div className="relative rounded-[2.4rem] border-[9px] border-slate-900 bg-slate-900 shadow-[0_28px_60px_-18px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-800">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-slate-100 dark:bg-[#090D16]">
          {/* Status bar, and the island. */}
          <div className="relative flex items-center justify-between px-4 pb-1 pt-1.5">
            <span className="font-sub text-[7px] font-bold text-slate-900 dark:text-slate-100">20:41</span>
            <div className="absolute left-1/2 top-1 h-3 w-14 -translate-x-1/2 rounded-full bg-slate-900 dark:bg-black" />
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-sub text-[6px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                paired
              </span>
            </span>
          </div>

          {/* The wordmark, as the app has it. */}
          <div className="flex items-center justify-between px-3 pb-1.5">
            <span className="font-heading text-[9px] tracking-wider text-slate-900 dark:text-slate-100">
              TOUCHLINE<span className="text-[#E11D48] dark:text-[#FF8C7A]">OS</span>
            </span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 text-[6px] text-slate-400">
              ◐
            </span>
          </div>

          <div className="space-y-1.5 px-2 pb-2">
            {/* Club and season */}
            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="font-sub text-[6px] uppercase tracking-[0.16em] text-slate-400">
                Season 2026 · 2026-12-02
              </p>
              <p className="font-heading text-[11px] uppercase leading-tight tracking-wide text-slate-900 dark:text-slate-100">
                Wigan Athletic
              </p>
              <p className="font-sub text-[6px] uppercase tracking-[0.16em] text-slate-400">Jean Lacroix</p>
              <div className="mt-1 flex gap-1">
                <Chip>Strict realism</Chip>
                <Chip>Own</Chip>
              </div>
            </div>

            {/* The objective, which is the thing the card is about */}
            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="font-sub text-[6px] uppercase tracking-[0.16em] text-[#E11D48] dark:text-[#FF8C7A]">
                Season objective · 24 played
              </p>
              <p className="font-heading text-[10px] uppercase leading-tight tracking-wide text-slate-900 dark:text-slate-100">
                Promotion to EPL
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="font-heading text-[8px] text-slate-900 dark:text-slate-100">43</span>
                <span className="font-sub text-[6px] uppercase tracking-wider text-slate-400">pts</span>
                <span className="font-heading text-[8px] text-slate-900 dark:text-slate-100">1.79</span>
                <span className="font-sub text-[6px] uppercase tracking-wider text-slate-400">per match</span>
                <span className="ml-auto rounded-[3px] bg-emerald-50 px-1 py-[1px] font-sub text-[6px] font-bold uppercase tracking-wider text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  4th
                </span>
              </div>
            </div>

            {/* Two tiles, mirroring the squad report */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="font-sub text-[6px] uppercase tracking-[0.16em] text-slate-400">Active XI</p>
                <p className="font-heading text-[8px] text-slate-900 dark:text-slate-100">11/11</p>
                <div className="mt-1 h-[3px] rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full w-full rounded-full bg-emerald-500" />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="font-sub text-[6px] uppercase tracking-[0.16em] text-slate-400">Depth</p>
                <p className="font-heading text-[8px] text-amber-600 dark:text-amber-400">3 caps</p>
                <div className="mt-1 h-[3px] rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full w-1/3 rounded-full bg-amber-500" />
                </div>
              </div>
            </div>

            {/* A storyline, open, with its age */}
            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-1">
                <span className="rounded-[3px] bg-[#E11D48]/10 px-1 py-[1px] font-sub text-[6px] font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
                  Development
                </span>
                <span className="font-sub text-[6px] uppercase tracking-wider text-slate-400">8 days open</span>
              </div>
              <p className="mt-0.5 font-heading text-[8px] uppercase tracking-wide text-slate-900 dark:text-slate-100">
                A. Aznou, rating up 1
              </p>
              <p className="font-sans text-[6px] leading-relaxed text-slate-500 dark:text-slate-400">
                Overall went 71 to 70, then 71. Growth is real but gradual.
              </p>
            </div>
          </div>

          {/* The bottom bar, with Season lit the way the app lights it. */}
          <div className="flex items-end justify-around border-t border-slate-200 bg-white px-1 pb-2 pt-1 dark:border-slate-800 dark:bg-slate-950">
            {["Home", "Season", "Debrief", "Squad", "More"].map((label) => {
              const active = label === "Season";
              return (
                <span
                  key={label}
                  className={`font-sub text-[6px] font-bold uppercase tracking-wider ${
                    active ? "text-[#E11D48] dark:text-[#FF8C7A]" : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  <span
                    className={`mx-auto mb-0.5 block h-2 w-2 rounded-[3px] ${
                      active ? "bg-[#E11D48]" : "bg-slate-200 dark:bg-slate-700"
                    }`}
                  />
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Says what the picture is, in the page's own voice rather than as a caption block. */}
      <p className="mt-4 text-center font-sub text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        Same career · same Wi-Fi
      </p>
    </div>
  );
}
