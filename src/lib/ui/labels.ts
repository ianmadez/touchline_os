/**
 * UI labels for stored enum values.
 *
 * The database stores uppercase enum codes (`STORYLINE_OPENED`, `SQUAD_DEPTH`) because they are
 * stable keys. They are not English. Rendering them raw leaks underscores and shouting into the
 * interface, so every enum that reaches a screen goes through one of these.
 *
 * Explicit maps rather than a generic "capitalise and strip underscores" helper: the maps are where
 * the product's vocabulary lives, so the copy can be tightened without touching the data model. The
 * fallback exists only so an unmapped code degrades into something readable instead of raw.
 */

const EVENT_LABELS: Record<string, string> = {
  CAREER_INITIALIZED: "Career started",
  SNAPSHOT_CREATED: "Save synced",
  PLAYER_SIGNED: "Player signed",
  PLAYER_SOLD: "Player sold",
  PLAYER_OVR_CHANGED: "Rating change",
  PLAYER_POTENTIAL_CHANGED: "Potential change",
  FINANCE_CHANGED: "Budget change",
  SQUAD_SIZE_CHANGED: "Squad size change",
  MATCH_DEBRIEF: "Match debrief",
  MEDIA_COMMENT: "Media comment",
  SEASON_ENDED: "Season finished",
  STORYLINE_OPENED: "Storyline opened",
  STORYLINE_RESOLVED: "Storyline resolved",
  STORYLINE_STALE: "Storyline dropped",
  PLAYER_CONTRACT_EXPIRING: "Contract running out",
  PLAYER_DEVELOPED: "Rating movement",
  PLAYER_POSITION_CHANGED: "Position change",
  PLAYER_PRAISED: "Player praised",
};

const CATEGORY_LABELS: Record<string, string> = {
  SQUAD_DEPTH: "Squad depth",
  CONTRACT: "Contracts",
  FORM: "Form",
  TACTICAL: "Tactics",
  DEVELOPMENT: "Development",
  SEASON_OBJECTIVE: "Season objective",
  PRAISE: "Manager praise",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  RESOLVED: "Resolved",
  STALE: "Dropped",
  MET: "Met",
  MISSED: "Missed",
  CLOSED: "Closed",
  SUPERSEDED: "Replaced",
};

const RESULT_LABELS: Record<string, string> = {
  WIN: "Won",
  LOSS: "Lost",
  DRAW: "Drew",
};

const VENUE_LABELS: Record<string, string> = {
  HOME: "Home",
  AWAY: "Away",
  NEUTRAL: "Neutral",
};

/** Turns an unmapped constant into a readable phrase rather than showing it raw. */
function humanise(value: string): string {
  const words = value.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? humanise(eventType);
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanise(category);
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? humanise(status);
}

export function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? humanise(result);
}

export function venueLabel(venue: string): string {
  return VENUE_LABELS[venue] ?? humanise(venue);
}

/**
 * How urgent a storyline is, as a word.
 *
 * Severity is computed from the evidence every time a thread is read (see `events/compose.ts`), so
 * this is the only place its levels are spelled out. Nothing stores one, which is why there is no
 * enum for it in the schema to keep in step.
 */
const SEVERITY_LABELS: Record<string, string> = {
  WATCH: "Watch",
  WARNING: "Warning",
  CRITICAL: "Critical",
};

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] ?? humanise(severity);
}

/**
 * How a match figure got into the boxes, as a word.
 *
 * The stored values are "SCAN" and "EDITED", and neither is shown raw. The wording is the manager's own
 * situation rather than the app's mechanism: he did not scan anything, he photographed a screen and accepted
 * what came back. "TYPED" is the absence of a marker and is not in the map, because every figure entered by
 * hand reads better with no chip at all than with one that says nothing useful.
 */
const CAPTURE_LABELS: Record<string, string> = {
  SCAN: "Read from a screenshot",
  EDITED: "Read, then changed by you",
};

export function captureLabel(method: string): string {
  return CAPTURE_LABELS[method] ?? humanise(method);
}

/**
 * The figures a debrief records, as names for the screen.
 *
 * Kept here rather than in the debrief view because the scan pane, the detail view and the news note all name
 * the same keys, and a second spelling of "Inside box" somewhere else is how two screens end up disagreeing.
 * Big chances is in the map for one reader: the detail view of a debrief logged before the game's own expected
 * goals had a box, where the stored count is shown as the record it is.
 */
const MATCH_STAT_LABELS: Record<string, string> = {
  shots: "Shots",
  shotsInsideBox: "Inside box",
  bigChances: "Big chances",
  possession: "Possession %",
  passesCompleted: "Passes",
  expectedGoalsReported: "Expected goals",
};

