"use client";

import React, { useState } from "react";
import { SaveCandidate } from "@/lib/parser/interface";
import { FORMATIONS_REGISTRY, FormationDefinition } from "@/lib/tactics/formations";

const FORMATION_CATEGORY_LABELS: Record<FormationDefinition["category"], string> = {
  "4-at-the-back": "4-Defender Backlines",
  "5-at-the-back": "5-Defender Backlines",
  "3-at-the-back": "3-Defender Backlines",
};

export interface OnboardingSubmission {
  selectedSave: SaveCandidate;
  managerName: string;
  nationality: string;
  clubName: string;
  clubLogoUrl: string;
  clubInfo: string;
  tacticalPhilosophy: string;
  realismLevel: "STRICT_REALISM" | "REALISTIC" | "BALANCED" | "CASUAL" | "CHAOS";
  favFormations: string[];
  managerObjective: string;
  boardObjective: string;
  personalObjective: string;
}

interface OnboardingWizardProps {
  saveCandidates: SaveCandidate[];
  onCompleteOnboarding: (data: OnboardingSubmission) => void | Promise<void>;
  saveScanComplete?: boolean;
  onRescan?: () => void;
}

export function OnboardingWizard({
  saveCandidates,
  onCompleteOnboarding,
  saveScanComplete = false,
  onRescan,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedSave, setSelectedSave] = useState<SaveCandidate | null>(
    saveCandidates[0] || null
  );

  const [managerName, setManagerName] = useState("Jean Lacroix");
  const [nationality, setNationality] = useState("France");
  const [clubName, setClubName] = useState("Wigan Athletic");
  const [clubLogoUrl, setClubLogoUrl] = useState("");
  const [clubInfo, setClubInfo] = useState("League One rebuild targeting sustainable youth development and tactical dominance.");
  const [logoInputMode, setLogoInputMode] = useState<"UPLOAD" | "LINK">("UPLOAD");
  const [isDragging, setIsDragging] = useState(false);
  const [tacticalPhilosophy, setTacticalPhilosophy] = useState("Gegenpress Heavy");

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setClubLogoUrl(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };
  const [favFormations, setFavFormations] = useState<string[]>([
    "4-3-3-holding",
    "4-2-3-1-narrow",
  ]);
  const [realismLevel, setRealismLevel] = useState<
    "STRICT_REALISM" | "REALISTIC" | "BALANCED" | "CASUAL" | "CHAOS"
  >("REALISTIC");

  const [managerObjective, setManagerObjective] = useState(
    "Dominate middle of pitch with central overloads & pacy wingers"
  );
  const [boardObjective, setBoardObjective] = useState(
    "Achieve promotion or European qualification within 2 seasons"
  );
  const [personalObjective, setPersonalObjective] = useState(
    "Develop youth academy prospects into untouchable club legends"
  );

  const [isCustomVision, setIsCustomVision] = useState(false);
  const [isCustomBoard, setIsCustomBoard] = useState(false);
  const [isCustomPersonal, setIsCustomPersonal] = useState(false);

  const tacticalVisionPresets = [
    "Dominate middle of pitch with central overloads & pacy wingers",
    "Possession-dominant tiki-taka with relentless Gegenpress",
    "Direct counter-attacking with rapid wide transitions",
    "Unbreakable defensive low-block & set-piece mastery",
    "Youth-first high-intensity pressing & midfield turnovers",
  ];

  const boardMandatePresets = [
    "Achieve promotion or European qualification within 2 seasons",
    "Win domestic league in 5 years & compete in Europe",
    "Maintain strict financial balance & positive transfer net spend",
    "Avoid relegation, consolidate league position & rebuild",
    "Win at least one major domestic cup within 3 seasons",
  ];

  const personalLegacyPresets = [
    "Win everything — domestic treble & continental dominance",
    "Develop youth academy prospects into untouchable club legends",
    "Rebuild a fallen giant back to its historical glory",
    "Build a multi-decade one-club managerial dynasty",
    "Break all-time club records for goals scored & points tally",
  ];

  const toggleFormation = (fmt: string) => {
    if (favFormations.includes(fmt)) {
      setFavFormations(favFormations.filter((f) => f !== fmt));
    } else {
      setFavFormations([...favFormations, fmt]);
    }
  };

  return (
    <div className="max-w-3xl mx-auto my-3 sm:my-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl backdrop-blur-xl transition-colors">
      {/* Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 mb-4 text-center">
        <h1 className="font-heading text-xl sm:text-2xl text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-1">
          Manager Appointment Protocol
        </h1>
        <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300">
          Configure save connectivity, managerial philosophy, transfer bounds, and career objectives.
        </p>

        <div className="flex items-center justify-center gap-2 mt-3">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                step >= s
                  ? "w-8 bg-[#E11D48]"
                  : "w-5 bg-slate-200 dark:bg-slate-800"
              }`}
            />
          ))}
        </div>
      </div>

      {/* STEP 1: SAVE FILE */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-[#E11D48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h2 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Step 1: Select Your Save File
            </h2>
          </div>

          <div className="space-y-3">
            {saveCandidates.map((cand) => {
              const isSelected = selectedSave?.id === cand.id;
              return (
                <div
                  key={cand.id}
                  onClick={() => setSelectedSave(cand)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? "border-[#E11D48] bg-rose-50/50 dark:bg-rose-950/20 shadow-xs"
                      : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-heading text-sm text-slate-900 dark:text-slate-100">
                        {cand.fileName}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-sub font-bold text-[#E11D48] uppercase tracking-wider">
                          Active Selection
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sub truncate max-w-md">
                      {cand.filePath}
                    </p>
                  </div>
                  <div className="text-right shrink-0 pl-4">
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-sub block">
                      {(cand.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <span className="text-[10px] text-slate-400 font-sub">
                      {new Date(cand.lastModified).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {saveCandidates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-6 text-center space-y-2">
              <p className="font-heading text-sm text-slate-900 dark:text-slate-100 uppercase">
                {saveScanComplete ? "No FC25 save detected" : "Scanning for local saves…"}
              </p>
              <p className="font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                TouchlineOS reads manager careers from EA FC 25 settings folders and from{" "}
                <code className="font-mono text-slate-900 dark:text-slate-100">data/saves/</code>.
              </p>
              {onRescan && (
                <button
                  onClick={onRescan}
                  className="mt-1 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-sub uppercase tracking-wider text-slate-700 dark:text-slate-200 hover:border-[#E11D48] hover:text-[#E11D48] transition-all cursor-pointer"
                >
                  Re-scan save folders
                </button>
              )}
            </div>
          )}

          <button
            disabled={!selectedSave}
            onClick={() => setStep(2)}
            className="w-full mt-8 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase py-3.5 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
          >
            Continue to Manager Identity →
          </button>
        </div>
      )}

      {/* STEP 2: MANAGER IDENTITY & CLUB BRANDING */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-[#E11D48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <h2 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Step 2: Manager Profile & Club Branding
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 mb-1.5 font-semibold">
                Manager Full Name
              </label>
              <input
                type="text"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
              />
            </div>

            <div>
              <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 mb-1.5 font-semibold">
                Nationality
              </label>
              <input
                type="text"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
              />
            </div>
          </div>

          {/* Club Identity Section */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Club Branding & Metadata
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLogoInputMode("UPLOAD")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-sub font-bold uppercase border cursor-pointer ${
                    logoInputMode === "UPLOAD"
                      ? "bg-[#E11D48] text-white border-[#E11D48]"
                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  Upload Image
                </button>
                <button
                  type="button"
                  onClick={() => setLogoInputMode("LINK")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-sub font-bold uppercase border cursor-pointer ${
                    logoInputMode === "LINK"
                      ? "bg-[#E11D48] text-white border-[#E11D48]"
                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  Image Link
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              {/* Club Logo Upload Box / URL Input */}
              <div className="sm:col-span-1">
                {logoInputMode === "UPLOAD" ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`relative aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-3 text-center transition-all ${
                      isDragging
                        ? "border-[#E11D48] bg-[#E11D48]/10"
                        : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    }`}
                  >
                    {clubLogoUrl ? (
                      <div className="relative w-full h-full flex flex-col items-center justify-center">
                        {/* eslint-disable-next-next/no-img-element */}
                        <img
                          src={clubLogoUrl}
                          alt="Club Logo"
                          className="max-h-20 max-w-20 object-contain drop-shadow-md mb-1"
                        />
                        <button
                          type="button"
                          onClick={() => setClubLogoUrl("")}
                          className="text-[10px] font-sub text-rose-500 hover:underline font-bold"
                        >
                          Remove Logo
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer space-y-1">
                        <svg className="w-8 h-8 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="block font-sub text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase">
                          Drag & Drop Badge
                        </span>
                        <span className="block text-[9px] text-slate-400">or click to browse</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleFileUpload(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block font-sub text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                      Badge Image Direct URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={clubLogoUrl}
                      onChange={(e) => setClubLogoUrl(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                    />
                    {clubLogoUrl && (
                      <div className="flex justify-center pt-1">
                        {/* eslint-disable-next-next/no-img-element */}
                        <img
                          src={clubLogoUrl}
                          alt="Badge Preview"
                          className="h-12 w-12 object-contain"
                          onError={() => setClubLogoUrl("")}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Club Name & Info Inputs */}
              <div className="sm:col-span-2 space-y-3">
                <div>
                  <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 mb-1 font-semibold">
                    Club Name
                  </label>
                  <input
                    type="text"
                    value={clubName}
                    onChange={(e) => setClubName(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                  />
                </div>

                <div>
                  <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 mb-1 font-semibold">
                    Club Overview & Context Note
                  </label>
                  <textarea
                    rows={2}
                    value={clubInfo}
                    onChange={(e) => setClubInfo(e.target.value)}
                    placeholder="Short description of club history, expectations, or current standing..."
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] resize-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 mb-1.5 font-semibold">
              Primary Tactical Philosophy
            </label>
            <select
              value={tacticalPhilosophy}
              onChange={(e) => setTacticalPhilosophy(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] cursor-pointer"
            >
              <option value="Gegenpress Heavy">Gegenpress Heavy</option>
              <option value="Tiki-Taka Possession">Tiki-Taka Possession</option>
              <option value="Direct Counter-Attack">Direct Counter-Attack</option>
              <option value="Low Block & Long Ball">Low Block & Long Ball</option>
              <option value="Wing Play Overload">Wing Play Overload</option>
            </select>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block font-sub text-xs text-slate-700 dark:text-slate-300 font-semibold">
                Preferred Tactical Formations
              </label>
              <span className="text-[11px] font-sub text-[#E11D48] font-semibold">
                {favFormations.length} Selected
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                  {FORMATION_CATEGORY_LABELS["4-at-the-back"]}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FORMATIONS_REGISTRY.filter((f) => f.category === "4-at-the-back").map(
                    (formation) => {
                      const isSelected = favFormations.includes(formation.id);
                      return (
                        <button
                          key={formation.id}
                          type="button"
                          onClick={() => toggleFormation(formation.id)}
                          className={`p-2.5 rounded-xl font-sub text-xs uppercase text-left transition-all cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? "bg-[#E11D48] text-white font-bold border-[#E11D48] shadow-xs"
                              : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <span className="truncate">{formation.name}</span>
                          {isSelected && <span className="text-[10px] text-white">✓</span>}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                  {FORMATION_CATEGORY_LABELS["3-at-the-back"]}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FORMATIONS_REGISTRY.filter((f) => f.category === "3-at-the-back").map(
                    (formation) => {
                      const isSelected = favFormations.includes(formation.id);
                      return (
                        <button
                          key={formation.id}
                          type="button"
                          onClick={() => toggleFormation(formation.id)}
                          className={`p-2.5 rounded-xl font-sub text-xs uppercase text-left transition-all cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? "bg-[#E11D48] text-white font-bold border-[#E11D48] shadow-xs"
                              : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <span className="truncate">{formation.name}</span>
                          {isSelected && <span className="text-[10px] text-white">✓</span>}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                  {FORMATION_CATEGORY_LABELS["5-at-the-back"]}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FORMATIONS_REGISTRY.filter((f) => f.category === "5-at-the-back").map(
                    (formation) => {
                      const isSelected = favFormations.includes(formation.id);
                      return (
                        <button
                          key={formation.id}
                          type="button"
                          onClick={() => toggleFormation(formation.id)}
                          className={`p-2.5 rounded-xl font-sub text-xs uppercase text-left transition-all cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? "bg-[#E11D48] text-white font-bold border-[#E11D48] shadow-xs"
                              : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <span className="truncate">{formation.name}</span>
                          {isSelected && <span className="text-[10px] text-white">✓</span>}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button
              onClick={() => setStep(1)}
              className="w-1/3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-sub text-xs font-bold uppercase py-3.5 rounded-xl transition-all cursor-pointer"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="w-2/3 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase py-3.5 rounded-xl transition-all shadow-md cursor-pointer"
            >
              Set Realism Rules →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: REALISM & FINANCIAL BOUNDS */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-[#E11D48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h2 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Step 3: Transfer & Financial Realism Limits
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {[
              {
                id: "STRICT_REALISM",
                title: "Strict Realism",
                desc: "Strict squad budget limits, restricted release clauses, and enforced wage caps based on club tier.",
              },
              {
                id: "REALISTIC",
                title: "Realistic (Recommended)",
                desc: "Balanced club bounds enforcing logical market values and squad size ceilings.",
              },
              {
                id: "BALANCED",
                title: "Balanced",
                desc: "Standard EA FC Career Mode rules with minor squad intent checks.",
              },
              {
                id: "CASUAL",
                title: "Casual",
                desc: "Unrestricted transfer freedom without financial or squad role penalties.",
              },
            ].map((r) => {
              const isSelected = realismLevel === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() =>
                    setRealismLevel(
                      r.id as "STRICT_REALISM" | "REALISTIC" | "BALANCED" | "CASUAL" | "CHAOS"
                    )
                  }
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-4 ${
                    isSelected
                      ? "border-[#E11D48] bg-rose-50/60 dark:bg-rose-950/30 shadow-md ring-1 ring-[#E11D48]"
                      : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 shrink-0 flex items-center justify-center ${
                      isSelected
                        ? "border-[#E11D48] bg-[#E11D48]"
                        : "border-slate-400 dark:border-slate-600"
                    }`}
                  >
                    {isSelected && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <div>
                    <h4 className="font-heading text-sm text-slate-900 dark:text-slate-100 uppercase">
                      {r.title}
                    </h4>
                    <p className="font-sans text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                      {r.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 mt-8">
            <button
              onClick={() => setStep(2)}
              className="w-1/3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-sub text-xs font-bold uppercase py-3.5 rounded-xl transition-all cursor-pointer"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="w-2/3 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase py-3.5 rounded-xl transition-all shadow-md cursor-pointer"
            >
              Define Objectives →
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: OBJECTIVES TRIFECTA */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-[#E11D48]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h2 className="font-heading text-base text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Step 4: Your Objectives
            </h2>
          </div>

          {/* 1. Tactical Vision */}
          <div className="space-y-2">
            <label className="block font-sub text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              1. Tactical Vision (Manager Focus)
            </label>
            <div className="grid grid-cols-1 gap-2">
              {tacticalVisionPresets.map((preset) => {
                const isSelected = !isCustomVision && managerObjective === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setIsCustomVision(false);
                      setManagerObjective(preset);
                    }}
                    className={`p-3 rounded-xl font-sub text-xs text-left transition-all cursor-pointer border flex items-center justify-between ${
                      isSelected
                        ? "border-[#E11D48] bg-[#E11D48]/10 text-slate-900 dark:text-slate-100 font-bold shadow-xs"
                        : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <span>{preset}</span>
                    {isSelected && <span className="text-[#E11D48] font-bold">✓</span>}
                  </button>
                );
              })}
            </div>

            {isCustomVision ? (
              <input
                type="text"
                placeholder="Enter custom tactical vision..."
                value={managerObjective}
                onChange={(e) => setManagerObjective(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-[#E11D48] rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsCustomVision(true);
                  setManagerObjective("");
                }}
                className="text-[11px] font-sub text-slate-500 hover:text-[#E11D48] underline cursor-pointer"
              >
                + Specify custom vision
              </button>
            )}
          </div>

          {/* 2. Board Mandate */}
          <div className="space-y-2">
            <label className="block font-sub text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              2. Board Mandate (Club Requirement)
            </label>
            <div className="grid grid-cols-1 gap-2">
              {boardMandatePresets.map((preset) => {
                const isSelected = !isCustomBoard && boardObjective === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setIsCustomBoard(false);
                      setBoardObjective(preset);
                    }}
                    className={`p-3 rounded-xl font-sub text-xs text-left transition-all cursor-pointer border flex items-center justify-between ${
                      isSelected
                        ? "border-[#E11D48] bg-[#E11D48]/10 text-slate-900 dark:text-slate-100 font-bold shadow-xs"
                        : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <span>{preset}</span>
                    {isSelected && <span className="text-[#E11D48] font-bold">✓</span>}
                  </button>
                );
              })}
            </div>

            {isCustomBoard ? (
              <input
                type="text"
                placeholder="Enter custom board requirement..."
                value={boardObjective}
                onChange={(e) => setBoardObjective(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-[#E11D48] rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsCustomBoard(true);
                  setBoardObjective("");
                }}
                className="text-[11px] font-sub text-slate-500 hover:text-[#E11D48] underline cursor-pointer"
              >
                + Specify custom mandate
              </button>
            )}
          </div>

          {/* 3. Personal Legacy */}
          <div className="space-y-2">
            <label className="block font-sub text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              3. Personal Legacy Goal
            </label>
            <div className="grid grid-cols-1 gap-2">
              {personalLegacyPresets.map((preset) => {
                const isSelected = !isCustomPersonal && personalObjective === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setIsCustomPersonal(false);
                      setPersonalObjective(preset);
                    }}
                    className={`p-3 rounded-xl font-sub text-xs text-left transition-all cursor-pointer border flex items-center justify-between ${
                      isSelected
                        ? "border-[#E11D48] bg-[#E11D48]/10 text-slate-900 dark:text-slate-100 font-bold shadow-xs"
                        : "bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <span>{preset}</span>
                    {isSelected && <span className="text-[#E11D48] font-bold">✓</span>}
                  </button>
                );
              })}
            </div>

            {isCustomPersonal ? (
              <input
                type="text"
                placeholder="Enter custom legacy goal..."
                value={personalObjective}
                onChange={(e) => setPersonalObjective(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-[#E11D48] rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsCustomPersonal(true);
                  setPersonalObjective("");
                }}
                className="text-[11px] font-sub text-slate-500 hover:text-[#E11D48] underline cursor-pointer"
              >
                + Specify custom legacy
              </button>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setStep(3)}
              className="w-1/3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-sub text-xs font-bold uppercase py-3.5 rounded-xl transition-all cursor-pointer"
            >
              ← Back
            </button>
            <button
              onClick={() => {
                if (selectedSave) {
                  onCompleteOnboarding({
                    selectedSave,
                    managerName,
                    nationality,
                    clubName,
                    clubLogoUrl,
                    clubInfo,
                    tacticalPhilosophy,
                    realismLevel,
                    favFormations,
                    managerObjective,
                    boardObjective,
                    personalObjective,
                  });
                }
              }}
              className="w-2/3 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase py-3.5 rounded-xl transition-all shadow-lg cursor-pointer"
            >
              Initialize Career Hub →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}