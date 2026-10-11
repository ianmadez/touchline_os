/**
 * Availability: who can be picked, and for how long.
 *
 * WHY THIS IS THE MANAGER'S TO SAY. The save carries an `injury` column per player and it read **0 for every
 * player** on the reference career, so the game keeps injuries in memory the same way it keeps the transfer
 * and wage budgets. There is no fact to read, and a derivation would be an invention dressed as data. So the
 * manager reports it, exactly as he reports a match debrief, and everything here is the arithmetic that
 * follows from what he said.
 *
 * THE DATE IS THE WHOLE MECHANISM. An injury is a return date, not a flag, so:
 *
 *   - it expires by itself as the save's own clock moves past it, with nothing to clear by hand,
 *   - it can be stated before it is known ("out for the season" is a far date, and an unknown duration is
 *     simply left out rather than guessed),
 *   - and every question the app asks about availability is a comparison against one date, which is why
 *     there is one function below that answers all of them.
 *
 * A day is available unless the return date is AFTER it. A player hurt "until the 12th" can play on the 12th,
 * which is how a manager reads a return date and how the game behaves on the day itself.
 */

/** How a manager says how long, which is what the durations in the UI are built from. */
export const INJURY_DURATION_PRESETS = [
  { key: "one-match", label: "One match", days: 7 },
  { key: "two-weeks", label: "2 weeks", days: 14 },
  { key: "three-weeks", label: "3 weeks", days: 21 },
  { key: "month", label: "A month", days: 28 },
  { key: "six-weeks", label: "6 weeks", days: 42 },
  { key: "two-months", label: "2 months", days: 60 },
  { key: "three-months", label: "3 months", days: 90 },
  { key: "season", label: "The season", days: 180 },
] as const;

export type InjuryDurationKey = (typeof INJURY_DURATION_PRESETS)[number]["key"];

export interface InjuryRecord {
  /** The day he is expected back. A player with no date is fit. */
  until: string | null;
  note: string | null;
  /** The day the manager filed it, which is the report's dateline. */
  reportedOn: string | null;
}

/**
 * Whether a player is available on a given day.
 *
 * `on` is the save's own in-game date. When it is unknown the injury is treated as current, because the
 * alternative would quietly pick an injured player into a team sheet.
 */
export function isAvailable(injury: InjuryRecord | null | undefined, on: string | null): boolean {
  if (!injury?.until) return true;
  if (on === null) return false;
  return injury.until <= on;
}

/** True while the player is still out. The inverse of `isAvailable`, named for the screens that ask it. */
export function isInjured(injury: InjuryRecord | null | undefined, on: string | null): boolean {
  return !isAvailable(injury, on);
}

/**
 * How long is left, as a manager would say it: "about 3 weeks", "a few days", "the season".
 *
 * Bands rather than a count of days on purpose. A newspaper saying "37 days" is a spreadsheet, and a manager
 * saying it is nobody. The season band exists because the last month of a long injury and the last month of a
 * season read the same to a squad.
 */
export function describeTimeOut(until: string | null, on: string | null): string | null {
  if (!until) return null;
  if (on === null) return null;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return null;
  // The bands are cut to land where the duration buttons are, so pressing "3 weeks" reads back as "about three
  // weeks" rather than as a month. A manager who is told a different length than the one he chose will stop
  // trusting the number, and the number is the whole feature.
  if (days <= 3) return "a few days";
  if (days <= 10) return "about a week";
  if (days <= 18) return "a couple of weeks";
  if (days <= 25) return "about three weeks";
  if (days <= 50) return "a month or so";
  if (days <= 80) return "a couple of months";
  if (days <= 150) return "a few months";
  return "most of the season";
}

/** Adds days to a day, for a preset duration. Returns a plain `YYYY-MM-DD`. */
export function dayFrom(day: string, days: number): string | null {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The duration band a report is written from.
 *
 * Five bands, because five is how many a reporter actually reaches for: a knock, a few weeks, a month, a few
 * months, or the rest of the season. The bands are cut to the same places as `describeTimeOut` above, so the
 * headline and the length it is talking about can never disagree: a four week absence must not be filed under
 * "months", and a headline is chosen by band.
 */
export type InjuryBand = "KNOCK" | "WEEKS" | "MONTH" | "MONTHS" | "SEASON";

export function injuryBand(until: string | null, on: string | null): InjuryBand | null {
  if (!until || !on) return null;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return null;
  if (days <= 10) return "KNOCK";
  if (days <= 25) return "WEEKS";
  if (days <= 50) return "MONTH";
  if (days <= 150) return "MONTHS";
  return "SEASON";
}
