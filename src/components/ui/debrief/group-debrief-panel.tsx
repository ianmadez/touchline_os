"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BlockSummary,
  MatchPoints,
  TargetBlock,
} from "@/lib/services/target-block-service";
import type { LeagueTeamSummary } from "@/lib/services/career-service";
import {
  IconAlert,
  IconCalendar,
  IconFlag,
  IconNote,
  IconPlus,
  IconSpark,
  IconTarget,
  IconTrash,
  IconUserEntry,
  IconWhistle,
} from "@/components/ui/icons";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * Group Debrief.
 *
 * A block of five matches, set up as a plan and then reported back on. It exists because logging
 * every match individually is a chore nobody keeps up with, and because the interesting unit of a
 * season is a run of games rather than a single 90 minutes.
 *
 * Every value here is USER provenance. That is not a shortcut - the save zeroes its own points
 * columns for our division, so a block cannot be derived from it without inventing a binding. The
 * manager writes the plan and the result, and TouchlineOS does the arithmetic that follows from them.
 */
interface BlockRow {
  block: TargetBlock;
  summary: BlockSummary;
}

/** Preset asks, phrased the way a manager writes them. Two selects would allow 3-1; this cannot. */
const TARGET_PRESETS: ReadonlyArray<{ key: string; label: string; min: MatchPoints; max: MatchPoints }> = [
  { key: "3-3", label: "3 pts", min: 3, max: 3 },
  { key: "1-3", label: "1-3 pts", min: 1, max: 3 },
  { key: "1-1", label: "1 pt", min: 1, max: 1 },
  { key: "0-1", label: "0-1 pts", min: 0, max: 1 },
  { key: "0-0", label: "0 pts", min: 0, max: 0 },
];

