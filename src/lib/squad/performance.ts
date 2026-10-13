/**
 * What a player has actually done, and how to read it.
 *
 * Two sources, kept apart on purpose because they have different provenance:
 *
 *   - the SAVE's own match rating history (`career_playermatchratinghistory`), which gives the
 *     appearances, the minutes and the rating;
 *   - the manager's LOGGED debriefs (`MATCH_DEBRIEF` contributions), which are the only place goals and
 *     assists exist at all - the save records no scorer for anything.
 *
 * The rating scale is 0-10 as the save writes it. The meta declares `rangehigh="100"`, which is why the
 * column looks like a percentage, but the reference save measures min 4, max 10 - so nothing here
 * scales it, and nothing downstream may either.
 */

/** Below this, a rating is a cameo and must not be allowed to move a player's form. */
export const MIN_MINUTES_FOR_FORM = 15;

/** Fewer than this many ratings and there is no trend to draw, only noise. */
export const MIN_RATINGS_FOR_TREND = 3;

/**
 * How many of HIS OWN logged matches are needed before a form line is drawn.
 *
 * Deliberately counted on the manager's debriefs rather than on the save's ratings. A save will happily
 * supply fifteen ratings for a squad player the manager has never written a line about, and a graph built
 * from those is a graph with no opponent, no venue and no score on any point of it - which is exactly what
 * the first version printed, a row of "Opponent not logged" beside a number. Three logged matches is the
 * point at which the line is about a run the manager actually watched.
 */
export const MIN_LOGGED_MATCHES_FOR_TREND = 3;

/** How many recent matches the dossier lists. Enough to read a run of form, short enough to scan. */
export const RECENT_MATCH_LIMIT = 12;

/** The lowest and highest rating the sparkline's axis covers, so two players' lines are comparable. */
export const RATING_AXIS_MIN = 4;
export const RATING_AXIS_MAX = 10;

/**
 * Whether a rating row counts towards form.
 *
 * A value BELOW the floor is a cameo - the save says he was on the pitch for ten minutes, so the
 * rating is not a statement about him. A NEGATIVE value is different in kind: the save did not record
 * the minutes at all, and calling that a cameo would throw away real ratings on saves that omit the
 * column. Measured on the live save: 23 of 282 rows are genuine sub-15 cameos.
 */
export function countsTowardForm(minutes: number): boolean {
  if (minutes < 0) return true;
  return minutes >= MIN_MINUTES_FOR_FORM;
}

export type RatingBand = "GOOD" | "FAIR" | "POOR";

/** Green at 7.5 and above, amber from 6.0, red below. */
export function ratingBand(rating: number): RatingBand {
  if (rating >= 7.5) return "GOOD";
  if (rating >= 6) return "FAIR";
  return "POOR";
}

/**
 * The literal class strings for a band.
 *
 * Literal, not assembled: Tailwind scans source text, so a class built from a variable at runtime is
 * never emitted and the badge would render unstyled.
 */
export function ratingBandClasses(band: RatingBand): string {
  if (band === "GOOD") {
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (band === "FAIR") {
    return "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400";
  }
  return "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400";
}

/** A one-decimal rating, the way a match rating is always written. */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

/** The literal fill classes for the sparkline's point markers, for the same reason as the badges. */
export function ratingBandDotClasses(band: RatingBand): string {
  if (band === "GOOD") return "fill-emerald-500";
  if (band === "FAIR") return "fill-amber-500";
  return "fill-rose-500";
}

export interface PlayerRatingPoint {
  /** The in-game day the match was played, as `YYYY-MM-DD`. */
  date: string;
  /** 0-10, straight from the save. */
  rating: number;
  /** Minutes played, as the save wrote them. Negative means the save did not record them. */
  minutes: number;
  /** The raw 0-31 position code for that match. */
  position: number | null;
}

export interface PlayerRecentMatch {
  date: string;
  rating: number;
  /**
   * What the manager's own debrief recorded for that match.
   *
   * Not nullable, and that is the point of this type: a match only appears here when a debrief exists for
   * it, so the opponent is always known. A rating with no debrief behind it is a figure from the save with
   * no match attached to it, and printing "Opponent not logged" beside a number is not a match record.
   */
  opponent: string;
  venue: string | null;
  scoreline: string | null;
}

export interface PlayerPerformance {
  /** `players.id` - the same key the squad table and the dossier use. */
  playerId: string;
  /** Matches the save rated, with the cameo floor applied. */
  appearances: number;
  /** Total minutes across those matches. */
  minutes: number;
  /** Mean rating across those matches, to two decimals. Null when nothing counted. */
  averageRating: number | null;
  /** Goals the manager logged in a debrief for this player. */
  goals: number;
  /** Assists the manager logged in a debrief for this player. */
  assists: number;
  /** Debriefs this player was named in, regardless of whether he scored or assisted. */
  loggedMatches: number;
  /** Every counted rating, newest first. */
  ratings: PlayerRatingPoint[];
  /**
   * The matches the manager logged that ALSO carry a rating, newest first and capped for display.
   *
   * This is the only series the form line and the match list are built from, because it is the only one
   * where every point is a match he actually reported: opponent, venue and score on all of them.
   */
  recentMatches: PlayerRecentMatch[];
  /** How many logged-and-rated matches there are in total, before the display cap. */
  loggedMatchCount: number;
}

export interface PlayerPerformancePayload {
  /** The in-game day the season in progress is taken to begin, or null when the save has no date. */
  seasonStart: string | null;
  /** False when there is no save date, so the figures below cover the whole logged record. */
  seasonScoped: boolean;
  /** Keyed by `players.id`. A player with neither a rating nor a logged contribution is absent. */
  byPlayer: Record<string, PlayerPerformance>;
}