export function matchStatLabel(field: string): string {
  return MATCH_STAT_LABELS[field] ?? humanise(field);
}

/**
 * The Match Facts a screen printed, as names for the screen.
 *
 * Sentence case, and spelled the way the game spells them where the game's wording is the clearer one. The
 * fallback runs the key through `humanise`, so a row added to the layout tables without a name here reads as
 * words rather than as a camel case key, which is the failure that would otherwise ship unnoticed.
 */
const FACT_LABELS: Record<string, string> = {
  possessionPct: "Possession %",
  ballRecoverySeconds: "Ball recovery time",
  shots: "Shots",
  expectedGoals: "Expected goals",
  passes: "Passes",
  tackles: "Tackles",
  tacklesWon: "Tackles won",
  interceptions: "Interceptions",
  saves: "Saves",
  foulsCommitted: "Fouls committed",
  offsides: "Offsides",
  corners: "Corners",
  freeKicks: "Free kicks",
  penaltyKicks: "Penalty kicks",
  yellowCards: "Yellow cards",
  redCards: "Red cards",
  totalShots: "Total shots",
  onTarget: "On target",
  offTarget: "Off target",
  blocked: "Blocked",
  normal: "Normal",
  finesse: "Finesse",
  header: "Header",
  power: "Power",
  volley: "Volley",
  chip: "Chip",
  setPieces: "Set pieces",
  insideBox: "Inside the box",
  outsideBox: "Outside the box",
  nearSide: "Near side",
  farSide: "Far side",
  totalPasses: "Total passes",
  completed: "Completed",
  intercepted: "Intercepted",
  offside: "Offside",
  other: "Other",
  ground: "Ground",
  lob: "Lob",
  through: "Through",
  lobbedThrough: "Lobbed through",
  cross: "Cross",
  keyPass: "Key pass",
  firstTime: "First time",
  passAndGo: "Pass and go",
  downWing: "Down the wing",
  breakaway: "Breakaway",
  standingTackles: "Standing tackles",
  standingTacklesWon: "Standing tackles won",
  slidingTackles: "Sliding tackles",
  slidingTacklesWon: "Sliding tackles won",
  blocks: "Blocks",
  clearances: "Clearances",
  offensiveDuelsWon: "Offensive duels won",
  defensiveDuelsWon: "Defensive duels won",
  aerialDuelsWon: "Aerial duels won",
  beatenByOpponent: "Beaten by opponent",
  penaltiesCommitted: "Penalties committed",
};

export function factLabel(key: string): string {
  return FACT_LABELS[key] ?? humanise(key);
}

/**
 * Where a storyline's card should take you, based on what it is actually about.
 *
 * A card that cannot be acted on is decoration, so every category resolves to the screen where the
 * manager would do something about it.
 */
export function storylineDestination(
  category: string
): "SQUAD" | "TACTICS" | "DEBRIEF" | "SEASON" {
  switch (category) {
    case "TACTICAL":
      return "TACTICS";
    // Form is a run of results, and the run is charted on the Season screen. It used to point at
    // the Timeline, which no longer has a top-level tab.
    case "FORM":
      return "SEASON";
    // A season objective is tracked on the Season screen, not in the debrief. It used to go to the
    // debrief because the debrief was the only place a result could be logged against it - but the
    // objective is the thing the manager is being asked to act on, so the objective is where the card
    // has to land. Sending him to a debrief to "log a result" answered a question he had not asked.
    case "SEASON_OBJECTIVE":
      return "SEASON";
    default:
      return "SQUAD";
  }
}

/** A short, lowercase phrase for a storyline's destination, used as link text. */
export function storylineDestinationLabel(category: string): string {
  switch (category) {
    case "TACTICAL":
      return "Open tactics";
    case "FORM":
      return "See the run";
    case "SEASON_OBJECTIVE":
      return "View objectives";
    default:
      return "Open squad";
  }
}

/** The Season screen's inner tabs, shared so a call site cannot invent a name this screen lacks. */
export type SeasonSubTab = "OUTLOOK" | "OBJECTIVES" | "CHARTS" | "VAULT";

/**
 * Which inner tab of the Season screen a storyline should open.
 *
 * Landing on the Season screen is not enough for an objective thread: the screen opens on Outlook, so
 * "View objectives" would put the manager one tab away from the thing it just told him to look at.
 * Returns null for the categories where the default tab IS the destination.
 */
export function storylineDestinationSubTab(category: string): SeasonSubTab | null {
  return category === "SEASON_OBJECTIVE" ? "OBJECTIVES" : null;
}
