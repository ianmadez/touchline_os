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
    /**
     * The save's own nationality code, and the country name the committed reference table gives it.
     *
     * The code is the SAVE fact. The name is a lookup, exactly like `name` beside `nameSource`, and is
     * null when the save carries no nationality or the table does not name the code. Deliberately not
     * an invented three-letter abbreviation - see `SquadEntry.nationality` in the parser interface.
     */
    nationalityId: integer("nationality_id"),
    nationality: text("nationality"),
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
    /** Same pair as on `player_snapshots`. */
    nationalityId: integer("nationality_id"),
    nationality: text("nationality"),
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
    /**
     * The manager's own injury report, which is the only source there is.
     *
     * The save carries an `injury` column per player and it read 0 for every single one on the reference
     * career, so the game keeps this in memory exactly as it keeps the transfer and wage budgets. A manager
     * knows who is fit, so he says so, and the app does the arithmetic that follows: who cannot be picked,
     * and what it means for the shape.
     *
     * `injuryUntil` is the day he is expected back. Null means fit. The date is what makes this expire on its
     * own: nothing has to be cleared by hand when the day passes, which is the difference between a feature
     * and a chore.
     */
    injuryUntil: text("injury_until"),
    /** What the injury is, in the manager's words. Optional, and never invented. */
    injuryNote: text("injury_note"),
    /** The day the manager filed it, which is the news story's dateline: a report is written once. */
    injuryReportedOn: text("injury_reported_on"),
    /**
     * A name the manager typed for a player the save cannot name.
     *
     * The academy holds one prospect whose name resolves from nowhere: `playernames`, the id table that covers
     * the low half of the nameid space, is absent from the career save and from every Squads file on the
     * machine, so no amount of decoding will produce it. The manager can see the player, so he can name him,
     * and this column is his answer rather than a guess.
     *
     * It lives HERE rather than on `youth_prospects` because the sync DELETES every academy row and rewrites it
     * on each parse. A name typed into that table would last exactly one sync.
     */
    displayName: text("display_name"),
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
    /**
     * The nation that id names, resolved from the same reference table a player's nationality uses.
     *
     * Stored rather than looked up on read because the two runtimes read that table differently (a file
     * on disk, a fetch in the browser) and a caption is not worth a second lookup path. Null when the
     * save records no country or the table does not name it, never a guess.
     */
    countryName: text("country_name"),
    /** `leagues.iswomencompetition`. The women's leagues share a level and a country with the men's. */
    isWomenCompetition: integer("is_women_competition", { mode: "boolean" }).notNull().default(false),
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
// REVIEW DECISIONS (which option the manager took, all USER provenance)
// ============================================================================
//
// A review is regenerated on every read, so the decision it produced has to be stored somewhere else or it would
// vanish with the next visit. One row per (career, review, option): the manager either took an option, dropped it,
// or left it pending, and the engine never writes here.
//
// The review key is the block id or `window:<from>:<to>`, which means a decision is attached to the evidence that
// produced it. Regenerating the same window finds it again; a different window is a different decision.
//
// The engine deliberately does not read these rows when it composes, so a decision can never change what the data
// says. It only changes what the screen says about the decision.

export const reviewDecisionEnum = ["ACCEPTED", "DROPPED", "PENDING"] as const;
export type ReviewDecisionValue = (typeof reviewDecisionEnum)[number];

export const reviewDecisions = sqliteTable(
  "review_decisions",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The block id, `window:<from>:<to>`, or `carry:<season>` for a carry-over answer. */
    reviewKey: text("review_key").notNull(),
    optionId: text("option_id").notNull(),
    decision: text("decision", { enum: reviewDecisionEnum }).notNull().default("PENDING"),
    note: text("note"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_review_decisions_career_id").on(table.careerId),
    reviewIdx: index("idx_review_decisions_review_key").on(table.careerId, table.reviewKey),
    uniqueOption: uniqueIndex("uq_review_decisions_career_review_option").on(
      table.careerId,
      table.reviewKey,
      table.optionId
    ),
  })
);

export type ReviewDecisionRow = typeof reviewDecisions.$inferSelect;

// ============================================================================
// HYPOTHESES (the questions the manager has chosen to keep asking)
// ============================================================================
//
// WHY A SIBLING TABLE RATHER THAN A STORYLINE. Storylines are DERIVED: the evaluator adopts and stales them by
// subject on every hydration. A hypothesis is the opposite - the manager has accepted it, so its status is his and
// nothing else may move it. Two owners on one status column would end with the evaluator closing a question the
// manager was still asking.
//
// A hypothesis is only ever created by accepting a proposal or writing one of his own. The engine proposes; it never
// accepts on his behalf.

