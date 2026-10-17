"use client";

import React, { useState } from "react";

import { RULES_TOGGLE_LABELS, type RulesProfile, type RulesToggleId } from "@/lib/review/types";
import { IconAlert, IconSliders } from "@/components/ui/icons";

/**
 * The rules profile.
 *
 * FOUR TOGGLES AND A NOTES BOX, and one line under each saying exactly what it removes. The panel is deliberately
 * blunt about direction: a toggle never adds an option or changes a finding, it only takes choices away, and the
 * sentence at the top says so. That is the difference between a preference and a self-imposed constraint.
 *
 * A toggle with nothing to act on says so. `neverRotateKeyPlayers` does nothing until a player carries an importance
 * marker, and a panel that stayed quiet would let a manager believe he was being protected when he was not.
 *
 * The notes are stored and never read by the engine. They are a place to think, not a rule.
 */
export function RulesProfilePanel({
  profile,
  toggles,
  idle,
  saving,
  onSave,
}: {
  profile: RulesProfile;
  toggles: Array<{ id: RulesToggleId; label: string; line: string }>;
  /** The toggles that currently have nothing to act on. */
  idle: RulesToggleId[];
  saving: boolean;
  onSave: (patch: { toggles?: Partial<Record<RulesToggleId, boolean>>; notes?: string | null }) => void;
}) {
  const [notes, setNotes] = useState(profile.notes ?? "");
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(profile.toggles).filter(Boolean).length;

  return (
    <div data-tour="rules-profile" className="rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          <IconSliders className="h-3.5 w-3.5 text-[#E11D48] dark:text-[#FF8C7A]" />
          Rules profile
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {activeCount} of {toggles.length} on
          </span>
        </span>
        <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            These only ever remove options from a review. Turning one on cannot add a finding, change a figure, or make
            the app suggest something it would not have suggested.
          </p>

          <div className="space-y-2">
            {toggles.map((toggle) => {
              const on = profile.toggles[toggle.id] === true;
              const isIdle = idle.includes(toggle.id);
              return (
                <div key={toggle.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="block font-sub text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                        {RULES_TOGGLE_LABELS[toggle.id]}
                      </span>
                      <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {toggle.line}
                      </p>
                      {isIdle && (
                        <p className="mt-1.5 flex items-start gap-1.5 font-sans text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                          <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
                          This one has nothing to act on yet: no player is marked as a key player. Mark one in the
                          squad and it will start applying.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={RULES_TOGGLE_LABELS[toggle.id]}
                      disabled={saving}
                      onClick={() => onSave({ toggles: { [toggle.id]: !on } })}
                      className={`relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
                        on ? "bg-[#E11D48] dark:bg-[#FF8C7A]" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] duration-200 ${
                          on ? "left-4.5" : "left-0.5"
                        }`}
                        style={{ left: on ? "1.125rem" : "0.125rem" }}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <label className="block">
            <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => onSave({ notes: notes.trim() === "" ? null : notes.trim() })}
              rows={3}
              placeholder="Anything you want to remember about your own rules. Nothing here is read by the app."
              className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>
      )}
    </div>
  );
}
