import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const provenanceEnum = ["SAVE", "USER", "DERIVED", "AI"] as const;
export type Provenance = (typeof provenanceEnum)[number];

// ============================================================================
// 1. CAREER IDENTITY & MASTER SNAPSHOTS
// ============================================================================

export const careers = sqliteTable("careers", {
  id: text("id").primaryKey(),
  managerName: text("manager_name").notNull(),
  clubId: integer("club_id").notNull(),
  clubName: text("club_name").notNull(),
  currentSeason: integer("current_season").notNull().default(1),
  leagueId: integer("league_id"),
  /**
   * How many clubs are in the manager's division, counted from `leagueteamlinks`. Stored so games
   * remaining - and therefore any points projection - has a real denominator instead of a guess.
   */
  leagueSize: integer("league_size"),
  inGameDate: text("in_game_date"),
  provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const careerSnapshots = sqliteTable(
  "career_snapshots",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    snapshotNumber: integer("snapshot_number").notNull(),
    rawPayloadHash: text("raw_payload_hash").notNull(),
    inGameDate: text("in_game_date"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_career_snapshots_career_id").on(table.careerId),
    uniqueCareerSnapshot: uniqueIndex("uq_career_snapshots_career_num").on(
      table.careerId,
      table.snapshotNumber
    ),
  })
);

// ============================================================================
// 2. IMMUTABLE SNAPSHOT STATE (N -> N+1 Audit Trail)
// ============================================================================

export const playerSnapshots = sqliteTable(
  "player_snapshots",
  {
    id: text("id").primaryKey(), // GUID or ${snapshotId}_${eaPlayerId}
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => careerSnapshots.id, { onDelete: "cascade" }),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    eaPlayerId: integer("ea_player_id").notNull(),
    name: text("name").notNull(),
    primaryPosition: text("primary_position").notNull().default("SUB"),
    overallRating: integer("overall_rating").notNull(),
    potentialRating: integer("potential_rating").notNull(),
    age: integer("age"),
    // Raw EA day-count birthdate (days since 1582-10-14). A genuine SAVE FACT, stored so age can
    // always be re-derived against the correct in-game date instead of being re-guessed per sync.
    birthdate: integer("birthdate"),
    // Parsed but previously discarded. All genuine SAVE FACTS from teamplayerlinks /
    // career_playercontract, surfaced so the UI can show them instead of re-parsing the save.
    jersey: integer("jersey"),
    contractValidUntil: integer("contract_valid_until"),
    form: integer("form"),
    injury: integer("injury"),
    // The raw 0-29 EA position code, kept beside the derived role so a mapping fix can be
    // re-derived without re-parsing the save.
    positionCode: integer("position_code"),
    // Where the displayed name came from: the save's edited names, the imported name table, or
    // neither. Lets the UI be honest about the two rather than presenting them as one thing.
    nameSource: text("name_source"),
    wage: integer("wage").notNull().default(0),
    wageProvenance: text("wage_provenance", { enum: provenanceEnum }).notNull().default("DERIVED"),
    isYouthProspect: integer("is_youth_prospect", { mode: "boolean" }).notNull().default(false),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    snapshotIdx: index("idx_player_snapshots_snapshot_id").on(table.snapshotId),
    careerIdx: index("idx_player_snapshots_career_id").on(table.careerId),
    eaPlayerIdx: index("idx_player_snapshots_ea_player_id").on(table.eaPlayerId),
    uniqueSnapshotPlayer: uniqueIndex("uq_player_snapshots_snapshot_ea_id").on(
      table.snapshotId,
      table.eaPlayerId
    ),
  })
);

