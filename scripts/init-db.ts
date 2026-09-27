import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { config } from "../src/lib/config";

async function initDatabase() {
  console.log("=== TOUCHLINE OS: INITIALIZING PRODUCTION DATABASE ===");

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(config.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    -- 1. CAREER IDENTITY
    CREATE TABLE IF NOT EXISTS careers (
      id TEXT PRIMARY KEY,
      manager_name TEXT NOT NULL,
      club_id INTEGER NOT NULL,
      club_name TEXT NOT NULL,
      current_season INTEGER NOT NULL DEFAULT 1,
      league_id INTEGER,
      league_size INTEGER,
      in_game_date TEXT,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. MASTER SNAPSHOTS
    CREATE TABLE IF NOT EXISTS career_snapshots (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      snapshot_number INTEGER NOT NULL,
      raw_payload_hash TEXT NOT NULL,
      in_game_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_career_snapshots_career_id ON career_snapshots(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_career_snapshots_career_num ON career_snapshots(career_id, snapshot_number);

    -- 3. IMMUTABLE SNAPSHOT PLAYER STATE
    CREATE TABLE IF NOT EXISTS player_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES career_snapshots(id) ON DELETE CASCADE,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      ea_player_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      primary_position TEXT NOT NULL DEFAULT 'SUB',
      overall_rating INTEGER NOT NULL,
      potential_rating INTEGER NOT NULL,
      age INTEGER,
      birthdate INTEGER,
      jersey INTEGER,
      contract_valid_until INTEGER,
      form INTEGER,
      injury INTEGER,
      position_code INTEGER,
      name_source TEXT,
      wage INTEGER NOT NULL DEFAULT 0,
      wage_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      is_youth_prospect INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_player_snapshots_snapshot_id ON player_snapshots(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_player_snapshots_career_id ON player_snapshots(career_id);
    CREATE INDEX IF NOT EXISTS idx_player_snapshots_ea_player_id ON player_snapshots(ea_player_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_player_snapshots_snapshot_ea_id ON player_snapshots(snapshot_id, ea_player_id);

    -- 4. IMMUTABLE SNAPSHOT FINANCE STATE
    CREATE TABLE IF NOT EXISTS club_finance_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES career_snapshots(id) ON DELETE CASCADE,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      transfer_budget INTEGER NOT NULL DEFAULT 0,
      transfer_budget_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      wage_budget INTEGER NOT NULL DEFAULT 0,
      wage_budget_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      total_earnings INTEGER NOT NULL DEFAULT 0,
      record_buy INTEGER NOT NULL DEFAULT 0,
      record_sale INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_club_finance_snapshots_snapshot_id ON club_finance_snapshots(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_club_finance_snapshots_career_id ON club_finance_snapshots(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_club_finance_snapshots_snapshot_id ON club_finance_snapshots(snapshot_id);

    -- 5. CURRENT STATE PLAYERS CACHE
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      latest_snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      ea_player_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      primary_position TEXT NOT NULL DEFAULT 'SUB',
      overall_rating INTEGER NOT NULL,
      potential_rating INTEGER NOT NULL,
      age INTEGER,
      birthdate INTEGER,
      jersey INTEGER,
      contract_valid_until INTEGER,
      form INTEGER,
      injury INTEGER,
      position_code INTEGER,
      name_source TEXT,
      has_high_quality_head INTEGER,
      head_asset_id INTEGER,
      avatar_pom_id INTEGER,
      wage INTEGER NOT NULL DEFAULT 0,
      wage_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      is_youth_prospect INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_players_career_id ON players(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_players_career_ea_id ON players(career_id, ea_player_id);

    -- 6. CURRENT STATE FINANCES CACHE
    CREATE TABLE IF NOT EXISTS club_finances (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      latest_snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      transfer_budget INTEGER NOT NULL DEFAULT 0,
      transfer_budget_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      wage_budget INTEGER NOT NULL DEFAULT 0,
      wage_budget_provenance TEXT NOT NULL DEFAULT 'DERIVED',
      total_earnings INTEGER NOT NULL DEFAULT 0,
      record_buy INTEGER NOT NULL DEFAULT 0,
      record_sale INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_club_finances_career_id ON club_finances(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_club_finances_career_id ON club_finances(career_id);

    -- 7. USER INTENT OVERRIDES
    CREATE TABLE IF NOT EXISTS player_user_profiles (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      assigned_role TEXT,
      trust_level TEXT,
      importance_marker TEXT,
      user_notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_player_user_profiles_career_id ON player_user_profiles(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_player_user_profiles_career_player ON player_user_profiles(career_id, player_id);

    -- 8. CAREER EVENTS SPINE
    CREATE TABLE IF NOT EXISTS career_events (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_career_events_career_id ON career_events(career_id);
    CREATE INDEX IF NOT EXISTS idx_career_events_event_type ON career_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_career_events_snapshot_id ON career_events(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_career_events_timestamp ON career_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_career_events_career_type ON career_events(career_id, event_type);

    -- 9. MANAGER ONBOARDING PROFILES
    CREATE TABLE IF NOT EXISTS manager_onboarding_profiles (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      nationality TEXT,
      tactical_philosophy TEXT,
      realism_level TEXT NOT NULL DEFAULT 'REALISTIC',
      fav_formations_json TEXT,
      manager_objective TEXT,
      board_objective TEXT,
      personal_objective TEXT,
      club_logo_url TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_manager_onboarding_career_id ON manager_onboarding_profiles(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_onboarding_career_id ON manager_onboarding_profiles(career_id);

    -- 10. TACTICAL SYSTEMS
    CREATE TABLE IF NOT EXISTS tactical_systems (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      formation_name TEXT NOT NULL DEFAULT '4-3-3 Holding',
      base_shape_json TEXT NOT NULL,
      in_possession_shape TEXT,
      out_of_possession_shape TEXT,
      pressing_style TEXT,
      build_up_style TEXT,
      notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tactical_systems_career_id ON tactical_systems(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tactical_systems_career_id ON tactical_systems(career_id);

    -- 11. APP SETTINGS
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      save_directory TEXT,
      sync_trigger TEXT NOT NULL DEFAULT 'ON_LAUNCH',
      debrief_frequency TEXT NOT NULL DEFAULT 'EVERY_MATCH',
      realism_level TEXT NOT NULL DEFAULT 'REALISTIC',
      currency_symbol TEXT NOT NULL DEFAULT 'GBP',
      wage_format TEXT NOT NULL DEFAULT 'WEEKLY',
      ai_provider TEXT NOT NULL DEFAULT 'DISABLED',
      ai_model_name TEXT DEFAULT 'qwen2.5-coder:7b',
      ai_api_key TEXT,
      snapshot_retention INTEGER NOT NULL DEFAULT 20,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 12. STORYLINE ENGINE
    --
    -- These two were declared in src/lib/db/schema.ts and selected unconditionally by
    -- CareerService.evaluateAndSyncStorylines from the day that engine landed, but were never
    -- created here. SQLite has no such table, so every hydration threw and GET /api/career
    -- returned 500. Creating them is what makes the storyline engine reachable at all.
    CREATE TABLE IF NOT EXISTS storylines (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      season_number INTEGER,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      opening_event_id TEXT REFERENCES career_events(id) ON DELETE SET NULL,
      resolving_event_id TEXT REFERENCES career_events(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_storylines_career_id ON storylines(career_id);
    CREATE INDEX IF NOT EXISTS idx_storylines_status ON storylines(status);
    CREATE INDEX IF NOT EXISTS idx_storylines_category ON storylines(category);
    CREATE INDEX IF NOT EXISTS idx_storylines_career_status ON storylines(career_id, status);

    CREATE TABLE IF NOT EXISTS storyline_events (
      id TEXT PRIMARY KEY,
      storyline_id TEXT NOT NULL REFERENCES storylines(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES career_events(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_storyline_events_storyline_id ON storyline_events(storyline_id);
    CREATE INDEX IF NOT EXISTS idx_storyline_events_event_id ON storyline_events(event_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_storyline_events_storyline_event ON storyline_events(storyline_id, event_id);

    -- 13. SEASON HISTORY (one row per career_managerhistory season)
    CREATE TABLE IF NOT EXISTS season_history (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      season INTEGER NOT NULL,
      league_id INTEGER,
      games_played INTEGER,
      wins INTEGER,
      draws INTEGER,
      losses INTEGER,
      points INTEGER,
      goals_for INTEGER,
      goals_against INTEGER,
      table_position INTEGER,
      league_objective INTEGER,
      league_objective_result INTEGER,
      domestic_cup_objective INTEGER,
      europe_cup_objective INTEGER,
      league_trophies INTEGER,
      big_buy_amount INTEGER,
      big_buy_player_name TEXT,
      big_sell_amount INTEGER,
      big_sell_player_name TEXT,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_season_history_career_id ON season_history(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_season_history_career_season ON season_history(career_id, season);

    -- 14. LEAGUE POSITION LOG
    CREATE TABLE IF NOT EXISTS league_positions (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      season_year INTEGER,
      position INTEGER NOT NULL,
      position_high INTEGER,
      source TEXT NOT NULL DEFAULT 'USER',
      basis TEXT,
      evidence_count INTEGER,
      projected_best INTEGER,
      points INTEGER,
      played INTEGER,
      goal_difference INTEGER,
      disputed INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      entered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_league_positions_career_id ON league_positions(career_id);
    CREATE INDEX IF NOT EXISTS idx_league_positions_snapshot_id ON league_positions(snapshot_id);

    -- 15. CAREER OBJECTIVES (USER and SAVE tracks, deliberately never merged)
    CREATE TABLE IF NOT EXISTS career_objectives (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL,
      source TEXT NOT NULL,
      text TEXT,
      target_position INTEGER,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      outcome TEXT,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_career_objectives_career_id ON career_objectives(career_id);
    CREATE INDEX IF NOT EXISTS idx_career_objectives_status ON career_objectives(status);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_career_objectives_career_season_source ON career_objectives(career_id, season_year, source);
    -- 16. TRANSFER DEALS (observed prices)
    CREATE TABLE IF NOT EXISTS transfer_deals (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL,
      offered_fee INTEGER NOT NULL,
      offered_wage INTEGER,
      signed_date INTEGER,
      complete_date INTEGER,
      buying_team_id INTEGER,
      selling_team_id INTEGER,
      is_loan_buy INTEGER NOT NULL DEFAULT 0,
      is_exchange_player INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_deals_career_id ON transfer_deals(career_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_deals_player_id ON transfer_deals(player_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_deals_career_player_signed ON transfer_deals(career_id, player_id, signed_date);

    -- 17. LEAGUE TEAMS (our division, club by club - ORDER and FORM only, never points)
    CREATE TABLE IF NOT EXISTS league_teams (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      latest_snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      league_id INTEGER,
      table_position INTEGER,
      previous_year_position INTEGER,
      form TEXT,
      last_game_result INTEGER,
      is_own_club INTEGER NOT NULL DEFAULT 0,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_league_teams_career_id ON league_teams(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_league_teams_career_team ON league_teams(career_id, team_id);  `);

  // Auto-migration checks for existing databases
  const alterStatements = [
    "ALTER TABLE players ADD COLUMN primary_position TEXT NOT NULL DEFAULT 'SUB';",
    "ALTER TABLE player_snapshots ADD COLUMN primary_position TEXT NOT NULL DEFAULT 'SUB';",
    "ALTER TABLE player_user_profiles ADD COLUMN primary_position TEXT;",
    // Birthdate is a SAVE FACT captured so age is always re-derivable from the real in-game date.
    // Additive only - existing snapshot history is never rewritten.
    "ALTER TABLE players ADD COLUMN birthdate INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN birthdate INTEGER;",
    // The manager's club badge is USER data, so it is stored rather than kept in localStorage only.
    "ALTER TABLE manager_onboarding_profiles ADD COLUMN club_logo_url TEXT;",
    // Parsed from teamplayerlinks / career_playercontract all along but never persisted, so the UI
    // had no shirt numbers, contract expiry, form or injury to show. All SAVE facts.
    "ALTER TABLE players ADD COLUMN jersey INTEGER;",
    "ALTER TABLE players ADD COLUMN contract_valid_until INTEGER;",
    "ALTER TABLE players ADD COLUMN form INTEGER;",
    "ALTER TABLE players ADD COLUMN injury INTEGER;",
    "ALTER TABLE players ADD COLUMN position_code INTEGER;",
    "ALTER TABLE players ADD COLUMN name_source TEXT;",
    "ALTER TABLE player_snapshots ADD COLUMN jersey INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN contract_valid_until INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN form INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN injury INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN position_code INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN name_source TEXT;",
    // Head-asset flags: decoded so the face importer can skip the network for players with no real
    // head sprite rather than discovering it via a failed fetch.
    "ALTER TABLE players ADD COLUMN has_high_quality_head INTEGER;",
    "ALTER TABLE players ADD COLUMN head_asset_id INTEGER;",
    "ALTER TABLE players ADD COLUMN avatar_pom_id INTEGER;",
    // `career_objectives` was first created with a calendar-year key. Objective lifecycle needs the
    // save's season ordinal instead, so an existing (empty) table is renamed in place rather than
    // dropped. SQLite rewrites any index that references the column along with it.
    "ALTER TABLE career_objectives RENAME COLUMN season_year TO season_number;",
    // Season-scoped storyline threads need to know which season they belong to, and points
    // projections need a division size.
    "ALTER TABLE storylines ADD COLUMN season_number INTEGER;",
    "ALTER TABLE careers ADD COLUMN league_size INTEGER;",
    // Where the table position comes from: the save's own field, a calibrated points-per-game model,
    // or the manager. A band needs an upper bound and a stated evidence count to be honest.
    "ALTER TABLE league_positions ADD COLUMN position_high INTEGER;",
    "ALTER TABLE league_positions ADD COLUMN basis TEXT;",
    "ALTER TABLE league_positions ADD COLUMN evidence_count INTEGER;",
    "ALTER TABLE league_positions ADD COLUMN projected_best INTEGER;",
  ];

  for (const stmt of alterStatements) {
    try {
      sqlite.exec(stmt);
    } catch {
      // Column already exists, ignore duplicate column error
    }
  }

  console.log("Database initialized cleanly with full foreign keys, indexes, and snapshot history tables at:", config.databasePath);
}

initDatabase().catch((err) => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});