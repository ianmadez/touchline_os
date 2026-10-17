"use client";

import React, { useState } from "react";

import type { HypothesisProposal } from "@/lib/hypotheses/types";
import { IconCheck, IconNote, IconSpark, IconUnavailable } from "@/components/ui/icons";

/**
 * The proposal inbox.
 *
 * A PROPOSAL IS NOT A FINDING. A finding says what the data shows; a proposal says "this keeps happening, do you want
 * to test it properly". Nothing appears here unless a signal repeated often enough to be worth the manager's
 * attention, and nothing is tracked until he accepts.
 *
 * Accepting can be amended first: the claim is his once it exists, so letting him reword it on the way in avoids an
 * edit immediately afterwards.
 */
export function HypothesisInbox({
  proposals,
  busyKey,
  onAccept,
  onDecline,
}: {
  proposals: HypothesisProposal[];
  busyKey: string | null;
  onAccept: (proposal: HypothesisProposal) => void;
  onDecline: (proposal: HypothesisProposal) => void;
}) {
  const [amending, setAmending] = useState<string | null>(null);
  const [claim, setClaim] = useState("");
  const [question, setQuestion] = useState("");

  if (proposals.length === 0) return null;

  return (
    <div data-tour="hypothesis-inbox" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <IconSpark className="h-3.5 w-3.5 text-[#E11D48] dark:text-[#FF8C7A]" />
          Worth testing
        </span>
        <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">
          {proposals.length} repeated signal{proposals.length === 1 ? "" : "s"} in this window
        </span>
      </div>

      {proposals.map((proposal) => {
        const editing = amending === proposal.key;
        return (
          <div
            key={proposal.key}
            className="space-y-2 rounded-2xl border border-amber-300/70 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10"
          >
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={claim}
                  onChange={(event) => setClaim(event.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="The question it should ask after a save"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === proposal.key || claim.trim() === ""}
                    onClick={() => {
                      onAccept({
                        ...proposal,
                        claim: claim.trim(),
                        question: question.trim() === "" ? null : question.trim(),
                      });
                      setAmending(null);
                    }}
                    className="cursor-pointer rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
                  >
                    Track it
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmending(null)}
                    className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-heading text-xs leading-snug text-slate-900 dark:text-slate-100">
                  {proposal.claim}
                </p>
                <p className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {proposal.why}
                </p>
                {proposal.question !== null && (
                  <p className="flex items-start gap-1.5 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                    <IconNote className="mt-0.5 h-3 w-3 shrink-0" />
                    After a save it would ask: {proposal.question}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === proposal.key}
                    onClick={() => onAccept(proposal)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#E11D48] px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
                  >
                    <IconCheck className="h-3 w-3" />
                    Track it
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === proposal.key}
                    onClick={() => {
                      setAmending(proposal.key);
                      setClaim(proposal.claim);
                      setQuestion(proposal.question ?? "");
                    }}
                    className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    Amend first
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === proposal.key}
                    onClick={() => onDecline(proposal)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 disabled:opacity-50 dark:text-slate-500"
                  >
                    <IconUnavailable className="h-3 w-3" />
                    Not this
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
