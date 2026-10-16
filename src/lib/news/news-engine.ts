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
 */
export const NEWS_COPY_VERSION = 13;

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
  bigChances: number | null;
  /**
   * The game's own expected goals, present only when the manager scanned it off the Match Facts screen.
   *
   * A decimal, and not the model's figure. Both are optional here for the same reason: a debrief may carry
   * either, both, or neither, and the desk has to say which one it argued from.
   */
  expectedGoalsReported: number | null;
  /** What the manager told the press, when the press asked and he answered. */
  comment: string | null;
  /** True when the press asked and got nothing. A distinct thing from never having been asked. */
  commentRefused: boolean;
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
 * fills with accents - "C. Patiño" - and a match contribution, which is whatever was recorded at the
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
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
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
 * Exact change is not how money is reported. "£12,400,000" is a spreadsheet reading and "about £12m" is a
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
  // The left side opens the line, and the fallback phrase for it is lowercase, so it is capitalised here rather
  // than at each of the three places this is used as a headline. The right side stays as it is: "Kingsbridge
  // Athletic 2-0 the visitors" is how a scoreline is read, and "The Visitors" would not be.
  return `${capitalise(left)} ${scoreOf(match)} ${right}`;
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

/** How many times the lead changed hands. Zero when nobody led, or when one side led throughout. */
function leadChanges(match: NewsMatch): number {
  let ours = 0;
  let theirs = 0;
  let leader: "US" | "THEM" | null = null;
  let changes = 0;
  for (const event of runningScore(match)) {
    if (event.ours) ours += 1;
    else theirs += 1;
    const now: "US" | "THEM" | null = ours > theirs ? "US" : theirs > ours ? "THEM" : null;
    if (now !== null) {
      if (leader !== null && now !== leader) changes += 1;
      leader = now;
    }
  }
  return changes;
}

/**
 * A weakness note reduced to a shape that can be compared.
 *
 * The manager's note is his own shorthand and it is not written for print: "Switched off after scoring"
 * is a note to self, not a sentence in a paper, and printing it verbatim is the most obvious way this
 * desk could read as an app quoting a field.
 */
function normaliseNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What a weakness note amounts to, in the language of a match report.
 *
 * The note is matched to a family and the family supplies the wording, so the paper never prints the
 * manager's own shorthand and never guesses at a specific. The `key` is stable per family, which is
 * what the story id is built from - an id that embedded the note itself would change with a stray
 * capital letter and republish a story the reader had already seen.
 *
 * A note that matches nothing returns null and the caller falls back to the generic line, which is a
 * weaker sentence but never a wrong one.
 */
function weaknessFamily(note: string): { key: string; line: string } | null {
  const text = normaliseNote(note);
  if (text.length === 0) return null;
  const families: { key: string; test: RegExp; line: string }[] = [
    {
      key: "switching-off",
      test: /switch(ed|ing)? off|concentrat|focus|complacen|mentali|off the pace/,
      line: "a spell of switching off after the goal",
    },
    {
      key: "set-pieces",
      test: /set piece|setpiece|corner|free kick|dead ball|cross/,
      line: "the set pieces",
    },
    {
      key: "counter-attack",
      test: /counter|break|transition|caught on|exposed|played through/,
      line: "the way the side was caught upfield",
    },
    {
      key: "finishing",
      test: /finish|chance|wasteful|clinical|missed|proflig|conversion/,
      line: "what happened in front of goal",
    },
    {
      key: "passing",
      test: /pass|possession|control|sloppy|loose|giveaway|gave the ball/,
      line: "the passing",
    },
    {
      key: "tempo",
      test: /press|intensity|energy|slow|lethargic|flat|tempo/,
      line: "the tempo",
    },
    {
      key: "shape",
      test: /defen|back line|backline|shape|offside|discipline|foul/,
      line: "the shape without the ball",
    },
    {
      key: "late-on",
      test: /fitness|tired|legs|fade|stamina|late/,
      line: "the way the match ran away late on",
    },
    { key: "injuries", test: /injur|knock|fitness doubt/, line: "the injuries" },
    { key: "goalkeeping", test: /keeper|goalkeep|goalie|shot stopping/, line: "the goalkeeping" },
    { key: "width", test: /width|wing|flank|wide/, line: "the width" },
    { key: "bench", test: /sub|bench|changes|rotation/, line: "the changes from the bench" },
  ];
  const found = families.find((family) => family.test.test(text));
  return found ? { key: found.key, line: found.line } : null;
}

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
 * The third of the pitch a position plays in, as a phrase: "the middle of the park", "the back line".
 *
 * Used where a story is about a department rather than a person, and a sentence would otherwise have to
 * repeat the position code twice.
 */
