"use client";

import React from "react";

export type LegalDocType = "tos" | "privacy" | "cookies" | null;

interface LegalModalProps {
  activeDoc: LegalDocType;
  onClose: () => void;
}

export function LegalModal({ activeDoc, onClose }: LegalModalProps) {
  if (!activeDoc) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-panel-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <h2 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase">
            {activeDoc === "tos" && "Terms of Service"}
            {activeDoc === "privacy" && "Privacy Policy"}
            {activeDoc === "cookies" && "Cookie Policy"}
          </h2>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-10 min-w-10 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors font-bold text-lg"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {activeDoc === "tos" && (
            <>
              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  1. Acceptance of Terms
                </h3>
                <p>
                  By launching or accessing TouchlineOS, you agree to these Terms of Service. TouchlineOS is an independent, open-source companion software designed to read local career save files from EA SPORTS FC 25.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  2. Read-Only Local Guarantee
                </h3>
                <p>
                  TouchlineOS operates exclusively as a read-only parsing tool. It never modifies, writes to, or alters your EA SPORTS FC 25 save files. You acknowledge that TouchlineOS holds zero liability for save file corruption caused by third-party tools or external game crashes.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  3. Intellectual Property Disclaimer
                </h3>
                <p>
                  TouchlineOS is not affiliated with, endorsed by, or sponsored by Electronic Arts Inc., EA SPORTS, or FIFA. All player names, club badges, competition names, and trademarks belong strictly to their respective copyright holders.
                </p>
              </div>
            </>
          )}

          {activeDoc === "privacy" && (
            <>
              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  1. Local-First Privacy Commitment
                </h3>
                <p>
                  TouchlineOS is built on a strict local-first architecture. All save file data, squad metrics, manager notes, and career timelines remain 100% stored on your local disk within a local SQLite database.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  2. Zero Data Collection
                </h3>
                <p>
                  We do not collect, transmit, sell, or analyze your personal information, career save contents, or usage telemetry. No data is sent to external servers unless you manually configure a remote LLM API key in settings.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  3. Optional Third-Party APIs
                </h3>
                <p>
                  If you opt to enable remote AI narrative providers (such as Groq API), only anonymized match event prompts are sent to that specific API provider. Your local save files remain private.
                </p>
              </div>
            </>
          )}

          {activeDoc === "cookies" && (
            <>
              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  1. Zero Tracking Cookies
                </h3>
                <p>
                  TouchlineOS does not use advertising cookies, cross-site trackers, or third-party analytics pixels.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  2. Local Browser Storage
                </h3>
                <p>
                  We use standard HTML5 Local Storage solely to remember your active application preferences (such as selected UI tab or active save directory path) across app restarts.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-heading text-xs font-bold uppercase rounded-xl transition-colors"
          >
            Close Document
          </button>
        </div>
      </div>
    </div>
  );
}