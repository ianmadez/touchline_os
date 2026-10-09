"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { FORMATIONS_REGISTRY, getFormationById } from "@/lib/tactics/formations";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import { PitchSlotAssignment, TacticalSystemState } from "@/lib/services/tactics-service";

type BenchSort = "POSITION" | "OVERALL" | "POTENTIAL" | "AGE" | "NAME";

const BENCH_SORT_LABELS: ReadonlyArray<{ id: BenchSort; label: string }> = [
  { id: "POSITION", label: "Position" },
  { id: "OVERALL", label: "Rating" },
  { id: "POTENTIAL", label: "Potential" },
  { id: "AGE", label: "Age" },
  { id: "NAME", label: "Name" },
];

/**
 * GK -> defence -> midfield -> attack, so "sort by position" reads the way a team sheet does.
 *
 * Grouped rather than alphabetical on purpose: alphabetical would put CB between CAM and CDM, which
 * is exactly the order a manager does not want when he is looking for a defender.
 */
function positionRank(role: string | null | undefined): number {
  if (!role) return 4;
  if (role === "GK") return 0;
  if (["LB", "CB", "RB", "LWB", "RWB", "SW"].includes(role)) return 1;
  if (["CDM", "CM", "LM", "RM", "CAM"].includes(role)) return 2;
  if (["LW", "RW", "CF", "ST"].includes(role)) return 3;
  return 4;
}

interface Pitch2DProps {
  squad: EnrichedPlayer[];
  /** Every formation the manager has saved. They may keep as many as they like. */
  formations: TacticalSystemState[];
  activeFormationLabel: string;
  onSelectFormation: (label: string) => void;
  onSaveTactics: (label: string, formationId: string, slots: PitchSlotAssignment[]) => void;
  onFormationAction: (
    action: "CREATE" | "RENAME" | "DELETE" | "SET_DEFAULT",
    label: string,
    extra?: { nextLabel?: string; formationId?: string }
  ) => void;
}