function positionGroupWords(role: string | null | undefined): string {
  switch (roleGroup(role ?? null)) {
    case "GK":
      return "goal";
    case "DEF":
      return "defence";
    case "MID":
      return "midfield";
    case "ATT":
      return "attack";
    default:
      return "team";
  }
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
      body: `${tally} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")} from a ${role}. ${source(latest.eventId, "defender-source")} have noticed that nobody has asked him to stop.`,
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
      body: `${kid.name} is ${kid.age}. He has ${tally} ${plural(tally, "goal")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}, and the coaching staff have spent the week telling anyone who will listen not to make a fuss of him.`,
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
  const aftermath = (match: NewsMatch, seed: string): { line: string; quote: string | null } => {
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
 *   "I. Olaofe got the goals. J. Koroma, I. Olaofe and C. Patiño drew the eye above all."
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
  const against = opponentWord(last);
  const margin = last.goalsFor - last.goalsAgainst;
  const cleanSheet = last.goalsAgainst === 0;
  const scorerNames = scorers.map((entry) => entry.name);
  const named = new Set(scorerNames.map(foldName));
  // Singled out players who did NOT score. Naming a scorer twice in one paragraph is exactly what made
  // the first version read like a machine filling in fields.
  const others = last.standouts.filter((name) => !named.has(foldName(name)));
  const everyone = last.standouts;
  const at = venueWord(last);
  /**
   * The venue as something to append, or nothing at all.
   *
   * A sentence that cannot place the match drops the venue rather than half-writing it, and the first
   * version's default was worse than that: it tested `startsWith("a")`, which "at home" satisfies, so
   * every away match with an unread venue was reported as a home one.
   */
  const where = at.length > 0 ? ` ${at}` : "";
  const totalGoals = last.goalsFor + last.goalsAgainst;
  /** A win by one goal in a match with four or more in it. A different afternoon from a 1-0. */
  const thriller = last.result === "WIN" && margin === 1 && totalGoals >= 4;
  /** A win that got uncomfortable: two or more conceded, and not a rout. */
  const scare = last.result === "WIN" && margin <= 2 && last.goalsAgainst >= 2;
  /**
   * Late and early goals, only where the timing tells the reader something.
   *
   * Both are restricted to a margin of two or less, because in a four-goal win "left it late" is
   * nonsense and "did the damage early" only repeats what the rout frame already said.
   */
  const late = margin <= 2 && lateGoals(last.goalMinutes) > 0;
  const early = margin <= 2 && earlyGoals(last.goalMinutes) > 0;
  const decided = decidingGoalMinute(last);
  const goalless = last.goalsFor === 0 && last.goalsAgainst === 0;

  /**
   * Who scored, and how many, as a clause. Null when the debrief logged the scoreline without a scorer.
   *
   * The count comes from the scorers array rather than from the scoreline, so a player is never credited
   * with a goal the debrief does not record - which is what "scored both" claims, and it is the sort of
   * claim a paper cannot take back.
   */
  const scorerClause = (() => {
    if (scorers.length === 0) return null;
    if (scorers.length === 1) {
      const only = scorers[0];
      return only.goals === 1 ? `${only.name} got it` : `${only.name} scored ${goalTallyWord(only.goals)}`;
    }
    return `${namesList(scorerNames)} shared them`;
  })();

  /**
   * What can honestly be said about the goals, in one clause.
   *
   * A scoreline with no scorer attached says only what is known. The first version printed "with no
   * scorer in the debrief" and "the scoreline came from nowhere in particular", which is the app
   * talking to itself on a newspaper page.
   */
  const goalsClause =
    scorerClause ??
    (last.goalsFor === 0 ? `${input.clubName} drew a blank` : `${input.clubName} scored ${countWord(last.goalsFor)}`);

  const defenceClause = cleanSheet
    ? [
        `and nothing came back the other way`,
        `with a clean sheet to go with it`,
        `and the defence kept ${against} out entirely`,
        `without conceding once`,
      ]
    : last.goalsAgainst === 1
      ? [
          `though ${against} did get one back`,
          `with a goal against to think about`,
          `and ${against} found one reply`,
        ]
      : [`and ${last.goalsAgainst} conceded`];

  const openings: string[] = [];

  if (goalless) {
    openings.push(
      `A goalless draw against ${against}, and neither side did enough to change it.`,
      `Nothing at either end${where}: ${input.clubName} and ${against} played out a goalless draw.`,
      `${input.clubName} and ${against} cancelled each other out. No goals, and a point each.`,
      `A point apiece and no goals to show for it, which against ${against} was about right.`
    );
  } else if (last.result === "WIN") {
    if (margin >= 3) {
      openings.push(
        `${input.clubName} did not leave this one in doubt: ${goalsClause}, ${pick(defenceClause, seed, "bigwin-def")}.`,
        `A comfortable win${where} for ${input.clubName}, who took it ${scoreOf(last)} with ${goalsClause}.`,
        `${fixtureLine(last, input.clubName)} flatters nobody, and ${input.clubName} earned every bit of it: ${goalsClause} ${pick(defenceClause, seed, "bigwin-def2")}.`
      );
    } else if (margin === 2) {
      openings.push(
        `Two goals were enough for ${input.clubName}, who beat ${against} ${scoreOf(last)}: ${goalsClause}, ${pick(defenceClause, seed, "win2-def")}.`,
        `${input.clubName} always had a little too much here, ${goalsClause}, ${pick(defenceClause, seed, "win2-def2")}.`,
        `A two-goal margin${where} for ${input.clubName}, and it was built on ${goalsClause}.`
      );
    } else {
      openings.push(
        `One goal was enough. ${capitalise(goalsClause)}, and ${input.clubName} held on to it against ${against}.`,
        `${input.clubName} won it by the narrowest of margins: ${goalsClause}, and from there the job was to keep ${against} at arm's length.`,
        `It was decided by a single moment, ${goalsClause}, and ${input.clubName} did the rest.`
      );
      if (decided !== null) {
        openings.push(
          `${input.clubName} won it ${scoreOf(last)} with a goal on ${decided} minutes, and then had to hold what they had.`,
          `The goal came on ${decided} minutes, and ${input.clubName} spent the rest of it defending it.`
        );
      }
    }
    if (thriller) {
      openings.push(
        `A thriller against ${against}, and ${input.clubName} came out of it with the points: ${goalsClause}, ${pick(defenceClause, seed, "thriller-def")}.`,
        `${last.goalsAgainst} conceded and still a win: ${goalsClause}, and ${input.clubName} had just enough to see off ${against}.`
      );
    }
    if (trailedAtAnyPoint(last) && ledAtAnyPoint(last)) {
      openings.push(
        `${input.clubName} had to come from behind to win this one, and ${goalsClause} did it: ${scoreOf(last)} against ${against}.`,
        `Behind at one stage and ahead by the end: ${goalsClause}, and a win that says something about the side's nerve.`
      );
    }
    if (leadChanges(last) >= 2) {
      openings.push(
        `The lead changed hands more than once, and ${input.clubName} had the last word: ${goalsClause}, and ${scoreOf(last)} on the board.`
      );
    }
    if (scare) {
      openings.push(
        `${input.clubName} had this won and then let ${against} back into it: ${goalsClause}, and a finish that was tighter than it needed to be.`,
        `Comfortable enough in the end, though ${input.clubName} made harder work of it than the scoreline suggests: ${goalsClause}.`
      );
    }
    if (late) {
      openings.push(
        `${input.clubName} left it late against ${against}, but ${goalsClause} and the points stayed${where || " with them"}.`,
        `The goals came when they came, and that was late enough to make it feel earned: ${goalsClause} ${pick(defenceClause, seed, "late-def")}.`
      );
    }
    if (early) {
      openings.push(
        `${input.clubName} did the damage early: ${goalsClause}, ${pick(defenceClause, seed, "early-def")}, and the rest was management.`,
        `An early goal changed what this match was going to be: ${goalsClause}, and ${against} spent the rest of it chasing.`
      );
    }
  } else if (last.result === "DRAW") {
    openings.push(
      `Honours even at ${scoreOf(last)}. ${capitalise(goalsClause)}, and neither side did enough to change that.`,
      `${input.clubName} and ${against} could not be separated: ${goalsClause}, and a point each.`,
      `A point apiece, and ${goalsClause} was the sum of it. ${capitalise(against)} will feel as much like it was theirs as ${input.clubName} will.`
    );
    if (trailedAtAnyPoint(last)) {
      openings.push(
        `${input.clubName} had to come from behind against ${against} and settled for a point: ${goalsClause}.`,
        `Behind at one stage and level by the end: ${goalsClause}, and on the balance of it a point was fair.`
      );
    }
  } else if (last.result === "LOSS") {
    if (last.goalsFor === 0) {
      openings.push(
        `${input.clubName} lost this one ${scoreOf(last)} without scoring.`,
        `${capitalise(against)} kept ${input.clubName} out entirely, and that was the match: ${scoreOf(last)}.`,
        `Nothing at the other end for ${input.clubName}, and defeat by ${scoreOf(last)}.`
      );
    } else if (last.goalsFor === 1 && scorers.length === 1) {
      const only = scorers[0].name;
      openings.push(
        `Defeat for ${input.clubName} against ${against}, and ${only} scored the consolation.`,
        `${capitalise(against)} had too much for ${input.clubName}, for whom ${only} got the only reply.`,
        `A losing ${scoreOf(last)}, and ${only}'s goal was all ${input.clubName} had to show for it.`
      );
    } else if (last.goalsFor === 1) {
      openings.push(
        `Defeat against ${against}, and the single reply was not enough: ${scoreOf(last)}.`,
        `One goal back, and no more than that for ${input.clubName} against ${against}.`
      );
    } else {
      openings.push(
        `${input.clubName} lost this one ${scoreOf(last)}, and ${goalsClause} was as much as they managed.`,
        `Defeat against ${against}, and the shape of it will bother the manager more than the scoreline: ${goalsClause}, and ${last.goalsAgainst} at the other end.`,
        `${input.clubName} never got a grip on it. ${capitalise(goalsClause)}, and ${against} had the rest.`
      );
    }
  } else {
    openings.push(`${fixtureLine(last, input.clubName)}. ${capitalise(goalsClause)}.`);
  }

  const opening = pick(openings, seed, "opening");

  // A second sentence, only when it can add something. Most matches have exactly one of these.
  const addition = others.length > 0
    ? pick(
        [
          `${namesList(others)} did the work that does not show up in the scoreline and got the manager's eye for it.`,
          `Away from the goals, ${namesList(others)} ${isAre(others.length)} the ${plural(others.length, "name")} the manager came back to.`,
          `${namesList(others)} will have done ${hisTheir(others.length)} case no harm at all.`,
          `It was ${namesList(others)} the manager picked out afterwards, and that usually means something.`,
        ],
        seed,
        "addition-others"
      )
    : cleanSheet && scorerNames.length > 0
      ? pick(
          [
            `A clean sheet and ${plural(last.goalsFor, "goal")} at the other end is the sort of match a manager files away as the standard.`,
            `Keeping them out mattered as much as scoring, and that is usually the harder half.`,
          ],
          seed,
          "addition-clean"
        )
      : everyone.length > 0
        ? pick(
            [
              `${namesList(everyone)} drew the eye in a match that needed somebody to.`,
              `There was enough in it for ${namesList(everyone)} to come away with some credit.`,
            ],
            seed,
            "addition-eye"
          )
        : "";

  return tidy([opening, addition, saidLine].filter(Boolean).join(" "));
}

  // ---- 1. The last match, reported straight -------------------------------------------------
  if (last) {
    const scorers = scorerTally(last.scorers);
    const against = opponentWord(last);
    const headline = pick(
      last.result === "WIN"
        ? [
            fixtureLine(last, input.clubName),
            `${input.clubName} Take the Points Against ${against}`,
            `Won It ${scoreOf(last)}: ${input.clubName} See Off ${against}`,
            // The opponent phrase is "the visitors" when the save holds no name, so it has to be capitalised
            // where it opens the line: "the visitors Beaten as ..." was printing as a lowercase headline.
            `${capitalise(against)} Beaten as ${input.clubName} Find a Way`,
          ]
        : last.result === "LOSS"
          ? [
              fixtureLine(last, input.clubName),
              `Defeat for ${input.clubName} Against ${against}`,
              `${input.clubName} Beaten ${scoreOf(last)}`,
              `Beaten ${scoreOf(last)}: ${input.clubName} Lose to ${against}`,
            ]
          : [
              `Honours Shared: ${fixtureLine(last, input.clubName)}`,
              `${input.clubName} Held to ${scoreOf(last)}`,
              `All Square Against ${against}`,
              `Nothing Between Them: ${scoreOf(last)}`,
            ],
      last.eventId,
      "headline"
    );

    const said = aftermath(last, last.eventId);
    const body = matchReportBody(input, last, scorers, said.line);

    /**
     * The paragraph the lead report EARNS.
     *
     * The card is the short read and the article is what the reader gets when he opens it, so the article has
     * to add something the card did not say. It used to add nothing at all: every report was the summary and a
     * closing line, which made opening the lead story a waste of a tap.
     *
     * Three sources, and each is guarded by its own fact: the shot figures, the minutes the goals actually
     * came in, and the competition the match was played in. No new fact is invented for it - a match whose
     * debrief recorded none of these gets no second paragraph rather than a paragraph of padding, which is the
     * same rule the rest of the desk works to.
     */
    const earned: string[] = [];
    if (last.shots !== null && last.shotsInsideBox !== null) {
      const shots = `${last.shots} shots, ${last.shotsInsideBox} of them inside the box${last.bigChances !== null ? ` and ${last.bigChances} clear ${plural(last.bigChances, "chance")}` : ""}`;
      earned.push(
        `The shape of it is in the numbers: ${shots}. A side that gets into those positions is not living on one moment, whatever the scoreline says.`,
        `${shots}. That is the part of this a manager takes away from a result like it, because it is the part that repeats.`
      );
    }
    if (last.goalMinutes.length >= 2) {
      const first = Math.min(...last.goalMinutes);
      const final = Math.max(...last.goalMinutes);
      earned.push(
        `The goals came on ${first} and ${final} minutes. Spread out like that, this was a match that was managed rather than one that got away.`,
        `There was nothing lucky about the timing of them: ${first} minutes for the first and ${final} for the last is a long way from a side that scored and then held on.`
      );
    }
    if (last.concededMinutes.length > 0) {
      earned.push(
        `The reply came on ${Math.max(...last.concededMinutes)} minutes, and that is the part of it the manager will look at twice.`,
        // Same reason as the headline: this opens a sentence, and the fallback phrase is lowercase.
        `${capitalise(against)} found their moment on ${Math.max(...last.concededMinutes)} minutes, which is the detail that stops this being a clean sheet of a performance.`
      );
    }
    if (last.competition) {
      earned.push(
        `The ${last.competition} points count the same as any others, and these read better than most.`,
        `However the season is filed, this counts the same as any other ${last.competition} result.`
      );
    }
    const earnedParagraph = earned.length > 0 ? pick(earned, last.eventId, "article-earned") : null;

    items.push({
      id: `result-${last.eventId}`,
      kind: "MATCH",
      category: last.result === "LOSS" ? "MATCH REPORT" : "TOP STORY",
      tone: last.result === "WIN" ? "GOOD" : last.result === "LOSS" ? "CONCERN" : "NEUTRAL",
      headline,
      body,
      ...(earnedParagraph ? { article: [earnedParagraph] } : {}),
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
    // Two ways to argue from, and the better one wins. The game reports its own expected goals, which the
    // scanner can read; failing that, the app's two rounded weights stand in. The story names which of the
    // two it used, because "you finished ahead of it by 1.4" means different things from the two figures.
    //
    // The guard no longer demands inside box and big chances. Those two are the model's terms rather than
    // things the manager always counts, and a real figure does not need them present to be worth a verdict.
    // A reliable expected figure plus the shot count is enough to say something true.
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
                  `A Question of Finishing After ${scoreOf(last)}`,
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
            last.bigChances !== null ? `${last.bigChances} big ${plural(last.bigChances, "chance")}` : "",
            fromTheGame
              ? `The game's own expected goals was ${formatExpectedGoals(expected)}, so you finished ${clinical ? "ahead of" : "behind"} it by ${formatExpectedGoals(Math.abs(edge))}`
              : `The app's model made that worth ${expected.toFixed(1)} goals, so you finished ${clinical ? "ahead of" : "behind"} it by ${Math.abs(edge).toFixed(1)}`,
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
        body: `${source(recent[0].eventId)} say the last ${run} ${plural(run, "match", "matches")} have brought ${tallyWords}. ${input.managerName} has a side nobody is enjoying playing against.${began ? ` The run goes back to ${began.month}.` : ""}`,
        evidence: [`Run ${formString(slice)}`, tallyWords],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 88,
        quote: null,
      });
    } else if (winless === -1 && losses >= 3) {
      items.push({
        id: `form-winless-${recent[0].eventId}`,
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
        body: `${home.length} home ${plural(home.length, "match", "matches")} and no defeat: ${formWords(home)}. On their own ground ${input.clubName} have become awkward opponents.`,
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
              `A Statement: ${input.clubName} ${scoreOf(heavy)}`,
            ],
            heavy.eventId,
            "headline-margin"
          )
        : pick(
            [
              `Heavy Defeat: ${fixtureLine(heavy, input.clubName)}`,
              `${input.clubName} Beaten Heavily by ${heavyAgainst}`,
              `${scoreOf(heavy)}: a Scoreline That Will Be Remembered`,
            ],
            heavy.eventId,
            "headline-margin"
          ),
      body: `A ${Math.abs(heavy.goalsFor - heavy.goalsAgainst)}-goal margin is not a detail. ${won ? `Nobody at ${input.clubName} will pretend that was anything other than comfortable.` : `The questions after a result like that do not answer themselves.`}${aftermath(heavy, `margin-${heavy.eventId}`).line ? ` ${aftermath(heavy, `margin-${heavy.eventId}`).line}` : ""}`,
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
        kind: "CONTRACT",
        category: "TRANSFER DESK",
        tone: expired ? "CONCERN" : "NEUTRAL",
        headline: pick(
          [
            `${soonest.name} Out of Contract in ${soonest.contractValidUntil}`,
            `Talks Needed: ${soonest.name} Free in ${soonest.contractValidUntil}`,
            `Decision Looming on ${soonest.name}`,
            `The Clock Is Running on ${soonest.name}`,
          ],
          `${soonest.name}${soonest.contractValidUntil}`,
          "headline"
        ),
        body: pick(
          [
            `${sameYear === 1 ? `One deal expires in ${soonest.contractValidUntil}` : `${sameYear} deals expire in ${soonest.contractValidUntil}`}, ${soonest.name} first. ${expired ? "That year is already under way, so the clock is not a figure of speech." : "Either talks open or a fee becomes nothing."}`,
            `${source(`${soonest.name}${soonest.contractValidUntil}`, "contract-source")} have ${soonest.name} down as the next paperwork job: his deal runs to ${soonest.contractValidUntil}, along with ${sameYear === 1 ? "one other" : `${sameYear - 1} other`} in the same year.`,
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
  if (latestTrophy) {
    items.push({
      id: `trophy-${latestTrophy.name}-${latestTrophy.season}`,
      kind: "TROPHY",
      category: "SILVERWARE",
      tone: "GOOD",
      headline: pick(
        [
          `${latestTrophy.name} in the Cabinet`,
          `${input.clubName} Lift the ${latestTrophy.name}`,
          `Honours: the ${latestTrophy.name}`,
          `Silverware: ${latestTrophy.name}`,
        ],
        `${latestTrophy.name}${latestTrophy.season}`,
        "headline"
      ),
      body: `The ${latestTrophy.name} arrived in season ${latestTrophy.season}. ${input.managerName} has ${input.trophies.length} ${plural(input.trophies.length, "honour", "honours")} on the shelf, and the cabinet is in the Season tab.`,
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
      kind: "TABLE",
      category: "TABLE WATCH",
      tone: position <= 6 ? "GOOD" : position >= 18 ? "CONCERN" : "NEUTRAL",
      headline: pick(
        position <= 3
          ? [`${input.clubName} ${ordinal(position)} and Climbing`, `Up to ${ordinal(position)} in the ${input.leagueName ?? "table"}`, `${ordinal(position)}: the Table Takes Shape`]
          : position <= 6
            ? [`${ordinal(position)} in the ${input.leagueName ?? "table"}`, `${input.clubName} in the Top Six`, `European Places Within Reach at ${ordinal(position)}`]
            : position >= 18
              ? [`${ordinal(position)} and Looking Down`, `${input.clubName} in Trouble at ${ordinal(position)}`, `The Table Is Not Kind at ${ordinal(position)}`]
              : [`${ordinal(position)} in the Table`, `${input.clubName} Mid-Table at ${ordinal(position)}`, `Nothing Settled at ${ordinal(position)}`],
        `position${position}${input.seasonNumber}`,
        "headline"
      ),
      body: `The final table had ${input.clubName} ${ordinal(position)}${input.leagueName ? ` in the ${input.leagueName}` : ""}. ${disputed ? "The logged position and the final table disagree, so treat it with care." : "That is where the season finished."}${previousSeason && previousSeason.tablePosition !== null ? ` The season before, ${ordinal(previousSeason.tablePosition)}.` : ""}`,
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
      body: `${points} points from the last ${input.block.gamesPlayed} ${plural(input.block.gamesPlayed, "match", "matches")}, at ${perGame.toFixed(1)} a game. ${perGame >= 1.6 ? "Do that for a season and nobody finishes above you." : perGame < 1 ? "Do that for a season and the table says what it says." : "That is the sort of return that keeps a season moving without moving it much."}${atPhase ? ` It is a return worth weighing ${atPhase} rather than in isolation.` : ""}`,
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
        body: `The money available is understood to be ${budget}. At this level of the game that is a starting player and very little besides, which is the sort of budget that has to be spent well or not at all. Whether it is spent is a different question from whether it is there, and the answer to the second one is now on the record.`,
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
        ? "One player is inside the last year of his deal, so the next marquee arrival is most plausibly funded by a departure."
        : shortDeals > 1
          ? `${capitalise(countWord(shortDeals))} players are inside the last year of their deals, so the next marquee arrival is most plausibly funded by a departure.`
          : "On this record, a significant arrival would most plausibly be funded by a departure.";

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
        body: `No transfer budget is recorded for this club, which usually means one of two things: the board has not set one, or there is nothing to set. History on the record suggests the money would come from a sale, and that is the version of the window a manager does not control. The manager has not said either way, which is itself an answer.`,
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
              `${best.name} is better than he was recently, and the club have noticed. He is ${positionPhrase(where)}, and improvement in ${positionGroupWords(where)} tends to show up in a match before it shows up on a list.`,
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
                `Improvement ${age !== null ? `at ${age} ` : ""}is worth more than it looks. Nobody is going to hand him a new contract on the back of it, and nobody needed to be told he could play.`,
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
      body: `${star.name}${star.age !== null ? `, ${star.age},` : ""} is the player opponents set up to stop. ${source(`${star.name}${starOverall}`, "star-source")} are in no doubt that the best player at the club is in the building, and not for much longer on this form.`,
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
    const standing = pickFresh(
      absence.isStarter
        ? [
            `He has been a regular part of this ${input.clubName} side, which is what makes it a team selection problem rather than a line on a medical sheet.`,
            `He is in the manager's XI when everybody is fit, so this is not a squad note. It is a change to the team that has to be made from outside it.`,
            `A first choice is missing, and that is a different sentence from "a player is injured". The side that has been picked has to be picked differently.`,
            `He has been starting, which puts the problem where it belongs: in the team sheet rather than in the treatment room's paperwork.`,
            `The XI has to change, and not by choice. Losing a player the manager was already picking is the expensive kind of absence.`,
          ]
      : [
            `He was not in the saved XI, so the shape does not have to move. What a squad loses in that case is depth, and depth is what the back half of a season is played on.`,
            `This is not a change to the first choice side, and it should not be reported as one. It is a hole in the cover, which matters later rather than in the next match.`,
            `He has not been starting, so the team that lines up is the team the manager wanted. The cost of this one is measured in the options he no longer has on the bench.`,
            `The starting XI is untouched by it. What the squad loses is an alternative, and alternatives are only noticed in the weeks when three games land in eight days.`,
            `A squad player rather than a starter, so nobody has to re-pick the side. The absence still narrows the bench, and a narrow bench is what makes a manager conservative.`,
          ],
      seed,
      "article-standing",
      used
    );

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
          standing,
        ],
        weight: 62,
      },
      WEEKS: {
        headline: [
          `${absence.name} Faces ${capitalise(timeOut)} Out`,
          `${capitalise(timeOut)} Out for ${absence.name}`,
          `${input.clubName} Lose ${absence.name} for ${capitalise(timeOut)}`,
          `A Spell on the Sidelines for ${absence.name}`,
          `${absence.name} Set to Miss ${capitalise(timeOut)}`,
        ],
        body: {
          fact: [
            `${absence.name} is out for ${timeOut}, and that is long enough to stop being a knock and start being a run of games without him.`,
            `${absence.name} will miss ${timeOut} of football. ${capitalise(timeOut)} is the awkward length: long enough that somebody else has to play, short enough that nobody signs anyone about it.`,
            `Out for ${timeOut}, and ${absence.name} leaves a hole in the ${words} position that has to be filled from inside the squad, because no window is open to solve it any other way.`,
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
          standing,
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
          standing,
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
          standing,
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
          standing,
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
        body: `${haul.name} scored ${goalTallyWord(haul.goals)} in a match that finished ${scoreOf(last)}. ${haulTally.length === 1 ? `Nobody else scored for ${input.clubName} at all, which makes it his match rather than his side's.` : `${namesList(haulTally.slice(1).map((entry) => entry.name))} got the others, which will not bother him much.`}`,
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
    } else if (haul && haul.goals >= 2 && last.goalsFor === haul.goals && last.goalsAgainst > 0) {
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
        body: `Every goal ${input.clubName} scored came from ${haul.name}, and the match finished ${scoreOf(last)}. A player doing that will be pleased with himself and the manager will be quietly uneasy about it, because a side that scores only through one man has one man to lose.`,
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
    if (decided !== null && decided >= 85 && last.result === "WIN") {
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
        body: `The goal that won it came on ${decided} minutes, which is late enough that ${haulAgainst} will feel they had it. A match like that is remembered for the moment rather than for the ninety minutes, and ${input.clubName} will not mind which part of it is remembered.`,
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
        body: `${input.clubName} were in front in this one and finished it ${scoreOf(last)}, which is a different sentence from a defeat and a worse one than a draw. Led, level, and the manager left to explain the space between the two. It is the sort of thing that shows up in a table at the end of a season.`,
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
      body: `Nothing has gone in for ${scorelessRun} ${plural(scorelessRun, "match", "matches")}. That is not bad luck and it is not a defensive problem: it is a team that has stopped finding a way to score, and every match it continues is one more the manager has to explain.`,
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

  // 25a. The manager himself, which is the column every paper has an opinion about.
  if (recent.length >= 3) {
    items.push({
      id: `opinion-manager-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "TALKING POINT",
      tone: badRun ? "CONCERN" : "NEUTRAL",
      stance: badRun ? "HOSTILE" : "STRAIGHT",
      headline: pick(
        badRun
          ? [
              `The Case Against ${input.managerName} Is Getting Easier to Make`,
              `Something Has to Change at ${input.clubName}`,
              `${input.clubName} Are Going Backwards`,
            ]
          : [
              `${input.managerName} Has Earned the Benefit of the Doubt`,
              `Judging ${input.managerName} Fairly`,
              `What We Actually Know About ${input.managerName}`,
            ],
        `op-manager${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: badRun
        ? `${straightLosses} defeats in a row is not a blip, it is a pattern, and patterns are a manager's problem. The argument that the squad is not his does not survive a ${ordinalWord(input.seasonNumber)} season in charge: at some point the team on the pitch is the one he built. None of this is a demand for anybody's head. It is an observation that the case for patience has to be argued now rather than assumed.`
        : `The record is ${formWords(recent)}, and it is worth saying plainly that a manager's work is not measured over ${recent.length} ${plural(recent.length, "match", "matches")}. It is measured over seasons, and the only honest place to stand is a few paces back. That is not a defence of anybody. It is what the evidence supports, and the evidence is all anybody outside the club actually has.`,
      article: [
        pick(
          badRun
            ? [
                `There is a version of this where the manager is right and the results are wrong, and it is the version that ends with everybody out of work. The harder question is not whether he is a good manager but whether the same problems keep arriving, week after week, in the same place.`,
                `It is worth remembering that this is the ${ordinalWord(input.seasonNumber)} season of a project rather than the ${ordinalWord(input.seasonNumber)} month of one. Projects are allowed to be judged, and they are not allowed to be exempt.`,
              ]
            : [
                `What is knowable is small: a run of results, the squad he has, and how long he has been here. What is not knowable is anything happening inside the training ground at half past nine on a Tuesday, which is where most of this is actually decided.`,
                `The temptation with a manager who has won something is to stop examining the present. The temptation with one who has not is to stop crediting the past. Both are ways of not reading the evidence.`,
              ],
          `op-manager-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [
        `Run ${formString(recent)}`,
        `${straightLosses} straight ${plural(straightLosses, "defeat")}`,
        `Season ${input.seasonNumber} of the manager's time here`,
        badRun ? "Filed hostile: the run justifies the argument" : "Filed straight: the facts do not carry a verdict",
      ],
      playerNames: [],
      publishedOn: at,
      weight: 78,
      quote: null,
    });
  }

  // 25b. The form column, which is the one a tabloid writes and a broadsheet does not.
  if (recent.length >= 3) {
    const wins = recent.filter((match) => match.result === "WIN").length;
    const losses = recent.filter((match) => match.result === "LOSS").length;
    items.push({
      id: `opinion-form-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "OPINION",
      tone: wins > losses ? "GOOD" : losses > wins ? "CONCERN" : "NEUTRAL",
      stance: "SENSATIONAL",
      headline: pick(
        [
          `The Numbers Do Not Care About Your Excuses`,
          `${wins} Wins, ${losses} ${plural(losses, "Defeat", "Defeats")}: the Season in One Line`,
          `Forget the Table, Look at This`,
          `It Is Time to Talk About the Form`,
        ],
        `op-form${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: `The last ${recent.length} ${plural(recent.length, "match", "matches")} have brought ${formWords(recent)}, and that is the whole of it. Everything else on the page is interpretation. This is the part that will still be true in a month.`,
      article: [
        pick(
          [
            `There is no clever reading of a run like this one and anybody offering one has a book to sell. A sequence of results is the least subtle piece of evidence in football and the most reliable.`,
            `Every club has a paragraph of context for a sequence like this, and every one of those paragraphs has been written before about somebody else. The sequence is the part nobody can argue with.`,
          ],
          `op-form-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [`Run ${formString(recent)}`, `${wins} wins, ${losses} defeats in the window`],
      playerNames: [],
      publishedOn: at,
      weight: 76,
      quote: null,
    });
  }

  // 25c. The loyal column, from the paper that stands behind the club rather than above it.
  if (input.squad.length > 0) {
    items.push({
      id: `opinion-squad-${input.seasonNumber}`,
      kind: "OPINION",
      category: "OPINION",
      tone: "GOOD",
      stance: "LOYAL",
      headline: pick(
        [
          `This Squad Is Better Than It Is Being Given Credit For`,
          `A Note on What ${input.clubName} Actually Have`,
          `The Case for Backing What Is Already Here`,
        ],
        `op-squad${input.seasonNumber}`,
        "headline"
      ),
      body: `A squad of ${input.squad.length} is not a small one, and the instinct to look outside it whenever a result goes wrong is a habit rather than a diagnosis. Clubs at this level are built from what is in the building, and the manager knows better than anybody which parts of it work. That is not an argument against signing anybody. It is an argument against panic.`,
      article: [
        pick(
          [
            `Every club in this division has a squad of roughly this size and roughly this standard, which is exactly why the differences come from coaching and patience rather than from the market. The market is where money is, and money is what most clubs at this level do not have.`,
            `It is worth remembering that the players being criticised are the same ones who were being praised a month ago, and that neither verdict was ever about them. Form is a property of a team, and teams take time.`,
          ],
          `op-squad-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [`Squad of ${input.squad.length}`, "Filed loyal: the fanzine's own line is behind the club"],
      playerNames: [],
      publishedOn: at,
      weight: 46,
      quote: null,
    });
  }

  // 25d. The supporters, who are the only people the paper is actually speaking for.
  if (recent.length >= 3) {
    items.push({
      id: `opinion-supporters-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "OPINION",
      tone: badRun ? "CONCERN" : "NEUTRAL",
      stance: "LOYAL",
      headline: pick(
        [
          `What the Supporters Are Actually Saying`,
          `Nobody Is Asking for Miracles at ${input.clubName}`,
          `A Word From the Stands`,
        ],
        `op-supporters${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: `The people paying for this are not asking for a league title, and they never were. They are asking for a run of ${formWords(recent)} to look like it is going somewhere. That is a smaller ask than it sounds, and it is the one the manager has to answer.`,
      article: [
        pick(
          [
            `Supporters forgive a great deal. They forgive losing to a better side, they forgive a bad signing, and they forgive a season that does not work out. What they do not forgive is a team that looks like it has stopped being able to change its own story.`,
            `The relationship between a club and the people who turn up is not sentimental, whatever the marketing says. It is a straightforward question of whether the thing being paid for is going anywhere, asked every week.`,
          ],
          `op-supporters-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [`Run ${formString(recent)}`, "Filed loyal: the fanzine speaks for the stands"],
      playerNames: [],
      publishedOn: at,
      weight: 44,
      quote: null,
    });
  }

  // 25e. The academy argument, which is the one column that is always available and always arguable.
  if (input.academy?.name) {
    items.push({
      id: `opinion-youth-${input.seasonNumber}`,
      kind: "OPINION",
      category: "OPINION",
      tone: "GOOD",
      stance: "LOYAL",
      headline: pick(
        [
          `The Answer May Already Be in the Building`,
          `${input.academy.name} and the Case for Patience`,
          `Where the Next One Comes From`,
        ],
        `op-youth${input.seasonNumber}`,
        "headline"
      ),
      body: `There is a player in this club's academy worth being patient about, and patience is the only thing that has ever produced one. The clubs that buy their way out of a problem are the clubs with the money to do it. ${input.clubName} are not one of those, and pretending otherwise has never once worked.`,
      article: [
        pick(
          [
            `A youth player is not a transfer policy and should not be sold as one, but the arithmetic is unavoidable: a club at this level gets maybe one of these a season and cannot afford to be careless with him.`,
            `The romanticism around academy football obscures something more useful, which is that it is cheap. A player who comes through costs a fraction of one who arrives, and the gap is what pays for everything else.`,
          ],
          `op-youth-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [`Academy prospect ${input.academy.name}`, "Filed loyal: an argument for the club's own method"],
      playerNames: [input.academy.name],
      publishedOn: at,
      weight: 42,
      quote: null,
    });
  }

  // 25f. The tactical question. Straight, because the desk has a fact and not a view.
  if (recent.length >= 3 && input.matches.some((match) => (match.weakness ?? "").trim().length > 0)) {
    items.push({
      id: `opinion-tactics-${input.seasonNumber}-${recent[0].eventId}`,
      kind: "OPINION",
      category: "TALKING POINT",
      tone: "NEUTRAL",
      stance: "STRAIGHT",
      headline: pick(
        [
          `The Question Nobody at ${input.clubName} Wants to Answer`,
          `One Problem, Named and Not Solved`,
          `What the Record Keeps Showing`,
        ],
        `op-tactics${input.seasonNumber}${recent[0].eventId}`,
        "headline"
      ),
      body: `The same problem has been written down more than once this season, which makes it a problem rather than an accident. Nobody is suggesting it is unfixable, and nobody at the club has suggested it is fixed. The gap between those two positions is where the rest of the season lives.`,
      article: [
        pick(
          [
            `A recurring problem in football is usually a problem of the system rather than of the players, because players change and systems do not. That is not a criticism of anybody in particular and it is where the work is.`,
            `The interesting thing about a repeat is that it is evidence. A one-off is noise; the second one is a pattern, and the third is a manager's job.`,
          ],
          `op-tactics-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: ["The manager's own match notes name the same problem more than once", "Filed straight: a question rather than a verdict"],
      playerNames: [],
      publishedOn: at,
      weight: 74,
      quote: null,
    });
  }

  // 25g. The money column, which is where a hostile paper does its damage without inventing a word.
  if (finance && (finance.recordBuy !== null || finance.recordSale !== null || finance.wageTurnoverLevel !== "OK")) {
    items.push({
      id: `opinion-money-${input.seasonNumber}`,
      kind: "OPINION",
      category: "TALKING POINT",
      tone: "CONCERN",
      stance: "HOSTILE",
      headline: pick(
        [
          `The Money Has Always Been the Real Story at ${input.clubName}`,
          `Follow the Spending`,
          `${input.clubName} Are Paying for Decisions Already Made`,
        ],
        `op-money${input.seasonNumber}`,
        "headline"
      ),
      body: `The wage bill is understood to be ${moneyBand(finance.squadAnnualWage, finance.currency)} a year against a turnover this level of the game supports only up to a point. ${finance.recordBuy !== null ? `The largest fee paid on the record is ${moneyBand(finance.recordBuy, finance.currency)}. ` : ""}None of that is the manager's fault in the first year of a job and all of it is his problem in the third.`,
      article: [
        pick(
          [
            `A club's wage bill is the most honest thing about it, because it cannot be spun. It says what the club believes its players are worth, and it says it whether or not anybody agrees.`,
            `Every argument about a manager eventually becomes an argument about money, and every argument about money eventually becomes an argument about who agreed to it. That is where the pressure actually lives.`,
          ],
          `op-money-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [
        `Squad wage ${moneyBand(finance.squadAnnualWage, finance.currency)} a year (from the squad's own contract rows)`,
        `Assumed turnover ${moneyBand(finance.estimatedTierRevenue, finance.currency)} (DERIVED_ESTIMATE)`,
        "Filed hostile: the numbers are argued rather than reported",
      ],
      playerNames: [],
      publishedOn: at,
      weight: 70,
      quote: null,
    });
  }

  // 25h. The table, which is a fact and reads best said calmly.
  if (input.position?.value != null && input.leagueName) {
    items.push({
      id: `opinion-table-${input.seasonNumber}-${input.position.value}`,
      kind: "OPINION",
      category: "OPINION",
      tone: input.position.value <= 6 ? "GOOD" : input.position.value >= 18 ? "CONCERN" : "NEUTRAL",
      stance: "STRAIGHT",
      headline: pick(
        [
          `${ordinal(input.position.value)} Is Not a Disaster and Not an Achievement`,
          `What ${ordinal(input.position.value)} Actually Means`,
          `The Table, Read Properly`,
        ],
        `op-table${input.seasonNumber}${input.position.value}`,
        "headline"
      ),
      body: `${ordinal(input.position.value)} in the ${input.leagueName} is where this season has got to, and the table is the only verdict that accumulates rather than being announced. Positions in the middle of it are not comfortable or uncomfortable; they are unfinished, and there is a difference between a table that is unfinished and one that is decided.`,
      article: [
        pick(
          [
            `A league table is the least fashionable piece of analysis in football and the only one that has never been wrong about who finished where. Everything else is a forecast.`,
            `The honest reading of a mid-season table is that it tells you what has happened and nothing at all about what will. Clubs have climbed from worse and fallen from better, which is the entire reason anybody watches.`,
          ],
          `op-table-art${input.seasonNumber}`,
          "article"
        ),
      ],
      evidence: [`Position ${input.position.value}`, input.position.basis ? `Basis ${input.position.basis}` : "", "Filed straight: the table is reported rather than argued"].filter(Boolean),
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
 * What a story is about, for the sake of its closing paragraph.
 *
 * Ten subjects, and every story has one. This is the thing the first version of the closing paragraph was
 * missing entirely.
 */
/**
 * Which TOPICS a conclusion may close.
 *
 * The rule the sample in the bug report broke. A conclusion used to be offered on the strength of the DATA
 * existing - there was a position, there were contracts running out - rather than on it being about the same
 * thing as the story. Data presence is not topic compatibility, and a family that is not compatible is never
 * offered now, however much of the career supports it.
 *
 * `season` has no entry and serves every kind: it is the single generic line held back for a thin edition, and
 * it is never allowed to open a paragraph.
 */
const CONCLUSION_KINDS: Record<string, StoryKind[]> = {
  // Results, standing and the season's shape. Each already requires its own fact before it is built at all - a
  // position, a phase with a matchday count, a block of results - and none of them may close a story about
  // money, a contract, a squad or an injury.
  run: ["MATCH", "FORM", "TABLE"],
  block: ["MATCH", "FORM", "TABLE"],
  table: ["MATCH", "FORM", "TABLE"],
  phase: ["MATCH", "FORM", "TABLE"],
  // Selection: who is available, and who plays.
  injuries: ["MATCH", "PLAYER", "TEAMNEWS", "SQUAD"],
  // Depth, and the shape of the squad.
  squad: ["SQUAD", "TEAMNEWS", "CONTRACT"],
  // Money, which is the only topic the contracts family belongs to.
  contracts: ["FINANCE", "CONTRACT", "TRANSFER"],
  // A player's own movement, and the academy that produces them.
  development: ["PLAYER", "SQUAD"],
  academy: ["PLAYER", "SQUAD"],
  // Silverware, and the manager's own time in the post.
  trophy: ["TROPHY"],
  tenure: ["MILESTONE", "OPINION"],
};

/**
 * Which NARROWER thing a conclusion is about, among the conclusions that share a subject.
 *
 * The second filter, and the one that took two bad paragraphs to learn. A shared subject is not enough: two
 * conclusions can both be about a match and still have nothing to do with each other, which is how a piece
 * closed on the run of results and then on the treatment room, as though the second sentence followed from the
 * first. A group is tighter - results, the squad, availability, time - and where nothing shares the first
 * sentence's group the paragraph simply stops at one, which reads better than two that do not belong together.
 */
const CONCLUSION_GROUPS: Record<string, string> = {
  run: "results",
  block: "results",
  table: "results",
  squad: "squad",
  contracts: "squad",
  development: "squad",
  tenure: "squad",
  injuries: "availability",
  academy: "academy",
  trophy: "trophy",
  phase: "time",
  season: "time",
};

/**
 * The closing paragraph of an article.
 *
 * REBUILT, because the first version closed almost every story in the paper on the same two sentences. It
 * had five frames and two of them - "the season" and "what comes next" - were pushed into the pool
 * unconditionally, so they were always available, and the pair was reached by a hash of the story id alone,
 * which is how a piece about a contract came to end with a line about a week of football.
 *
 * A CONCLUSION NOW, not a frame. Every candidate carries the fact that entitles it to exist - a position on
 * the standings, a block of results, a player in the treatment room - so a career with no matches logged
 * closes on what its squad actually is rather than on an invented fixture list. Candidates are ranked by how
 * much of the story they are about, and the hash only breaks a tie between two that are equally relevant.
 * That is the difference between variety which follows from the facts and variety which merely looks like it.
 *
 * The edition remembers which conclusion each of its stories reached, so two neighbours cannot make the same
 * point twice unless there is genuinely nothing else to say. One generic line exists, for the last story in a
 * thin edition, and it is never allowed to open the paragraph.
 */
function outlookParagraph(
  input: NewsInput,
  draft: StoryDraft,
  memory: EditionMemory
): string {
  const recent = input.matches.slice(0, WINDOW);
  /**
   * The closing candidates, most relevant first.
   *
   * `about` is the person a clause names, when it names one. A clause that names a player may only close a
   * story that is already about that player, because otherwise the name is the only thing joining the two and
   * a reader who followed a report on one man gets a paragraph on another. `generic` marks the fallback line,
   * which may be the second thing the paragraph says and never the first.
   */
  const candidates: { key: string; score: number; options: string[]; generic?: boolean; about?: string }[] =
    [];

  /**
   * THE STORY'S OWN TOKENS, and the reason this function now takes the draft.
   *
   * A closing sentence has to be ABOUT the piece it closes, which means it has to touch something the piece
   * already carries: a name, a figure, the opponent, the position. Every pool below is written to include one,
   * and the checks fail the run when one does not - so a sentence cannot be pasted under an unrelated story
   * without it being obvious.
   *
   * The opponent and the competition come from the match the story is keyed on rather than from a new field on
   * the draft: every match story's id ends with its event id, so the facts are already reachable. Nothing here
   * is invented for a story that has none.
   */
  const club = input.clubName;
  const manager = input.managerName;
  const surname = manager.split(/\s+/).slice(-1)[0] ?? manager;
  const named = draft.playerNames;
  const lead = named[0] ?? null;
  const linked = input.matches.find((match) => draft.id.endsWith(match.eventId)) ?? null;
  const opponent = linked?.opponent ?? null;
  const matchday = input.progress?.matchday ?? null;

  // The run, only under a story that was about a match. A squad-depth note or an academy story has no week
  // to look back on, and saying so was how the first pass produced a closing paragraph about a match that
  // had not happened.
  if (recent.length >= 3) {
    // In WORDS, not as a form guide. See the note on `formWords`: "W W D" belongs in the evidence.
    const run = formWords(recent);
    const window = `${recent.length} ${plural(recent.length, "match", "matches")}`;
    candidates.push({
      key: "run",
      score: 80,
      options: [
        `The wider picture for ${club} is ${run} across the last ${window}, which is what turns one result into a story.`,
        `Taken with the ${window} before it, ${club} have produced ${run}, and it is the sequence rather than the single match that will be judged.`,
        `A record of ${run} in ${window} is the context ${club} are being judged in.`,
        `Over the last ${window} ${club} have produced ${run}, and that is the sequence the season will be read through.`,
        `${capitalise(club)} have taken ${run} from the last ${window}, and it is the shape of the month rather than of one match.`,
        `Set against ${club}'s last ${window}, ${run} is what the standing is actually being built from.`,
        `Nothing about ${club}'s last ${window} is changed by one result, and those ${window} are ${run}.`,
        `The ${window} before it make it ${run} for ${club}, and that is the part of this worth holding on to.`,
        // Only when the debrief named an opponent, so the sentence is bound to a side rather than to "the next
        // fixture". A run read against a named opponent is the version of this a paper would actually print.
        ...(opponent
          ? [`Set against ${opponent} next, ${club} go in on ${run} from the last ${window}.`]
          : []),
      ],
    });
  }

  // Only when the app is not flagging its own reading as disputed: a hedged position printed as fact in a
  // newspaper would be the one thing worse than not printing it at all.
  const position = input.position?.value ?? null;
  if (position !== null && !input.position?.disputed && input.leagueName) {
    const table = input.leagueName;
    // The position is always paired with the club or the competition. A bare "ninth" tells the reader nothing
    // about whose ninth it is.
    candidates.push({
      key: "table",
      score: 75,
      options: [
        `It leaves ${club} ${ordinal(position)} in the ${table} on the standings as they are.`,
        `On the current standings that is ${club} at ${ordinal(position)} in the ${table}.`,
        `${ordinal(position)} in the ${table} is where this leaves ${club}.`,
        `The table puts ${club} ${ordinal(position)} in the ${table}.`,
        `${club} are ${ordinal(position)} in the ${table} on the numbers as they stand.`,
        `Read against the rest of the ${table}, ${club} are ${ordinal(position)}.`,
      ],
    });
  }

  // The block of results: the only run of form the app has a points figure for, and the one thing on this
  // page that is arithmetic rather than opinion.
  if (input.block && input.block.gamesPlayed >= 3 && input.block.points !== null) {
    const games = input.block.gamesPlayed;
    const points = input.block.points;
    const perGame = (points / games).toFixed(1);
    candidates.push({
      key: "block",
      score: 70,
      options: [
        `${points} points from ${club}'s last ${games} ${plural(games, "match", "matches")} is the return the month is being built on.`,
        `${club} have taken ${points} points from ${games} ${plural(games, "match", "matches")}, which is the figure the next month has to improve on.`,
        `At ${points} points from ${games}, ${club} are running at ${perGame} a game.`,
        `Put next to the ${games} before it, ${club}'s ${points} points is a return that has to be read as a trend.`,
        `${games} ${plural(games, "match", "matches")} and ${points} points for ${club}, which is what ${surname} is working from.`,
        `${club} at ${perGame} points a game across ${games}: that is the rate the season is running at.`,
      ],
    });
  }

  // A player under treatment, which is a constraint on everything the club does next. Every sentence names
  // the player who is out and the position it costs, because that is the only thing that makes it about this
  // story rather than about injuries in general.
  const unavailable = (input.injuries ?? []).filter(
    (absence) => absence.until !== null && input.inGameDate !== null && absence.until > input.inGameDate
  );
  const absent = unavailable.find((absence) => lead !== null && sameName(absence.name, lead)) ?? unavailable[0] ?? null;
  if (absent) {
    const role = positionWords(absent.role);
    const group = positionGroupWords(absent.role);
    candidates.push({
      key: "injuries",
      score: 65,
      options: [
        `With ${absent.name} out, ${club} have one fewer ${role} to call on.`,
        `${absent.name}'s absence leaves ${club} short in the ${group}, and that is measured over the weeks ahead rather than in one match.`,
        `${club} lose ${absent.name}'s minutes, and the ${group} has to be covered from inside the squad.`,
        `Cover for ${absent.name} has to come from the players ${club} already have.`,
        `${absent.name} is one fewer ${role} for ${club} to pick from.`,
        `The ${group} is where ${club} feel the loss of ${absent.name} first.`,
      ],
    });
  }

  // A rating that moved, or a squad coming through. Every sentence names the player and the position group,
  // so the paragraph is about the man the story is about rather than about squad development in the abstract.
  const moved = lead !== null ? (input.squad.find((player) => sameName(player.name, lead))?.role ?? null) : null;
  if (lead !== null) {
    const role = positionWords(moved);
    const group = positionGroupWords(moved);
    candidates.push({
      key: "development",
      score: 58,
      about: lead,
      options: [
        `${lead} is a ${role} moving in the right direction, and that changes what ${club} have.`,
        `The movement at ${club} is in the ${group}, and ${lead} is the name on it.`,
        `${lead} is a ${role}, and improvement in the ${group} is what ${club} are getting.`,
        `For ${club}, the change is one ${role}: ${lead}.`,
        `${club} have a ${role} improving, and ${lead} is the one.`,
        `A squad moves one player at a time, and for ${club} that player is ${lead}.`,
      ],
    });
  }

  // What the squad is, which is the only structural fact available on a career with no matches logged. Bound
  // to the club and the manager, because "a squad of 24" on its own belongs to no story.
  if (input.squad.length > 0) {
    const size = input.squad.length;
    candidates.push({
      key: "squad",
      score: 50,
      options: [
        `${club}'s squad of ${size} is what ${surname} has to work with.`,
        `With ${size} players, ${club} have the room to change a side once.`,
        `${surname} has ${size} players at ${club}, and every judgement is drawn from that.`,
        `${club} are ${size} strong, which is the number everything else is worked out from.`,
        `At ${size} players, ${club} can change a side and not change it twice.`,
        `${size} players is the depth ${club} are working with this season.`,
      ],
    });
  }

  // Contracts running out. Names the soonest deal, its year, and how many others fall in the same year, which
  // is the only form of this that tells a reader anything about THIS club.
  const expiring = input.squad
    .filter(
      (player) =>
        player.contractValidUntil !== null &&
        input.inGameYear !== null &&
        player.contractValidUntil <= input.inGameYear + 1
    )
    .sort(
      (left, right) => (left.contractValidUntil ?? 0) - (right.contractValidUntil ?? 0)
    );
  if (expiring.length > 0) {
    const soonest = expiring[0];
    const year = soonest.contractValidUntil;
    if (year !== null) {
      const sameYear = expiring.filter((player) => player.contractValidUntil === year).length;
      const others = sameYear - 1;
      candidates.push({
        key: "contracts",
        score: 45,
        about: soonest.name,
        options: [
          `${soonest.name} is out of contract in ${year}${others > 0 ? `, and ${countWord(others)} ${plural(others, "other")} at ${club} expiring the same year` : ""}.`,
          `${club} have ${countWord(expiring.length)} ${plural(expiring.length, "deal")} expiring by ${year + 1}, ${soonest.name}'s the soonest.`,
          `${soonest.name} is out of contract in ${year}, the nearest of the deals ${club} have to settle.`,
          `${year} is when ${soonest.name}'s deal ends, and ${club} have ${countWord(expiring.length)} to sort by then.`,
          `The next decision at ${club} is ${soonest.name}, out of contract in ${year}.`,
          `${club} have to deal with ${soonest.name} first, in ${year}${others > 0 ? `, with ${countWord(others)} more the same year` : ""}.`,
        ],
      });
    }
  }

  // The trophy, named, with the season it was won. The generic cabinet lines are gone: a story about silverware
  // that does not say which silverware and when is talking about trophies rather than about this club.
  const latestTrophy = [...input.trophies].sort((left, right) => right.season - left.season)[0] ?? null;
  if (latestTrophy) {
    candidates.push({
      key: "trophy",
      score: 40,
      options: [
        `The ${latestTrophy.name} came in season ${latestTrophy.season}, and ${surname} has ${countWord(input.trophies.length)} on the record at ${club}.`,
        `${surname} won the ${latestTrophy.name} in season ${latestTrophy.season}, which is the standard ${club} are measured against.`,
        `Season ${latestTrophy.season} brought the ${latestTrophy.name} to ${club}, and nothing since has matched it.`,
        `The ${latestTrophy.name} of season ${latestTrophy.season} is the last thing ${club} won.`,
        `${club}'s most recent honour is the ${latestTrophy.name}, in season ${latestTrophy.season}.`,
        `${surname} has the ${latestTrophy.name} of season ${latestTrophy.season} on the record at ${club}.`,
      ],
    });
  }

  // The prospect, named, with the one fact the story already has about him. "There is a longer project underneath
  // the weekly one" belongs to no particular club and tells a reader nothing about this one.
  const prospect = input.academy;
  if (prospect?.name) {
    const age = prospect.age;
    const goals = prospect.goals;
    candidates.push({
      key: "academy",
      score: 38,
      about: prospect.name,
      options: [
        `${prospect.name} is ${age} and on the books at ${club}, which is where the value is here.`,
        `At ${age}, ${prospect.name} is the name ${club} are being patient about.`,
        `${club}'s next first-team candidate is ${prospect.name}, ${age}.`,
        `${prospect.name} is the academy name at ${club}, and the club know it.`,
        goals !== null && goals > 0
          ? `${prospect.name} has ${countWord(goals)} for the youth side, and ${club} are watching that closely.`
          : `${prospect.name} is ${age}, which is the age ${club} have to make a decision about.`,
        `${club} have ${prospect.name} at ${age}, and that is a longer game than this season.`,
      ],
    });
  }

  /**
   * How long this manager has been in post, straight off the save's own season ordinal.
   *
   * The one claim about the past the desk can make without a results archive: it does not need the scorelines
   * of previous seasons, only the fact that this is a second or a fifth. Named, never "he" or "his": the app
   * holds no gender for the manager, so a pronoun here would be an invention.
   */
  if (input.seasonNumber >= 1) {
    const season = input.seasonNumber;
    candidates.push({
      key: "tenure",
      score: 42,
      options: [
        `Season ${season} in charge at ${club} is a different thing to be judged on from a settled one.`,
        `Whatever the table says, season ${season} is the context these arguments sit inside at ${club}.`,
        `${surname} is in season ${season} at ${club}, and only the next month will say which way it is going.`,
        `${surname}'s ${ordinalWord(season)} season at ${club} is the window this is being judged in.`,
        `${club} are ${surname}'s project in season ${season}, which is the clock that matters.`,
      ],
    });
  }

  /**
   * Where the club is in its season.
   *
   * Only offered when the matchday count is known, and every sentence CARRIES that count, because "at the
   * business end" on its own is a phrase rather than a fact. Approximate by construction - see the note on
   * `seasonPhase` - which is why these are about time and never about a date.
   */
  const atPhase = phasePhrase(seasonPhase(input.progress ?? null));
  if (atPhase && matchday !== null) {
    candidates.push({
      key: "phase",
      score: 35,
      options: [
        `${club} are ${matchday} games into the season, which is ${atPhase}, and there is time for that to change.`,
        `${matchday} matches in, ${atPhase}, ${club} still have the room a season gives.`,
        `With ${matchday} games behind ${club}, this sits ${atPhase}.`,
        `${atPhase} of a season, and ${matchday} games into it, ${club} are not a settled side.`,
        `${matchday} games in and ${atPhase}, ${surname} has as much room as the calendar allows.`,
      ],
    });
  }

  /**
   * The one generic line, and it is bound all the same.
   *
   * Collapsed to a single sentence from six, because a pool of maxims is what produced the sample in the bug
   * report. It exists only so that a story with nothing else to say has somewhere to stop, it is never allowed
   * to open the paragraph, and a story with no bound line at all is a BRIEF instead - summary and no closing.
   */
  candidates.push({
    key: "season",
    score: 10,
    generic: true,
    options: [
      `Season ${input.seasonNumber} at ${club} is unfinished, and this is one of the things it is being made of.`,
    ],
  });

  /**
   * Ranked by a relevance score the edition's own history discounts.
   *
   * Two filters before anything is ranked, and the order matters. A conclusion is dropped unless it is about
   * the same SUBJECT as the story it would close, and only then is the rest ranked by relevance and by how
   * often this edition has already used it.
   *
   * The discount is the second half of the point. Ranking on relevance alone reaches for the most relevant
   * conclusion again and again until its phrasings are gone and it has to repeat itself - which is how two
   * different stories in one paper ended up sharing a closing sentence. Every use of a family costs it fifty
   * points, so the paper spreads its conclusions across everything it knows. The hash sits inside the value
   * rather than in a fallback, so two candidates that are equally relevant and equally fresh still resolve
   * the same way on every read.
   */
  const onTopic = candidates.filter((candidate) => {
    const allowed = CONCLUSION_KINDS[candidate.key];
    if (allowed !== undefined && !allowed.includes(draft.kind)) return false;
    // A story that already names a person closes on that person. This is the rule the reported bug broke: a
    // piece on one man was closed by a paragraph on a different one, and nothing in the sentence was wrong on
    // its own, which is why it survived every check that only asked whether the data existed. The test is
    // whether the story names anybody, not what its topic is, because a squad piece built on one player is as
    // much about him as a player piece is.
    if (candidate.about && named.length > 0 && !named.includes(candidate.about)) return false;
    return true;
  });
  // Every story reaches the generic line even when nothing else fits, so an empty pool cannot happen - but a
  // pool that is somehow empty falls back to the whole list rather than closing the piece on nothing.
  const pool = onTopic.length > 0 ? onTopic : candidates;

  const usedTimes = (key: string) => memory.families.get(key) ?? 0;
  const ranked = pool
    .map((candidate) => ({
      ...candidate,
      value:
        candidate.score -
        usedTimes(candidate.key) * 50 +
        (hash(`${draft.id}|frame|${candidate.key}`) % 1000) / 1000,
    }))
    .sort((left, right) => right.value - left.value);

  // A generic line may be the second thing the paragraph says. It is never the first.
  const first = ranked.find((candidate) => !candidate.generic) ?? ranked[0];
  const firstGroup = CONCLUSION_GROUPS[first.key] ?? first.key;
  /**
   * The second sentence, only if it is about the same thing as the first.
   *
   * Where nothing shares the first sentence's group, the paragraph stops at one sentence rather than padding
   * itself out with a line that has nothing to do with the one before it.
   */
  const second = ranked.find(
    (candidate) =>
      candidate.key !== first.key && (CONCLUSION_GROUPS[candidate.key] ?? candidate.key) === firstGroup
  );
  const picks = [first, second].filter(
    (candidate): candidate is (typeof ranked)[number] => Boolean(candidate)
  );

  return picks
    .map((candidate) => {
      // The FAMILY is remembered as well as the sentence, so two neighbours cannot make the same point in
      // two different ways - which is the version of repetition a reader notices least and minds most.
      memory.families.set(candidate.key, usedTimes(candidate.key) + 1);
      return pickFresh(candidate.options, draft.id, `outlook-${candidate.key}`, memory.sentences);
    })
    .join(" ")
    .trim();
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
  return items.map((item) => {
    const own = (item.article ?? []).map((paragraph) => paragraph.trim()).filter(Boolean);
    const summary = tidy(item.body);
    const article = [summary, ...own, outlookParagraph(input, item, memory)].filter(Boolean);
    const byline = BYLINED_CATEGORIES.has(item.category)
      ? bylineFor(item.id, input.countryId ?? null, input.clubName, "byline", item.stance ?? undefined)
      : null;
    return {
      ...item,
      id: item.id,
      kind: item.kind,
      body: summary,
      article,
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

/** The match figures, as a one-line note for the app's own record of why a story ran. */
function matchStatsNote(match: NewsMatch): string {
  const parts = [
    match.shots !== null ? `${match.shots} shots` : "",
    match.shotsInsideBox !== null ? `${match.shotsInsideBox} inside the box` : "",
    match.bigChances !== null ? `${match.bigChances} big ${plural(match.bigChances, "chance")}` : "",
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
