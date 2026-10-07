"use client";

import React from "react";
import { LegalDocType } from "./legal-modal";

interface LandingFooterProps {
  onOpenLegal?: (doc: LegalDocType) => void;
}

export function LandingFooter({ onOpenLegal }: LandingFooterProps) {
  return (
    <footer className="w-full bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 pt-16 pb-24 xl:pb-32 px-6 relative overflow-hidden">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12">
          {/* Col 1: Brand Philosophy */}
          <div className="md:col-span-4 space-y-3">
            <span className="font-heading text-2xl text-slate-900 dark:text-slate-100">
              TOUCHLINE<span className="text-[#E11D48]">OS</span>
            </span>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-sm">
              A persistent football intelligence and roleplay layer that turns an EA FC Career Mode save into a living managerial career.
            </p>
          </div>

          {/* Col 2: Legal Pages */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="font-sub text-xs text-slate-900 dark:text-slate-100 uppercase font-bold tracking-wider">
              Legal
            </h4>
            <ul className="space-y-2 font-sub text-xs text-slate-600 dark:text-slate-300">
              <li>
                <button
                  onClick={() => onOpenLegal?.("tos")}
                  className="hover:text-[#E11D48] transition-colors cursor-pointer"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  onClick={() => onOpenLegal?.("privacy")}
                  className="hover:text-[#E11D48] transition-colors cursor-pointer"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  onClick={() => onOpenLegal?.("cookies")}
                  className="hover:text-[#E11D48] transition-colors cursor-pointer"
                >
                  Cookie Policy
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Resources & Dev */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-sub text-xs text-slate-900 dark:text-slate-100 uppercase font-bold tracking-wider">
              Resources & Source
            </h4>
            <ul className="space-y-2 font-sub text-xs text-slate-600 dark:text-slate-300">
              <li>
                <a
                  href="https://github.com/ianmadez/touchline_os"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#E11D48] transition-colors flex items-center gap-1.5"
                >
                  GitHub Repository ↗
                </a>
              </li>
              <li>
                <a
                  href="https://discord.gg/qVVwMZAAY"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#E11D48] transition-colors"
                >
                  Discord Community ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ianmadez/touchline_os/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#E11D48] transition-colors"
                >
                  MIT License ↗
                </a>
              </li>
              <li>
                <span className="text-slate-400 dark:text-slate-500">Local Parser Specs v1.0</span>
              </li>
            </ul>
          </div>

          {/* Col 4: Support / Buy Me A Coffee */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-sub text-xs text-slate-900 dark:text-slate-100 uppercase font-bold tracking-wider">
              Support Development
            </h4>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              TouchlineOS is local-first and open source. Donations are appreciated and will go towards supporting project maintenance:
            </p>
            <a
              href="https://ko-fi.com/ianmadezoss"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-amber-400 hover:bg-amber-300 text-slate-950 font-sub text-xs font-bold uppercase rounded-xl transition-[background-color,transform] shadow-xs hover:scale-[1.02] active:scale-[0.96]"
            >
              Support Development (Ko-Fi)
            </a>
          </div>
        </div>

        {/* Bottom Bar — clean flex row, explicit separation from the watermark */}
        <div className="mt-12 border-t border-slate-200 dark:border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between text-slate-500 dark:text-slate-400 font-sub text-xs gap-4">
          <p>Copyright © 2026 ianmadez. First-party code is MIT-licensed.</p>
          <div className="flex items-center gap-6">
            <span>Local-First</span>
            <span>•</span>
            <span>Read-Only Parser</span>
            <span>•</span>
            <span>Zero Save Alterations</span>
          </div>
        </div>
      </div>

      {/* Big Negative Space Background Brand Watermark — clipped behind content, never intercepts clicks */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute bottom-0 left-1/2 -translate-x-1/2 z-0 text-[clamp(2.5rem,9vw,7rem)] leading-[0.8] font-heading font-extrabold text-slate-900 dark:text-slate-100 opacity-5 dark:opacity-10 tracking-tighter whitespace-nowrap"
      >
        TOUCHLINEOS
      </div>
    </footer>
  );
}