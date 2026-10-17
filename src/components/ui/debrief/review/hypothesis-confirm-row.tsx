"use client";

import React, { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import type { HypothesisWithEvidence } from "@/lib/hypotheses/types";
import { IconCheck, IconNote } from "@/components/ui/icons";

/**
 * The row that appears after a debrief or a block is saved.
 *
 * THREE PROPERTIES, ALL LOAD-BEARING.
 * 1. It never blocks the save. The save has already happened by the time this mounts, and nothing here can undo it.
 * 2. It hides itself when there is nothing to say. No open question speaks to the matches just saved means no row,
 *    which is the common case - a manager would otherwise be told "nothing to confirm" after every match.
 * 3. At most one extra question per save, and only when the question belongs to a hypothesis this save speaks to.
 *    The choice is by need: the question closest to being answerable wins.
 *
 * The sync is idempotent. Re-saving the same debrief re-reads the same window and writes nothing, because evidence
 * ids are derived from the pair (question, match).
 */

interface Speak {
  hypothesis: HypothesisWithEvidence;
  matchIds: string[];
}

export function HypothesisConfirmRow({
  careerId,
  eventIds,
  blockId,
}: {
  careerId: string;
  /** The events the save just wrote. Empty means nothing to sync and the row renders nothing. */
  eventIds: string[];
  /** The block the ids came from, when they came from a group debrief. */
  blockId?: string | null;
}) {
  const [speaksTo, setSpeaksTo] = useState<Speak[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [questionFor, setQuestionFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const key = eventIds.join(",");

  const sync = useCallback(async () => {
    if (careerId === "" || key === "") {
      setSpeaksTo([]);
      return;
    }
    try {
      const response = await apiFetch("/api/hypotheses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          action: "sync",
          eventIds,
          blockId: blockId ?? null,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        speaksTo?: Speak[];
        nextQuestion?: { hypothesis: HypothesisWithEvidence; question: string } | null;
      };
      if (!payload.success) {
        setSpeaksTo([]);
        return;
      }
      const list = payload.speaksTo ?? [];
      setSpeaksTo(list);
      const next = payload.nextQuestion ?? null;
      // The extra question is only offered when it belongs to a question this save actually speaks to, so a manager
      // is never asked about a match he did not just report on.
      const relevant = next !== null && list.some((entry) => entry.hypothesis.id === next.hypothesis.id);
      setQuestion(relevant ? next.question : null);
      setQuestionFor(relevant ? next.hypothesis.id : null);
    } catch {
      setSpeaksTo([]);
    }
    // `eventIds` is represented by `key` so the effect cannot re-run on a new array of the same ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerId, blockId, key]);

  useEffect(() => {
    const timer = window.setTimeout(() => void sync(), 0);
    return () => window.clearTimeout(timer);
  }, [sync]);

  const confirm = async (hypothesisId: string, eventId: string, stance: "FOR" | "AGAINST") => {
    setBusy(hypothesisId);
    try {
      const response = await apiFetch("/api/hypotheses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          id: hypothesisId,
          action: "evidence",
          eventIds: [eventId],
          stance,
          note: note.trim() === "" ? null : note.trim(),
        }),
      });
      const payload = (await response.json()) as { success?: boolean };
      if (payload.success) {
        setConfirmed((current) => ({ ...current, [`${hypothesisId}:${eventId}`]: true }));
        setNote("");
      }
    } finally {
      setBusy(null);
    }
  };

  if (speaksTo.length === 0) return null;

  return (
    <div
      data-tour="hypothesis-confirm-row"
      className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/50"
    >
      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        This save speaks to {speaksTo.length} open question{speaksTo.length === 1 ? "" : "s"}
      </span>

      {question !== null && (
        <div className="space-y-1.5">
          <p className="flex items-start gap-1.5 font-sans text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
            <IconNote className="mt-0.5 h-3 w-3 shrink-0 text-[#E11D48] dark:text-[#FF8C7A]" />
            {question}
          </p>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A note for the record (optional)"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-[11px] text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
      )}

      <div className="space-y-1.5">
        {speaksTo.map((entry) => {
          const eventId = entry.matchIds[0] ?? "";
          const done = confirmed[`${entry.hypothesis.id}:${eventId}`] === true;
          return (
            <div key={entry.hypothesis.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-[12rem] flex-1 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {entry.hypothesis.claim}
                <span className="ml-1 text-slate-400 dark:text-slate-500">
                  ({entry.matchIds.length} of the matches just saved)
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy === entry.hypothesis.id || done}
                  onClick={() => void confirm(entry.hypothesis.id, eventId, "FOR")}
                  className="flex cursor-pointer items-center gap-1 rounded-md bg-[#E11D48] px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
                >
                  <IconCheck className="h-2.5 w-2.5" />
                  {done ? "Counted" : "Stands for it"}
                </button>
                <button
                  type="button"
                  disabled={busy === entry.hypothesis.id || done}
                  onClick={() => void confirm(entry.hypothesis.id, eventId, "AGAINST")}
                  className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
                >
                  Against
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
        Confirm or ignore: the save is already in your record either way.
        {questionFor === null ? "" : " Confirming is what moves the question towards a verdict."}
      </p>
    </div>
  );
}