export const clubFinanceSnapshots = sqliteTable(
  "club_finance_snapshots",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => careerSnapshots.id, { onDelete: "cascade" }),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    transferBudget: integer("transfer_budget").notNull().default(0),
    transferBudgetProvenance: text("transfer_budget_provenance", { enum: provenanceEnum })
      .notNull()
      .default("DERIVED"),
    wageBudget: integer("wage_budget").notNull().default(0),
    wageBudgetProvenance: text("wage_budget_provenance", { enum: provenanceEnum })
      .notNull()
      .default("DERIVED"),
    totalEarnings: integer("total_earnings").notNull().default(0),
    recordBuy: integer("record_buy").notNull().default(0),
    recordSale: integer("record_sale").notNull().default(0),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    snapshotIdx: index("idx_club_finance_snapshots_snapshot_id").on(table.snapshotId),
    careerIdx: index("idx_club_finance_snapshots_career_id").on(table.careerId),
    uniqueSnapshotFinance: uniqueIndex("uq_club_finance_snapshots_snapshot_id").on(
      table.snapshotId
    ),
  })
);

// ============================================================================
// 3. CURRENT STATE CACHE (High-Performance Read Views / Cache Tables)
// ============================================================================

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(), // Format: ${careerId}_${eaPlayerId}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    latestSnapshotId: text("latest_snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    eaPlayerId: integer("ea_player_id").notNull(),
    name: text("name").notNull(),
    primaryPosition: text("primary_position").notNull().default("SUB"),
    overallRating: integer("overall_rating").notNull(),
    potentialRating: integer("potential_rating").notNull(),
    age: integer("age"),
    // Raw EA day-count birthdate (days since 1582-10-14). A genuine SAVE FACT, stored so age can
    // always be re-derived against the correct in-game date instead of being re-guessed per sync.
    birthdate: integer("birthdate"),
    // Parsed but previously discarded. All genuine SAVE FACTS from teamplayerlinks /
    // career_playercontract, surfaced so the UI can show them instead of re-parsing the save.
    jersey: integer("jersey"),
    contractValidUntil: integer("contract_valid_until"),
    form: integer("form"),
    injury: integer("injury"),
    // The raw 0-29 EA position code, kept beside the derived role so a mapping fix can be
    // re-derived without re-parsing the save.
    positionCode: integer("position_code"),
    // Where the displayed name came from: the save's edited names, the imported name table, or
    // neither. Lets the UI be honest about the two rather than presenting them as one thing.
    nameSource: text("name_source"),
    // Head-asset flags, decoded purely so the face importer can skip the network for players who
    // have no real head sprite instead of discovering that via a failed fetch.
    hasHighQualityHead: integer("has_high_quality_head", { mode: "boolean" }),
    headAssetId: integer("head_asset_id"),
    avatarPomId: integer("avatar_pom_id"),
    wage: integer("wage").notNull().default(0),
    wageProvenance: text("wage_provenance", { enum: provenanceEnum }).notNull().default("DERIVED"),
    isYouthProspect: integer("is_youth_prospect", { mode: "boolean" }).notNull().default(false),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_players_career_id").on(table.careerId),
    uniqueCareerPlayer: uniqueIndex("uq_players_career_ea_id").on(
      table.careerId,
      table.eaPlayerId
    ),
  })
);

export const clubFinances = sqliteTable(
  "club_finances",
  {
    id: text("id").primaryKey(), // Format: ${careerId}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    latestSnapshotId: text("latest_snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    transferBudget: integer("transfer_budget").notNull().default(0),
    transferBudgetProvenance: text("transfer_budget_provenance", { enum: provenanceEnum })
      .notNull()
      .default("DERIVED"),
    wageBudget: integer("wage_budget").notNull().default(0),
    wageBudgetProvenance: text("wage_budget_provenance", { enum: provenanceEnum })
      .notNull()
      .default("DERIVED"),
    totalEarnings: integer("total_earnings").notNull().default(0),
    recordBuy: integer("record_buy").notNull().default(0),
    recordSale: integer("record_sale").notNull().default(0),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_club_finances_career_id").on(table.careerId),
    uniqueCareerFinance: uniqueIndex("uq_club_finances_career_id").on(table.careerId),
  })
);

// ============================================================================
// 4. USER INTENT OVERRIDES (Roles, Trust & Tactical Annotations)
// ============================================================================

