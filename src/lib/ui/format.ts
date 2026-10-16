/**
 * Display formatting for numbers.
 *
 * Money is always presented with a symbol and a magnitude (K/M), because the values here range from
 * a few thousand to tens of millions and bare digits at that spread are unreadable.
 */

/** Rounds to one decimal and drops a trailing `.0`, so 2.0M reads as 2M. */
function compact(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatMoney(value: number, symbol = "£"): string {
  // The sign goes BEFORE the symbol: "-£1.3M" reads as a negative amount, where "£-1.3M" reads as a
  // typo. It matters here because a net spend is routinely negative.
  const sign = value < 0 ? "-" : "";
  const amount = Math.abs(value);
  if (amount >= 1_000_000) return `${sign}${symbol}${compact(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `${sign}${symbol}${Math.round(amount / 1_000)}k`;
  return `${sign}${symbol}${Math.round(amount)}`;
}

/** The full, unrounded figure - for a tooltip where precision is wanted on demand. */
export function formatMoneyExact(value: number, symbol = "£"): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol}${Math.round(Math.abs(value)).toLocaleString()}`;
}

/**
 * The save stores a currency CODE, not a glyph. One mapping, here, so the finance screen, the
 * scouting board and the transfers desk cannot disagree about what a dollar looks like.
 */
export function currencySymbolFor(code: string | null | undefined): string {
  if (code === "EUR") return "€";
  if (code === "USD") return "$";
  return "£";
}

/**
 * 1 -> "1st", 2 -> "2nd", 11 -> "11th".
 *
 * A bare table number reads as a count beside a club name, so a placing is always written with its
 * suffix. The teens are handled separately because 11, 12 and 13 take "th" despite ending in 1, 2, 3.
 */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
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
 * The precision the game reports its own expected goals to.
 *
 * Two places, and it is the game's number rather than a rounded one, so trimming it to one would be inventing a
 * figure the manager never saw.
 */
export const EXPECTED_GOALS_PLACES = 2;

/**
 * The game's own expected goals, at its own precision.
 *
 * One function rather than `.toFixed(2)` at each of the four places the figure appears, so the readout card, the
 * detail view, the scan pane and the news evidence line cannot drift apart on how many places the same number
 * has.
 */
export function formatExpectedGoals(value: number): string {
  return value.toFixed(EXPECTED_GOALS_PLACES);
}