export function Pitch2D({
  squad,
  formations,
  activeFormationLabel,
  onSelectFormation,
  onSaveTactics,
  onFormationAction,
}: Pitch2DProps) {
  // The parent keys this component by the active label, so switching tabs remounts it and the slot
  // state below re-seeds from THAT formation's own saved slots - the two can never bleed together.
  const activeFormation =
    formations.find((formation) => formation.label === activeFormationLabel) ?? formations[0];
  // Falls back to the label the parent passed, so an empty list can never crash the pitch.
  const activeLabel = activeFormation?.label ?? activeFormationLabel;

  const [selectedFormationId, setSelectedFormationId] = useState(
    activeFormation?.formationName ?? "4-3-3-holding"
  );
  const [slots, setSlots] = useState<PitchSlotAssignment[]>(activeFormation?.slots ?? []);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

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
    onSaveTactics(activeLabel, newFormationId, remappedSlots);
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
    onSaveTactics(activeLabel, selectedFormationId, updated);
  };

  // Memoised so the set keeps its identity between renders; a fresh Set every render would defeat
  // the bench memo below and re-sort the whole list on every keystroke elsewhere on the page.
  const assignedPlayerIds = useMemo(
    () => new Set(slots.map((s) => s.playerId).filter(Boolean)),
    [slots]
  );

  const [benchSort, setBenchSort] = useState<BenchSort>("POSITION");
  const [benchDirection, setBenchDirection] = useState<"ASC" | "DESC">("ASC");

  // Sorting the bench is what makes assigning to a shape quick: with 20-odd players, the eye wants
  // a predictable order, and the shape wants a position group. Unknowns always sort last in BOTH
  // directions - a missing value is not the smallest one, and floating it to the top on an
  // ascending sort would bury the players the manager is actually looking for.
  const sortedBench = useMemo(() => {
    const players = squad.filter((p) => !assignedPlayerIds.has(p.id));    const dir = benchDirection === "ASC" ? 1 : -1;

    const value = (player: EnrichedPlayer): number | string | null => {
      switch (benchSort) {
        case "POSITION":
          return positionRank(player.primaryPosition);
        case "POTENTIAL":
          return player.potentialRating;
        case "AGE":
          return player.age;
        case "NAME":
          return player.name.toLowerCase();
        default:
          return player.overallRating;
      }
    };

    return [...players].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const leftMissing = left === null || left === undefined;
      const rightMissing = right === null || right === undefined;
      if (leftMissing && rightMissing) return a.name.localeCompare(b.name);
      if (leftMissing) return 1;
      if (rightMissing) return -1;

      const comparison =
        typeof left === "string" || typeof right === "string"
          ? String(left).localeCompare(String(right))
          : Number(left) - Number(right);
      if (comparison !== 0) return comparison * dir;
      // Position ties break by rating, so a sorted bench still reads strongest-first within a group.
      return (b.overallRating ?? 0) - (a.overallRating ?? 0);
    });
  }, [squad, assignedPlayerIds, benchSort, benchDirection]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* 2D Pitch Container */}
      <div className="lg:col-span-8 bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 backdrop-blur-md relative overflow-hidden transition-colors">
        {/* Formation Library - the manager may keep any number of saved formations. */}
        <div data-tour="tactics-formations" className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          {formations.map((formation) => {
            const isActive = formation.label === activeLabel;
            return (
              <button
                key={formation.label}
                type="button"
                onClick={() => onSelectFormation(formation.label)}
                title={formation.isDefault ? "Current XI" : `Switch to ${formation.label}`}
                className={`min-h-10 px-3 rounded-lg text-xs font-sub font-semibold border transition-colors cursor-pointer ${
                  isActive
                    ? "border-[#E11D48] bg-[#E11D48]/10 text-[#E11D48] dark:text-[#FF8C7A]"
                    : "border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                {formation.label}
                {formation.isDefault && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wide opacity-70">XI</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              onFormationAction("CREATE", activeLabel, { formationId: selectedFormationId })
            }
            title="Add another formation, starting from the shape shown below"
            className="min-h-10 px-3 rounded-lg text-xs font-sub font-semibold border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors cursor-pointer"
          >
            + New formation
          </button>
        </div>

        {/* Actions for the formation currently being viewed. */}
        <div className="flex flex-wrap items-center gap-1 mb-4">
          {renaming ? (
            <>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New formation name"
                className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-200 text-xs font-sub px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-[#E11D48]"
              />
              <button
                type="button"
                onClick={() => {
                  onFormationAction("RENAME", activeLabel, { nextLabel: renameValue });
                  setRenaming(false);
                }}
                className="min-h-10 px-3 rounded-lg text-xs font-sub font-semibold text-[#E11D48] dark:text-[#FF8C7A] hover:underline cursor-pointer"
              >
                Save name
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="min-h-10 px-3 rounded-lg text-xs font-sub font-semibold text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRenameValue(activeLabel);
                setRenaming(true);
              }}
              title="Rename this formation"
              className="min-h-10 px-2 text-xs font-sub font-semibold text-slate-500 dark:text-slate-400 hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors cursor-pointer"
            >
              Rename
            </button>
          )}
          {!activeFormation?.isDefault && (
            <button
              type="button"
              onClick={() => onFormationAction("SET_DEFAULT", activeLabel)}
              title="Make this the XI the rest of the app reads"
              className="min-h-10 px-2 text-xs font-sub font-semibold text-slate-500 dark:text-slate-400 hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors cursor-pointer"
            >
              Make current XI
            </button>
          )}
          {formations.length > 1 && (
            <button
              type="button"
              onClick={() => onFormationAction("DELETE", activeLabel)}
              title="Delete this formation"
              className="min-h-10 px-2 text-xs font-sub font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
            >
              Delete
            </button>
          )}
        </div>

        {/* Shape picker, scoped to the formation being viewed. */}
        <div data-tour="tactics-shape" className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
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
            className="object-fill opacity-85"
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
      <div data-tour="tactics-bench" className="lg:col-span-4 bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 backdrop-blur-md transition-colors">
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

        {sortedBench.length === 0 && (
          <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
            {squad.length === 0
              ? "No squad synced yet — run the manager appointment protocol in the Portal."
              : "Every squad member is already on the pitch."}
          </p>
        )}

        {sortedBench.length > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2.5 dark:border-slate-800">
            <select
              value={benchSort}
              onChange={(event) => setBenchSort(event.target.value as BenchSort)}
              aria-label="Sort the bench by"
              className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {BENCH_SORT_LABELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setBenchDirection((current) => (current === "ASC" ? "DESC" : "ASC"))}
              aria-label={`Sorting ${benchDirection === "ASC" ? "ascending" : "descending"}. Reverse it.`}
              title={benchDirection === "ASC" ? "Ascending - click for descending" : "Descending - click for ascending"}
              className="flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
            >
              {benchDirection === "ASC" ? "Asc" : "Desc"}
              <span aria-hidden className="text-slate-400">
                {benchDirection === "ASC" ? "\u2191" : "\u2193"}
              </span>
            </button>
            <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
              {sortedBench.length} available
            </span>
          </div>
        )}

        <div className="space-y-1.5 max-h-[580px] overflow-y-auto pr-1">
          {sortedBench.map((player) => (
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