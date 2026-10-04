"use client";

import React, { useMemo, useState } from "react";
import { SubTabs } from "@/components/ui/sub-tabs";
import { GroupDebriefPanel } from "@/components/ui/debrief/group-debrief-panel";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import type { LeagueTeamSummary } from "@/lib/services/career-service";
import { resultLabel, venueLabel } from "@/lib/ui/labels";
import { MatchContribution } from "@/lib/events/types";
import {
  evaluateMatchAnomalies,
  DebriefHistoryPayload,
} from "@/lib/events/debrief-anomalies";

interface DebriefViewProps {
  careerId: string | null;
  players: EnrichedPlayer[];
  recentEvents: ParsedCareerEvent[];
  /** The clubs in the manager's own division, so an opponent can be picked rather than typed. */
  leagueTeams?: LeagueTeamSummary[];
  /** Our own club name, so the scoreline can name both sides. */
  clubName?: string;
  /** The save's current in-game date, used to seed the match date. */
  inGameDate?: string | null;
  /** The season a group debrief belongs to. Null when nothing is synced yet. */
  seasonNumber?: number | null;
  onDebriefSubmitted: () => void;
}

type DebriefSubTab = "MATCH" | "GROUP";

/**
 * Shape of a stored MATCH_DEBRIEF payload. Tolerant of the earlier single-standout shape so a
 * debrief logged before multi-standout/contribution tracking existed still renders correctly.
 */
interface DebriefHistory {
  opponent?: string;
  scoreline?: string;
  result?: string;
  venue?: string;
  competition?: string;
  standoutPlayerNames?: string[];
  standoutPlayerName?: string;
  contributions?: MatchContribution[];
  weaknessIdentified?: string;
  managerReflection?: string;
  matchDate?: string | null;
  leagueSnapshot?: {
    opponentPosition?: number | null;
    opponentPoints?: number | null;
    ownPosition?: number | null;
    ownPoints?: number | null;
  };
  dynamicPrompts?: Array<{ id: string; question: string; answer: string }>;
}

/** 1 -> "1st". Used only for the opponent list, where a bare number reads as a count. */
function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * A small numeric box for the league picture - a placing or a points total.
 *
 * Text with a numeric keypad, same reasoning as `ScoreBox`, but quieter: these are supporting
 * numbers, so they sit at label weight rather than competing with the scoreline.
 */
function TableNumberBox({
  id,
  value,
  onChange,
  label,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  label: string;
  ariaLabel: string;
}) {
  return (
    <div>
      {/**
       * Short and visible, with the club named by the group heading above and carried into the
       * control's own accessible name. Spelling the club out here instead wrapped every label onto
       * three lines and left the row looking ragged.
       */}
      <label
        htmlFor={id}
        className="mb-1 block whitespace-nowrap text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        placeholder="–"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 w-full text-center font-sub text-sm font-bold tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/20 transition-[border-color,box-shadow] duration-150"
      />
    </div>
  );
}

/** "3rd, 46 pts" - or just the half that was actually recorded. Never invents the other half. */
function describePlacing(position?: number | null, points?: number | null): string | null {
  const parts: string[] = [];
  if (position !== null && position !== undefined) parts.push(ordinal(position));
  if (points !== null && points !== undefined) parts.push(`${points} pts`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * A score box.
 * * *
 * Text rather than `type="number"`, for two reasons that both matter here. A number input cannot
 * be emptied without falling back to 0, so a fresh form showed a pair of zeroes as though the
 * manager had already entered something. And it draws native spinner arrows that no amount of
 * styling makes consistent across browsers. Empty is a real state, so it is allowed to exist.
 */
function ScoreBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      placeholder="0"
      value={value}
      onChange={(e) => {
        // Keep one or two digits; anything else is a typo, not a score.
        const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
        onChange(digits);
      }}
      onFocus={(e) => e.currentTarget.select()}
      className="w-12 h-12 text-center font-heading text-2xl tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/20 transition-[border-color,box-shadow] duration-150"
    />
  );
}

