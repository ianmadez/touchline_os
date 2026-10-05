"use client";

import React, { useEffect, useState } from "react";
import { LegalDocType } from "./legal-modal";

/**
 * The first-visit notice about what this app keeps in the browser.
 *
 * Shown once, then remembered, because a notice that reappears is noise rather than information.
 *
 * It is deliberately NOT a consent gate, and saying so is the point. There is nothing here to
 * consent to: TouchlineOS sets no tracking cookies, runs no analytics, and sends no career data
 * anywhere. Everything it stores is what makes the app work on this device. So the notice explains,
 * and the only thing the button does is stop it appearing again - dressing that up as permission
 * would be asking for consent to something that never happens.
 *
 * The one thing worth disclosing plainly is access to the save file, because that is a real
 * permission the browser grants and the manager can withdraw. The wording states what is stored (a
 * reference, never a copy) and that the browser will sometimes ask again, so a later prompt reads as
 * the system working rather than something having broken.
 *
 * Dismissal lives in its own localStorage key rather than inside the session blob, the same way the
 * dismissed-cards store does: rewriting the session on a tab change must never resurrect this.
 */
const NOTICE_KEY = "touchline.notice.v1";

/** Whether this browser has already been told. Never throws. */
function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "seen";
  } catch {
    // Storage blocked. The notice then shows on every visit rather than never, which is the safer
    // way to fail for a disclosure: visible and mildly repetitive beats invisible.
    return false;
  }
}

function rememberSeen(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, "seen");
  } catch {
    // Nothing to do - it simply shows again next time.
  }
}

interface LocalStorageNoticeProps {
  onOpenLegal?: (doc: LegalDocType) => void;
}

export function LocalStorageNotice({ onOpenLegal }: LocalStorageNoticeProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Deferred by a task rather than set in the effect body: a synchronous `setState` here trips
    // `react-hooks/set-state-in-effect`, and reading localStorage during render would prerender the
    // wrong answer and mismatch on hydration.
    const timer = window.setTimeout(() => setVisible(!alreadySeen()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    rememberSeen();
    setVisible(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:flex-row sm:items-center">
        <p className="flex-1 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          TouchlineOS keeps everything on this device. Your career database, cached player faces and a
          reference to the save file you pick are stored in this browser and never uploaded. There are
          no tracking cookies and no analytics.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onOpenLegal?.("cookies")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-sub text-[11px] uppercase tracking-wider text-slate-600 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] dark:border-slate-700 dark:text-slate-300 dark:hover:text-[#FF8C7A] cursor-pointer"
          >
            Cookie policy
          </button>
          <button
            onClick={dismiss}
            className="rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#FF8C7A] cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
