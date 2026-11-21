/**
 * A player's whole record at the club, season by season and match by match.
 *
 * Ratings and minutes are SAVE facts (from the permanent match archive). Goals, assists, opponent, venue and
 * scoreline are LOGGED by the manager in debriefs. The two are kept as separate fields so the UI can label them.
 */

export interface HistoryMatch {
  /** ISO date of the match. */
  date: string;
  /** 0-10 from the save, or null for a match the manager logged that the save did not rate for him. */
  rating: number | null;
  /** Minutes from the save, or null when unknown. */
  minutes: number | null;
  /** The save's raw position code for that match. */
  position: number | null;
  opponent: string | null;
  venue: string | null;
  scoreline: string | null;
  goals: number;
  assists: number;
}

export interface HistorySeason {
  /** `2026-07-01`: the in-game season start this season is keyed by. */
  seasonStart: string;
  /** `2026/27`. */
  label: string;
  /** Rated matches of 15+ minutes, the same rule the squad table uses. */
  appearances: number;
  minutes: number;
  averageRating: number | null;
  bestRating: number | null;
  goals: number;
  assists: number;
  /** OVR/POT at the first and last sync inside this season, or null when no sync fell inside it. */
  overallStart: number | null;
  overallEnd: number | null;
  potentialEnd: number | null;
  /** Newest first. */
  matches: HistoryMatch[];
}

export interface HistoryGrowthPoint {
  snapshotNumber: number;
  inGameDate: string | null;
  overallRating: number;
  potentialRating: number;
}

export interface PlayerHistory {
  eaPlayerId: number;
  /** `players.id` (`${careerId}_${eaPlayerId}`), so a row joins the squad and the debrief contributions. */
  playerKey: string;
  name: string;
  /** In the squad right now (loanees included). False for a player who has left. */
  currentSquad: boolean;
  primaryPosition: string | null;
  /** Newest season first. */
  seasons: HistorySeason[];
  totals: {
    seasons: number;
    appearances: number;
    minutes: number;
    averageRating: number | null;
    goals: number;
    assists: number;
  };
  /** OVR/POT at every sync, oldest first. */
  growth: HistoryGrowthPoint[];
}

export interface PlayerHistoryPayload {
  players: PlayerHistory[];
}

/** `2026-07-01` -> `2026/27`. */
export function seasonLabel(seasonStart: string): string {
  const year = Number(seasonStart.slice(0, 4));
  if (!Number.isFinite(year)) return seasonStart;
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}
