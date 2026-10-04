import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
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
    /**
     * Who owns `trustLevel` / `importanceMarker`.
     *
     * `USER` means the manager set them by hand and a derived pass must never touch them; `DERIVED`
     * means the praise pass wrote them and may revise or clear them as the rolling window moves.
     * NULL means neither has written them yet. Two tracks, never merged - the same discipline the
     * career objectives use.
     */
    trustSource: text("trust_source"),
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
    realismLevel: text("realism_level").notNull().default("NORMAL"),
    favFormationsJson: text("fav_formations_json"), // JSON string array
    managerObjective: text("manager_objective"),
    boardObjective: text("board_objective"),
    personalObjective: text("personal_objective"),
    /**
     * Manager-supplied club badge - either an uploaded image as a data URL or a remote link.
     * Always USER provenance: the save carries no badge asset, so this is never parsed from the save.
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
    /**
     * The manager's own name for this formation. It is the identity that keys the row, so a manager
     * can keep as many formations as they like (Plan A, Plan B, "Cup away", ...) without any of them
     * overwriting another. `formationName` stays the registry id of the shape.
     */
    label: text("label").notNull().default("Primary"),
    formationName: text("formation_name").notNull().default("4-3-3 Holding"),
    /** True for the formation the rest of the app treats as the manager's current XI. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
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
    uniqueCareerFormation: uniqueIndex("uq_tactical_systems_career_label").on(
      table.careerId,
      table.label
    ),
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
  // CHAOS, STRICT_REALISM, NORMAL or OFF. Rows predating the four-level ladder may still hold the
  // retired REALISTIC/BALANCED/CASUAL values; `normaliseRealismLevel` maps those to NORMAL on read.
  realismLevel: text("realism_level").notNull().default("NORMAL"),
  // The manager's run identity. OWN is a real choice rather than an absence: no constraint.
  playstyle: text("playstyle").notNull().default("OWN"),
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
  "PRAISE",
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
// 18. LEAGUE CATALOGUE (the save's own `leagueid` -> the competition's real name)
// ============================================================================

/**
 * `leagues.leaguename` - EA's own id -> competition-name table, mirrored per career.
 *
 * This table exists because the save resolves competitions and this app did not: both
 * `career_managerhistory` and `leagueteamlinks` carry a bare `leagueid`, and every screen that showed
 * one printed the foreign key ("Division 14"). The parser has always decoded the catalogue on each
 * parse; the sync now persists it here, so any surface - this season table today, rivals, standings
 * and scouting later - resolves a league id the same way instead of re-deriving one.
 *
 * Career-scoped like every other table in this schema: two careers can each hold a Creation-Zone
 * league under the same id, and a global key would silently merge them into whichever synced last.
 *
 * `name` is stored EXACTLY as the save spells it ("England Championship (2)"). Wording is a display
 * concern and lives in `src/lib/ui/leagues.ts`, so this row stays a faithful SAVE fact. A league the
 * save gives no name for is simply absent - callers fall back to the id rather than a guess.
 */
export const leagues = sqliteTable(
  "leagues",
  {
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** `leagues.leagueid` - the save's own identifier, referenced by season and club rows. */
    leagueId: integer("league_id").notNull(),
    /** The save's raw competition name. Never reformatted, never invented. */
    name: text("name").notNull(),
    /** `leagues.level` (0-7): the tier the save itself records for this competition. */
    level: integer("level"),
    countryId: integer("country_id"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.careerId, table.leagueId] }),
    careerIdx: index("idx_leagues_career_id").on(table.careerId),
  })
);

export type LeagueCatalogRow = typeof leagues.$inferSelect;

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
//
// IMPORTANT: the save keeps ONE W/D/L/points/goals set per season and it covers every competition
// together - the league plus its cups. Seasons 1 and 2 here report 55 and 56 games for a 24-club,
// 46-game division. Those columns are therefore all-competition facts and must be labelled as such
// wherever they are shown, without naming any specific competition (the app runs against saves from
// any country). `table_position` is the only league-specific column.

