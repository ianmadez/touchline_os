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

import { bylineFor, type PressByline } from "./outlets";
import { describeTimeOut, injuryBand, type InjuryBand } from "../squad/injury";

/**
 * Which revision of the desk's VOICE wrote a story.
 *
 * Bump this whenever the copy itself is rewritten rather than added to. A story is printed once and kept -
 * that is what makes the paper a paper - but a manager should not be left reading wording that has been
 * fixed, so the archive reprints anything stamped with an older revision and leaves saved and dismissed
 * stories exactly as they were. The number is here, beside the copy it describes, because "the desk was
 * rewritten" is an editorial call that cannot be computed from the code.
 */
export const NEWS_COPY_VERSION = 4;

/** How a story's subject colours the card. Not a red/green light: a paper has good and bad news. */
export type NewsTone = "GOOD" | "NEUTRAL" | "CONCERN";

export interface NewsItem {
  /** Stable and derived from the evidence, so it is published once and never duplicates in the archive. */
  id: string;
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
  return words[code] ?? role;
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

// ---------------------------------------------------------------------------------------------
// The stories
// ---------------------------------------------------------------------------------------------

/**
 * Every story the facts support, ranked.
 *
 * Each branch is guarded by its own condition and returns at most one item, so a feed can never repeat
 * a kind of story twice in one edition however many matches are on the pile.
 */
export function buildNews(input: NewsInput): NewsItem[] {
  const items: StoryDraft[] = [];
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
            "He gave the press room a straight answer afterwards.",
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

  // ---- 1. The last match, reported straight -------------------------------------------------
  if (last) {
    const scorers = scorerTally(last.scorers);
    const headline = pick(
      last.result === "WIN"
        ? [
            `${input.clubName} ${scoreOf(last)} ${last.opponent ?? "the visitors"}`,
            `${input.clubName} Take the Points Against ${last.opponent ?? "the visitors"}`,
            `Won It ${scoreOf(last)}: ${input.clubName} See Off ${last.opponent ?? "the visitors"}`,
            `${last.opponent ?? "The visitors"} Beaten as ${input.clubName} Find a Way`,
          ]
        : last.result === "LOSS"
          ? [
              `${last.opponent ?? "The visitors"} ${scoreOf(last)} ${input.clubName}`,
              `Defeat for ${input.clubName} Against ${last.opponent ?? "the visitors"}`,
              `${input.clubName} Beaten ${scoreOf(last)}`,
              `A Bad Afternoon: ${input.clubName} Lose to ${last.opponent ?? "the visitors"}`,
            ]
          : [
              `Honours Shared: ${input.clubName} ${scoreOf(last)} ${last.opponent ?? "the visitors"}`,
              `${input.clubName} Held to ${scoreOf(last)}`,
              `All Square Against ${last.opponent ?? "the visitors"}`,
              `Nothing Between Them: ${scoreOf(last)}`,
            ],
      last.eventId,
      "headline"
    );

    const said = aftermath(last, last.eventId);
    // Unrecorded goals are said plainly rather than filled in with the wrong thing: a debrief with no
    // contributions logged is common, and "found no way through" after a four-goal win contradicts the
    // scoreline in the same sentence.
    const scorerLine =
      scorers.length > 0
        ? `${namesList(scorers.map((entry) => entry.name))} ${scorers.length === 1 ? "got" : "shared"} the goals.`
        : last.goalsFor > 0
          ? `${input.clubName} scored ${last.goalsFor}, with no scorer logged in the debrief.`
          : `${input.clubName} found no way through.`;
    const standoutLine =
      last.standouts.length > 0
        ? `${namesList(last.standouts)} drew the eye${last.standouts.length > 1 ? " above all" : ""}.`
        : "";
    const concedingLine =
      last.goalsAgainst > 0 ? `${last.opponent ?? "The opposition"} scored ${last.goalsAgainst}.` : "";

    // Joined rather than concatenated: two of these lines end in a full stop and one begins mid-sentence,
    // and a missing space between them is the sort of thing that only shows up in a published paper.
    const bodyFrames = [
      [scorerLine, concedingLine, standoutLine],
      [scorerLine, standoutLine, concedingLine],
    ];
    const body = [...bodyFrames[hash(`${last.eventId}|body`) % bodyFrames.length].map((part) => part.trim()).filter(Boolean), said.line]
      .filter(Boolean)
      .join(" ");

    items.push({
      id: `result-${last.eventId}`,
      category: last.result === "LOSS" ? "MATCH REPORT" : "TOP STORY",
      tone: last.result === "WIN" ? "GOOD" : last.result === "LOSS" ? "CONCERN" : "NEUTRAL",
      headline,
      body,
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
    if (last.goalsAgainst === 0) {
      const shutouts = recent.filter((match) => match.goalsAgainst === 0).length;
      const singled = last.standouts.filter((name) => {
        const group = roleGroup(roleOf(name));
        return group === "GK" || group === "DEF";
      });
      const keeperSingled = singled.filter((name) => roleGroup(roleOf(name)) === "GK");
      const defendersSingled = singled.filter((name) => roleGroup(roleOf(name)) === "DEF");
      const backLine = input.squad
        .filter((player) => roleGroup(player.role) === "DEF")
        .map((player) => player.name);
      const against = last.opponent ?? "the visitors";
      const runNote = `${shutouts} clean ${plural(shutouts, "sheet")} in the last ${recent.length} ${plural(recent.length, "match", "matches")}`;

      const credit =
        keeperSingled.length > 0 && defendersSingled.length > 0
          ? {
              who: [...keeperSingled, ...defendersSingled],
              headline: [
                `${namesList([...keeperSingled, ...defendersSingled])} Share the Clean Sheet`,
                `Keeper and Back Line Both Earn It Against ${against}`,
                `A Shutout Built from the Back: ${against} Kept Out`,
              ],
              body: `${namesList(keeperSingled)} had little that was routine and plenty that was not, and ${namesList(defendersSingled)} in front of him were the reason why. That is ${runNote}.`,
            }
          : keeperSingled.length > 0
            ? {
                who: keeperSingled,
                headline: [
                  `${namesList(keeperSingled)} Keeps ${against} Out`,
                  `Another Blank Sheet: ${namesList(keeperSingled)} Unbeaten in ${shutouts} of ${recent.length}`,
                  `${namesList(keeperSingled)} Posts the Shutout Against ${against}`,
                ],
                body: `Nothing got past ${namesList(keeperSingled)}, which is ${runNote}. The back four will take their share of it too, whether or not anybody writes it down.`,
              }
            : defendersSingled.length > 0
              ? {
                  who: defendersSingled,
                  headline: [
                    `${namesList(defendersSingled)} Built the Clean Sheet`,
                    `The Back Line Holds: ${against} Kept Out`,
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
    // Only when there are figures to argue from: two rounded expected-goal weights do not justify a
    // verdict on their own, and a story that says nothing is not worth printing.
    if (last.shots !== null && last.shotsInsideBox !== null && last.bigChances !== null) {
      const expected = last.shotsInsideBox * 0.15 + last.bigChances * 0.38;
      const edge = last.goalsFor - expected;
      if (Math.abs(edge) >= 1) {
        const clinical = edge > 0;
        items.push({
          id: `finishing-${last.eventId}`,
          category: "ANALYSIS",
          tone: clinical ? "GOOD" : "CONCERN",
          headline: pick(
            clinical
              ? [
                  `${input.clubName} Make Their Chances Count`,
                  `Clinical: ${last.goalsFor} Goals from ${last.shots} Shots`,
                  `The Shooting Figures Behind the ${scoreOf(last)} Win`,
                  `Ruthless ${input.clubName} Do Not Waste a Chance`,
                ]
              : [
                  `${input.clubName} Waste the Openings`,
                  `${last.shots} Shots, ${last.goalsFor} ${plural(last.goalsFor, "Goal")}`,
                  `A Question of Finishing After ${scoreOf(last)}`,
                  `All Those Chances and Nothing to Show`,
                ],
            last.eventId,
            "headline"
          ),
          body: pick(
            clinical
              ? [
                  `${last.shots} shots produced ${last.goalsFor} goals, and the shot count alone does not explain that. ${input.clubName} took the chances that mattered and let the rest go.`,
                  `It was not a barrage. It was ${last.shots} shots and ${last.goalsFor} goals, and that is the ratio every manager says they want.`,
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
            `${last.shotsInsideBox} from inside the box`,
            `${last.bigChances} big ${plural(last.bigChances ?? 0, "chance")}`,
            `The app's model made that worth ${expected.toFixed(1)} goals, so you finished ${clinical ? "ahead of" : "behind"} it by ${Math.abs(edge).toFixed(1)}`,
          ],
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
    const wins = recent.filter((match) => match.result === "WIN").length;
    const losses = recent.filter((match) => match.result === "LOSS").length;
    const unbeaten = recent.findIndex((match) => match.result === "LOSS");
    const winless = recent.findIndex((match) => match.result === "WIN");
    const run = unbeaten === -1 ? recent.length : unbeaten;

    if (run >= 3) {
      items.push({
        id: `form-unbeaten-${recent[0].eventId}`,
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
        body: `${source(recent[0].eventId)} say the last ${run} ${plural(run, "match", "matches")} have brought ${wins} ${plural(wins, "win")} and no defeat: ${formString(recent.slice(0, run))}. ${input.managerName} has a side nobody is enjoying playing against.`,
        evidence: [`Run ${formString(recent.slice(0, run))}`, `${wins} ${plural(wins, "win")}`],
        playerNames: [],
        publishedOn: recent[0].matchDate,
        weight: 88,
        quote: null,
      });
    } else if (winless === -1 && losses >= 3) {
      items.push({
        id: `form-winless-${recent[0].eventId}`,
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
        body: `${formString(recent)} is the record of the last ${recent.length} ${plural(recent.length, "match", "matches")}: ${losses} ${plural(losses, "defeat")} and no win. The questions will not go away until that changes.`,
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
        body: `${home.length} home ${plural(home.length, "match", "matches")} and no defeat: ${formString(home)}. On their own ground ${input.clubName} have become awkward opponents.`,
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
        body: `${formString(away)} across the last ${away.length} away ${plural(away.length, "match", "matches")}. Whatever is working at home is not surviving the journey.`,
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

  // ---- 9. The weakness the manager keeps naming ---------------------------------------------
  if (recent.length >= 2) {
    const counts = new Map<string, number>();
    for (const match of recent) {
      if (!match.weakness) continue;
      const key = match.weakness.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const recurring = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    const conceded = sum(recent.map((match) => match.goalsAgainst));
    if (recurring && recurring[1] >= 2 && conceded > 0) {
      items.push({
        id: `weakness-${recurring[0]}-${recent[0].eventId}`,
        category: "THE VERDICT",
        tone: "CONCERN",
        headline: pick(
          [
            `The Same Question: "${recurring[0]}"`,
            `A Pattern ${recurring[1]} Matches Long`,
            `"${recurring[0]}" Comes Up Again`,
            `Twice Over, the Same Words`,
          ],
          `${recurring[0]}${recent[0].eventId}`,
          "headline"
        ),
        body: `For the ${recurring[1] === 2 ? "second" : "third"} time in ${recent.length} ${plural(recent.length, "match", "matches")} the note is the same: ${recurring[0]}. ${conceded} conceded in that run says the concern is not going away on its own.`,
        evidence: [
          `Named ${recurring[1]} times in ${recent.length} matches`,
          `${conceded} conceded in the run`,
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
  const heavy = input.matches.find(
    (match) => Math.abs(match.goalsFor - match.goalsAgainst) >= 3
  );
  if (heavy && recent.includes(heavy)) {
    const won = heavy.goalsFor > heavy.goalsAgainst;
    items.push({
      id: `margin-${heavy.eventId}`,
      category: won ? "TOP STORY" : "THE VERDICT",
      tone: won ? "GOOD" : "CONCERN",
      headline: won
        ? pick(
            [
              `Rout: ${input.clubName} ${scoreOf(heavy)} ${heavy.opponent ?? "the visitors"}`,
              `No Contest: ${scoreOf(heavy)} Against ${heavy.opponent ?? "the visitors"}`,
              `A Statement: ${input.clubName} ${scoreOf(heavy)}`,
            ],
            heavy.eventId,
            "headline-margin"
          )
        : pick(
            [
              `Heavy Defeat: ${scoreOf(heavy)} at ${heavy.opponent ?? "the visitors"}`,
              `${input.clubName} Beaten Heavily at ${heavy.opponent ?? "the visitors"}`,
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
    const seed = `depth${thinnest[0]}`;
    items.push({
      id: `depth-${thinnest[0]}`,
      category: "SQUAD WATCH",
      tone: "CONCERN",
      headline: pick(
        [
          `${only.name} Has No Cover`,
          `Only One Senior ${capitalise(words)} at ${input.clubName}`,
          `The Position ${input.clubName} Cannot Afford to Lose`,
          `Nobody Behind ${only.name}`,
          `${capitalise(words)} Down to One`,
        ],
        seed,
        "headline"
      ),
      body: pick(
        [
          `There is exactly one senior ${words} at the club, and it is ${only.name}. One injury and the shape has to change, which is the kind of problem a transfer window exists for.`,
          `${only.name} is the only senior ${words} ${input.managerName} has. Everybody in football knows what happens to a squad that thin in one place: it happens in the week you least want it to.`,
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
  const latestSeason = completed[completed.length - 1] ?? null;
  if (input.position?.value !== null && input.position?.value !== undefined) {
    const position = input.position.value;
    const disputed = input.position.disputed;
    items.push({
      id: `position-${position}-${input.seasonNumber}`,
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
      body: `The final table had ${input.clubName} ${ordinal(position)}${input.leagueName ? ` in the ${input.leagueName}` : ""}. ${disputed ? "The logged position and the save's own record disagree, so treat it with care." : "That is where the season finished, on the save's own record."}${latestSeason && latestSeason.tablePosition !== null ? ` The season before, ${ordinal(latestSeason.tablePosition)}.` : ""}`,
      evidence: [
        `Position ${position}`,
        input.position.basis ? `Basis ${input.position.basis}` : "",
        latestSeason?.tablePosition ? `Season ${latestSeason.season} ${ordinal(latestSeason.tablePosition)}` : "",
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
    items.push({
      id: `block-${input.seasonNumber}-${input.block.gamesPlayed}`,
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
              `${best.name} has moved up a level, and it has happened quicker than anyone at the club expected. He is a ${positionWords(where)}, and that is a position where a jump like this is worth the most.`,
              `This is the jump the coaching staff have been waiting for, and ${best.name} has made it early. A ${positionWords(where)} who improves this much this quickly stops being a project.`,
              `Nobody was surprised to see ${best.name} improve. They were surprised by how much, and how soon. At ${positionWords(where)} that changes what the rest of his season is about.`,
            ]
          : [
              `${source(seed, "progress-source")} say ${best.name} has kicked on again. One small step is not news on its own; the direction is, and this is a player going the right way.`,
              `${best.name} is better than he was a few weeks ago, and the club have noticed. He is a ${positionWords(where)}, and improvement in ${positionGroupWords(where)} tends to show up on a Saturday.`,
              `A quiet improvement from ${best.name}, and the kind that matters more than it reads: the people who work with him every day say the level has gone up. A ${positionWords(where)} who is still getting better is a useful thing to have.`,
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
                `He is not a young player being talked up. He is a ${positionWords(where)} who has got better, which at this point in a career is the hardest kind of progress to make.`,
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
          `${source(seed, "regress-source")} have seen ${worst.name} go the other way. Nobody is calling it a crisis, and it is still early, but a ${positionWords(where)} who was moving forward has started moving back.`,
          `${worst.name} has not been at his best lately, and that is a sentence the coaching staff did not expect to be saying about a ${positionWords(where)} in his ${age !== null ? `${age}s` : "career"}. It is a small drop. It is also a drop.`,
          `There is a dip in ${worst.name}, and it has been noticed inside the club rather than by the crowd. For a ${positionWords(where)}, that is worth saying out loud, because it is easier to arrest in March than in May.`,
          `${worst.name}'s form has slipped, and ${age !== null ? `at ${age} ` : ""}nobody expected this stretch of his career to plateau. The club are watching it rather than announcing it, which is usually the honest answer.`,
        ],
        seed,
        "body"
      ),
      article: [
        pick(
          [
            `Worth being precise about what this is: a stretch of indifferent form, not a broken player. ${worst.name} is a ${positionWords(where)}${age !== null ? ` of ${age}` : ""}, and the club's own belief in him has not changed on the back of a few weeks.`,
            `It is a dip rather than a decline, and there is a difference. Form moves for reasons a training ground cannot always name: a knock not worth reporting, a change of shape, a run of games against better players.`,
            `None of this is new to a player who has been through it before, and none of it is unusual in a season this long. What matters is which way the next month goes.`,
          ],
          seed,
          "article-perspective"
        ),
        pick(
          [
            `The awkward part is that a ${positionWords(where)} cannot play his way through it quietly. Every misplaced pass is in front of people, and every week the question gets asked a little louder.`,
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
      items.push({
        id: `defence-${recent[0].eventId}`,
        category: "THE VERDICT",
        tone: "GOOD",
        headline: pick(
          [
            `${shutouts} Clean Sheets in ${recent.length} is a Defence`,
            `The Meanest Back Line Around`,
            `${conceded} Conceded in ${recent.length} ${plural(recent.length, "Match", "Matches")}`,
          ],
          `defence${recent[0].eventId}`,
          "headline"
        ),
        body: `${shutouts} clean ${plural(shutouts, "sheet")} in the last ${recent.length}, and ${conceded} ${plural(conceded, "goal")} let in across them. ${keeper.name} is the last line of it, but the record belongs to the team.`,
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
    const regular = `He has been a regular part of this ${input.clubName} side, which is what makes it a team selection problem rather than a line on a medical sheet.`;

    const byBand: Record<InjuryBand, { headline: string[]; body: string[]; article: string[]; weight: number }> = {
      KNOCK: {
        headline: [
          `${absence.name} Picks Up a Knock`,
          `Knock Sidelines ${absence.name}`,
          `${absence.name} Out With a Knock`,
          `A Knock, and ${input.clubName} Reshuffle`,
          `${absence.name} a Doubt After a Knock`,
        ],
        body: [
          `${absence.name} has picked up a knock and is out for ${timeOut}. Short absences are the ones that get managed badly, because the fixture list never asks whether the squad can spare him.`,
          `A knock keeps ${absence.name} out for ${timeOut}. It is the smallest version of this kind of news, and at ${input.clubName} it still means a change to the team sheet.`,
          `${absence.name} is out for ${timeOut} with a knock. Nothing about it is serious, which is exactly why the temptation to rush him will be there in ten days.`,
        ],
        article: [
          pick(
            [
              `The ${words} position is where this bites. A knock that costs ${timeOut} sounds like nothing until the replacement has to play two games in six days, and then it stops sounding like nothing.`,
              `Cover for ${timeOut} is the question. The squad either has somebody who can do the job for a fortnight or it does not, and the answer is usually the second one.`,
            ],
            seed,
            "article-cover"
          ),
          regular,
        ],
        weight: 62,
      },
      WEEKS: {
        headline: [
          `${absence.name} Faces a Few Weeks Out`,
          `Weeks Out for ${absence.name}`,
          `${input.clubName} Lose ${absence.name} for Weeks`,
          `A Spell on the Sidelines for ${absence.name}`,
          `${absence.name} Set to Miss Weeks`,
        ],
        body: [
          `${absence.name} is out for ${timeOut}, and that is long enough to stop being a selection problem and start being a run of games without him. ${input.clubName} now have to decide what the team looks like without their ${words}.`,
          `${absence.name} will miss ${timeOut} of football. A few weeks is the awkward length: long enough that the side has to change, short enough that nobody signs anyone about it.`,
          `Out for ${timeOut}, and ${absence.name} leaves a hole in the ${words} position that the squad has to fill from inside, because no window is open to solve it any other way.`,
        ],
        article: [
          pick(
            [
              `The replacement is the story now. Whoever comes in gets a run of games rather than one afternoon, and a run of games is how a squad player becomes a first choice or stops being one.`,
              `It also lands on the manager's desk as a shape question rather than a person question. A few weeks is enough to try the alternative, and often enough to find out he did not have one.`,
            ],
            seed,
            "article-replacement"
          ),
          regular,
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
        body: [
          `${absence.name} is out for ${timeOut}, which is the length nobody plans for properly. Too short to buy a replacement, too long to cover with a favour.`,
          `About a month without ${absence.name}. Long enough that the position has to be shared, short enough that the club will try to get through it rather than solve it.`,
          `${absence.name} misses ${timeOut}, and ${input.clubName} have to work out who holds the ${words} position until he is back.`,
        ],
        article: [
          pick(
            [
              `A month is where a squad's depth stops being theoretical. The first two games are easy to cover; the third is when a manager finds out what he actually has behind his first choice.`,
              `The alternative is asked to hold the position rather than win it, and that distinction matters. A month is enough to change how the side plays and not enough to change what it is for.`,
            ],
            seed,
            "article-month"
          ),
          regular,
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
        body: [
          `${absence.name} is facing ${timeOut} out. That is the kind of absence a season gets judged by, and ${input.clubName} have to plan the months ahead without a player they had been counting on.`,
          `${timeOut} is the sentence for ${absence.name}. Clubs talk about replacing injuries; what they usually do is ask somebody else to be better than he has ever had to be.`,
          `${absence.name} will be out for ${timeOut}, which is long enough that the squad has to be re-planned rather than patched. Nobody covers a hole this size with one decision.`,
        ],
        article: [
          pick(
            [
              `A squad absorbs this in one of two ways: a younger player is handed the job early, or the shape is bent around the players who are left. Neither is free, and the manager has to pick one before the next match picks it for him.`,
              `The football question is who takes the minutes, and the harder question is the standard. Months of cover is not months of the same player, and pretending otherwise is how a good season goes quietly wrong.`,
            ],
            seed,
            "article-absorb"
          ),
          regular,
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 88,
      },
      SEASON: {
        headline: [
          `Season Over for ${absence.name}`,
          `${absence.name} Out for the Season`,
          `${input.clubName} Lose ${absence.name} for the Run-In`,
          `${absence.name}'s Season Ends Here`,
          `A Season-Ending Blow for ${absence.name}`,
        ],
        body: [
          `${absence.name} will not play again this season. It is the news every club dreads in the same way, and ${input.clubName} now have to decide what the rest of the campaign looks like without him.`,
          `That is ${absence.name} done for the season. There is no fixture he comes back for, no careful reintroduction, and no version of the next few months that includes him.`,
          `The season is over for ${absence.name}, and ${input.clubName} lose him for all of it. There is no fixture he comes back for and no careful reintroduction, only a squad that has to be re-planned without him.`,
        ],
        article: [
          pick(
            [
              `The planning starts immediately and it is not a short conversation. A season-long absence is the difference between strengthening in one position and rebuilding around the gap, and the club's own judgement of the squad is now part of the story.`,
              `What a manager wants is a replacement. What he usually has is a squad, a training ground and a decision about who is allowed to be a first team player before he was meant to be one.`,
            ],
            seed,
            "article-planning"
          ),
          regular,
          noteParagraph,
        ].filter((paragraph): paragraph is string => Boolean(paragraph)),
        weight: 96,
      },
    };

    const copy = byBand[band];
    items.push({
      id: `injury-${foldName(absence.name)}-${band}`,
      category: "TEAM NEWS",
      tone: "CONCERN",
      headline: pick(copy.headline, seed, "headline"),
      body: pick(copy.body, seed, "body"),
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
          `${absence.name} is available again. Nobody gets a spell out of the side back in one afternoon, but he is at least an option the manager can pick.`,
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

  return finalise(rank(items), input);
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
type StoryDraft = Omit<NewsItem, "article" | "byline"> & { article?: string[] };

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
]);

/**
 * The closing paragraph of an article.
 *
 * Built only from facts that are true of THIS career, and only from ones the paper could actually have: a
 * position on the current standings, the run of results, how much of the season is behind the club. A frame
 * whose fact is missing is not used at all, so a career with no matches logged gets a closing line about what
 * the squad is instead of an invented fixture list. Two frames are chosen from the item's id, so no two
 * stories in one edition close the same way.
 */
function outlookParagraph(input: NewsInput, seed: string, kind: StoryKind, index: number): string {
  const recent = input.matches.slice(0, WINDOW);
  const frames: { key: string; text: string }[] = [];

  // The run only belongs in a closing line when the story was about a match. A squad-depth note or an
  // academy story has no "week" to look back on, and saying so was how the first pass produced a closing
  // paragraph about a match that had not happened.
  if (kind === "MATCH" && recent.length >= 3) {
    const run = formString(recent);
    frames.push({
      key: "run",
      text: pick(
        [
          `The wider picture is ${run} across the last ${recent.length} ${plural(recent.length, "match", "matches")}, which is what turns one result into a story.`,
          `Taken with the ${recent.length} matches before it, that run reads ${run}, and it is that sequence rather than the single afternoon that will be judged.`,
          `The run behind it is ${run} in ${recent.length} ${plural(recent.length, "match", "matches")}, and a run is what a season is actually made of.`,
        ],
        seed,
        "outlook-run"
      ),
    });
  }

  // Only when the app is not flagging its own reading as disputed: a hedged position printed as fact in a
  // newspaper would be the one thing worse than not printing it at all.
  const position = input.position?.value ?? null;
  if (position !== null && !input.position?.disputed && input.leagueName) {
    frames.push({
      key: "table",
      text: pick(
        [
          `It leaves ${input.clubName} ${ordinal(position)} in the ${input.leagueName} on the standings as they are.`,
          `On the current standings that is ${ordinal(position)} in the ${input.leagueName}, with everything still to play for.`,
        ],
        seed,
        "outlook-table"
      ),
    });
  }

  frames.push({
    key: "season",
    text: pick(
      kind === "MATCH"
        ? [
            `There is a long way to go this season, which is the comforting half of a story like this and the worrying half of the other kind.`,
            `A single week will not decide anything, and weeks like it are how seasons are decided anyway.`,
          ]
        : [
            `It is the sort of thing that matters more as the season goes on than it does on the day it is noticed.`,
            `None of that decides a season on its own. What it does is give the manager one more thing he knows about his own squad.`,
          ],
      seed,
      "outlook-season"
    ),
  });

  if (input.squad.length > 0) {
    frames.push({
      key: "squad",
      text: pick(
        kind === "MATCH"
          ? [
              `With a squad of ${input.squad.length}, ${input.managerName} has as much room to change it as he has reason to.`,
              `It is a squad of ${input.squad.length}, and the manager will know better than anybody which of them this week said something about themselves.`,
            ]
          : [
              `A squad of ${input.squad.length} is what ${input.managerName} has to work with, and every judgement about it is drawn from that.`,
              `With ${input.squad.length} players on the books, the manager's room to move is what it is, and he knows it better than anybody.`,
            ],
        seed,
        "outlook-squad"
      ),
    });
  }

  // Two frames, ROTATED by the story's position in the edition. The fastest way for a paper to read as
  // machine-written is for three pieces to end on the same sentence, and a rotation is stronger than a
  // used-set: with two or three frames available and a set, the pool empties and the same pair comes back.
  const first = frames[index % frames.length];
  const second = frames.length > 1 ? frames[(index + 1) % frames.length] : null;
  return second ? `${first.text} ${second.text}` : first.text;
}

/**
 * What a story is about, for the sake of the closing paragraph.
 *
 * MATCH stories happened on a pitch and can be put next to the run of results. STANDING stories are about
 * the table, the squad, a contract or a single player's form, and a closing line about "a single week" reads
 * as nonsense under them. It is a property of the story type, which is why it is decided from the id the desk
 * already generates rather than passed in at every push.
 */
type StoryKind = "MATCH" | "STANDING";

function kindOf(id: string): StoryKind {
  return /^(result|clean-sheet|finishing|timing|form-|home-form|away-form|weakness|block|scorer|assists|standout)-/.test(
    id
  )
    ? "MATCH"
    : "STANDING";
}

/**
 * The last pass: every story gets its article and its byline.
 *
 * Done here rather than at each story because both are properties of the EDITION rather than of a single
 * item: the closing line needs the career's own shape, and the byline needs the country the paper is filed
 * in. Keeping it in one place is also what stops two stories in one edition closing the same way.
 */
function finalise(items: StoryDraft[], input: NewsInput): NewsItem[] {
  // Rotation is per KIND, not per edition: a paper can lead with three match stories and three squad
  // stories, and an overall index would make the second group of three close exactly like the first.
  let matchIndex = 0;
  let standingIndex = 0;
  return items.map((item) => {
    const kind = kindOf(item.id);
    const index = kind === "MATCH" ? matchIndex++ : standingIndex++;
    const own = (item.article ?? []).map((paragraph) => paragraph.trim()).filter(Boolean);
    const summary = item.body.trim();
    const article = [summary, ...own, outlookParagraph(input, item.id, kind, index)].filter(Boolean);
    return {
      ...item,
      body: summary,
      article,
      byline: BYLINED_CATEGORIES.has(item.category)
        ? bylineFor(item.id, input.countryId ?? null, input.clubName)
        : null,
    };
  });
}

/** The match figures, as a one-line note for the app's own record of why a story ran. */
function matchStatsNote(match: NewsMatch): string {
  if (match.shots === null) return "";
  return `${match.shots} shots${match.shotsInsideBox !== null ? `, ${match.shotsInsideBox} inside the box` : ""}${match.bigChances !== null ? `, ${match.bigChances} big ${plural(match.bigChances, "chance")}` : ""}`;
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
  T extends { weight: number; id: string; category: string; tone: NewsTone; playerNames: string[] },
>(items: T[]): T[] {
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

  const balanced = balanceCoverage(capped);

  const out: T[] = [];
  const taken = new Set<T>();
  // Interleave by category: repeatedly take the highest-ranked story whose category has not just run.
  let lastCategory: string | null = null;
  while (out.length < balanced.length) {
    const next =
      balanced.find((item) => !taken.has(item) && item.category !== lastCategory) ??
      balanced.find((item) => !taken.has(item));
    if (!next) break;
    out.push(next);
    taken.add(next);
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
