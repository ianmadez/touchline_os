/**
 * The news desk.
 *
 * A PURE FUNCTION over facts the app already holds, and everything here follows from two rules.
 *
 * THE PAPER CANNOT KNOW WHAT THE APP KNOWS. The save holds ratings, potentials and deltas, and the manager
 * can see them in the game, but a newspaper cannot print them: no reporter has a copy of the database. So
 * the prose is the prose of football journalism - what was seen, what was said, what is understood to be
 * true - and the figures the app used to decide a story exists are shown in the story's own "why this ran"
 * note instead, where they belong to the app rather than to a fictional reporter. Quoting "potential 95" in
 * a news story was the worst thing this desk did, and it is gone.
 *
 * EVERY STORY HAS TO MAKE SENSE TO SOMEONE WHO IS NOT THE APP. The first version of this read like a machine
 * that had been told the answer: "A. Aznou Has Slipped" with a body about a fall, from a rating the reader
 * cannot see and a subject the reader cannot identify. Nobody reading that knows what slipped, or what it
 * slipped from. So a story now names the thing it is about in plain football terms - his form, his place in
 * the side, his minutes, his goals - and explains why anyone would care before it says what it thinks.
 *
 * TWO SIZES OF STORY. The card carries the short read: two or three sentences, the whole of the news but
 * none of the trimmings. The ARTICLE is what the reader gets when he opens it, and it is assembled here in
 * one place - the card's own summary, then the paragraph this particular story earns, then a closing line
 * built from facts that are true of this career rather than of careers in general. Nothing in it is padding,
 * and nothing in it repeats the card word for word.
 *
 * VARIETY IS STRUCTURAL. Twenty two story types, each guarded by its own condition, each carrying several
 * interchangeable headline frames, body frames and closing frames chosen from the item's own id. Two
 * different story types never read alike, and the same type reads differently in the next save.
 *
 * NOTHING IS RANDOM. `pick()` hashes the item's id, so a reload shows the same paper, a new in-game day
 * reshuffles the phrasing because the id changed, and the checks can assert on exact output.
 *
 * RANKING, not filtering. Everything whose condition holds is written, then ordered by significance,
 * thinned so no more than three stories share a category, and interleaved so no two neighbours are the same
 * kind. The screen decides how much of the paper to print; the archive decides how long it is kept.
 */

import { bylineFor, type OutletStance, type PressByline } from "./outlets";
import { normaliseNote, weaknessFamily } from "../events/weakness-family";
import { describeTimeOut, injuryBand, type InjuryBand } from "../squad/injury";
import { momentOf, phasePhrase, seasonPhase, type SeasonProgress } from "./moment";
import { formatExpectedGoals } from "../ui/format";
import {
  effectiveExpectedGoals,
  expectedGoalsSource,
  FINISHING_STORY_EDGE,
} from "../events/match-stats";

/**
 * Which revision of the desk's VOICE wrote a story.
 *
 * Bump this whenever the copy itself is rewritten rather than added to. A story is printed once and kept -
 * that is what makes the paper a paper - but a manager should not be left reading wording that has been
 * fixed, so the archive reprints anything stamped with an older revision and leaves saved and dismissed
 * stories exactly as they were. The number is here, beside the copy it describes, because "the desk was
 * rewritten" is an editorial call that cannot be computed from the code.
 *
 * 13 carries one change: the finishing story now argues from the game's own expected goals when a debrief
 * has one, since a scanned figure beats the app's two-weight model, and it names which of the two it used.
 * Every debrief logged before the scanner existed has no such figure and prints exactly as it did.
 *
 * 14 carries one change: the words "big chance" are gone from the desk, because nothing counts them any more.
 * The finishing story's evidence line now says when its figure was estimated from an older row's counts
 * rather than read off the game, which is the only row that ever reaches the model.
 *
 * 15 is the refurbishment: match reports built from how the match unfolded, scores said the way football
 * says them, the press question printed with the answer, columns that argue from the numbers, closing lines
 * only when they add a fact, the club and manager shortened after the first mention, and the new pieces
 * (ratings, the window, the festive fixtures, the awards and the light ones). Stories already on the paper
 * are rewritten in place rather than cleared - see `reprintOutdatedCopy` in the archive.
 *
 * `npm run news:test` fails when the copy changes and this number does not, so a push that changes the
 * wording always reaches the papers already printed.
 */
export const NEWS_COPY_VERSION = 15;

/** How a story's subject colours the card. Not a red/green light: a paper has good and bad news. */
export type NewsTone = "GOOD" | "NEUTRAL" | "CONCERN";

/**
 * What a story is ABOUT, which is what decides the closing paragraphs it may carry.
 *
 * The distinction the first version got wrong in the other direction: it asked whether a story happened on a
 * pitch (MATCH) or was a standing fact (STANDING), and then offered every conclusion to both. A story's topic
 * is what a closing line has to match - a wage bill is not closed by a league position, however much data
 * there is about the table.
 *
 * TROPHY and MILESTONE are additions to the ten topics a story can be: the desk writes a silverware piece and
 * a manager's career milestone, and neither is honestly one of the other ten.
 */
export type StoryKind =
  | "MATCH"
  | "FORM"
  | "TABLE"
  | "FINANCE"
  | "CONTRACT"
  | "SQUAD"
  | "PLAYER"
  | "TEAMNEWS"
  | "OPINION"
  | "TRANSFER"
  | "TROPHY"
  | "MILESTONE";

export interface NewsItem {
  /** Stable and derived from the evidence, so it is published once and never duplicates in the archive. */
  id: string;
  /**
   * Whether the story happened on a match day or is a standing fact about the club.
   *
   * Stored with the story rather than recomputed on read. A published row has to reprint in the shape it
   * was written in, and a rule that changes later must not silently re-close a story from last month.
   */
  kind: StoryKind;
  /** The category the card is filed under, in the language of a sports desk. */
  category: string;
  tone: NewsTone;
  headline: string;
  /** The short read on the card: two or three sentences, the whole of the news and none of the trimmings. */
  body: string;
  /**
   * The long-form piece, as paragraphs, for the reader who opened the story.
   *
   * First paragraph is the card's own summary, so a reader who opened it never has to be told the news twice,
   * and the rest is written by the desk for this story and this career. Never empty: a story with nothing
   * more to say carries its summary alone rather than a paragraph of padding.
   */
  article: string[];
  /**
   * Who filed it, from the authored fictional press library.
   *
   * Null on the short notices the desk files itself: a squad-depth line is the app noticing something, and
   * putting a reporter's name on it would dress a note up as journalism.
   */
  byline: PressByline | null;
  /**
   * The line the paper takes, when the story is one the paper has a view in.
   *
   * Null on everything the desk reports rather than opines, which is most of the paper. Stored beside the
   * story rather than looked up again on read, so a piece always reprints in the voice it was written in.
   */
  stance: OutletStance | null;
  /**
   * The app's own note of the figures behind the story.
   *
   * Shown UNDER the story and labelled as the app's reasoning, never as the reporter's knowledge. This is
   * where a rating, a potential or a delta is allowed to appear.
   */
  evidence: string[];
  /** Players the story is about, so the screen can show a face rather than a stock image. */
  playerNames: string[];
  /** The in-game date the story refers to, or null when the save carries no date at all. */
  publishedOn: string | null;
  /** Higher sorts first within an edition. */
  weight: number;
  /** What the manager said afterwards, when the media asked and he answered. */
  quote: string | null;
  /**
   * The closing line the desk added under the piece, or null when the piece ends on its own last paragraph.
   *
   * Not stored: it is already the last paragraph of `article`, and kept here only so the checks can tell the
   * desk's closing line apart from a paragraph written for the story.
   */
  closing?: string | null;
}

/** A story as the screen receives it: the engine's item plus the ids its faces are looked up by. */
export interface PublishedNewsItem extends NewsItem {
  /**
   * EA player ids for the names the story is about, where the club's own records resolve them.
   *
   * The engine works in names, because that is all a match debrief records for a scorer - there is no
   * id in a contribution row. Turning a name into a picture is a lookup against the squad, so it is done
   * where the squad is known rather than guessed at in the writer.
   */
  playerIds: number[];
}

/** One match as the feed sees it: the debrief the manager logged, in the fields the stories read. */
export interface NewsMatch {
  eventId: string;
  matchDate: string | null;
  opponent: string | null;
  competition: string | null;
  venue: string | null;
  result: "WIN" | "DRAW" | "LOSS" | null;
  goalsFor: number;
  goalsAgainst: number;
  scorers: string[];
  assisters: string[];
  standouts: string[];
  weakness: string | null;
  goalMinutes: number[];
  concededMinutes: number[];
  shots: number | null;
  shotsInsideBox: number | null;
  /**
   * LEGACY, and read for one thing: the expected goals figure of a debrief logged before the game's own figure
   * had a box of its own. Nothing counts big chances any more, so this is never null on a current debrief, and
   * the desk never says the words.
   */
  bigChances: number | null;
  /**
   * The game's own expected goals: the figure the manager reads off the Match Facts Summary screen, typed or
   * scanned. A decimal, and not the model's figure.
   */
  expectedGoalsReported: number | null;
  /** What the manager told the press, when the press asked and he answered. */
  comment: string | null;
  /** True when the press asked and got nothing. A distinct thing from never having been asked. */
  commentRefused: boolean;
  /**
   * The question the press room put, and who put it, when the comment was recorded with it.
   *
   * Optional: comments recorded before the question was stored have only the answer, and print as before.
   */
  press?: { question: string; outlet: string | null; writer: string | null } | null;
}

export interface NewsPlayer {
  name: string;
  role: string;
  age: number | null;
  overall: number | null;
  potential: number | null;
  contractValidUntil: number | null;
  isKeeper: boolean;
}

export interface NewsSeason {
  season: number;
  tablePosition: number | null;
  complete: boolean;
}

/**
 * An absence the manager reported, as the squad carries it.
 *
 * The save's own `injury` column read 0 for every player on the reference career, so the app has no fact here
 * and takes the manager's word for it, exactly as it does for a match debrief. That makes an injury story the
 * one piece of bad news in the paper that is a REPORT of something he said rather than the desk's opinion of
 * him, which is why it is exempt from the fairness cap.
 */
export interface NewsAbsence {
  name: string;
  role: string;
  age: number | null;
  /** The day he is expected back. Null means an absence with no date, which is not a story. */
  until: string | null;
  /** The manager's own description of it, quoted if the piece has room. */
  note: string | null;
  reportedOn: string | null;
  /**
   * Whether the manager's own saved XI has him in it.
   *
   * THE COPY DEPENDS ON THIS. The first version of this article told every reader that the absent player "has
   * been a regular part of this side", which was a claim about the team sheet that the desk had never checked.
   * A manager who had never picked the man read a story about the hole his absence left, and the whole piece
   * stopped being trustworthy at that sentence. A starter's absence is a team selection problem; a squad
   * player's is a depth problem, and those are different articles.
   *
   * Missing means the manager has not saved an XI, in which case the desk does not guess a standing: it takes
   * the non-starter wording, which claims nothing about how often he plays.
   */
  isStarter?: boolean;
}

/** A player whose rating moved between two syncs, as the save reported it. */
export interface NewsDevelopment {
  id: string;
  name: string;
  position: string;
  oldOverall: number;
  newOverall: number;
  delta: number;
  isProspect: boolean;
  isBreakthrough: boolean;
  on: string | null;
}

/**
 * The club's money, as the desk is allowed to talk about it.
 *
 * BANDS AND FLAGS, not raw estimates. A paper may say a wage bill is heavy against the club's level; it may
 * not print the ratio, because the ratio is the app's own estimate and belongs in the story's evidence with
 * the rest of the app's reasoning. Every figure here is either a SAVE fact or a figure the manager stated,
 * and `null` always means "not recorded" rather than zero - the save writes 0 for both budgets on a career it
 * has not filled in, and a club with no recorded transfer budget is not a club with no money.
 */
export interface NewsFinance {
  /** The save's currency code, e.g. "GBP". Used for the symbol on a rounded band. */
  currency: string;
  /** Whether the wage figures are weekly or annual, so the copy can say "a week" or "a year". */
  wageFormat: "WEEKLY" | "ANNUAL";
  tier: number | null;
  squadWeeklyWage: number;
  squadAnnualWage: number;
  estimatedTierRevenue: number;
  /** Annual wage bill over the tier revenue estimate. Null when there is no wage bill at all. */
  wageToTurnover: number | null;
  /** The threshold this career's realism mode judges the wage bill against, for the evidence line. */
  wageTurnoverWarning: number;
  wageTurnoverCritical: number;
  wageTurnoverLevel: "OK" | "WARNING" | "CRITICAL" | null;
  transferBudget: number | null;
  transferBudgetSource: "SAVE" | "USER" | null;
  wageBudget: number | null;
  wageBudgetSource: "SAVE" | "USER" | null;
  recordBuy: number | null;
  recordSale: number | null;
  /** Next season's committed wages over the estimate, which is what a board actually asks about. */
  nextSeasonLiabilityToTurnover: number | null;
  realismMode: "STRICT" | "RELAXED" | "OFF";
}

export interface NewsInput {
  clubName: string;
  managerName: string;
  /** The manager's division, already resolved to a display name. */
  leagueName: string | null;
  /**
   * The save's nation id for the manager's division, which is what the press library keys its pools on.
   *
   * Null when the save names no country, in which case the desk files with the international wire rather
   * than guessing whose press this is.
   */
  countryId?: number | null;
  seasonNumber: number;
  /** The save's own current year, used only to talk about a contract running out. */
  inGameYear: number | null;
  /**
   * The save's own date, which is the dateline for every story about how things STAND rather than about
   * something that happened. A squad-depth story is true as of the last sync, and that is a fact with a
   * date on it, so the paper prints it. It is also what makes the unread badge mean anything in a career
   * with no matches logged yet.
   */
  inGameDate: string | null;
  /** Newest first. */
  matches: NewsMatch[];
  squad: NewsPlayer[];
  /** Rating movements the save recorded between syncs, newest first. */
  developments: NewsDevelopment[];
  /**
   * Absences the manager has reported, from the squad's own injury rows.
   *
   * Optional so a caller that has no squad to hand is not forced to invent an empty list, and so a paper
   * written before injuries existed reads exactly as it did.
   */
  injuries?: NewsAbsence[];
  seasons: NewsSeason[];
  position: { value: number | null; basis: string | null; disputed: boolean } | null;
  /** Trophies in the cabinet, newest first. */
  trophies: { name: string; season: number }[];
  /**
   * The best prospect in the academy.
   *
   * Potential travels with it, but only for the app's note: the story is about a fifteen year old scoring
   * for the youth team, which is what a newspaper would actually have.
   */
  academy: {
    name: string | null;
    age: number | null;
    potential: number | null;
    goals: number | null;
    appearances: number | null;
  } | null;
  /**
   * The current block of matches.
   *
   * Deliberately carries the RESULTS and not the manager's private target: a newspaper does not have his
   * workbook, it has the points, and the points are arithmetic anybody can do.
   */
  block: {
    gamesPlayed: number;
    points: number | null;
  } | null;
  /**
   * How far into the season the club is, and over how many matches a full one runs.
   *
   * Both halves are needed before the desk can say anything: the ordinal alone does not tell it whether
   * that is early or late, and the division's size alone does not say where the club is in it. A caller
   * with neither supplies neither, and the desk then says nothing about the time of year rather than
   * guessing at it, which is what it used to do.
   */
  progress?: SeasonProgress | null;
  /**
   * The club's money, when the caller has a finance report to hand.
   *
   * Optional, and absent means the finance stories simply do not run - which is the honest outcome for a
   * caller that cannot say what the club earns. Nothing here is guessed from a league position or a transfer
   * budget, because a fabricated figure is the one thing a story about money can never recover from.
   */
  finance?: NewsFinance | null;
  /**
   * Matches in charge, from the save's own per-season record.
   *
   * A REAL CAREER TOTAL, not a count of what the manager has typed up. `season_history` mirrors
   * `career_managerhistory`, which keeps games played per season across all competitions, so summing it is
   * the only honest way to say how long a manager has been here. A season still in progress may not have a row
   * yet, which is why the copy says what the number counts rather than implying it includes today.
   */
  gamesInCharge?: number | null;
  /**
   * The KINDS of story the last few editions already ran.
   *
   * The one input the desk cannot work out for itself. Everything else here is a fact about the career; this
   * is a fact about the PAPER, and only the archive knows it. Supplying it is what makes the front page move
   * on: the same evidence supports the same stories every read, so without a memory of what has already been
   * printed the manager opens the paper to the same nine pieces until the facts change underneath them.
   *
   * Absent means no history, which is the correct reading for the first edition of a career.
   */
  recentTypes?: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Deterministic phrasing
// ---------------------------------------------------------------------------------------------

/**
 * An FNV-1a hash, so a choice is stable for one id and different between ids.
 *
 * The same idea the storyline composer uses to keep a thread's copy from reshuffling on every read,
 * kept local so the news desk has no runtime dependency on that module.
 */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** A name reduced to letters and digits, so two spellings of one footballer compare equal. */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/**
 * Whether two names are the same player.
 *
 * The desk matches names across two sources that spell them differently: the squad list, which the save
 * fills with accents - "C. PatiÃ±o" - and a match contribution, which is whatever was recorded at the
 * time. Comparing the raw strings would silently lose a goalscorer's whole story over a tilde, so every
 * comparison here goes through the fold and the spelling that was recorded is what gets printed.
 */
function sameName(left: string, right: string): boolean {
  return foldName(left) === foldName(right);
}

/** One of several interchangeable phrasings, chosen by the item's id and a slot name. */
function pick(options: readonly string[], seed: string, slot: string): string {
  return options[hash(`${seed}|${slot}`) % options.length];
}

/**
 * Who the story is credited to.
 *
 * The whole point of the hedge: a paper has sources, and a source is how a real story says something it
 * cannot prove. Picked per item, so two stories in one edition do not both open with "those inside the
 * club".
 *
 * Every one of these has to work as the SUBJECT OF A PLURAL VERB - "the coaching staff say", "senior
 * figures have noticed" - because that is how they are all used. "Word from the training ground" reads
 * better than any of them and cannot be used this way, so it is not here: a phrase that only fits one
 * sentence is a trap for the next story written.
 */
const SOURCES = [
  "Those inside the club",
  "The coaching staff",
  "Senior figures at the club",
  "People around the first team",
  "The club's own staff",
] as const;

function source(seed: string, slot = "source"): string {
  return pick(SOURCES, seed, slot);
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/**
 * Which transfer window is open on a date, if any: the summer one through August, and January.
 *
 * The European calendar, which is what the game runs on for most of its leagues. A league that keeps a
 * different calendar gets the European one, and nothing printed from this claims a deadline day to the hour.
 */
export function transferWindowOn(date: string | null): "SUMMER" | "WINTER" | null {
  if (!date) return null;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month === 7 || month === 8 || (month === 9 && day === 1)) return "SUMMER";
  if (month === 1) return "WINTER";
  return null;
}

/** "1-0", "2-2". Plain, because a scoreline is not prose. */
function scoreOf(match: NewsMatch): string {
  return `${match.goalsFor}-${match.goalsAgainst}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The run of results, newest first, as a manager reads it: W D L. */
function formString(matches: NewsMatch[]): string {
  return matches
    .map((match) => (match.result === "WIN" ? "W" : match.result === "LOSS" ? "L" : "D"))
    .join(" ");
}

/**
 * The same run in WORDS, for a sentence.
 *
 * "W W D" is a form guide, and a form guide belongs in the story's own evidence where the app's shorthand is
 * at home. In prose it is a machine reading its own output aloud: "they are asking for the run W W D to look
 * like it is going somewhere" is not a sentence anybody writes. Football says "two wins and a draw", so the
 * paper does too, and the two are kept deliberately separate so a call site has to choose which it wants.
 */
function formWords(matches: NewsMatch[]): string {
  const wins = matches.filter((match) => match.result === "WIN").length;
  const draws = matches.filter((match) => match.result === "DRAW").length;
  const losses = matches.filter((match) => match.result === "LOSS").length;
  const parts = [
    wins > 0 ? `${countWord(wins)} ${plural(wins, "win")}` : "",
    draws > 0 ? `${countWord(draws)} ${plural(draws, "draw")}` : "",
    losses > 0 ? `${countWord(losses)} ${plural(losses, "defeat")}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "nothing to show for it";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** A list of names as prose: "A", "A and B", "A, B and C". */
function namesList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The goalscorers from a match's scorers array, counting repeats as "(2)". */
function scorerTally(scorers: string[]): { name: string; goals: number }[] {
  const byName = new Map<string, { name: string; goals: number }>();
  for (const name of scorers) {
    const key = foldName(name);
    const existing = byName.get(key);
    if (existing) existing.goals += 1;
    else byName.set(key, { name, goals: 1 });
  }
  return [...byName.values()].sort((left, right) => right.goals - left.goals);
}

/** Goals in a window by one player, from the scorers arrays. */
function goalsIn(matches: NewsMatch[], name: string): number {
  return sum(
    matches.map((match) => match.scorers.filter((scorer) => sameName(scorer, name)).length)
  );
}

function assistsIn(matches: NewsMatch[], name: string): number {
  return sum(
    matches.map((match) => match.assisters.filter((assister) => sameName(assister, name)).length)
  );
}

/** Which half of the match a goal came in, as a manager counts it. */
function earlyGoals(minutes: number[]): number {
  return minutes.filter((minute) => minute <= 25).length;
}
function lateGoals(minutes: number[]): number {
  return minutes.filter((minute) => minute >= 75).length;
}

// ---------------------------------------------------------------------------------------------
// Grammar the first version got wrong
// ---------------------------------------------------------------------------------------------

/**
 * "a" or "an", from the word that follows.
 *
 * The first version printed "a attacking midfielder" and "a own goal" because the article was written
 * into the template string by hand. Every word this is used with is a plain English noun or a position
 * phrase, so a vowel test is the whole rule.
 */
function aOrAn(word: string): string {
  const text = word.trim();
  if (/^(8|11|18)(\D|$)/.test(text) || /^8\d/.test(text)) return "an";
  return /^[aeiou]/i.test(text) ? "an" : "a";
}

/**
 * A small count as a word, for prose. Past ten a numeral is what a paper prints anyway.
 *
 * Zero is "no" rather than "0", because "0 defeats" is a figure and "no defeats" is a sentence.
 */
function countWord(count: number): string {
  const words = [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  return words[count] ?? String(count);
}

/** "is" or "are" against a count. */
function isAre(count: number): string {
  return count === 1 ? "is" : "are";
}

/** "his" or "their" against a count, for a sentence that may be about one player or several. */
function hisTheir(count: number): string {
  return count === 1 ? "his" : "their";
}

/**
 * How many goals one player got, in the words football uses.
 *
 * "scored twice" and "a hat-trick" are how the game writes two and three; above that only a count will
 * do, and "four times" is exactly what a report says.
 */
function goalTallyWord(goals: number): string {
  if (goals === 2) return "twice";
  if (goals === 3) return "a hat-trick";
  return `${countWord(goals)} times`;
}

/**
 * An age as a paper writes it, without printing the number.
 *
 * "in his 24s" was the first version's way of saying a player is 24, and nobody says that. A reporter
 * writes the band. The exact figure belongs in the story's own evidence, where the app's reasoning
 * goes, rather than in the sentence.
 */
function ageBand(age: number): string {
  if (age < 18) return "his teens";
  if (age <= 20) return "his late teens";
  if (age <= 23) return "his early twenties";
  if (age <= 26) return "his mid-twenties";
  if (age <= 29) return "his late twenties";
  if (age <= 32) return "his early thirties";
  if (age <= 35) return "his mid-thirties";
  return "his late thirties";
}

/**
 * Which end a match was played at, normalised in one place.
 *
 * The save writes a venue as HOME, AWAY or NEUTRAL and the debrief carries it through unchanged, but
 * the match report used to test `startsWith("a")` as a shortcut for "away" - and "at home" starts with
 * an "a" too. Two conventions in one file is how that happened, so now there is one.
 */
function venueOf(match: NewsMatch): "HOME" | "AWAY" | "NEUTRAL" | null {
  const venue = (match.venue ?? "").trim().toUpperCase();
  if (venue.startsWith("H")) return "HOME";
  if (venue.startsWith("A")) return "AWAY";
  if (venue.startsWith("N")) return "NEUTRAL";
  return null;
}

/** "at home", "away", or nothing at all when the venue is not known. */
function venueWord(match: NewsMatch): string {
  switch (venueOf(match)) {
    case "HOME":
      return "at home";
    case "AWAY":
      return "away";
    default:
      return "";
  }
}

/** The symbol for a currency code, or the code itself when it is not one we know. */
function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (code === "GBP") return "\u00a3";
  if (code === "EUR") return "\u20ac";
  if (code === "USD") return "$";
  return `${code} `;
}

/**
 * A sum of money as a paper writes it, rounded to the band a reporter would actually say.
 *
 * Exact change is not how money is reported. "Â£12,400,000" is a spreadsheet reading and "about Â£12m" is a
 * sentence, and the difference matters more here than anywhere else in the desk, because a story about money
 * that reads like a ledger is a story nobody finishes. The exact figure stays in the story's own evidence,
 * with the rest of the app's reasoning.
 */
function moneyBand(amount: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) {
    return `${symbol}${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}bn`;
  }
  if (abs >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `${symbol}${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (abs >= 1_000) return `${symbol}${Math.round(amount / 1_000)}k`;
  return `${symbol}${Math.round(amount)}`;
}

/**
 * The opposition as the prose refers to them.
 *
 * The named opponent wherever the debrief recorded one. When it did not, a reporter still has to call
 * them something and the venue decides it: "the visitors" at our ground, "the hosts" at theirs, and
 * "the opposition" when the venue is missing too. What he never does is print a venue word in a match
 * he cannot place, which is why an unknown venue returns the neutral phrase rather than a guess.
 */
function opponentWord(match: NewsMatch): string {
  if (match.opponent && match.opponent.trim().length > 0) return match.opponent.trim();
  switch (venueOf(match)) {
    case "HOME":
      return "the visitors";
    case "AWAY":
      return "the hosts";
    default:
      return "the opposition";
  }
}

/**
 * A scoreline written the way the result is read: the home side first.
 *
 * "Rovers 2-0 Kingsbridge" is the away side's view of the afternoon, and it reads back to front in a
 * paper written for one club's supporters. Home side first, whatever the result was.
 */
function fixtureLine(match: NewsMatch, clubName: string): string {
  const elsewhere = venueOf(match) === "AWAY";
  const left = elsewhere ? opponentWord(match) : clubName;
  const right = elsewhere ? clubName : opponentWord(match);
  // The score follows the names: at their ground their goals come first, or a 2-1 away win prints as a defeat.
  const score = elsewhere ? `${match.goalsAgainst}-${match.goalsFor}` : scoreOf(match);
  // The left side opens the line, and the fallback phrase for it is lowercase, so it is capitalised here rather
  // than at each of the three places this is used as a headline. The right side stays as it is: "Kingsbridge
  // Athletic 2-0 the visitors" is how a scoreline is read, and "The Visitors" would not be.
  return `${capitalise(left)} ${score} ${right}`;
}

/**
 * A scoreline as a sentence says it: the bigger number first, whoever won. "Lost 4-0", never "lost 0-4".
 */
function proseScore(match: NewsMatch): string {
  return `${Math.max(match.goalsFor, match.goalsAgainst)}-${Math.min(match.goalsFor, match.goalsAgainst)}`;
}

/** One result as a phrase: "a 2-1 win over Rovers", "a 0-0 draw with City", "a 3-0 defeat to Town". */
function resultPhrase(match: NewsMatch): string {
  const against = opponentWord(match);
  const score = proseScore(match);
  if (match.result === "WIN") return `${aOrAn(score)} ${score} win over ${against}`;
  if (match.result === "LOSS") return `${aOrAn(score)} ${score} defeat to ${against}`;
  return `${aOrAn(score)} ${score} draw with ${against}`;
}

/** The results of a run as one sentence, oldest first, the way a run is told. */
function resultsLine(matches: NewsMatch[]): string {
  return namesList([...matches].reverse().map(resultPhrase));
}

/** Whether a competition is a cup rather than a league, from its name. The same test the press room uses. */
export function isCupCompetition(competition: string | null | undefined): boolean {
  return (
    typeof competition === "string" &&
    /\b(cup|trophy|shield|pokal|coppa|beker|ta[cç]a|coupe|copa|supercopa|libertadores|champions league|europa league|conference league|super ?cup)\b/i.test(
      competition
    )
  );
}

/** Headline case for a phrase dropped into a headline: "a couple of weeks" becomes "a Couple of Weeks". */
function titleCase(text: string): string {
  const small = new Set(["a", "an", "and", "the", "of", "in", "on", "for", "to", "at", "or"]);
  return text
    .split(" ")
    .map((word) => (small.has(word) ? word : capitalise(word)))
    .join(" ");
}

/**
 * The club's name as a paper shortens it after the first mention: "Wigan Athletic" becomes "Wigan".
 *
 * Only suffixes that never tell two clubs apart are dropped. "Manchester City" and "Bristol City" keep their
 * whole names, because "Manchester" is two clubs and a paper would never write it that way.
 */
export function clubShortName(clubName: string): string | null {
  const words = clubName.trim().split(/\s+/).filter((word) => !/^(A?FC|CF|SC|AC|FK|SK|IF|BK)$/i.test(word));
  if (words.length < 2) return words.length === 1 && words[0] !== clubName.trim() ? words[0] : null;
  const last = words[words.length - 1];
  if (/^(Athletic|Wanderers|Hotspur|Albion|Argyle|Alexandra|Rovers|Athletico)$/i.test(last)) {
    return words.slice(0, -1).join(" ");
  }
  return words.join(" ") === clubName.trim() ? null : words.join(" ");
}

/** The manager's surname, which is what a paper calls anybody after the first mention. */
function surnameOf(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name;
}

/**
 * When the season the save is in began, approximately: the first of July of the right year.
 *
 * Used only to count "of the season" tallies over the debriefs, which carry their own dates. A league that
 * runs on the calendar year is miscounted by this, which is why nothing that depends on it is ever stated
 * as a season record without the match count beside it in the evidence.
 */
function seasonStartIso(inGameDate: string | null): string | null {
  const moment = momentOf(inGameDate);
  if (!moment || !inGameDate) return null;
  const year = Number(inGameDate.slice(0, 4));
  const month = Number(inGameDate.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return `${month >= 7 ? year : year - 1}-07-01`;
}

/**
 * Which player a goal minute belongs to, when the debrief makes that knowable.
 *
 * The debrief records who scored and the minutes of the goals as two separate lists, so the two can only be
 * joined when one man scored all of them. Anything else would be the desk inventing who scored when.
 */
function soleScorer(match: NewsMatch): string | null {
  const names = scorerTally(match.scorers);
  return names.length === 1 && names[0].goals === match.goalsFor ? names[0].name : null;
}

/**
 * How the match unfolded, as one sentence of who led when, from the minutes the debrief recorded.
 *
 * Only written when every goal has a minute, because a timeline with a goal missing is a timeline that is
 * wrong, and only for matches with between two and six goals: one goal is not a story of a lead changing, and
 * seven is a list.
 */
function unfoldingLine(match: NewsMatch, club: string): string | null {
  const total = match.goalsFor + match.goalsAgainst;
  if (total < 2 || total > 6) return null;
  if (match.goalMinutes.length !== match.goalsFor || match.concededMinutes.length !== match.goalsAgainst) return null;
  // Told from the club's side throughout, so every clause after the first shares its subject.
  let ours = 0;
  let theirs = 0;
  const clauses: string[] = [];
  let wasAhead = false;
  let wasBehind = false;
  for (const event of runningScore(match)) {
    if (event.ours) ours += 1;
    else theirs += 1;
    const minute = event.minute;
    const diff = Math.abs(ours - theirs);
    let clause: string;
    if (ours === theirs) clause = `level on ${minute}`;
    else if (ours > theirs) clause = diff >= 2 ? `${countWord(diff)} up on ${minute}` : wasAhead ? `ahead again on ${minute}` : `ahead on ${minute}`;
    else clause = diff >= 2 ? `${countWord(diff)} down on ${minute}` : wasBehind ? `behind again on ${minute}` : `behind on ${minute}`;
    if (ours > theirs) wasAhead = true;
    if (theirs > ours) wasBehind = true;
    clauses.push(clauses.length === 0 ? `${club} were ${clause} minutes` : clause);
  }
  if (clauses.length < 2) return null;
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}.`;
}

/**
 * The minute of the goal that decided it, where one goal can be said to have decided it.
 *
 * Only meaningful at a margin of one. At two goals the last one is rarely the decisive one, and a draw
 * was decided by nobody, so both return null rather than a number that would mislead a sentence.
 */
function decidingGoalMinute(match: NewsMatch): number | null {
  if (match.goalMinutes.length === 0) return null;
  if (match.goalsFor - match.goalsAgainst !== 1) return null;
  return Math.max(...match.goalMinutes);
}

/**
 * The match's goals in the order they went in.
 *
 * The debrief records the minutes of our goals and of theirs but not how the two interleaved, so this
 * interleaves them by minute. A goal of ours and one of theirs at the same minute is read with ours
 * first, which is the only reading that does not invent a lead that may never have existed.
 */
function runningScore(match: NewsMatch): { minute: number; ours: boolean }[] {
  return [
    ...match.goalMinutes.map((minute) => ({ minute, ours: true })),
    ...match.concededMinutes.map((minute) => ({ minute, ours: false })),
  ].sort((left, right) => left.minute - right.minute || (left.ours ? -1 : 1));
}

/** Whether the side was ever in front. */
function ledAtAnyPoint(match: NewsMatch): boolean {
  let ours = 0;
  let theirs = 0;
  for (const event of runningScore(match)) {
    if (event.ours) ours += 1;
    else theirs += 1;
    if (ours > theirs) return true;
  }
  return false;
}

/** Whether the side was ever behind. */
function trailedAtAnyPoint(match: NewsMatch): boolean {
  let ours = 0;
  let theirs = 0;
  for (const event of runningScore(match)) {
    if (event.ours) ours += 1;
    else theirs += 1;
    if (theirs > ours) return true;
  }
  return false;
}


/**
 * A weakness note reduced to a shape that can be compared.
 *
 * The manager's note is his own shorthand and it is not written for print: "Switched off after scoring"
 * is a note to self, not a sentence in a paper, and printing it verbatim is the most obvious way this
 * desk could read as an app quoting a field.
 *
 * The table itself now lives in `events/weakness-family.ts`, because the review reads the same notes and
 * two tables would let the paper and the review disagree about what one note is about.
 */

/**
 * What a weakness note amounts to, in the language of a match report.
 *
 * The note is matched to a family and the family supplies the wording, so the paper never prints the
 * manager's own shorthand and never guesses at a specific.
 */


/**
 * The final pass over a sentence, for the seams that composing fragments leaves behind.
 *
 * Everything above is assembled from pieces, and pieces leave marks: a doubled space where a clause was
 * dropped, a space before a full stop where an empty one was interpolated, two full stops where a
 * sentence ended and a fragment already had one. Rather than ask twenty call sites to be careful, the
 * desk tidies once on the way out. It deliberately does NOT strip the word "undefined", because that is
 * a bug in the caller and the checks assert it never appears.
 */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])\1+/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
}