export const seasonHistory = sqliteTable(
  "season_history",
  {
    id: text("id").primaryKey(), // ${careerId}_s${season}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    leagueId: integer("league_id"),
    /** Every match played, in every competition the club entered. Never league-only. */
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
    /**
     * Points and games are the save's ALL-COMPETITION record at the moment the position was logged,
     * not a league record - the save carries no league-only counterpart. Stored as read; the model
     * that consumes them states the mismatch in its caveat. See `season_history` above.
     */
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

/**
 * The manager's own board-objective tracker.
 *
 * Separate from `careerObjectives` deliberately. That table mirrors what the SAVE decided: one
 * objective per season, keyed by its source, and the save stores only a numeric code with no wording
 * attached whatsoever. This one holds what the manager was actually told, in his own words or picked
 * from the catalogue, and there are several of them at once across the five board categories.
 *
 * Folding them together would mean relaxing the save row's unique key to allow many rows - and that
 * key is exactly what makes the save mirror trustworthy, since it is what stops a re-sync
 * duplicating an objective it has already recorded.
 */
export const boardObjectives = sqliteTable(
  "board_objectives",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    /** One of the five board expectation categories. Free text in storage, typed by the app. */
    category: text("category").notNull(),
    /** The game's own 1-5 scale: 1 Critical, 5 Low. The manager sets it; the app never guesses it. */
    priority: integer("priority").notNull().default(3),
    title: text("title").notNull(),
    status: text("status").notNull().default("ON_TRACK"),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerSeasonIdx: index("idx_board_objectives_career_season").on(
      table.careerId,
      table.seasonNumber
    ),
  })
);

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

// ============================================================================
// 19. WITHIN-SEASON PROGRESS (Matchday-by-Matchday Series for Trend Charts)
// ============================================================================

export const seasonProgress = sqliteTable(
  "season_progress",
  {
    id: text("id").primaryKey(), // ${careerId}_s${seasonNumber}_m${matchday}
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id").references(() => careerSnapshots.id, {
      onDelete: "set null",
    }),
    seasonNumber: integer("season_number").notNull(),
    matchday: integer("matchday").notNull(),
    inGameDate: text("in_game_date"),
    points: integer("points").notNull().default(0),
    tablePosition: integer("table_position"),
    tablePositionHigh: integer("table_position_high"),
    played: integer("played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    goalsFor: integer("goals_for").notNull().default(0),
    goalsAgainst: integer("goals_against").notNull().default(0),
    form: text("form"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("DERIVED"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_season_progress_career_id").on(table.careerId),
    snapshotIdx: index("idx_season_progress_snapshot_id").on(table.snapshotId),
    uniqueMatchdayProgress: uniqueIndex("uq_season_progress_career_season_matchday").on(
      table.careerId,
      table.seasonNumber,
      table.matchday
    ),
  })
);

export type SeasonProgressRow = typeof seasonProgress.$inferSelect;

// ============================================================================
// 20. 5-MATCH TARGET BLOCKS (manager-reported micro-objectives)
// ============================================================================
//
// Fully USER provenance, and deliberately so. The save carries no per-match results for our division
// (its points columns are zeroed) and MATCH_DEBRIEF rows carry no season, so a block could not be
// derived from either without inventing a binding. Instead the manager states the block: a target for
// each of its five matches, and what actually happened. That makes every figure here a reported fact
// rather than an estimate, and it is the only reading of "target block" this data can honestly
// support.