export const hypothesisOriginEnum = ["RULE", "ACCEPTED", "MANAGER"] as const;
export type HypothesisOrigin = (typeof hypothesisOriginEnum)[number];

export const hypothesisStatusEnum = [
  "EMERGING",
  "INVESTIGATING",
  "SUPPORTED",
  "WEAKENED",
  "RESOLVED",
  "INCONCLUSIVE",
] as const;
export type HypothesisStatus = (typeof hypothesisStatusEnum)[number];

export const hypothesisKindEnum = [
  "PERFORMANCE",
  "TACTICAL",
  "PLAYER",
  "SET_PIECE",
  "DISCIPLINE",
] as const;
export type HypothesisKind = (typeof hypothesisKindEnum)[number];

export const hypotheses = sqliteTable(
  "hypotheses",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    seasonNumber: integer("season_number"),
    /** The question, in the manager's voice. Editable; the engine never rewrites it after creation. */
    claim: text("claim").notNull(),
    /** The extra question asked after a save, when this is the one closest to its verdict. */
    question: text("question"),
    /**
     * Which rule proposed it, e.g. `performance:late-goals`, or null when the manager wrote it himself.
     *
     * Stored rather than re-derived from the claim: the evidence writer has to know what a match is supposed to
     * show before it can say whether it does, and guessing from wording would make the classification copy-dependent.
     */
    ruleKey: text("rule_key"),
    origin: text("origin", { enum: hypothesisOriginEnum }).notNull().default("ACCEPTED"),
    status: text("status", { enum: hypothesisStatusEnum }).notNull().default("EMERGING"),
    kind: text("kind", { enum: hypothesisKindEnum }).notNull(),
    /** How many matches it takes before a verdict is offered. */
    reviewAfterMatches: integer("review_after_matches").notNull().default(5),
    /** How many matches have been read against it, counted once per match. */
    matchesSeen: integer("matches_seen").notNull().default(0),
    formationLabel: text("formation_label"),
    playerIdsJson: text("player_ids_json").notNull().default("[]"),
    objectiveId: text("objective_id"),
    /** A pointer, not a relation: the thread and the hypothesis each keep their own status. */
    storylineId: text("storyline_id"),
    managerNote: text("manager_note"),
    verdictReason: text("verdict_reason"),
    openedAt: text("opened_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => ({
    careerIdx: index("idx_hypotheses_career_id").on(table.careerId),
    statusIdx: index("idx_hypotheses_career_status").on(table.careerId, table.status),
  })
);

export type HypothesisRow = typeof hypotheses.$inferSelect;

export const hypothesisStanceEnum = ["FOR", "AGAINST"] as const;
export type HypothesisStance = (typeof hypothesisStanceEnum)[number];

export const hypothesisEvidence = sqliteTable(
  "hypothesis_evidence",
  {
    id: text("id").primaryKey(),
    hypothesisId: text("hypothesis_id")
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => careerEvents.id, { onDelete: "cascade" }),
    stance: text("stance", { enum: hypothesisStanceEnum }).notNull(),
    note: text("note"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    hypothesisIdx: index("idx_hypothesis_evidence_hypothesis").on(table.hypothesisId),
    eventIdx: index("idx_hypothesis_evidence_event").on(table.eventId),
    uniqueEvent: uniqueIndex("uq_hypothesis_evidence_hypothesis_event").on(
      table.hypothesisId,
      table.eventId
    ),
  })
);

export type HypothesisEvidenceRow = typeof hypothesisEvidence.$inferSelect;

// ============================================================================
// ASSIGNMENTS (what the manager took out of a review, and how it went)
// ============================================================================
//
// An assignment is the only kind of object here that asks him to do something, so it is also the only one with a
// lifecycle that ends: active, then met, missed, concluded or dropped. Nothing infers a verdict from the data alone;
// an experiment produces a proposal and the manager closes it.

export const assignmentTypeEnum = ["POINTS_TARGET", "TACTICAL_EXPERIMENT", "PLAYER_WATCH"] as const;
export type AssignmentType = (typeof assignmentTypeEnum)[number];

