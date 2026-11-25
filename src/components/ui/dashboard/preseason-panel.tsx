"use client";

import React, { useState } from "react";
import { apiFetch } from "@/lib/platform/api-client";

/**
 * Declare pre-season friendlies straight from the dashboard.
 *
 * The save counts friendlies in its season record and keeps nothing that says which of its matches
 * were friendlies, so the manager tells us. Each row becomes an ordinary debrief tagged
 * "Friendly / Pre-season": score and opponent now, everything else (scorers, stats, reflection) can be
 * added later from the Debrief tab's edit button, like any other logged match.
 */
const FRIENDLY_COMPETITION = "Friendly / Pre-season";

interface Row {
  opponent: string;
  ours: string;
  theirs: string;
  date: string;
}

const emptyRow = (): Row => ({ opponent: "", ours: "", theirs: "", date: "" });

interface PreseasonPanelProps {
  careerId: string;
  /** The save's all-competition count, friendlies included. */
  saveGamesPlayed: number;
  /** Friendlies already declared this season. */
  declared: number;
  onClose: () => void;
  onSaved: () => void;
  onOpenDebriefs: () => void;
}

export function PreseasonPanel({ careerId, saveGamesPlayed, declared, onClose, onSaved, onOpenDebriefs }: PreseasonPanelProps) {
  const undeclared = Math.max(0, saveGamesPlayed - declared);
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: Math.max(1, Math.min(undeclared, 3)) }, emptyRow));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const complete = rows.filter((row) => row.opponent.trim() && row.ours !== "" && row.theirs !== "");

  const save = async () => {
    if (complete.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const row of complete) {
        const response = await apiFetch("/api/debrief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            careerId,
            opponent: row.opponent.trim(),
            homeScore: Number(row.ours),
            awayScore: Number(row.theirs),
            matchDate: row.date || null,
            venue: "NEUTRAL",
            competition: FRIENDLY_COMPETITION,
            tacticalAdherence: 3,
            weaknessIdentified: "",
            managerReflection: "",
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) throw new Error(body.error ?? "Could not save that friendly.");
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const input =
    "min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60" role="region" aria-label="Declare pre-season friendlies">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        The save counts pre-season friendlies in its season record ({saveGamesPlayed} so far) and does not say which matches they
        were. Add them here and they come off your league progress. Scorers, stats and notes can be added later from the Debrief tab.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_10rem]">
            <input aria-label={`Friendly ${index + 1} opponent`} placeholder="Opponent" value={row.opponent} onChange={(e) => set(index, { opponent: e.target.value })} className={input} />
            <input aria-label={`Friendly ${index + 1} our goals`} placeholder="Us" inputMode="numeric" type="number" min={0} value={row.ours} onChange={(e) => set(index, { ours: e.target.value })} className={input} />
            <input aria-label={`Friendly ${index + 1} their goals`} placeholder="Them" inputMode="numeric" type="number" min={0} value={row.theirs} onChange={(e) => set(index, { theirs: e.target.value })} className={input} />
            <input aria-label={`Friendly ${index + 1} date`} type="date" value={row.date} onChange={(e) => set(index, { date: e.target.value })} className={`${input} col-span-3 sm:col-span-1`} />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])} className="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800">
          + Another
        </button>
        <button type="button" onClick={onOpenDebriefs} className="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800">
          Edit logged matches
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800">
          Cancel
        </button>
        <button type="button" disabled={saving || complete.length === 0} onClick={() => void save()} className="rounded-lg bg-[#E11D48] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#FF8C7A] disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Saving…" : `Save ${complete.length || ""} ${complete.length === 1 ? "friendly" : "friendlies"}`}
        </button>
      </div>
    </div>
  );
}