export const playerUserProfiles = sqliteTable(
  "player_user_profiles",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    assignedRole: text("assigned_role"), // e.g., "Dedicated 6", "B2B", "Impact Sub"
    trustLevel: text("trust_level"), // e.g., "HIGH", "MEDIUM", "LOW"
    importanceMarker: text("importance_marker"), // e.g., "UNTOUCHABLE", "KEY_PLAYER", "SURPLUS"
    userNotes: text("user_notes"),
    primaryPosition: text("primary_position"), // User position override (e.g. ST, CM, CB)
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_player_user_profiles_career_id").on(table.careerId),
    uniquePlayerUser: uniqueIndex("uq_player_user_profiles_career_player").on(
      table.careerId,
      table.playerId
    ),
  })
);

// ============================================================================
// 5. CAREER EVENTS LOG (The Spine of System Auditing & Diffing)
// ============================================================================

export const careerEvents = sqliteTable(
  "career_events",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`).notNull(),
    eventType: text("event_type").notNull(), // e.g., PLAYER_SIGNED, SQUAD_CHANGED, FINANCE_CHANGED
    source: text("source", { enum: provenanceEnum }).notNull(),
    entityType: text("entity_type").notNull(), // e.g., PLAYER, CLUB, MATCH
    entityId: text("entity_id").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => ({
    careerIdx: index("idx_career_events_career_id").on(table.careerId),
    eventTypeIdx: index("idx_career_events_event_type").on(table.eventType),
    snapshotIdx: index("idx_career_events_snapshot_id").on(table.snapshotId),
    timestampIdx: index("idx_career_events_timestamp").on(table.timestamp),
    careerEventTypeIdx: index("idx_career_events_career_type").on(
      table.careerId,
      table.eventType
    ),
  })
);

// ============================================================================
// 6. MANAGER ONBOARDING & PHILOSOPHY
// ============================================================================

export const managerOnboardingProfiles = sqliteTable(
  "manager_onboarding_profiles",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    nationality: text("nationality"),
    tacticalPhilosophy: text("tactical_philosophy"), // e.g. Gegenpress, Tiki-Taka, Direct Counter
    realismLevel: text("realism_level").notNull().default("REALISTIC"), // STRICT_REALISM, REALISTIC, BALANCED, CASUAL, CHAOS
    favFormationsJson: text("fav_formations_json"), // JSON string array
    managerObjective: text("manager_objective"),
    boardObjective: text("board_objective"),
    personalObjective: text("personal_objective"),
    /**
     * Manager-supplied club badge - either an uploaded image as a data URL or a remote link.
     * Always USER provenance: the save carries no badge asset, so this is never parsed from FC25.
     */
    clubLogoUrl: text("club_logo_url"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_manager_onboarding_career_id").on(table.careerId),
    uniqueCareerOnboarding: uniqueIndex("uq_manager_onboarding_career_id").on(table.careerId),
  })
);

// ============================================================================
// 7. TACTICAL SYSTEMS & 2D PITCH CONFIGURATION
// ============================================================================

export const tacticalSystems = sqliteTable(
  "tactical_systems",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    formationName: text("formation_name").notNull().default("4-3-3 Holding"),
    baseShapeJson: text("base_shape_json").notNull(), // Pitch slot assignments JSON
    inPossessionShape: text("in_possession_shape"),
    outOfPossessionShape: text("out_of_possession_shape"),
    pressingStyle: text("pressing_style"),
    buildUpStyle: text("build_up_style"),
    notes: text("notes"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_tactical_systems_career_id").on(table.careerId),
    uniqueCareerTactics: uniqueIndex("uq_tactical_systems_career_id").on(table.careerId),
  })
);

// ============================================================================
// 8. APPLICATION SETTINGS
// ============================================================================

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  saveDirectory: text("save_directory"),
  syncTrigger: text("sync_trigger").notNull().default("ON_LAUNCH"), // ON_LAUNCH, MANUAL
  debriefFrequency: text("debrief_frequency").notNull().default("EVERY_MATCH"), // EVERY_MATCH, EVERY_2_MATCHES, EVERY_3_MATCHES, MANUAL
  realismLevel: text("realism_level").notNull().default("REALISTIC"),
  currencySymbol: text("currency_symbol").notNull().default("GBP"), // GBP, EUR, USD
  wageFormat: text("wage_format").notNull().default("WEEKLY"), // WEEKLY, ANNUAL
  aiProvider: text("ai_provider").notNull().default("DISABLED"), // OLLAMA, GROQ, DISABLED
  aiModelName: text("ai_model_name").default("qwen2.5-coder:7b"),
  aiApiKey: text("ai_api_key"),
  snapshotRetention: integer("snapshot_retention").notNull().default(20),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================================================
// 9. STORYLINE ENGINE (Spine-Native Narrative Container)
// ============================================================================

export const storylineCategoryEnum = [
  "SQUAD_DEPTH",
  "CONTRACT",
  "FORM",
  "TACTICAL",
  "DEVELOPMENT",
  "SEASON_OBJECTIVE",
] as const;
export type StorylineCategory = (typeof storylineCategoryEnum)[number];

export const storylineStatusEnum = ["ACTIVE", "RESOLVED", "STALE"] as const;
export type StorylineStatus = (typeof storylineStatusEnum)[number];

export const storylines = sqliteTable(
  "storylines",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category", { enum: storylineCategoryEnum }).notNull(),
    status: text("status", { enum: storylineStatusEnum }).notNull().default("ACTIVE"),
    /**
     * The season this thread belongs to, for season-scoped threads (`SEASON_OBJECTIVE`). Null for
     * squad and player threads, which are not tied to a season boundary.
     */
    seasonNumber: integer("season_number"),
    openedAt: text("opened_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    resolvedAt: text("resolved_at"),
    openingEventId: text("opening_event_id").references(() => careerEvents.id, {
      onDelete: "set null",
    }),
    resolvingEventId: text("resolving_event_id").references(() => careerEvents.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_storylines_career_id").on(table.careerId),
    statusIdx: index("idx_storylines_status").on(table.status),
    categoryIdx: index("idx_storylines_category").on(table.category),
    careerStatusIdx: index("idx_storylines_career_status").on(
      table.careerId,
      table.status
    ),
  })
);

export const storylineEvents = sqliteTable(
  "storyline_events",
  {
    id: text("id").primaryKey(),
    storylineId: text("storyline_id")
      .notNull()
      .references(() => storylines.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => careerEvents.id, { onDelete: "cascade" }),
    addedAt: text("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    storylineIdx: index("idx_storyline_events_storyline_id").on(table.storylineId),
    eventIdx: index("idx_storyline_events_event_id").on(table.eventId),
    uniqueStorylineEvent: uniqueIndex("uq_storyline_events_storyline_event").on(
      table.storylineId,
      table.eventId
    ),
  })
);

// ============================================================================
// 17. LEAGUE TEAMS (our division, club by club - ORDER and FORM only)
// ============================================================================

/**
 * The clubs in the manager's own division, so the app can talk about opponents by name.
 *
 * Read from `leagueteamlinks` joined to `teams`. The save is explicit about what it does not say
 * here: points, wins, draws, losses and goals are **zeroed for every club in the user's division**,
 * ours included. What is live is the table position, last year's position, the form string and the
 * game's own best-plausible finish.
 *
 * So this table is ORDER and FORM. It is never a rival's record, and no derived figure may be
 * presented as though it came from here. Rival points only ever come from the manager, via a
 * debrief.
 */
export const leagueTeams = sqliteTable(
  "league_teams",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    latestSnapshotId: text("latest_snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    /** `leagueteamlinks.teamid` - the save's own club identifier, stable across syncs. */
    teamId: integer("team_id").notNull(),
    name: text("name").notNull(),
    leagueId: integer("league_id"),
    /** Sparse in the save: some clubs carry no position, and a few share one. Nulls are preserved. */
    tablePosition: integer("table_position"),
    previousYearPosition: integer("previous_year_position"),
    /** The save's result code string (e.g. "22111"). Opaque, so it is stored as text, not a number. */
    form: text("form"),
    lastGameResult: integer("last_game_result"),
    isOwnClub: integer("is_own_club", { mode: "boolean" }).notNull().default(false),
    provenance: text("provenance").notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_league_teams_career_id").on(table.careerId),
    uniqueCareerTeam: uniqueIndex("uq_league_teams_career_team").on(
      table.careerId,
      table.teamId
    ),
  })
);

// ============================================================================
// 10. SEASON HISTORY (one row per `career_managerhistory` season - a SAVE fact)
// ============================================================================//
// `career_managerhistory` holds ONE ROW PER SEASON. Reading row [0] reported season 1's figures
// for the entire career, so the whole table is mirrored here instead. `tablePosition` is 0 or null
// until the season completes, which makes it the save's only reliable "season has ended" signal -
// there is no SEASON_ENDED flag anywhere in the file.

export const seasonHistory = sqliteTable(
  "season_history",
  {
    id: text("id").primaryKey(), // ${careerId}_s${season}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    leagueId: integer("league_id"),
    gamesPlayed: integer("games_played"),
    wins: integer("wins"),
    draws: integer("draws"),
    losses: integer("losses"),
    points: integer("points"),
    goalsFor: integer("goals_for"),
    goalsAgainst: integer("goals_against"),
    /** Final league position. 0/null means the season is still in progress. */
    tablePosition: integer("table_position"),
    /** EA's own board objective for that season, and the manager's result against it. */
    leagueObjective: integer("league_objective"),
    leagueObjectiveResult: integer("league_objective_result"),
    domesticCupObjective: integer("domestic_cup_objective"),
    europeCupObjective: integer("europe_cup_objective"),
    leagueTrophies: integer("league_trophies"),
    bigBuyAmount: integer("big_buy_amount"),
    bigBuyPlayerName: text("big_buy_player_name"),
    bigSellAmount: integer("big_sell_amount"),
    bigSellPlayerName: text("big_sell_player_name"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_season_history_career_id").on(table.careerId),
    uniqueCareerSeason: uniqueIndex("uq_season_history_career_season").on(
      table.careerId,
      table.season
    ),
  })
);

// ============================================================================
// 11. LEAGUE POSITION LOG
// ============================================================================
//
// The save holds no live league table for the manager's own division: `leagueteamlinks` is zeroed
// for it (points and every W/D/L/GF/GA column read 0) while other leagues are fully populated, and
// the reference measured `currenttableposition` as disagreeing with the game's own screen. So the
// position is logged here, tagged with where it came from: SAVE when the save genuinely supplies
// it, USER when the manager types it, DERIVED once enough entries exist to fit a local band.
// Snapshot-keyed so it diffs sync-to-sync like everything else.

export const leaguePositions = sqliteTable(
  "league_positions",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    seasonYear: integer("season_year"),
    position: integer("position").notNull(),
    /**
     * Upper bound when the entry is a band rather than a point estimate. Null means the position is
     * exactly `position`. An inferred position is always shown as a band, never as a single number.
     */
    positionHigh: integer("position_high"),
    source: text("source", { enum: provenanceEnum }).notNull().default("USER"),
    /**
     * What produced this figure: `save-hint` (the save's own table position field), `ppm-model` (a
     * points-per-game curve calibrated on observed seasons), `debrief-record` (added up from logged
     * match debriefs) or `manual` (the manager typed it). Shown in the UI, never hidden.
     */
    basis: text("basis"),
    /** How many observations fed an inferred figure. Zero or null means none did. */
    evidenceCount: integer("evidence_count"),
    /**
     * The save's own "highest probable finish" for our club, from `leagueteamlinks`. It is the one
     * forward-looking number the file carries about the table, so it seeds the inference.
     */
    projectedBest: integer("projected_best"),
    points: integer("points"),
    played: integer("played"),
    goalDifference: integer("goal_difference"),
    /**
     * Set when a USER entry materially disagrees with what the save's own record implies. The
     * entry is still stored as the user gave it - a disagreement is information, not an error to
     * silently correct.
     */
    disputed: integer("disputed", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    enteredAt: text("entered_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_league_positions_career_id").on(table.careerId),
    snapshotIdx: index("idx_league_positions_snapshot_id").on(table.snapshotId),
  })
);

// ============================================================================
// 12. CAREER OBJECTIVES (two provenance tracks, deliberately never merged)
// ============================================================================
//
// Two sources answer a similar question and are kept side by side rather than one overwriting the
// other: USER is the objective the manager typed at onboarding, SAVE is EA's own
// `career_managerhistory.leagueobjective`. A conflict between them is interesting, not a bug.

/**
 * ACTIVE  - the season is still running.
 * MET/MISSED - judged at season end against a numeric target position.
 * CLOSED  - the season ended but the objective carried no target we could judge, so it is closed
 *           without a verdict rather than guessed at. This is the honest default for free-text and
 *           for the save's own undecoded objective code.
 * SUPERSEDED - replaced by a newer objective before the season finished.
 */
export const objectiveStatusEnum = ["ACTIVE", "MET", "MISSED", "CLOSED", "SUPERSEDED"] as const;
export type ObjectiveStatus = (typeof objectiveStatusEnum)[number];

export const careerObjectives = sqliteTable(
  "career_objectives",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /**
     * The save's own 1-based season ordinal (`career_managerhistory.season`) - NOT a calendar year.
     * The ordinal is what increments when a season turns over, so objective lifecycle keys off it;
     * a year would leave the boundary ambiguous.
     */
    seasonNumber: integer("season_number").notNull(),
    source: text("source", { enum: provenanceEnum }).notNull(),
    /** USER: the free text the manager typed. SAVE: EA's objective code, rendered as a label. */
    text: text("text"),
    /** For a promotion/position objective, the finishing position it demands. */
    targetPosition: integer("target_position"),
    status: text("status", { enum: objectiveStatusEnum }).notNull().default("ACTIVE"),
    /** How it finished: the actual position, or the save's own objective result code. */
    outcome: text("outcome"),
    openedAt: text("opened_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    closedAt: text("closed_at"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_career_objectives_career_id").on(table.careerId),
    statusIdx: index("idx_career_objectives_status").on(table.status),
    uniqueCareerSeasonSource: uniqueIndex("uq_career_objectives_career_season_source").on(
      table.careerId,
      table.seasonNumber,
      table.source
    ),
  })
);

// ============================================================================
// 13. TRANSFER DEALS (observed prices - the evidence base for a value estimate)
// ============================================================================
//
// The game writes no player valuation anywhere: `players` has no value column and
// `career_presignedcontract` is the only table in the schema carrying an agreed fee. So every
// valuation in the app is fitted on these rows rather than read from the save.

export const transferDeals = sqliteTable(
  "transfer_deals",
  {
    id: text("id").primaryKey(), // ${careerId}_${playerId}_${signedDate}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull(),
    offeredFee: integer("offered_fee").notNull(),
    offeredWage: integer("offered_wage"),
    signedDate: integer("signed_date"),
    completeDate: integer("complete_date"),
    buyingTeamId: integer("buying_team_id"),
    sellingTeamId: integer("selling_team_id"),
    /** A loan made permanent, or a swap - both distort the fee as a price signal. */
    isLoanBuy: integer("is_loan_buy", { mode: "boolean" }).notNull().default(false),
    isExchangePlayer: integer("is_exchange_player", { mode: "boolean" }).notNull().default(false),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_transfer_deals_career_id").on(table.careerId),
    playerIdx: index("idx_transfer_deals_player_id").on(table.playerId),
    uniqueDeal: uniqueIndex("uq_transfer_deals_career_player_signed").on(
      table.careerId,
      table.playerId,
      table.signedDate
    ),
  })
);