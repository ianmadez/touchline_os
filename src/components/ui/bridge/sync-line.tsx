"use client";

/**
 * The one line that says whether this browser and the PC agree.
 *
 * Every phase is a sentence rather than a state name, because the question a manager has is "is my career
 * safe?" and a row of coloured dots does not answer it. The line is deliberately quiet: it is a status,
 * not an alert, and the only phase that takes over the screen is the one that needs a decision.
 */
import React, { useSyncExternalStore } from "react";
import { describeSync, readSyncSnapshot, subscribeSync } from "@/lib/sync/replication/state";

/** Subscribes to the replication store. Shared, so every surface says the same thing at the same moment. */
export function useSyncSnapshot() {
  return useSyncExternalStore(subscribeSync, readSyncSnapshot, readSyncSnapshot);
}

export function SyncLine({ className = "" }: { className?: string }) {
  const snapshot = useSyncSnapshot();
  const text = describeSync(snapshot);
  if (!text) return null;

  const tone =
    snapshot.phase === "synced"
      ? "text-emerald-600 dark:text-emerald-400"
      : snapshot.phase === "offline" || snapshot.phase === "outdated"
        ? "text-amber-600 dark:text-amber-400"
        : snapshot.phase === "two-copies"
          ? "text-rose-600 dark:text-rose-400"
          : "text-slate-500 dark:text-slate-400";

  return (
    <p className={`font-sans text-[11px] leading-relaxed ${tone} ${className}`} role="status">
      {text}
    </p>
  );
}
