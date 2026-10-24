"use client";

/**
 * The pill that says "you are looking, not editing".
 *
 * Fixed to the bottom rather than sitting under the nav, because a message about who may write has to
 * be visible from wherever the manager is on the page - and the nav is already carrying the tab strip,
 * the club badge and the theme toggle on a 360px screen. It sits above the phone's tab bar and above
 * the home indicator, and it is not dismissible: it describes a state, not an event, and a dismissed
 * state is a lie.
 *
 * The lease refusal uses the same surface with a different sentence, so a write that was refused is
 * explained by the thing that already explains why, instead of by a toast that disappears before it has
 * been read.
 */
import React from "react";
import { describeSync } from "@/lib/sync/replication/state";
import { useSyncSnapshot } from "@/components/ui/bridge/sync-line";
import { useRemote, useWriteAccess } from "./remote-provider";

export function ViewingPill() {
  const { remote, state, leaseRefusal, dismissLeaseRefusal, takeControl } = useRemote();
  const { viewing, holderName } = useWriteAccess();
  const snapshot = useSyncSnapshot();
  const catchingUp = snapshot.phase === "catching-up";

  // The page owns its own database, so it has no lease and no `state` - but it can be behind the bridge,
  // and saying so before a write is the one moment that matters: a change made while catching up is a
  // change made against a stale picture.
  if (!remote || !state) {
    if (!catchingUp) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6">
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-300/80 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.18)] backdrop-blur-xl" data-chrome="pill">
          <span aria-hidden="true" className="text-base leading-none">
            ⏳
          </span>
          <p className="min-w-0 flex-1 font-sans text-[11px] leading-snug text-slate-700 dark:text-slate-200">
            {describeSync(snapshot)}
          </p>
        </div>
      </div>
    );
  }
  if (!viewing && !leaseRefusal) return null;

  const name = leaseRefusal ? null : holderName;
  const message = leaseRefusal
    ? leaseRefusal.message
    : `${name ?? "Another device"} is editing here.`;

  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-300/80 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <span aria-hidden="true" className="text-base leading-none">
          👁
        </span>
        <p className="min-w-0 flex-1 font-sans text-[11px] leading-snug text-slate-700 dark:text-slate-200">
          <span className="font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Viewing ·{" "}
          </span>
          {message}
        </p>
        <button
          type="button"
          onClick={() => void takeControl()}
          data-compact
          className="shrink-0 min-h-9 rounded-lg bg-[#E11D48] px-3 font-sub text-[10px] font-bold uppercase tracking-wider text-white transition-[background-color,transform] duration-150 active:scale-[0.97] hover:bg-[#FF8C7A] cursor-pointer"
        >
          Take control
        </button>
        {leaseRefusal && (
          <button
            type="button"
            onClick={dismissLeaseRefusal}
            aria-label="Dismiss"
            data-compact
            className="shrink-0 min-h-9 rounded-lg px-2 font-sub text-sm text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}