/**
 * The age, said once, in the one place a piece has room for it.
 *
 * Once, and the checks enforce it. The first version put the age in the card's body ("He is 17.") and again in
 * the article ("For a player of 17, this is the stretch where..."), which reads as a machine quoting a field
 * twice and is bad English into the bargain. The article's own paragraph is where it belongs, so the bodies
 * simply do not mention it.
 */
export const AGE_MENTIONS_PER_STORY = 1;

/** A word with its first letter up, for a phrase being dropped into the start of a headline. */
function capitalise(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * A position code as football says it.
 *
 * The app stores and displays codes - CB, CDM, ST - because that is what a squad screen is for. A reporter
 * does not write "the ST has gone off the boil", so the paper speaks the language of a match report instead.
 * An unrecognised code falls through as itself rather than as a guess at what it means.
 */
export function positionWords(role: string | null | undefined): string {
  if (!role) return "player";
  const code = role.toUpperCase().replace(/[^A-Z]/g, "");
  const words: Record<string, string> = {
    GK: "goalkeeper",
    CB: "centre-back",
    DC: "centre-back",
    LB: "left-back",
    RB: "right-back",
    LWB: "left wing-back",
    RWB: "right wing-back",
    SW: "sweeper",
    CDM: "holding midfielder",
    DM: "holding midfielder",
    CM: "central midfielder",
    CAM: "attacking midfielder",
    AM: "attacking midfielder",
    LM: "left midfielder",
    RM: "right midfielder",
    LW: "left winger",
    RW: "right winger",
    ST: "striker",
    CF: "forward",
    LF: "forward",
    RF: "forward",
    SUB: "substitute",
  };
  return words[code] ?? "player";
}


/**
 * A position in words, with the article it needs: "a striker", "an attacking midfielder".
 *
 * The first version wrote the article into the template and then interpolated the position, which is how
 * the desk produced "a attacking midfielder". The article belongs to the phrase rather than to the
 * sentence, so the two are built together here and no call site has to think about it.
 */
function positionPhrase(role: string | null | undefined): string {
  const words = positionWords(role);
  return `${aOrAn(words)} ${words}`;
}

/**
 * The same number as a word: "third", for something being counted rather than ranked.
 *
 * A league position is written the way a table writes it - "3rd" - because that is how a table reads. A
 * manager's season is not a placing, and "his 3rd season in charge" is a machine writing a field. The two
 * are deliberately separate helpers so nobody has to remember which is which at a call site.
 */
function ordinalWord(value: number): string {
  const words = [
    "zeroth",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
  ];
  return words[value] ?? ordinal(value);
}

/** "3rd", "21st", "13th". A league position deserves its suffix. */
function ordinal(value: number): string {
  const rest = value % 100;
  const suffix =
    rest >= 11 && rest <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
}

/**
 * Where a player plays, in four buckets, from the position codes the save uses.
 *
 * Defensive midfield is counted as a defender on purpose: the player screening a back four is part of why
 * a clean sheet happened, and a report that credited only the centre halves would be missing the point.
 */
export function roleGroup(role: string | null): "GK" | "DEF" | "MID" | "ATT" | null {
  if (!role) return null;
  const code = role.toUpperCase().replace(/[^A-Z]/g, "");
  if (code === "GK" || code === "GOALKEEPER") return "GK";
  if (/^(CB|LB|RB|LWB|RWB|DC|DL|DR|SW|DEF|DM|CDM)/.test(code)) return "DEF";
  if (/^(CM|CAM|AM|LM|RM|MF|MID|WM)/.test(code)) return "MID";
  if (/^(ST|CF|LW|RW|LF|RF|ATT|FW|W)/.test(code)) return "ATT";
  return null;
}

const WINDOW = 5;

/**
 * The player angles a desk runs because a paper likes a running joke.
 *
 * Everything here is built from the manager's own logged debriefs - who scored, who made one, who he picked
 * out - plus the squad's role and age, which the save supplies. NOTHING here claims anything about a player's
 * life, his mood, his car or his Twitter, because the desk has no source for any of that and a newspaper that
 * makes it up about a named man is not funny, it is a liability. The jokes are all football jokes: a keeper
 * who scored, a centre-half who has forgotten where he is supposed to stand, a teenager doing it anyway, the
 * professional who does the work nobody applauds.
 *
 * The register is deliberate. A real desk keeps three or four of these running all season, and the reason the
 * paper reads as a paper rather than as a feed is that it will happily spend a paragraph on the goalkeeper
 * scoring while still being entirely straight about it. Nothing here is sarcastic AT the player; the joke is
 * always on the situation.
 *
 * Each one is keyed on the latest match so the novelty rotation in `rank` demotes it next edition, which is
 * what keeps a running joke from turning into the same running joke five days in a row.
 */
function playerColourStories(input: NewsInput, recent: NewsMatch[]): StoryDraft[] {
  const items: StoryDraft[] = [];
  if (recent.length < 3 || input.squad.length === 0) return items;

  const latest = recent[0];
  const on = latest.matchDate;
  const goalsOf = (name: string): number => goalsIn(recent, name);
  const assistsOf = (name: string): number => assistsIn(recent, name);
  const praisedIn = (name: string): number =>
    recent.filter((match) => match.standouts.some((pick) => sameName(pick, name))).length;
  /** Matches he appears in at all, so copy can say "involved" without claiming he started anything. */
  const involvedIn = (name: string, extra: (match: NewsMatch) => boolean): number =>
    recent.filter(
      (match) =>
        extra(match) ||
        match.scorers.some((scorer) => sameName(scorer, name)) ||
        match.assisters.some((assister) => sameName(assister, name)) ||
        match.standouts.some((pick) => sameName(pick, name))
    ).length;

  const pickBy = <T>(rows: T[], score: (row: T) => number): T | null => {
    const sorted = [...rows].sort((left, right) => score(right) - score(left));
    const best = sorted[0];
    return best && score(best) > 0 ? best : null;
  };

  // ---- The goalkeeper who scored -------------------------------------------------------------
  const keeperScorer = pickBy(
    input.squad.filter((player) => roleGroup(player.role) === "GK"),
    (player) => goalsOf(player.name)
  );
  if (keeperScorer) {
    const tally = goalsOf(keeperScorer.name);
    items.push({
      id: `keeper-goal-${keeperScorer.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${keeperScorer.name} Has Scored, and the Press Box Has Questions`,
          `A Goalkeeper Scored: ${keeperScorer.name}`,
          `${keeperScorer.name} Is Never Going Back in Goal`,
          `Nobody in the Ground Could Quite Believe ${keeperScorer.name}`,
        ],
        `${keeperScorer.name}${latest.eventId}`,
        "headline"
      ),
      body: `${keeperScorer.name} is a goalkeeper and has ${tally} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}. The desk has checked this twice and it stands. Somebody in the office has already claimed credit for picking him.`,
      evidence: [
        `Goalkeeper by position`,
        `${tally} ${plural(tally, "goal")} in ${recent.length} matches`,
      ],
      playerNames: [keeperScorer.name],
      publishedOn: on,
      weight: 76,
      quote: null,
    });
  }

  // ---- The defender who has stopped defending ------------------------------------------------
  const scorerDefender = pickBy(
    input.squad.filter(
      (player) => roleGroup(player.role) === "DEF" && goalsOf(player.name) >= 2
    ),
    (player) => goalsOf(player.name)
  );
  if (scorerDefender) {
    const tally = goalsOf(scorerDefender.name);
    const role = positionWords(scorerDefender.role);
    items.push({
      id: `defender-goals-${scorerDefender.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${scorerDefender.name} Has ${tally} and No Intention of Stopping`,
          `The ${capitalise(role)} Who Forgot to Stay Back`,
          `${scorerDefender.name} Is Doing Somebody Else's Job`,
          `${tally} Goals From a ${capitalise(role)}`,
        ],
        `${scorerDefender.name}-defender-${latest.eventId}`,
        "headline"
      ),
      body: (() => {
        const forwards = sum(
          input.squad.filter((player) => roleGroup(player.role) === "ATT").map((player) => goalsOf(player.name))
        );
        const versus =
          forwards < tally
            ? ` That is more than the forwards have managed between them, which is a sentence the forwards will not enjoy.`
            : ` ${source(latest.eventId, "defender-source")} have noticed that nobody has asked him to stop.`;
        return `${tally} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")} from ${aOrAn(role)} ${role}.${versus}`;
      })(),
      evidence: [
        `${role} by position`,
        `${tally} ${plural(tally, "goal")} in ${recent.length} matches`,
      ],
      playerNames: [scorerDefender.name],
      publishedOn: on,
      weight: 70,
      quote: null,
    });
  }

  // ---- The teenager doing it anyway -----------------------------------------------------------
  const kid = pickBy(
    input.squad.filter(
      (player) => player.age !== null && player.age <= 20 && goalsOf(player.name) >= 1
    ),
    (player) => goalsOf(player.name)
  );
  if (kid && kid.age !== null) {
    const tally = goalsOf(kid.name);
    items.push({
      id: `kid-scoring-${kid.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${kid.age} Years Old, and Scoring`,
          `Nobody Told ${kid.name} to Be Nervous`,
          `${kid.name} in ${ageBand(kid.age)} and Playing Like It`,
          `The Youngest Thing in the Building Scored`,
        ],
        `${kid.name}-kid-${latest.eventId}`,
        "headline"
      ),
      body: `${kid.name} is ${kid.age}. He has ${countWord(tally)} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}, and the coaching staff have spent the week telling anyone who will listen not to make a fuss of him.`,
      evidence: [
        `Age ${kid.age}`,
        `${tally} ${plural(tally, "goal")} in ${recent.length} matches`,
      ],
      playerNames: [kid.name],
      publishedOn: on,
      weight: 66,
      quote: null,
    });
  }

  // ---- The one who has been here the whole time ------------------------------------------------
  const veteran = pickBy(
    input.squad.filter(
      (player) =>
        player.age !== null && player.age >= 33 && (goalsOf(player.name) >= 1 || praisedIn(player.name) >= 2)
    ),
    (player) => goalsOf(player.name) * 2 + praisedIn(player.name)
  );
  if (veteran && veteran.age !== null) {
    const tally = goalsOf(veteran.name);
    items.push({
      id: `veteran-${veteran.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${veteran.age} and Still Doing It`,
          `${veteran.name} Has Heard All of This Before`,
          `No Rebuild Required While ${veteran.name} Is Here`,
          `${veteran.name} in ${ageBand(veteran.age)} and Setting the Standard`,
        ],
        `${veteran.name}-veteran-${latest.eventId}`,
        "headline"
      ),
      body:
        tally > 0
          ? `${veteran.name} is ${veteran.age} and has ${tally} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}. The desk has been predicting his decline for a while now, and the desk would like that on the record.`
          : `${veteran.name} is ${veteran.age}, and the manager has picked him out ${praisedIn(veteran.name)} times in the last ${recent.length} ${plural(recent.length, "match", "matches")}. Whatever is being rebuilt here is being built around him.`,
      evidence: [
        `Age ${veteran.age}`,
        tally > 0
          ? `${tally} ${plural(tally, "goal")} in ${recent.length} matches`
          : `${praisedIn(veteran.name)} standout mentions in ${recent.length} matches`,
      ],
      playerNames: [veteran.name],
      publishedOn: on,
      weight: 68,
      quote: null,
    });
  }

  // ---- The one who does the work nobody applauds -----------------------------------------------
  const unsung = pickBy(
    input.squad.filter(
      (player) => praisedIn(player.name) >= 2 && goalsOf(player.name) === 0 && assistsOf(player.name) === 0
    ),
    (player) => praisedIn(player.name)
  );
  if (unsung) {
    const mentions = praisedIn(unsung.name);
    items.push({
      id: `unsung-${unsung.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${unsung.name} Has Not Scored. He Has Not Stopped Either`,
          `The Work Nobody Applauds, by ${unsung.name}`,
          `${unsung.name} Is the One the Manager Mentions`,
          `No Goals, No Assists, No Arguments`,
        ],
        `${unsung.name}-unsung-${latest.eventId}`,
        "headline"
      ),
      body: `No goals and no assists in the last ${recent.length} ${plural(recent.length, "match", "matches")}, and ${mentions} mentions from the manager anyway. ${source(latest.eventId, "unsung-source")} describe him as the first name on the sheet and the last name in the write-up.`,
      evidence: [
        `${mentions} standout mentions in ${recent.length} matches`,
        `No goals and no assists in the window`,
      ],
      playerNames: [unsung.name],
      publishedOn: on,
      weight: 64,
      quote: null,
    });
  }

  // ---- The two who arrive together --------------------------------------------------------------
  const together = new Map<string, { first: string; second: string; count: number }>();
  for (const match of recent) {
    for (let left = 0; left < match.standouts.length; left += 1) {
      for (let right = left + 1; right < match.standouts.length; right += 1) {
        const a = match.standouts[left];
        const b = match.standouts[right];
        const pair = [foldName(a), foldName(b)].sort();
        const key = pair.join("|");
        const existing = together.get(key);
        if (existing) existing.count += 1;
        else together.set(key, { first: a, second: b, count: 1 });
      }
    }
  }
  const duo = pickBy([...together.values()], (entry) => entry.count);
  if (duo && duo.count >= 3) {
    const both = [duo.first, duo.second].sort((left, right) => left.localeCompare(right));
    items.push({
      id: `duo-${both[0]}-${both[1]}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `You Cannot Have One Without the Other`,
          `${both[0]} and ${both[1]} Arrive Together`,
          `${both[0]}, ${both[1]}, and the Same Sentence Every Week`,
          `The Pair the Manager Keeps Naming Together`,
        ],
        `${both[0]}${both[1]}${latest.eventId}`,
        "headline"
      ),
      body: `${both[0]} and ${both[1]} have both been picked out by the manager in ${duo.count} of the last ${recent.length} ${plural(recent.length, "match", "matches")}. The desk has started writing their names as one entry in the notebook.`,
      evidence: [
        `Named together in ${duo.count} of ${recent.length} matches`,
        `${both[0]} and ${both[1]}`,
      ],
      playerNames: [both[0], both[1]],
      publishedOn: on,
      weight: 74,
      quote: null,
    });
  }

  // ---- The one who did both ---------------------------------------------------------------------
  const doubleAct = pickBy(
    input.squad.filter((player) =>
      recent.some(
        (match) =>
          match.scorers.some((scorer) => sameName(scorer, player.name)) &&
          match.assisters.some((assister) => sameName(assister, player.name))
      )
    ),
    (player) => involvedIn(player.name, () => false)
  );
  if (doubleAct) {
    items.push({
      id: `double-act-${doubleAct.name}-${latest.eventId}`,
      kind: "PLAYER",
      category: "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        [
          `${doubleAct.name} Scored One and Made One`,
          `Do It Yourself: ${doubleAct.name}`,
          `${doubleAct.name} Has Stopped Waiting for Help`,
          `A Goal, an Assist, and a Very Long Walk Back`,
        ],
        `${doubleAct.name}-double-${latest.eventId}`,
        "headline"
      ),
      body: `${doubleAct.name} has both scored and set one up inside the same ninety minutes. The desk would like to point out that this is two jobs, and that he appears to have done them himself.`,
      evidence: [`Scored and assisted in the same match`],
      playerNames: [doubleAct.name],
      publishedOn: on,
      weight: 66,
      quote: null,
    });
  }

  return items;
}


// ---------------------------------------------------------------------------------------------
// The stories
// ---------------------------------------------------------------------------------------------

/**
 * Every story the facts support, ranked.
 *
 * Each branch is guarded by its own condition and returns at most one item, so a feed can never repeat
 * a kind of story twice in one edition however many matches are on the pile.
 */
export function buildNews(input: NewsInput, options: { maxStories?: number } = {}): NewsItem[] {
  const items: StoryDraft[] = [];
  /**
   * The sentences this EDITION has already printed.
   *
   * Scoped to one run of the desk on purpose. Pools like the injury standing line have five phrasings and an
   * edition can carry three injured players, so without a memory the same sentence lands under two of them -
   * and a paper that repeats a line about two different people reads as a template. `finalise` keeps its own
   * set for the closing paragraph, because a closing line and a standing line are different pools.
   */
  const used = new Set<string>();
  const recent = input.matches.slice(0, WINDOW);
  /** Whether a transfer window is open on the save's date, so a story never says "no window" in January. */
  const windowOpen = transferWindowOn(input.inGameDate) !== null;
  const last = input.matches[0] ?? null;
  const keeper = input.squad.find((player) => player.isKeeper) ?? null;
  /** The dateline for a story about the present rather than about a match. */
  const at = input.inGameDate;
  const roleOf = (name: string) =>
    input.squad.find((player) => sameName(player.name, name))?.role ?? null;

  /**
   * How a report handles what was said afterwards.
   *
   * Three genuinely different states, and the difference matters: he answered, he was asked and said
   * nothing, or nobody asked. Only the first two belong in a paper.
   */
  /**
   * A "first since" from the logged record: the first win in a while, the first away win, the first clean
   * sheet, the first defeat after a run without one.
   *
   * Counted only over matches the manager has logged, and only stated when the earlier match it is measured
   * from is ON the record. "The first win since September" is printed when there is a September win to point
   * at; a run that goes back past the first debrief claims nothing, because the matches before it are unknown.
   */
  const firstSinceLine = (match: NewsMatch): string | null => {
    const index = input.matches.indexOf(match);
    if (index < 0) return null;
    const earlier = input.matches.slice(index + 1);
    const thisMonth = momentOf(match.matchDate)?.month ?? null;
    const since = (found: NewsMatch) => {
      const month = momentOf(found.matchDate)?.month ?? null;
      return month && month !== thisMonth ? `since ${month}` : null;
    };
    const club = input.clubName;
    if (match.result === "WIN") {
      const previous = earlier.findIndex((entry) => entry.result === "WIN");
      if (previous >= 4) {
        const when = since(earlier[previous]);
        return `It ends a run of ${countWord(previous)} matches without a win${when ? `, and it is ${club}'s first ${when}` : ""}.`;
      }
      if (venueOf(match) === "AWAY") {
        const away = earlier.filter((entry) => venueOf(entry) === "AWAY");
        const previousAway = away.findIndex((entry) => entry.result === "WIN");
        if (previousAway >= 3) {
          const when = since(away[previousAway]);
          return `It is the first away win in ${countWord(previousAway + 1)} trips${when ? `, and the first ${when}` : ""}.`;
        }
      }
    }
    if (match.goalsAgainst === 0) {
      const previous = earlier.findIndex((entry) => entry.goalsAgainst === 0);
      if (previous >= 5) {
        const when = since(earlier[previous]);
        return `It is the first clean sheet in ${countWord(previous + 1)} matches${when ? `, and the first ${when}` : ""}.`;
      }
    }
    if (match.result === "LOSS") {
      const previous = earlier.findIndex((entry) => entry.result === "LOSS");
      if (previous >= 6) {
        const when = since(earlier[previous]);
        return when
          ? `It is the first defeat ${when}, and it ends a run of ${countWord(previous)} matches without one.`
          : `It ends a run of ${countWord(previous)} matches without a defeat.`;
      }
    }
    if (match.goalsFor > 0) {
      let blanks = 0;
      for (const entry of earlier) {
        if (entry.goalsFor === 0) blanks += 1;
        else break;
      }
      if (blanks >= 3 && blanks < earlier.length) {
        return `It is ${club}'s first goal in ${countWord(blanks + 1)} matches.`;
      }
    }
    return null;
  };

  const aftermath = (match: NewsMatch, seed: string): { line: string; quote: string | null } => {
    /**
     * The exchange, when the question was stored with the answer.
     *
     * A press conference is a question and an answer, and printing only the answer is how the first version
     * made every quote read like a statement. The question is reported indirectly, which is how a paper
     * writes it: "asked whether the back line has finally settled". The answer itself is the story's quote.
     */
    const press = match.press ?? null;
    if (press && press.question.trim().length > 1) {
      const asked = press.question.trim().replace(/\?+$/, "");
      const indirect = `${asked.charAt(0).toLowerCase()}${asked.slice(1)}`;
      const who = press.writer && press.outlet ? `${press.writer} of ${press.outlet}` : press.outlet ?? "One reporter";
      if (match.comment !== null && match.comment.trim().length > 0) {
        return {
          line: pick(
            [
              `${who} asked ${input.managerName} ${indirect}.`,
              `Afterwards ${who} asked ${input.managerName} ${indirect}, and got an answer.`,
            ],
            seed,
            "aftermath-asked"
          ),
          quote: match.comment.trim(),
        };
      }
      if (match.commentRefused) {
        return {
          line: pick(
            [
              `${who} asked ${input.managerName} ${indirect}. There was no answer.`,
              `Asked by ${who} ${indirect}, ${input.managerName} declined to say.`,
              `${who} wanted to know ${indirect}. ${input.managerName} walked past without stopping.`,
            ],
            seed,
            "aftermath-refused"
          ),
          quote: null,
        };
      }
    }
    if (match.comment !== null && match.comment.trim().length > 0) {
      return {
        line: pick(
          [
            "There was no doubt in the manager's mind afterwards.",
            "Afterwards, the manager was clear about what mattered.",
            "The manager's assessment afterwards was direct.",
            "The manager gave the press room a straight answer afterwards.",
          ],
          seed,
          "aftermath"
        ),
        quote: match.comment.trim(),
      };
    }
    if (match.commentRefused) {
      return {
        line: pick(
          [
            `${input.managerName} answered nothing afterwards, and left the ground without stopping.`,
            `No comment from ${input.managerName}, who waved the questions away.`,
            `${input.managerName} refused to be drawn on it and was gone.`,
            `The press asked ${input.managerName} for a word. They did not get one.`,
            `${input.managerName} declined to speak afterwards.`,
          ],
          seed,
          "refusal"
        ),
        quote: null,
      };
    }
    return { line: "", quote: null };
  };

/**
 * The match report's own paragraph.
 *
 * Declared beside its only caller rather than at the bottom of the file with the other helpers: the shape
 * of a match is the shape of this paragraph, and the two are read together or not at all.
 *
 * THE FIRST VERSION WAS A LIST. It concatenated three independent sentences - who scored, who else
 * conceded, who the manager noticed - in one of two orders, which produced copy like
 *
 *   "I. Olaofe got the goals. J. Koroma, I. Olaofe and C. PatiÃ±o drew the eye above all."
 *
 * and that is not a report. It names the same player twice in two sentences, it says nothing the
 * scoreline did not already say, and it has no view of the match in it at all.
 *
 * This composes instead: one sentence that carries the result and HOW it was won, chosen from a set of
 * openings picked by the match's own shape (the margin, whether the defence held, how many players
 * scored, whether the goals came late, who was singled out), and then at most one more sentence adding
 * something the opening could not say. The manager's own line follows it.
 *
 * The situational keys are the important part. A 4-0 and a 1-0 are different reports, a clean sheet
 * changes what the defence is doing in the sentence, and a match with five different scorers is not a
 * match with one, so the wording is selected by the facts rather than shuffled among them.
 */