export const targetBlocks = sqliteTable(
  "target_blocks",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The save's season ordinal, so blocks are scoped to one campaign. */
    seasonNumber: integer("season_number").notNull(),
    /** 1-based within the season. */
    blockIndex: integer("block_index").notNull(),
    /**
     * The five match entries, USER-reported:
     * `{ matchday, opponent, targetPoints, actualPoints, goalsFor, goalsAgainst }`.
     * Targets and actuals are 0/1/3 (a loss, a draw, a win) - the same currency a league table uses.
     */
    matchesJson: text("matches_json").notNull(),
    /** The band the block is judged against: e.g. 8-10 wanted, 11-12 a dream, <=6 a concern. */
    targetMin: integer("target_min").notNull(),
    targetMax: integer("target_max").notNull(),
    dreamPoints: integer("dream_points").notNull(),
    concernPoints: integer("concern_points").notNull(),
    /**
     * Where the club stood *before* the block's first match, as the manager read it off the table.
     *
     * Reported rather than derived, and that is the point: the save zeroes its own points columns for
     * our division, so these four figures exist only because the manager typed them. They are what
     * make the debrief's opening line ("36 played, 48 pts, 12th, +1") a fact instead of a guess.
     */
    gamesPlayedBefore: integer("games_played_before"),
    pointsBefore: integer("points_before"),
    positionBefore: integer("position_before"),
    goalDifferenceBefore: integer("goal_difference_before"),
    /** Where the club stood when the block ended, as the manager read it off the table. */
    tablePosition: integer("table_position"),
    notes: text("notes"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_target_blocks_career_id").on(table.careerId),
    uniqueBlock: uniqueIndex("uq_target_blocks_career_season_block").on(
      table.careerId,
      table.seasonNumber,
      table.blockIndex
    ),
  })
);

export type TargetBlockRow = typeof targetBlocks.$inferSelect;

// ============================================================================
// CAREER FINANCE INPUTS (manager-stated budgets, all USER provenance)
// ============================================================================
//
// FC 26 keeps the live transfer and wage budgets in memory and writes ZEROS to the save, so there is
// no fact to read and no derivation that would not be invention. An entered figure is information,
// so the app asks for the two numbers instead of printing a note about their absence.
//
// One row per career. A null column means "not stated", which is different from a stated zero - the
// manager may genuinely have nothing left, and that is worth being able to say.

export const careerFinanceInputs = sqliteTable(
  "career_finance_inputs",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    transferBudget: integer("transfer_budget"),
    wageBudget: integer("wage_budget"),
    notes: text("notes"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerUnique: uniqueIndex("uq_career_finance_inputs_career").on(table.careerId),
  })
);

export type CareerFinanceInputsRow = typeof careerFinanceInputs.$inferSelect;

// ============================================================================
// SCOUT TARGETS (the manager's own scouting board, all USER provenance)
// ============================================================================
//
// Why this is manager-entered rather than read from the save: the game stores no player valuation
// anywhere (`players` has no value column, and `career_presignedcontract` is the only table carrying
// an agreed fee), and the parser decodes the players table squad-filtered, so there is no world pool
// of other clubs' players to search. A scouting board built on nothing would be fabricated, so the
// manager states what he has actually seen in-game and Touchline does the arithmetic that follows:
// budget headroom, the gap between his valuation and the asking price, and the age profile.
//
// Keyed uniquely on (career, name) so adding someone already on the board updates him instead of
// creating a duplicate.

export const scoutTargetStatuses = [
  "WATCHING",
  "SHORTLISTED",
  "BID",
  "AGREED",
  "SIGNED",
  "PASSED",
] as const;
export const scoutTargetPriorities = ["DREAM", "TOP", "HIGH", "MEDIUM", "LOW"] as const;

/**
 * Why a target was set aside. The reason is what makes the archive a MEMORY rather than a graveyard:
 * a target rejected for age can never become relevant again, while one rejected for price can - so the
 * resurfacing pass has to know which is which before it decides to bring anything back.
 */
export const scoutArchiveReasons = [
  "TOO_EXPENSIVE",
  "WAGE_HIGH",
  "AGE_MISMATCH",
  "POSTPONED",
] as const;
export type ScoutArchiveReason = (typeof scoutArchiveReasons)[number];
export type ScoutTargetStatus = (typeof scoutTargetStatuses)[number];
export type ScoutTargetPriority = (typeof scoutTargetPriorities)[number];

