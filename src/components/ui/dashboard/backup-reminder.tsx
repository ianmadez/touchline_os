"use client";

import React, { useEffect, useState } from "react";
import { showBackupReminder } from "@/lib/platform/backup-reminder";

/**
 * "Export a backup" nudge, browser build only.
 *
 * The browser build keeps the whole career in the browser's own storage, and "clear browsing data"
 * deletes it with no way back. An exported JSON is the manager's only copy outside the browser, so the
 * dashboard asks for one when the last export is more than a week old (or never happened). Snoozing
 * hides it for three days. Both timestamps are per-viewer conveniences, so they live in localStorage and
 * every read is guarded: a blocked store simply shows the reminder.
 */
const DAY = 24 * 60 * 60 * 1000;
const STALE_AFTER = 7 * DAY;
const SNOOZE_FOR = 3 * DAY;

const exportKey = (careerId: string) => `touchline.lastExport.${careerId}`;
const snoozeKey = (careerId: string) => `touchline.backupSnooze.${careerId}`;

function read(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked: the reminder just comes back next visit.
  }
}

/** Called after any successful export, so the reminder knows the manager is covered. */
export function recordCareerExport(careerId: string) {
  write(exportKey(careerId), Date.now());
}

export function BackupReminder({ careerId, onExport }: { careerId: string; onExport: () => Promise<{ ok: boolean; message: string }> }) {
  // Decided after mount: the server render has no localStorage and no business reading the clock.
  // `null` = hidden; a number = days since the last export, or -1 for never.
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showBackupReminder || !careerId) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const lastExport = read(exportKey(careerId));
      if (now - lastExport < STALE_AFTER || now < read(snoozeKey(careerId))) return;
      setDays(lastExport ? Math.floor((now - lastExport) / DAY) : -1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [careerId]);

  if (days === null) return null;
  const setHidden = (hide: true) => { if (hide) setDays(null); };

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    const result = await onExport();
    setBusy(false);
    if (result.ok) {
      recordCareerExport(careerId);
      setHidden(true);
    } else {
      setError(result.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Back up your career"
      className="fixed bottom-4 right-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-wrap items-center gap-3 rounded-2xl border border-sky-300/70 bg-white/95 p-4 shadow-2xl backdrop-blur-xl dark:border-sky-500/30 dark:bg-slate-900/95 max-md:bottom-20"
    >
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">Your browser has the memory of a goldfish</p>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
          One &ldquo;clear browsing data&rdquo; and every debrief, note and finance figure swims off for good.{" "}
          {days < 0 ? "You've never exported a backup." : `Your last backup was ${days} days ago.`} Pop one in your pocket, it takes a second.
        </p>
        {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
      <div className="flex gap-2 max-sm:w-full">
        <button
          type="button"
          onClick={() => {
            write(snoozeKey(careerId), Date.now() + SNOOZE_FOR);
            setHidden(true);
          }}
          className="cursor-pointer rounded-lg px-3 py-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800 max-sm:flex-1"
        >
          Later
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportNow()}
          className="cursor-pointer rounded-lg bg-sky-600 px-3 py-2 font-sub text-[10px] font-bold uppercase tracking-wider text-white hover:bg-sky-700 disabled:opacity-60 max-sm:flex-1"
        >
          {busy ? "Exporting…" : "Export backup (JSON)"}
        </button>
      </div>
    </div>
  );
}
