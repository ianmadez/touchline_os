"use client";

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SubTabs } from "@/components/ui/sub-tabs";
import { portal, useScrollLock } from "@/components/ui/portal";
import { GroupDebriefPanel } from "@/components/ui/debrief/group-debrief-panel";
import { EnrichedPlayer } from "@/lib/services/squad-service";
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import type { LeagueTeamSummary } from "@/lib/services/career-service";
import { resultLabel, venueLabel } from "@/lib/ui/labels";
import { ordinal } from "@/lib/ui/format";
import { OPPONENT_SORT_ORDERS, orderTeams } from "@/lib/ui/opponent-list";
import { MatchContribution } from "@/lib/events/types";
import { POSITION_GROUP_ORDER, positionGroupOf } from "@/lib/tactics/roles";
import {
  evaluateMatchAnomalies,
  DebriefHistoryPayload,
} from "@/lib/events/debrief-anomalies";
import {
  expectedGoals,
  finishingEdge,
  finishingVerdict,
  keptCleanSheet,
  overperformanceAlert,
  shotsOutsideBox,
  type AlertInput,
  type MatchStats,
} from "@/lib/events/match-stats";

import { apiFetch } from "@/lib/platform/api-client";
import {
  clearDebriefDraft,
  getOpponentSortServerSnapshot,
  getOpponentSortSnapshot,
  opponentSortFrom,
  readDebriefDraft,
  setOpponentSort,
  subscribeOpponentSort,
  writeDebriefDraft,
} from "@/lib/session";
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

import type { CompetitionContext } from "@/lib/services/competition-service";

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
  homeScore?: number;
  awayScore?: number;
  opponentTeamId?: number | null;
  tacticalAdherence?: number;
  standoutPlayerIds?: string[];
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
  /** When our goals went in, and theirs, in match minutes. Absent when nothing was timed. */
  goalMinutes?: number[] | null;
  concededMinutes?: number[] | null;
  /** The figures the manager logged after the match. Absent when none were entered. */
  matchStats?: MatchStats | null;
}

/**
 * Everything the single debrief form holds, so a half finished one survives navigating away.
 *
 * The manager's own table position is deliberately saved but NOT counted as draft content: it is
 * kept between debriefs on purpose, so on its own it must not look like unsaved work.
 */
interface DebriefDraft {
  opponent: string;
  opponentTeamId: string;
  ourScoreInput: string;
  theirScoreInput: string;
  matchDate: string;
  venue: "HOME" | "AWAY" | "NEUTRAL";
  competition: string;
  tacticalAdherence: number;
  standoutPlayerIds: string[];
  standoutSort: "POSITION" | "PICKED";
  contributions: MatchContribution[];
  weaknessIdentified: string;
  managerReflection: string;
  dynamicAnswers: Record<string, string>;
  opponentPosition: string;
  opponentPoints: string;
  ownPosition: string;
  ownPoints: string;
  goalMinutes: string[];
  concededMinutes: string[];
  matchStats: MatchStatDraft;
}

/**
 * The five observable figures, held as text.
 *
 * Text for the same reason the score boxes are: an empty box is a real state and means "not recorded",
 * which is a different thing from zero. A keeper who made no saves is not the same as one nobody counted.
 */
type MatchStatDraft = Record<
  "shots" | "shotsInsideBox" | "bigChances" | "possession" | "passesCompleted",
  string
>;

const EMPTY_MATCH_STATS: MatchStatDraft = {
  shots: "",
  shotsInsideBox: "",
  bigChances: "",
  possession: "",
  passesCompleted: "",
};

/** The boxes in the order they are shown, each with the hint that says exactly what to count. */
const MATCH_STAT_FIELDS: ReadonlyArray<{ key: keyof MatchStatDraft; label: string; hint: string }> = [
  { key: "shots", label: "Shots", hint: "Every shot, including the ones blocked or off target." },
  { key: "shotsInsideBox", label: "Inside box", hint: "Shots taken from inside the penalty area." },
  { key: "bigChances", label: "Big chances", hint: "Chances you would have expected to be scored." },
  { key: "possession", label: "Possession %", hint: "Your share of the ball, 0 to 100." },
  { key: "passesCompleted", label: "Passes", hint: "Passes you completed." },
];