export const scoutTargets = sqliteTable(
  "scout_targets",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The pool player this entry was pinned from, when it came from a search rather than being typed.
     *
     * This is what makes the shortlist a LAYER on the search rather than a copy of it: the row can be
     * traced back to the real player, and a hand-entered target simply leaves it null. Nullable on
     * purpose - the shortlist long predates the world pool and must keep working for typed rows.
     */
    eaPlayerId: integer("ea_player_id"),
    clubName: text("club_name"),
    position: text("position"),
    age: integer("age"),
    overallRating: integer("overall_rating"),
    potentialRating: integer("potential_rating"),
    /** What the manager reckons he is worth. His own judgement, not a fitted model. */
    valueEstimate: integer("value_estimate"),
    /** What his club is asking. This is the number that actually decides affordability. */
    askingPrice: integer("asking_price"),
    wageDemand: integer("wage_demand"),
    priority: text("priority", { enum: scoutTargetPriorities }).notNull().default("MEDIUM"),
    status: text("status", { enum: scoutTargetStatuses }).notNull().default("WATCHING"),
    notes: text("notes"),
    /** Set when the manager sets the target aside. Null while the target is live. */
    archiveReason: text("archive_reason", { enum: scoutArchiveReasons }),
    archivedAt: text("archived_at"),
    /**
     * The value band midpoint at the moment of archiving.
     *
     * Stored rather than re-derived so the resurfacing test is a comparison against what he actually
     * cost when the manager said no. Re-deriving it later would compare the new model against the new
     * model, which always reports no change.
     */
    valueAtArchive: integer("value_at_archive"),
    /** Contract expiry at the moment of archiving, so a renewal since then is visible as a change. */
    contractAtArchive: integer("contract_at_archive"),
    /**
     * The transfer budget at the moment of archiving.
     *
     * This is what makes POSTPONED mean anything. "Not now" only has a trigger if we know what the
     * manager could not afford at the time - otherwise there is no signal to watch and the reason is
     * a label rather than a rule.
     */
    budgetAtArchive: integer("budget_at_archive"),
    /** The last time this was surfaced again, so a recurring alert cannot nag every single search. */
    resurfacedAt: text("resurfaced_at"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_scout_targets_career_id").on(table.careerId),
    uniqueTarget: uniqueIndex("uq_scout_targets_career_name").on(table.careerId, table.name),
  })
);

export type ScoutTargetRow = typeof scoutTargets.$inferSelect;

