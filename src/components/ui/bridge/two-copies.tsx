"use client";

/**
 * Two copies, and a choice, and no third option.
 *
 * This appears when the bridge already holds a career of the same id and holds something the page does
 * not: rows the PC copy has and the page lacks, or rows edited more recently on the PC. Merging is
 * not offered, because a merge between two databases of a football career is a guess about which contract
 * and which injury note is true, and a guess is not something this app should make on the manager's behalf.
 *
 * The destructive direction is the one that replaces this browser's copy, because that is the copy the
 * manager can see. It is behind a typed word and behind a download, and the download is taken before
 * anything is replaced rather than after.
 */
import React, { useState } from "react";
import { apiFetch } from "@/lib/platform/api-client";
import { keepBrowserCopy, takePcCopy } from "@/lib/platform/sync-actions";
import { describeConflict } from "@/lib/sync/replication/seed";
import type { SeedComparison } from "@/lib/sync/replication/protocol";

/** The word that has to be typed before the browser's copy is replaced. */
const CONFIRM_WORD = "REPLACE";

interface TwoCopiesProps {
  careerId: string;
  comparison: SeedComparison;
  /** Called after either choice, so the caller can refresh whatever it shows. */
  onResolved?: () => void;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes <= 0) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 120) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Saves this browser's career as a file, so a copy survives the choice. */
async function downloadThisBrowser(careerId: string): Promise<void> {
  const response = await apiFetch(`/api/career/export?careerId=${encodeURIComponent(careerId)}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as { success?: boolean; contents?: string; error?: string };
  if (!response.ok || !data.success || typeof data.contents !== "string") {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  const blob = new Blob([data.contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${careerId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function TwoCopies({ careerId, comparison, onResolved }: TwoCopiesProps) {
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"keep" | "pc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const card =
    "rounded-2xl border border-rose-300/70 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 p-4 space-y-3 text-left";
  const label =
    "font-sub text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200";
  const body = "font-sans text-xs text-slate-700 dark:text-slate-300 leading-relaxed";
  const primary =
    "px-3 py-1.5 rounded-lg bg-[#E11D48] hover:bg-[#FF8C7A] font-sub text-[11px] font-bold uppercase tracking-wider text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const secondary =
    "px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-sub text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors cursor-pointer disabled:opacity-50";

  const keepBrowser = async () => {
    setBusy("keep");
    setError(null);
    try {
      const ok = await keepBrowserCopy(careerId);
      if (!ok) throw new Error("This PC did not accept the copy.");
      setNote("Kept this browser's copy. The old PC copy was saved to a backup folder first.");
      onResolved?.();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applyPcCopy = async () => {
    if (typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy("pc");
    setError(null);
    try {
      // The download happens first, and a failed download stops the replacement: the promise on this
      // screen is that the copy being replaced can be got back.
      await downloadThisBrowser(careerId);
      const ok = await takePcCopy(careerId);
      if (!ok) throw new Error("This PC did not send its copy.");
      setNote("Replaced this browser's copy with the PC copy, and saved a file of the old one.");
      onResolved?.();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (note) {
    return (
      <div className={card}>
        <span className={label}>Two copies</span>
        <p className={body}>{note}</p>
      </div>
    );
  }

  return (
    <div className={card}>
      <span className={label}>Two copies of this career</span>
      <p className={body}>{describeConflict(comparison)}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/50 px-3 py-2">
          <p className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            This browser
          </p>
          <p className={body}>
            {comparison.page.rows.toLocaleString()} rows, newest edit {when(comparison.page.newestEdit)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/50 px-3 py-2">
          <p className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Your PC
          </p>
          <p className={body}>
            {comparison.pc.rows.toLocaleString()} rows, newest edit {when(comparison.pc.newestEdit)}
          </p>
        </div>
      </div>

      {step === "choose" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void keepBrowser()} disabled={busy !== null} className={primary}>
            {busy === "keep" ? "Keeping…" : "Keep this browser's copy"}
          </button>
          <button onClick={() => setStep("confirm")} disabled={busy !== null} className={secondary}>
            Use the PC copy
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className={body}>
            This replaces the copy in this browser. It will be downloaded first, so nothing is lost. Type{" "}
            <span className="font-mono text-[11px] text-slate-900 dark:text-slate-100">{CONFIRM_WORD}</span>{" "}
            to continue.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value.toUpperCase())}
              placeholder={CONFIRM_WORD}
              spellCheck={false}
              autoComplete="off"
              className="w-32 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs tracking-widest text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#E11D48] focus:outline-none"
            />
            <button
              onClick={() => void applyPcCopy()}
              disabled={busy !== null || typed.trim().toUpperCase() !== CONFIRM_WORD}
              className={primary}
            >
              {busy === "pc" ? "Replacing…" : "Download, then replace"}
            </button>
            <button onClick={() => setStep("choose")} disabled={busy !== null} className={secondary}>
              Back
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="font-sans text-xs leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
      )}
      <p className={body}>
        Nothing has been merged, and nothing changes until you choose.
      </p>
    </div>
  );
}
