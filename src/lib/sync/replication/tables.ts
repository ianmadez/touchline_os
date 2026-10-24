/**
 * Which tables replicate, and how.
 *
 * Two classes, and the distinction is load-bearing rather than tidy.
 *
 * **Row deltas** are tables where a row is a durable thing the manager owns: a profile, a note, a
 * starred debrief, an event. Losing or duplicating one is a real loss, so each write is logged and
 * replayed individually.
 *
 * **Bulk replace** is every table the sync service DELETES AND REBUILDS on each save sync - the world
 * pool, the squad, the snapshot, the league catalogue. Logging those per row would be catastrophic:
 * `sync-service.ts` rewrites all 18,926 `world_players` rows on every single sync, so a row-delta log
 * would carry the whole pool every time the manager plays a match. They replicate as one unit, only when
 * a content hash says the table actually changed.
 *
 * `app_settings` is neither. It is machine-local (a save folder, a theme), not career data, and copying
 * it between devices would move one machine's paths onto another.
 */

/** A row the manager owns. Logged and replayed per row. */
export const DELTA_TABLES = [
  "careers",
  "career_events",
  "storylines",
  "storyline_events",
  "hypotheses",
  "hypothesis_evidence",
  "assignments",
  "target_blocks",
  "review_decisions",
  "career_objectives",
  "board_objectives",
  "season_progress",
  "tactical_systems",
  "player_user_profiles",
  "manager_onboarding_profiles",
  "rules_profile",
  "career_finance_inputs",
  "transfer_inputs",
  "transfer_counterparty_names",
  "scout_targets",
  "career_trophies",
  "news_items",
  "news_published",
  "debrief_marks",
  "world_player_overrides",
] as const;

/** Rebuilt wholesale by a save sync. Replicated as one unit when the hash moves. */
export const BULK_TABLES = [
  "career_snapshots",
  "player_snapshots",
  "club_finance_snapshots",
  "players",
  "club_finances",
  "leagues",
  "league_teams",
  "competition_teams",
  "league_positions",
  "season_history",
  "player_match_ratings",
  "transfer_deals",
  "world_players",
  "youth_prospects",
] as const;

/** Never replicated: machine-local rather than career data. */
export const SKIP_TABLES = ["app_settings"] as const;

/**
 * How a table's rows are identified.
 *
 * `id` everywhere except `leagues`, whose primary key is the pair: a career can hold the same league id
 * twice under different names in different seasons, so `league_id` alone is not a key.
 */
export const KEY_COLUMNS: Record<string, string[]> = {
  leagues: ["career_id", "league_id"],
};

/** The key expression for a table, as a string used in the log and on the wire. */
export function keyOf(table: string, row: Record<string, unknown>): string {
  const columns = KEY_COLUMNS[table] ?? ["id"];
  return columns.map((column) => String(row[column] ?? "")).join("|");
}

/**
 * The career a row belongs to.
 *
 * Two tables reach their career through a parent: a storyline's evidence rows and a hypothesis's. Their
 * own rows carry no `career_id`, so the trigger has to look it up or the log could not be filtered per
 * career - which is the only way a log is useful when a device holds more than one career.
 */
export const PARENT_SCOPED: Record<string, { column: string; parent: string }> = {
  storyline_events: { column: "storyline_id", parent: "storylines" },
  hypothesis_evidence: { column: "hypothesis_id", parent: "hypotheses" },
};

export type TableClass = "delta" | "bulk";

export function tableClass(name: string): TableClass | null {
  if ((DELTA_TABLES as readonly string[]).includes(name)) return "delta";
  if ((BULK_TABLES as readonly string[]).includes(name)) return "bulk";
  return null;
}