function matchReportBody(
  input: NewsInput,
  last: NewsMatch,
  scorers: { name: string; goals: number }[],
  saidLine: string
): string {
  const seed = last.eventId;
  const club = input.clubName;
  const against = opponentWord(last);
  const margin = last.goalsFor - last.goalsAgainst;
  const cleanSheet = last.goalsAgainst === 0;
  const score = proseScore(last);
  const cup = isCupCompetition(last.competition) ? (last.competition as string) : null;
  const inCup = cup ? ` in the ${cup}` : "";
  const scorerNames = scorers.map((entry) => entry.name);
  const named = new Set(scorerNames.map(foldName));
  // Singled out players who did NOT score. Naming a scorer twice in one paragraph is exactly what made
  // the first version read like a machine filling in fields.
  const others = last.standouts.filter((name) => !named.has(foldName(name)));
  const at = venueWord(last);
  const where = at.length > 0 ? ` ${at}` : "";
  const decided = decidingGoalMinute(last);
  const sole = soleScorer(last);
  /** A teenager's age is the one detail a report always prints beside the name, and only for a teenager. */
  const ageOf = (name: string) => input.squad.find((player) => sameName(player.name, name))?.age ?? null;
  const tag = (name: string) => {
    const age = ageOf(name);
    return age !== null && age <= 19 ? `${age}-year-old ${name}` : name;
  };

  /**
   * Who scored, and how many, as a clause. Null when the debrief logged the scoreline without a scorer.
   *
   * The count comes from the scorers array rather than from the scoreline, so a player is never credited
   * with a goal the debrief does not record.
   */
  const scorerClause = (() => {
    if (scorers.length === 0) return null;
    if (scorers.length === 1) {
      const only = scorers[0];
      return only.goals === 1 ? `${tag(only.name)} scored` : `${tag(only.name)} scored ${goalTallyWord(only.goals)}`;
    }
    const lead = scorers[0];
    if (lead.goals >= 2) {
      const rest = scorers.slice(1);
      const restGoals = sum(rest.map((entry) => entry.goals));
      return `${tag(lead.name)} scored ${goalTallyWord(lead.goals)} and ${namesList(rest.map((entry) => tag(entry.name)))} ${restGoals === 1 ? "added the other" : "added the rest"}`;
    }
    return `the goals came from ${namesList(scorerNames.map(tag))}`;
  })();

  const openings: string[] = [];

  if (last.goalsFor === 0 && last.goalsAgainst === 0) {
    openings.push(
      `${club} and ${against} drew 0-0${where}${inCup}, and neither side did enough to change it.`,
      `Nothing at either end${where}${inCup}: ${club} and ${against} finished goalless.`,
      `A goalless draw with ${against}${inCup}, and a point each.`
    );
  } else if (last.result === "WIN") {
    const winner =
      decided !== null && sole !== null
        ? `${tag(sole)} got the winner on ${decided} minutes`
        : decided !== null
          ? `the winner came on ${decided} minutes`
          : null;
    if (margin >= 3) {
      openings.push(
        `${club} beat ${against} ${score}${where}${inCup}${cleanSheet ? " without conceding" : ""}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`,
        `A ${score} win${where} over ${against}${inCup}, and it was never in doubt.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`,
        `${capitalise(against)} were beaten ${score}${venueOf(last) === "AWAY" ? " on their own ground" : ""}${inCup}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
    } else if (margin === 2) {
      openings.push(
        `${club} beat ${against} ${score}${where}${inCup}${scorerClause ? `, and ${scorerClause}` : ""}.`,
        `A two-goal win${where} over ${against}${inCup}${cleanSheet ? ", with a clean sheet to go with it" : ""}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
    } else {
      openings.push(
        `${club} beat ${against} ${score}${where}${inCup}${winner ? `, and ${winner}` : scorerClause ? `, and ${scorerClause}` : ""}.`,
        `One goal in it${where}${inCup}, and it went ${club}'s way against ${against}.${winner ? ` ${capitalise(winner)}.` : scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
      if (decided !== null && decided >= 80) {
        openings.push(
          `${club} left it late against ${against}${inCup}. ${capitalise(winner ?? `the winner came on ${decided} minutes`)}, and it finished ${score}.${!winner || !sole ? (scorerClause ? ` ${capitalise(scorerClause)}.` : "") : ""}`
        );
      }
    }
    if (trailedAtAnyPoint(last)) {
      openings.push(
        `${club} came from behind to beat ${against} ${score}${where}${inCup}${scorerClause ? `, and ${scorerClause}` : ""}.`
      );
    }
    if (cup && venueOf(last) === "AWAY") {
      openings.push(`${club} went to ${against}${inCup} and won ${score}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`);
    }
  } else if (last.result === "DRAW") {
    openings.push(
      `${club} drew ${score} with ${against}${where}${inCup}${scorerClause ? `, and ${scorerClause}` : ""}.`,
      `${capitalise(against)} and ${club} could not be separated${inCup}: ${score}${scorerClause ? `, and ${scorerClause}` : ""}.`
    );
    if (trailedAtAnyPoint(last) && !ledAtAnyPoint(last)) {
      openings.push(
        `${club} were behind against ${against} and came back to draw ${score}${inCup}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
    }
    if (ledAtAnyPoint(last) && !trailedAtAnyPoint(last)) {
      openings.push(
        `${club} were ahead against ${against} and had to settle for ${score}${inCup}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
    }
  } else if (last.result === "LOSS") {
    if (last.goalsFor === 0) {
      openings.push(
        `${club} lost ${score} to ${against}${where}${inCup} and did not score.`,
        `${capitalise(against)} beat ${club} ${score}${inCup}, and there was nothing at the other end.`,
        `A ${score} defeat${where} against ${against}${inCup}, without a goal to show for it.`
      );
    } else if (last.goalsFor === 1 && scorers.length === 1) {
      openings.push(
        `${club} lost ${score} to ${against}${where}${inCup}, and ${tag(scorers[0].name)} scored the consolation.`,
        `${capitalise(against)} had too much for ${club}${inCup}. It finished ${score}, and ${tag(scorers[0].name)} got the only reply.`
      );
    } else {
      openings.push(
        `${club} lost ${score} to ${against}${where}${inCup}${scorerClause ? `, though ${scorerClause}` : ""}.`,
        `A ${score} defeat${where} against ${against}${inCup}.${scorerClause ? ` ${capitalise(scorerClause)}, and it was not enough.` : ""}`
      );
    }
    if (ledAtAnyPoint(last)) {
      openings.push(
        `${club} were ahead against ${against} and still lost ${score}${inCup}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`
      );
    }
  } else {
    openings.push(`${fixtureLine(last, club)}.${scorerClause ? ` ${capitalise(scorerClause)}.` : ""}`);
  }

  const opening = pick(openings, seed, "opening");

  // A second sentence, only when it can add something: the players he singled out who did not score.
  const addition =
    others.length > 0
      ? pick(
          last.result === "LOSS"
            ? [
                `${namesList(others)} came out of it with more credit than anybody else in the side.`,
                `The manager picked out ${namesList(others)} afterwards, which in a defeat says something.`,
              ]
            : [
                `${namesList(others)} ${isAre(others.length)} the ${plural(others.length, "name")} the manager came back to afterwards.`,
                `Away from the goals, it was ${namesList(others)} the manager picked out.`,
                `${namesList(others)} did ${hisTheir(others.length)} case no harm at all.`,
              ],
          seed,
          "addition-others"
        )
      : "";

  return tidy([opening, addition, saidLine].filter(Boolean).join(" "));
}

  // ---- 1. The last match, reported straight -------------------------------------------------
  if (last) {
    const scorers = scorerTally(last.scorers);
    const against = opponentWord(last);
    const club = input.clubName;
    const cup = isCupCompetition(last.competition) ? (last.competition as string) : null;
    const sole = soleScorer(last);
    const topScorer = scorers[0] ?? null;
    const surnameOfScorer = topScorer && (sole !== null || topScorer.goals >= 2) ? surnameOf(topScorer.name) : null;
    const headline = pick(
      last.result === "WIN"
        ? [
            fixtureLine(last, club),
            `${club} Beat ${capitalise(against)} ${proseScore(last)}`,
            `${capitalise(against)} Beaten as ${club} Find a Way`,
            ...(cup ? [`${cup}: ${club} See Off ${capitalise(against)}`] : []),
            ...(topScorer && topScorer.goals >= 2 ? [`${topScorer.name} ${topScorer.goals >= 3 ? "Hat-Trick" : "Double"} Sinks ${capitalise(against)}`] : []),
            ...(sole && last.goalsFor === 1 ? [`${sole} the Difference Against ${capitalise(against)}`] : []),
          ]
        : last.result === "LOSS"
          ? [
              fixtureLine(last, club),
              `Defeat for ${club} Against ${capitalise(against)}`,
              `${club} Beaten ${proseScore(last)} by ${capitalise(against)}`,
              ...(cup ? [`${cup} Defeat for ${club}`] : []),
            ]
          : [
              `Honours Even: ${fixtureLine(last, club)}`,
              `${club} Held by ${capitalise(against)}`,
              `All Square Against ${capitalise(against)}`,
              ...(last.goalsFor + last.goalsAgainst >= 4 ? [`${proseScore(last)} and a Point Each`] : []),
            ],
      last.eventId,
      "headline"
    );

    const said = aftermath(last, last.eventId);
    const body = matchReportBody(input, last, scorers, said.line);

    /**
     * The paragraphs the lead report EARNS.
     *
     * The card is the short read and the article is what the reader gets when he opens it, so the article has
     * to add something the card did not say. Each paragraph is guarded by its own fact - every goal timed, a
     * "first since" in the logged record, the game's own shot and expected-goals figures - and a match that
     * has none of them gets no second paragraph rather than a paragraph of padding.
     */
    const earned: string[] = [];
    const unfolding = unfoldingLine(last, club);
    if (unfolding && last.goalsFor + last.goalsAgainst >= 2) earned.push(unfolding);

    const since = firstSinceLine(last);
    if (since) earned.push(since);

    // The shot figures, only when the finishing story is NOT running: that story is about exactly these
    // numbers, and saying them in two places is the same fact printed twice.
    const expectedHere = effectiveExpectedGoals(last);
    const finishingRuns =
      last.shots !== null && expectedHere !== null && Math.abs(last.goalsFor - expectedHere) >= FINISHING_STORY_EDGE;
    if (!finishingRuns && last.shots !== null) {
      const reported = last.expectedGoalsReported;
      const inside = last.shotsInsideBox !== null ? `, ${last.shotsInsideBox} of them from inside the box` : "";
      const xg = reported !== null ? ` The game's own expected-goals figure for them was ${formatExpectedGoals(reported)}.` : "";
      const read =
        last.shots <= 6 && last.result === "WIN"
          ? " It was not a match they dominated, and they did not need to."
          : last.shots >= 15 && last.result !== "WIN"
            ? " That is a lot of shooting for a side that did not win."
            : last.shots <= 6 && last.result === "LOSS"
              ? " It was not a match they ever really got into."
              : "";
      earned.push(`${club} had ${last.shots} ${plural(last.shots, "shot")}${inside}.${xg}${read}`);
    }

    items.push({
      id: `result-${last.eventId}`,
      kind: "MATCH",
      category: last.result === "LOSS" ? "MATCH REPORT" : "TOP STORY",
      tone: last.result === "WIN" ? "GOOD" : last.result === "LOSS" ? "CONCERN" : "NEUTRAL",
      headline,
      tabloidHeadlines:
        last.result === "WIN"
          ? [
              ...(surnameOfScorer ? [`${surnameOfScorer} Does the Damage`, `Take a Bow, ${surnameOfScorer}`] : []),
              ...(last.goalsFor - last.goalsAgainst >= 3 ? [`${capitalise(against)} Torn Apart`, `Rampant ${club}`] : []),
              ...(cup && venueOf(last) === "AWAY" ? [`Cup Shock at ${capitalise(against)}`] : []),
            ]
          : last.result === "LOSS"
            ? [
                ...(last.goalsAgainst - last.goalsFor >= 3 ? [`Humiliation for ${club}`, `${club} Taken Apart`] : []),
                `Misery for ${club}`,
              ]
            : [`Stalemate`, `Stuck at ${proseScore(last)}`],
      body,
      ...(earned.length > 0 ? { article: earned.slice(0, 2) } : {}),
      states: ["match:" + last.eventId],
      evidence: [
        `Scoreline ${scoreOf(last)}`,
        last.competition ? `Competition ${last.competition}` : "",
        last.venue ? `Venue ${last.venue}` : "",
        last.matchDate ? `Your debrief is dated ${last.matchDate}` : "",
        matchStatsNote(last),
        last.comment !== null && last.comment.trim().length > 0
          ? "You gave the media a comment"
          : last.commentRefused
            ? "You declined to comment"
            : "",
      ].filter(Boolean),
      playerNames: [...new Set([...scorers.map((entry) => entry.name), ...last.standouts])],
      publishedOn: last.matchDate,
      weight: 100,
      quote: said.quote,
    });

    // ---- 2. The clean sheet, credited to whoever earned it ------------------------------------
    // A clean sheet is a defensive team achievement and the paper says so. Who gets the credit follows
    // who the manager singled out: a goalkeeper, defenders, both, or nobody in particular, in which case
    // the back line as a whole takes it. Never the keeper by default.
    /**
     * The clean sheet, and the two cases where it is not worth printing at all.
     *
     * It has to ADD something the paper does not already say. A shutout with nobody singled out, in a match
     * with no run behind it, is the scoreline - and the report above already carries that. And a keeper on a
     * run of three shutouts is the subject of its own story further down the paper, so printing both is the
     * same news in two voices, which is how a paper starts to feel like a machine.
     */
    const shutoutsInWindow = recent.filter((match) => match.goalsAgainst === 0).length;
    const shutoutRunStory = keeper !== null && recent.length >= 3 && shutoutsInWindow >= 3;
    const singledInDefence = last.standouts.filter((name) => {
      const group = roleGroup(roleOf(name));
      return group === "GK" || group === "DEF";
    });
    if (
      last.goalsAgainst === 0 &&
      !shutoutRunStory &&
      (singledInDefence.length > 0 || shutoutsInWindow >= 2)
    ) {
      const shutouts = shutoutsInWindow;
      const singled = singledInDefence;
      const keeperSingled = singled.filter((name) => roleGroup(roleOf(name)) === "GK");
      const defendersSingled = singled.filter((name) => roleGroup(roleOf(name)) === "DEF");
      const backLine = input.squad
        .filter((player) => roleGroup(player.role) === "DEF")
        .map((player) => player.name);
      const against = opponentWord(last);
      /**
       * Whether the match before this one was also a clean sheet.
       *
       * "Another Blank Sheet" is a claim about the previous match, and the first version made it whenever
       * the keeper was singled out in any shutout - including the first one of a season, which it was not
       * another of. The previous match is read from the feed, and a first shutout says so.
       */
      const previous = input.matches[1] ?? null;
      const backToBack = previous !== null && previous.goalsAgainst === 0;
      /**
       * The run, only once there is a window to report it over.
       *
       * With one or two matches logged there is no run to speak of, and "one clean sheet in the last one
       * match" is a worse sentence than the honest short version.
       */
      const runNote =
        recent.length >= 3
          ? shutouts === recent.length
            ? `${countWord(shutouts)} clean ${plural(shutouts, "sheet")} in a row`
            : `${countWord(shutouts)} clean ${plural(shutouts, "sheet")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}`
          : `${countWord(shutouts)} clean ${plural(shutouts, "sheet")} so far`;
      /** The keeper's own version of it, which is what a paper says about a goalkeeper rather than a team. */
      const keeperRun =
        recent.length >= 2
          ? `clean ${plural(shutouts, "sheet")} in ${countWord(shutouts)} of the last ${recent.length}`
          : "a clean sheet";

      const credit =
        keeperSingled.length > 0 && defendersSingled.length > 0
          ? {
              who: [...keeperSingled, ...defendersSingled],
              headline: [
                `${namesList([...keeperSingled, ...defendersSingled])} Share the Clean Sheet`,
                `Keeper and Back Line Both Earn It Against ${against}`,
                `A Shutout Built from the Back: ${capitalise(against)} Kept Out`,
              ],
              body: `${namesList(keeperSingled)} had little that was routine and plenty that was not, and ${namesList(defendersSingled)} in front of him were the reason why. That is ${runNote}.`,
            }
          : keeperSingled.length > 0
            ? {
                who: keeperSingled,
                headline: [
                  `${namesList(keeperSingled)} Keeps ${against} Out`,
                  backToBack
                    ? `Another Blank Sheet: ${namesList(keeperSingled)} Adds to the Shutouts`
                    : `${namesList(keeperSingled)} and a Shutout to Build On`,
                  `${namesList(keeperSingled)} Posts the Shutout Against ${against}`,
                ],
                body: `Nothing got past ${namesList(keeperSingled)}, which is ${keeperRun}.${backToBack ? " That is two matches running without conceding." : ""} The back four will take their share of it too, whether or not anybody writes it down.`,
              }
            : defendersSingled.length > 0
              ? {
                  who: defendersSingled,
                  headline: [
                    `${namesList(defendersSingled)} Built the Clean Sheet`,
                    `The Back Line Holds: ${capitalise(against)} Kept Out`,
                    `${namesList(defendersSingled)} and a Defence That Would Not Bend`,
                  ],
                  body: `${input.clubName} conceded nothing against ${against}, and it was ${namesList(defendersSingled)} the manager picked out afterwards. A defence doing that is worth as much as a goal at the other end: ${runNote}.`,
                }
              : {
                  who: backLine.slice(0, 3),
                  headline: [
                    `The Back Line Takes the Credit Against ${against}`,
                    `Nothing Past ${input.clubName} Again`,
                    `A Clean Sheet Built by Committee`,
                  ],
                  body: `${input.clubName} conceded nothing against ${against}. That is ${runNote}, and while the goalkeeper will get the headlines, the work starts in front of him.`,
                };

      items.push({
        id: `clean-sheet-${last.eventId}`,
        ...(recent.filter((match) => match.goalsAgainst === 0).length >= 2
          ? {
              article: [
                `The clean sheets in the run came in ${resultsLine(recent.filter((match) => match.goalsAgainst === 0))}.`,
              ],
            }
          : {}),
        kind: "MATCH",
        category: "THIS JUST IN",
        tone: "GOOD",
        headline: pick(credit.headline, last.eventId, "headline"),
        body: credit.body,
        evidence: [
          "0 conceded",
          runNote,
          keeper ? `Your recorded keeper is ${keeper.name}` : "",
          singled.length > 0
            ? `You singled out ${namesList(singled)}`
            : "No defender or keeper was singled out in the debrief",
        ].filter(Boolean),
        playerNames: credit.who,
        publishedOn: last.matchDate,
        weight: 92,
        quote: null,
      });
    }

    // ---- 3. The finishing question, from the shots the manager logged -------------------------
    // Two ways to argue from, and the better one wins. The manager types the game's own expected goals off the
    // Match Facts Summary screen, and when a debrief has it that figure is what this argues from. Failing that,
    // the app's two rounded weights stand in for a row logged before that box existed, and the story says so
    // rather than quietly mixing the two, because "you finished ahead of it by 1.4" means different things
    // from each source.
    const expected = effectiveExpectedGoals(last);
    const fromTheGame = expectedGoalsSource(last) === "REPORTED";
    if (last.shots !== null && expected !== null) {
      const edge = last.goalsFor - expected;
      if (Math.abs(edge) >= FINISHING_STORY_EDGE) {
        const clinical = edge > 0;
        /**
         * The verdict has to agree with the result.
         *
         * Finishing above expectation is a real thing in a defeat, and a different story from doing it in
         * a win - so the pools are keyed on both. The first version printed "the figures behind the 2-0
         * win" under any result, including the ones that were not wins at all.
         */
        const goalsWord = plural(last.goalsFor, "Goal", "Goals");
        const afterTheResult =
          last.result === "WIN"
            ? ""
            : last.result === "LOSS"
              ? " It was not enough to save the match."
              : " A point was all it bought them.";
        items.push({
          id: `finishing-${last.eventId}`,
          ...(fromTheGame
            ? {
                article: [
                  `The game's own expected-goals figure was ${formatExpectedGoals(expected)}. ${
                    clinical
                      ? `Scoring ${last.goalsFor} from that is finishing above the chances, and it does not happen every week.`
                      : `Scoring ${last.goalsFor} from that is finishing below the chances, and over a season that is the difference between places in the table.`
                  }`,
                ],
              }
            : {}),
          kind: "MATCH",
          category: "ANALYSIS",
          tone: clinical ? "GOOD" : "CONCERN",
          headline: pick(
            clinical
              ? [
                  `${input.clubName} Make Their Chances Count`,
                  `Clinical: ${last.goalsFor} ${goalsWord} from ${last.shots} Shots`,
                  last.result === "WIN"
                    ? `The Shooting Figures Behind the ${scoreOf(last)} Win`
                    : last.result === "LOSS"
                      ? `Sharp in Front of Goal, and Beaten Anyway`
                      : `Sharp in Front of Goal, and Only a Point`,
                  `Ruthless ${input.clubName} Do Not Waste a Chance`,
                ]
              : [
                  `${input.clubName} Waste the Openings`,
                  `${last.shots} Shots, ${last.goalsFor} ${goalsWord}`,
                  `A Question of Finishing After ${proseScore(last)}`,
                  `All Those Chances and Nothing to Show`,
                ],
            last.eventId,
            "headline"
          ),
          body: pick(
            clinical
              ? [
                  `${last.shots} shots produced ${last.goalsFor} ${plural(last.goalsFor, "goal")}, and the shot count alone does not explain that. ${input.clubName} took the chances that mattered and let the rest go.${afterTheResult}`,
                  `It was not a barrage. It was ${last.shots} shots and ${last.goalsFor} ${plural(last.goalsFor, "goal")}, and that is the ratio every manager says they want.${afterTheResult}`,
                ]
              : [
                  `${last.shots} shots produced ${last.goalsFor} ${plural(last.goalsFor, "goal")}, and the shot count alone does not explain that. On another day ${input.clubName} win this comfortably.`,
                  `There were ${last.shots} shots. There was ${last.goalsFor} ${plural(last.goalsFor, "goal")}. Whatever else went right, that is the number that will be discussed.`,
                ],
            last.eventId,
            "body"
          ),
          evidence: [
            `${last.shots} shots`,
            last.shotsInsideBox !== null ? `${last.shotsInsideBox} from inside the box` : "",
            fromTheGame
              ? `The game's own expected goals was ${formatExpectedGoals(expected)}, so you finished ${clinical ? "ahead of" : "behind"} it by ${formatExpectedGoals(Math.abs(edge))}`
              // The only place the model is still named, and it says where its figure came from rather than
              // presenting an estimate as a reading.
              : `Estimated from earlier counts: the app's model made that worth ${expected.toFixed(1)} goals, so you finished ${clinical ? "ahead of" : "behind"} it by ${Math.abs(edge).toFixed(1)}`,
          ].filter(Boolean),
          playerNames: [],
          publishedOn: last.matchDate,
          weight: 74,
          quote: null,
        });
      }
    }

    // ---- 4. When the goals come ---------------------------------------------------------------
    const allGoalMinutes = recent.flatMap((match) => match.goalMinutes);
    if (allGoalMinutes.length >= 4) {
      const early = earlyGoals(allGoalMinutes);
      const late = lateGoals(allGoalMinutes);
      if (early >= 3 || late >= 3) {
        const earlyStory = early >= late;
        items.push({
          id: `timing-${last.eventId}`,
          article: [
            `${capitalise(
              namesList(
                recent
                  .filter((match) => (earlyStory ? earlyGoals(match.goalMinutes) : lateGoals(match.goalMinutes)) > 0)
                  .slice(0, 3)
                  .map(
                    (match) =>
                      `${match.goalMinutes.filter((minute) => (earlyStory ? minute <= 25 : minute >= 75)).join(" and ")} minutes against ${opponentWord(match)}`
                  )
              )
            )}.`,
          ],
          kind: "MATCH",
          category: "ANALYSIS",
          tone: "NEUTRAL",
          headline: pick(
            earlyStory
              ? [
                  `${input.clubName} Start Fast`,
                  `Early Doors: ${early} of ${allGoalMinutes.length} Goals Inside 25 Minutes`,
                  `The Case for the Quick Start`,
                  `Out of the Blocks Before Anyone Settles`,
                ]
              : [
                  `Late Show from ${input.clubName}`,
                  `${late} of ${allGoalMinutes.length} Goals After 75 Minutes`,
                  `${input.clubName} Save It for the Finish`,
                  `The Goals Arrive When the Legs Go`,
                ],
            last.eventId,
            "headline"
          ),
          body: `Across the last ${recent.length} ${plural(recent.length, "match", "matches")} the goals have clustered ${earlyStory ? "early" : "late"}: ${earlyStory ? early : late} of the ${allGoalMinutes.length} came ${earlyStory ? "inside the first 25 minutes" : "after the 75th minute"}. Whether that is a plan or a habit, it is the pattern.`,
          evidence: [
            `${allGoalMinutes.length} goals logged with minutes`,
            `${early} inside 25 minutes`,
            `${late} after 75 minutes`,
          ],
          playerNames: [],
          publishedOn: last.matchDate,
          weight: 60,
          quote: null,
        });
      }
    }
  }

  // ---- 5. The run of form -------------------------------------------------------------------
  if (recent.length >= 3) {
    const losses = recent.filter((match) => match.result === "LOSS").length;
    const unbeaten = recent.findIndex((match) => match.result === "LOSS");
    const winless = recent.findIndex((match) => match.result === "WIN");
    const run = unbeaten === -1 ? recent.length : unbeaten;

    if (run >= 3) {
      /**
       * The run counted inside itself, not across the whole window.
       *
       * The first version counted wins over all five matches and then reported them against a shorter
       * run: "the last 4 matches have brought 3 wins and no defeat", with a form string underneath it
       * that showed only two. The tally has to come from the same matches the sentence is about.
       */
      const slice = recent.slice(0, run);
      const wins = slice.filter((match) => match.result === "WIN").length;
      const draws = run - wins;
      /**
       * When the run began, from the oldest match in it.
       *
       * The month is the one thing a paper can say about the calendar without guessing, because the debrief
       * carries its own date. The oldest match in the slice is the far end of it, which is where a run
       * starts.
       */
      const began = momentOf(slice[slice.length - 1].matchDate);
      const tallyWords =
        wins > 0 && draws > 0
          ? `${countWord(wins)} ${plural(wins, "win")} and ${countWord(draws)} ${plural(draws, "draw")}`
          : wins > 0
            ? `${countWord(wins)} ${plural(wins, "win")} and no defeat`
            : `${countWord(draws)} ${plural(draws, "draw")} and no defeat`;
      items.push({
        id: `form-unbeaten-${recent[0].eventId}`,
        states: ["run"],
        article: [`In order: ${resultsLine(slice)}.`],
        kind: "FORM",
        category: "FORM WATCH",
        tone: "GOOD",
        headline: pick(
          [
            `Unbeaten in ${run}: ${input.clubName} Building`,
            `${input.clubName} Unbeaten in ${run}`,
            `No Defeat in ${run} for ${input.clubName}`,
            `Hard to Beat, and Starting to Look It`,
          ],
          recent[0].eventId,
          "headline"
        ),
        body: `${input.clubName} have gone ${countWord(run)} ${plural(run, "match", "matches")} without defeat: ${tallyWords}.${began ? ` The run goes back to ${began.month}.` : ""}`,
        evidence: [`Run ${formString(slice)}`, tallyWords],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 88,
        quote: null,
      });
    } else if (winless === -1 && losses >= 3) {
      items.push({
        id: `form-winless-${recent[0].eventId}`,
        states: ["run"],
        article: [`In order: ${resultsLine(recent)}.`],
        kind: "FORM",
        category: "FORM WATCH",
        tone: "CONCERN",
        headline: pick(
          [
            `${losses} Defeats in ${recent.length}: the Pressure Builds`,
            `${input.clubName} Searching for a Result`,
            `No Win in ${recent.length} for ${input.clubName}`,
            `The Table Is Turning and ${input.clubName} Are Not`,
          ],
          recent[0].eventId,
          "headline"
        ),
        body: `The last ${recent.length} ${plural(recent.length, "match", "matches")} have brought ${formWords(recent)}, and no win at all. The questions will not go away until that changes.`,
        evidence: [`Run ${formString(recent)}`, `${losses} ${plural(losses, "defeat")}`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 86,
        quote: null,
      });
    }
  }

  // ---- 5b. Home and away, which are two different teams some seasons -------------------------
  if (recent.length >= 4) {
    const home = recent.filter((match) => (match.venue ?? "").toUpperCase() === "HOME");
    const away = recent.filter((match) => (match.venue ?? "").toUpperCase() === "AWAY");
    if (home.length >= 3 && home.every((match) => match.result !== "LOSS")) {
      items.push({
        id: `home-form-${recent[0].eventId}`,
        article: [`At home, in order: ${resultsLine(home)}.`],
        kind: "FORM",
        category: "FORM WATCH",
        tone: "GOOD",
        headline: pick(
          [
            `${home.length} at Home and Nobody Has Beaten Them`,
            `A Fortress at ${input.clubName}`,
            `Home Comforts: ${input.clubName} Unbeaten in ${home.length}`,
          ],
          `home${recent[0].eventId}`,
          "headline"
        ),
        body: `${capitalise(countWord(home.length))} home ${plural(home.length, "match", "matches")} and no defeat: ${formWords(home)}. On their own ground ${input.clubName} have become awkward opponents.`,
        evidence: [`Home run ${formString(home)}`, `${home.length} home matches in the window`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 66,
        quote: null,
      });
    }
    const awayWins = away.filter((match) => match.result === "WIN").length;
    if (away.length >= 3 && awayWins === 0) {
      items.push({
        id: `away-form-${recent[0].eventId}`,
        article: [`On the road, in order: ${resultsLine(away)}.`],
        kind: "FORM",
        category: "FORM WATCH",
        tone: "CONCERN",
        headline: pick(
          [
            `No Win on the Road in ${away.length}`,
            `The Travelling Problem`,
            `${input.clubName} Take Nothing Away from Home`,
          ],
          `away${recent[0].eventId}`,
          "headline"
        ),
        body: `${capitalise(formWords(away))} across the last ${away.length} away ${plural(away.length, "match", "matches")}. Whatever is working at home is not surviving the journey.`,
        evidence: [`Away run ${formString(away)}`, `${away.length} away matches in the window`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 64,
        quote: null,
      });
    }
  }

  // ---- 6. A goalscorer's streak --------------------------------------------------------------
  if (recent.length >= 3) {
    const tallies = input.squad
      .map((player) => ({ player, goals: goalsIn(recent, player.name) }))
      .sort((left, right) => right.goals - left.goals);
    const topScorer = tallies[0];
    if (topScorer && topScorer.goals >= 3) {
      const scoring = recent.filter((entry) =>
        entry.scorers.some((scorer) => sameName(scorer, topScorer.player.name))
      ).length;
      items.push({
        id: `scorer-${topScorer.player.name}-${recent[0].eventId}`,
        article: [
          `${capitalise(
            namesList(
              [...recent]
                .reverse()
                .map((match) => ({ match, goals: match.scorers.filter((name) => sameName(name, topScorer.player.name)).length }))
                .filter((entry) => entry.goals > 0)
                .map((entry) => `${entry.goals === 1 ? "one" : countWord(entry.goals)} against ${opponentWord(entry.match)}`)
            )
          )}.${
            (() => {
              const team = sum(recent.map((match) => match.goalsFor));
              return team > 0 ? ` That is ${topScorer.goals} of the ${team} ${input.clubName} have scored in the run.` : "";
            })()
          }`,
        ],
        kind: "PLAYER",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [
            `${topScorer.goals} in ${recent.length}: ${topScorer.player.name} Cannot Stop Scoring`,
            `${topScorer.player.name} on ${topScorer.goals} Goals`,
            `The Goals Keep Coming for ${topScorer.player.name}`,
            `${topScorer.player.name} Is the One They Fear`,
          ],
          `${topScorer.player.name}${recent[0].eventId}`,
          "headline"
        ),
        body: `${topScorer.player.name} has ${topScorer.goals} ${plural(topScorer.goals, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}, scoring in ${scoring} of them. On this form he is the first name on the sheet.`,
        evidence: [
          `${topScorer.goals} goals in ${recent.length} matches`,
          `Scored in ${scoring} of them`,
        ],
        playerNames: [topScorer.player.name],
        publishedOn: recent[0].matchDate,
        weight: 84,
        quote: null,
      });
    }
  }

  // ---- 7. The supplier ----------------------------------------------------------------------
  if (recent.length >= 3) {
    const assists = input.squad
      .map((player) => ({ player, assists: assistsIn(recent, player.name) }))
      .sort((left, right) => right.assists - left.assists);
    const best = assists[0];
    if (best && best.assists >= 3) {
      items.push({
        id: `assists-${best.player.name}-${recent[0].eventId}`,
        article: [
          `${capitalise(
            namesList(
              [...recent]
                .reverse()
                .map((match) => ({ match, made: match.assisters.filter((name) => sameName(name, best.player.name)).length }))
                .filter((entry) => entry.made > 0)
                .map((entry) => `${entry.made === 1 ? "one" : countWord(entry.made)} against ${opponentWord(entry.match)}`)
            )
          )}. ${(() => {
            const fed = scorerTally(
              recent.flatMap((match) =>
                match.assisters.some((name) => sameName(name, best.player.name)) ? match.scorers : []
              )
            ).filter((entry) => !sameName(entry.name, best.player.name))[0];
            return fed ? `${fed.name} has been the main beneficiary, scoring in the same matches.` : "";
          })()}`,
        ],
        kind: "PLAYER",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [
            `${best.player.name} the Supplier with ${best.assists} Assists`,
            `Everything Goes Through ${best.player.name}`,
            `${best.assists} Assists in ${recent.length} for ${best.player.name}`,
            `The Man Who Makes It Happen`,
          ],
          `${best.player.name}-assists-${recent[0].eventId}`,
          "headline"
        ),
        body: `${best.assists} ${plural(best.assists, "assist")} in the last ${recent.length} ${plural(recent.length, "match", "matches")} make ${best.player.name} the man his team-mates are looking for.`,
        evidence: [`${best.assists} assists in ${recent.length} matches`],
        playerNames: [best.player.name],
        publishedOn: recent[0].matchDate,
        weight: 78,
        quote: null,
      });
    }
  }

  // ---- 8. The player the manager keeps praising ---------------------------------------------
  if (recent.length >= 3) {
    const mentions = new Map<string, { name: string; count: number }>();
    for (const entry of recent) {
      for (const name of entry.standouts) {
        const key = foldName(name);
        const existing = mentions.get(key);
        if (existing) existing.count += 1;
        else mentions.set(key, { name, count: 1 });
      }
    }
    const praised = [...mentions.values()].sort((left, right) => right.count - left.count)[0];
    if (praised && praised.count >= 2) {
      items.push({
        id: `standout-${praised.name}-${recent[0].eventId}`,
        article: [
          `The matches: ${resultsLine(recent.filter((match) => match.standouts.some((name) => sameName(name, praised.name))))}.`,
        ],
        kind: "PLAYER",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [
            `${praised.name} Singled Out Again`,
            `${praised.name} the Recurring Standout`,
            `Twice Praised: ${praised.name} Earns the Nod`,
            `${praised.name} Is the Name That Keeps Coming Back`,
          ],
          `${praised.name}-standout-${recent[0].eventId}`,
          "headline"
        ),
        body: pick(
          [
            `${praised.name} has been the manager's pick in ${praised.count} of the last ${recent.length} ${plural(recent.length, "match", "matches")}. Praise repeated that often is a verdict.`,
            `${source(recent[0].eventId, "standout-source")} keep coming back to the same name: ${praised.name}, picked out in ${praised.count} of the last ${recent.length}.`,
          ],
          `${praised.name}${recent[0].eventId}`,
          "body"
        ),
        evidence: [`${praised.count} standout mentions in ${recent.length} matches`],
        playerNames: [praised.name],
        publishedOn: recent[0].matchDate,
        weight: 72,
        quote: null,
      });
    }
  }

  // ---- 8b. The angles a paper runs because it likes a running joke ----------------------------
  // Declared in their own function rather than inlined here: there are seven of them, they are all the
  // same shape, and the note above `playerColourStories` explains what they will and will not say.
  items.push(...playerColourStories(input, recent));

  // ---- 9. The weakness the manager keeps naming ---------------------------------------------
  if (recent.length >= 2) {
    /**
     * The recurring note, counted on its NORMALISED form.
     *
     * The manager types these by hand and types them slightly differently each time - a capital, a full
     * stop, a double space - so counting the raw strings splits one recurring concern into three and the
     * story never fires. Normalising first is what makes "keeps naming" mean keeps naming.
     */
    const counts = new Map<string, { text: string; count: number; theme: string | null }>();
    for (const match of recent) {
      if (!match.weakness || match.weakness.trim().length === 0) continue;
      const key = normaliseNote(match.weakness);
      if (key.length === 0) continue;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { text: key, count: 1, theme: weaknessFamily(match.weakness)?.line ?? null });
    }
    const recurring = [...counts.values()].sort((left, right) => right.count - left.count)[0];
    const conceded = sum(recent.map((match) => match.goalsAgainst));
    if (recurring && recurring.count >= 2 && conceded > 0) {
      const times = recurring.count;
      const occurrence =
        times === 2 ? "second" : times === 3 ? "third" : times === 4 ? "fourth" : `${times}th`;
      /**
       * What the paper says the pattern is.
       *
       * The manager's own words never reach the page. A note to self is not a sentence in a newspaper,
       * and printing it verbatim is the single most obvious way this desk could read as an app quoting a
       * field. The family supplies the wording; a note that matches no family gets the general line.
       */
      const theme = recurring.theme ?? "the same shortcoming";
      items.push({
        id: `weakness-${weaknessFamily(recurring.text)?.key ?? "recurring"}-${recent[0].eventId}`,
        article: [
          `It came up after ${resultsLine(recent.filter((match) => match.weakness && normaliseNote(match.weakness) === recurring.text))}.`,
        ],
        kind: "FORM",
        category: "THE VERDICT",
        tone: "CONCERN",
        headline: pick(
          [
            `The Same Question, ${countWord(times)} Matches Running`,
            `A Pattern ${times} Matches Long`,
            `The Same Concern, and No Sign of It Going`,
            `${capitalise(countWord(times))} Matches, One Recurring Problem`,
          ],
          `${recurring.text}${recent[0].eventId}`,
          "headline"
        ),
        body: `For the ${occurrence} time in ${recent.length} ${plural(recent.length, "match", "matches")} the manager's own note came back to ${theme}. ${conceded} conceded in that run says the concern is not going away on its own.`,
        evidence: [
          `Named in ${times} of the last ${recent.length} matches`,
          `Conceded ${conceded} in the run`,
          recurring.theme ? `Theme: ${recurring.theme}` : "The note matches no theme the desk knows",
        ],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 70,
        quote: null,
      });
    }
  }

  // ---- 10. The attacking and defensive summary over the window -------------------------------
  if (recent.length >= 3) {
    const scored = sum(recent.map((match) => match.goalsFor));
    const conceded = sum(recent.map((match) => match.goalsAgainst));
    if (scored >= recent.length * 2) {
      items.push({
        id: `goals-${recent[0].eventId}`,
        states: ["run"],
        article: [
          (() => {
            const best = [...recent].sort((left, right) => right.goalsFor - left.goalsFor)[0];
            return `The most came in ${resultPhrase(best)}. That is ${(scored / recent.length).toFixed(1)} a game across the run.`;
          })(),
        ],
        kind: "FORM",
        category: "FORM WATCH",
        tone: "GOOD",
        headline: pick(
          [
            `${scored} Goals in ${recent.length} ${plural(recent.length, "Match", "Matches")}`,
            `${input.clubName} Scoring Freely`,
            `The Goals Are Flowing at ${input.clubName}`,
            `No Shortage of Goals at ${input.clubName}`,
          ],
          `goals${recent[0].eventId}`,
          "headline"
        ),
        body: `${scored} goals scored and ${conceded} conceded across the last ${recent.length} ${plural(recent.length, "match", "matches")}. Whatever else is in question, ${input.clubName} are not short of a goal.`,
        evidence: [`Goals for ${scored}`, `Goals against ${conceded}`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 64,
        quote: null,
      });
    } else if (conceded >= recent.length * 2) {
      items.push({
        article: [
          (() => {
            const worst = [...recent].sort((left, right) => right.goalsAgainst - left.goalsAgainst)[0];
            const shutouts = recent.filter((match) => match.goalsAgainst === 0).length;
            return `The worst of it was ${resultPhrase(worst)}. ${shutouts === 0 ? "There has not been a clean sheet in the run." : `There ${shutouts === 1 ? "has been one clean sheet" : `have been ${countWord(shutouts)} clean sheets`} in it, which makes the rest look worse.`}`;
          })(),
        ],
        id: `leak-${recent[0].eventId}`,
        kind: "FORM",
        category: "THE VERDICT",
        tone: "CONCERN",
        headline: pick(
          [
            `${conceded} Conceded in ${recent.length}: the Leak`,
            `${input.clubName} Letting Them In`,
            `${conceded} Against in ${recent.length}`,
            `The Back Door Is Open`,
          ],
          `leak${recent[0].eventId}`,
          "headline"
        ),
        body: `${conceded} goals conceded in ${recent.length} ${plural(recent.length, "match", "matches")} is ${(conceded / recent.length).toFixed(1)} a game. ${keeper ? `${keeper.name} can only do so much behind that.` : "That is a problem for the whole side."}`,
        evidence: [`Goals against ${conceded}`, `${(conceded / recent.length).toFixed(1)} per match`],
        playerNames: keeper ? [keeper.name] : [],
        publishedOn: recent[0].matchDate,
        weight: 68,
        quote: null,
      });
    }
  }

  // ---- 11. A margin worth a headline --------------------------------------------------------
  /**
   * The biggest winning or losing margin in the window, if there is one.
   *
   * NOT the match already reported. The lead story covers the latest result in full, and writing the margin
   * story about the same ninety minutes prints the same afternoon twice - once as news and once as a rout,
   * with the manager's own comment quoted in both. So the match the paper already led on is skipped, and a
   * career whose only heavy result is its most recent one simply does not get this story.
   */
  const heavy = input.matches.find(
    (match) =>
      Math.abs(match.goalsFor - match.goalsAgainst) >= 3 && match.eventId !== last?.eventId
  );
  if (heavy && recent.includes(heavy)) {
    const won = heavy.goalsFor > heavy.goalsAgainst;
    const heavyAgainst = opponentWord(heavy);
    items.push({
      id: `margin-${heavy.eventId}`,
      kind: "MATCH",
      category: won ? "TOP STORY" : "THE VERDICT",
      tone: won ? "GOOD" : "CONCERN",
      headline: won
        ? pick(
            [
              `Rout: ${fixtureLine(heavy, input.clubName)}`,
              `No Contest: ${input.clubName} See Off ${heavyAgainst}`,
              `A Statement: ${fixtureLine(heavy, input.clubName)}`,
            ],
            heavy.eventId,
            "headline-margin"
          )
        : pick(
            [
              `Heavy Defeat: ${fixtureLine(heavy, input.clubName)}`,
              `${input.clubName} Beaten Heavily by ${heavyAgainst}`,
              `${proseScore(heavy)}: a Scoreline That Will Be Remembered`,
            ],
            heavy.eventId,
            "headline-margin"
          ),
      body: (() => {
        // What has happened SINCE, which is the only reason to bring an older result back up at all.
        const after = input.matches.slice(0, input.matches.indexOf(heavy));
        const heavyMargin = Math.abs(heavy.goalsFor - heavy.goalsAgainst);
        const day = momentOf(heavy.matchDate);
        const when = day ? ` in ${day.month}` : "";
        const lead = won
          ? `The ${proseScore(heavy)} win over ${heavyAgainst}${when} is still the result of the run.`
          : `The ${proseScore(heavy)} defeat against ${heavyAgainst}${when} is still the one that stings.`;
        const sinceLine =
          after.length > 0
            ? won
              ? after.every((match) => match.goalsFor - match.goalsAgainst < heavyMargin)
                ? ` Nothing since has come close to it: ${formWords(after)} in the ${countWord(after.length)} ${plural(after.length, "match", "matches")} after.`
                : ""
              : ` The response since has been ${formWords(after)}.`
            : "";
        return `${lead}${sinceLine}`;
      })(),
      evidence: [
        `Scoreline ${scoreOf(heavy)}`,
        `Margin ${Math.abs(heavy.goalsFor - heavy.goalsAgainst)}`,
        heavy.matchDate ? `Played ${heavy.matchDate}` : "",
      ].filter(Boolean),
      playerNames: heavy.standouts,
      publishedOn: heavy.matchDate,
      weight: 82,
      quote: aftermath(heavy, `margin-${heavy.eventId}`).quote,
    });
  }

  // ---- 12. Contracts in the last year --------------------------------------------------------
  if (input.inGameYear !== null) {
    const year = input.inGameYear;
    const expiring = input.squad
      .filter((player) => player.contractValidUntil !== null && player.contractValidUntil <= year + 1)
      .sort((left, right) => (left.contractValidUntil ?? 0) - (right.contractValidUntil ?? 0));
    if (expiring.length > 0) {
      const soonest = expiring[0];
      // Counted at the same expiry as the soonest one, not across the whole year: "10 deals run out soon"
      // reads as panic when the truth is that one player is out of contract in June and nine are fine.
      const sameYear = expiring.filter(
        (player) => player.contractValidUntil === soonest.contractValidUntil
      ).length;
      const expired = soonest.contractValidUntil !== null && soonest.contractValidUntil <= year;
      items.push({
        id: `contract-${soonest.name}-${soonest.contractValidUntil}`,
        states: ["contracts"],
        ...(() => {
          // The paragraph the card has no room for: the best player among them, and whoever is next after that year.
          const best = [...expiring].sort((left, right) => (right.overall ?? 0) - (left.overall ?? 0))[0];
          const later = expiring.filter((player) => player.contractValidUntil !== soonest.contractValidUntil);
          const lines = [
            sameYear > 1 && best ? `The one the club will least want to lose is ${best.name}.` : "",
            later.length > 0
              ? `After that, ${namesList(later.slice(0, 4).map((player) => player.name))} ${later.length === 1 ? "is" : "are"} out of contract in ${later[0].contractValidUntil}.`
              : "",
          ].filter(Boolean);
          return lines.length > 0 ? { article: [lines.join(" ")] } : {};
        })(),
        kind: "CONTRACT",
        category: "TRANSFER DESK",
        tone: expired ? "CONCERN" : "NEUTRAL",
        headline: pick(
          sameYear === 1
            ? [
                `${soonest.name} Out of Contract in ${soonest.contractValidUntil}`,
                `Talks Needed: ${soonest.name} Free in ${soonest.contractValidUntil}`,
                `Decision Looming on ${soonest.name}`,
                `The Clock Is Running on ${soonest.name}`,
              ]
            : [
                `${capitalise(countWord(sameYear))} Contracts to Sort at ${input.clubName}`,
                `${capitalise(countWord(sameYear))} Deals End in ${soonest.contractValidUntil}`,
                `Talks Needed Before ${soonest.contractValidUntil}`,
              ],
          `${soonest.name}${soonest.contractValidUntil}`,
          "headline"
        ),
        body: pick(
          [
            sameYear === 1
              ? `${soonest.name}'s deal runs out in ${soonest.contractValidUntil}. ${expired ? "That year is already under way, so the clock is not a figure of speech." : "If no new deal is agreed, he can leave for nothing."}`
              : `${capitalise(countWord(sameYear))} deals run out in ${soonest.contractValidUntil}: ${namesList(expiring.filter((player) => player.contractValidUntil === soonest.contractValidUntil).map((player) => player.name))}. ${expired ? "That year is already under way." : "Any of them not renewed by then can leave for nothing."}`,
            sameYear === 1
              ? `${source(`${soonest.name}${soonest.contractValidUntil}`, "contract-source")} have ${soonest.name} down as the next contract to sort: his deal runs to ${soonest.contractValidUntil}.`
              : `${source(`${soonest.name}${soonest.contractValidUntil}`, "contract-source")} have ${countWord(sameYear)} contracts to sort before ${soonest.contractValidUntil} is out: ${namesList(expiring.filter((player) => player.contractValidUntil === soonest.contractValidUntil).map((player) => player.name))}.`,
          ],
          `${soonest.name}${soonest.contractValidUntil}`,
          "body"
        ),
        evidence: [
          `Contract to ${soonest.contractValidUntil}`,
          `${sameYear} ${plural(sameYear, "contract")} expiring that year`,
        ],
        playerNames: expiring.slice(0, 3).map((player) => player.name),
        publishedOn: at,
        weight: expired ? 76 : 66,
        quote: null,
      });
    }
  }

  // ---- 13. A position with nobody in it ------------------------------------------------------
  const byRole = new Map<string, NewsPlayer[]>();
  for (const player of input.squad) {
    const list = byRole.get(player.role) ?? [];
    list.push(player);
    byRole.set(player.role, list);
  }
  const thinnest = [...byRole.entries()]
    .filter(([role]) => roleGroup(role) !== "GK" && role !== "UNKNOWN")
    .sort((left, right) => left[1].length - right[1].length)[0];
  if (thinnest && thinnest[1].length === 1 && input.squad.length >= 11) {
    const only = thinnest[1][0];
    const words = positionWords(thinnest[0]);
    /**
     * Whether the position is one a paper can actually name.
     *
     * `positionWords` falls back to "player" for a code the table does not know, because "a UNKNOWN" is
     * worse than saying nothing. That fallback is no good in a headline, though - "Player Down to One" is
     * not a sentence - so those two frames are dropped rather than filled in.
     */
    const named = words !== "player";
    const seed = `depth${thinnest[0]}`;
    items.push({
      id: `depth-${thinnest[0]}`,
      kind: "SQUAD",
      category: "SQUAD WATCH",
      tone: "CONCERN",
      headline: pick(
        [
          `${only.name} Has No Cover`,
          ...(named
            ? [
                `Only One Senior ${capitalise(words)} at ${input.clubName}`,
                `${capitalise(words)} Down to One`,
              ]
            : []),
          `The Position ${input.clubName} Cannot Afford to Lose`,
          `Nobody Behind ${only.name}`,
        ],
        seed,
        "headline"
      ),
      body: pick(
        [
          `There is exactly one senior ${words} at the club, and it is ${only.name}. One injury and the shape has to change, which is the kind of problem a transfer window exists for.`,
          `${only.name} is the only senior ${words} ${input.managerName} has. Everybody in football knows what happens to a squad that thin in one place: it happens in the week nobody wants it to.`,
          `One senior ${words}, and his name is ${only.name}. It is not a crisis yet, which is exactly why it is worth saying now rather than in the month it becomes one.`,
        ],
        seed,
        "body"
      ),
      article: [
        pick(
          [
            `Cover in that position is either a squad player nobody wants to sell or a young one being asked to grow up quickly. Neither is available on demand, and both cost money the budget may not have.`,
            `The options are the transfer market, a change of shape, or a younger player being handed more than he is ready for. Managers tend to try the last one first, and it tends to be the one that decides whether the season holds.`,
            `It is also the kind of weakness an opponent notices. Two or three matches into an injury and every team-sheet conversation starts with who is playing there.`,
          ],
          seed,
          "article-options"
        ),
      ],
      evidence: [`1 senior ${words}`, `Squad of ${input.squad.length}`],
      playerNames: [only.name],
      publishedOn: at,
      weight: 62,
      quote: null,
    });
  }

  /** The one position with a single senior player, which is where a budget would go first. */
  const depthGap =
    thinnest && thinnest[1].length === 1 && input.squad.length >= 11 && positionWords(thinnest[0]) !== "player"
      ? { words: positionWords(thinnest[0]), name: thinnest[1][0].name }
      : null;

  // ---- 14. The academy ----------------------------------------------------------------------
  // A fifteen year old is a story because of what he is doing on a pitch, not because of a number in a
  // database. So the copy is what the youth team has actually produced, credited to nobody in particular
  // in the way a club denies everything and confirms nothing, and the potential stays in the app's note.
  if (input.academy) {
    const prospect = input.academy;
    const prospectName = prospect.name;
    const ceiling = prospect.potential;
    // A story needs something to be about. Either the lad is doing it on a pitch for the youth team, or he
    // is good enough that the club's own assessment of him is the story. An unrated or unnamed prospect is
    // neither, and a modest prospect with no record is not news at all.
    const hasRecord = (prospect.goals ?? 0) > 0 || (prospect.appearances ?? 0) > 0;
    const notable = hasRecord || (ceiling !== null && ceiling >= 80);
    if (!prospectName || !notable) {
      // An unnamed or unrated prospect cannot carry a story: there is nothing to write and nobody to name.
    } else {
    const youthTeam = prospect.age !== null && prospect.age <= 17 ? "the under-18s" : "the under-21s";
    const record =
      prospect.goals !== null && prospect.appearances !== null && prospect.appearances > 0
        ? `${prospect.goals} ${plural(prospect.goals, "goal")} in ${prospect.appearances} ${plural(prospect.appearances, "game")} for ${youthTeam}`
        : prospect.goals !== null && prospect.goals > 0
          ? `${prospect.goals} ${plural(prospect.goals, "goal")} for ${youthTeam}`
          : null;
    items.push({
      id: `youth-${prospectName}`,
      kind: "PLAYER",
      category: "SCOUTING",
      tone: "GOOD",
      headline: pick(
        [
          `The Name to Remember: ${prospectName}`,
          `${prospectName}, ${prospect.age !== null ? "Just " + prospect.age : "Young"}, and Making Noise`,
          `Academy Watch: ${prospectName}`,
          `They Are Talking About ${prospectName}`,
        ],
        prospectName,
        "headline"
      ),
      body: pick(
        record
          ? [
              `${record}${prospect.age !== null ? `, at ${prospect.age}` : ""}. ${source(prospectName, "youth-source")} are keeping very quiet about ${prospectName}, and that is usually the sign that they think they have something.`,
              `${source(prospectName, "youth-source")} will not be drawn on ${prospectName}, which is understandable: ${record}${prospect.age !== null ? ` at ${prospect.age}` : ""} is the sort of thing that attracts attention from elsewhere.`,
            ]
          : [
              `${source(prospectName, "youth-source")} are keeping very quiet about ${prospectName}${prospect.age !== null ? `, who is ${prospect.age},` : ""} and that is usually the sign that they think they have something.`,
              `There is a name coming out of the academy and nobody at the club wants to say it out loud: ${prospectName}${prospect.age !== null ? `, ${prospect.age}` : ""}.`,
            ],
        prospectName,
        "body"
      ),
      evidence: [
        record ? `Academy record: ${record}` : "No youth-team record in the save",
        prospect.age !== null ? `Age ${prospect.age}` : "",
        `The save rates his ceiling at ${ceiling ?? "nothing"}, which is the app's number and not the paper's`,
      ].filter(Boolean),
      playerNames: [prospectName],
      publishedOn: at,
      weight: 58,
      quote: null,
    });
    }
  }

  // ---- 15. Silverware -----------------------------------------------------------------------
  const latestTrophy = input.trophies[0];
  // A trophy is news in the season it was won and the one after. A cup from three seasons ago is history.
  if (latestTrophy && latestTrophy.season >= input.seasonNumber - 1) {
    items.push({
      id: `trophy-${latestTrophy.name}-${latestTrophy.season}`,
      kind: "TROPHY",
      category: "SILVERWARE",
      tone: "GOOD",
      headline: pick(
        [
          ...(isCupCompetition(latestTrophy.name)
            ? [`${latestTrophy.name} in the Cabinet`, `${input.clubName} Lift the ${latestTrophy.name}`, `Silverware: the ${latestTrophy.name}`]
            : [`${input.clubName} Crowned ${latestTrophy.name} Champions`, `${latestTrophy.name} Champions: ${input.clubName}`, `The ${latestTrophy.name} Title`]),
        ],
        `${latestTrophy.name}${latestTrophy.season}`,
        "headline"
      ),
      body: (() => {
        const won = isCupCompetition(latestTrophy.name)
          ? `${input.clubName} won the ${latestTrophy.name}`
          : `${input.clubName} won the ${latestTrophy.name} title`;
        const when = latestTrophy.season === input.seasonNumber ? "this season" : "last season";
        const count = input.trophies.length;
        return `${won} ${when}. ${count === 1 ? `It is the first honour of ${input.managerName}'s time at the club.` : `That makes ${countWord(count)} honours under ${input.managerName}.`}`;
      })(),
      evidence: [
        `Won in season ${latestTrophy.season}`,
        `${input.trophies.length} ${plural(input.trophies.length, "trophy", "trophies")} in the cabinet`,
      ],
      playerNames: [],
      publishedOn: at,
      weight: 90,
      quote: null,
    });
  }

  // ---- 16. Where the season stands ----------------------------------------------------------
  const completed = input.seasons.filter((season) => season.complete);
  /**
   * The most recent COMPLETED season that is not the one being reported on.
   *
   * Taking the last completed row instead would pick up the current season the moment the save marks it
   * finished, and the story would then print the same position twice under the words "the season before".
   * The comparison is on the save's own season ordinal rather than on array order, so it holds either way.
   */
  const previousSeason =
    [...completed]
      .filter((season) => season.season < input.seasonNumber)
      .sort((left, right) => right.season - left.season)[0] ?? null;
  if (input.position?.value !== null && input.position?.value !== undefined) {
    const position = input.position.value;
    const disputed = input.position.disputed;
    items.push({
      id: `position-${position}-${input.seasonNumber}`,
      states: ["table"],
      kind: "TABLE",
      category: "TABLE WATCH",
      tone: position <= 6 ? "GOOD" : position >= 18 ? "CONCERN" : "NEUTRAL",
      headline: pick(
        position <= 3
          ? [`${input.clubName} ${ordinal(position)} and Climbing`, `Up to ${ordinal(position)} in the ${input.leagueName ?? "table"}`, `${ordinal(position)}: the Table Takes Shape`]
          : position <= 6
            ? [`${ordinal(position)} in the ${input.leagueName ?? "table"}`, `${input.clubName} in the Top Six`, `${ordinal(position)} and in the Mix`]
            : position >= 18
              ? [`${ordinal(position)} and Looking Down`, `${input.clubName} in Trouble at ${ordinal(position)}`, `The Table Is Not Kind at ${ordinal(position)}`]
              : [`${ordinal(position)} in the Table`, `${input.clubName} Mid-Table at ${ordinal(position)}`, `Nothing Settled at ${ordinal(position)}`],
        `position${position}${input.seasonNumber}`,
        "headline"
      ),
      body: (() => {
        const closed = input.seasons.some((season) => season.season === input.seasonNumber && season.complete);
        const league = input.leagueName ? ` in the ${input.leagueName}` : "";
        const before = previousSeason && previousSeason.tablePosition !== null ? previousSeason.tablePosition : null;
        const lead = closed
          ? `${input.clubName} finished ${ordinal(position)}${league}.`
          : `${input.clubName} are ${ordinal(position)}${league}.`;
        const compare =
          before === null
            ? ""
            : before > position
              ? ` That is ${countWord(before - position)} ${plural(before - position, "place")} better than the ${ordinal(before)} of the season before.`
              : before < position
                ? ` The season before ended ${ordinal(before)}, so this is a step back.`
                : ` That is exactly where the season before ended.`;
        return `${lead}${disputed ? " The logged position and the save disagree, so treat it with care." : ""}${compare}`;
      })(),
      evidence: [
        `Position ${position}`,
        input.position.basis ? `Basis ${input.position.basis}` : "",
        previousSeason?.tablePosition ? `Season ${previousSeason.season} ${ordinal(previousSeason.tablePosition)}` : "",
      ].filter(Boolean),
      playerNames: [],
      publishedOn: at,
      weight: 56,
      quote: null,
    });
  }

  // ---- 17. The run the results actually produced --------------------------------------------
  // Not the manager's private target: a paper does not have his workbook. It has the results, and the
  // results are arithmetic anybody can do.
  if (input.block && input.block.gamesPlayed >= 3 && input.block.points !== null) {
    const points = input.block.points;
    const perGame = points / input.block.gamesPlayed;
    /**
     * Where the season is, when the club's own match count and its division's size are both to hand.
     *
     * Approximate, because the count is across all competitions - see the note on `seasonPhase`. It is used
     * only for the kind of sentence a paper writes anyway, which says roughly where the campaign is without
     * claiming a date or a number of games played.
     */
    const atPhase = phasePhrase(seasonPhase(input.progress ?? null));
    items.push({
      id: `block-${input.seasonNumber}-${input.block.gamesPlayed}`,
      states: ["block"],
      ...(input.progress && input.progress.expectedGames > 0
        ? {
            article: [
              `${atPhase ? `${capitalise(atPhase)}, ` : ""}${atPhase ? "over" : "Over"} a full ${input.progress.expectedGames}-game league season that is a ${Math.round(perGame * input.progress.expectedGames)}-point pace.`,
            ],
          }
        : {}),
      kind: "FORM",
      category: "THE PLAN",
      tone: perGame >= 1.6 ? "GOOD" : perGame < 1 ? "CONCERN" : "NEUTRAL",
      headline: pick(
        perGame >= 1.6
          ? [
              `${points} Points from ${input.block.gamesPlayed}: the Run Is Real`,
              `Form of a Side Going Somewhere`,
              `${perGame.toFixed(1)} a Game and Climbing`,
            ]
          : perGame < 1
            ? [
                `${points} Points from ${input.block.gamesPlayed}`,
                `Not Enough: ${perGame.toFixed(1)} a Game`,
                `A Run That Has Not Started`,
              ]
            : [
                `${points} from ${input.block.gamesPlayed} in the Run`,
                `Steady Rather Than Spectacular`,
                `${perGame.toFixed(1)} a Game: Mid-Table Form`,
              ],
        `block${input.seasonNumber}${input.block.gamesPlayed}`,
        "headline"
      ),
      body: `${points} points from the last ${input.block.gamesPlayed} ${plural(input.block.gamesPlayed, "match", "matches")}, at ${perGame.toFixed(1)} a game. ${perGame >= 1.6 ? "Do that for a season and nobody finishes above you." : perGame < 1 ? "Do that for a season and the table says what it says." : "That is the sort of return that keeps a season moving without moving it much."}`,
      evidence: [
        `${points} points from ${input.block.gamesPlayed} logged matches`,
        `${perGame.toFixed(2)} points per match`,
      ],
      playerNames: [],
      publishedOn: at,
      weight: 54,
      quote: null,
    });
  }

  // ---- 18. The club's money ------------------------------------------------------------------
  /**
   * Finance, and the voice all of it has to be written in.
   *
   * Every story here rests on a figure the app DERIVED or the manager TYPED, and on nothing the save reported
   * except the two budgets and the record fees. That is why every sentence about a wage bill or a budget is
   * speculative in form - "understood to be", "the word is", "it is thought" - and why the exact numbers stay
   * in the evidence. A newspaper states a transfer interest as fact precisely once, and then nobody believes
   * it again.
   *
   * The wage bill is the one financial fact with a threshold attached to it, and that threshold comes from the
   * career's own realism mode rather than from a number invented here. See `ADVISORY_THRESHOLDS`.
   */
  const finance = input.finance ?? null;
  if (finance) {
    const wageLine =
      finance.wageFormat === "WEEKLY"
        ? `${moneyBand(finance.squadWeeklyWage, finance.currency)} a week`
        : `${moneyBand(finance.squadAnnualWage, finance.currency)} a year`;
    const turnover = `${moneyBand(finance.estimatedTierRevenue, finance.currency)} a year`;

    // 18a. A wage bill past the threshold its own realism mode sets. Two weights, because "over" and "well
    // over" are different stories and the second one is the board's rather than the manager's.
    if (finance.wageTurnoverLevel === "CRITICAL" || finance.wageTurnoverLevel === "WARNING") {
      const critical = finance.wageTurnoverLevel === "CRITICAL";
      items.push({
        id: `wage-pressure-${input.seasonNumber}`,
        kind: "FINANCE",
        category: "FINANCE",
        tone: "CONCERN",
        headline: pick(
          [
            `${input.clubName} Wage Bill Comes Under the Microscope`,
            `The Wages Are the Story at ${input.clubName}`,
            critical
              ? `${input.clubName} Wage Bill Is a Board Question Now`
              : `Wages Worth Watching at ${input.clubName}`,
            `A Squad Costing More Than the Club Earns`,
          ],
          `wage${input.seasonNumber}${finance.wageTurnoverLevel}`,
          "headline"
        ),
        body: `The squad is understood to cost ${wageLine}, against a turnover this level of the game supports only up to a point. ${critical ? "That is past the point where a board starts asking who sanctioned it, and the manager will not need telling." : "It is not a crisis, and it is the kind of number that becomes one quietly over a season."} Nobody at the club has said anything about it, which is how these are handled until they cannot be.`,
        evidence: [
          `Squad wage ${wageLine} (from the squad's own contract rows)`,
          `Assumed turnover ${turnover} (DERIVED_ESTIMATE)`,
          `Wage to turnover ${(finance.wageToTurnover ?? 0).toFixed(2)}, against a ${critical ? finance.wageTurnoverCritical : finance.wageTurnoverWarning} threshold at ${finance.realismMode} realism`,
        ],
        playerNames: [],
        publishedOn: at,
        weight: 72,
        quote: null,
      });
    }

    // 18b. The same number on the other side of the line, and worth printing when it is good news: a club
    // that can carry its wage bill is a club that can do something in the market.
    if (finance.wageTurnoverLevel === "OK" && finance.squadAnnualWage > 0) {
      items.push({
        id: `wage-control-${input.seasonNumber}`,
        kind: "FINANCE",
        category: "FINANCE",
        tone: "GOOD",
        headline: pick(
          [
            `Wages in Hand at ${input.clubName}`,
            `A Wage Bill the Club Can Carry`,
            `${input.clubName} Living Within Their Means`,
            `The Value of a Sensible Wage Bill`,
          ],
          `wages-ok${input.seasonNumber}`,
          "headline"
        ),
        body: `The squad is understood to cost ${wageLine}, against a turnover of about ${turnover} at this level of the game. That is a wage bill the club can carry, and in a division where several cannot say the same it is worth noting. It is also the room a manager needs to work in.`,
        evidence: [
          `Squad wage ${wageLine}`,
          `Assumed turnover ${turnover} (DERIVED_ESTIMATE)`,
          `Inside the ${finance.wageTurnoverWarning} threshold at ${finance.realismMode} realism`,
        ],
        playerNames: [],
        publishedOn: at,
        weight: 52,
        quote: null,
      });
    }

    // 18c. What there is to spend. The source is stated in the evidence rather than in the prose, because
    // whether a number came from the save or from the manager is the app's business and not the reporter's.
    if (finance.transferBudget !== null) {
      const budget = moneyBand(finance.transferBudget, finance.currency);
      items.push({
        id: `war-chest-${input.seasonNumber}-${finance.transferBudget}`,
        kind: "FINANCE",
        category: "FINANCE",
        tone: "NEUTRAL",
        headline: pick(
          [
            `${budget} to Spend at ${input.clubName}`,
            `What ${input.clubName} Have to Work With`,
            `A Budget of ${budget}, and What It Buys`,
            `The Money on the Table at ${input.clubName}`,
          ],
          `budget${input.seasonNumber}${finance.transferBudget}`,
          "headline"
        ),
        body: (() => {
          const share = finance.estimatedTierRevenue > 0 ? finance.transferBudget / finance.estimatedTierRevenue : null;
          const size =
            share === null
              ? "It is the figure the window will be judged against."
              : share >= 0.5
                ? "For a club at this level that is serious money, and it will be expected to buy serious players."
                : share >= 0.15
                  ? "That is one proper signing at this level, or two if the manager is clever about it."
                  : "That does not buy much at this level. A loan, a free transfer and a lot of phone calls.";
          const gap = depthGap
            ? ` The obvious place to spend it is on ${aOrAn(depthGap.words)} ${depthGap.words}: ${depthGap.name} is the only senior one at the club.`
            : "";
          return `The money available is understood to be ${budget}. ${size}${gap}`;
        })(),
        evidence: [
          `Transfer budget ${budget} (${finance.transferBudgetSource === "USER" ? "stated by the manager" : "from the save"})`,
          `Wage budget ${finance.wageBudget !== null ? moneyBand(finance.wageBudget, finance.currency) : "not recorded"}`,
          `Assumed turnover ${turnover} (DERIVED_ESTIMATE)`,
        ],
        playerNames: [],
        publishedOn: at,
        weight: 50,
        quote: null,
      });
    }

    // 18d. The commitment that has already been made for next season, which is the shape of a board question.
    if (
      finance.nextSeasonLiabilityToTurnover !== null &&
      finance.wageToTurnover !== null &&
      finance.nextSeasonLiabilityToTurnover > finance.wageToTurnover
    ) {
      items.push({
        id: `commitments-${input.seasonNumber}`,
        kind: "FINANCE",
        category: "FINANCE",
        /**
         * Neutral rather than critical, and the copy says why: this is arithmetic about next season, not a
         * complaint about this one. Filing it as CONCERN put it into the fairness pool, where a paper with
         * two good stories and no bad ones would drop it in favour of a criticism - which is exactly
         * backwards, because this is the sort of thing a board wants written down.
         */
        tone: "NEUTRAL",
        headline: pick(
          [
            `${input.clubName} Have Already Spent Next Season's Money`,
            `The Commitments Waiting at ${input.clubName}`,
            `A Wage Bill That Grows Before It Shrinks`,
            `Next Season Is Already Expensive`,
          ],
          `commit${input.seasonNumber}`,
          "headline"
        ),
        body: `The contracts already agreed are understood to commit the club to more next season than it is carrying now, against the same turnover. It is not a crisis and it is the sort of arithmetic that decides a summer: the room the manager thought was there is already partly spent, on players already at the club. Nobody signs anything in a window that has not opened, which is the only reason this stays quiet.`,
        evidence: [
          `Next season's committed wage is a larger share of turnover than this season's`,
          `This season ${(finance.wageToTurnover * 100).toFixed(0)}% of ${turnover} (DERIVED_ESTIMATE)`,
          `Next season ${(finance.nextSeasonLiabilityToTurnover * 100).toFixed(0)}% of the same estimate`,
        ],
        playerNames: [],
        publishedOn: at,
        weight: 62,
        quote: null,
      });
    }

    /**
     * WHAT MAKES A FINANCE STORY WORTH PRINTING TODAY.
     *
     * A static record is not news. The same two fees are true every week of a career, and a story that prints
     * them every week is a page nobody reads twice. So every finance story below runs only against one of
     * these, and anything whose peg is missing does not run at all rather than running as an announcement.
     */
    const financePeg =
      finance.transferBudgetSource === "USER" || finance.wageBudgetSource === "USER"
        ? "the manager has set a budget"
        : finance.wageTurnoverLevel === "CRITICAL"
          ? "the wage bill has crossed its threshold"
          : finance.nextSeasonLiabilityToTurnover !== null
            ? "next season's commitments are already larger than this season's"
            : null;
    /** Players inside the last year of their deals: the number a sale-to-buy argument is actually built on. */
    const shortDeals = input.squad.filter(
      (player) =>
        player.contractValidUntil !== null &&
        input.inGameYear !== null &&
        player.contractValidUntil <= input.inGameYear + 1
    ).length;
    /**
     * The sale-to-buy sentence, counted and capitalised.
     *
     * It follows a full stop, so the count has to start the sentence: "two players are inside the last year of
     * their deals" was reading as a lowercase fragment tacked onto the sentence before it. A count of one also
     * changes the verb and the possessive, so the singular is written out rather than assembled from parts.
     */
    const shortDealsLine =
      shortDeals === 1
        ? "One player is in the last year of his deal, and selling him now is the one way to get a fee for him before he can walk away."
        : shortDeals > 1
          ? `${capitalise(countWord(shortDeals))} players are in the last year of their deals, and selling one now is the only way to get a fee before they can walk away.`
          : "A club that has sold for more than it has spent tends to keep doing it.";

    // 18e. The record fees, which are the MANAGER'S own dealings rather than the club's all-time history.
    // "The largest fee this club has ever paid" is a claim about a hundred years; these two figures are about
    // one person's time in a job, and the copy says so.
    const bought = finance.recordBuy;
    const sold = finance.recordSale;
    if (financePeg !== null && (bought !== null || sold !== null)) {
      const boughtBand = bought !== null ? moneyBand(bought, finance.currency) : null;
      const soldBand = sold !== null ? moneyBand(sold, finance.currency) : null;
      const saleIsLarger = sold !== null && (bought === null || sold > bought);
      const buyIsLarger = bought !== null && (sold === null || bought > sold);
      items.push({
        id: `record-fee-${input.seasonNumber}-${bought ?? 0}-${sold ?? 0}`,
        states: shortDeals > 0 ? ["contracts"] : [],
        kind: "FINANCE",
        category: "FINANCE",
        tone: "NEUTRAL",
        headline: pick(
          saleIsLarger
            ? [
                `Sold for More Than Spent at ${input.clubName}`,
                `${soldBand} Out, ${boughtBand ?? "Nothing"} In`,
                `${input.clubName}'s Biggest Deal Was a Sale`,
              ]
            : buyIsLarger
              ? [
                  `${boughtBand} Is the Biggest Fee of the Tenure`,
                  `${input.clubName} Have Spent More Than They Have Raised`,
                  `The Record at ${input.clubName} Is an Arrival`,
                ]
              : [`${input.clubName} Trade at Market Price`, `Bought and Sold at Roughly the Same Money`],
          `record${input.seasonNumber}`,
          "headline"
        ),
        body: saleIsLarger
          ? `${soldBand} is the largest fee ${input.clubName} have received since ${input.managerName} arrived, against ${boughtBand ?? "no recorded outlay"} the other way. ${shortDealsLine}`
          : buyIsLarger
            ? `${boughtBand} is the largest fee ${input.clubName} have paid since ${input.managerName} arrived, and it is more than they have raised from sales. That is the shape of a club backing the manager in the market.`
            : `${input.clubName} have paid ${boughtBand ?? "nothing"} and received ${soldBand ?? "nothing"} under ${input.managerName}, which is a club paying market price in both directions.`,
        evidence: [
          bought !== null ? `Biggest fee paid ${boughtBand} (this manager's own record)` : "No fee paid is on this manager's record",
          sold !== null ? `Biggest fee received ${soldBand} (this manager's own record)` : "No fee received is on this manager's record",
          `Peg: ${financePeg}`,
          shortDeals > 0 ? `${shortDeals} players inside the last year of their deals` : "",
          finance.transferBudget !== null ? `Budget on the record ${moneyBand(finance.transferBudget, finance.currency)}` : "",
        ].filter(Boolean),
        playerNames: [],
        publishedOn: at,
        weight: 56,
        quote: null,
      });
    }

    // 18f. The club with no stated budget, which is its own story rather than an absence of one. A save that
    // writes 0 for a budget has not said the club has nothing; it has said nothing at all.
    if (finance.transferBudget === null && (finance.recordBuy !== null || finance.recordSale !== null)) {
      items.push({
        id: `sell-to-buy-${input.seasonNumber}`,
        states: [],
        kind: "FINANCE",
        category: "FINANCE",
        tone: "NEUTRAL",
        headline: pick(
          [
            `No Budget on the Record at ${input.clubName}`,
            `${input.clubName} Must Sell Before They Buy`,
            `Quiet Window Expected at ${input.clubName}`,
            `The Money Has to Come from Somewhere`,
          ],
          `sellbuy${input.seasonNumber}`,
          "headline"
        ),
        body: `No transfer budget has been set, and until one is the only money ${input.clubName} can count on is what they raise themselves.${finance.recordSale !== null ? ` The biggest fee of ${surnameOf(input.managerName)}'s time came in, not out: ${moneyBand(finance.recordSale, finance.currency)}.` : ""} A club in that position sells before it buys.`,
        evidence: [
          `No transfer budget recorded (a save of 0 reads as unknown, not as zero)`,
          finance.recordSale !== null ? `Record received ${moneyBand(finance.recordSale, finance.currency)} (from the save)` : "",
          finance.recordBuy !== null ? `Record paid ${moneyBand(finance.recordBuy, finance.currency)} (from the save)` : "",
        ].filter(Boolean),
        playerNames: [],
        publishedOn: at,
        weight: 48,
        quote: null,
      });
    }
  }

  // ---- 19. A player on the way up ------------------------------------------------------------
  // The save knows a rating moved. A newspaper knows a coach is pleased, and says so. What it must not do
  // is report the number: nobody in the ground can see it. So the story is about FORM and DIRECTION, which
  // is what the number stands for, and the figures stay in the app's own note at the bottom.
  const rising = input.developments
    .filter((entry) => entry.delta > 0)
    .sort((left, right) => right.delta - left.delta);
  if (rising.length > 0) {
    const best = rising.find((entry) => entry.isBreakthrough) ?? rising[0];
    const player = input.squad.find((entry) => sameName(entry.name, best.name)) ?? null;
    const age = player?.age ?? null;
    const where = player?.role ?? best.position;
    const seed = `${best.name}${best.newOverall}`;
    items.push({
      id: `progress-${best.id}`,
      states: [`development:${foldName(best.name)}`],
      kind: "PLAYER",
      category: best.isProspect ? "SCOUTING" : "PLAYER FOCUS",
      tone: "GOOD",
      headline: pick(
        best.isBreakthrough
          ? [
              `${best.name} Is Ahead of Schedule`,
              `A Leap Forward for ${best.name}`,
              `${best.name} Takes the Step They Were Waiting For`,
              `${best.name} Is Not a Project Any More`,
              `The Breakthrough: ${best.name} Has Moved Up a Level`,
            ]
          : [
              `${best.name} Is Kicking On`,
              `The Quiet Rise of ${best.name}`,
              `${best.name} Takes Another Step`,
              `${best.name}: the Improvement Nobody Announced`,
              `Word Reaches Us About ${best.name}`,
              `${best.name} Is Going the Right Way`,
            ],
        seed,
        "headline"
      ),
      body: pick(
        best.isBreakthrough
          ? [
              `${best.name} has moved up a level, and it has happened quicker than anyone at the club expected. He is ${positionPhrase(where)}, and that is a position where a jump like this is worth the most.`,
              `This is the jump the coaching staff have been waiting for, and ${best.name} has made it early. ${capitalise(positionPhrase(where))} who improves this much this quickly stops being a project.`,
              `Nobody was surprised to see ${best.name} improve. They were surprised by how much, and how soon. At ${positionWords(where)} that changes what the rest of his season is about.`,
            ]
          : [
              `${source(seed, "progress-source")} say ${best.name} has kicked on again. One small step is not news on its own; the direction is, and this is a player going the right way.`,
              `${best.name} has got better, and the people who work with him every day have seen it. For ${positionPhrase(where)} that shows up in the small things first: the extra yard, the right pass, the duel that used to be lost.`,
              `A quiet improvement from ${best.name}, and the kind that matters more than it reads: the people who work with him every day say the level has gone up. ${capitalise(positionPhrase(where))} who is still getting better is a useful thing to have.`,
            ],
        seed,
        "body"
      ),
      article: [
        pick(
          age !== null && age <= 21
            ? [
                `At ${age}, this is the stretch where a career is either built or postponed. The club have been careful with him, and there is no appetite to rush a good thing.`,
                `At ${age} the temptation is to demand it all at once. The club's own view is calmer than that: the improvement is real, and the job now is to make it the floor rather than the ceiling.`,
              ]
            : [
                `${age !== null && age >= 27 ? `Improving at ${age} is rarer than improving at 20, and it` : "It"} usually means a player has found a role that suits him. The manager's job now is to keep him in it.`,
                `He is not a young player being talked up. He is ${positionPhrase(where)} who has got better, which at this point in a career is the hardest kind of progress to make.`,
              ],
          seed,
          "article-what-it-is"
        ),
        pick(
          [
            `The next step, as everyone at the club knows, is a harder one: the level he has just reached has to become what he does rather than what he did once.`,
            `What happens next is the part nobody can promise. A step up is a fact; staying up there is a season's work.`,
            `The test from here is whether the same thing can be said in ten matches, which is how the club will judge it.`,
          ],
          seed,
          "article-next"
        ),
      ],
      evidence: [
        `The save recorded ${best.oldOverall} to ${best.newOverall} between snapshots`,
        `Delta ${best.delta}`,
        best.isBreakthrough ? "The save files it as a breakthrough" : "",
      ].filter(Boolean),
      playerNames: [best.name],
      publishedOn: best.on ?? at,
      // Scaled by the size of the move: a breakthrough of three points is a story, a single point of
      // drift is a line in the notes, and both are true so both are published. Only the rank differs.
      weight: 60 + Math.min(best.delta, 5) * 4 + (best.isBreakthrough ? 8 : 0),
      quote: null,
    });
  }

  // ---- 20. A player who has gone backwards ----------------------------------------------------
  // The hardest one to write honestly. The app sees a rating fall; a newspaper sees a player who has not
  // been at his best, and says what that means and why anybody should care. The old version said "one point
  // is not a crisis" without ever saying one point of WHAT, which is exactly how a generated story reads.
  const slipping = input.developments
    .filter((entry) => entry.delta < 0)
    .sort((left, right) => left.delta - right.delta);
  if (slipping.length > 0) {
    const worst = slipping[0];
    const player = input.squad.find((entry) => sameName(entry.name, worst.name)) ?? null;
    const age = player?.age ?? null;
    const where = player?.role ?? worst.position;
    const seed = `${worst.name}${worst.newOverall}-down`;
    items.push({
      id: `regress-${worst.id}`,
      kind: "PLAYER",
      category: "FORM WATCH",
      tone: "CONCERN",
      headline: pick(
        [
          `${worst.name} Has Gone Off the Boil`,
          `The Level Drops for ${worst.name}`,
          `${worst.name}: a Dip Worth Watching`,
          `${worst.name} Has Lost His Edge`,
          `Questions at ${input.clubName} over ${worst.name}`,
          `${worst.name} Is Not Where He Was`,
        ],
        seed,
        "headline"
      ),
      body: pick(
        [
          `${source(seed, "regress-source")} have seen ${worst.name} go the other way. Nobody is calling it a crisis, and it is still early, but ${positionPhrase(where)} who was moving forward has started moving back.`,
          `${worst.name} has not been at his best lately, and that is a sentence the coaching staff did not expect to be saying about ${positionPhrase(where)}${age !== null ? ` in ${ageBand(age)}` : " at this stage of his career"}. It is a small drop. It is also a drop.`,
          `There is a dip in ${worst.name}, and it has been noticed inside the club rather than by the crowd. For ${positionPhrase(where)}, that is worth saying out loud, because it is easier to arrest now than later in a season.`,
          `${worst.name}'s form has slipped, and ${age !== null ? `at ${age} ` : ""}nobody expected this stretch of his career to plateau. The club are watching it rather than announcing it, which is usually the honest answer.`,
        ],
        seed,
        "body"
      ),
      article: [
        pick(
          [
            `Worth being precise about what this is: a stretch of indifferent form, not a broken player. ${worst.name} is ${positionPhrase(where)}${age !== null ? ` in ${ageBand(age)}` : ""}, and the club's own belief in him has not changed on the back of a short run.`,
            `It is a dip rather than a decline, and there is a difference. Form moves for reasons a training ground cannot always name: a knock not worth reporting, a change of shape, a run of games against better players.`,
            `None of this is new to a player who has been through it before, and none of it is unusual in a season this long. What matters is which way the next month goes.`,
          ],
          seed,
          "article-perspective"
        ),
        pick(
          [
            `The awkward part is that ${positionPhrase(where)} cannot play his way through it quietly. Every misplaced pass is in front of people, and every week the question gets asked a little louder.`,
            `The other side of it is selection. A squad that has been getting results can afford to wait for a player to come back to himself; one that is not has a harder decision to make.`,
          ],
          seed,
          "article-pressure"
        ),
      ],
      evidence: [
        `The save recorded ${worst.oldOverall} to ${worst.newOverall} between snapshots`,
        `Delta ${worst.delta}`,
      ],
      playerNames: [worst.name],
      publishedOn: worst.on ?? at,
      weight: 63,
      quote: null,
    });
  }

  // ---- 21. The standard bearer ---------------------------------------------------------------
  // Available to everyone from day one, because the squad list alone supports it. A paper with no
  // matches behind it still has something to say about the players in front of the manager.
  const rated = input.squad
    .filter((player) => player.overall !== null)
    .sort((left, right) => (right.overall ?? 0) - (left.overall ?? 0));
  const star = rated[0] ?? null;
  const starOverall = star?.overall ?? null;
  if (star && starOverall !== null && rated.length >= 11 && starOverall >= 60) {
    items.push({
      id: `star-${star.name}-${starOverall}`,
      kind: "SQUAD",
      category: "SQUAD WATCH",
      tone: "GOOD",
      headline: pick(
        [
          `${star.name} Is the Man They Plan Around`,
          `The First Name on the Sheet: ${star.name}`,
          `${star.name} Carries This Side`,
          `Everything Starts with ${star.name}`,
        ],
        `${star.name}${starOverall}`,
        "headline"
      ),
      body: (() => {
        const group = roleGroup(star.role);
        const role = positionWords(star.role);
        const lead =
          group === "ATT" || group === "MID"
            ? `${star.name} is the player opponents set up to stop.`
            : group === "GK"
              ? `${star.name} is the best player at the club, and he is the goalkeeper.`
              : `${star.name} is the best player at the club, and he does it as ${aOrAn(role)} ${role}.`;
        const contract =
          star.contractValidUntil !== null && input.inGameYear !== null && star.contractValidUntil <= input.inGameYear + 1
            ? ` His deal runs to ${star.contractValidUntil}, which is the part of this the club will be thinking about.`
            : ` ${source(`${star.name}${starOverall}`, "star-source")} would not swap him for anybody in the division.`;
        return `${lead}${contract}`;
      })(),
      evidence: [
        `Highest rated player in the squad: ${starOverall} overall${star.potential !== null ? `, ceiling ${star.potential}` : ""}`,
        `Squad of ${input.squad.length}`,
      ],
      playerNames: [star.name],
      publishedOn: at,
      weight: 59,
      quote: null,
    });
  }

  // --- 22. A defence making a habit of it -----------------------------------------------------
  // The counterpart to the clean-sheet story: a run, reported as a run, credited to the whole defence
  // rather than to the man in gloves.
  if (keeper && recent.length >= 3) {
    const shutouts = recent.filter((match) => match.goalsAgainst === 0).length;
    const conceded = sum(recent.map((match) => match.goalsAgainst));
    if (shutouts >= 3) {
      const span = `${recent.length} ${plural(recent.length, "match", "matches")}`;
      const everyOne = shutouts === recent.length;
      /** "no goals" rather than "0 goals": a figure belongs in the evidence, not in the sentence. */
      const against = conceded === 0 ? "no goals" : `${conceded} ${plural(conceded, "goal")}`;
      items.push({
        id: `defence-${recent[0].eventId}`,
        kind: "FORM",
        category: "THE VERDICT",
        tone: "GOOD",
        headline: pick(
          [
            everyOne
              ? `${shutouts} Clean Sheets in ${recent.length}, Every One of Them`
              : `${shutouts} Clean Sheets in ${recent.length} is a Defence`,
            `The Meanest Back Line Around`,
            conceded === 0
              ? `Nothing Conceded in ${recent.length} ${plural(recent.length, "Match", "Matches")}`
              : `${conceded} Conceded in ${recent.length} ${plural(recent.length, "Match", "Matches")}`,
          ],
          `defence${recent[0].eventId}`,
          "headline"
        ),
        body: `${shutouts} clean ${plural(shutouts, "sheet")} in the last ${span}${everyOne ? ", every one of them" : ""}, and ${against} let in across them. ${keeper.name} is the last line of it, but the record belongs to the team.`,
        evidence: [
          `${shutouts} clean sheets in ${recent.length} matches`,
          `${conceded} conceded in the run`,
          `Recorded keeper ${keeper.name}`,
        ],
        playerNames: [keeper.name],
        publishedOn: recent[0].matchDate,
        weight: 80,
        quote: null,
      });
    }
  }

  // ---- 23. The treatment room -----------------------------------------------------------------
  //
  // An injury is the one piece of bad news this desk prints that is not a judgement about anybody. The
  // manager reported it, so it is a fact with an author, and the copy says so plainly rather than dressing a
  // hamstring up as a crisis. The band decides the size of the story: a knock is a line, the season is a
  // back page.
  //
  // Deliberately no exact return date in the copy. The band is the substance and a date on a back page is
  // the sort of precision that goes stale the moment a scan comes back, and the paper keeps what it printed.
  for (const absence of input.injuries ?? []) {
    const band = injuryBand(absence.until, at);
    if (!band) continue;
    const timeOut = describeTimeOut(absence.until, at);
    if (!timeOut) continue;
    const words = positionWords(absence.role);
    const seed = `injury-${foldName(absence.name)}-${band}`;
    const noteParagraph = absence.note
      ? `The club's own description of it is short: "${absence.note}".`
      : null;
    // The standing paragraph, and the one fact in this piece the desk has to be careful with. A player the
    // manager has picked is a selection problem; a player he has not is a depth problem, and saying the first
    // about the second is the kind of error a reader never forgets. The words are chosen from the manager's own
    // saved XI (`isStarter`), not from a rating or a guess, and a manager with no XI saved gets the version
    // that claims nothing about how often the man plays.
    // The body is built in TWO halves rather than picked whole. The first half states the absence and is true
    // whoever the player is; the second half says what it costs, and THAT is where a starter and a squad player
    // part company. Picking the whole paragraph from one pool meant a non-starter was told his absence left a
    // hole in the XI, which is the same mistake as the standing line and just as visible.
    const byBand: Record<
      InjuryBand,
      {
        headline: string[];
        body: { fact: string[]; starter: string[]; squad: string[] };
        article: string[];
        weight: number;
      }
    > = {
      KNOCK: {
        headline: [
          `${absence.name} Picks Up a Knock`,
          `Knock Sidelines ${absence.name}`,
          `${absence.name} Out With a Knock`,
          `A Knock, and ${input.clubName} Reshuffle`,
          `${absence.name} a Doubt After a Knock`,
        ],
        body: {
          fact: [
            `${absence.name} has picked up a knock and is out for ${timeOut}. Short absences are the ones that get managed badly, because the fixture list never asks whether the squad can spare him.`,
            `A knock keeps ${absence.name} out for ${timeOut}. It is the smallest version of this kind of news and it still has to be dealt with.`,
            `${absence.name} is out for ${timeOut} with a knock. Nothing about it is serious, which is exactly why the temptation to rush him will be there in ten days.`,
          ],
          starter: [
            `He has been in the side, so the manager makes a change he would rather not make for a game or two.`,
            `The XI loses a name it has been carrying, and whoever comes in gets one game rather than a fair audition.`,
            `A starter out for a fortnight is not a crisis, and it is still a team sheet rewritten for reasons nobody chose.`,
          ],
          squad: [
            `He is not in the XI, so nothing changes for the next match except who sits on the bench.`,
            `The starting side is unaffected. What narrows is the list of players the manager can turn to when a game needs changing.`,
            `With him out, the cover is thinner than it was, and cover is only noticed on the weeks when two fixtures collide.`,
          ],
        },
        article: [
          pick(
            [
              `The ${words} position is where this bites. A knock that costs ${timeOut} sounds like nothing until the replacement has to play two games in six days, and then it stops sounding like nothing.`,
              `Cover for ${timeOut} is the question. The squad either has somebody who can do the job for a fortnight or it does not, and the answer is usually the second one.`,
            ],
            seed,
            "article-cover"
          ),
        ],
        weight: 62,
      },
      WEEKS: {
        headline: [
          `${absence.name} Faces ${titleCase(timeOut)} Out`,
          `${capitalise(titleCase(timeOut))} Out for ${absence.name}`,
          `${input.clubName} Lose ${absence.name} for ${titleCase(timeOut)}`,
          `A Spell on the Sidelines for ${absence.name}`,
          `${absence.name} Set to Miss ${titleCase(timeOut)}`,
        ],
        body: {
          fact: [
            `${absence.name} is out for ${timeOut}, and that is long enough to stop being a knock and start being a run of games without him.`,
            `${absence.name} will miss ${timeOut} of football. ${capitalise(timeOut)} is the awkward length: long enough that somebody else has to play, short enough that nobody signs anyone about it.`,
            `Out for ${timeOut}, and ${absence.name} leaves a hole in the ${words} position that has to be filled from inside the squad${windowOpen ? ", unless the club move in the window" : ", because no window is open to solve it any other way"}.`,
          ],
          starter: [
            `${input.clubName} now have to decide what the team looks like without their ${words}, and the answer has to come from a squad that has not had to give one all season.`,
            `A first choice out for ${timeOut} is a shape question as much as a personnel one, and it arrives with no time to prepare for it.`,
            `That is three or four matches to plan around a man the manager has been picking, which is the part of a fixture list nobody controls.`,
          ],
          squad: [
            `The XI does not change, and the squad still gets thinner: ${timeOut} is long enough that the manager will need the player he is now missing.`,
            `Nobody has to re-pick the side. The bench loses its most obvious option at the point in the season when games start arriving in pairs.`,
            `He has not been starting, so the cost is not in the next match. It is in the weeks when the manager wants to rotate and cannot.`,
          ],
        },
        article: [
          pick(
            [
              `Cover is the story now. Whoever is asked to do it gets a run of games rather than one match, and a run of games is how a squad player becomes a first choice or stops being one.`,
              `It lands on the manager's desk as a squad question rather than a person question. ${capitalise(timeOut)} is enough to try the alternative, and often enough to find out there was not one.`,
            ],
            seed,
            "article-replacement"
          ),
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 74,
      },
      MONTH: {
        headline: [
          `A Month Out for ${absence.name}`,
          `${absence.name} Faces a Month Out`,
          `${absence.name} Out for Around a Month`,
          `A Month Without ${absence.name} for ${input.clubName}`,
          `${absence.name} Sidelined for a Month`,
        ],
        body: {
          fact: [
            `${absence.name} is out for ${timeOut}, which is the length nobody plans for properly. Too short to buy a replacement, too long to cover with a favour.`,
            `About a month without ${absence.name}. Long enough that the position has to be shared, short enough that the club will try to get through it rather than solve it.`,
            `${absence.name} misses ${timeOut}, and the ${words} position has to be held by somebody else until he is back.`,
          ],
          starter: [
            `${input.clubName} have to work out who holds it, and the answer will change how the side plays rather than only who plays in it.`,
            `A month without a starter is where a squad's depth stops being theoretical: the first two games are easy to cover and the third is not.`,
            `The man who comes in is asked to keep the shirt warm rather than win it, and a month is long enough for that to be a problem by itself.`,
          ],
          squad: [
            `The first choice side is untouched, so this is a story about the bench rather than about the team.`,
            `With him out, the manager has one fewer way to change a game, and a month of football is a lot of games to spend with a short bench.`,
            `He was not in the XI, so the cost is depth and rotation rather than the next team sheet.`,
          ],
        },
        article: [
          pick(
            [
              `The manager has a month to settle something nobody would choose to settle: whether the man who comes in is a stand-in or a candidate. Nothing forces the answer, and the fixtures will ask the question anyway.`,
              `A month is long enough for the replacement to become a problem for the man he is replacing, which is the good version of this and an awkward one to manage. Clubs rarely get through it without learning something they were not looking for.`,
            ],
            seed,
            "article-month"
          ),
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 80,
      },
      MONTHS: {
        headline: [
          `${absence.name} Out for Months in ${input.clubName} Blow`,
          `Months Out for ${absence.name}`,
          `${input.clubName} Hit by ${absence.name} Absence`,
          `A Long Way Back for ${absence.name}`,
          `${absence.name} Faces Months on the Sidelines`,
        ],
        body: {
          fact: [
            `${absence.name} is facing ${timeOut} out. That is the kind of absence a season gets judged by.`,
            `${timeOut} is the sentence for ${absence.name}. Clubs talk about replacing injuries; what they usually do is ask somebody else to be better than he has ever had to be.`,
            `${absence.name} will be out for ${timeOut}, which is long enough that the squad has to be re-planned rather than patched. Nobody covers a hole this size with one decision.`,
          ],
          starter: [
            `${input.clubName} have to plan months without a player they had been counting on, and that is a different job from covering a fortnight.`,
            `A squad absorbs this in one of two ways: a younger player is handed the job early, or the shape is bent around the players who are left. Neither is free.`,
            `The football question is who takes the minutes, and the harder one is the standard. Months of cover is not months of the same player.`,
          ],
          squad: [
            `He has not been starting, so the side does not need rebuilding. What it needs is the depth this absence removes for four or five months.`,
            `The XI is untouched and the squad is not: months is long enough that the manager will be picking from a shorter list for the rest of the campaign.`,
            `With him out, an option that was always there stops being there, which is felt on the weeks when two or three others are already missing.`,
          ],
        },
        article: [
          pick(
            [
              `What makes an absence like this expensive is not the matches missed. It is the matches where somebody else has to be a player he is not, week after week, with no end date close enough to point at.`,
              `The manager will be asked about it every week for months, and the answer will not change, which is a pressure of its own and one that lands on the rest of the squad as much as on the manager.`,
            ],
            seed,
            "article-absorb"
          ),
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 88,
      },
      SEASON: {
        headline: [
          `Season Over for ${absence.name}`,
          `${absence.name} Out for the Season`,
          `${input.clubName} Lose ${absence.name} for the Rest of the Season`,
          `${absence.name}'s Season Ends Here`,
          `A Season-Ending Blow for ${absence.name}`,
        ],
        body: {
          fact: [
            `${absence.name} will not play again this season. There is no fixture he comes back for and no careful reintroduction.`,
            `That is ${absence.name} done for the season, and it is the news every club dreads in the same way.`,
            `The season is over for ${absence.name}, and ${input.clubName} lose him for all of it. It is not an absence to be managed, only one to be planned around.`,
          ],
          starter: [
            `${input.clubName} now have to decide what the rest of the campaign looks like without a player who was part of the plan for it.`,
            `A season-long absence from the XI is the difference between strengthening in one position and rebuilding around the gap.`,
            `What the manager wants is a replacement. What there is, is the rest of a squad and a decision about who is allowed to be a first team player before the time was right.`,
          ],
          squad: [
            `He was not in the XI, so the team itself does not need rebuilding. What the club loses is the player it would have turned to, and a season is long enough that it would have turned to him.`,
            `The first choice side is unchanged. The squad, though, is one smaller for the whole rest of the season, and that bill arrives later rather than now.`,
            `A squad player out for a season removes cover rather than a starter, which matters less in any one match and more across thirty of them.`,
          ],
        },
        article: [
          pick(
            [
              `The planning starts immediately and it is not a short conversation. The club's own judgement of its own squad is now part of the story.`,
              `Nobody covers a season with one decision. What the club have to work out is how many of their remaining players can be asked for more than they have been.`,
            ],
            seed,
            "article-planning"
          ),
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 96,
      },
    };

    const copy = byBand[band];
    const standingBody = pickFresh(
      absence.isStarter ? copy.body.starter : copy.body.squad,
      seed,
      "body-consequence",
      used
    );
    const body = `${pick(copy.body.fact, seed, "body-fact")} ${standingBody}`;
    items.push({
      id: `injury-${foldName(absence.name)}-${band}`,
      kind: "TEAMNEWS",
      category: "TEAM NEWS",
      tone: "CONCERN",
      headline: pick(copy.headline, seed, "headline"),
      body,
      article: [...copy.article],
      evidence: [
        `${absence.name} out for ${timeOut}`,
        absence.until ? `Return date in the manager's report: ${absence.until}` : "No return date reported",
        absence.reportedOn ? `Reported on ${absence.reportedOn}` : "No report date on file",
      ],
      playerNames: [absence.name],
      publishedOn: absence.reportedOn ?? at,
      weight: copy.weight,
      quote: null,
    });
  }

  // ---- 24. Back in training -------------------------------------------------------------------
  //
  // The other half of an injury report, and the reason it is not the same story with a flipped sign: a
  // return is about what is available again, not about what was lost. It runs for a fortnight after the
  // stated return date and then stops being news, which is why it is measured off the SAVE's date rather
  // than kept as a flag somebody has to remember to clear.
  for (const absence of input.injuries ?? []) {
    if (injuryBand(absence.until, at) !== null) continue;
    const back = daysSince(absence.until, at);
    if (back === null || back < 0 || back > RETURN_STORY_DAYS) continue;
    const words = positionWords(absence.role);
    const seed = `return-${foldName(absence.name)}-${absence.until}`;
    // Only for a player young enough that it is worth saying once, and only in the article: the cards never
    // quote an age, which is the rule this desk works to everywhere else.
    const youthNote =
      absence.age !== null && absence.age <= 21
        ? `He is ${absence.age}, which is young enough that a season of stop-start football is the thing to avoid.`
        : null;
    items.push({
      id: `return-${foldName(absence.name)}-${absence.until}`,
      kind: "TEAMNEWS",
      category: "TEAM NEWS",
      tone: "GOOD",
      headline: pick(
        [
          `${absence.name} Back in Training`,
          `${absence.name} Returns to the Squad`,
          `${absence.name} Available Again`,
          `A Boost for ${input.clubName} as ${absence.name} Returns`,
          `${absence.name} Back in Contention`,
        ],
        seed,
        "headline"
      ),
      body: pick(
        [
          `${absence.name} is back in training and available again, which gives ${input.clubName} their ${words} option back. The manager now has the pleasant problem of deciding how quickly to use him.`,
          `${absence.name} is fit and back with the squad. After a spell out, the first question is rarely whether he can play and almost always how much of a game he can play.`,
          `Good news for ${input.clubName}: ${absence.name} has returned to training and comes back into the picture.`, 
          `${absence.name} is available again. Nobody gets a spell out of the side back straight away, but he is at least an option the manager can pick.`,
        ],
        seed,
        "body"
      ),
      article: [
        pick(
          [
            `Coming back in is its own kind of selection risk. A player who has been out has lost match sharpness rather than fitness, and the difference only shows in the twenty minutes after he is first asked to sprint for something.`,
            `The temptation is to put him straight back in, and the sensible answer is usually a substitute's appearance first. Managers who skip that step are the ones who get a second absence and a longer one.`,
          ],
          seed,
          "article-reintro"
        ),
        youthNote,
      ].filter((paragraph): paragraph is string => Boolean(paragraph)),
      evidence: [
        `Return date on file: ${absence.until}`,
        `Save date when this ran: ${at}`,
      ],
      playerNames: [absence.name],
      publishedOn: at,
      weight: 58,
      quote: null,
    });
  }

  // ---- 26. The individual match, where the facts earn a second look ----------------------------------
  /**
   * The things about one match that the report does not say.
   *
   * Every one of these is guarded by a fact rather than by a mood: three goals in one match, every goal by
   * one man, a winner in the last five minutes, a lead given away, a run of matches without scoring. They are
   * separate stories rather than frames inside the report because each of them is a story a paper would run
   * on its own, and because the one-match ration in `rank` is what stops them all printing at once.
   */
  if (last) {
    const haulTally = scorerTally(last.scorers);
    const haul = haulTally[0];
    const haulAgainst = opponentWord(last);

    // 26a. A hat-trick or better. The rarest thing on the table and the one no paper ignores.
    if (haul && haul.goals >= 3) {
      items.push({
        id: `haul-${foldName(haul.name)}-${last.eventId}`,
        kind: "MATCH",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [
            `${haul.name} Takes the Match Ball`,
            `A Hat-Trick for ${haul.name}`,
            `${goalTallyWord(haul.goals)}: ${haul.name} Sees Off ${haulAgainst}`,
            `${haul.name} Will Not Forget This One`,
          ],
          `haul${foldName(haul.name)}${last.eventId}`,
          "headline"
        ),
        body: (() => {
          const rest = haulTally.slice(1);
          const restGoals = sum(rest.map((entry) => entry.goals));
          const resultWord = last.result === "WIN" ? "win" : last.result === "LOSS" ? "defeat" : "draw";
          const opening = `${haul.name} scored ${goalTallyWord(haul.goals)} in the ${proseScore(last)} ${resultWord} against ${haulAgainst}.`;
          const others =
            rest.length === 0
              ? ` Nobody else in a ${input.clubName} shirt scored, so it was his match and nobody else's.`
              : ` ${namesList(rest.map((entry) => entry.name))} got the ${restGoals === 1 ? "other" : "rest"}.`;
          // The running count, over the debriefs dated inside this season. Only said from the second one on.
          const start = seasonStartIso(input.inGameDate);
          const earlierHauls = start
            ? input.matches
                .slice(1)
                .filter((match) => (match.matchDate ?? "") >= start)
                .filter((match) => match.scorers.filter((name) => sameName(name, haul.name)).length >= 3).length
            : 0;
          const running = earlierHauls > 0 ? ` It is his ${ordinalWord(earlierHauls + 1)} hat-trick of the season.` : "";
          return `${opening}${others}${running}`;
        })(),
        evidence: [
          `${haul.name} ${haul.goals} ${plural(haul.goals, "goal")}`,
          `${last.scorers.length} scorer entries logged for ${input.clubName}`,
          `Final score ${scoreOf(last)}`,
        ],
        playerNames: [haul.name],
        publishedOn: last.matchDate,
        weight: 86,
        quote: null,
      });
    } else if (haul && haul.goals >= 2 && last.goalsFor === haul.goals && last.goalsAgainst > 0 && last.result !== "WIN") {
      // 26b. Every goal by one player, in a match the side did not win. A different story from a hat-trick:
      // this one is about carrying a team rather than about a rout.
      items.push({
        id: `carried-${foldName(haul.name)}-${last.eventId}`,
        kind: "MATCH",
        category: "PLAYER FOCUS",
        tone: "NEUTRAL",
        headline: pick(
          [
            `${haul.name} Scored the Lot and It Still Was Not Enough`,
            `All of ${input.clubName}'s Goals, One Man`,
            `${haul.name} Does It Alone Against ${haulAgainst}`,
          ],
          `carried${foldName(haul.name)}${last.eventId}`,
          "headline"
        ),
        body: `Every goal ${input.clubName} scored in the ${proseScore(last)} ${last.result === "LOSS" ? "defeat" : "draw"} came from ${haul.name}. A player doing that will be pleased with himself and the manager will be quietly uneasy about it, because a side that scores only through one man has one man to lose.`,
        evidence: [
          `${haul.name} ${haul.goals} of ${input.clubName}'s ${last.goalsFor}`,
          `Final score ${scoreOf(last)}`,
        ],
        playerNames: [haul.name],
        publishedOn: last.matchDate,
        weight: 68,
        quote: null,
      });
    }

    const decided = decidingGoalMinute(last);
    // 26c. A winner in the last five minutes. `decidingGoalMinute` only returns anything at a margin of one,
    // so this cannot fire on a match that was already settled.
    if (decided !== null && decided >= 85 && last.result === "WIN" && soleScorer(last) !== null) {
      items.push({
        id: `late-winner-${last.eventId}`,
        kind: "MATCH",
        category: "THIS JUST IN",
        tone: "GOOD",
        headline: pick(
          [
            `${decided} Minutes: ${input.clubName} Win It at the Death`,
            `A Late Winner Against ${haulAgainst}`,
            `${input.clubName} Leave It as Late as It Goes`,
            `One Moment, ${decided} Minutes In`,
          ],
          `late${last.eventId}`,
          "headline"
        ),
        body: `${soleScorer(last)} won it on ${decided} minutes, late enough that ${haulAgainst} will feel they had a point. ${pick([`Matches like that are remembered for the moment and not the ninety minutes.`, `It is the kind of goal that gets a stand on its feet and a manager onto the pitch.`, `Those are the points a season is built on, and nobody gives them back.`], last.eventId, "late-tail")}`,
        evidence: [
          `Winning goal on ${decided} minutes`,
          `Final score ${scoreOf(last)}`,
          `Won by a single goal`,
        ],
        playerNames: [],
        publishedOn: last.matchDate,
        weight: 82,
        quote: null,
      });
    }

    // 26d. The lead given away. Not a defeat story, and not a draw story either: a thing that happened to a
    // side that was in front and then was not.
    if (last.result !== "WIN" && ledAtAnyPoint(last)) {
      items.push({
        id: `thrown-away-${last.eventId}`,
        kind: "MATCH",
        category: "THE VERDICT",
        tone: "CONCERN",
        headline: pick(
          [
            `Two Points Dropped: ${input.clubName} Lead and Lose It`,
            `${input.clubName} Let It Slip Against ${haulAgainst}`,
            `The Lead Did Not Last`,
            `A Point That Should Have Been Three`,
          ],
          `thrown${last.eventId}`,
          "headline"
        ),
        body: (() => {
          const ending = last.result === "DRAW" ? `drew ${proseScore(last)}` : `lost ${proseScore(last)}`;
          const story = unfoldingLine(last, input.clubName);
          const cost =
            last.result === "DRAW"
              ? "Two points went from a winning position."
              : "A match they were winning ended with nothing.";
          return `${input.clubName} were ahead against ${haulAgainst} and ${ending}. ${story ? `${story} ` : ""}${cost}`;
        })(),
        evidence: [
          `Led during the match and did not win it`,
          `Final score ${scoreOf(last)}`,
          `Goal minutes logged: ${last.goalMinutes.join(", ") || "none"}`,
        ],
        playerNames: [],
        publishedOn: last.matchDate,
        weight: 76,
        quote: null,
      });
    }
  }

  // 26e. A side that has stopped scoring. The mirror of the leak, and it needs its own run of evidence.
  /**
   * The CURRENT scoreless run, counted from the newest match backwards.
   *
   * A streak rather than the whole window, deliberately. Requiring every match in the window to be scoreless
   * meant the story could only ever run in a career with no good news anywhere near it, which is exactly the
   * career whose paper drops critical stories to keep its balance. A drought is a run, and a run has an end.
   */
  const scorelessRun = (() => {
    let count = 0;
    for (const match of recent) {
      if (match.goalsFor === 0) count += 1;
      else break;
    }
    return count;
  })();
  if (scorelessRun >= 3) {
    items.push({
      id: `drought-${recent[0].eventId}`,
      kind: "FORM",
      category: "THE VERDICT",
      tone: "CONCERN",
      headline: pick(
        [
          `${scorelessRun} Matches Without a Goal`,
          `Where Have the Goals Gone at ${input.clubName}`,
          `A Blank Run for ${input.clubName}`,
          `No Goals in ${scorelessRun}: the Question Nobody Can Answer`,
        ],
        `drought${recent[0].eventId}`,
        "headline"
      ),
      body: (() => {
        const run = recent.slice(0, scorelessRun);
        const shots = run.map((match) => match.shots).filter((count): count is number => count !== null);
        const shotLine =
          shots.length === run.length && shots.length > 0
            ? ` They have had ${sum(shots)} shots in that time${sum(shots) / shots.length >= 12 ? ", so the chances are coming and the finishing is not" : ", which is not enough to expect a goal from"}.`
            : "";
        return `${input.clubName} have not scored for ${scorelessRun} ${plural(scorelessRun, "match", "matches")}.${shotLine} Every match it goes on is one more the manager has to explain.`;
      })(),
      evidence: [
        `${scorelessRun} matches without a goal`,
        `Goals for 0 across the run`,
        `Goals against ${sum(recent.slice(0, scorelessRun).map((match) => match.goalsAgainst))} in the same matches`,
      ],
      playerNames: [],
      publishedOn: recent[0].matchDate,
      weight: 80,
      quote: null,
    });
  }

  // ---- 26f. Off the ball: the team-sized running jokes ------------------------------------------
  /**
   * The light pieces about the side as a whole, each one built from minutes the debriefs recorded.
   *
   * Same rule as the player colour stories: the joke is on the situation, and every one of them is a count
   * anybody could check against the results. Filed NEUTRAL rather than as criticism, because a paper ribbing
   * a side about its last five minutes is not the same thing as a verdict on the manager.
   */
  if (recent.length >= 3) {
    const club = input.clubName;
    // Scored and then conceded within five minutes.
    const wobbles = recent.flatMap((match) =>
      match.goalMinutes
        .map((minute) => ({ match, scored: minute, conceded: match.concededMinutes.find((other) => other > minute && other - minute <= 5) }))
        .filter((entry): entry is { match: NewsMatch; scored: number; conceded: number } => entry.conceded !== undefined)
        .slice(0, 1)
    );
    if (wobbles.length >= 2) {
      items.push({
        id: `celebration-${recent[0].eventId}`,
        kind: "FORM",
        category: "OFF THE BALL",
        tone: "NEUTRAL",
        headline: pick(
          [`${club} Have a Celebration Problem`, `Score, Celebrate, Concede`, `The Five Minutes After a Goal`],
          `celebration${recent[0].eventId}`,
          "headline"
        ),
        body: `${wobbles.length === 2 ? "Twice" : `${capitalise(countWord(wobbles.length))} times`} in the last ${recent.length} matches, ${club} have scored and then conceded inside five minutes. Whatever is being said in the celebrations, it is going on too long.`,
        article: [
          wobbles
            .slice(0, 3)
            .map((entry) => `Against ${opponentWord(entry.match)}, scored on ${entry.scored} and conceded on ${entry.conceded}.`)
            .join(" "),
        ],
        evidence: [`${wobbles.length} matches with a goal conceded within five minutes of scoring`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 58,
        quote: null,
      });
    }

    // Goals conceded after the 85th minute, and what they cost.
    const lateOnes = recent.slice(0, 3).filter((match) => match.concededMinutes.some((minute) => minute >= 85));
    if (lateOnes.length >= 2) {
      const pointsFor = (ours: number, theirs: number) => (ours > theirs ? 3 : ours === theirs ? 1 : 0);
      const cost = sum(
        lateOnes.map((match) => {
          const late = match.concededMinutes.filter((minute) => minute >= 85).length;
          return pointsFor(match.goalsFor, match.goalsAgainst - late) - pointsFor(match.goalsFor, match.goalsAgainst);
        })
      );
      items.push({
        id: `late-leak-${recent[0].eventId}`,
        kind: "FORM",
        category: "OFF THE BALL",
        // A joke about the clock rather than a verdict, so it does not count against the paper's fairness cap.
        tone: "NEUTRAL",
        headline: pick(
          [`Somebody Get ${club} a Watch`, `The Last Five Minutes Are a Problem`, `Late, Late Trouble for ${club}`],
          `lateleak${recent[0].eventId}`,
          "headline"
        ),
        body: `${club} have conceded after the 85th minute in ${countWord(lateOnes.length)} of the last three matches.${
          cost > 0 ? ` Take those goals away and they have ${cost} more ${plural(cost, "point")}.` : " None of them cost a result, which is the only good news in it."
        }`,
        article: [
          lateOnes
            .map((match) => `${capitalise(opponentWord(match))} scored on ${match.concededMinutes.filter((minute) => minute >= 85).join(" and ")}.`)
            .join(" "),
        ],
        evidence: [`${lateOnes.length} of the last 3 matches with a goal conceded after 85 minutes`, `Points those goals cost: ${cost}`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: cost > 0 ? 68 : 56,
        quote: null,
      });
    }
  }

  // The goalkeeper the manager picked out in a defeat.
  if (last && last.result === "LOSS") {
    const hero = last.standouts.find((name) => roleGroup(roleOf(name)) === "GK") ?? null;
    if (hero) {
      items.push({
        id: `keeper-heroics-${last.eventId}`,
        kind: "MATCH",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [`${hero} Did Everything, Nobody Else Did`, `Beaten, but Not Because of ${hero}`, `${hero} Kept It Respectable`],
          `heroics${last.eventId}`,
          "headline"
        ),
        body: `${input.clubName} lost ${proseScore(last)} to ${opponentWord(last)}, and it would have been worse without ${hero}. When the goalkeeper is the name a manager picks out after a defeat, it is not much of a compliment to the ten in front of him.`,
        evidence: [`Singled out in a ${scoreOf(last)} defeat`, "Goalkeeper by position"],
        playerNames: [hero],
        publishedOn: last.matchDate,
        weight: 74,
        quote: null,
      });
    }
  }

  // The striker whose goals have dried up, measured against his own run before it.
  if (recent.length >= 4 && input.matches.length >= WINDOW + 4) {
    const earlierRun = input.matches.slice(WINDOW, WINDOW + 10);
    const dry = input.squad
      .filter((player) => roleGroup(player.role) === "ATT")
      .map((player) => ({ player, before: goalsIn(earlierRun, player.name), now: goalsIn(recent, player.name) }))
      .filter((entry) => entry.now === 0 && entry.before >= 3)
      .sort((left, right) => right.before - left.before)[0];
    if (dry) {
      const name = dry.player.name;
      const scored = sum(recent.map((match) => match.goalsFor));
      items.push({
        id: `striker-drought-${foldName(name)}-${recent[0].eventId}`,
        kind: "PLAYER",
        category: "PLAYER FOCUS",
        tone: "NEUTRAL",
        headline: pick(
          [`Where Have ${surnameOf(name)}'s Goals Gone?`, `${name} Is Waiting`, `A Dry Spell for ${name}`],
          `dry${name}${recent[0].eventId}`,
          "headline"
        ),
        body: `${name} scored ${dry.before} in the ${earlierRun.length} matches before this run and has not scored in the last ${recent.length}. ${
          scored > 0 ? `${input.clubName} have found ${scored} goals elsewhere in that time, so the side is coping. The striker will want his share back.` : `Nobody else has scored either, which is the bigger problem.`
        }`,
        evidence: [`${dry.before} goals in the ${earlierRun.length} matches before`, `None in the last ${recent.length}`],
        playerNames: [name],
        publishedOn: recent[0].matchDate,
        weight: 62,
        quote: null,
      });
    }
  }

  // A round number for the season's top scorer, reached in the match just played.
  const seasonStart = seasonStartIso(input.inGameDate);
  const seasonMatches = seasonStart ? input.matches.filter((match) => (match.matchDate ?? "") >= seasonStart) : [];
  if (last && seasonMatches.includes(last)) {
    const tallies = scorerTally(seasonMatches.flatMap((match) => match.scorers));
    for (const entry of tallies.slice(0, 2)) {
      const inLast = last.scorers.filter((name) => sameName(name, entry.name)).length;
      const marker = [10, 15, 20, 25, 30, 40].find((mark) => entry.goals >= mark && entry.goals - inLast < mark);
      if (!marker || inLast === 0) continue;
      const nextBest = tallies.find((other) => !sameName(other.name, entry.name))?.goals ?? 0;
      items.push({
        id: `season-tally-${foldName(entry.name)}-${marker}-${input.seasonNumber}`,
        kind: "PLAYER",
        category: "PLAYER FOCUS",
        tone: "GOOD",
        headline: pick(
          [`${marker} for the Season: ${entry.name}`, `${entry.name} Reaches ${marker}`, `${entry.name} Hits ${marker}`],
          `tally${entry.name}${marker}`,
          "headline"
        ),
        body: `${entry.name}'s ${inLast === 1 ? "goal" : "goals"} against ${opponentWord(last)} took him to ${entry.goals} for the season. ${
          nextBest > 0 ? `Nobody else at the club has more than ${nextBest}.` : "Nobody else at the club is close."
        }`,
        evidence: [`${entry.goals} goals across ${seasonMatches.length} logged matches dated this season`],
        playerNames: [entry.name],
        publishedOn: last.matchDate,
        weight: 80,
        quote: null,
      });
      break;
    }
  }

  // ---- 26g. The newspaper's player ratings, for the match just played ---------------------------
  /**
   * Marks out of ten, only for the players the debrief NAMES: scorers, creators, and the ones the manager
   * picked out. A paper rates the whole XI; this one rates who it can see, because the desk does not have the
   * team sheet and inventing a 6 for a player who may not have played is the one thing it must not do.
   *
   * The paper filing it nudges the marks: the fanzine is half a mark kinder than the broadsheet.
   */
  if (last) {
    const named = [...new Set([...last.scorers, ...last.assisters, ...last.standouts].map(foldName))]
      .map((key) => [...last.scorers, ...last.assisters, ...last.standouts].find((name) => foldName(name) === key) as string);
    if (named.length >= 3) {
      const stance: OutletStance = hash(`${last.eventId}|ratings`) % 2 === 0 ? "STRAIGHT" : "LOYAL";
      const kindness = stance === "LOYAL" ? 0.5 : 0;
      const resultNudge = last.result === "WIN" ? 0.5 : last.result === "LOSS" ? -0.5 : 0;
      const rows = named.map((name) => {
        const goals = last.scorers.filter((scorer) => sameName(scorer, name)).length;
        const assists = last.assisters.filter((assister) => sameName(assister, name)).length;
        const picked = last.standouts.some((pick) => sameName(pick, name));
        const group = roleGroup(roleOf(name));
        const shutout = last.goalsAgainst === 0 && (group === "GK" || group === "DEF");
        const raw = 6 + goals * 1.2 + assists * 0.6 + (picked ? 1 : 0) + (shutout ? 0.6 : 0) + resultNudge + kindness;
        const mark = Math.max(4, Math.min(10, Math.round(raw)));
        const reasons = [
          goals > 0 ? (goals === 1 ? "scored" : goals === 2 ? "scored twice" : `a hat-trick${goals > 3 ? " and more" : ""}`) : "",
          assists > 0 ? (assists === 1 ? "made one" : `made ${countWord(assists)}`) : "",
          shutout ? "kept them out" : "",
          picked ? "the manager's pick" : "",
        ].filter(Boolean);
        return { name, mark, reasons };
      });
      rows.sort((left, right) => right.mark - left.mark || left.name.localeCompare(right.name));
      const star = rows[0];
      const resultWord = last.result === "WIN" ? "win over" : last.result === "LOSS" ? "defeat against" : "draw with";
      items.push({
        id: `ratings-${last.eventId}`,
        kind: "MATCH",
        category: "PLAYER RATINGS",
        tone: last.result === "LOSS" ? "NEUTRAL" : "GOOD",
        stance,
        headline: pick(
          [`Marks Out of Ten: ${fixtureLine(last, input.clubName)}`, `${star.name} the Star Man Against ${capitalise(opponentWord(last))}`, `How They Rated Against ${capitalise(opponentWord(last))}`],
          `ratings${last.eventId}`,
          "headline"
        ),
        body: `How the ${proseScore(last)} ${resultWord} ${opponentWord(last)} rated: ${rows.map((row) => `${row.name} ${row.mark}`).join(", ")}. ${star.name} is the star man.`,
        article: [rows.map((row) => `${row.name} ${row.mark}: ${capitalise(namesList(row.reasons) || "did the job")}.`).join(" ")],
        evidence: ["Only players named in your debrief are rated", "Marks built from goals, assists, your standout picks and the result"],
        playerNames: rows.slice(0, 3).map((row) => row.name),
        publishedOn: last.matchDate,
        weight: 60,
        quote: null,
      });
    }
  }

  // ---- 26h. The calendar ---------------------------------------------------------------------
  /**
   * Stories the date itself makes: a window opening, deadline day, the festive fixtures, the awards.
   *
   * Every one is pegged to the save's own date and to something the club actually has to deal with, so the
   * window piece is a list of this squad's real needs rather than a piece about windows.
   */
  const openWindow = transferWindowOn(input.inGameDate);
  if (openWindow && input.inGameDate) {
    const day = Number(input.inGameDate.slice(8, 10));
    const month = Number(input.inGameDate.slice(5, 7));
    const deadline = (openWindow === "WINTER" && day >= 29) || (openWindow === "SUMMER" && ((month === 8 && day >= 29) || month === 9));
    const longInjury = (input.injuries ?? []).find((absence) => {
      const band = injuryBand(absence.until, at);
      return band === "MONTHS" || band === "SEASON";
    });
    const expiringSoon =
      input.inGameYear !== null
        ? input.squad
            .filter((player) => player.contractValidUntil !== null && player.contractValidUntil <= (input.inGameYear as number) + 1)
            .sort((left, right) => (right.overall ?? 0) - (left.overall ?? 0))[0] ?? null
        : null;
    const contractCall =
      expiringSoon && expiringSoon.name !== depthGap?.name && expiringSoon.name !== longInjury?.name ? expiringSoon : null;
    const needs = [
      depthGap ? `cover at ${depthGap.words} (${depthGap.name} is the only senior one)` : "",
      longInjury ? `someone to fill in for ${longInjury.name} (out for ${describeTimeOut(longInjury.until, at) ?? "a long time"})` : "",
      contractCall ? `a decision on ${contractCall.name} (his deal ends in ${contractCall.contractValidUntil})` : "",
    ].filter(Boolean);
    if (needs.length > 0) {
      const which = openWindow === "WINTER" ? "January" : "summer";
      const budget = finance?.transferBudget != null ? ` The budget is understood to be ${moneyBand(finance.transferBudget, finance.currency)}.` : " No budget has been set, so anything that comes in will probably have to be paid for by something going out.";
      items.push({
        id: `${deadline ? "deadline" : "window"}-${input.inGameDate.slice(0, 4)}-${openWindow}`,
        kind: "TRANSFER",
        category: "THE WINDOW",
        tone: "NEUTRAL",
        headline: pick(
          deadline
            ? [`Deadline Day at ${input.clubName}`, `Last Call: ${input.clubName}'s Window`, `The Clock Runs Down at ${input.clubName}`]
            : [`The ${capitalise(which)} Window Opens at ${input.clubName}`, `${input.clubName}'s ${capitalise(which)} Shopping List`, `What ${input.clubName} Need This ${capitalise(which)}`],
          `window${input.inGameDate}${openWindow}`,
          "headline"
        ),
        body: `${deadline ? `It is deadline day, and ${input.clubName} still have` : `The ${which} window is open, and ${input.clubName} have`} ${countWord(needs.length)} ${plural(needs.length, "job")} on the list: ${namesList(needs)}.${budget}`,
        evidence: [`Save date ${input.inGameDate}`, depthGap ? `One senior ${depthGap.words}` : "", longInjury ? `${longInjury.name} out until ${longInjury.until}` : ""].filter(Boolean),
        playerNames: [depthGap?.name, longInjury?.name, expiringSoon?.name].filter((name): name is string => Boolean(name)).slice(0, 3),
        publishedOn: at,
        weight: deadline ? 78 : 66,
        quote: null,
      });
    }
  }

  // The festive fixtures, once they are played: the matches between the 20th of December and the 3rd of January.
  if (input.inGameDate) {
    const year = Number(input.inGameDate.slice(0, 4));
    const month = Number(input.inGameDate.slice(5, 7));
    const day = Number(input.inGameDate.slice(8, 10));
    const inSeason = (month === 12 && day >= 27) || (month === 1 && day <= 12);
    if (inSeason) {
      const startYear = month === 12 ? year : year - 1;
      const from = `${startYear}-12-20`;
      const to = `${startYear + 1}-01-03`;
      const festive = input.matches.filter((match) => match.matchDate !== null && match.matchDate >= from && match.matchDate <= to);
      if (festive.length >= 2) {
        const points = sum(festive.map((match) => (match.result === "WIN" ? 3 : match.result === "DRAW" ? 1 : 0)));
        const max = festive.length * 3;
        const good = points / max >= 0.6;
        items.push({
          id: `festive-${startYear}`,
          kind: "FORM",
          category: "FORM WATCH",
          tone: good ? "GOOD" : points / max < 0.35 ? "CONCERN" : "NEUTRAL",
          headline: pick(
            good
              ? [`A Very Good Christmas for ${input.clubName}`, `${points} Points From the Festive Fixtures`, `${input.clubName} Come Through the Christmas Rush`]
              : points / max < 0.35
                ? [`A Christmas to Forget at ${input.clubName}`, `${points} From ${max} Over Christmas`, `The Festive Fixtures Bite`]
                : [`${points} From ${max} Over Christmas`, `A Mixed Christmas at ${input.clubName}`],
            `festive${startYear}`,
            "headline"
          ),
          body: `${capitalise(countWord(festive.length))} matches over Christmas and New Year, and ${points} points out of ${max}: ${formWords(festive)}. ${
            good
              ? "That is the stretch where seasons get made, and this one has been."
              : points / max < 0.35
                ? "That is the stretch where squads get found out, and this one has been."
                : "Not a disaster and not a springboard, which is what most clubs get out of it."
          }`,
          states: ["run"],
          evidence: [`${festive.length} matches dated ${from} to ${to}`, `${points} points`],
          playerNames: [],
          publishedOn: at,
          weight: 70,
          quote: null,
        });
      }
    }
  }

  // The season's awards, once the season is in its last stretch or done, from the debriefs dated inside it.
  {
    const phase = seasonPhase(input.progress ?? null);
    const closed = input.seasons.some((season) => season.season === input.seasonNumber && season.complete);
    if ((phase === "FINAL_STRETCH" || closed) && seasonMatches.length >= 10) {
      const scoreOfPlayer = (name: string) =>
        goalsIn(seasonMatches, name) * 3 +
        assistsIn(seasonMatches, name) * 2 +
        seasonMatches.filter((match) => match.standouts.some((pick) => sameName(pick, name))).length * 2;
      const ranked = input.squad
        .map((player) => ({ player, score: scoreOfPlayer(player.name) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);
      const winner = ranked[0] ?? null;
      if (winner) {
        const young = ranked.find((entry) => entry.player.age !== null && entry.player.age <= 21 && entry !== winner) ?? null;
        const line = (name: string) => {
          const goals = goalsIn(seasonMatches, name);
          const assists = assistsIn(seasonMatches, name);
          const picks = seasonMatches.filter((match) => match.standouts.some((pick) => sameName(pick, name))).length;
          return namesList(
            [
              goals > 0 ? `${goals} ${plural(goals, "goal")}` : "",
              assists > 0 ? `${assists} ${plural(assists, "assist")}` : "",
              picks > 0 ? `${picks} ${plural(picks, "match", "matches")} as the manager's pick` : "",
            ].filter(Boolean)
          );
        };
        items.push({
          id: `awards-${input.seasonNumber}`,
          kind: "PLAYER",
          category: "AWARDS",
          tone: "GOOD",
          headline: pick(
            [`${winner.player.name} Is Our Player of the Season`, `Player of the Season: ${winner.player.name}`, `The Season's Best: ${winner.player.name}`],
            `awards${input.seasonNumber}`,
            "headline"
          ),
          body: `${winner.player.name} is our player of the season at ${input.clubName}: ${line(winner.player.name)}.${
            young ? ` The young player of the season is ${young.player.name}, ${young.player.age}, with ${line(young.player.name)}.` : ""
          }`,
          ...(ranked[1] && ranked[1] !== young
            ? { article: [`${ranked[1].player.name} ran him closest, with ${line(ranked[1].player.name)}.`] }
            : {}),
          evidence: [`Counted over ${seasonMatches.length} debriefs dated this season`, "Goals count 3, assists 2, a standout pick 2"],
          playerNames: [winner.player.name, ...(young ? [young.player.name] : [])],
          publishedOn: at,
          weight: 86,
          quote: null,
        });
      }
    }
  }

  // ---- 27. A round number in a career ---------------------------------------------------------------
  /**
   * The manager's own milestone, counted from the save's season record rather than from the debriefs.
   *
   * Round numbers are the only ones worth a story, and the copy says what the number counts - matches in the
   * seasons the save has closed - because a season in progress may not have a row yet. Claiming "500 matches"
   * when the save has recorded 450 would be the sort of thing the reader could catch, and the point of this
   * desk is that he cannot.
   */
  const careerMatches = input.gamesInCharge ?? null;
  if (careerMatches !== null && careerMatches >= 50 && careerMatches % 50 === 0) {
    items.push({
      id: `milestone-${careerMatches}`,
      kind: "MILESTONE",
      category: "TOP STORY",
      tone: "GOOD",
      headline: pick(
        [
          `${careerMatches} Matches In: ${input.managerName} Reaches a Round Number`,
          `${input.managerName} and the ${careerMatches}-Match Mark`,
          `A Milestone for ${input.managerName}`,
          `${careerMatches} Games in Charge at ${input.clubName}`,
        ],
        `milestone${careerMatches}`,
        "headline"
      ),
      body: `${input.managerName} has now taken charge of ${careerMatches} matches, on the save's own record of the seasons it has closed. It is the kind of number that only exists to be noticed once and then never mentioned again, and it is worth noticing: managers who get that far are the minority.`,
      evidence: [
        `${careerMatches} matches in charge (summed from the save's per-season record)`,
        `Season ${input.seasonNumber} of the manager's time here`,
        `A season in progress may not be counted yet`,
      ],
      playerNames: [],
      publishedOn: at,
      weight: 84,
      quote: null,
    });
  }

  // ---- 25. Opinion ----------------------------------------------------------------------------
  /**
   * Columns, and the only place in the paper where the voice is deliberately leaning.
   *
   * The same facts filed by a fanzine and by a hostile tabloid are two different pieces, and neither of them
   * is dishonest: a paper's line on a manager is part of what the paper is, and a reader knows which one he
   * opened. What makes that fair rather than a pile-on is the rationing in `rank` - one hostile column an
   * edition, two only after a genuinely bad run, and never a hostile one unless a straight or a loyal paper
   * is on the page beside it.
   *
   * Every column is guarded by the fact it is about, exactly like everything else here. The stance only
   * decides which paper runs it, and the byline is taken back off that paper in `finalise`, so the stored
   * story always carries the voice it was actually written in.
   */
  const straightLosses = (() => {
    let count = 0;
    for (const match of recent) {
      if (match.result === "LOSS") count += 1;
      else break;
    }
    return count;
  })();
  const badRun = straightLosses >= 3;

  // The figures every column argues from. A column without a number in it is a horoscope, which is what the
  // first versions were: the same essay whether the side had taken ten points or one.
  const pointsOf = (match: NewsMatch) => (match.result === "WIN" ? 3 : match.result === "DRAW" ? 1 : 0);
  const recentPoints = sum(recent.map(pointsOf));
  const recentPpg = recent.length > 0 ? recentPoints / recent.length : 0;
  const before = input.matches.slice(WINDOW, WINDOW * 2);
  const beforePoints = before.length >= 3 ? sum(before.map(pointsOf)) : null;
  const beforePpg = beforePoints !== null ? beforePoints / before.length : null;
  const scoredRecent = sum(recent.map((match) => match.goalsFor));
  const concededRecent = sum(recent.map((match) => match.goalsAgainst));
  const club = input.clubName;
  const surname = surnameOf(input.managerName);
  const lastFinish = previousSeason?.tablePosition ?? null;
  const window = `${recent.length} ${plural(recent.length, "match", "matches")}`;
  const pointsLine = `${recentPoints} ${plural(recentPoints, "point")} from the last ${window}`;
  /** How the five before compares, said as a fact with its direction, or nothing when there were not five. */
  const trendLine = (): string => {
    if (beforePoints === null || beforePpg === null) return "";
    if (recentPpg - beforePpg >= 0.4) return ` The ${before.length} before that brought ${beforePoints}, so it is getting better.`;
    if (beforePpg - recentPpg >= 0.4) return ` The ${before.length} before that brought ${beforePoints}, so it is getting worse.`;
    return ` The ${before.length} before that brought ${beforePoints}, so nothing has really moved.`;
  };
  const distinctScorers = [...new Set(recent.flatMap((match) => match.scorers.map(foldName)))].length;
  const scorerNamesInWindow = scorerTally(recent.flatMap((match) => match.scorers)).map((entry) => entry.name);

  // 25a. The manager himself, which is the column every paper has an opinion about.
  if (recent.length >= 3) {
    const verdict: "AGAINST" | "FOR" | "OPEN" =
      badRun || recentPpg < 0.8 ? "AGAINST" : recentPpg >= 2 || (beforePpg !== null && recentPpg - beforePpg >= 0.8) ? "FOR" : "OPEN";
    const honours = input.trophies.length;
    const latestHonour = input.trophies[0] ?? null;
    const seed = `op-manager${input.seasonNumber}${recent[0].eventId}`;
    const body =
      verdict === "AGAINST"
        ? `${capitalise(formWords(recent))}: ${pointsLine}.${trendLine()} ${
            input.seasonNumber >= 2
              ? `This is ${surname}'s ${ordinalWord(input.seasonNumber)} season, and the squad on the pitch is the one ${surname} built.`
              : `It is a first season and much of this squad was here before ${surname}, but results are still results.`
          }${latestHonour ? ` The ${latestHonour.name} buys time. It does not buy unlimited time.` : ""}`
        : verdict === "FOR"
          ? `${capitalise(formWords(recent))}, which is ${pointsLine}.${trendLine()} ${pick(
              [
                `${surname} deserves the credit for it, because this is the same squad people were doubting.`,
                `That is the work of a manager who knows what this side is good at.`,
                `${club} look like a team with a plan, and the plan is ${surname}'s.`,
              ],
              seed,
              "for"
            )}`
          : `${capitalise(formWords(recent))}: ${pointsLine}.${trendLine()} ${
              lastFinish !== null
                ? `Last season ended ${ordinal(lastFinish)}, and nothing yet says this one will finish higher or lower.`
                : `Nothing in that says which way the season is going yet, and anybody claiming otherwise is guessing.`
            }`;
    const theme = (() => {
      const counts = new Map<string, { line: string; count: number }>();
      for (const match of recent) {
        const family = match.weakness ? weaknessFamily(match.weakness) : null;
        if (!family) continue;
        const entry = counts.get(family.key) ?? { line: family.line, count: 0 };
        entry.count += 1;
        counts.set(family.key, entry);
      }
      return [...counts.values()].sort((left, right) => right.count - left.count)[0] ?? null;
    })();
    const article =
      verdict === "AGAINST"
        ? theme && theme.count >= 2
          ? `The same thing keeps going wrong, and it is ${theme.line}. ${concededRecent} conceded in ${window} is what that costs.`
          : `${concededRecent} conceded and ${scoredRecent} scored in ${window}. Whatever the explanation is, it has to arrive soon.`
        : verdict === "FOR"
          ? distinctScorers >= 3
            ? `${capitalise(countWord(distinctScorers))} different players have scored in that run, so it is not one man carrying the side.`
            : `${scoredRecent} scored and ${concededRecent} conceded in ${window}.`
          : `${scoredRecent} scored and ${concededRecent} conceded in ${window}. The margins are thin, and the next few matches will decide which side of them the season falls.`;
    items.push({
      id: `opinion-manager-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "TALKING POINT",
      tone: verdict === "AGAINST" ? "CONCERN" : verdict === "FOR" ? "GOOD" : "NEUTRAL",
      stance: verdict === "AGAINST" ? "HOSTILE" : verdict === "FOR" ? "LOYAL" : "STRAIGHT",
      headline: pick(
        verdict === "AGAINST"
          ? [
              `The Case Against ${surname} Is Getting Easier to Make`,
              `Something Has to Change at ${club}`,
              `${recentPoints} ${plural(recentPoints, "Point")} from ${recent.length} Is Not Good Enough`,
            ]
          : verdict === "FOR"
            ? [
                honours > 0 ? `${surname} Has Earned the Benefit of the Doubt` : `Credit Where It Is Due: ${surname}`,
                `${club} Are Going Somewhere Under ${surname}`,
                `This Is ${surname}'s Team Now`,
              ]
            : [`Judging ${surname} Fairly`, `What We Actually Know About ${surname}`, `The Next Month Decides ${surname}'s Season`],
        seed,
        "headline"
      ),
      body,
      article: [article],
      states: ["run", "block", "tenure"],
      evidence: [
        `Run ${formString(recent)}`,
        `${recentPoints} points from ${recent.length}${beforePoints !== null ? `, ${beforePoints} from the ${before.length} before` : ""}`,
        `Season ${input.seasonNumber} of the manager's time here`,
        verdict === "AGAINST"
          ? "Filed hostile: the results justify the argument"
          : verdict === "FOR"
            ? "Filed loyal: the results justify the praise"
            : "Filed straight: the facts do not carry a verdict",
      ],
      playerNames: [],
      publishedOn: at,
      weight: 78,
      quote: null,
    });
  }

  // 25b. The form column, which a tabloid writes when the form is extreme and not otherwise.
  if (recent.length >= 4 && (recentPpg >= 2.2 || recentPpg <= 0.6)) {
    const wins = recent.filter((match) => match.result === "WIN").length;
    const losses = recent.filter((match) => match.result === "LOSS").length;
    const hot = recentPpg >= 2.2;
    const extreme = [...recent].sort((left, right) =>
      hot ? right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst) : left.goalsFor - left.goalsAgainst - (right.goalsFor - right.goalsAgainst)
    )[0];
    items.push({
      id: `opinion-form-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "OPINION",
      tone: hot ? "GOOD" : "CONCERN",
      stance: "SENSATIONAL",
      headline: pick(
        hot
          ? [`Nobody Wants to Play ${club} Right Now`, `${wins} Wins in ${recent.length}: Believe It`, `${club} Are the Form Side and It Is Not Close`]
          : [`${losses} Defeats in ${recent.length}: Call It What It Is`, `This Is a Slump`, `The Numbers Do Not Care About Your Excuses`],
        `op-form${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: hot
        ? `${capitalise(formWords(recent))}, ${scoredRecent} goals scored, and ${club} look like a side that expects to win every week. Anybody still waiting for it to fall apart has not been watching.`
        : `${capitalise(formWords(recent))}, and ${concededRecent} goals conceded. This is a slump, and calling it a bad patch is the sort of thing people say right up until it is a relegation fight.`,
      article: [
        hot
          ? `The pick of it was the ${proseScore(extreme)} against ${opponentWord(extreme)}, and the scary thing for everybody else is that it did not look like a one-off.`
          : `The low point was the ${proseScore(extreme)} against ${opponentWord(extreme)}, and nothing since has suggested it was a one-off.`,
      ],
      states: ["run"],
      evidence: [`Run ${formString(recent)}`, `${wins} wins, ${losses} defeats in the window`, `${scoredRecent} scored, ${concededRecent} conceded`],
      playerNames: [],
      publishedOn: at,
      weight: 76,
      quote: null,
    });
  }

  // 25c. The loyal column on the squad, and only when the results show the goals coming from everywhere.
  if (recent.length >= 4 && distinctScorers >= 4) {
    items.push({
      id: `opinion-squad-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "OPINION",
      tone: "GOOD",
      stance: "LOYAL",
      headline: pick(
        [
          `This Squad Is Better Than It Is Being Given Credit For`,
          `${capitalise(countWord(distinctScorers))} Scorers and No Passengers`,
          `The Case for Backing What Is Already Here`,
        ],
        `op-squad${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: `${capitalise(countWord(distinctScorers))} different players have scored for ${club} in the last ${window}. That is a squad, not one player carrying ten, and it is why the call to sign somebody every time a result goes wrong misses the point.`,
      article: [
        `${namesList(scorerNamesInWindow.slice(0, 5))}${scorerNamesInWindow.length > 5 ? " and more" : ""} have all scored in that run. When the goals come from that many places, the opposition cannot stop all of them.`,
      ],
      evidence: [`${distinctScorers} different scorers in ${recent.length} matches`, "Filed loyal: the fanzine's own line is behind the club"],
      playerNames: scorerNamesInWindow.slice(0, 3),
      publishedOn: at,
      weight: 52,
      quote: null,
    });
  }

  // 25d. The supporters, measured by what they actually see: the matches at home.
  const homeRecent = recent.filter((match) => venueOf(match) === "HOME");
  if (recent.length >= 4 && homeRecent.length >= 2) {
    const homePoints = sum(homeRecent.map(pointsOf));
    const homePpg = homePoints / homeRecent.length;
    const mood: "HAPPY" | "RESTLESS" | "WAITING" = homePpg >= 2 ? "HAPPY" : homePpg < 1 ? "RESTLESS" : "WAITING";
    items.push({
      id: `opinion-supporters-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "OPINION",
      tone: mood === "HAPPY" ? "GOOD" : mood === "RESTLESS" ? "CONCERN" : "NEUTRAL",
      stance: "LOYAL",
      headline: pick(
        mood === "HAPPY"
          ? [`Home Is Where the Points Are`, `A Ground Worth Turning Up To Again`, `The Home Crowd Are Getting Their Money's Worth`]
          : mood === "RESTLESS"
            ? [`What the Supporters Are Actually Saying`, `The Home Crowd Deserve More`, `A Word From the Stands`]
            : [`Nobody Is Asking for Miracles at ${club}`, `A Word From the Stands`, `The Home Crowd Are Waiting`],
        `op-supporters${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body:
        mood === "HAPPY"
          ? `${capitalise(formWords(homeRecent))} in the last ${homeRecent.length} at home. The people paying to watch are getting what they paid for, and they know it.`
          : mood === "RESTLESS"
            ? `${capitalise(formWords(homeRecent))} in the last ${homeRecent.length} at home. Supporters forgive a bad day away. They do not forgive many of these in front of them.`
            : `${capitalise(formWords(homeRecent))} in the last ${homeRecent.length} at home. Nobody in the stands is asking for a title. They are asking for home wins, and they are getting some of them.`,
      article: [
        mood === "RESTLESS"
          ? `The away record is a separate argument. What the home crowd sees is the club, and right now it is not giving them much to sing about.`
          : `A side that wins at home gives itself a season to work with. Everything away from home is a bonus on top of that.`,
      ],
      evidence: [`Home run ${formString(homeRecent)}`, `${homePoints} points from ${homeRecent.length} home matches`, "Filed loyal: the fanzine speaks for the stands"],
      playerNames: [],
      publishedOn: at,
      weight: 44,
      quote: null,
    });
  }

  // 25e. The academy argument, only when there is a record or a teenager already scoring to argue from.
  const teenScorer =
    input.squad.find((player) => player.age !== null && player.age <= 19 && goalsIn(recent, player.name) > 0) ?? null;
  const prospectRecord =
    input.academy?.name && ((input.academy.goals ?? 0) > 0 || (input.academy.appearances ?? 0) > 0) ? input.academy : null;
  if (input.academy?.name && (prospectRecord || teenScorer)) {
    const prospect = input.academy;
    const record =
      prospectRecord && prospectRecord.appearances
        ? `${prospectRecord.goals ?? 0} ${plural(prospectRecord.goals ?? 0, "goal")} in ${prospectRecord.appearances} ${plural(prospectRecord.appearances, "game")} for the youth side`
        : null;
    items.push({
      id: `opinion-youth-${input.seasonNumber}`,
      kind: "OPINION",
      category: "OPINION",
      tone: "GOOD",
      stance: "LOYAL",
      headline: pick(
        [`The Answer May Already Be in the Building`, `${prospect.name} and the Case for Patience`, `Where the Next One Comes From`],
        `op-youth${input.seasonNumber}`,
        "headline"
      ),
      body: `${
        teenScorer
          ? `${teenScorer.name} is ${teenScorer.age} and already scoring for the first team, which is the best argument there is for giving the next one a chance.`
          : `${prospect.name} has ${record}.`
      } ${teenScorer && record ? `The next one is ${prospect.name}, with ${record}.` : teenScorer ? `The question is when ${prospect.name} gets the same chance, not whether.` : `The question is when he gets a first-team chance, not whether.`}`,
      article: [
        input.finance && input.finance.transferBudget === null
          ? `With no transfer budget set, the academy is not the romantic option. It is the only cheap one.`
          : `A player who comes through costs a fraction of one who arrives, and that difference pays for everything else.`,
      ],
      states: ["academy"],
      evidence: [
        `Academy prospect ${prospect.name}`,
        record ? `Youth record: ${record}` : "",
        teenScorer ? `${teenScorer.name}, ${teenScorer.age}, has scored in the last ${recent.length}` : "",
        "Filed loyal: an argument for the club's own method",
      ].filter(Boolean),
      playerNames: [prospect.name ?? "", ...(teenScorer ? [teenScorer.name] : [])].filter(Boolean),
      publishedOn: at,
      weight: 42,
      quote: null,
    });
  }

  // 25f. The tactical question, as a running story: the same problem, counted over every logged match.
  {
    const families = new Map<string, { line: string; count: number; first: NewsMatch; conceded: number }>();
    for (const match of input.matches) {
      const family = match.weakness ? weaknessFamily(match.weakness) : null;
      if (!family) continue;
      const entry = families.get(family.key) ?? { line: family.line, count: 0, first: match, conceded: 0 };
      entry.count += 1;
      entry.first = match; // newest first, so the last one seen is the oldest
      entry.conceded += match.goalsAgainst;
      families.set(family.key, entry);
    }
    const running = [...families.entries()].sort((left, right) => right[1].count - left[1].count)[0] ?? null;
    const firstIndex = running ? input.matches.indexOf(running[1].first) : -1;
    // Only a story when it goes back further than the current run: inside five matches it is the weakness
    // story's to tell, and two columns about the same five matches is the same point twice.
    if (running && running[1].count >= 3 && firstIndex >= WINDOW) {
      const [key, entry] = running;
      const since = momentOf(entry.first.matchDate);
      items.push({
        id: `opinion-tactics-${input.seasonNumber}-${key}-${entry.count}`,
        kind: "OPINION",
        category: "TALKING POINT",
        tone: "NEUTRAL",
        stance: "STRAIGHT",
        headline: pick(
          [`The Question Nobody at ${club} Wants to Answer`, `One Problem, Named and Not Solved`, `${capitalise(countWord(entry.count))} Times and Counting`],
          `op-tactics${input.seasonNumber}${key}${entry.count}`,
          "headline"
        ),
        body: `It has come up ${countWord(entry.count)} times${since ? ` since ${since.month}` : ""}: ${entry.line}. ${club} conceded ${entry.conceded} in those matches, and the problem has outlasted every explanation for it.`,
        article: [
          `A one-off is noise and a second time is a coincidence. ${capitalise(countWord(entry.count))} times across ${firstIndex + 1} matches is a pattern, and patterns are a manager's job.`,
        ],
        evidence: [
          `Named in ${entry.count} of the last ${firstIndex + 1} logged matches`,
          since ? `First logged ${entry.first.matchDate}` : "",
          "Filed straight: a question rather than a verdict",
        ].filter(Boolean),
        playerNames: [],
        publishedOn: at,
        weight: 66,
        quote: null,
      });
    }
  }

  // 25g. The money column, which is where a hostile paper does its damage without inventing a word.
  if (finance && (finance.wageTurnoverLevel === "WARNING" || finance.wageTurnoverLevel === "CRITICAL")) {
    const wages = moneyBand(finance.squadAnnualWage, finance.currency);
    items.push({
      id: `opinion-money-${input.seasonNumber}`,
      kind: "OPINION",
      category: "TALKING POINT",
      tone: "CONCERN",
      stance: "HOSTILE",
      headline: pick(
        [`The Money Has Always Been the Real Story at ${club}`, `Follow the Spending`, `${club} Are Paying for Decisions Already Made`],
        `op-money${input.seasonNumber}`,
        "headline"
      ),
      body: `The wage bill is understood to be ${wages} a year, which is more than a club at this level can comfortably carry. ${
        input.seasonNumber >= 2
          ? `In season ${input.seasonNumber}, that is ${surname}'s wage bill, not one ${surname} inherited.`
          : `Most of it was here before ${surname}, and ${surname} will still be judged on what it buys.`
      }${finance.recordBuy !== null ? ` The biggest fee paid in that time is ${moneyBand(finance.recordBuy, finance.currency)}.` : ""}`,
      article: [
        recent.length >= 3
          ? `What it has bought lately is ${formWords(recent)}. Expensive squads are allowed bad runs. They are not allowed many.`
          : `Every argument about a manager ends up as an argument about money, and every argument about money ends up as one about who agreed to it.`,
      ],
      states: ["contracts"],
      evidence: [
        `Squad wage ${wages} a year (from the squad's own contract rows)`,
        `Assumed turnover ${moneyBand(finance.estimatedTierRevenue, finance.currency)} (DERIVED_ESTIMATE)`,
        "Filed hostile: the numbers are argued rather than reported",
      ],
      playerNames: [],
      publishedOn: at,
      weight: 70,
      quote: null,
    });
  }

  // 25h. The table against last season, which is the only comparison a table supports.
  if (input.position?.value != null && input.leagueName && lastFinish !== null) {
    const position = input.position.value;
    const better = position < lastFinish;
    const same = position === lastFinish;
    items.push({
      id: `opinion-table-${input.seasonNumber}-${position}`,
      kind: "OPINION",
      category: "OPINION",
      tone: better ? "GOOD" : same ? "NEUTRAL" : "CONCERN",
      stance: "STRAIGHT",
      headline: pick(
        better
          ? [`${ordinal(position)} After ${ordinal(lastFinish)}: That Is Progress`, `The Table Says ${club} Are Moving`, `Up From ${ordinal(lastFinish)}`]
          : same
            ? [`${ordinal(position)} Again`, `The Table, Read Properly`, `Standing Still at ${ordinal(position)}`]
            : [`${ordinal(position)} After ${ordinal(lastFinish)} Is a Step Back`, `The Table, Read Properly`, `Down From ${ordinal(lastFinish)}`],
        `op-table${input.seasonNumber}${position}`,
        "headline"
      ),
      body: better
        ? `${ordinal(position)} in the ${input.leagueName}, after ${ordinal(lastFinish)} the season before. Progress at a football club is rarely a straight line, but it is usually measured in places, and that is ${countWord(lastFinish - position)} of them.`
        : same
          ? `${ordinal(position)} in the ${input.leagueName}, exactly where the season before ended. That is not failure, and it is not the step forward a second go at it was supposed to bring.`
          : `${ordinal(position)} in the ${input.leagueName}, after ${ordinal(lastFinish)} the season before. A table does not care about context, and that is ${countWord(position - lastFinish)} ${plural(position - lastFinish, "place")} lost.`,
      states: ["table"],
      evidence: [`Position ${position}`, `Previous season ${ordinal(lastFinish)}`, "Filed straight: the table is reported rather than argued"],
      playerNames: [],
      publishedOn: at,
      weight: 54,
      quote: null,
    });
  }

  return finalise(
    rank(items, input.matches.map((match) => match.eventId), {
      badRun,
      recentTypes: input.recentTypes ?? [],
      maxStories: options.maxStories,
    }),
    input
  );
}

/** How long a return stays a story. About a fortnight: after that the squad has settled without him. */
export const RETURN_STORY_DAYS = 14;

/** Whole days from `from` to `to`, or null when either is missing or unparseable. */
function daysSince(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * A story while it is being written: everything a `NewsItem` has except the two things the desk adds once
 * every story exists.
 *
 * `article` is optional here on purpose. A story that has a second paragraph of its own writes it at the
 * point where it knows the facts, and a story that has nothing more to say leaves it out rather than being
 * forced to invent something.
 */
type StoryDraft = Omit<NewsItem, "article" | "byline" | "stance"> & {
  article?: string[];
  /**
   * The facts the story itself already states, so the closing line never repeats one of them.
   *
   * Keys shared with the closing families: "run", "table", "block", "contracts", "development:<name>" and so
   * on. A story that says the form in its own body has no business closing on the form again.
   */
  states?: string[];
  /**
   * Headlines for when the piece lands at a tabloid. The red-tops write a different kind of headline about
   * the same facts, and the paper the story is filed with is only known once the byline is chosen.
   */
  tabloidHeadlines?: string[];
  /** The line this story is written in, where the desk is offering a view rather than a fact. */
  stance?: OutletStance;
};

/**
 * Categories the desk files with a reporter's name on them.
 *
 * A report, a verdict, a transfer or a trophy is journalism and reads wrong without a byline. A squad-depth
 * note or a five-match block summary is the app having noticed something, and signing it to a fictional
 * correspondent would dress a note up as a piece. The distinction is editorial, which is why it is a list
 * here rather than a property of the story type.
 */
const BYLINED_CATEGORIES = new Set([
  "TOP STORY",
  "MATCH REPORT",
  "THIS JUST IN",
  "ANALYSIS",
  "THE VERDICT",
  "FORM WATCH",
  "PLAYER FOCUS",
  "SCOUTING",
  "TRANSFER DESK",
  "SILVERWARE",
  "TEAM NEWS",
  // Money is speculation by nature and reads as a column rather than as a notice, so it carries a name.
  "FINANCE",
  // A column or a rumour without a name on it reads as a system note, and a stated stance only means
  // something if the masthead it belongs to is on the piece.
  "OPINION",
  "TALKING POINT",
  // The light pieces, the ratings, the window and the awards are all written by somebody.
  "OFF THE BALL",
  "PLAYER RATINGS",
  "THE WINDOW",
  "AWARDS",
]);

/**
 * What one EDITION remembers while it is being written.
 *
 * Two things, and both are needed. Which exact SENTENCES it has printed, so a line never comes back verbatim;
 * and how many times it has used each CONCLUSION FAMILY, so the paper spreads its closing paragraphs across
 * everything it knows rather than reaching for the same point until that pool runs dry and repeats itself.
 *
 * A `Set` of used sentences alone is not enough, which is what the first version of this had. Once every
 * family had been used once, relevance decided again, and the most relevant one was reached for over and over
 * until its six phrasings were gone - and then repeated.
 */
interface EditionMemory {
  sentences: Set<string>;
  families: Map<string, number>;
}

function newEditionMemory(): EditionMemory {
  return { sentences: new Set<string>(), families: new Map<string, number>() };
}

/**
 * The same choice `pick` makes, unless this edition has already printed it.
 *
 * WHY THIS EXISTS. The closing paragraph rotates its conclusions by the story's position in the edition, and a
 * rotation is not enough on its own: with a handful of conclusions and two chosen per story, an edition of six
 * stories prints the same sentence twice, and the same pairing comes back on the next read. Rotating WHICH
 * SENTENCE is chosen, on top of which conclusion, is what makes two neighbouring pieces end differently - and
 * the reader notices a repeated closing line faster than anything else on the page, because it is the last
 * thing he reads.
 *
 * A full pool is not a failure: once every phrasing is in play, repeating one is better than leaving the
 * paragraph out, so the preferred choice is used rather than nothing. The edition memory's own discount is
 * what keeps a pool from being reached for so often that this has to happen.
 */
function pickFresh(options: readonly string[], seed: string, slot: string, used: Set<string>): string {
  const preferred = pick(options, seed, slot);
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const start = hash(`${seed}|${slot}`) % options.length;
  for (let step = 0; step < options.length; step += 1) {
    const candidate = options[(start + step) % options.length];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return preferred;
}

/**
 * The closing line of an article, when it has earned one.
 *
 * REBUILT A THIRD TIME, and this time the default is NOTHING. The earlier versions gave every story one or
 * two closing sentences from shared pools, and that is what made the paper read like a template: the form
 * record printed under eight stories, the table under seven, and lines like "which is the clock that
 * matters" under anything left over. A real piece ends when its point is made.
 *
 * So a closing sentence now has to clear four bars, and most stories clear none of them:
 *
 *   1. it adds a FACT the story does not state itself (the draft's `states`),
 *   2. that fact has not been printed anywhere else in this edition - in another story's body or in
 *      another closing line - which is what stops the same run of results turning up nine times,
 *   3. it is about the same kind of thing as the story (a match report may close on the form; a piece about
 *      a contract may not close on the table),
 *   4. when it names a player, the story is already about that player.
 *
 * One sentence at most, chosen by a fixed priority rather than by a hash, because "what matters most" is an
 * editorial order and not a lottery.
 */
function outlookParagraph(input: NewsInput, draft: StoryDraft, memory: EditionMemory): string {
  const recent = input.matches.slice(0, WINDOW);
  const club = input.clubName;
  const states = new Set(draft.states ?? []);
  const named = draft.playerNames;
  const lead = named[0] ?? null;
  const candidates: { key: string; kinds: StoryKind[]; options: string[]; about?: string }[] = [];

  // The run, under a single-match story only: a form story already IS the run.
  if (recent.length >= 3) {
    const run = formWords(recent);
    const window = `${recent.length} ${plural(recent.length, "match", "matches")}`;
    candidates.push({
      key: "run",
      kinds: ["MATCH"],
      options: [
        `That makes it ${run} from the last ${window}.`,
        `It is ${run} from ${club}'s last ${window}.`,
        `${club} have now had ${run} in their last ${window}.`,
      ],
    });
  }

  // The table, when the save states a position and does not dispute it.
  const position = input.position?.value ?? null;
  if (position !== null && !input.position?.disputed && input.leagueName) {
    const closed = input.seasons.some((season) => season.season === input.seasonNumber && season.complete);
    candidates.push({
      key: "table",
      kinds: ["MATCH", "FORM"],
      options: closed
        ? [`${club} finished ${ordinal(position)} in the ${input.leagueName}.`]
        : [`${club} are ${ordinal(position)} in the ${input.leagueName}.`, `It leaves ${club} ${ordinal(position)} in the ${input.leagueName}.`],
    });
  }

  // Who is missing for the next one: true whenever a player is out today, whatever the match.
  const unavailable = (input.injuries ?? []).filter(
    (absence) => absence.until !== null && input.inGameDate !== null && absence.until > input.inGameDate && absence.isStarter
  );
  if (unavailable.length > 0) {
    const absent = unavailable[0];
    candidates.push({
      key: "injuries",
      kinds: ["MATCH"],
      options: [
        `${club} go into the next match without ${absent.name}.`,
        `${absent.name} will still be missing for the next one.`,
      ],
    });
  }

  // A player the story is about who has also improved, when the save says so and the story has not.
  if (lead !== null && !states.has(`development:${foldName(lead)}`)) {
    const moved = input.developments.find((entry) => entry.delta > 0 && sameName(entry.name, lead));
    if (moved) {
      candidates.push({
        key: `development:${foldName(lead)}`,
        kinds: ["MATCH", "PLAYER"],
        about: lead,
        options: [
          `It comes as ${lead} is improving, and the coaching staff have noticed that too.`,
          `${lead} has been getting better on the training ground as well, by the club's own reckoning.`,
        ],
      });
    }
  }

  // The nearest contract, under money and transfer stories only.
  if (input.inGameYear !== null) {
    const expiring = input.squad
      .filter((player) => player.contractValidUntil !== null && player.contractValidUntil <= (input.inGameYear as number) + 1)
      .sort((left, right) => (left.contractValidUntil ?? 0) - (right.contractValidUntil ?? 0));
    const soonest = expiring[0] ?? null;
    if (soonest && soonest.contractValidUntil !== null) {
      const others = expiring.filter((player) => player.contractValidUntil === soonest.contractValidUntil).length - 1;
      candidates.push({
        key: "contracts",
        kinds: ["FINANCE", "TRANSFER"],
        about: soonest.name,
        options: [
          `${soonest.name}'s deal runs out in ${soonest.contractValidUntil}${others > 0 ? `, and ${countWord(others)} ${plural(others, "other")} with it` : ""}.`,
          `The first contract decision is ${soonest.name}, whose deal ends in ${soonest.contractValidUntil}.`,
        ],
      });
    }
  }

  const usable = candidates.find(
    (candidate) =>
      candidate.kinds.includes(draft.kind) &&
      !states.has(candidate.key) &&
      !memory.families.has(candidate.key) &&
      (!candidate.about || named.length === 0 || named.some((name) => sameName(name, candidate.about as string)))
  );
  if (!usable) return "";
  memory.families.set(usable.key, 1);
  return pickFresh(usable.options, draft.id, `outlook-${usable.key}`, memory.sentences);
}

/**
 * The last pass: every story gets its article and its byline.
 *
 * Done here rather than at each story because both are properties of the EDITION rather than of a single
 * item: the closing line needs the career's own shape, and the byline needs the country the paper is filed
 * in. Keeping it in one place is also what stops two stories in one edition closing the same way - the
 * `used` set below is the edition's memory of the closing lines it has already printed.
 */
function finalise(items: StoryDraft[], input: NewsInput): NewsItem[] {
  const memory = newEditionMemory();
  // Every fact a story states in its own words is taken before any closing line is chosen, so the form
  // printed in a form story is not printed again under the match report that happens to sit above it.
  for (const item of items) for (const fact of item.states ?? []) memory.families.set(fact, 1);
  return items.map((draft) => {
    const { states: _states, tabloidHeadlines, ...item } = draft;
    void _states;
    const own = (item.article ?? []).map((paragraph) => tidy(paragraph)).filter(Boolean);
    const closing = outlookParagraph(input, draft, memory);
    const article = voice([tidy(item.body), ...own, closing].filter(Boolean), input);
    const byline = BYLINED_CATEGORIES.has(item.category)
      ? bylineFor(item.id, input.countryId ?? null, input.clubName, "byline", item.stance ?? undefined)
      : null;
    // A tabloid writes its own headline over the same facts, when the story has one written for it.
    const headline =
      byline?.stance === "SENSATIONAL" && tabloidHeadlines && tabloidHeadlines.length > 0
        ? pick(tabloidHeadlines, item.id, "tabloid")
        : item.headline;
    return {
      ...item,
      id: item.id,
      kind: item.kind,
      headline,
      body: article[0],
      article,
      closing: closing ? (article.at(-1) ?? null) : null,
      byline,
      /**
       * The line this PIECE takes, which is nothing unless it was written as an opinion.
       *
       * Not the outlet's own stance. Every paper in the library has a house line, and inheriting it here
       * would mark a straight match report as hostile because it happened to be picked up by a tabloid. A
       * report states facts and takes no position; only a column does, and only a column sets this.
       */
      stance: item.stance ?? null,
    };
  });
}

/**
 * How a paper refers to people after it has introduced them.
 *
 * The club's full name once, then its short name: "Wigan Athletic" and then "Wigan", never four "Wigan
 * Athletic"s in a paragraph. The manager's full name once, then the surname. Applied over the whole piece,
 * card first, so the card introduces and the article follows on.
 *
 * A short name is only used when no opponent on the record shares it, so "City" is never ambiguous.
 */
function voice(paragraphs: string[], input: NewsInput): string[] {
  const full = input.clubName.trim();
  const opponents = input.matches.map((match) => (match.opponent ?? "").toLowerCase());
  const candidate =
    clubShortName(full) ??
    (() => {
      const last = full.split(/\s+/).slice(-1)[0] ?? "";
      return full.includes(" ") && /^(City|United|Town|County|Villa|Forest|Palace|Rangers|Orient|Vale)$/.test(last) ? last : null;
    })();
  const short =
    candidate && !opponents.some((name) => name.split(/\s+/).includes(candidate.toLowerCase())) ? candidate : null;
  const manager = input.managerName.trim();
  const surname = surnameOf(manager);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let clubSeen = false;
  let managerSeen = false;
  return paragraphs.map((paragraph) => {
    let out = paragraph;
    if (manager.includes(" ")) {
      out = out.replace(new RegExp(escape(manager), "g"), (match) => {
        if (!managerSeen) {
          managerSeen = true;
          return match;
        }
        return surname;
      });
    }
    if (short) {
      out = out.replace(new RegExp(escape(full), "g"), (match) => {
        if (!clubSeen) {
          clubSeen = true;
          return match;
        }
        return short;
      });
    }
    return out;
  });
}

/** The match figures, as a one-line note for the app's own record of why a story ran. */
function matchStatsNote(match: NewsMatch): string {
  const parts = [
    match.shots !== null ? `${match.shots} shots` : "",
    match.shotsInsideBox !== null ? `${match.shotsInsideBox} inside the box` : "",
    match.expectedGoalsReported !== null
      ? `${formatExpectedGoals(match.expectedGoalsReported)} expected goals, read from the game`
      : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Orders the paper.
 *
 * Significance first, then with no two stories of the same kind adjacent, so an edition never leads
 * with three variations of the same idea. The tie-break is the id, which makes the order stable for a
 * given set of facts rather than shuffling between reads.
 *
 * There is also an editorial cap of three stories per category. Six versions of "who has been playing
 * well" is not more news than three, and the cap is what keeps a paper built from a thin career looking
 * like a paper rather than a list of everything that happens to be true.
 *
 * And there is a FAIRNESS pass. Everything above is about variety; this is about a paper that reads as if it
 * has it in for the manager. A desk with three critical stories and one good one, about the same struggling
 * squad, is not being honest, it is being sour, and a reader can tell the difference.
 */
export function rank<
  T extends {
    weight: number;
    id: string;
    kind: StoryKind;
    category: string;
    tone: NewsTone;
    playerNames: string[];
    stance?: OutletStance | null;
  },
>(items: T[], matchEventIds: readonly string[] = [], options: { badRun?: boolean; recentTypes?: readonly string[]; maxStories?: number } = {}): T[] {
  const sorted = [...items].sort(
    (left, right) => right.weight - left.weight || left.id.localeCompare(right.id)
  );

  const perCategory = new Map<string, number>();
  const capped: T[] = [];
  for (const item of sorted) {
    const used = perCategory.get(item.category) ?? 0;
    if (used >= 3) continue;
    perCategory.set(item.category, used + 1);
    capped.push(item);
  }

  /**
   * At most two stories per match.
   *
   * ONE MATCH, ONE VOICE. Everything above is about variety across the paper; this is about a single
   * afternoon not filling it. A heavy defeat with a bad defensive record, a recurring weakness and a keeper
   * on a run can honestly produce six stories, and six stories about ninety minutes is not a newspaper, it is
   * the same ninety minutes reported from six angles.
   *
   * The cap is deliberately NOT applied to everything keyed on an event id. Most of the desk's running
   * stories are keyed on the LATEST match while being about the last five - the form, the scoring summary,
   * the leak - and capping those as though they described one afternoon would empty the paper, which is
   * exactly what happened the first time this was written the simple way.
   *
   * The number is FOUR rather than two, and that is a deliberate departure from the obvious reading of the
   * rule. Two would mean that after any win to nil the paper carries the report and the clean sheet and
   * nothing else - so the finishing analysis, the timing pattern and the recurring weakness could only ever
   * print after a match that was not won to nil, which makes three of the desk's story types nearly dead
   * letters. Four angles on ninety minutes still stops a single afternoon filling the page, which is what
   * the rule is for, without deleting the stories it was meant to sit beside.
   */
  const perEvent = new Map<string, number>();
  const withinEvent: T[] = [];
  for (const item of capped) {
    if (!SINGLE_MATCH_PREFIXES.some((prefix) => item.id.startsWith(prefix))) {
      withinEvent.push(item);
      continue;
    }
    const eventId = matchEventIds.find((id) => item.id.endsWith(id));
    if (eventId === undefined) {
      withinEvent.push(item);
      continue;
    }
    const used = perEvent.get(eventId) ?? 0;
    if (used >= MAX_ANGLES_PER_MATCH) continue;
    perEvent.set(eventId, used + 1);
    withinEvent.push(item);
  }

  /**
   * The opinion ration.
   *
   * A paper that runs two columns against its own manager on the same day is campaigning rather than
   * reporting, and a stance only means anything if it is rationed. One leaning column an edition, two only
   * after three straight defeats - when there is genuinely a case for somebody to answer - and a hostile or
   * sensational piece is dropped outright unless a straight or a loyal one is on the page beside it. That last
   * rule is the important one: a reader has to be able to see both arguments at once, which is the whole
   * difference between a paper with a view and a paper with a grudge.
   */
  const leaning = (item: T) => item.stance === "HOSTILE" || item.stance === "SENSATIONAL";
  const evenHanded = (item: T) => item.stance === "STRAIGHT" || item.stance === "LOYAL";
  const hasEvenHanded = withinEvent.some(evenHanded);
  const leaningAllowed = options.badRun ? 2 : 1;
  const opinionCapped: T[] = [];
  let leaningKept = 0;
  for (const item of withinEvent) {
    if (!leaning(item)) {
      opinionCapped.push(item);
      continue;
    }
    if (!hasEvenHanded || leaningKept >= leaningAllowed) continue;
    leaningKept += 1;
    opinionCapped.push(item);
  }

  const balanced = balanceCoverage(opinionCapped);

  /**
   * The edition cap, and the novelty that keeps a paper worth opening twice.
   *
   * THE CAP is what makes this a paper. The desk can support around thirty kinds of story, a rich career
   * produces twenty in one read, and printing all of them is how a feature list reads: nobody finishes it, and
   * by the tenth item the reader has stopped believing any of them are news.
   *
   * THE ROTATION is what makes the cap acceptable. It used to be the only thing that varied between two
   * reads, because significance does not change and the same nine therefore won every time. A type the last
   * editions already ran costs forty points, which is enough to hand its slot to a fresher story of similar
   * weight and not enough to bury a rout or an injury on the day it happens. A small hash of the id breaks
   * the remaining ties, so two stories of equal weight take turns instead of one of them always winning.
   *
   * WHAT THE SUM IS is `salienceOf`: weight plus relevance, less the novelty price. Relevance is why the
   * report of the match just played outranks a wage bill that has not moved, and it is the reason this is no
   * longer a ranking on significance with a rotation bolted on.
   *
   * The balance pass runs AFTER the trim, because dropping four stories from a paper can leave it with three
   * criticisms and one good news item, which is the thing the fairness rules exist to prevent.
   */
  const history = new Set(options.recentTypes ?? []);
  const trimmed = [...balanced]
    .map((item) => ({
      item,
      score:
        salienceOf(item, matchEventIds) -
        (history.has(typeOf(item.id)) ? RECENT_TYPE_PENALTY : 0) +
        (hash(`${item.id}|slot`) % 1000) / 125,
    }))
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, options.maxStories ?? MAX_EDITION_STORIES)
    .map((entry) => entry.item);

  const finalised = balanceCoverage(trimmed);

  /**
   * Interleaved by category, taking the category with the MOST left to place.
   *
   * The first version took the highest-ranked story whose category had not just run, and that is not the same
   * thing: it happily ran the categories with one story each to the end and then placed three columns of the
   * same kind back to back, because by then nothing else was left. Choosing the category that has the most
   * remaining is the arrangement that keeps the most separation for as long as possible, so a paper with two
   * or three columns in it does not finish with them all in a row.
   *
   * Within a category the ranked order is kept, so this separates the kinds of story without ever
   * re-ordering by significance inside one.
   */
  const remaining = [...finalised];
  const out: T[] = [];
  let lastCategory: string | null = null;
  /**
   * The lead is the highest-scoring story, and the interleave starts from there.
   *
   * The category rule below must never choose the front page. It exists to stop two stories of the same kind
   * running next to each other, and it picks by whichever category has the most left to place - so letting it
   * choose the first story is how a paper led on a squad note while the report of the last match sat fourth,
   * behind two pieces about money that happened to be in larger supply.
   */
  if (remaining.length > 0) {
    const [lead] = remaining.splice(0, 1);
    out.push(lead);
    lastCategory = lead.category;
  }
  while (remaining.length > 0) {
    const counts = new Map<string, number>();
    for (const item of remaining) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    let bestIndex = -1;
    let bestCount = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      if (item.category === lastCategory) continue;
      const count = counts.get(item.category) ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestIndex = index;
      }
    }
    // Nothing left that differs from the last one placed, so the paper has one category's worth of stories
    // and nowhere else to put them. This is the only case that produces two neighbours of the same kind.
    if (bestIndex === -1) bestIndex = 0;
    const [next] = remaining.splice(bestIndex, 1);
    out.push(next);
    lastCategory = next.category;
  }
  return out;
}

/**
 * How many critical stories one edition may carry, whatever the facts.
 *
 * Two. A run of bad results can honestly produce more, and the rest of them are not invented - they simply do
 * not all print in the same edition, because an edition is a front page rather than a charge sheet. Nothing
 * is lost: a story that does not print this time is not tombstoned, so it prints on a later read if it is
 * still true.
 */
export const MAX_CONCERN_STORIES = 2;

/**
 * Every kind of story this desk can write, as the prefix its id starts with.
 *
 * Used by `typeOf` below, which is what the edition cap and the novelty rotation work on. A list rather than a
 * regex because the prefixes are not a pattern - `form-unbeaten` and `home-form` both exist, and so do
 * `wage-pressure` and `wage-control` - and guessing at them from a string is how a type gets split in two.
 */
const STORY_TYPES = [
  "result",
  "clean-sheet",
  "finishing",
  "timing",
  "margin",
  "defence",
  "weakness",
  "form-unbeaten",
  "form-winless",
  "home-form",
  "away-form",
  "scorer",
  "assists",
  "standout",
  // The colour pieces: the running-joke angles on a single player. Registered so the novelty rotation
  // treats each as its own type rather than lumping them together as "player".
  "keeper-goal",
  "defender-goals",
  "kid-scoring",
  "veteran",
  "unsung",
  "duo",
  "double-act",
  "goals",
  "leak",
  "haul",
  "carried",
  "late-winner",
  "thrown-away",
  "drought",
  "contract",
  "depth",
  "youth",
  "trophy",
  "position",
  "block",
  "progress",
  "regress",
  "star",
  "milestone",
  "injury",
  "return",
  "wage-pressure",
  "wage-control",
  "war-chest",
  "commitments",
  "record-fee",
  "sell-to-buy",
  "opinion-manager",
  "opinion-form",
  "opinion-squad",
  "opinion-supporters",
  "opinion-youth",
  "opinion-tactics",
  "opinion-money",
  "opinion-table",
  "celebration",
  "late-leak",
  "keeper-heroics",
  "striker-drought",
  "season-tally",
  "ratings",
  "window",
  "deadline",
  "festive",
  "awards",
] as const;

/**
 * Which KIND of story an id belongs to, with everything specific about it stripped off.
 *
 * The longest matching prefix wins, so `home-form-` is not read as `form-`, and anything unrecognised falls
 * back to its first segment rather than becoming its own type per story.
 */
export function typeOf(id: string): string {
  let match = "";
  for (const type of STORY_TYPES) {
    if (id.startsWith(`${type}-`) && type.length > match.length) match = type;
  }
  return match || (id.split("-")[0] ?? id);
}

/**
 * How many stories one edition carries.
 *
 * NINE, and deliberately fewer than ten. The desk can support around thirty kinds of story and a rich career
 * can honestly produce twenty in one read, but a paper is a front page rather than a transcript of everything
 * that is true. Printing all of it is how a feature list reads: the reader skips the fourth item, and by the
 * tenth he has stopped taking any of them seriously.
 *
 * Nothing is lost by the cap. A story that does not print is not tombstoned, so it prints on a later read
 * while it is still true - and because the novelty penalty below demotes what the last editions ran, the ones
 * that waited are the ones that surface next.
 */
export const MAX_EDITION_STORIES = 9;

/**
 * What a story type costs an edition that has already run it recently.
 *
 * The reason the paper changes. Without it the same nine stories win every read, because weight is fixed and
 * the facts that produced them are still true - so the reader sees the same front page five times and stops
 * opening it. The penalty is big enough to hand a slot to a fresher story of similar weight and small enough
 * that a rout or an injury still leads the paper the day it happens.
 *
 * It is quoted at forty rather than twenty because RELEVANCE now sits in the same sum (see `relevanceOf`).
 * Twenty points of novelty against up to eighty points of being about the match just played is not a rotation
 * at all: the same nine would return every read with a fresh excuse. The price moved, so the rotation still
 * costs what it always cost.
 */
const RECENT_TYPE_PENALTY = 40;

/**
 * Where a story stands in the order of what has just happened.
 *
 * WEIGHT IS NOT RELEVANCE, and telling the two apart is the whole point of this table. Weight says how BIG a
 * story is; relevance says whether it is about NOW. A budget nobody has touched since August is a perfectly
 * good story and it is not why anybody opens the paper the morning after a match, while a modest story about
 * the match itself is exactly why. Ranking on weight alone is what put a squad note and two pieces about
 * money above the report of the last ninety minutes.
 *
 * A topic only sets the floor. Being keyed on the match just played is worth more than any topic is, because
 * that is the difference between a story written about this afternoon and a story that merely could have been.
 */
const RELEVANCE_BY_TOPIC: Record<StoryKind, number> = {
  MATCH: 40,
  FORM: 35,
  OPINION: 30,
  /**
   * Higher than the other topics because an absence is the one topic that can never earn the match bonus.
   *
   * An injury is reported on its own date rather than written from a match, so `relevanceOf` finds no event
   * id on the end of its id and its topic floor is the whole of its relevance. Left at the same level as a
   * column it ranked below one, which is the wrong way round: a fortnight out is a fact about the squad and a
   * column is a view about it.
   */
  TEAMNEWS: 42,
  TABLE: 26,
  PLAYER: 20,
  SQUAD: 14,
  TRANSFER: 12,
  CONTRACT: 12,
  FINANCE: 6,
  TROPHY: 4,
  MILESTONE: 4,
};

/** A story keyed on the match just played, and on the ones shortly before it. */
const RELEVANCE_LATEST_MATCH = 40;
const RELEVANCE_RECENT_MATCH = 14;
const RECENT_MATCHES_IN_WINDOW = 3;

/**
 * How much of the paper's attention a story has earned by being about now.
 *
 * A story's id ends with the match it was written from, which is what makes this answerable from a stored row
 * and its own columns with nothing else to hand. Exported because the ARCHIVE ranks the whole paper with it
 * and not one edition at a time: the front page has to be able to tell which of the rows it is holding is
 * about the match just played and which is about a wage bill.
 */
export function relevanceOf(
  item: { id: string; kind: StoryKind },
  matchEventIds: readonly string[] = []
): number {
  const topic = RELEVANCE_BY_TOPIC[item.kind] ?? 0;
  const index = matchEventIds.findIndex((eventId) => item.id.endsWith(eventId));
  const fromMatch =
    index === 0
      ? RELEVANCE_LATEST_MATCH
      : index > 0 && index < RECENT_MATCHES_IN_WINDOW
        ? RELEVANCE_RECENT_MATCH
        : 0;
  return topic + fromMatch;
}

/**
 * The whole of the desk's judgement about a story: how big it is, and how much it is about now.
 *
 * One function rather than the same expression written out twice, because the ENGINE and the ARCHIVE have to
 * agree. The desk ranks one edition with it and the archive orders the stored paper with it, and two sums
 * that were meant to be one sum is how a paper ends up leading with a story its own desk did not rank first.
 */
export function salienceOf(
  item: { id: string; kind: StoryKind; weight: number },
  matchEventIds: readonly string[] = []
): number {
  return item.weight + relevanceOf(item, matchEventIds);
}

/**
 * The stories that are ABOUT one match rather than about a run of them.
 *
 * Used by the one-match-one-voice cap in `rank`. The distinction is not the same as "keyed on an event id": a
 * form story is keyed on the latest match's id while being about the last five, and so is the scoring summary
 * and the leak. These seven describe a single ninety minutes.
 */
const SINGLE_MATCH_PREFIXES = [
  "result-",
  "clean-sheet-",
  "finishing-",
  "timing-",
  "margin-",
  "defence-",
  "weakness-",
  "ratings-",
  "keeper-heroics-",
] as const;

/**
 * How many angles on one match a single edition may carry.
 *
 * See the note in `rank` for why this is four and not two.
 */
const MAX_ANGLES_PER_MATCH = 4;

/**
 * The fairness pass: a paper that is not stacked against its own subject.
 *
 * Two rules, and both are about the SHAPE OF AN EDITION rather than about any single story, which is why they
 * live here and not in the stories themselves:
 *
 *   1. Critical stories never outnumber positive ones. A squad that has lost four in a row genuinely has
 *      problems, and it also genuinely has a top scorer, an academy kid coming through and a good result
 *      somewhere in the run. Printing only the first half of that is a choice, and it is the wrong one.
 *   2. One player is not hit twice in the same edition. A dip in form and a contract worry about the same man
 *      is two stories on one afternoon, which reads as a campaign against him.
 *
 * Dropped stories keep their LOWEST weight, so the paper keeps the most significant version of a criticism
 * and loses the pile-on.
 */
/**
 * Critical stories that are FACTS rather than the desk's opinion.
 *
 * An injury report is CONCERN-toned because it is bad news, not because anybody is being criticised. The two
 * fairness rules below exist to stop a paper piling criticism on a struggling manager, and applying them to a
 * report of something he told the desk himself would be the opposite of fair: it would bury the one piece of
 * hard news on the page to make room for a third opinion. So they are counted separately and never dropped
 * for the sake of balance.
 */
const REPORTED_CATEGORIES = new Set(["TEAM NEWS"]);

function isReported(item: { category: string }): boolean {
  return REPORTED_CATEGORIES.has(item.category);
}

function balanceCoverage<T extends { weight: number; id: string; category: string; tone: NewsTone; playerNames: string[] }>(
  items: T[]
): T[] {
  // Reported news is set aside first, so nothing below can thin it, and its players do not consume the
  // one-criticism-per-player budget either - being injured and being criticised are not the same thing.
  const reported = items.filter((item) => item.tone === "CONCERN" && isReported(item));
  const concerns = items.filter((item) => item.tone === "CONCERN" && !isReported(item));
  const positives = items.filter((item) => item.tone === "GOOD");
  if (concerns.length === 0) return items;

  // Rule 1: the cap, then the balance against the good news actually available.
  const keepConcernCount = Math.min(MAX_CONCERN_STORIES, Math.max(positives.length, 1), concerns.length);
  const kept = concerns.slice(0, keepConcernCount);
  const dropped = new Set(concerns.slice(keepConcernCount));

  // Rule 2: one critical story per player, the most significant one. Applied after the cap, so the edition
  // keeps its strongest two cases rather than its first two.
  const named = new Set<string>();
  for (const item of reported) {
    for (const name of item.playerNames) named.add(name.toLowerCase());
  }
  for (const item of kept) {
    const repeated = item.playerNames.some((name) => named.has(name.toLowerCase()));
    if (repeated) {
      dropped.add(item);
      continue;
    }
    for (const name of item.playerNames) named.add(name.toLowerCase());
  }

  if (dropped.size === 0) return items;
  // The order the caller already had, minus the dropped stories. No re-sort: `items` arrives ranked, and
  // re-deriving the order here would be a second opinion about significance.
  return items.filter((item) => !dropped.has(item));
}