export const assignmentStatusEnum = ["ACTIVE", "MET", "MISSED", "CONCLUDED", "DROPPED"] as const;
export type AssignmentStatus = (typeof assignmentStatusEnum)[number];

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    seasonNumber: integer("season_number"),
    type: text("type", { enum: assignmentTypeEnum }).notNull(),
    status: text("status", { enum: assignmentStatusEnum }).notNull().default("ACTIVE"),
    targetPoints: integer("target_points"),
    formationLabel: text("formation_label"),
    matchesTarget: integer("matches_target"),
    playerId: text("player_id"),
    blockIndex: integer("block_index"),
    verdict: text("verdict"),
    /** The review that produced it, so an assignment can be traced back to its evidence. */
    reviewKey: text("review_key"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    closedAt: text("closed_at"),
  },
  (table) => ({
    careerIdx: index("idx_assignments_career_id").on(table.careerId),
    statusIdx: index("idx_assignments_career_status").on(table.careerId, table.status),
  })
);

export type AssignmentRow = typeof assignments.$inferSelect;

// ============================================================================
// RULES PROFILE (the manager's own guard rails, one row per career)
// ============================================================================
//
// Four toggles and a notes box. The toggles only ever REMOVE options from a review, which is why the defaults are
// all off: an untouched profile offers everything, and every restriction on screen is one the manager set himself.
//
// The notes are never read by code. They are a place to think, and a test asserts the review is identical with and
// without them - the moment the engine parsed them, the advice would depend on wording rather than on state.

export const rulesProfiles = sqliteTable(
  "rules_profile",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    togglesJson: text("toggles_json").notNull().default("{}"),
    notes: text("notes"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerUnique: uniqueIndex("uq_rules_profile_career").on(table.careerId),
  })
);

export type RulesProfileRow = typeof rulesProfiles.$inferSelect;

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
/** The two shapes a recorded deal takes. A loan is not a cheaper transfer: it carries a wage and a split. */
export const dealKindEnum = ["TRANSFER", "LOAN"] as const;
export type DealKind = (typeof dealKindEnum)[number];

/**
 * Transfer deals the manager has to type in himself.
 *
 * The save carries an agreed fee only for pre-signed contracts, so a player who arrived before TouchlineOS
 * was installed, or whose deal the game simply does not write, has no row anywhere. Rather than print a note
 * about the absence, the app asks: signed from whom, for how much, sold to whom, for how much, and when.
 *
 * Every row here is USER provenance and the ledger says so. A typed fee and a saved fee are never averaged
 * into one confident number.
 *
 * A LOAN is the same table with three more columns rather than a second table, because a loan IS a move: it
 * is the money that differs. A loan's money is mostly his wage rather than a fee, so the wage and the share
 * of it this club pays are stored beside the fee it may also carry.
 */
export const transferInputs = sqliteTable(
  "transfer_inputs",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** IN for a player arriving, OUT for one leaving. */
    direction: text("direction").notNull(),
    playerName: text("player_name").notNull(),
    /** The club at the other end. Free text, because the save names no club outside our own division. */
    counterparty: text("counterparty"),
    fee: integer("fee").notNull(),
    /** TRANSFER or LOAN. Everything already on file is a transfer, which is what the default backfills. */
    kind: text("kind", { enum: dealKindEnum }).notNull().default("TRANSFER"),
    /**
     * The player's wage on a loan, in whole units per week, as the manager was told it.
     *
     * The squad carries a wage column, but a loaned player is often not in it and the figure that matters is
     * the one the deal is about. Null on a transfer, and on a loan whose wage he did not record.
     */
    salary: integer("salary"),
    /**
     * The share of that wage THIS club pays, 0 to 100.
     *
     * Null means no split was recorded. It is deliberately NOT read as all of it: a figure he never gave
     * would be the ledger inventing a cost, which is the one thing it is here not to do.
     */
    wageSharePct: integer("wage_share_pct"),
    /** The in-game date money changed hands, as the manager records it. */
    movedOn: text("moved_on"),
    season: integer("season"),
    note: text("note"),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_transfer_inputs_career_id").on(table.careerId),
  })
);

export type TransferInputsRow = typeof transferInputs.$inferSelect;

/**
 * The manager's own name for a club the save cannot name.
 *
 * The save holds no club table, so a deal with anybody outside the manager's own division comes back with a
 * numeric id and nothing else. Printing "club 69, not named in the save" is honest and useless, so the
 * ledger asks instead: name the club once and the row reads properly, with the name badged as the manager's
 * own rather than as something the file said. Keyed on the deal's id, so a later sync cannot lose it.
 */
