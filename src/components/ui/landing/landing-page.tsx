"use client";

import React, { useState } from "react";
import Image from "next/image";
import { SaveCandidate } from "@/lib/parser/interface";

interface LandingPageProps {
  saveCandidate: SaveCandidate | null;
  onEnterPortal: () => void;
  /** True once a scan finished and found no career save. */
  noSaveDetected?: boolean;
  onRescan?: () => void;
}

export function LandingPage({
  saveCandidate,
  onEnterPortal,
  noSaveDetected = false,
  onRescan,
}: LandingPageProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Paste your image paths in `imageSrc` whenever you have them ready!
  const bentoImages = {
    snapshots: "", // e.g. "/screenshots/snapshot-audit.png"
    pitch: "",     // e.g. "/screenshots/pitch-2d.png"
    notebook: "",  // e.g. "/screenshots/card-flip.png"
    bridge: "",    // e.g. "/screenshots/save-picker.png"
    youth: "",     // e.g. "/screenshots/youth-tracker.png"
    events: "",    // e.g. "/screenshots/timeline.png"
  };

  const faqs = [
    {
      q: "Does TouchlineOS work on PlayStation or Xbox, or PC only?",
      a: "TouchlineOS parses save files directly from local storage, making save file auto-detection seamless on PC (EA App, Steam, Epic Games). Console players can still manually log match debriefs and manage tactical notebooks.",
    },
    {
      q: "Where do I find my EA SPORTS FC save file on my computer?",
      a: "TouchlineOS auto-detects your save folder on launch. It checks the places EA SPORTS FC writes careers to — a settings folder inside your Documents (in an FC 25 or FC 26 folder, including OneDrive Documents) and AppData\\Local\\EA SPORTS FC 25 or 26 — then lists every career save it finds.",
    },
    {
      q: "Do I need any programming or technical knowledge to use this?",
      a: "Zero technical skill required. You simply launch TouchlineOS, select your detected save file, and the application builds your interactive career workspace automatically.",
    },
    {
      q: "Does TouchlineOS edit, corrupt, or modify my original save file?",
      a: "Never. TouchlineOS operates as a strict read-only parser. It extracts data into a separate local database on your computer without ever writing back to or altering your game save.",
    },
    {
      q: "What happens if EA SPORTS FC receives an official title update or patch?",
      a: "Your career records in TouchlineOS remain completely safe. Because snapshot history is written to your local database, official EA title patches will not erase your past season history or notes.",
    },
    {
      q: "Is TouchlineOS free, and is my data sent to any cloud servers?",
      a: "TouchlineOS is 100% free and open-source. All parsing and data storage happen locally on your PC. No personal save data is uploaded anywhere.",
    },
    {
      q: "How is this different from tracking my career in Google Sheets or Excel?",
      a: "TouchlineOS reads your save file directly, so there is no spreadsheet to keep. Squad tables, 2D pitch views and your full history fill themselves in.",
    },
    {
      q: "What happens if I connect TouchlineOS halfway through an existing career?",
      a: "TouchlineOS reads your save at its current state and establishes an initial baseline snapshot. Every sync from that point forward tracks transfers, squad progression, and rating changes seamlessly.",
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 space-y-24">
      {/* PUNCHY HERO SECTION - FULL VIEWPORT FIT */}
      <section className="flex flex-col items-center justify-center text-center py-4 sm:py-8 min-h-[calc(100vh-100px)]">

        <h1 className="font-heading text-3xl sm:text-5xl lg:text-6xl text-slate-900 dark:text-slate-100 uppercase tracking-wide max-w-3xl leading-tight mb-3">
          Turn Your FC Save Into A <br />
          <span className="text-[#E11D48]">Living Managerial Career.</span>
        </h1>

        <p className="font-sans text-slate-600 dark:text-slate-300 max-w-lg text-xs sm:text-sm mb-5 leading-relaxed font-medium">
          TouchlineOS runs beside your career mode—remembering every squad change, tracking your manager philosophy, and giving every season real narrative weight.
        </p>

        {/* Local Save Detector Box */}
        {saveCandidate ? (
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all text-left mb-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-2">
              <span className="font-sub text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                ✓ Save Detected
              </span>
              <span className="font-sub text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {(saveCandidate.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <h3 className="font-heading text-xs text-slate-900 dark:text-slate-100 truncate">
              {saveCandidate.fileName}
            </h3>
            <p className="font-sub text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {saveCandidate.filePath}
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-md mb-5 text-center space-y-2">
            <span className="font-sub text-xs text-slate-500 dark:text-slate-400 block">
              {noSaveDetected
                ? "No EA SPORTS FC career save detected on this machine yet"
                : "Scanning for EA SPORTS FC career saves..."}
            </span>
            {noSaveDetected && onRescan && (
              <button
                onClick={onRescan}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-sub text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-all cursor-pointer"
              >
                Re-scan save folders
              </button>
            )}
          </div>
        )}

        {/* Primary Red CTA Button */}
        <button
          onClick={onEnterPortal}
          className="px-8 py-3.5 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase rounded-xl shadow-lg shadow-rose-600/20 hover:shadow-xl hover:shadow-[#FF8C7A]/30 transition-[background-color,box-shadow,transform] duration-200 hover:scale-102 active:scale-[0.96] hover:-translate-y-0.5 cursor-pointer"
        >
          Enter Portal →
        </button>
      </section>

      {/* HOW IT WORKS (VERTICAL GUIDE) */}
      <section id="how-it-works" className="scroll-mt-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 sm:p-12 shadow-xl">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="font-sub text-xs text-[#E11D48] uppercase tracking-widest font-bold block mb-1">
            Manager Workflow
          </span>
          <h2 className="font-heading text-2xl sm:text-4xl text-slate-900 dark:text-slate-100 uppercase">
            How TouchlineOS Operates
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[#E11D48] dark:text-rose-400 font-heading text-xl flex items-center justify-center shadow-xs">
              01
            </div>
            <h3 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase">
              Connect Save
            </h3>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Point TouchlineOS at your EA SPORTS FC save folder. Our bridge reads squad rosters, contracts, and finances cleanly.
            </p>
          </div>

          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[#E11D48] dark:text-rose-400 font-heading text-xl flex items-center justify-center shadow-xs">
              02
            </div>
            <h3 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase">
              Sync Snapshots
            </h3>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Every save sync writes an immutable snapshot (Snapshot N → N+1). Transfers, squad depth, and rating deltas are auto-detected.
            </p>
          </div>

          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[#E11D48] dark:text-rose-400 font-heading text-xl flex items-center justify-center shadow-xs">
              03
            </div>
            <h3 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase">
              Annotate & Debrief
            </h3>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Mark key players as Untouchable, assign tactical roles on a 2D pitch, and answer targeted post-match debrief questions.
            </p>
          </div>

          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[#E11D48] dark:text-rose-400 font-heading text-xl flex items-center justify-center shadow-xs">
              04
            </div>
            <h3 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase">
              Evolve Your Career
            </h3>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Receive clear squad advice, follow player progression, and watch your managerial story build over multiple seasons.
            </p>
          </div>
        </div>
      </section>

      {/* BENTO SHOWCASE - CLEAN NO BADGES WITH UNIFORM IMAGE SLOTS */}
      <section id="features" className="scroll-mt-24 space-y-8">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="font-heading text-2xl sm:text-4xl text-slate-900 dark:text-slate-100 uppercase">
            Deep Product Capabilities
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Card 1: Wide Featured Card (8 cols) */}
          <div className="md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-xl sm:text-2xl text-slate-900 dark:text-slate-100 uppercase mb-2">
                Immutable Save Snapshots
              </h3>
              <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Every save sync creates a permanent audit record. Compare Snapshot N vs N-1 to track transfers, squad depth, and rating changes.
              </p>
            </div>

            <div className="relative w-full h-60 sm:h-72 rounded-2xl bg-slate-900 dark:bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 font-sub text-xs uppercase">
              {bentoImages.snapshots ? (
                <Image
                  src={bentoImages.snapshots}
                  alt="Snapshot Audit View"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: Snapshot Audit View ]</span>
              )}
            </div>
          </div>

          {/* Card 2: Pitch Canvas (4 cols) */}
          <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase mb-2">
                2D Interactive Pitch
              </h3>
              <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Map your starting XI across 13 distinct 3, 4, and 5-at-the-back tactical shapes directly on a realistic pitch overlay.
              </p>
            </div>

            <div className="relative w-full h-60 sm:h-72 rounded-2xl bg-slate-900 dark:bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 font-sub text-xs uppercase">
              {bentoImages.pitch ? (
                <Image
                  src={bentoImages.pitch}
                  alt="2D Pitch Canvas"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: 2D Pitch Canvas ]</span>
              )}
            </div>
          </div>

          {/* Card 3: Manager Notebook (4 cols) */}
          <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase mb-2">
                Manager Intent Notebook
              </h3>
              <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Tag players as Untouchable or Surplus. Set custom trust levels and bespoke roles no AI can overwrite.
              </p>
            </div>

            <div className="relative w-full h-44 rounded-2xl bg-slate-200/60 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 dark:text-slate-500 font-sub text-xs uppercase">
              {bentoImages.notebook ? (
                <Image
                  src={bentoImages.notebook}
                  alt="Player Card Assessment"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: Player Assessment ]</span>
              )}
            </div>
          </div>

          {/* Card 4: Save Bridge (4 cols) */}
          <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase mb-2">
                Save Bridge
              </h3>
              <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Auto-detects local save directories and extracts factual squad data, player overall ratings, and wages.
              </p>
            </div>

            <div className="relative w-full h-44 rounded-2xl bg-slate-200/60 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 dark:text-slate-500 font-sub text-xs uppercase">
              {bentoImages.bridge ? (
                <Image
                  src={bentoImages.bridge}
                  alt="Save Bridge Picker"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: Save Bridge ]</span>
              )}
            </div>
          </div>

          {/* Card 5: Youth Prospects (4 cols) */}
          <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase mb-2">
                Youth Prospect Tracker
              </h3>
              <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Monitors academy talent directly from save files, tracking growth trajectories into first-team stars.
              </p>
            </div>

            <div className="relative w-full h-44 rounded-2xl bg-slate-200/60 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 dark:text-slate-500 font-sub text-xs uppercase">
              {bentoImages.youth ? (
                <Image
                  src={bentoImages.youth}
                  alt="Youth Prospect Tracker"
                  fill
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: Youth Tracker ]</span>
              )}
            </div>
          </div>

          {/* Card 6: Timeline & grounded AI */}
          <div className="md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl hover:border-rose-300 dark:hover:border-rose-500/60 transition-all flex flex-col justify-between">
            <div className="mb-4">
              <h3 className="font-heading text-xl text-slate-900 dark:text-slate-100 uppercase mb-2">
                Timeline & Grounded AI
              </h3>
              <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Every career milestone is logged automatically, with a clear note of where each fact came from. Optional local Ollama and Groq models add narrative colour without ever rewriting your save history.
              </p>
            </div>

            <div className="relative w-full h-44 rounded-2xl bg-slate-200/60 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center text-slate-400 dark:text-slate-500 font-sub text-xs uppercase">
              {bentoImages.events ? (
                <Image
                  src={bentoImages.events}
                  alt="Event Timeline Feed"
                  fill
                  sizes="(min-width: 768px) 66vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <span>[ Image Slot: Event Timeline Feed ]</span>
              )}
            </div>
          </div>

          {/* Card 7: And Much More (4 cols) */}
          <div className="md:col-span-4 bg-gradient-to-br from-slate-900 to-slate-950 text-white border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center text-center space-y-3">
            <span className="w-10 h-10 rounded-2xl bg-[#E11D48] text-white font-heading text-lg flex items-center justify-center">
              +
            </span>
            <h3 className="font-heading text-lg uppercase">
              ...And Much More!
            </h3>
            <p className="font-sans text-xs text-slate-300 leading-relaxed">
              Including post-match debriefs, board objective tracking, your own realism rules, and local database exports.
            </p>
          </div>
        </div>
      </section>

      {/* ROADMAP SECTION */}
      <section id="roadmap" className="scroll-mt-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 sm:p-12 shadow-xl">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="font-sub text-xs text-[#E11D48] uppercase tracking-widest font-bold block mb-1">
            Development Plan
          </span>
          <h2 className="font-heading text-2xl sm:text-4xl text-slate-900 dark:text-slate-100 uppercase">
            Project Roadmap
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-left">
          <div className="border-l-2 border-[#E11D48] pl-4">
            <span className="font-sub text-[10px] text-[#E11D48] font-bold uppercase tracking-wider block">
              Phase 0 - 7 (Active MVP)
            </span>
            <h4 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase mt-0.5 mb-1">
              The Solid Core
            </h4>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              Reads your save, tracks every change, and keeps your squad, tactics and timeline in step.
            </p>
          </div>

          <div className="border-l-2 border-slate-300 dark:border-slate-700 pl-4">
            <span className="font-sub text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">
              v0.2
            </span>
            <h4 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase mt-0.5 mb-1">
              Dynamic Debriefs
            </h4>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              Anomaly-triggered post-match questions, storyline tracking, and basic analytics graphs.
            </p>
          </div>

          <div className="border-l-2 border-slate-300 dark:border-slate-700 pl-4">
            <span className="font-sub text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">
              v0.3
            </span>
            <h4 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase mt-0.5 mb-1">
              Transfers & Youth
            </h4>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              Explainable shortlist fit scores, scouting memory, and youth prospect tracking.
            </p>
          </div>

          <div className="border-l-2 border-slate-300 dark:border-slate-700 pl-4">
            <span className="font-sub text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider block">
              v1.0
            </span>
            <h4 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase mt-0.5 mb-1">
              Grounded AI Layer
            </h4>
            <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
              Local Ollama & Groq router for grounded, retcon-free managerial narrative generation.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className="scroll-mt-24 max-w-3xl mx-auto space-y-6">
        <div className="text-center">
          <span className="font-sub text-xs text-[#E11D48] uppercase tracking-widest font-bold block mb-1">
            Questions & Answers
          </span>
          <h2 className="font-heading text-2xl sm:text-3xl text-slate-900 dark:text-slate-100 uppercase">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs transition-all"
              >
                <button
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                  className="w-full text-left p-4.5 font-heading text-sm text-slate-900 dark:text-slate-100 uppercase flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                >
                  <span>{faq.q}</span>
                  <span className="text-[#E11D48] font-bold text-base ml-2">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4.5 pb-4.5 font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* CALL TO ACTION BANNER */}
      <section className="bg-gradient-to-r from-slate-900 to-slate-950 text-white rounded-3xl p-8 sm:p-12 text-center shadow-2xl relative overflow-hidden">
        <h2 className="font-heading text-2xl sm:text-4xl uppercase tracking-wide mb-3">
          Ready To Command Your Save?
        </h2>
        <p className="font-sans text-slate-300 text-sm max-w-lg mx-auto mb-6">
          Connect your EA SPORTS FC save file and experience persistent, intelligent career tracking today.
        </p>
        <button
          onClick={onEnterPortal}
          className="px-8 py-3.5 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase rounded-xl transition-[background-color,transform,box-shadow] duration-200 cursor-pointer shadow-lg hover:scale-[1.02] active:scale-[0.96]"
        >
          Enter TouchlineOS →
        </button>
      </section>
    </div>
  );
}