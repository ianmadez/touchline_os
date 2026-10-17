/**
 * The shapes the review engine speaks in.
 *
 * The engine is a pure function over stored data: the same matches and the same career state produce the same
 * Review, character for character, with no clock and no network. That is why everything here is a plain value
 * with no class and no behaviour: the composition happens in `index.ts` and nowhere else.
 *
 * ONE RULE THAT SHAPES EVERY FIELD. A match the manager logged with no figures is not a match with zeroes. Every
 * numeric field is nullable, `hasFigures` says whether anything was counted at all, and a finding that needs a
 * figure is omitted rather than computed from a zero. A block of group logged matches therefore reads as
 * scorelines and nothing more, which is exactly what was recorded.
 */
import type { FormationStamp } from "../events/tactics-stamp";

/** What the review should read: one saved block, or the newest matches in a range. */
export type ReviewRequest =
  | { kind: "BLOCK"; blockId: string }
  | { kind: "WINDOW"; count?: number | null; from?: string | null; to?: string | null };

/** How much data a finding stands on. Counts, never a percentage. */
export type Strength = "THIN" | "BUILDING" | "SOLID";

/** Whether a finding reads as good, bad, or simply a shape of the data. */
export type FindingTone = "GOOD" | "BAD" | "NEUTRAL";

/** Where a match came from. A block row carries no figures; a per match debrief carries whatever was logged. */
export type MatchSource = "DEBRIEF" | "BLOCK";

/** The figures a review reasons about. Every one of them may be absent. */
export interface MatchFigures {
  /** The game's own figure when the manager logged it, the model's estimate otherwise. */
  expectedGoals: number | null;
  shots: number | null;
  shotsInsideBox: number | null;
  possession: number | null;
  passesCompleted: number | null;
}

/** One fixture, as the review sees it. */
export interface ReviewMatch {
  /** The event id for a debrief, or the block's own mirror id for a block row. Stable across regenerations. */
  id: string;
  /** The in-game date, when one was recorded. Null is not a placeholder: it is why two matches cannot be merged. */
  date: string | null;
  opponent: string;
  /** The opponent with case, accents and punctuation folded away, so "Brighton & Hove" matches "brighton and hove". */
  foldedOpponent: string;
  venue: "HOME" | "AWAY" | "NEUTRAL" | null;
  competition: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  points: 0 | 1 | 3 | null;
  formation: FormationStamp | null;
  figures: MatchFigures;
  /** Whether any figure was recorded at all. False for a block row, and for a debrief with only a scoreline. */
  hasFigures: boolean;
  goalMinutes: number[];
  concededMinutes: number[];
  weakness: string | null;
  standouts: string[];
  /** Goals and assists as the manager logged them, for the scoring spread. */
  contributions: Array<{ playerName: string; goals: number; assists: number }>;
  source: MatchSource;
}

/** One thing the review sees, said without claiming a cause. */
export interface Finding {
  id: string;
  tone: FindingTone;
  /** One sentence. No causal verbs: see the banned list in the test. */
  headline: string;
  /** The figures behind it, in words. */
  detail: string;
  strength: Strength;
  /** True when the finding needed a figure that only a scanned or typed debrief can supply. */
  needsFigures: boolean;
  /** The matches it rests on, so a reader can go and look. */
  matchIds: string[];
  /** What else could explain this. Every finding lists at least one. */
  confounds: string[];
}

/** What accepting an option would create, in the manager's words. */
export interface ReviewOption {
  id: string;
  label: string;
  /** Why it is being offered, with the count that supports it. */
  rationale: string;
  /** What it would create if taken. */
  creates: string;
  /** Short labels for the mechanics. Never an action the manager has not asked for. */
  chips: string[];
  /** The toggle that blocks it, when one does. Named on screen so the filtered state can explain itself. */
  blockedBy: RulesToggleId | null;
}

/** The two matches the review sets against each other. */
export interface ReviewContrast {
  bestId: string;
  bestLabel: string;
  worstId: string;
  worstLabel: string;
  /** One sentence joining them, with both figures in it. */
  line: string;
}

/**
 * What the contrast is drawn on.
 *
 * Two passes, because a window of group logged matches has no figures to contrast: the scorelines still say one
 * match went better than another, so the comparison falls back to the result rather than disappearing.
 */
export type ContrastBasis = "FIGURES" | "RESULT";

