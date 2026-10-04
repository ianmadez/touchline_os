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
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${symbol}${compact(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${Math.round(value)}`;
}

/** The full, unrounded figure - for a tooltip where precision is wanted on demand. */
export function formatMoneyExact(value: number, symbol = "£"): string {
  return `${symbol}${Math.round(value).toLocaleString()}`;
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