export const transferCounterpartyNames = sqliteTable(
  "transfer_counterparty_names",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The `transfer_deals.id` this name belongs to. */
    dealId: text("deal_id").notNull(),
    name: text("name").notNull(),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_transfer_counterparty_names_career_id").on(table.careerId),
    uniqueDeal: uniqueIndex("uq_transfer_counterparty_names_deal").on(table.careerId, table.dealId),
  })
);

export type TransferCounterpartyNameRow = typeof transferCounterpartyNames.$inferSelect;
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
// The manager's honours cabinet.
//
// One row per trophy per season it was won in, so the cabinet can show "x3" by counting rows rather
// than keeping a number that has to be incremented somewhere. A repeat win therefore cannot be
// double-counted or lost.
//
// LEAGUE TITLES ARE NOT STORED. They are derived on read from `season_history`, which the save fills
// in with a final table position and its own league-trophy count per season. Deriving them means no
// pipeline version bump, nothing to keep in step, and nothing to go stale when the save is re-synced.
//
// EVERY ROW HERE IS USER DATA. The cups a manager wins are exactly the thing the save cannot tell us:
// the save's cup rows carry no name and its per-competition progress table is empty on a real career,
// so a cup win is reported by the manager or it does not exist. `kind` and `level` are copied from the
// catalogue at write time so a row still reads correctly if a catalogue entry is later removed.
//
export const careerTrophies = sqliteTable(
  "career_trophies",
  {
    /** `${careerId}_${key}_${season}` - one row per trophy per winning season. */
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The catalogue key, which is also the artwork filename stem. See `@/lib/trophies/catalogue`. */
    key: text("key").notNull(),
    /** Display name, kept so a row still reads if its catalogue entry is later renamed or removed. */
    name: text("name").notNull(),
    /** LEAGUE | DOMESTIC_CUP | CONTINENTAL, copied from the catalogue for the same reason. */
    kind: text("kind").notNull(),
    countryId: integer("country_id"),
    /** The league tier it was won at, for a league trophy. Null for a cup. */
    level: integer("level"),
    /** The save's season ORDINAL (1, 2, 3...), not a calendar year. */
    season: integer("season").notNull(),
    provenance: text("provenance", { enum: provenanceEnum }).notNull().default("USER"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_career_trophies_career_id").on(table.careerId),
    uniqueWin: uniqueIndex("uq_career_trophies_career_key_season").on(
      table.careerId,
      table.key,
      table.season
    ),
  })
);

export type CareerTrophyRow = typeof careerTrophies.$inferSelect;

/**
 * The news archive.
 *
 * A story is PUBLISHED once and then lives here, rather than being regenerated on every read. That is what
 * makes the rest of the user's asks possible: an archive can be capped, the oldest can be overwritten, a
 * story can be dismissed to free its slot, and a story the manager likes can be kept forever. It also means
 * the paper stops reshuffling under him: rewording the desk applies to new stories, and what was printed
 * stays printed.
 *
 * `id` is the story's own stable key from the engine (`result-evt_...`, `depth-CM`), so publishing is
 * idempotent - a story whose condition holds again is not written twice - and a running story that changes
 * ("4 in 5" becoming "5 in 5") is a different id and therefore a new story, which is how a paper behaves.
 *
 * `saved` is the manager's bookmark and is the only thing that exempts a row from the cap and from
 * dismissal. `read_at` is what the unread badge counts.
 */