export interface ReviewContrastSummary extends ReviewContrast {
  basis: ContrastBasis;
}

/** The eight sections of the expanded report, in the order they are read. */
export type ReviewSectionId =
  | "WINDOW"
  | "NUMBERS"
  | "SCORES"
  | "CONTRAST"
  | "PREVIOUS"
  | "NOT_CLAIMING"
  | "RESTS_ON"
  | "QUESTIONS";

export interface ReviewSection {
  id: ReviewSectionId;
  title: string;
  paragraphs: string[];
  findings: Finding[];
  /** Label and value pairs, used by "What this rests on". */
  counts: Array<{ label: string; value: string }>;
}

/** The band a block was judged against, carried alongside a block review so the two never disagree. */
export interface ReviewBlockBand {
  id: string;
  seasonNumber: number;
  blockIndex: number;
  verdict: string;
  points: number;
  possible: number;
  targetMin: number;
  targetMax: number;
  dreamPoints: number;
  concernPoints: number;
  tablePosition: number | null;
  /** The shape recorded on most of the block's matches, or null when none of them recorded one. */
  formationLabel: string | null;
}

/** The three counts that say how much of the review rests on what. */
export interface ReviewResting {
  withFigures: number;
  scorelineOnly: number;
  notRecorded: number;
}

/** Everything the screen needs, computed in one pass. */
export interface Review {
  /** The block id, or `window:<from>:<to>`, so a decision and a review always refer to the same thing. */
  key: string;
  kind: "BLOCK" | "WINDOW";
  matches: ReviewMatch[];
  window: { from: string | null; to: string | null; count: number };
  record: {
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    points: number;
    possible: number;
    played: number;
  };
  /** How many fixtures were logged both ways and counted once. Zero is the normal answer and prints nothing. */
  mergedBothWays: number;
  contrast: ReviewContrastSummary | null;
  findings: Finding[];
  options: ReviewOption[];
  sections: ReviewSection[];
  block: ReviewBlockBand | null;
  /** True when fewer than five matches have figures, so every strength label is THIN or BUILDING. */
  thin: boolean;
  resting: ReviewResting;
  /** The toggles that left nothing to offer, so the card can say why it has no decision step. */
  blockedBy: RulesToggleId[];
}

/** The four rules toggles the manager keeps. They only ever remove options. */
export type RulesToggleId =
  | "keepFormationFamily"
  | "neverRotateKeyPlayers"
  | "fixedPointsBand"
  | "preferYouthMinutes";

export interface RulesProfile {
  toggles: Record<RulesToggleId, boolean>;
  notes: string | null;
}

/**
 * Everything off.
 *
 * A toggle that is off never blocks anything, so an untouched profile offers the full set. That is the opposite
 * of a safety default on purpose: the rules exist to keep the manager inside his own decisions, and he has not
 * made any until he turns one on.
 */
export const DEFAULT_RULES_PROFILE: RulesProfile = {
  toggles: {
    keepFormationFamily: false,
    neverRotateKeyPlayers: false,
    fixedPointsBand: false,
    preferYouthMinutes: false,
  },
  notes: null,
};

/** The name a toggle goes by on screen, so a blocked option can point at it. */
export const RULES_TOGGLE_LABELS: Record<RulesToggleId, string> = {
  keepFormationFamily: "Keep the formation family",
  neverRotateKeyPlayers: "Never rotate key players",
  fixedPointsBand: "Keep the points band fixed",
  preferYouthMinutes: "Prefer minutes for young players",
};

/**
 * The career state a review is allowed to read.
 *
 * Passed in rather than fetched, so the engine stays pure and a test can hold every input still.
 */
export interface ReviewContext {
  /** The manager's own objective for the season, when one has a league position on it. */
  objective: { targetPosition: number | null } | null;
  /** Where the club sits in the table now, as the save reports it. Null means the target has no figure behind it. */
  currentPosition: number | null;
  /** The block immediately before the one under review, same season, already summarised. */
  previousBlock: ReviewBlockBand | null;
  /** Players the manager has marked as key or untouchable, by the name the squad shows. */
  keyPlayerNames: string[];
  /** Ages by player name, for the youth rule. A name missing from here is treated as unknown, never as young. */
  playerAges: Record<string, number | null>;
  /** How many formations the save holds, so a shape option is only offered when there is something to change to. */
  savedFormationCount: number;
  profile: RulesProfile;
}