/** A box's text as a number, or null when it is empty or not a number. Never turns blank into zero. */
function statNumberOf(value: string | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when any stat box holds something. */
function hasAnyMatchStat(stats: Partial<MatchStatDraft> | undefined): boolean {
  if (!stats) return false;
  return Object.values(stats).some((value) => typeof value === "string" && value.trim() !== "");
}

/** The single debrief's draft surface. A group debrief keys by block id instead. */
const MATCH_DRAFT_SURFACE = "MATCH";

/**
 * The most goal timing boxes the form will ever show.
 *
 * A guard, not a claim about football: the score boxes accept three digits, and without a cap a single
 * mistyped score would build a wall of inputs. When a score exceeds it the form says so rather than
 * silently dropping the rest.
 */
const MAX_TIMING_SLOTS = 20;

/** True when a draft holds something the manager actually entered. */
function hasDraftContent(draft: DebriefDraft): boolean {
  return (
    draft.opponent.trim() !== "" ||
    draft.ourScoreInput !== "" ||
    draft.theirScoreInput !== "" ||
    draft.opponentPosition !== "" ||
    draft.opponentPoints !== "" ||
    draft.goalMinutes.some((minute) => minute.trim() !== "") ||
    draft.concededMinutes.some((minute) => minute.trim() !== "") ||
    hasAnyMatchStat(draft.matchStats) ||
    draft.weaknessIdentified.trim() !== "" ||
    draft.managerReflection.trim() !== "" ||
    draft.standoutPlayerIds.length > 0 ||
    draft.contributions.length > 0 ||
    Object.values(draft.dynamicAnswers).some((answer) => answer.trim() !== "")
  );
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

/** One worked out figure, with the basis for it stated underneath rather than left to trust. */
function StatReadout({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <span className="block font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="mt-0.5 block font-heading text-lg tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </span>
      <span className="mt-0.5 block font-sans text-[10px] leading-snug text-slate-500 dark:text-slate-400">
        {note}
      </span>
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
  /**
   * Chip order for the standout picker, and the order the names are stored in. Position order is
   * the default so the list reads back to front like the pitch does; "picked" lets the manager
   * impose their own order instead.
   */
  const [standoutSort, setStandoutSort] = useState<"POSITION" | "PICKED">("POSITION");
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
  // Match minutes for our goals and theirs, one entry per box. Empty strings are unrecorded, so a
  // goal that was not timed leaves no trace rather than becoming a zero.
  const [goalMinutes, setGoalMinutes] = useState<string[]>([]);
  const [concededMinutes, setConcededMinutes] = useState<string[]>([]);
  // The observable post-match figures. Empty is a real state here too, so they are stored as text.
  const [matchStats, setMatchStats] = useState<MatchStatDraft>(EMPTY_MATCH_STATS);
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
  /**
   * The press, when they come looking.
   *
   * Set from the debrief's own answer rather than decided here: whether a result is worth a word is a
   * property of the match, and the operation works it out. Null means either nobody asked or the question
   * has been dealt with, which are the same thing on screen.
   */
  const [mediaPrompt, setMediaPrompt] = useState<{
    eventId: string;
    prompt: string;
    subject: string;
    opponent: string;
  } | null>(null);
  const [mediaComment, setMediaComment] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);

  /**
   * The competitions this career can be in, read from the save rather than offered as "League Match".
   *
   * Null until it arrives, and the form falls back to the generic labels in the meantime, so the select is
   * never empty and never blocks a debrief.
   */
  const [competitionContext, setCompetitionContext] = useState<CompetitionContext | null>(null);

  /** The debriefs the manager starred, so the memorable ones can be found again. */
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [starFilter, setStarFilter] = useState<"ALL" | "STARRED">("ALL");

  /**
   * The debrief opened for a closer look, and the newspaper report it produced.
   *
   * The article is fetched when the record is opened rather than for every row: reading the paper publishes
   * anything new on it, and doing that once per screen would be a write in the middle of a read.
   */
  const [detail, setDetail] = useState<{
    eventId: string;
    article: { headline: string; body: string; quote: string | null } | null;
    articleLoaded: boolean;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Which card is asking to be deleted, and which is mid-request. Deleting is destructive and
  // irreversible, so it is always two deliberate clicks rather than one.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);  /**
   * The debrief being corrected, if any. Held here rather than in a separate form so logging and
   * editing share every field, every optional marker and the draft behaviour.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * The picker's chips and the stored standout names, in one order.
   *
   * Position order groups back to front (GK, DEF, MID, FWD/ST) and falls back to the squad order
   * inside a band, so the list is stable. "Picked" keeps the manager's own selection order, which
   * is what they get if they want to record who mattered most rather than where they played.
   * Unplaced players sort last rather than scattering, matching the squad table's rule.
   */
  const orderedStandoutPlayers = useMemo(() => {
    if (standoutSort === "PICKED") {
      const picked = standoutPlayerIds
        .map((id) => players.find((player) => player.id === id))
        .filter((player): player is EnrichedPlayer => player !== undefined);
      const rest = players.filter((player) => !standoutPlayerIds.includes(player.id));
      return [...picked, ...rest];
    }
    const band = (player: EnrichedPlayer): number => {
      const group = positionGroupOf(player.primaryPosition);
      return group === null ? POSITION_GROUP_ORDER.length : POSITION_GROUP_ORDER.indexOf(group);
    };
    return [...players].sort((a, b) => band(a) - band(b));
  }, [players, standoutPlayerIds, standoutSort]);

  /** The single debrief's draft surface. A group debrief keys by block id instead. */
  // Restoring happens once, and must not fight the seeded defaults, so the guard is a ref: the
  // setters below must not re-trigger the effect that reads it.
  const draftRestored = useRef(false);

  useEffect(() => {
    if (draftRestored.current || !careerId) return;
    draftRestored.current = true;
    // Deferred by a task rather than set in the effect body: a synchronous `setState` here trips
    // `react-hooks/set-state-in-effect`, and reading localStorage during render would prerender the
    // wrong answer and mismatch on hydration.
    const timer = window.setTimeout(() => {
      const saved = readDebriefDraft<DebriefDraft>(careerId, MATCH_DRAFT_SURFACE);
      if (saved === null) return;
      setOpponent(saved.opponent);
      setOpponentTeamId(saved.opponentTeamId);
      setOurScoreInput(saved.ourScoreInput);
      setTheirScoreInput(saved.theirScoreInput);
      setMatchDate(saved.matchDate);
      setVenue(saved.venue);
      setCompetition(saved.competition);
      setTacticalAdherence(saved.tacticalAdherence);
      setStandoutPlayerIds(saved.standoutPlayerIds);
      setStandoutSort(saved.standoutSort);
      setContributions(saved.contributions);
      setWeaknessIdentified(saved.weaknessIdentified);
      setManagerReflection(saved.managerReflection);
      setDynamicAnswers(saved.dynamicAnswers);
      setOpponentPosition(saved.opponentPosition);
      setOpponentPoints(saved.opponentPoints);
      setOwnPosition(saved.ownPosition);
      setOwnPoints(saved.ownPoints);
      setGoalMinutes(saved.goalMinutes ?? []);
      setConcededMinutes(saved.concededMinutes ?? []);
      setMatchStats({ ...EMPTY_MATCH_STATS, ...(saved.matchStats ?? {}) });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [careerId]);

  // Saved on every change rather than on blur, so clicking away, switching tab or closing the window
  // all keep it. Written only once something has been entered, so an untouched form leaves no trace.
  useEffect(() => {
    if (!careerId || !draftRestored.current) return;
    // While a stored debrief is open for editing the form is not a draft, so nothing is saved here.
    if (editingId !== null) return;
    const draft: DebriefDraft = {
      opponent,
      opponentTeamId,
      ourScoreInput,
      theirScoreInput,
      matchDate,
      venue,
      competition,
      tacticalAdherence,
      standoutPlayerIds,
      standoutSort,
      contributions,
      weaknessIdentified,
      managerReflection,
      dynamicAnswers,
      opponentPosition,
      opponentPoints,
      ownPosition,
      ownPoints,
      goalMinutes,
      concededMinutes,
      matchStats,
    };
    if (!hasDraftContent(draft)) return;
    writeDebriefDraft(careerId, MATCH_DRAFT_SURFACE, draft);
  }, [
    careerId,
    editingId,
    opponent,
    opponentTeamId,
    ourScoreInput,
    theirScoreInput,
    matchDate,
    venue,
    competition,
    tacticalAdherence,
    standoutPlayerIds,
    standoutSort,
    contributions,
    weaknessIdentified,
    managerReflection,
    dynamicAnswers,
    opponentPosition,
    opponentPoints,
    ownPosition,
    ownPoints,
    goalMinutes,
    concededMinutes,
    matchStats,
  ]);

  // The two figures the rest of the form reasons about. Empty counts as nil.
  const ourScore = ourScoreInput === "" ? 0 : Number(ourScoreInput);
  const theirScore = theirScoreInput === "" ? 0 : Number(theirScoreInput);

  /*
    One timing box per goal the scoreline already says was scored, so the form never asks when a goal
    went in if it did not. A match with no goals shows the block not at all.
  */
  const goalSlots = Math.min(ourScore, MAX_TIMING_SLOTS);
  const concededSlots = Math.min(theirScore, MAX_TIMING_SLOTS);
  const timingCapReached = ourScore > MAX_TIMING_SLOTS || theirScore > MAX_TIMING_SLOTS;

  /** Grows the list as far as the box being typed in, leaving earlier entries alone. */
  const setMinuteAt = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ): void => {
    setter((current) => {
      const next = current.slice();
      while (next.length <= index) next.push("");
      next[index] = value;
      return next;
    });
  };

  /*
    The derived figures. Every one of these is worked out from the manager's own entries, so they are
    DERIVED and the screen labels them that way; nothing here is read from the save, which carries no
    match events at all.
  */
  const enteredStats: MatchStats = {
    shots: statNumberOf(matchStats.shots),
    shotsInsideBox: statNumberOf(matchStats.shotsInsideBox),
    bigChances: statNumberOf(matchStats.bigChances),
    possession: statNumberOf(matchStats.possession),
    passesCompleted: statNumberOf(matchStats.passesCompleted),
  };
  const expected = expectedGoals(enteredStats);
  const finishing = finishingEdge(enteredStats, ourScore);
  const finishingWord = finishingVerdict(finishing);
  const outsideBox = shotsOutsideBox(enteredStats);
  const cleanSheet = keptCleanSheet(theirScore);

  // Only our own club is filtered out. The rest are offered in the order the manager has chosen, and
  // the order is a global preference, read from the shared store rather than held here as component
  // state. No placing is shown beside a club: see the note in `@/lib/ui/opponent-list`.
  const opponentSortRaw = useSyncExternalStore(
    subscribeOpponentSort,
    getOpponentSortSnapshot,
    getOpponentSortServerSnapshot
  );
  const opponentSort = opponentSortFrom(opponentSortRaw);
  const selectableTeams = leagueTeams.filter((team) => !team.isOwnClub);
  const orderedTeams = orderTeams(selectableTeams, opponentSort);

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

  // Filter existing match debriefs from activity spine. Restricted to records this screen owns: a
  // group debrief is MIRRORED into career_events as a MATCH_DEBRIEF row so every aggregate sees it,
  // but it belongs to its block, so counting or deleting it here would edit one entry in two places
  // and leave the two disagreeing.
  const pastDebriefs = recentEvents.filter(
    (evt) => evt.eventType === "MATCH_DEBRIEF" && evt.entityType === "MATCH"
  );

  // The competitions this career can be in, and the stars on its debriefs. Both deferred by a tick because
  // setState must not run synchronously in an effect body.
  useEffect(() => {
    if (!careerId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void apiFetch(`/api/competitions?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as { success?: boolean; context?: CompetitionContext };
          if (!cancelled && body.success && body.context) setCompetitionContext(body.context);
        })
        .catch(() => {
          /* the generic labels stay */
        });
      void apiFetch(`/api/debrief-marks?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as { success?: boolean; eventIds?: string[] };
          if (!cancelled && body.success) setStarredIds(body.eventIds ?? []);
        })
        .catch(() => {
          /* a missing star is not worth an error on this screen */
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [careerId]);

  /**
   * Stars or unstars one debrief.
   *
   * Optimistic, and put back if the write is refused: a star is an opinion, and waiting on a round trip to
   * show the star he just pressed would feel like the button was broken.
   */
  const toggleDebriefStar = async (eventId: string) => {
    if (!careerId) return;
    const next = !starredIds.includes(eventId);
    setStarredIds((ids) => (next ? [...ids, eventId] : ids.filter((id) => id !== eventId)));
    try {
      const response = await apiFetch("/api/debrief-marks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, eventId, starred: next }),
      });
      if (!response.ok) {
        setStarredIds((ids) => (next ? ids.filter((id) => id !== eventId) : [...ids, eventId]));
      }
    } catch {
      setStarredIds((ids) => (next ? ids.filter((id) => id !== eventId) : [...ids, eventId]));
    }
  };

  /**
   * Opens one debrief in full, and finds the report the desk wrote about that match.
   *
   * The article is matched by id rather than searched for: the news desk keys a match report on
   * `result-<debrief event id>`, so the link between the record and the story is exact and needs no guesswork
   * about dates or opponents.
   */
  const openDebriefDetail = async (eventId: string) => {
    setDetail({ eventId, article: null, articleLoaded: false });
    if (!careerId) return;
    try {
      const response = await apiFetch(`/api/news?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        paper?: { items?: Array<{ id: string; headline: string; body: string; quote: string | null }> };
      };
      const item = (body.paper?.items ?? []).find((entry) => entry.id === `result-${eventId}`) ?? null;
      setDetail({
        eventId,
        article: item ? { headline: item.headline, body: item.body, quote: item.quote } : null,
        articleLoaded: true,
      });
    } catch {
      setDetail({ eventId, article: null, articleLoaded: true });
    }
  };

  const visibleDebriefs =
    starFilter === "STARRED" ? pastDebriefs.filter((evt) => starredIds.includes(evt.id)) : pastDebriefs;

  /**
   * The competition list, deduped by name.
   *
   * Two things can put the same name in twice: the generic fallback already contains "League Match" and a
   * draft still holding it would be re-added, and a competition the career no longer offers is preserved so
   * an old debrief cannot be silently refiled. Deduping here covers both, and a duplicate name would be a
   * duplicate React key rather than anything a manager could see.
   */
  const competitionOptions = useMemo(() => {
    const base = competitionContext?.options ?? [
      { name: "League Match", kind: "LEAGUE" as const },
      { name: "Domestic Cup", kind: "DOMESTIC_CUP" as const },
      { name: "European Cup", kind: "CONTINENTAL" as const },
      { name: "Friendly / Pre-season", kind: "OTHER" as const },
    ];
    const kept = competition.trim() === "" ? [] : [{ name: competition, kind: "OTHER" as const }];
    return [...new Map([...base, ...kept].map((option) => [option.name, option])).values()];
  }, [competitionContext, competition]);

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

  /*
    The overperformance pattern, read from the logged league matches.

    Sorted here rather than trusting the order the event list arrives in: the claim is about the most
    recent three matches and the list's order is not part of this screen's contract. The match being
    filled in counts too, so the pattern shows itself the moment it becomes true.
  */
  const recentForAlert = [...pastDebriefsPayloads].sort((a, b) =>
    (b.matchDate ?? "").localeCompare(a.matchDate ?? "")
  );
  const overperformanceHistory: AlertInput[] = recentForAlert.map((payload) => ({
    competition: payload.competition,
    result: payload.result,
    matchStats: payload.matchStats ?? null,
  }));
  if (ourScoreInput !== "" || theirScoreInput !== "") {
    overperformanceHistory.unshift({
      competition,
      result: ourScore > theirScore ? "WIN" : ourScore < theirScore ? "LOSS" : "DRAW",
      matchStats: enteredStats,
    });
  }
  const overperformance = overperformanceAlert(overperformanceHistory);

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

  /**
   * Puts every field back to how a brand new debrief starts. Own table position is deliberately kept:
   * it stays put between matches, so clearing it would make the manager retype it every week.
   */
  const clearForm = () => {
    setOpponent("");
    setOpponentTeamId("");
    setOurScoreInput("");
    setTheirScoreInput("");
    setOpponentPosition("");
    setOpponentPoints("");
    setGoalMinutes([]);
    setConcededMinutes([]);
    setMatchStats(EMPTY_MATCH_STATS);
    setWeaknessIdentified("");
    setManagerReflection("");
    setDynamicAnswers({});
    setStandoutPlayerIds([]);
    setContributions([]);
    setContributionPlayerId("");
    setContributionGoals(1);
    setContributionAssists(0);
  };

  /**
   * Loads an existing debrief back into the form.
   *
   * The id is kept so submit can rewrite that record rather than append a second one for the same
   * match, which is what a delete-then-recreate would do.
   */
  const startEditDebrief = (evt: ParsedCareerEvent) => {
    let stored: DebriefHistory;
    try {
      stored = (typeof evt.payload === "string"
        ? JSON.parse(evt.payload)
        : evt.payload) as DebriefHistory;
    } catch {
      setMessage("That debrief could not be read, so it cannot be edited.");
      return;
    }
    const text = (value: number | null | undefined): string =>
      value === null || value === undefined ? "" : String(value);

    setEditingId(evt.id);
    setSubTab("MATCH");
    setOpponent(stored.opponent ?? "");
    setOpponentTeamId(text(stored.opponentTeamId));
    setOurScoreInput(text(stored.homeScore));
    setTheirScoreInput(text(stored.awayScore));
    setMatchDate(stored.matchDate ?? "");
    setVenue(stored.venue === "AWAY" || stored.venue === "NEUTRAL" ? stored.venue : "HOME");
    setCompetition(stored.competition ?? "League Match");
    setTacticalAdherence(typeof stored.tacticalAdherence === "number" ? stored.tacticalAdherence : 4);
    setStandoutPlayerIds(Array.isArray(stored.standoutPlayerIds) ? stored.standoutPlayerIds : []);
    setContributions(Array.isArray(stored.contributions) ? stored.contributions : []);
    setWeaknessIdentified(stored.weaknessIdentified ?? "");
    setManagerReflection(stored.managerReflection ?? "");
    setDynamicAnswers(
      Object.fromEntries((stored.dynamicPrompts ?? []).map((prompt) => [prompt.id, prompt.answer]))
    );
    setOpponentPosition(text(stored.leagueSnapshot?.opponentPosition));
    setOpponentPoints(text(stored.leagueSnapshot?.opponentPoints));
    setOwnPosition(text(stored.leagueSnapshot?.ownPosition));
    setOwnPoints(text(stored.leagueSnapshot?.ownPoints));
    setGoalMinutes((stored.goalMinutes ?? []).map((minute) => String(minute)));
    setConcededMinutes((stored.concededMinutes ?? []).map((minute) => String(minute)));
    const storedStats = stored.matchStats ?? {};
    setMatchStats({
      shots: text(storedStats.shots),
      shotsInsideBox: text(storedStats.shotsInsideBox),
      bigChances: text(storedStats.bigChances),
      possession: text(storedStats.possession),
      passesCompleted: text(storedStats.passesCompleted),
    });
    setMessage("Editing that debrief. Save to apply the changes.");
  };

  const cancelEditDebrief = () => {
    setEditingId(null);
    clearForm();
    setMessage(null);
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

    const standoutPlayerNames = orderedStandoutPlayers
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
      const res = await apiFetch(
        editingId === null ? "/api/debrief" : `/api/debrief?id=${encodeURIComponent(editingId)}`,
        {
          method: editingId === null ? "POST" : "PATCH",
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
          // Sliced to the goals the scoreline says were scored, so a minute left over from a score
          // that has since been corrected cannot travel with the debrief.
          goalMinutes: goalMinutes.slice(0, goalSlots),
          concededMinutes: concededMinutes.slice(0, concededSlots),
          // Sent as typed and validated server side, in the one place that owns those rules.
          matchStats,
          weaknessIdentified,
          managerReflection,
          dynamicPrompts,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to submit debrief.");
      }

      setMessage(editingId === null ? "Match debrief saved." : "Debrief updated.");
      // The press only follow a match the desk thinks is worth a word, and only sometimes. An edit never
      // re-asks: the question belongs to the match, not to the form.
      if (editingId === null && data.media?.asked && typeof data.eventId === "string") {
        setMediaPrompt({
          eventId: data.eventId,
          prompt: data.media.prompt ?? "The media want a word.",
          subject: data.media.subject ?? "",
          opponent: opponentLabel,
        });
        setMediaComment("");
      }
      // The debrief is a record now, so the working note goes.
      clearDebriefDraft(careerId, MATCH_DRAFT_SURFACE);
      clearForm();
      setEditingId(null);
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
      const res = await apiFetch(
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

  /**
   * Answers the press, or refuses.
   *
   * Both answers are recorded. A refusal is not the absence of an answer: the paper reports it in the
   * manager's name, so "he said nothing" has to be something he actually did.
   */
  const submitMediaComment = async (refused: boolean) => {
    if (!careerId || !mediaPrompt) return;
    setMediaBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/media-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          careerId,
          debriefEventId: mediaPrompt.eventId,
          opponent: mediaPrompt.opponent,
          subject: mediaPrompt.subject,
          comment: refused ? "" : mediaComment.trim(),
          refused,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not record that comment.");
      }
      setMediaPrompt(null);
      setMediaComment("");
      setMessage(
        refused
          ? "No comment recorded. The paper will say so."
          : "Comment recorded. It will appear in the match report."
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setMediaBusy(false);
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
          <GroupDebriefPanel
            careerId={careerId}
            seasonNumber={seasonNumber}
            leagueTeams={leagueTeams}
          />
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

          {overperformance && (
            <div
              role="status"
              className="mb-6 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
            >
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                {overperformance.title}
              </span>
              <p className="font-sans text-xs text-amber-900 dark:text-amber-100">{overperformance.text}</p>
              <p className="w-full font-sans text-[10px] text-amber-800/80 dark:text-amber-200/70">
                Worked out from the match figures you logged. It clears itself as soon as a result goes
                your way.
              </p>
            </div>
          )}

          {/*
            The press, when they come looking.

            Optional, and it has to look optional: a manager who does not want to answer should be able to
            dismiss the whole thing in one press without feeling he has lost something. Saying nothing is
            recorded as a refusal, which the paper then reports in the manager's own name, and that is a
            different thing from never being asked.
          */}
          {mediaPrompt && (
            <div
              role="status"
              className="mb-6 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-[0.16em] text-[#E11D48] dark:text-[#FF8C7A]">
                  The media
                </span>
                <span className="font-sub text-micro uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Optional
                </span>
              </div>
              <p className="mt-2 max-w-prose font-sans text-sm text-slate-700 dark:text-slate-200">
                {mediaPrompt.prompt}
              </p>
              <label className="mt-3 block">
                <span className="sr-only">Your comment to the media</span>
                <textarea
                  value={mediaComment}
                  onChange={(event) => setMediaComment(event.target.value)}
                  rows={3}
                  maxLength={280}
                  placeholder="Say what you like. It goes in the paper as a quote."
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 font-sans text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-600"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={mediaBusy || mediaComment.trim().length === 0}
                  onClick={() => void submitMediaComment(false)}
                  className="inline-flex min-h-10 items-center rounded-xl bg-[#E11D48] px-4 font-sub text-label font-semibold uppercase tracking-[0.12em] text-white transition-colors duration-200 ease-[var(--ease-brand)] hover:bg-[#FF8C7A] disabled:opacity-50 cursor-pointer"
                >
                  {mediaBusy ? "Sending..." : "Give the quote"}
                </button>
                <button
                  type="button"
                  disabled={mediaBusy}
                  onClick={() => void submitMediaComment(true)}
                  className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 font-sub text-label font-semibold uppercase tracking-[0.12em] text-slate-600 transition-colors duration-200 ease-[var(--ease-brand)] hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                >
                  No comment
                </button>
                <span className="font-sans text-micro text-slate-400 dark:text-slate-500">
                  Say nothing and the paper will say you said nothing.
                </span>
              </div>
            </div>
          )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Debrief Entry Form */}
        <form onSubmit={handleSubmit} data-tour="debrief-form" className="lg:col-span-2 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
              {editingId === null ? "Log a match" : "Edit debrief"}
            </h2>
            {editingId !== null && (
              <button
                type="button"
                onClick={cancelEditDebrief}
                className="inline-flex min-h-10 items-center rounded-lg px-3 font-sub text-[10px] uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
              >
                Cancel edit
              </button>
            )}
          </div>

          {/* Opponent & Competition Row */}
          <div data-tour="debrief-meta" className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label
                  htmlFor="debrief-opponent"
                  className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                >
                  Opponent
                </label>
                <label className="flex items-center gap-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Sort
                  <select
                    aria-label="Sort the club list"
                    value={opponentSort}
                    onChange={(e) => setOpponentSort(opponentSortFrom(e.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-1 font-sub text-[10px] uppercase tracking-wider text-slate-600 focus:outline-none focus:border-[#E11D48] cursor-pointer dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                  >
                    {OPPONENT_SORT_ORDERS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
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
                {orderedTeams.map((team) => (
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
                {/*
                  The career's own competitions, because the save names his division and the country that
                  division belongs to decides which cups exist. The generic labels are the fallback for a
                  career whose competition rows the save cannot name, and a value already on the draft that
                  is in neither list is kept, so editing an old debrief cannot silently change its
                  competition to something else.
                */}
                {competitionOptions.map((option) => (
                  <option key={option.name} value={option.name}>
                    {option.name}
                  </option>
                ))}
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
            When the goals came. Offered only for goals the scoreline already says were scored, so the
            form never asks about a goal that did not happen, and a goalless match shows nothing here.
            Entirely optional, and a blank box means the minute was not recorded rather than nil.
          */}
          {(goalSlots > 0 || concededSlots > 0) && (
            <div data-tour="debrief-goal-times" className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  When the goals came
                </span>
                <span className="font-sub text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  optional · minutes
                </span>
              </div>
              <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                The minute each goal went in, if you have it. A late winner and an early one are the
                same result on the scoresheet and a very different story.
              </p>

              {goalSlots > 0 && (
                <div className="space-y-2">
                  <span className="block truncate text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {clubName || "Your club"}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: goalSlots }, (_, index) => (
                      <div key={index} className="w-20">
                        <TableNumberBox
                          id={`debrief-goal-minute-${index}`}
                          label={`Goal ${index + 1}`}
                          ariaLabel={`Minute of goal ${index + 1} for ${clubName || "your club"}`}
                          value={goalMinutes[index] ?? ""}
                          onChange={(value) => setMinuteAt(setGoalMinutes, index, value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {concededSlots > 0 && (
                <div className="space-y-2">
                  <span className="block truncate text-[10px] font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {opponentLabel || "Opponent"}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: concededSlots }, (_, index) => (
                      <div key={index} className="w-20">
                        <TableNumberBox
                          id={`debrief-conceded-minute-${index}`}
                          label={`Goal ${index + 1}`}
                          ariaLabel={`Minute of goal ${index + 1} for ${opponentLabel || "the opponent"}`}
                          value={concededMinutes[index] ?? ""}
                          onChange={(value) => setMinuteAt(setConcededMinutes, index, value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {timingCapReached && (
                <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                  Timings can be recorded for the first {MAX_TIMING_SLOTS} goals only.
                </p>
              )}
            </div>
          )}

          {/*
            What you saw after the match. Entirely optional, and entirely yours: the save holds no match
            events at all, so this is the only possible source. The four figures under the boxes are
            worked out from what is entered here plus the scoreline, and nothing else.
          */}
          <div data-tour="debrief-match-stats" className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Match figures
              </span>
              <span className="font-sub text-[10px] uppercase text-slate-500 dark:text-slate-400">
                optional · yours
              </span>
            </div>
            <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
              What you can see for yourself after the match. Hover a box to see exactly what to count.
              The more you fill in, the more the figures below can say.
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {MATCH_STAT_FIELDS.map((field) => (
                <label key={field.key} className="block" title={field.hint}>
                  <span className="block font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {field.label}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="–"
                    value={matchStats[field.key]}
                    onChange={(event) =>
                      setMatchStats((current) => ({
                        ...current,
                        [field.key]: event.target.value.replace(/\D/g, "").slice(0, 4),
                      }))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white text-center font-sub text-sm font-bold tabular-nums text-slate-900 placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:border-[#E11D48] focus:ring-2 focus:ring-[#E11D48]/20 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600"
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatReadout
                label="Expected goals"
                value={expected === null ? "—" : expected.toFixed(2)}
                note={
                  expected === null
                    ? "Needs inside box and big chances"
                    : "TouchlineOS model, not a save figure"
                }
              />
              <StatReadout
                label="Finishing"
                value={finishing === null ? "—" : `${finishing > 0 ? "+" : ""}${finishing.toFixed(2)}`}
                note={
                  finishingWord === null ? "Goals minus expected goals" : `${finishingWord.label} · goals minus expected goals`
                }
              />
              <StatReadout
                label="Outside box"
                value={outsideBox === null ? "—" : String(outsideBox)}
                note="Shots minus shots inside the box"
              />
              <StatReadout
                label="Clean sheet"
                value={
                  ourScoreInput === "" && theirScoreInput === ""
                    ? "—"
                    : cleanSheet
                      ? "Yes"
                      : "No"
                }
                note={
                  ourScoreInput === "" && theirScoreInput === ""
                    ? "Needs the scoreline"
                    : "From the scoreline, not a figure to enter"
                }
              />
            </div>

            <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
              A big chance is usually also a shot from inside the box, so the two terms overlap and
              expected goals reads a little high. Counting only big chances would understate a side that
              creates a lot of ordinary box shots, which is the more common manager.
            </p>
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

            <div data-tour="debrief-standouts">
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <label
                  className="font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                  title="(can select more than one)"
                >
                  Standout Performers
                </label>
                <div className="flex items-center gap-2">
                  {standoutPlayerIds.length > 0 && (
                    <span className="font-sub text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                      {standoutPlayerIds.length} selected
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5">
                    {([["POSITION", "Position"], ["PICKED", "My picks"]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStandoutSort(value)}
                        aria-pressed={standoutSort === value}
                        title={
                          value === "POSITION"
                            ? "Order chips goalkeeper to striker"
                            : "Order chips by the order you picked them"
                        }
                        className={`px-2 py-0.5 rounded font-sub text-[10px] font-bold uppercase cursor-pointer transition-colors ${
                          standoutSort === value
                            ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mb-1.5 text-[10px] font-sub text-slate-500 dark:text-slate-400">
                (can select more than one)
              </p>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 flex flex-wrap gap-1.5">
                {players.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic p-2">
                    No squad synced yet - sync a save to pick performers.
                  </p>
                ) : (
                  orderedStandoutPlayers.map((p) => {
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

            <div data-tour="debrief-contributions" className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 space-y-3">
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
                  <label
                    className="block text-[10px] font-sub font-bold uppercase text-slate-500 dark:text-slate-400 mb-1"
                    title="(Optional) A goal can be unassisted, or scored off a defender error."
                  >
                    Assists <span className="font-normal normal-case">(Optional)</span>
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

                <div data-tour="debrief-notes">
                  <label
                    className="block font-sub text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                    title="(Optional) Something you noticed that went wrong, so you can check it against the next match."
                  >
                    Weakness you spotted <span className="font-normal normal-case">(Optional)</span>
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
        <div data-tour="debrief-history" className="h-fit bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Your debriefs ({pastDebriefs.length})
            </h2>
            {/* The star filter, and the anchor the tour points at: it is the one control here that
                changes what the list shows rather than what the form writes. */}
            <div data-tour="debrief-starred" className="flex items-center gap-1.5">
              {(["ALL", "STARRED"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStarFilter(mode)}
                  aria-pressed={starFilter === mode}
                  className={`inline-flex min-h-10 items-center rounded-lg border px-2.5 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors duration-200 ease-[var(--ease-brand)] cursor-pointer ${
                    starFilter === mode
                      ? "border-[#E11D48]/40 bg-[#E11D48]/10 text-[#E11D48] dark:text-[#FF8C7A]"
                      : "border-slate-200 text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {mode === "ALL" ? "All" : `★ Memorable (${starredIds.length})`}
                </button>
              ))}
            </div>
          </div>

          <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Open any match for the full record, and keep the ones worth remembering.
          </p>

          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {visibleDebriefs.length > 0 ? (
              visibleDebriefs.map((evt) => {
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
                  >                    {/*
                      The opponent gets its own line and the controls get the next one.

                      They used to share a row, with the name on a `flex-1` and the controls on a `shrink-0`
                      beside it. That holds only while the buttons fit: five controls, a star and a score pill
                      come to a little over 290px of intrinsic width, and a `shrink-0` block that does not fit
                      cannot wrap - it runs out of the card, and the card's own `overflow-y-auto` clips the
                      last button off. A row per line cannot do that, and the controls wrap among themselves
                      when the column is narrow.
                    */}
                    <div className="text-xs font-sub font-bold uppercase break-words text-slate-900 dark:text-slate-100">
                      vs {payload.opponent || "Unnamed opponent"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void toggleDebriefStar(evt.id)}
                          aria-pressed={starredIds.includes(evt.id)}
                          aria-label={
                            starredIds.includes(evt.id)
                              ? `Remove the star from the debrief against ${payload.opponent || "an unnamed opponent"}`
                              : `Star the debrief against ${payload.opponent || "an unnamed opponent"}`
                          }
                          title={starredIds.includes(evt.id) ? "Unstar this match" : "Keep this match as memorable"}
                          className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg px-2 text-sm transition-colors duration-200 ease-[var(--ease-brand)] cursor-pointer ${
                            starredIds.includes(evt.id)
                              ? "text-[#E11D48] hover:bg-[#E11D48]/10 dark:text-[#FF8C7A]"
                              : "text-slate-300 hover:bg-slate-200 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                          }`}
                        >
                          <span aria-hidden="true">{starredIds.includes(evt.id) ? "★" : "☆"}</span>
                        </button>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] tabular-nums ${
                          payload.result === "WIN" ? "bg-emerald-500/15 text-emerald-600" :
                          payload.result === "LOSS" ? "bg-rose-500/15 text-rose-600" : "bg-amber-500/15 text-amber-600"
                        }`}>
                          {payload.scoreline || "0-0"} · {resultLabel(payload.result || "DRAW")}
                        </span>
                        <button
                          type="button"
                          onClick={() => void openDebriefDetail(evt.id)}
                          aria-label={`Open the full record of the match against ${payload.opponent || "an unnamed opponent"}`}
                          className="inline-flex min-h-10 items-center rounded-lg px-2.5 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditDebrief(evt)}
                          aria-label={`Edit the debrief against ${payload.opponent || "an unnamed opponent"}`}
                          className="inline-flex min-h-10 items-center rounded-lg px-2.5 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
                        >
                          {editingId === evt.id ? "Editing" : "Edit"}
                        </button>
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
                {starFilter === "STARRED"
                  ? "No match has been kept yet. Star one and it stays here."
                  : "Nothing logged yet. Fill in the form and your match history builds up here."}
              </p>
            )}
          </div>
        </div>
      </div>
        </>
      )}

      {detail && (
        <DebriefDetailModal
          event={pastDebriefs.find((evt) => evt.id === detail.eventId) ?? null}
          namesById={playerNamesById}
          article={detail.article}
          articleLoaded={detail.articleLoaded}
          starred={starredIds.includes(detail.eventId)}
          onToggleStar={() => void toggleDebriefStar(detail.eventId)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * Everything the manager recorded about one match, in one place.
 *
 * The list row is a summary on purpose: a season of matches read as a wall of prose is worse than a list.
 * This is where the detail he actually typed lives, including the parts that never fitted a row: the goal
 * minutes, the shooting figures, his tactical mark, his reflection, and the newspaper report the desk wrote
 * from it.
 */
/**
 * A minute list from a stored payload, as text.
 *
 * Why this is not a straight `.map`: a debrief payload is written by whichever version of the form was
 * running at the time, and an older or hand-edited row can hold a comma-separated string where the current
 * shape holds numbers. Reading a detail view is not a place to throw, so anything unrecognisable reads as
 * "none" instead of taking the screen down with it.
 */
function minuteList(value: unknown): string {
  if (Array.isArray(value)) {
    const minutes = value.filter((minute) => minute !== null && minute !== undefined && `${minute}`.trim() !== "");
    return minutes.length > 0 ? minutes.map((minute) => `${minute}'`).join(", ") : "none";
  }
  if (typeof value === "string" && value.trim() !== "") {
    const minutes = value
      .split(/[,\s]+/)
      .map((minute) => minute.trim())
      .filter((minute) => minute !== "");
    return minutes.length > 0 ? minutes.map((minute) => (minute.endsWith("'") ? minute : `${minute}'`)).join(", ") : "none";
  }
  return "none";
}

function DebriefDetailModal({
  event,
  namesById,
  article,
  articleLoaded,
  starred,
  onToggleStar,
  onClose,
}: {
  event: ParsedCareerEvent | null;
  namesById: Record<string, string>;
  article: { headline: string; body: string; quote: string | null } | null;
  articleLoaded: boolean;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The page behind the dialog is held still, so the record cannot be scrolled off the screen it was opened on.
  useScrollLock(event !== null);

  if (!event) return null;

  let payload: DebriefHistory = {};
  try {
    payload = (typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload) || {};
  } catch {
    payload = {};
  }

  const standouts = payload.standoutPlayerNames?.length
    ? payload.standoutPlayerNames
    : payload.standoutPlayerName && payload.standoutPlayerName !== "None Selected"
      ? [payload.standoutPlayerName]
      : [];
  const contributions = payload.contributions ?? [];
  const stats = payload.matchStats ?? null;
  const rows: Array<{ label: string; value: string }> = [
    { label: "Match date", value: payload.matchDate ?? "not recorded" },
    { label: "Competition", value: payload.competition ?? "not recorded" },
    { label: "Venue", value: payload.venue ? venueLabel(payload.venue) : "not recorded" },
    {
      label: "Scoreline",
      value: `${payload.scoreline ?? "0-0"} (${resultLabel(payload.result ?? "DRAW")})`,
    },
    {
      label: "Tactical adherence",
      value:
        typeof payload.tacticalAdherence === "number" ? `${payload.tacticalAdherence} of 5` : "not recorded",
    },
    {
      label: "Goals we timed",
      value: minuteList(payload.goalMinutes),
    },
    {
      label: "Goals they timed",
      value: minuteList(payload.concededMinutes),
    },
    {
      label: "Shots",
      value: stats
        ? `${stats.shots ?? 0} total, ${stats.shotsInsideBox ?? 0} in the box, ${stats.bigChances ?? 0} big`
        : "not recorded",
    },
    {
      label: "Possession",
      value: typeof stats?.possession === "number" ? `${stats.possession}%` : "not recorded",
    },
  ];

  return portal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-overlay-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="debrief-detail-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl animate-panel-in dark:border-slate-800 dark:bg-slate-900/95"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-sub text-label font-bold uppercase tracking-[0.16em] text-[#E11D48] dark:text-[#FF8C7A]">
              Match record
            </span>
            <h2
              id="debrief-detail-title"
              className="mt-1 font-heading text-lg leading-snug text-slate-900 dark:text-slate-50"
            >
              vs {payload.opponent || "Unnamed opponent"}
            </h2>
            <p className="mt-1 font-sub text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {[payload.matchDate, payload.competition].filter(Boolean).join("  ·  ") || "No date recorded"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleStar}
              aria-pressed={starred}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 font-sub text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                starred
                  ? "border-[#E11D48]/40 bg-[#E11D48]/10 text-[#E11D48] dark:text-[#FF8C7A]"
                  : "border-slate-200 text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              <span aria-hidden="true">{starred ? "★" : "☆"}</span>
              {starred ? "Memorable" : "Keep"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-900 cursor-pointer dark:hover:text-slate-100"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {row.label}
              </dt>
              <dd className="font-sans text-xs text-slate-700 tabular-nums dark:text-slate-200">{row.value}</dd>
            </div>
          ))}
        </dl>

        {contributions.length > 0 && (
          <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Goals and assists you logged
            </h3>
            <ul className="mt-2 space-y-1">
              {contributions.map((entry) => (
                <li key={entry.playerId} className="flex items-baseline justify-between gap-3">
                  <span className="font-sans text-xs text-slate-700 dark:text-slate-200">
                    {entry.playerName}
                    {namesById[entry.playerId] && namesById[entry.playerId] !== entry.playerName
                      ? ` (${namesById[entry.playerId]})`
                      : ""}
                  </span>
                  <span className="font-sans text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {[
                      entry.goals > 0 ? `${entry.goals} ${entry.goals === 1 ? "goal" : "goals"}` : null,
                      entry.assists > 0 ? `${entry.assists} ${entry.assists === 1 ? "assist" : "assists"}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(standouts.length > 0 || payload.weaknessIdentified || payload.managerReflection) && (
          <section className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            {standouts.length > 0 && (
              <p className="font-sans text-xs text-slate-700 dark:text-slate-200">
                <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Singled out:{" "}
                </span>
                {standouts.join(", ")}
              </p>
            )}
            {payload.weaknessIdentified && (
              <p className="font-sans text-xs text-slate-700 dark:text-slate-200">
                <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Weakness noted:{" "}
                </span>
                {payload.weaknessIdentified}
              </p>
            )}
            {payload.managerReflection && (
              <p className="font-sans text-xs italic leading-relaxed text-slate-600 dark:text-slate-300">
                {payload.managerReflection}
              </p>
            )}
          </section>
        )}

        {payload.leagueSnapshot &&
          (payload.leagueSnapshot.ownPosition || payload.leagueSnapshot.opponentPosition) && (
            <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Table at kick-off, as you read it
              </h3>
              <p className="mt-1.5 font-sans text-xs text-slate-600 tabular-nums dark:text-slate-300">
                {describePlacing(
                  payload.leagueSnapshot.ownPosition,
                  payload.leagueSnapshot.ownPoints
                ) ?? "us: not logged"}{"  ·  "}
                {describePlacing(
                  payload.leagueSnapshot.opponentPosition,
                  payload.leagueSnapshot.opponentPoints
                ) ?? "them: not logged"}
              </p>
            </section>
          )}

        {payload.dynamicPrompts && payload.dynamicPrompts.length > 0 && (
          <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Your answers to the prompts
            </h3>
            <ul className="mt-2 space-y-1.5">
              {payload.dynamicPrompts.map((prompt, index) => (
                <li key={index} className="font-sans text-xs text-slate-700 dark:text-slate-200">
                  {prompt.question ? (
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      {prompt.question}
                    </span>
                  ) : null}
                  {prompt.answer}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The report the desk wrote about this match, matched by id rather than guessed at. */}
        <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            What the paper said
          </h3>
          {!articleLoaded ? (
            <p className="mt-1.5 font-sans text-xs text-slate-400 dark:text-slate-500">
              Looking for the report…
            </p>
          ) : article ? (
            <div className="mt-2 space-y-1.5">
              <p className="font-heading text-sm leading-snug text-slate-900 dark:text-slate-50">
                {article.headline}
              </p>
              <p className="font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {article.body}
              </p>
              {article.quote ? (
                <p className="border-l-2 border-slate-300 pl-2.5 font-sans text-xs italic text-slate-600 dark:border-slate-600 dark:text-slate-300">
                  &ldquo;{article.quote}&rdquo;
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1.5 font-sans text-xs text-slate-400 dark:text-slate-500">
              No report was written about this match. The desk writes from the debrief, so one appears in the
              paper once this record is on file.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}