const VERDICT_STYLES: Record<BlockSummary["verdict"], string> = {
  DREAM: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  ON_TARGET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  IN_PROGRESS: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  BELOW_TARGET: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  CONCERN: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

const VERDICT_LABELS: Record<BlockSummary["verdict"], string> = {
  DREAM: "Dream block",
  ON_TARGET: "On target",
  IN_PROGRESS: "In progress",
  BELOW_TARGET: "Below target",
  CONCERN: "Concern",
};

const MATCHES_PER_BLOCK = 5;

interface MatchDraft {
  opponent: string;
  /**
   * True once the manager picks "Another club" and is typing a name. Without it an empty box would
   * be indistinguishable from "has not chosen yet", and the picker could not stay open.
   */
  opponentOther?: boolean;
  opponentPosition: string;
  /** Which preset ask the manager set for this match. */
  target: string;
  ourGoals: string;
  theirGoals: string;
  note: string;
}

interface BlockDraft {
  id: string | null;
  seasonNumber: string;
  blockIndex: number;
  matches: MatchDraft[];
  targetMin: string;
  targetMax: string;
  dreamPoints: string;
  concernPoints: string;
  gamesPlayedBefore: string;
  pointsBefore: string;
  positionBefore: string;
  goalDifferenceBefore: string;
  tablePosition: string;
  notes: string;
}

function emptyMatch(): MatchDraft {
  return {
    opponent: "",
    opponentOther: false,
    opponentPosition: "",
    target: "3-3",
    ourGoals: "",
    theirGoals: "",
    note: "",
  };
}

function newDraft(seasonNumber: number | null, blockIndex: number): BlockDraft {
  return {
    id: null,
    seasonNumber: seasonNumber === null ? "" : String(seasonNumber),
    blockIndex,
    matches: Array.from({ length: MATCHES_PER_BLOCK }, () => emptyMatch()),
    targetMin: "8",
    targetMax: "10",
    dreamPoints: "12",
    concernPoints: "6",
    gamesPlayedBefore: "",
    pointsBefore: "",
    positionBefore: "",
    goalDifferenceBefore: "",
    tablePosition: "",
    notes: "",
  };
}

function draftFromBlock(block: TargetBlock): BlockDraft {
  return {
    id: block.id,
    seasonNumber: String(block.seasonNumber),
    blockIndex: block.blockIndex,
    matches: Array.from({ length: MATCHES_PER_BLOCK }, (_, index) => {
      const match = block.matches[index] ?? emptyMatch();
      return {
        opponent: match.opponent ?? "",
        // A loaded block cannot know the league list, so "other" is decided at render time from
        // whether the stored name is one of the clubs on offer.
        opponentOther: false,
        opponentPosition: match.opponentPosition === null ? "" : String(match.opponentPosition),
        target: `${match.targetPoints}-${match.targetMaxPoints}`,
        ourGoals: match.goalsFor === null ? "" : String(match.goalsFor),
        theirGoals: match.goalsAgainst === null ? "" : String(match.goalsAgainst),
        note: match.note ?? "",
      };
    }),
    targetMin: String(block.targetMin),
    targetMax: String(block.targetMax),
    dreamPoints: String(block.dreamPoints),
    concernPoints: String(block.concernPoints),
    gamesPlayedBefore: block.gamesPlayedBefore === null ? "" : String(block.gamesPlayedBefore),
    pointsBefore: block.pointsBefore === null ? "" : String(block.pointsBefore),
    positionBefore: block.positionBefore === null ? "" : String(block.positionBefore),
    goalDifferenceBefore:
      block.goalDifferenceBefore === null ? "" : String(block.goalDifferenceBefore),
    tablePosition: block.tablePosition === null ? "" : String(block.tablePosition),
    notes: block.notes ?? "",
  };
}

/**
 * The outcome is read off the scoreline rather than asked for separately.
 *
 * Two boxes labelled "us" and "them" remove any chance of writing a losing score the right way
 * round but recording it as a win - the failure mode that a bare "3-2 loss" note invites.
 */
function outcomeOf(ourGoals: string, theirGoals: string): "WIN" | "DRAW" | "LOSS" | null {
  if (ourGoals.trim() === "" || theirGoals.trim() === "") return null;
  const ours = Number(ourGoals);
  const theirs = Number(theirGoals);
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return null;
  if (ours > theirs) return "WIN";
  return ours === theirs ? "DRAW" : "LOSS";
}

function pointsFor(outcome: "WIN" | "DRAW" | "LOSS" | null): MatchPoints | null {
  if (outcome === "WIN") return 3;
  if (outcome === "DRAW") return 1;
  if (outcome === "LOSS") return 0;
  return null;
}

function presetFor(key: string) {
  return TARGET_PRESETS.find((preset) => preset.key === key) ?? TARGET_PRESETS[0];
}

function presetLabel(min: MatchPoints, max: MatchPoints): string {
  const match = TARGET_PRESETS.find((preset) => preset.min === min && preset.max === max);
  return match ? match.label : `${min}-${max} pts`;
}

function optionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function GroupDebriefPanel({
  careerId,
  seasonNumber,
  leagueTeams,
}: {
  careerId: string;
  seasonNumber: number | null;
  /** The clubs in the manager's own division, so an opponent is picked rather than typed. */
  leagueTeams?: LeagueTeamSummary[];
}) {
  const [rows, setRows] = useState<BlockRow[]>([]);
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!careerId) return;
    try {
      const response = await apiFetch(`/api/season/blocks?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        blocks?: BlockRow[];
        error?: string;
      };
      if (payload.success) {
        setRows(payload.blocks ?? []);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read your group debriefs.");
      }
    } catch {
      setError("Could not reach the group debrief service.");
    } finally {
      setLoading(false);
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const nextBlockIndex = useMemo(
    () => rows.reduce((highest, row) => Math.max(highest, row.block.blockIndex), 0) + 1,
    [rows]
  );

  const patchMatch = (index: number, patch: Partial<MatchDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      const matches = current.matches.map((match, position) =>
        position === index ? { ...match, ...patch } : match
      );
      return { ...current, matches };
    });
  };

  const save = async () => {
    if (!draft) return;
    const season = optionalNumber(draft.seasonNumber);
    if (season === null) {
      setError("A group debrief needs a season number to belong to.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch("/api/season/blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          seasonNumber: season,
          blockIndex: draft.blockIndex,
          matches: draft.matches.map((match, index) => {
            const outcome = outcomeOf(match.ourGoals, match.theirGoals);
            const preset = presetFor(match.target);
            return {
              matchday: index + 1,
              opponent: match.opponent,
              opponentPosition: optionalNumber(match.opponentPosition),
              targetPoints: preset.min,
              targetMaxPoints: preset.max,
              actualPoints: pointsFor(outcome),
              goalsFor: outcome === null ? null : optionalNumber(match.ourGoals),
              goalsAgainst: outcome === null ? null : optionalNumber(match.theirGoals),
              note: match.note,
            };
          }),
          targetMin: optionalNumber(draft.targetMin),
          targetMax: optionalNumber(draft.targetMax),
          dreamPoints: optionalNumber(draft.dreamPoints),
          concernPoints: optionalNumber(draft.concernPoints),
          gamesPlayedBefore: optionalNumber(draft.gamesPlayedBefore),
          pointsBefore: optionalNumber(draft.pointsBefore),
          positionBefore: optionalNumber(draft.positionBefore),
          goalDifferenceBefore: optionalNumber(draft.goalDifferenceBefore),
          tablePosition: optionalNumber(draft.tablePosition),
          notes: draft.notes,
        }),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!payload.success) {
        setError(payload.error ?? "Could not save the group debrief.");
        return;
      }
      setError(null);
      setDraft(null);
      await load();
    } catch {
      setError("Could not reach the group debrief service.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (block: TargetBlock) => {
    const response = await apiFetch(
      `/api/season/blocks?careerId=${encodeURIComponent(careerId)}&id=${encodeURIComponent(block.id)}`,
      { method: "DELETE" }
    );
    if (response.ok) await load();
  };

  return (
    <div className="space-y-5">
      <div data-tour="group-heading" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            <IconWhistle className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            Group Debrief
          </h2>
          <p className="mt-1 max-w-xl font-sans text-xs text-slate-600 dark:text-slate-400">
            Five matches at a time: the points you wanted from each, and what actually happened.
          </p>
        </div>
        <button
          type="button"
          data-tour="group-new"
          onClick={() => setDraft(newDraft(seasonNumber, nextBlockIndex))}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-[#E11D48] px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-white shadow-sm shadow-rose-600/20 transition-colors hover:bg-[#c4173d] dark:bg-[#FF8C7A] dark:text-slate-950 dark:hover:bg-[#ff7a63]"
        >
          <IconPlus className="h-4 w-4" />
          New group debrief
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {draft && (
        <BlockEditor
          draft={draft}
          saving={saving}
          leagueTeams={leagueTeams}
          onChange={setDraft}
          onPatchMatch={patchMatch}
          onCancel={() => setDraft(null)}
          onSave={() => void save()}
        />
      )}

      {loading ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400">
          Reading your group debriefs…
        </p>
      ) : rows.length === 0 && !draft ? (
        <EmptyState onStart={() => setDraft(newDraft(seasonNumber, nextBlockIndex))} />
      ) : (
        <div data-tour="group-blocks" className="space-y-5">
          {rows.map((row) => (
            <BlockDocument
              key={row.block.id}
              row={row}
              onEdit={() => setDraft(draftFromBlock(row.block))}
              onDelete={() => void remove(row.block)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div data-tour="group-empty" className="rounded-2xl border border-slate-200/80 bg-white/90 p-8 text-center shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <IconWhistle className="mx-auto h-8 w-8 text-[#E11D48] dark:text-[#FF8C7A]" />
      <h3 className="mt-3 font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
        No group debriefs yet
      </h3>
      <p className="mx-auto mt-2 max-w-md font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        Take five fixtures at a time: set the points you want from each, then come back and report
        what happened. TouchlineOS adds the block up and shows it as one run of form.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-4 cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
      >
        Start a block
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The read-only "document" - how a reported block reads back.
// ---------------------------------------------------------------------------

function BlockDocument({
  row,
  onEdit,
  onDelete,
}: {
  row: BlockRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { block, summary } = row;
  const firstOpponent = block.matches.find((match) => match.opponent)?.opponent ?? null;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl transition-colors dark:border-slate-800/80 dark:bg-slate-900/90">
      {/* Header: which block, and how it went. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <IconWhistle className="h-5 w-5 text-[#E11D48] dark:text-[#FF8C7A]" />
          <div>
            <h3 className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
              Group Debrief {block.blockIndex}
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5 font-sub text-[10px] uppercase tracking-wider text-slate-400">
              <IconCalendar className="h-3 w-3" />
              <span>Season {block.seasonNumber}</span>
            </div>
          </div>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider ${VERDICT_STYLES[summary.verdict]}`}
        >
          {VERDICT_LABELS[summary.verdict]}
        </span>
      </header>

      {/* The situation the block was written against. */}
      {hasAny([
        block.gamesPlayedBefore,
        block.pointsBefore,
        block.positionBefore,
        block.goalDifferenceBefore,
      ]) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-slate-50/70 px-6 py-2.5 font-sub text-[11px] text-slate-600 tabular-nums dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          <span className="uppercase tracking-wider text-slate-400">Going in</span>
          <Figure value={block.gamesPlayedBefore} suffix="played" />
          <Dot />
          <Figure value={block.pointsBefore} suffix="pts" />
          <Dot />
          <Figure value={block.positionBefore} ordinalPrefix="#" />
          <Dot />
          <Figure value={block.goalDifferenceBefore} signed suffix="GD" />
          {firstOpponent && (
            <>
              <Dot />
              <span className="text-slate-400">before {firstOpponent}</span>
            </>
          )}
        </p>
      )}

      {/* The five matches. */}
      <ol className="divide-y divide-slate-100 dark:divide-slate-800/70">
        {block.matches.map((match, index) => (
            <li key={index} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-6 py-3.5">
              <NumberBadge value={index + 1} />

              <div className="min-w-[9rem] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
                    {match.opponent ?? "Opponent not named"}
                  </span>
                  {match.opponentPosition !== null && (
                    <span className="font-sub text-[10px] text-slate-400 tabular-nums">
                      {ordinal(match.opponentPosition)}
                    </span>
                  )}
                </div>
                <span className="mt-1 inline-flex items-center gap-1.5 font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <IconTarget className="h-3 w-3" />
                  Target {presetLabel(match.targetPoints, match.targetMaxPoints)}
                </span>
              </div>

              <div className="min-w-[5.5rem]">
                {match.goalsFor === null || match.goalsAgainst === null ? (
                  <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400">
                    Not played
                  </span>
                ) : (
                  <ResultChip
                    ourGoals={match.goalsFor}
                    theirGoals={match.goalsAgainst}
                    points={match.actualPoints}
                  />
                )}
              </div>

              {match.note && (
                <p className="flex w-full basis-full items-start gap-2 pt-1 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  <IconNote className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                  <span className="whitespace-pre-wrap">{match.note}</span>
                </p>
              )}
            </li>
          ))}
      </ol>

      {/* The band, and the report card. */}
      <div className="space-y-3 border-t border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-sub text-[11px] tabular-nums">
          <Band icon={<IconFlag className="h-3.5 w-3.5" />} label="Target">
            {block.targetMin}-{block.targetMax} pts
          </Band>
          <Band icon={<IconSpark className="h-3.5 w-3.5" />} label="Dream">
            {block.dreamPoints}+
          </Band>
          <Band icon={<IconAlert className="h-3.5 w-3.5" />} label="Concern">
            {block.concernPoints} or fewer
          </Band>
        </div>

        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
            After the five
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-heading text-xs text-slate-800 tabular-nums dark:text-slate-200">
            <span>
              {summary.points} / {summary.matchesTotal * 3} pts
            </span>
            <Dot />
            <span>
              {summary.wins}W {summary.draws}D {summary.losses}L
            </span>
            <Dot />
            <span>GF {summary.goalsFor}</span>
            <Dot />
            <span>GA {summary.goalsAgainst}</span>
            {block.tablePosition !== null && (
              <>
                <Dot />
                <span>{ordinal(block.tablePosition)}</span>
              </>
            )}
            {summary.gapToTargetPosition !== null && summary.targetPosition !== null && (
              <>
                <Dot />
                <span>
                  {summary.gapToTargetPosition > 0 ? `${summary.gapToTargetPosition} short of ` : "level with "}
                  {ordinal(summary.targetPosition)}
                </span>
              </>
            )}
          </div>
          {!summary.complete && summary.matchesPlayed > 0 && (
            <p className="mt-1.5 font-sans text-[10px] text-slate-500 dark:text-slate-400">
              {summary.matchesTotal - summary.matchesPlayed} of {summary.matchesTotal} still to report.
              Up to {summary.pointsIfRemainingWon} points remain available.
            </p>
          )}
        </div>

        {block.notes && (
          <p className="flex items-start gap-2 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <IconNote className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            <span className="whitespace-pre-wrap">{block.notes}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="inline-flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            <IconUserEntry className="h-3.5 w-3.5" />
            Your report
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete group debrief ${block.blockIndex}`}
              title="Delete this group debrief and the results it contributed"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-500/50 dark:hover:text-rose-400"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// The editor.
// ---------------------------------------------------------------------------

function BlockEditor({
  draft,
  saving,
  leagueTeams,
  onChange,
  onPatchMatch,
  onCancel,
  onSave,
}: {
  draft: BlockDraft;
  saving: boolean;
  leagueTeams?: LeagueTeamSummary[];
  onChange: React.Dispatch<React.SetStateAction<BlockDraft | null>>;
  onPatchMatch: (index: number, patch: Partial<MatchDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  // Only our own club is filtered out, exactly as the single debrief does, so both pickers offer
  // the same list in the same order.
  const selectableTeams = (leagueTeams ?? []).filter((team) => !team.isOwnClub);

  const set = <K extends keyof BlockDraft>(key: K, value: BlockDraft[K]) =>
    onChange((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          <IconWhistle className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
          {draft.id ? `Edit group debrief ${draft.blockIndex}` : `New group debrief ${draft.blockIndex}`}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Season
            <input
              type="number"
              value={draft.seasonNumber}
              onChange={(event) => set("seasonNumber", event.target.value)}
              className="w-20 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      {/* Where the club stood going in. */}
      <fieldset className="space-y-3">
        <legend className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Going into the block
        </legend>
        <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
          Optional. These are the figures you read off the table before the first of the five matches.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="Played" value={draft.gamesPlayedBefore} onChange={(v) => set("gamesPlayedBefore", v)} />
          <NumberField label="Points" value={draft.pointsBefore} onChange={(v) => set("pointsBefore", v)} />
          <NumberField label="Position" value={draft.positionBefore} onChange={(v) => set("positionBefore", v)} />
          <NumberField
            label="Goal diff."
            value={draft.goalDifferenceBefore}
            onChange={(v) => set("goalDifferenceBefore", v)}
          />
        </div>
      </fieldset>

      {/* The five matches. */}
      <div className="space-y-3">
        <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          The five matches
        </span>
        <div className="space-y-3">
          {draft.matches.map((match, index) => {
            const outcome = outcomeOf(match.ourGoals, match.theirGoals);
            return (
              <div
                key={index}
                className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <NumberBadge value={index + 1} />

                  <label className="min-w-[10rem] flex-1">
                    <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Opponent
                    </span>
                    {(() => {
                      // A stored name that is not one of the clubs on offer (a cup or friendly
                      // typed earlier) reads as "other", so the free text box reappears with it.
                      const listed = selectableTeams.some((team) => team.name === match.opponent);
                      const value =
                        match.opponentOther === true || (match.opponent !== "" && !listed)
                          ? "other"
                          : match.opponent;
                      return (
                        <>
                          <select
                            value={value}
                            onChange={(event) =>
                              onPatchMatch(
                                index,
                                event.target.value === "other"
                                  ? { opponentOther: true, opponent: "" }
                                  : { opponentOther: false, opponent: event.target.value }
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 cursor-pointer"
                          >
                            <option value="">
                              {selectableTeams.length > 0
                                ? "Choose a club from your league"
                                : "Sync a save to load your league"}
                            </option>
                            {selectableTeams.map((team) => (
                              <option key={team.teamId} value={team.name}>
                                {team.name}
                              </option>
                            ))}
                            <option value="other">Another club (cup or friendly)</option>
                          </select>
                          {value === "other" && (
                            <input
                              type="text"
                              autoFocus
                              placeholder="Club name"
                              value={match.opponent}
                              onChange={(event) =>
                                onPatchMatch(index, { opponent: event.target.value })
                              }
                              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          )}
                        </>
                      );
                    })()}
                  </label>

                  <label className="w-24">
                    <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Their place
                    </span>
                    <input
                      type="number"
                      value={match.opponentPosition}
                      onChange={(event) => onPatchMatch(index, { opponentPosition: event.target.value })}
                      placeholder="—"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </label>

                  <label className="w-32">
                    <span className="flex items-center gap-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <IconTarget className="h-3 w-3" />
                      Target
                    </span>
                    <select
                      value={match.target}
                      onChange={(event) => onPatchMatch(index, { target: event.target.value })}
                      className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {TARGET_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-end gap-2">
                    <label className="w-16">
                      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Us
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={match.ourGoals}
                        onChange={(event) => onPatchMatch(index, { ourGoals: event.target.value })}
                        placeholder="—"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </label>
                    <label className="w-16">
                      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Them
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={match.theirGoals}
                        onChange={(event) => onPatchMatch(index, { theirGoals: event.target.value })}
                        placeholder="—"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </label>
                    <span className="pb-2">
                      {outcome ? (
                        <ResultChip
                          ourGoals={Number(match.ourGoals)}
                          theirGoals={Number(match.theirGoals)}
                          points={pointsFor(outcome)}
                        />
                      ) : (
                        <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400">
                          {match.ourGoals === "" && match.theirGoals === "" ? "To come" : "Incomplete"}
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <textarea
                  value={match.note}
                  onChange={(event) => onPatchMatch(index, { note: event.target.value })}
                  rows={2}
                  placeholder="What actually happened — how it felt, who stood out, what nearly went wrong."
                  className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* The band. */}
      <fieldset className="space-y-3">
        <legend className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          How the block will be judged
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="Target from" value={draft.targetMin} onChange={(v) => set("targetMin", v)} />
          <NumberField label="Target to" value={draft.targetMax} onChange={(v) => set("targetMax", v)} />
          <NumberField label="Dream" value={draft.dreamPoints} onChange={(v) => set("dreamPoints", v)} />
          <NumberField label="Concern at" value={draft.concernPoints} onChange={(v) => set("concernPoints", v)} />
        </div>
      </fieldset>

      {/* The wrap-up. */}
      <fieldset className="space-y-3">
        <legend className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Where you ended up
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="Position" value={draft.tablePosition} onChange={(v) => set("tablePosition", v)} />
        </div>
        <textarea
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          rows={3}
          placeholder="The read on the block as a whole — anything that does not belong to one match."
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-sans text-xs leading-relaxed text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="cursor-pointer rounded-xl bg-[#E11D48] px-4 py-2.5 font-heading text-xs font-bold uppercase tracking-wider text-white shadow-sm shadow-rose-600/20 transition-colors hover:bg-[#c4173d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
        >
          {saving ? "Saving…" : "Save group debrief"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces.
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="—"
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
    </label>
  );
}

function NumberBadge({ value }: { value: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 font-sub text-[10px] font-bold text-slate-600 tabular-nums dark:border-slate-700 dark:text-slate-300">
      {value}
    </span>
  );
}

function ResultChip({
  ourGoals,
  theirGoals,
  points,
}: {
  ourGoals: number;
  theirGoals: number;
  points: MatchPoints | null;
}) {
  const tone =
    points === 3
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      : points === 1
        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
  const label = points === 3 ? "Won" : points === 1 ? "Drew" : "Lost";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-sub text-[10px] font-bold uppercase tracking-wider tabular-nums ${tone}`}
    >
      {label}
      <span className="font-mono">
        {ourGoals}-{theirGoals}
      </span>
    </span>
  );
}

function Band({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
      <span className="text-slate-400">{icon}</span>
      <span className="font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="font-heading">{children}</span>
    </span>
  );
}

function Figure({
  value,
  suffix,
  signed = false,
  ordinalPrefix = "",
}: {
  value: number | null;
  suffix?: string;
  signed?: boolean;
  ordinalPrefix?: string;
}) {
  if (value === null) return null;
  const shown = signed && value > 0 ? `+${value}` : String(value);
  return (
    <span>
      {ordinalPrefix}
      {shown}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function Dot() {
  return <span className="text-slate-300 dark:text-slate-600">·</span>;
}

function hasAny(values: Array<number | null>): boolean {
  return values.some((value) => value !== null);
}

/** 1 -> 1st, 2 -> 2nd. The only place this file needs to spell a placing out. */
function ordinal(value: number): string {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}