export const newsItems = sqliteTable(
  "news_items",
  {
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    tone: text("tone").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    /**
     * The long-form article, as a JSON array of paragraphs.
     *
     * The card is the short read and this is what the reader gets when he opens the story, which is how a
     * newspaper works: a few sentences on the front, the whole piece inside. Written by the desk at the same
     * time as the rest of the item, so the two can never disagree about the facts.
     */
    articleJson: text("article_json").notNull().default("[]"),
    /**
     * The masthead the story is filed under, and who wrote it.
     *
     * These are AUTHORED fictional outlets, not real publications: a paper needs a name on it for the piece
     * to read as a piece, and putting a real newsroom's name on invented quotes would be the one thing this
     * feature must never do. Null on a story the desk files as a short notice rather than as an article.
     */
    outlet: text("outlet"),
    writer: text("writer"),
    writerRole: text("writer_role"),
    /** Where the piece is filed from, which is the club's own town for a club story. */
    dateline: text("dateline"),
    /** The app's own note of why the story ran, as a JSON array of strings. */
    evidenceJson: text("evidence_json").notNull().default("[]"),
    /** The names on the card, as a JSON array of strings, kept for the initials fallback. */
    playerNamesJson: text("player_names_json").notNull().default("[]"),
    /** EA player ids for the faces on the card, as a JSON array of numbers. */
    playerIdsJson: text("player_ids_json").notNull().default("[]"),
    /** What the manager told the press, when a report carries a comment. */
    quote: text("quote"),
    /** The in-game dateline, or null when the save carries no date at all. */
    publishedOn: text("published_on"),
    /** How significant the story was when it was written, so the paper can be re-ordered on read. */
    weight: integer("weight").notNull().default(0),
    /** The position the desk gave it in its edition, so the interleaving survives storage. */
    sortIndex: integer("sort_index").notNull().default(0),
    /**
     * Which revision of the desk's voice wrote it.
     *
     * A story is printed once and kept, which is what makes the paper a paper. That rule has one exception:
     * if the desk itself is rewritten, the old rows are reprinted in the new voice rather than leaving the
     * manager reading wording that has been fixed. Saved stories are never touched, and a dismissed story has
     * no row to reprint, so neither its bookmark nor its dismissal is disturbed.
     */
    copyVersion: integer("copy_version").notNull().default(0),
    /**
     * Whether the piece was about a match or a standing fact about the club, and the line it was filed in.
     *
     * Both are stored rather than recomputed on read. The closing paragraph of an article depends on
     * `kind`, and a rule that changes later must not silently re-close a story from last month under a
     * different frame. A stance is part of what a piece SAID, so reprinting it in the voice of a different
     * paper would be a rewrite rather than a reprint.
     *
     * The defaults are the honest backfill for rows written before the columns existed: the old id rule
     * filed everything it could not read as STANDING, and every outlet in the library was a straight one.
     */
    kind: text("kind").notNull().default("STANDING"),
    stance: text("stance").notNull().default("STRAIGHT"),
    /** The manager's bookmark. Never overwritten, never dismissed. */
    saved: integer("saved", { mode: "boolean" }).notNull().default(false),
    /** Null until the paper has been opened over it. */
    readAt: text("read_at"),
    /** The publish pass that produced it, so one edition can be told from the next. */
    edition: integer("edition").notNull().default(1),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_news_items_career_id").on(table.careerId),
    editionIdx: index("idx_news_items_career_edition").on(table.careerId, table.edition),
  })
);

export type NewsItemRow = typeof newsItems.$inferSelect;

/**
 * Every story id a career has ever published, kept after the story itself is gone.
 *
 * Without this the desk would republish anything it still has evidence for the moment its row was dismissed
 * or overwritten: a manager who dismissed a story would meet it again on the next read, and a paper at its
 * cap would reshuffle itself on every open. A row here is a few dozen bytes, one per story ever published,
 * which is nothing next to the stories.
 */
export const newsPublished = sqliteTable(
  "news_published",
  {
    /** The story's own stable key from the desk. */
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    firstPublishedAt: text("first_published_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_news_published_career_id").on(table.careerId),
  })
);

/**
 * The debriefs the manager starred.
 *
 * A row IS the star, so there is no flag to keep in step and unstarring is a delete. Kept apart from the
 * debrief itself on purpose: a debrief is a record of what happened and is never rewritten, while a star is
 * an opinion of it and can change as often as the manager likes.
 */
export const debriefMarks = sqliteTable(
  "debrief_marks",
  {
    /** `${careerId}_${eventId}`. */
    id: text("id").primaryKey(),
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** The MATCH_DEBRIEF event this star belongs to. */
    eventId: text("event_id").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_debrief_marks_career_id").on(table.careerId),
    uniqueMark: uniqueIndex("uq_debrief_marks_career_event").on(table.careerId, table.eventId),
  })
);

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
    /** Same pair as on `players`: the save's code plus the resolved country name. */
    nationalityId: integer("nationality_id"),
    nationality: text("nationality"),
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
    /**
     * Decoded for the pool all along but never persisted, so the scouting dossier was the one player
     * surface with no nationality on it. Stored as the same code + name pair as `players`.
     */
    nationalityId: integer("nationality_id"),
    nationality: text("nationality"),
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

