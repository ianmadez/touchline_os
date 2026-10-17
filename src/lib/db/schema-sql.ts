/**
 * The database schema, as SQL.
 *
 * This is the same DDL the local database has always been created from - it used to be a template
 * literal inside `scripts/init-db.ts`. It lives here so the browser build can create the identical
 * schema in its own storage; two copies of 550 lines of DDL would drift the first time either was
 * edited.
 *
 * The migrations are the additive statements the local initialiser runs after the DDL, for databases
 * created before a column existed. They are applied one at a time and failures are ignored, which is
 * how "column already exists" is handled.
 */

export const SCHEMA_DDL = `
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
      nationality_id INTEGER,
      nationality TEXT,
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
      nationality_id INTEGER,
      nationality TEXT,
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
      primary_position TEXT,
      trust_source TEXT,
      injury_until TEXT,
      injury_note TEXT,
      injury_reported_on TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_player_user_profiles_career_id ON player_user_profiles(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_player_user_profiles_career_player ON player_user_profiles(career_id, player_id);
    -- NOTE: the injury index is created in SCHEMA_MIGRATIONS, not here. On an existing database the CREATE
    -- TABLE above is skipped, so the column does not exist yet at this point and the index would fail.

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
      realism_level TEXT NOT NULL DEFAULT 'NORMAL',
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
      label TEXT NOT NULL DEFAULT 'Primary',
      formation_name TEXT NOT NULL DEFAULT '4-3-3 Holding',
      is_default INTEGER NOT NULL DEFAULT 0,
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
    -- NOTE: the unique index on (career_id, label) is created in the alter statements below, NOT
    -- here. On an existing database the CREATE TABLE IF NOT EXISTS above is skipped, so the label
    -- column does not exist yet at this point and an index on it would fail before the ALTER runs.

    -- 11. APP SETTINGS
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      save_directory TEXT,
      sync_trigger TEXT NOT NULL DEFAULT 'ON_LAUNCH',
      debrief_frequency TEXT NOT NULL DEFAULT 'EVERY_MATCH',
      realism_level TEXT NOT NULL DEFAULT 'NORMAL',
      playstyle TEXT NOT NULL DEFAULT 'OWN',
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
    CREATE UNIQUE INDEX IF NOT EXISTS uq_career_objectives_career_season_source ON career_objectives(career_id, season_number, source);

    -- 12g. THE MANAGER'S BOARD-OBJECTIVE TRACKER
    -- Separate from career_objectives, which mirrors the save's single numeric objective code and
    -- therefore has a unique key of one row per season. This holds what the manager was told, across
    -- the five board categories, with the priority the game assigned and his own progress status.
    CREATE TABLE IF NOT EXISTS board_objectives (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL,
      category TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ON_TRACK',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_board_objectives_career_season ON board_objectives(career_id, season_number);
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
    CREATE UNIQUE INDEX IF NOT EXISTS uq_league_teams_career_team ON league_teams(career_id, team_id);

    -- 18. LEAGUE CATALOGUE (the save's own leagueid -> the competition's real name)
    -- Career-scoped like every other table here: a Creation-Zone league can exist in two careers
    -- under the same id, and a global key would silently merge them into whichever synced last.
    CREATE TABLE IF NOT EXISTS leagues (
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      league_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      level INTEGER,
      country_id INTEGER,
      country_name TEXT,
      is_women_competition INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (career_id, league_id)
    );
    CREATE INDEX IF NOT EXISTS idx_leagues_career_id ON leagues(career_id);

    -- 19. WITHIN-SEASON PROGRESS (matchday-by-matchday series for the trend chart)
    -- Append-only like every other history table: one row per (season, matchday), upserted when a
    -- later sync reports the same matchday with fresher figures.
    CREATE TABLE IF NOT EXISTS season_progress (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      snapshot_id TEXT REFERENCES career_snapshots(id) ON DELETE SET NULL,
      season_number INTEGER NOT NULL,
      matchday INTEGER NOT NULL,
      in_game_date TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      table_position INTEGER,
      table_position_high INTEGER,
      played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      goals_for INTEGER NOT NULL DEFAULT 0,
      goals_against INTEGER NOT NULL DEFAULT 0,
      form TEXT,
      provenance TEXT NOT NULL DEFAULT 'DERIVED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_season_progress_career_id ON season_progress(career_id);
    CREATE INDEX IF NOT EXISTS idx_season_progress_snapshot_id ON season_progress(snapshot_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_season_progress_career_season_matchday ON season_progress(career_id, season_number, matchday);

    -- 20. GROUP DEBRIEFS / 5-MATCH TARGET BLOCKS (manager-reported micro-objectives; all USER provenance)
    CREATE TABLE IF NOT EXISTS target_blocks (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL,
      block_index INTEGER NOT NULL,
      matches_json TEXT NOT NULL,
      target_min INTEGER NOT NULL,
      target_max INTEGER NOT NULL,
      dream_points INTEGER NOT NULL,
      concern_points INTEGER NOT NULL,
      games_played_before INTEGER,
      points_before INTEGER,
      position_before INTEGER,
      goal_difference_before INTEGER,
      table_position INTEGER,
      notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_target_blocks_career_id ON target_blocks(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_target_blocks_career_season_block ON target_blocks(career_id, season_number, block_index);

    -- 21. CAREER FINANCE INPUTS (the two budgets the save refuses to carry; USER provenance)
    CREATE TABLE IF NOT EXISTS career_finance_inputs (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      transfer_budget INTEGER,
      wage_budget INTEGER,
      notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_career_finance_inputs_career ON career_finance_inputs(career_id);

    -- 22. SCOUT TARGETS (the manager's own scouting board; USER provenance)
    CREATE TABLE IF NOT EXISTS scout_targets (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      club_name TEXT,
      position TEXT,
      age INTEGER,
      overall_rating INTEGER,
      potential_rating INTEGER,
      value_estimate INTEGER,
      asking_price INTEGER,
      wage_demand INTEGER,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'WATCHING',
      notes TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_scout_targets_career_id ON scout_targets(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scout_targets_career_name ON scout_targets(career_id, name);

    -- 24. YOUTH PROSPECTS
    -- The save's own academy table (career_youthplayers), not the squad filtered by age. Assessment
    -- fields are ranges because the save assesses some prospects more than once and the rows disagree.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal, and a stray one
    -- closes the string and breaks the whole script. That has happened once already.
    CREATE TABLE IF NOT EXISTS youth_prospects (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL,
      name TEXT,
      name_source TEXT,
      position_code INTEGER,
      primary_position TEXT,
      age INTEGER,
      birthdate INTEGER,
      nationality_id INTEGER,
      nationality TEXT,
      overall_rating INTEGER,
      potential_rating INTEGER,
      tier_low INTEGER,
      tier_high INTEGER,
      swing_low_min INTEGER,
      swing_low_max INTEGER,
      variance_min INTEGER,
      variance_max INTEGER,
      months_in_squad INTEGER,
      assessment_count INTEGER NOT NULL DEFAULT 1,
      goals INTEGER,
      appearances INTEGER,
      provenance TEXT NOT NULL DEFAULT 'SAVE',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_youth_prospects_career_id ON youth_prospects(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_youth_prospects_career_player ON youth_prospects(career_id, player_id);
    -- Added after the fact: links a pinned target back to its world-pool player. Null for typed rows.
    -- No index: the shortlist is tens of rows and is never queried BY this column.

    -- 25. HONOURS CABINET
    -- One row per trophy per winning season, so "x3" is a count of rows rather than a stored number
    -- that has to be incremented somewhere. League titles are NOT stored: they are derived on read from
    -- season_history, which the save fills in, so there is nothing to keep in step. Everything here is
    -- USER data - the save cannot name a cup, so a cup win is reported by the manager or it is absent.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal.
    CREATE TABLE IF NOT EXISTS career_trophies (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      country_id INTEGER,
      level INTEGER,
      season INTEGER NOT NULL,
      provenance TEXT NOT NULL DEFAULT 'USER',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_career_trophies_career_id ON career_trophies(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_career_trophies_career_key_season ON career_trophies(career_id, key, season);

    -- 26. NEWS ARCHIVE
    -- A story is published once and kept, rather than regenerated on every read. That is what lets the
    -- paper be capped, have its oldest rows overwritten, have a dislike dismissed, and have a favourite
    -- kept forever - none of which is possible if the archive is rebuilt from scratch every time.
    -- The saved flag is the only thing that exempts a row from the cap, and read_at is what the unread
    -- badge counts.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal.
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      tone TEXT NOT NULL,
      headline TEXT NOT NULL,
      body TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      player_names_json TEXT NOT NULL DEFAULT '[]',
      player_ids_json TEXT NOT NULL DEFAULT '[]',
      quote TEXT,
      published_on TEXT,
      weight INTEGER NOT NULL DEFAULT 0,
      sort_index INTEGER NOT NULL DEFAULT 0,
      copy_version INTEGER NOT NULL DEFAULT 0,
      -- Whether the piece was about a match, and the line it was filed in. Both are stored rather than
      -- recomputed: the closing frame depends on the first, and reprinting a column in another paper's
      -- voice would be a rewrite. NOT NULL with a default, so a row written before these existed has an
      -- honest value rather than a null the reader has to interpret.
      kind TEXT NOT NULL DEFAULT 'STANDING',
      stance TEXT NOT NULL DEFAULT 'STRAIGHT',
      saved INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      edition INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_news_items_career_id ON news_items(career_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_career_edition ON news_items(career_id, edition);

    -- 27. NEWS TOMBSTONES
    -- Every story id a career has ever published, kept after the story itself is gone.
    --
    -- Without this the desk would republish anything it still has evidence for the moment its row was
    -- dismissed or overwritten, so a manager who dismissed a story would see it again on the next read and
    -- the paper would churn on every open. A row here is a few dozen bytes and there is one per story ever
    -- published, which is nothing next to the stories themselves.
    CREATE TABLE IF NOT EXISTS news_published (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      first_published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_news_published_career_id ON news_published(career_id);

    -- 28. MEMORABLE MATCHES
    -- The debriefs the manager starred, so the ones worth keeping can be found again among a season of
    -- routine ones. A row IS the star: no flag to keep in step, and unstaring deletes it.
    -- Deliberately separate from the debrief itself: a debrief is a record of what happened and is never
    -- rewritten, while a star is the manager's own opinion of it and changes as often as he likes.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal.
    CREATE TABLE IF NOT EXISTS debrief_marks (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_debrief_marks_career_id ON debrief_marks(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_debrief_marks_career_event ON debrief_marks(career_id, event_id);

    -- 29. TRANSFER LEDGER, ENTERED BY HAND
    -- The save carries an agreed fee only for pre-signed contracts, so anything that happened before
    -- TouchlineOS was installed on this save - or that the game simply does not write - has no row at all.
    -- An entered deal is information, so the app asks for it rather than printing a note about its absence.
    -- Provenance is USER on every row here, and the ledger shows it: a typed fee and a saved fee are never
    -- blended into one number without saying which is which.
    -- A loan lives here too: the kind column says which it is, and a loan carries his wage and the share of it
    -- this club pays, because on a loan the money is mostly the wage rather than the fee.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal.
    CREATE TABLE IF NOT EXISTS transfer_inputs (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      player_name TEXT NOT NULL,
      counterparty TEXT,
      fee INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'TRANSFER',
      salary INTEGER,
      wage_share_pct INTEGER,
      moved_on TEXT,
      season INTEGER,
      note TEXT,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_inputs_career_id ON transfer_inputs(career_id);

    -- 30. COUNTERPARTY NAMES THE MANAGER SUPPLIES
    -- The save names no club outside the manager's own division, so a deal with anybody else carries an id
    -- and nothing else. Rather than printing a paragraph about what the file cannot say, the ledger asks the
    -- manager to name the club once: the row then reads as it should, with the name badged as his.
    -- Keyed on the deal's own id, so a later sync of the same deal cannot lose the name.
    -- NOTE: no backticks anywhere in this SQL - it lives inside a template literal.
    CREATE TABLE IF NOT EXISTS transfer_counterparty_names (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provenance TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_counterparty_names_career_id ON transfer_counterparty_names(career_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_counterparty_names_deal ON transfer_counterparty_names(career_id, deal_id);

    -- 23. WORLD PLAYERS (every professional in the save, for scouting search)
    CREATE TABLE IF NOT EXISTS world_players (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      ea_player_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      name_resolved INTEGER NOT NULL DEFAULT 0,
      club_id INTEGER,
      club_name TEXT,
      position_code INTEGER,
      primary_position TEXT NOT NULL DEFAULT 'SUB',
      overall_rating INTEGER,
      potential_rating INTEGER,
      age INTEGER,
      nationality_id INTEGER,
      nationality TEXT,
      preferred_foot INTEGER,
      weak_foot INTEGER,
      skill_moves INTEGER,
      international_rep INTEGER,
      height_cm INTEGER,
      value_low INTEGER,
      value_mid INTEGER,
      value_high INTEGER,
      value_confidence TEXT,
      attributes_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_world_players_career_player ON world_players(career_id, ea_player_id);
    CREATE INDEX IF NOT EXISTS idx_world_players_career_value ON world_players(career_id, value_high);
    CREATE INDEX IF NOT EXISTS idx_world_players_career_rating ON world_players(career_id, overall_rating);
    CREATE INDEX IF NOT EXISTS idx_world_players_career_position ON world_players(career_id, primary_position);
    CREATE INDEX IF NOT EXISTS idx_world_players_career_age ON world_players(career_id, age);

    -- 24. WORLD PLAYER OVERRIDES (manager-stated foot, USER provenance)
    CREATE TABLE IF NOT EXISTS world_player_overrides (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      ea_player_id INTEGER NOT NULL,
      preferred_foot INTEGER,
      provenance TEXT NOT NULL DEFAULT 'USER',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_world_player_overrides_career_player ON world_player_overrides(career_id, ea_player_id);

    -- 24. PLAYER MATCH RATINGS (the save's per-match rating history - SAVE fact, rewritten per sync)
    -- The only real performance record in the file. Rebuilt from the save on every sync, never
    -- accumulated, because a row the save no longer lists should disappear rather than linger.
    CREATE TABLE IF NOT EXISTS player_match_ratings (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL,
      artificial_key INTEGER NOT NULL,
      date INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      minutes INTEGER NOT NULL,
      position INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_player_match_ratings_career_id ON player_match_ratings(career_id);
    CREATE INDEX IF NOT EXISTS idx_player_match_ratings_career_player_date ON player_match_ratings(career_id, player_id, date);

    -- 25. COMPETITION TEAMS (every division's real record - SAVE fact, rewritten per sync)
    -- Our own division is zeroed by the save; every other division is fully populated. The home/away
    -- stat pairs are summed by the sync before they land here. order_basis says whether the order
    -- came from the save's own 1..N currenttableposition or had to be derived from points.
    CREATE TABLE IF NOT EXISTS competition_teams (
      id TEXT PRIMARY KEY,
      career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
      league_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      played INTEGER,
      won INTEGER,
      drawn INTEGER,
      lost INTEGER,
      goals_for INTEGER,
      goals_against INTEGER,
      points INTEGER,
      position INTEGER,
      order_basis TEXT NOT NULL DEFAULT 'DERIVED',
      is_own_league INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_competition_teams_career_id ON competition_teams(career_id);
    CREATE INDEX IF NOT EXISTS idx_competition_teams_career_league ON competition_teams(career_id, league_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_teams_career_league_team ON competition_teams(career_id, league_id, team_id);
  `;

