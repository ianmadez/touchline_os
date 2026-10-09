"use client";

import React, { useState } from "react";
import type { SeasonState } from "@/lib/services/season-service";
import { statusLabel } from "@/lib/ui/labels";

import { apiFetch } from "@/lib/platform/api-client";
interface SeasonPanelProps {
  careerId: string;
  seasonState: SeasonState;
  onSeasonChange: (next: SeasonState) => void;
}

/**
 * The season so far, the board objective, and where the manager says they are.
 *
 * Provenance is shown rather than implied: the record comes from the save, and the league position
 * is the manager's own entry because the save keeps no live table for our division. Where the entry
 * disagrees with the save's own record, both are shown - the disagreement is the useful part.
 *
 * The record's numbers are labelled for what they verifiably are. `career_managerhistory` keeps one
 * W/D/L/points/goals set per season and it spans every competition, so every figure in the tiles
 * below is an all-competition total - never league form. There is deliberately no projected-points
 * figure any more: it would divide an all-competition rate into league games remaining, and the
 * save's `gamesPlayed` is not a league count either.
 */
export function SeasonPanel({ careerId, seasonState, onSeasonChange }: SeasonPanelProps) {
  const outlook = seasonState.outlook;
  const { user: userObjective, save: saveObjective } = seasonState.objectivePair;
  const { inference, reconciliation, recordedPositions } = seasonState.table;

  const [draftPosition, setDraftPosition] = useState("");
  const [draftObjective, setDraftObjective] = useState(userObjective?.text ?? "");
  const [targetPosition, setTargetPosition] = useState(
    userObjective?.targetPosition !== null && userObjective?.targetPosition !== undefined
      ? String(userObjective.targetPosition)
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState<string | null>(null);

  if (!outlook) {
    return (
      <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          Season
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 italic mt-2">
          No season history yet. Sync your save to load it.
        </p>
      </div>
    );
  }

  const perGame =
    outlook.allCompetitionPointsPerGame === null
      ? "—"
      : outlook.allCompetitionPointsPerGame.toFixed(2);

  const submit = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage(data.error || "Could not save that.");
        return;
      }
      if (data.seasonState) onSeasonChange(data.seasonState as SeasonState);
      setDisputeNote(data.disputed ? (data.note ?? null) : null);
      setMessage("Saved.");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span>{outlook.seasonLabel}</span>
          <span className="text-[10px] font-sub font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            From your save
          </span>
        </h2>
        <span className="text-xs font-sub text-slate-400">Tracked from your save</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Played · all comps", value: String(outlook.gamesPlayed) },
          { label: "Points · save's total", value: String(outlook.points) },
          { label: "Points per match", value: perGame },
          {
            label: "Goal diff · all comps",
            value: `${outlook.goalDifference > 0 ? "+" : ""}${outlook.goalDifference}`,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80"
          >
            <span className="block text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
              {stat.label}
            </span>
            <span className="block font-heading text-lg text-slate-900 dark:text-slate-100 tabular-nums">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* Why there is no projection, and what the record above actually covers. Said once here
          rather than left as a gap to guess at, and deliberately competition-agnostic: the app runs
          against saves from any country, so no league or cup is ever named in this copy. */}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        One combined record per season, across every competition. Not every competition awards
        points, so the points figure is the save&apos;s season total. Nothing is projected from it.
      </p>

      {/* Two objective tracks, side by side and never merged. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800/60">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-1">
          <span className="block text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
            Your objective
          </span>
          <p className="text-sm text-slate-800 dark:text-slate-200">
            {userObjective?.text || "Nothing set yet."}
          </p>
          {userObjective?.targetPosition ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Target: {userObjective.targetPosition} or better ·{" "}
              {statusLabel(userObjective.status)}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              No target finish, so this one cannot pass or fail on its own.
            </p>
          )}
          {userObjective?.outcome && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300">{userObjective.outcome}</p>
          )}
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-1">
          <span className="block text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
            The board&apos;s, from the save
          </span>
          {saveObjective ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              The save lists a board objective, but its code is unreadable. Left blank rather than
              guessed.
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              The save records no objective for this season.
            </p>
          )}
        </div>
      </div>

      {/* Where the club stands. Inferred, never read - and the manager's confirmation is what
          calibrates the inference, so the input corrects the model rather than replacing it. */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800/60 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-1">
            <span className="block text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
              Where you stand
            </span>
            {inference.low !== null && inference.high !== null ? (
              <>
                <p className="font-heading text-lg text-slate-900 dark:text-slate-100 tabular-nums">
                  {inference.low === inference.high
                    ? `${inference.low}${inference.low === 1 ? "st" : "th"}`
                    : `${inference.low}–${inference.high}`}
                  <span
                    className={`ml-2 align-middle text-[10px] font-sub font-bold px-1.5 py-0.5 rounded border ${
                      inference.basis === "ppm-model"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                        : "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30"
                    }`}
                  >
                    {inference.basis === "ppm-model" ? "Inferred" : "Save's field, uncalibrated"}
                  </span>
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">{inference.explanation}</p>
                {inference.caveat && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">{inference.caveat}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                {inference.explanation}
              </p>
            )}
            {inference.saveHint !== null && inference.basis === "ppm-model" && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Save&apos;s field: {inference.saveHint}
                {inference.saveProjectedBest !== null
                  ? ` · Best plausible finish: ${inference.saveProjectedBest}`
                  : ""}
              </p>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-1">
            <span className="block text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
              Your debriefs
            </span>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {reconciliation.fromDebriefs.logged > 0
                ? `${reconciliation.fromDebriefs.wins}W ${reconciliation.fromDebriefs.draws}D ${reconciliation.fromDebriefs.losses}L from ${reconciliation.fromDebriefs.logged} logged`
                : "Nothing logged yet."}
              <span className="text-slate-400"> · </span>
              <span className="text-slate-600 dark:text-slate-400">
                save says {reconciliation.fromSave.wins}W {reconciliation.fromSave.draws}D{" "}
                {reconciliation.fromSave.losses}L
              </span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{reconciliation.note}</p>
          </div>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1">
            <span
              className="text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400"
              title="No live league table in the save. Your entry calibrates the estimate above."
            >
              {inference.low !== null ? "Correct it if that's wrong" : "Tell it where you are"}
            </span>
            <input
              type="number"
              min={1}
              max={200}
              value={draftPosition}
              onChange={(e) => setDraftPosition(e.target.value)}
              placeholder={inference.saveHint ? String(inference.saveHint) : "e.g. 7"}
              title="The position you see in-game."
              className="w-28 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 tabular-nums"
            />
          </label>
          <button
            onClick={() => {
              const value = Number(draftPosition);
              if (!Number.isInteger(value) || value < 1) {
                setMessage("Enter a whole number for your position.");
                return;
              }
              void submit({ leaguePosition: value });
            }}
            disabled={saving || draftPosition === ""}
            title="Saves your position and narrows the estimate."
            className="px-4 py-2.5 min-h-10 bg-[#E11D48] hover:bg-[#FF8C7A] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-sub font-bold uppercase tracking-wider rounded-xl transition-[background-color,transform] duration-200 active:scale-[0.96] shadow-md cursor-pointer"
          >
            {saving ? "Saving…" : "Confirm Position"}
          </button>
          {recordedPositions > 0 && (
            <span className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
              {recordedPositions} calibration reading{recordedPositions === 1 ? "" : "s"} so far
              {recordedPositions < 3 ? " — 3 needed before it infers on its own" : ""}
            </span>
          )}
        </div>

        {disputeNote && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            That does not match the save&apos;s own record. {disputeNote}
          </p>
        )}
        {!disputeNote && outlook.loggedPositionDisputed && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
            Your logged position does not match the save&apos;s own record.
          </p>
        )}

        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1 flex-1 min-w-52">
            <span className="text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400">
              Your objective
            </span>
            <input
              type="text"
              value={draftObjective}
              onChange={(e) => setDraftObjective(e.target.value)}
              placeholder="e.g. Promotion push"
              title="What the board has asked of you this season, in your own words."
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span
              className="text-[10px] font-sub uppercase font-bold text-slate-500 dark:text-slate-400"
              title="Optional. The finishing position this objective demands. Without it the objective is recorded but never marked as passed or failed."
            >
              Target finish
            </span>
            <input
              type="number"
              min={1}
              max={200}
              value={targetPosition}
              onChange={(e) => setTargetPosition(e.target.value)}
              placeholder="e.g. 6"
              title="Optional. Set it and this objective is judged automatically when the season ends."
              className="w-28 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 tabular-nums"
            />
          </label>
          <button
            onClick={() =>
              void submit({
                objectiveText: draftObjective,
                targetPosition: targetPosition === "" ? null : Number(targetPosition),
              })
            }
            disabled={saving || !draftObjective.trim()}
            title="Saves this objective for the current season."
            className="px-4 py-2.5 min-h-10 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 text-xs font-sub font-bold uppercase tracking-wider rounded-xl transition-[background-color,transform] duration-200 active:scale-[0.96] cursor-pointer"
          >
            Save Objective
          </button>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          A target finish is marked met or missed at season end. Without one it is only recorded.
        </p>

        {message && <p className="text-xs text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
    </div>
  );
}