//
// The manager's own academy, decoded from `career_youthplayers`.
//
// This is NOT the first-team squad filtered by age, which is what the Youth tab had to show before
// anything read the academy table. Academy players have no `teamplayerlinks` row - they are unpromoted,
// so nothing links them to the first team - and their ids sit in a generated range that appears in
// neither the squad nor the world pool.
//
// The assessment fields are stored as RANGES because the save describes some prospects more than once
// and the rows disagree, with no timestamp or "latest" flag to order them by. See `YouthProspectRow`
// for the full reasoning. `assessmentCount` travels with the range so the UI can say how thin it is.
//
export const youthProspects = sqliteTable(
  "youth_prospects",
  {
    /** `careerId:playerId` - one row per prospect per career, so a re-sync replaces rather than adds. */
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The save's own player id, not an EA id. Kept so a dossier can be reopened by id. */
    playerId: integer("player_id").notNull(),
    name: text("name"),
    nameSource: text("name_source"),
    positionCode: integer("position_code"),
    primaryPosition: text("primary_position"),
    age: integer("age"),
    birthdate: integer("birthdate"),
    overallRating: integer("overall_rating"),
    potentialRating: integer("potential_rating"),
    tierLow: integer("tier_low"),
    tierHigh: integer("tier_high"),
    swingLowMin: integer("swing_low_min"),
    swingLowMax: integer("swing_low_max"),
    varianceMin: integer("variance_min"),
    varianceMax: integer("variance_max"),
    monthsInSquad: integer("months_in_squad"),
    /** How many academy rows describe him. 1 means a single reading and no range to display. */
    assessmentCount: integer("assessment_count").notNull().default(1),
    goals: integer("goals"),
    appearances: integer("appearances"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("SAVE"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_youth_prospects_career_id").on(table.careerId),
    uniqueProspect: uniqueIndex("uq_youth_prospects_career_player").on(
      table.careerId,
      table.playerId
    ),
  })
);

export type YouthProspectEntry = typeof youthProspects.$inferSelect;

// ============================================================================
// WORLD PLAYERS (every professional in the save, decoded for scouting)
// ============================================================================
//
// 21,166 rows in the reference career, against the 24 the squad-filtered decode used to take. This is
// SAVE data: rating, potential, age, club, foot, weak foot, skill moves and every face stat are read
// straight from the file and are never rewritten by a model.
//
// The three `value_*` columns are the exception and are DERIVED, written at persist time so a search
// can filter and sort in SQL rather than in memory. They are the band, not a point estimate, and
// every surface must render them through the value-band formatter - a bare number is never allowed.
//
// `name_resolved` exists because 7,058 of the 21,166 rows have no name in the save. A text search
// EXCLUDES those rather than returning them namelessly; they are still fully usable as players and
// are labelled "name not in this save" wherever they are shown.

export const worldPlayers = sqliteTable(
  "world_players",
  {
    id: text("id").primaryKey(), // `${careerId}_${eaPlayerId}`
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    eaPlayerId: integer("ea_player_id").notNull(),
    name: text("name").notNull(),
    /** False when the save carries no name. Only the NAME is missing - every other field is intact. */
    nameResolved: integer("name_resolved", { mode: "boolean" }).notNull().default(false),
    clubId: integer("club_id"),
    clubName: text("club_name"),
    positionCode: integer("position_code"),
    primaryPosition: text("primary_position").notNull().default("SUB"),
    overallRating: integer("overall_rating"),
    potentialRating: integer("potential_rating"),
    age: integer("age"),
    preferredFoot: integer("preferred_foot"),
    weakFoot: integer("weak_foot"),
    skillMoves: integer("skill_moves"),
    internationalRep: integer("international_rep"),
    heightCm: integer("height_cm"),
    /** DERIVED band. Null when no basis existed at all; never rendered as a point estimate. */
    valueLow: integer("value_low"),
    valueMid: integer("value_mid"),
    valueHigh: integer("value_high"),
    /** `LOW` | `MEDIUM` | `HIGH` - how much evidence the band rests on. */
    valueConfidence: text("value_confidence"),
    /** The six face-stat groups, as the game groups them. One blob, read only by the dossier. */
    attributesJson: text("attributes_json").notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_world_players_career_id").on(table.careerId),
    uniquePlayer: uniqueIndex("uq_world_players_career_player").on(table.careerId, table.eaPlayerId),
    valueIdx: index("idx_world_players_career_value").on(table.careerId, table.valueHigh),
    ratingIdx: index("idx_world_players_career_rating").on(table.careerId, table.overallRating),
    positionIdx: index("idx_world_players_career_position").on(table.careerId, table.primaryPosition),
    ageIdx: index("idx_world_players_career_age").on(table.careerId, table.age),
  })
);

export type WorldPlayerRow = typeof worldPlayers.$inferSelect;

// ============================================================================
// WORLD PLAYER OVERRIDES (what the manager says about a world player)
// ============================================================================
//
// The save stores a foot for every player, but the game's stored foot is not always the one he is
// used on, so the manager can state his own. It lives in its OWN table rather than on `world_players`
// for the reason the whole project keeps coming back to: `world_players` is a SAVE fact and must stay
// rewritable from the file on every sync, so a USER value stored on it would either be lost on the
// next sync or would silently stop reflecting the save. Keeping them apart means the dossier can show
// both and say which is which.

export const worldPlayerOverrides = sqliteTable(
  "world_player_overrides",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    eaPlayerId: integer("ea_player_id").notNull(),
    /** 1 = right, 2 = left, matching the save's own code. Null clears the override. */
    preferredFoot: integer("preferred_foot"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueOverride: uniqueIndex("uq_world_player_overrides_career_player").on(
      table.careerId,
      table.eaPlayerId
    ),
  })
);

export type WorldPlayerOverrideRow = typeof worldPlayerOverrides.$inferSelect;