export const SCHEMA_MIGRATIONS: string[] = [
    "ALTER TABLE players ADD COLUMN primary_position TEXT NOT NULL DEFAULT 'SUB';",
    "ALTER TABLE player_snapshots ADD COLUMN primary_position TEXT NOT NULL DEFAULT 'SUB';",
    "ALTER TABLE player_user_profiles ADD COLUMN primary_position TEXT;",
    "ALTER TABLE player_user_profiles ADD COLUMN trust_source TEXT;",
    // Rows that predate `trust_source` carry no ownership flag. Before the praise-derived pass
    // existed, the only way a trust value could reach a row was the manager setting it by hand - so
    // a value with no flag is HIS. Claiming these is what stops the derived pass overwriting a
    // trust level the manager set long before this column existed.
    "UPDATE player_user_profiles SET trust_source = 'USER' WHERE trust_source IS NULL AND (trust_level IS NOT NULL OR importance_marker IS NOT NULL);",
    // The group debrief's opening line needs the club's situation BEFORE the block, and the save
    // zeroes its own points columns for our division - so the manager reports these four by hand.
    "ALTER TABLE target_blocks ADD COLUMN games_played_before INTEGER;",
    "ALTER TABLE target_blocks ADD COLUMN points_before INTEGER;",
    "ALTER TABLE target_blocks ADD COLUMN position_before INTEGER;",
    "ALTER TABLE target_blocks ADD COLUMN goal_difference_before INTEGER;",
    // Links a pinned shortlist target back to its world-pool player. Null for hand-typed rows, which
    // is why it is nullable rather than defaulted.
    "ALTER TABLE scout_targets ADD COLUMN ea_player_id INTEGER;",
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
    // A manager may keep as many formations as they like, so the one-row-per-career constraint is
    // replaced by one-row-per-(career, label). The old index MUST be dropped first, or the second
    // formation is rejected on every existing database.
    "ALTER TABLE tactical_systems ADD COLUMN label TEXT NOT NULL DEFAULT 'Primary';",    "ALTER TABLE tactical_systems ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;",
    "DROP INDEX IF EXISTS uq_tactical_systems_career_id;",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_tactical_systems_career_label ON tactical_systems(career_id, label);",
    // The single pre-existing formation becomes the manager's default so the current XI is unchanged.
    "UPDATE tactical_systems SET is_default = 1 WHERE id IN (SELECT id FROM tactical_systems GROUP BY career_id HAVING COUNT(*) = 1);",
    // The manager's run identity. Existing rows take OWN, which is the correct backfill: a manager who
    // never chose a playstyle has no rule, and assuming one for him would change his results silently.
    "ALTER TABLE app_settings ADD COLUMN playstyle TEXT NOT NULL DEFAULT 'OWN';",
    // Scouting memory. A rejection is only useful later if we recorded WHY and what it cost at the
    // time - without these, the archive is a list of names with no way to tell whether anything has
    // changed since.
    "ALTER TABLE scout_targets ADD COLUMN archive_reason TEXT;",
    "ALTER TABLE scout_targets ADD COLUMN archived_at TEXT;",
    "ALTER TABLE scout_targets ADD COLUMN value_at_archive INTEGER;",
    "ALTER TABLE scout_targets ADD COLUMN contract_at_archive INTEGER;",
    "ALTER TABLE scout_targets ADD COLUMN budget_at_archive INTEGER;",
    "ALTER TABLE scout_targets ADD COLUMN resurfaced_at TEXT;",
    // Nationality: the save stores a bare code on the player row and names no country anywhere, so
    // the code travels with the name the committed reference table gives it. Same pair on all four
    // player tables, and on the snapshot table so history keeps the nationality it was synced with.
    "ALTER TABLE players ADD COLUMN nationality_id INTEGER;",
    "ALTER TABLE players ADD COLUMN nationality TEXT;",
    "ALTER TABLE player_snapshots ADD COLUMN nationality_id INTEGER;",
    "ALTER TABLE player_snapshots ADD COLUMN nationality TEXT;",
    "ALTER TABLE youth_prospects ADD COLUMN nationality_id INTEGER;",
    "ALTER TABLE youth_prospects ADD COLUMN nationality TEXT;",
    "ALTER TABLE world_players ADD COLUMN nationality_id INTEGER;",
    "ALTER TABLE world_players ADD COLUMN nationality TEXT;",
    // The league catalogue predates this column, so an existing database needs it added; `leagues` is
    // written before the snapshot hash check, so it self-heals on the next sync with no version bump.
    "ALTER TABLE leagues ADD COLUMN country_name TEXT;",
    "ALTER TABLE leagues ADD COLUMN is_women_competition INTEGER NOT NULL DEFAULT 0;",
    // The paper grew a long-form article and a byline. A story published before these columns existed has
    // no article, and the reader falls back to the card's own summary rather than printing an empty page.
    "ALTER TABLE news_items ADD COLUMN article_json TEXT NOT NULL DEFAULT '[]';",
    "ALTER TABLE news_items ADD COLUMN outlet TEXT;",
    "ALTER TABLE news_items ADD COLUMN writer TEXT;",
    "ALTER TABLE news_items ADD COLUMN writer_role TEXT;",
    "ALTER TABLE news_items ADD COLUMN dateline TEXT;",
    "ALTER TABLE news_items ADD COLUMN copy_version INTEGER NOT NULL DEFAULT 0;",
    // A published row has to reprint in the shape and the voice it was written in. `kind` decides the frame
    // the article closes on, and `stance` is part of what the piece said, so neither may be re-derived from
    // today's rules. The defaults match how the old code behaved: the id regex filed every story it could not
    // read as STANDING, and every outlet in the library was a straight one.
    "ALTER TABLE news_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'STANDING';",
    "ALTER TABLE news_items ADD COLUMN stance TEXT NOT NULL DEFAULT 'STRAIGHT';",
    // The manager's own injury report. The save's own `injury` column read 0 for every player on the
    // reference career, so this is USER data and the only source there is.
    "ALTER TABLE player_user_profiles ADD COLUMN injury_until TEXT;",
    "ALTER TABLE player_user_profiles ADD COLUMN injury_note TEXT;",
    "ALTER TABLE player_user_profiles ADD COLUMN injury_reported_on TEXT;",
    "ALTER TABLE player_user_profiles ADD COLUMN display_name TEXT;",
    // After the ALTERs above, never in the DDL block: an existing database skips the CREATE TABLE there, so
    // an index on a brand new column has to come after the column exists.
    "CREATE INDEX IF NOT EXISTS idx_player_user_profiles_injury ON player_user_profiles(career_id, injury_until);",
    // Two brand new tables. `SCHEMA_DDL` runs on every open, so an existing database already has them by
    // the time these run; they are repeated here so the new tables appear in the migration list beside
    // everything else, and every statement is `IF NOT EXISTS` so the repeat is a no-op.
    "CREATE TABLE IF NOT EXISTS player_match_ratings (id TEXT PRIMARY KEY, career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE, player_id INTEGER NOT NULL, artificial_key INTEGER NOT NULL, date INTEGER NOT NULL, rating INTEGER NOT NULL, minutes INTEGER NOT NULL, position INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE INDEX IF NOT EXISTS idx_player_match_ratings_career_id ON player_match_ratings(career_id);",
    "CREATE INDEX IF NOT EXISTS idx_player_match_ratings_career_player_date ON player_match_ratings(career_id, player_id, date);",
    "CREATE TABLE IF NOT EXISTS competition_teams (id TEXT PRIMARY KEY, career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE, league_id INTEGER NOT NULL, team_id INTEGER NOT NULL, name TEXT NOT NULL, played INTEGER, won INTEGER, drawn INTEGER, lost INTEGER, goals_for INTEGER, goals_against INTEGER, points INTEGER, position INTEGER, order_basis TEXT NOT NULL DEFAULT 'DERIVED', is_own_league INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    "CREATE INDEX IF NOT EXISTS idx_competition_teams_career_id ON competition_teams(career_id);",
    "CREATE INDEX IF NOT EXISTS idx_competition_teams_career_league ON competition_teams(career_id, league_id);",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_teams_career_league_team ON competition_teams(career_id, league_id, team_id);",
    // A deal the manager records can be a loan, and the ledger had nowhere to put one: it asked for a fee and
    // nothing else, so a loan arrived as a transfer with its wage lost. Additive and defaulted, so every row
    // already on file keeps exactly the meaning it had.
    "ALTER TABLE transfer_inputs ADD COLUMN kind TEXT NOT NULL DEFAULT 'TRANSFER';",
    "ALTER TABLE transfer_inputs ADD COLUMN salary INTEGER;",
    "ALTER TABLE transfer_inputs ADD COLUMN wage_share_pct INTEGER;",
  ];