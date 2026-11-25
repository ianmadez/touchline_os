"use client";

import React, { useRef, useState } from "react";

interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Restore a career from an exported JSON, offered on the Portal.
 *
 * Settings holds the same importer, but every tab except the Portal stays locked until a career exists,
 * so a manager whose browser storage was just cleared had no way to reach it: exactly the person who
 * needs it most. This puts the importer where a fresh browser lands.
 */
export function RestoreBackup({ onImport, onRestored }: { onImport: (contents: string) => Promise<ActionResult>; onRestored: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await onImport(await file.text());
      setResult(outcome);
      if (outcome.ok) onRestored();
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message ?? "Could not read that file." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section
      aria-label="Restore from a backup"
      className="mx-auto mb-6 max-w-3xl rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">Already have a career backup?</p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Cleared your browser or switched device? Load the JSON you exported and everything comes back: debriefs, notes,
            finances and tactics.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 font-sub text-[11px] font-bold uppercase text-slate-700 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
        >
          {busy ? "Restoring…" : "Restore from backup"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(file);
          }}
        />
      </div>
      {busy && (
        <p role="status" className="mt-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 font-sub text-xs text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
          Reading the backup and rebuilding your career. A big file takes a few seconds…
        </p>
      )}
      {result && (
        <div
          role={result.ok ? "status" : "alert"}
          className={`mt-3 rounded-xl border px-4 py-3 font-sub text-xs ${
            result.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-200"
              : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300"
          }`}
        >
          <p className="font-bold uppercase tracking-wider">{result.ok ? "Career restored" : "That didn't work"}</p>
          <p className="mt-0.5 font-sans">{result.message}</p>
        </div>
      )}
    </section>
  );
}