/**
 * The opponent's name, from the two primitives it is actually a function of.
 *
 * Kept as a plain module-level function so the form and the anomaly pass below cannot drift: the
 * memo that evaluates anomalies has to list the raw inputs (the typed name, the picked club id and
 * the league list) rather than a value derived from them, because React Compiler refuses to
 * preserve a manual memoization whose dependency was computed off a prop through
 * `Array.prototype.filter`/`find` - it reports that as `preserve-manual-memoization`.
 */
function resolveOpponentName(
  typedOpponent: string,
  teams: LeagueTeamSummary[],
  selectedTeamId: string
): string {
  if (typedOpponent) return typedOpponent;
  return teams.find(
    (team) => !team.isOwnClub && String(team.teamId) === selectedTeamId
  )?.name ?? "";
}

/** A stable empty value, so `leagueTeams = []` cannot hand the memo a new array every render. */
const NO_LEAGUE_TEAMS: LeagueTeamSummary[] = [];

export function DebriefView({
  careerId,
  players,
  recentEvents,
  leagueTeams = NO_LEAGUE_TEAMS,
  clubName = "",
  inGameDate = null,
  seasonNumber = null,
  onDebriefSubmitted,
}: DebriefViewProps) {
  const [subTab, setSubTab] = useState<DebriefSubTab>("MATCH");
  const [opponent, setOpponent] = useState("");
  const [opponentTeamId, setOpponentTeamId] = useState<string>("");
  // Scores are held as typed text so the boxes can be empty. See `ScoreBox`.
  const [ourScoreInput, setOurScoreInput] = useState("");
  const [theirScoreInput, setTheirScoreInput] = useState("");
  const [matchDate, setMatchDate] = useState<string>(inGameDate ?? "");
  const [venue, setVenue] = useState<"HOME" | "AWAY" | "NEUTRAL">("HOME");
  const [competition, setCompetition] = useState("League Match");
  const [tacticalAdherence, setTacticalAdherence] = useState<number>(4);
  const [standoutPlayerIds, setStandoutPlayerIds] = useState<string[]>([]);
  const [contributions, setContributions] = useState<MatchContribution[]>([]);
  const [contributionPlayerId, setContributionPlayerId] = useState<string>("");
  const [contributionGoals, setContributionGoals] = useState<number>(1);
  const [contributionAssists, setContributionAssists] = useState<number>(0);
  const [weaknessIdentified, setWeaknessIdentified] = useState("");
  const [managerReflection, setManagerReflection] = useState("");
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>({});
  // The league picture at kick-off. Every one of these is the manager reading the table, because
  // the save holds no rival record for our division at all - see the note on the API payload.
  const [opponentPosition, setOpponentPosition] = useState<string>("");
  const [opponentPoints, setOpponentPoints] = useState<string>("");
  //
  // Neither side's placing is prefilled, on purpose. The save's `currenttableposition` is not a
  // league table: in this division the 24 clubs carry values with ties (two 4ths, two 8ths, two
  // 15ths) and gaps (no 12th, 16th, 17th, 19th or 23rd), so presenting one as "where they are"
  // would be inventing a table the save does not keep. It is also the position *now*, and the
  // manager is logging a match that may have been played weeks ago. Both placings are stated by the
  // manager, which is the only way they can be right.
  const [ownPosition, setOwnPosition] = useState<string>("");
  const [ownPoints, setOwnPoints] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Which card is asking to be deleted, and which is mid-request. Deleting is destructive and
  // irreversible, so it is always two deliberate clicks rather than one.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The two figures the rest of the form reasons about. Empty counts as nil.
  const ourScore = ourScoreInput === "" ? 0 : Number(ourScoreInput);
  const theirScore = theirScoreInput === "" ? 0 : Number(theirScoreInput);

  // Only our own club is filtered out; the rest are offered by name and in the order the save
  // lists them. Their placings are deliberately not shown - see the note on `ownPosition` above.
  const selectableTeams = leagueTeams.filter((team) => !team.isOwnClub);

  const selectedTeam = selectableTeams.find((team) => String(team.teamId) === opponentTeamId);
  // A typed name wins, so a club outside the division can still be recorded.
  const typedOpponent = opponent.trim();
  const opponentLabel = resolveOpponentName(typedOpponent, leagueTeams, opponentTeamId);

  const hasOpponent = typedOpponent.length > 0 || Boolean(selectedTeam);

  // Stated only when both sides are known, so the line never implies more than was entered.
  const pointsGap =
    ownPoints === "" || opponentPoints === ""
      ? null
      : Number(opponentPoints) - Number(ownPoints);

  /**
   * Picking a club clears the placing rather than carrying one across.
   *
   * The previous version prefilled the opponent's position from the save. Both figures are now the
   * manager's, so the only thing that has to be right is that a stale value from a previously
   * picked club can never be left sitting next to a new opponent.
   */
  const pickOpponent = (teamId: string) => {
    setOpponentTeamId(teamId);
    setOpponentPosition("");
    setOpponentPoints("");
  };

  // Goals logged here are always manager observations - the save carries no match events - so the
  // two figures are only reconciled as a prompt. An unlogged goal usually means a scorer was
  // forgotten, not that anything is wrong with the stored data.
  const goalsLogged = contributions.reduce((sum, entry) => sum + entry.goals, 0);
  const assistsLogged = contributions.reduce((sum, entry) => sum + entry.assists, 0);
  const goalsUnlogged = Math.max(0, ourScore - goalsLogged);

  // Filter existing match debriefs from activity spine
  const pastDebriefs = recentEvents.filter((evt) => evt.eventType === "MATCH_DEBRIEF");

  const pastDebriefsPayloads = useMemo(() => {
    return pastDebriefs.map((evt) => {
      try {
        return (typeof evt.payload === "string" ? JSON.parse(evt.payload) : evt.payload) as DebriefHistoryPayload;
      } catch {
        return {} as DebriefHistoryPayload;
      }
    });
  }, [pastDebriefs]);

  const playerNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of players) {
      map[p.id] = p.name;
    }
    return map;
  }, [players]);

  const activeAnomalies = useMemo(() => {
    return evaluateMatchAnomalies(
      pastDebriefsPayloads,
      {
        ourScore,
        theirScore,
        // Re-derived here rather than read from `opponentLabel` above, so every entry in the
        // dependency list below is a prop, a piece of state or another memo - the only kinds of
        // value React Compiler can prove stable when it checks this memo.
        opponent: resolveOpponentName(opponent.trim(), leagueTeams, opponentTeamId),
        contributions,
        standoutPlayerIds,
      },
      playerNamesById
    );
  }, [
    pastDebriefsPayloads,
    ourScore,
    theirScore,
    opponent,
    opponentTeamId,
    leagueTeams,
    contributions,
    standoutPlayerIds,
    playerNamesById,
  ]);

  const toggleStandout = (playerId: string) => {
    setStandoutPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  /** Adds a contribution, merging into an existing row so one player can never appear twice. */
  const addContribution = () => {
    const player = players.find((p) => p.id === contributionPlayerId);
    if (!player) return;
    const goals = Math.max(0, Math.floor(contributionGoals) || 0);
    const assists = Math.max(0, Math.floor(contributionAssists) || 0);
    if (goals === 0 && assists === 0) return;

    setContributions((prev) => {
      const existing = prev.find((entry) => entry.playerId === player.id);
      if (existing) {
        return prev.map((entry) =>
          entry.playerId === player.id
            ? { ...entry, goals: entry.goals + goals, assists: entry.assists + assists }
            : entry
        );
      }
      return [...prev, { playerId: player.id, playerName: player.name, goals, assists }];
    });

    setContributionPlayerId("");
    setContributionGoals(1);
    setContributionAssists(0);
  };

  const removeContribution = (playerId: string) => {
    setContributions((prev) => prev.filter((entry) => entry.playerId !== playerId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!careerId) {
      setMessage("Error: No active career connected.");
      return;
    }
    if (!hasOpponent) {
      setMessage("Pick an opponent from your league, or type one.");
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const standoutPlayerNames = players
      .filter((p) => standoutPlayerIds.includes(p.id))
      .map((p) => p.name);

    const dynamicPrompts = activeAnomalies
      .map((a) => ({
        id: a.id,
        question: a.question,
        answer: (dynamicAnswers[a.id] || "").trim(),
      }))
      .filter((p) => p.answer.length > 0);

    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          opponent: opponentLabel,
          // `homeScore` is our score and `awayScore` is theirs, whichever ground the game was at.
          // The names are historical; the UI labels the boxes by club so nothing relies on them.
          homeScore: ourScore,
          awayScore: theirScore,
          matchDate: matchDate || null,
          opponentTeamId: opponentTeamId === "" ? null : Number(opponentTeamId),
          leagueSnapshot: {
            opponentPosition: opponentPosition === "" ? null : Number(opponentPosition),
            opponentPoints: opponentPoints === "" ? null : Number(opponentPoints),
            ownPosition: ownPosition === "" ? null : Number(ownPosition),
            ownPoints: ownPoints === "" ? null : Number(ownPoints),
          },
          venue,
          competition,
          tacticalAdherence,
          standoutPlayerIds,
          standoutPlayerNames,
          contributions,
          weaknessIdentified,
          managerReflection,
          dynamicPrompts,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit debrief.");
      }

      setMessage("Match debrief saved.");
      setOpponent("");
      setOpponentTeamId("");
      setOurScoreInput("");
      setTheirScoreInput("");
      setOpponentPosition("");
      setOpponentPoints("");
      setWeaknessIdentified("");
      setManagerReflection("");
      setDynamicAnswers({});
      setStandoutPlayerIds([]);
      setContributions([]);
      setContributionPlayerId("");
      setContributionGoals(1);
      setContributionAssists(0);
      onDebriefSubmitted();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Deletes one debrief.
   *
   * The server only ever removes a row that is both a MATCH_DEBRIEF and USER-sourced, so this
   * cannot take a career transition out of the spine even if it were called with a stale id.
   */
  const deleteDebrief = async (id: string) => {
    if (!careerId) {
      setMessage("Error: No active career connected.");
      return;
    }

    setDeletingId(id);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/debrief?id=${encodeURIComponent(id)}&careerId=${encodeURIComponent(careerId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not delete that debrief.");
      }
      setConfirmDeleteId(null);
      setMessage("Debrief deleted.");
      onDebriefSubmitted();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-sub font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
            Match Review
          </span>
          <h1 className="font-heading text-2xl text-slate-900 dark:text-slate-100 uppercase tracking-wide mt-0.5">
            Match Debrief
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Write down what happened and what you noticed. It stays in your career history.
          </p>
        </div>
      </div>

      <SubTabs
        tabs={[
          { id: "MATCH", label: "Match debrief" },
          { id: "GROUP", label: "Group debrief" },
        ]}
        active={subTab}
        onChange={setSubTab}
      />

      {subTab === "GROUP" ? (
        careerId ? (
          <GroupDebriefPanel careerId={careerId} seasonNumber={seasonNumber} />
        ) : (
          <p className="font-sans text-xs text-slate-600 dark:text-slate-400">
            Sync a career from the Portal to keep group debriefs.
          </p>
        )
      ) : (
        <>

      {message && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 text-xs font-sub font-bold flex items-center justify-between">
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            aria-label="Dismiss message"
            title="Dismiss"
            className="-mr-2 inline-flex min-h-10 min-w-10 items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Debrief Entry Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-2 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-6">
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-3">
            Log a match
          </h2>

          {/* Opponent & Competition Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="debrief-opponent"
                className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Opponent
              </label>
              <select
                id="debrief-opponent"
                value={opponentTeamId}
                onChange={(e) => pickOpponent(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] cursor-pointer font-sub"
              >
                <option value="">
                  {selectableTeams.length > 0
                    ? "Choose a club from your league"
                    : "Sync a save to load your league"}
                </option>
                {selectableTeams.map((team) => (
                  <option key={team.teamId} value={String(team.teamId)}>
                    {team.name}
                  </option>
                ))}
                <option value="other">Another club (cup or friendly)</option>
              </select>
              {opponentTeamId === "other" && (
                <input
                  type="text"
                  autoFocus
                  placeholder="Club name"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  className="mt-2 w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                />
              )}
            </div>

            <div>
              <label
                htmlFor="debrief-date"
                className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                title="The in-game date you played, not today's date."
              >
                Match date
              </label>
              <input
                id="debrief-date"
                type="date"
                value={matchDate}
                onChange={(e) => setMatchDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="debrief-competition"
                className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Competition
              </label>
              <select
                id="debrief-competition"
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] cursor-pointer font-sub"
              >
                <option value="League Match">League Match</option>
                <option value="Domestic Cup">Domestic Cup</option>
                <option value="European Cup">European Cup</option>
                <option value="Friendly / Pre-season">Friendly / Pre-season</option>
              </select>
            </div>
          </div>

          {/* Scoreline & Venue Row */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Scoreline & Venue
              </span>
              <div className="flex items-center gap-1.5">
                {(["HOME", "AWAY", "NEUTRAL"] as const).map((v) => (
                  <button
                    type="button"
                    key={v}
                    onClick={() => setVenue(v)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-sub font-bold uppercase cursor-pointer border ${
                      venue === v
                        ? "bg-[#E11D48] text-white border-[#E11D48]"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/*
              The result, laid out like a fixture. Each club names the score beneath it, so a 0-0
              is never ambiguous about which side is which - the old version put the two numbers
              under the words "your club" and "opponent" and left the reader to work it out.
            */}
            <div className="flex flex-col items-center gap-2 py-1">
              <span className="text-center text-xs font-sub font-bold uppercase tracking-wider leading-tight text-slate-700 dark:text-slate-200">
                {clubName || "Your club"}
              </span>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-sm">
                <ScoreBox
                  value={ourScoreInput}
                  onChange={setOurScoreInput}
                  label={`${clubName || "Your club"} score`}
                />
                <span
                  aria-hidden="true"
                  className="select-none font-heading text-lg text-slate-300 dark:text-slate-600"
                >
                  –
                </span>
                <ScoreBox
                  value={theirScoreInput}
                  onChange={setTheirScoreInput}
                  label={`${opponentLabel || "Opponent"} score`}
                />
              </div>
              <span className="text-center text-xs font-sub font-bold uppercase tracking-wider leading-tight text-slate-700 dark:text-slate-200">
                {opponentLabel || "Opponent"}
              </span>
              <span className="text-[10px] font-sub uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {venueLabel(venue)}
              </span>
            </div>
          </div>

          {/*
            The league picture at kick-off. Every number here is the manager reading the table,
            because that is the only source that can exist: the save zeroes points and results for
            every club in our division. Recording where the two sides stood is what makes it
            possible to say anything about a rival at all.
          */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                League table at kick-off
              </span>
              <span className="font-sub text-[10px] uppercase text-slate-500 dark:text-slate-400">
                logged by you · the save keeps no league table
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="block truncate text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {clubName || "Your club"}
                </span>
                <div className="flex items-end gap-3">
                  <div className="w-20">
                    <TableNumberBox
                      id="debrief-own-position"
                      label="Position"
                      ariaLabel={`${clubName || "Our club"} position`}
                      value={ownPosition}
                      onChange={setOwnPosition}
                    />
                  </div>
                  <div className="w-24">
                    <TableNumberBox
                      id="debrief-own-points"
                      label="Points"
                      ariaLabel={`${clubName || "Our club"} points`}
                      value={ownPoints}
                      onChange={setOwnPoints}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block truncate text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {opponentLabel || "Opponent"}
                </span>
                <div className="flex items-end gap-3">
                  <div className="w-20">
                    <TableNumberBox
                      id="debrief-opponent-position"
                      label="Position"
                      ariaLabel={`${opponentLabel || "Opponent"} position`}
                      value={opponentPosition}
                      onChange={setOpponentPosition}
                    />
                  </div>
                  <div className="w-24">
                    <TableNumberBox
                      id="debrief-opponent-points"
                      label="Points"
                      ariaLabel={`${opponentLabel || "Opponent"} points`}
                      value={opponentPoints}
                      onChange={setOpponentPoints}
                    />
                  </div>
                </div>
              </div>
            </div>

            {pointsGap !== null && (
              <p className="text-[11px] font-sub tabular-nums text-slate-500 dark:text-slate-400">
                {pointsGap === 0
                  ? "Level on points going in."
                  : pointsGap > 0
                    ? `${pointsGap} point${pointsGap === 1 ? "" : "s"} behind them going in.`
                    : `${Math.abs(pointsGap)} point${Math.abs(pointsGap) === 1 ? "" : "s"} ahead of them going in.`}
              </p>
            )}
          </div>

          {/* Tactical Questions */}
          <div className="space-y-4">
            {/* Match Focus Points */}
            {activeAnomalies.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 space-y-3 animate-fade-in-up">
                <div className="flex items-center justify-between">
                  <span className="font-sub text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Match Focus Points
                  </span>
                  <span className="font-sub text-[10px] uppercase font-bold text-amber-600 dark:text-amber-500">
                    Based on recent form &amp; trends
                  </span>
                </div>

                <div className="space-y-3">
                  {activeAnomalies.map((anomaly) => (
                    <div
                      key={anomaly.id}
                      className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-sub text-xs font-bold text-slate-900 dark:text-slate-100">
                          {anomaly.title}
                        </span>
                        <span
                          className={`text-[10px] font-sub font-bold uppercase px-2 py-0.5 rounded ${
                            anomaly.tone === "rose"
                              ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                              : anomaly.tone === "amber"
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : anomaly.tone === "emerald"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                          }`}
                        >
                          {anomaly.badgeText}
                        </span>
                      </div>
                      <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
                        {anomaly.question}
                      </p>
                      <textarea
                        rows={2}
                        placeholder={anomaly.placeholder}
                        value={dynamicAnswers[anomaly.id] || ""}
                        onChange={(e) =>
                          setDynamicAnswers((prev) => ({
                            ...prev,
                            [anomaly.id]: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Tactical Plan Adherence (1 to 5)
                </label>
                <span className="font-sub text-xs font-bold text-[#E11D48] dark:text-[#FF8C7A]">
                  {tacticalAdherence} / 5
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={tacticalAdherence}
                onChange={(e) => setTacticalAdherence(parseInt(e.target.value))}
                className="w-full accent-[#E11D48] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Standout Performers
                </label>
                <span className="font-sub text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  {standoutPlayerIds.length === 0
                    ? "select any number"
                    : `${standoutPlayerIds.length} selected`}
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 flex flex-wrap gap-1.5">
                {players.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">
                    No squad synced yet - sync a save to pick performers.
                  </p>
                ) : (
                  players.map((p) => {
                    const selected = standoutPlayerIds.includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => toggleStandout(p.id)}
                        aria-pressed={selected}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-sub font-bold cursor-pointer border transition-colors ${
                          selected
                            ? "bg-amber-400 text-slate-950 border-amber-400"
                            : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400"
                        }`}
                      >
                        {p.name}
                        <span className="ml-1 font-normal opacity-70">{p.primaryPosition}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Goals &amp; Assists
                </span>
                <span className="font-sub text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  logged by you · not in the save
                </span>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[10rem]">
                  <label className="block text-[10px] font-sub font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Player
                  </label>
                  <select
                    value={contributionPlayerId}
                    onChange={(e) => setContributionPlayerId(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] cursor-pointer font-sub"
                  >
                    <option value="">-- Select Squad Member --</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.primaryPosition})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-16">
                  <label className="block text-[10px] font-sub font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Goals
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={contributionGoals}
                    onChange={(e) => setContributionGoals(parseInt(e.target.value) || 0)}
                    className="w-full h-9 text-center font-heading text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:border-[#E11D48] focus:outline-none"
                  />
                </div>

                <div className="w-16">
                  <label className="block text-[10px] font-sub font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Assists
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={contributionAssists}
                    onChange={(e) => setContributionAssists(parseInt(e.target.value) || 0)}
                    className="w-full h-9 text-center font-heading text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:border-[#E11D48] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={addContribution}
                  disabled={
                    !contributionPlayerId || (contributionGoals === 0 && contributionAssists === 0)
                  }
                  className="h-10 px-4 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-sub text-[11px] font-bold uppercase cursor-pointer transition-[background-color,transform] duration-200 hover:bg-[#E11D48] dark:hover:bg-[#FF8C7A] active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  Add
                </button>
              </div>

              {contributions.length > 0 && (
                <ul className="space-y-1.5">
                  {contributions.map((entry) => (
                    <li
                      key={entry.playerId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2"
                    >
                      <span className="text-xs font-sub font-bold text-slate-800 dark:text-slate-100">
                        {entry.playerName}
                      </span>
                      <span className="flex items-center gap-2 text-[11px] font-sub font-bold text-slate-600 dark:text-slate-300">
                        {entry.goals > 0 && <span>{entry.goals} goal{entry.goals === 1 ? "" : "s"}</span>}
                        {entry.assists > 0 && (
                          <span>{entry.assists} assist{entry.assists === 1 ? "" : "s"}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeContribution(entry.playerId)}
                          aria-label={`Remove ${entry.playerName}`}
                          title={`Remove ${entry.playerName}`}
                          className="-mr-2 inline-flex min-h-10 min-w-10 items-center justify-center text-slate-400 hover:text-[#E11D48] cursor-pointer transition-colors active:scale-[0.96]"
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400 tabular-nums">
                {goalsLogged === 0 && ourScore === 0
                  ? "No goals to account for."
                  : goalsUnlogged === 0
                    ? `${goalsLogged} of ${ourScore} goals accounted for${
                        assistsLogged > 0
                          ? ` · ${assistsLogged} assist${assistsLogged === 1 ? "" : "s"}`
                          : ""
                      }.`
                    : `${goalsLogged} of ${ourScore} goals accounted for · ${goalsUnlogged} still unassigned.`}
              </p>
            </div>

                <div>
                  <label
                    className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                    title="Something you noticed that went wrong, so you can check it against the next match."
                  >
                    Weakness you spotted
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. left side exposed on the counter"
                    value={weaknessIdentified}
                    onChange={(e) => setWeaknessIdentified(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                  />
                </div>

                <div>
                  <label
                    className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                    title="Anything worth remembering about this match. Only you can see it."
                  >
                    Your notes
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Substitutions, turning points, what you would change..."
                    value={managerReflection}
                    onChange={(e) => setManagerReflection(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48]"
                  />
                </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-11 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase py-3.5 rounded-xl transition-[background-color,transform] duration-200 active:scale-[0.96] shadow-md cursor-pointer disabled:opacity-50 disabled:active:scale-100"
          >
            {isSubmitting ? "Saving..." : "Save Match Debrief →"}
          </button>
        </form>

        {/* Right Column: Historical Match Debriefs */}
        <div className="h-fit bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-3">
            Your debriefs ({pastDebriefs.length})
          </h2>

          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {pastDebriefs.length > 0 ? (
              pastDebriefs.map((evt) => {
                let payload: DebriefHistory = {};
                try {
                  payload =
                    (typeof evt.payload === "string" ? JSON.parse(evt.payload) : evt.payload) || {};
                } catch {}

                const standouts = payload.standoutPlayerNames?.length
                  ? payload.standoutPlayerNames
                  : payload.standoutPlayerName && payload.standoutPlayerName !== "None Selected"
                    ? [payload.standoutPlayerName]
                    : [];
                const scorers = (payload.contributions ?? []).filter((entry) => entry.goals > 0);
                const assisters = (payload.contributions ?? []).filter((entry) => entry.assists > 0);

                // The in-game date the match was played, kept apart from the event's own
                // timestamp, which is only when the debrief happened to be written up.
                const matchDateLabel = payload.matchDate
                  ? new Date(`${payload.matchDate}T00:00:00Z`).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : null;
                const ourPlacing = describePlacing(
                  payload.leagueSnapshot?.ownPosition,
                  payload.leagueSnapshot?.ownPoints
                );
                const theirPlacing = describePlacing(
                  payload.leagueSnapshot?.opponentPosition,
                  payload.leagueSnapshot?.opponentPoints
                );

                return (
                  <div
                    key={evt.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800/80 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-sub font-bold uppercase">
                      <span className="truncate text-slate-900 dark:text-slate-100">
                        vs {payload.opponent || "Unnamed opponent"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] tabular-nums ${
                          payload.result === "WIN" ? "bg-emerald-500/15 text-emerald-600" :
                          payload.result === "LOSS" ? "bg-rose-500/15 text-rose-600" : "bg-amber-500/15 text-amber-600"
                        }`}>
                          {payload.scoreline || "0-0"} · {resultLabel(payload.result || "DRAW")}
                        </span>
                        {confirmDeleteId === evt.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void deleteDebrief(evt.id)}
                              disabled={deletingId === evt.id}
                              className="inline-flex min-h-10 items-center rounded-lg bg-rose-600 px-2.5 text-[10px] uppercase tracking-wider text-white transition-[background-color,transform] duration-200 hover:bg-rose-500 active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 cursor-pointer"
                            >
                              {deletingId === evt.id ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="inline-flex min-h-10 items-center rounded-lg px-2.5 text-[10px] uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(evt.id)}
                            aria-label={`Delete the debrief against ${payload.opponent || "an unnamed opponent"}`}
                            className="inline-flex min-h-10 items-center rounded-lg px-2.5 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400 cursor-pointer"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] font-sub text-slate-500 dark:text-slate-400 space-y-1">
                      <p>
                        {[matchDateLabel, payload.competition, payload.venue ? venueLabel(payload.venue) : null]
                          .filter(Boolean)
                          .join(" · ") || "No competition recorded"}
                      </p>
                      {(ourPlacing || theirPlacing) && (
                        <p className="tabular-nums">
                          Table at kick-off · {clubName || "Us"}: {ourPlacing ?? "not logged"} ·{" "}
                          {payload.opponent || "Them"}: {theirPlacing ?? "not logged"}
                        </p>
                      )}
                      {standouts.length > 0 && (
                        <p className="text-slate-700 dark:text-slate-300 font-semibold">
                          ★ {standouts.length > 1 ? "Standouts" : "Standout"}: {standouts.join(", ")}
                        </p>
                      )}
                      {scorers.length > 0 && (
                        <p className="text-slate-700 dark:text-slate-300">
                          Scorers:{" "}
                          {scorers
                            .map((entry) =>
                              entry.goals > 1
                                ? `${entry.playerName} (${entry.goals})`
                                : entry.playerName
                            )
                            .join(", ")}
                        </p>
                      )}
                      {assisters.length > 0 && (
                        <p className="text-slate-700 dark:text-slate-300">
                          Assists:{" "}
                          {assisters
                            .map((entry) =>
                              entry.assists > 1
                                ? `${entry.playerName} (${entry.assists})`
                                : entry.playerName
                            )
                            .join(", ")}
                        </p>
                      )}
                      {payload.weaknessIdentified && (
                        <p className="text-slate-600 dark:text-slate-400 italic">
                          Weakness: {payload.weaknessIdentified}
                        </p>
                      )}
                      {payload.dynamicPrompts && payload.dynamicPrompts.length > 0 && (
                        <div className="pt-1 space-y-1 border-t border-slate-200 dark:border-slate-800/60">
                          {payload.dynamicPrompts.map((dp, idx) => (
                            <p key={idx} className="text-slate-700 dark:text-slate-300">
                              <span className="font-bold text-amber-600 dark:text-amber-400">Probe: </span>
                              {dp.answer}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                Nothing logged yet. Fill in the form and your match history builds up here.
              </p>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}