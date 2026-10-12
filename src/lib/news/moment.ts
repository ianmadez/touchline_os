/**
 * Where the desk is in the calendar, as facts rather than as guesses.
 *
 * THE RULE THIS EXISTS FOR. A newspaper knows what day it is. The first version of this desk did not ask,
 * and printed "March", "November", "a Saturday", "the winter" and "the run-in" out of nowhere. Every one
 * of those was a guess, and a guess about the calendar is the worst kind this feature can make: a save
 * that runs on a different calendar, or a league that plays through the summer, turns each of them into a
 * sentence that is simply wrong, in a story the reader has no way to check.
 *
 * So every day, month and phase word in the paper now comes from a date the save actually supplied, and
 * where the save supplied nothing the sentence is dropped rather than filled in.
 *
 * THERE IS NO CLOCK IN HERE. `Date.parse` on a date string the save gave us is arithmetic on a supplied
 * fact, not a read of the current time, so the desk stays reproducible: the same edition is written for the
 * same input, which is what lets the checks assert on exact output.
 */

/** A date the save supplied, said the way a paper says it. */
export interface Moment {
  /** The day, spelled: "Saturday". */
  weekday: string;
  /** The month, spelled: "November". */
  month: string;
  /** The day of the month, for "the 8th". */
  dayOfMonth: number;
  /** A Saturday or a Sunday. */
  isWeekend: boolean;
  /** A Tuesday, Wednesday or Thursday, which is when a midweek round is played. */
  isMidweek: boolean;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A save date read as a moment, or null when there is no usable date.
 *
 * Only the date part is used. The save writes an ISO date or a date and time interchangeably, and a story
 * never needs the hour, so anything after the day is ignored rather than parsed and then thrown away.
 */
export function momentOf(iso: string | null | undefined): Moment | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const weekdayIndex = date.getUTCDay();
  const monthIndex = date.getUTCMonth();
  if (!WEEKDAYS[weekdayIndex] || !MONTHS[monthIndex]) return null;
  return {
    weekday: WEEKDAYS[weekdayIndex],
    month: MONTHS[monthIndex],
    dayOfMonth: date.getUTCDate(),
    isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
    isMidweek: weekdayIndex >= 2 && weekdayIndex <= 4,
  };
}

/** "on a Saturday", or null when the date is unknown, in which case the sentence is dropped. */
export function dayPhrase(moment: Moment | null): string | null {
  return moment ? `on a ${moment.weekday}` : null;
}

/** "in November", or null. For a story about a month rather than about a day. */
export function monthPhrase(moment: Moment | null): string | null {
  return moment ? `in ${moment.month}` : null;
}

/**
 * How much of a season is behind the club.
 *
 * APPROXIMATE BY CONSTRUCTION, and the doc says so because the copy built on it has to hedge. The count it
 * is worked out from is the ordinal of the club's matches in ALL competitions, because that is the only
 * match count the app keeps - the save does not say how many league games have been played separately. So
 * a club deep in two cup runs reads as further into its season than it is. That is why a phase word is
 * only ever used where "somewhere around here in the season" is a fair thing for a paper to say, and never
 * where a number is being claimed.
 */
export type SeasonPhase =
  | "OPENING"
  | "EARLY"
  | "MIDDLE"
  | "BUSINESS_END"
  | "FINAL_STRETCH";

export interface SeasonProgress {
  /** The ordinal of the club's next match, all competitions, as the save's own record counts it. */
  matchday: number;
  /** How many league matches a full season of this division is: 2 x (size - 1). */
  expectedGames: number;
}

export function seasonPhase(progress: SeasonProgress | null | undefined): SeasonPhase | null {
  if (!progress) return null;
  const { matchday, expectedGames } = progress;
  if (!Number.isFinite(matchday) || matchday < 0) return null;
  if (!Number.isFinite(expectedGames) || expectedGames <= 0) return null;
  const share = Math.min(1, matchday / expectedGames);
  if (share < 0.15) return "OPENING";
  if (share < 0.4) return "EARLY";
  if (share < 0.7) return "MIDDLE";
  if (share < 0.9) return "BUSINESS_END";
  return "FINAL_STRETCH";
}

/**
 * The phase as a noun phrase: "the business end".
 *
 * Deliberately vague, and each one is true of a whole band rather than of a week: a reporter writing about
 * "the business end" is saying something about how much of the season is left, not making a claim about a
 * date.
 */
const PHASE_NOUN: Record<SeasonPhase, string> = {
  OPENING: "the opening weeks",
  EARLY: "the early weeks",
  MIDDLE: "the middle stretch",
  BUSINESS_END: "the business end",
  FINAL_STRETCH: "the closing weeks",
};

/**
 * The phase ready to drop into a sentence: "in the opening weeks", "at the business end".
 *
 * Written out rather than assembled from the noun and a preposition, because the two do not pair up: "at"
 * is right for the business end and wrong for every other one, and "early in the campaign" is not a noun
 * phrase at all. A caller interpolating its own preposition would print "at the closing weeks".
 */
const PHASE_PHRASE: Record<SeasonPhase, string> = {
  OPENING: "in the opening weeks",
  EARLY: "early in the campaign",
  MIDDLE: "in the middle stretch",
  BUSINESS_END: "at the business end",
  FINAL_STRETCH: "in the closing weeks",
};

export function phaseWords(phase: SeasonPhase | null): string | null {
  return phase ? PHASE_NOUN[phase] : null;
}

export function phasePhrase(phase: SeasonPhase | null): string | null {
  return phase ? PHASE_PHRASE[phase] : null;
}
