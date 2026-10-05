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
                  By launching or accessing TouchlineOS, you agree to these Terms of Service. TouchlineOS is an independent, open-source companion software designed to read local career save files from EA SPORTS FC titles.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  2. Read-Only Local Guarantee
                </h3>
                <p>
                  TouchlineOS operates exclusively as a read-only parsing tool. It never modifies, writes to, or alters your EA SPORTS FC save files. You acknowledge that TouchlineOS holds zero liability for save file corruption caused by third-party tools or external game crashes.
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
                  TouchlineOS is built on a strict local-first architecture. On the desktop app, all
                  save file data, squad metrics, manager notes, and career timelines remain 100%
                  stored on your own disk. In the browser app, the same data is held in this
                  browser&rsquo;s private storage on your device and is not readable by any other
                  site. Either way it stays with you.
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
                  If you opt to enable remote AI narrative providers (such as Groq API), only
                  anonymized match event prompts are sent to that specific API provider. Your local
                  save files remain private.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  4. Reading Your Save File
                </h3>
                <p>
                  TouchlineOS reads the career save you choose, and on the desktop app it discovers
                  saves in the folders EA SPORTS FC writes them to. In the browser app you pick the
                  file yourself and the choice is yours alone. Reading is all it ever does — nothing
                  is written back to the save, and a reference to the file is all that is kept so
                  future visits do not ask you to find it again. See the Cookie Policy for the detail
                  on that storage and how to remove it.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  5. Player Portrait Images
                </h3>
                <p>
                  To show player faces, this app requests portrait images from a public image service
                  by player id. That request carries nothing about you, your career or your save. The
                  images are then cached on your device so squads load quickly and offline.
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
                  TouchlineOS does not use advertising cookies, cross-site trackers, or third-party
                  analytics pixels. There is no analytics script on this site and no personal profile
                  is built from your visit. Nothing here requires consent, because nothing here
                  follows you anywhere.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  2. Local Browser Storage
                </h3>
                <p>
                  We use standard HTML5 Local Storage solely to remember your active application
                  preferences across restarts — which tab you were on, your theme, your formation,
                  and which notices you have already dismissed.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  3. Your Career Database
                </h3>
                <p>
                  When you use TouchlineOS in a browser, your career data is held in this
                  browser&rsquo;s own private storage on your device. It is never uploaded, and it is
                  not readable by any other website. Clearing your browser data for this site deletes
                  it, which is why we recommend keeping an exported backup.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  4. Player Face Images
                </h3>
                <p>
                  Player portraits are downloaded from a public image service and cached in this
                  browser so squads load instantly and offline. This is a request for a picture by
                  player id only. No information about you, your career, or your save is sent with
                  it.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  5. Access To Your Save File
                </h3>
                <p>
                  To read your career, TouchlineOS must be given access to the save file you choose.
                  Where your browser supports it, we remember that file so future visits do not ask
                  you to find it again. We store only a reference to the file — never a copy of it —
                  and the permission to read it always remains yours to grant or withdraw. Your
                  browser will ask you to confirm it again from time to time, and this site cannot
                  and will not read a file you have not explicitly allowed. Access is withdrawn at
                  any time by clearing this site&rsquo;s data.
                </p>
              </div>

              <div>
                <h3 className="font-heading text-sm text-slate-900 uppercase mb-1">
                  6. Removing All Of It
                </h3>
                <p>
                  Because everything lives in this browser, you can erase all of it yourself by
                  clearing site data for this domain in your browser settings. Export a career backup
                  first if you want to keep your history.
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