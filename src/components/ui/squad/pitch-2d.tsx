"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  FORMATIONS_REGISTRY,
  getFormationById,
  PitchPositionSlot,
} from "@/lib/tactics/formations";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { PitchSlotAssignment } from "@/lib/services/tactics-service";

interface Pitch2DProps {
  squad: EnrichedPlayer[];
  currentFormationId: string;
  initialSlots: PitchSlotAssignment[];
  onSaveTactics: (formationId: string, slots: PitchSlotAssignment[]) => void;
}

export function Pitch2D({
  squad,
  currentFormationId,
  initialSlots,
  onSaveTactics,
}: Pitch2DProps) {
  const [selectedFormationId, setSelectedFormationId] =
    useState(currentFormationId);
  const [slots, setSlots] = useState<PitchSlotAssignment[]>(initialSlots);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(
    null
  );

  const formationDef = getFormationById(selectedFormationId);

  // Handle formation change and remap existing players to closest tactical slot
  const handleFormationSelect = (newFormationId: string) => {
    const newDef = getFormationById(newFormationId);
    setSelectedFormationId(newFormationId);

    const remappedSlots: PitchSlotAssignment[] = newDef.slots.map((s) => {
      const existingSlot = slots.find((oldS) => oldS.slotIndex === s.slotIndex);
      return {
        slotIndex: s.slotIndex,
        role: s.role,
        label: s.label,
        playerId: existingSlot?.playerId || null,
        eaPlayerId: existingSlot?.eaPlayerId || null,
        playerName: existingSlot?.playerName || null,
        overallRating: existingSlot?.overallRating || null,
      };
    });

    setSlots(remappedSlots);
    onSaveTactics(newFormationId, remappedSlots);
  };

  // Assign player to active selected pitch slot
  const assignPlayerToSlot = (player: EnrichedPlayer, slotIndex: number) => {
    const updated = slots.map((s) => {
      if (s.slotIndex === slotIndex) {
        return {
          ...s,
          playerId: player.id,
          eaPlayerId: player.eaPlayerId,
          playerName: player.name,
          overallRating: player.overallRating,
        };
      }
      // If player was in another slot, clear old slot
      if (s.playerId === player.id) {
        return {
          ...s,
          playerId: null,
          eaPlayerId: null,
          playerName: null,
          overallRating: null,
        };
      }
      return s;
    });

    setSlots(updated);
    setSelectedSlotIndex(null);
    onSaveTactics(selectedFormationId, updated);
  };

  const assignedPlayerIds = new Set(
    slots.map((s) => s.playerId).filter(Boolean)
  );
  const benchPlayers = squad.filter((p) => !assignedPlayerIds.has(p.id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* 2D Pitch Container */}
      <div className="lg:col-span-8 bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 backdrop-blur-md relative overflow-hidden transition-colors">
        {/* Formation Picker Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <span className="font-sub text-xs uppercase text-slate-500 dark:text-slate-400 block tracking-wider">
              Active Tactical Shape
            </span>
            <h3 className="font-heading text-lg text-amber-600 dark:text-amber-400">
              {formationDef.name}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedFormationId}
              onChange={(e) => handleFormationSelect(e.target.value)}
              className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-200 text-sm font-sub px-3 py-1.5 rounded-lg focus:outline-none focus:border-[#E11D48]"
            >
              <optgroup label="4-at-the-back">
                {FORMATIONS_REGISTRY.filter(
                  (f) => f.category === "4-at-the-back"
                ).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="5-at-the-back">
                {FORMATIONS_REGISTRY.filter(
                  (f) => f.category === "5-at-the-back"
                ).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="3-at-the-back">
                {FORMATIONS_REGISTRY.filter(
                  (f) => f.category === "3-at-the-back"
                ).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* Pitch Graphic Wrapper using pitch2d.jpeg */}
        <div className="relative w-full aspect-[3/4] max-h-[680px] rounded-lg overflow-hidden border border-slate-700/60 shadow-2xl">
          <Image
            src="/2dpitch.jpg"
            alt="Tactical Pitch"
            fill
            sizes="(min-width: 1024px) 66vw, 100vw"
            className="object-cover opacity-85"
            loading="eager"
          />

          {/* Overlay Grid Vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/60 pointer-events-none" />

          {/* Render 11 Formation Slot Cards */}
          {formationDef.slots.map((slotDef) => {
            const currentSlotData = slots.find(
              (s) => s.slotIndex === slotDef.slotIndex
            );
            const isSelected = selectedSlotIndex === slotDef.slotIndex;

            return (
              <div
                key={slotDef.slotIndex}
                style={{
                  top: `${slotDef.top}%`,
                  left: `${slotDef.left}%`,
                  transform: "translate(-50%, -50%)",
                }}
                onClick={() => setSelectedSlotIndex(slotDef.slotIndex)}
                className={`absolute cursor-pointer transition-[left,top,transform] duration-300 z-10 ${
                  isSelected ? "scale-110 z-30" : "hover:scale-105"
                }`}
              >
                <div
                  className={`w-20 sm:w-24 bg-slate-950/90 border rounded-lg p-1.5 backdrop-blur-md shadow-xl text-center ${
                    isSelected
                      ? "border-amber-400 ring-2 ring-amber-400/40"
                      : currentSlotData?.playerName
                      ? "border-slate-600 hover:border-slate-400"
                      : "border-dashed border-amber-500/60 bg-amber-950/20"
                  }`}
                >
                  <div className="flex items-center justify-between px-1 mb-0.5">
                    <span className="text-[10px] font-sub font-bold text-amber-400 uppercase">
                      {slotDef.label}
                    </span>
                    {currentSlotData?.overallRating && (
                      <span className="text-[11px] font-heading font-bold text-emerald-400">
                        {currentSlotData.overallRating}
                      </span>
                    )}
                  </div>

                  <div className="text-xs font-bold text-slate-100 truncate px-0.5">
                    {currentSlotData?.playerName || (
                      <span className="text-slate-500 italic font-normal text-[10px]">
                        Select Player
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Squad Reserves / Quick Slot Assigner */}
      <div className="lg:col-span-4 bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 backdrop-blur-md transition-colors">
        <div className="mb-3">
          <h4 className="font-heading text-sm text-slate-900 dark:text-slate-200 uppercase tracking-wider">
            {selectedSlotIndex !== null
              ? `Assigning to Position #${selectedSlotIndex + 1}`
              : "Squad Bench & Reserves"}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
            {selectedSlotIndex !== null
              ? "Click a player below to place them into the selected position."
              : "Click a pitch card on the left to assign or swap a player."}
          </p>
        </div>

        {benchPlayers.length === 0 && (
          <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
            {squad.length === 0
              ? "No squad synced yet — run the manager appointment protocol in the Portal."
              : "Every squad member is already on the pitch."}
          </p>
        )}

        <div className="space-y-1.5 max-h-[580px] overflow-y-auto pr-1">
          {benchPlayers.map((player) => (
            <div
              key={player.id}
              onClick={() => {
                if (selectedSlotIndex !== null) {
                  assignPlayerToSlot(player, selectedSlotIndex);
                }
              }}
              className={`p-2.5 rounded-lg border bg-slate-50 dark:bg-slate-950/60 transition-colors flex items-center justify-between cursor-pointer ${
                selectedSlotIndex !== null
                  ? "hover:border-amber-500 dark:hover:border-amber-400 hover:bg-slate-100 dark:hover:bg-slate-900"
                  : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-heading text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                    {player.overallRating}
                  </span>
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    {player.name}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sub flex items-center gap-2 mt-0.5">
                  <span>POT: {player.potentialRating}</span>
                  {player.userProfile?.assignedRole && (
                    <span className="text-amber-700 dark:text-amber-400">
                      • {player.userProfile.assignedRole}
                    </span>
                  )}
                </div>
              </div>

              {player.userProfile?.importanceMarker === "UNTOUCHABLE" && (
                <span className="text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-400 font-sub px-1.5 py-0.5 rounded uppercase">
                  Untouchable
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}