// ============================================================================
// PLAYER MATCH RATINGS (the save's own performance record, per match)
// ============================================================================
//
// `career_playermatchratinghistory` is the only real performance record the save keeps: one row per
// player per match, with a rating and the minutes played. It was decoded all along and thrown away, so
// the app could show a player's overall rating and nothing about how he had actually played.
//
// SAVE fact throughout, and REWRITTEN on every sync rather than accumulated. The save owns this table:
// a row the save no longer lists is a row that should disappear, and an upsert would leave it behind
// forever. The natural key is the save's own `artificialkey`, which makes the rewrite idempotent.
//
// The rating is 0-10 as the save writes it. The meta declares `rangehigh="100"`, which is why it looks
// like a percentage, but the reference save measures min 4, max 10 - so nothing is scaled on the way in
// and nothing may be scaled on the way out.

export const playerMatchRatings = sqliteTable(
  "player_match_ratings",
  {
    id: text("id").primaryKey(), // `${careerId}_${artificialKey}`
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** `playerid` - the same id space `players.ea_player_id` uses, so a rating joins the squad. */
    playerId: integer("player_id").notNull(),
    /** `artificialkey`, the save's own row key. Carried so the row can be replaced in place. */
    artificialKey: integer("artificial_key").notNull(),
    /** YYYYMMDD the match was played, as an integer, exactly as the save records it. */
    date: integer("date").notNull(),
    /** 0-10. Straight from the save. */
    rating: integer("rating").notNull(),
    /** Minutes played, -1 when the save did not record them. */
    minutes: integer("minutes").notNull(),
    /** The raw 0-31 position code for that match. Null when the save omits it. */
    position: integer("position"),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_player_match_ratings_career_id").on(table.careerId),
    playerDateIdx: index("idx_player_match_ratings_career_player_date").on(
      table.careerId,
      table.playerId,
      table.date
    ),
  })
);

export type PlayerMatchRatingRecord = typeof playerMatchRatings.$inferSelect;

// ============================================================================
// COMPETITION TEAMS (every division's real record, not just our zeroed one)
// ============================================================================
//
// `leagueteamlinks` carries every club in every division. Our own division has its points and result
// columns ZEROED by the save, which is why the app can only ever infer our position - but every OTHER
// division is fully populated, and those are real SAVE facts nobody has been reading.
//
// The meta declares no flat wins/draws/losses/goalsfor/goalsagainst column. They arrive as HOME/AWAY
// PAIRS - `homewins`/`awaywins`, `homedraws`/`awaydraws`, `homelosses`/`awaylosses`, `homegf`/`awaygf`,
// `homega`/`awayga` - so the sync sums each pair before storing it. `points` is stored as the save
// writes it rather than recomputed, because the two disagree for national teams.
//
// `order_basis` records HOW the table was ordered, which is the whole reason this table is honest:
// 'SAVE' when `currenttableposition` is a clean 1..N permutation of the division, 'DERIVED' when it is
// not and the order had to come from points, goal difference and goals for.

export const competitionTeams = sqliteTable(
  "competition_teams",
  {
    id: text("id").primaryKey(), // `${careerId}_${leagueId}_${teamId}`
    careerId: text("career_id")
      .notNull()
      .references(() => careers.id, { onDelete: "cascade" }),
    /** `leagueteamlinks.leagueid`. No FK to `leagues`: that table has a composite key. */
    leagueId: integer("league_id").notNull(),
    /** `leagueteamlinks.teamid`. */
    teamId: integer("team_id").notNull(),
    name: text("name").notNull(),
    played: integer("played"),
    won: integer("won"),
    drawn: integer("drawn"),
    lost: integer("lost"),
    goalsFor: integer("goals_for"),
    goalsAgainst: integer("goals_against"),
    points: integer("points"),
    /** `currenttableposition`, stored as the save writes it - sparse, and sometimes shared. */
    position: integer("position"),
    /** 'SAVE' when the order above is the save's own 1..N, 'DERIVED' when points had to order it. */
    orderBasis: text("order_basis").notNull().default("DERIVED"),
    /** True for the manager's own division, whose record columns the save zeroes. */
    isOwnLeague: integer("is_own_league", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    careerIdx: index("idx_competition_teams_career_id").on(table.careerId),
    leagueIdx: index("idx_competition_teams_career_league").on(table.careerId, table.leagueId),
    uniqueLeagueTeam: uniqueIndex("uq_competition_teams_career_league_team").on(
      table.careerId,
      table.leagueId,
      table.teamId
    ),
  })
);

export type CompetitionTeamRow = typeof competitionTeams.$inferSelect;