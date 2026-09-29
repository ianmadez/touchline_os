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
  SEASON_ENDED: "Season finished",
  STORYLINE_OPENED: "Storyline opened",
  STORYLINE_RESOLVED: "Storyline resolved",
  STORYLINE_STALE: "Storyline dropped",
  PLAYER_CONTRACT_EXPIRING: "Contract running out",
  PLAYER_DEVELOPED: "Rating movement",
  PLAYER_POSITION_CHANGED: "Position change",
};

const CATEGORY_LABELS: Record<string, string> = {
  SQUAD_DEPTH: "Squad depth",
  CONTRACT: "Contracts",
  FORM: "Form",
  TACTICAL: "Tactics",
  DEVELOPMENT: "Development",
  SEASON_OBJECTIVE: "Season objective",
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
 * Where a storyline's card should take you, based on what it is actually about.
 *
 * A card that cannot be acted on is decoration, so every category resolves to the screen where the
 * manager would do something about it.
 */
export function storylineDestination(
  category: string
): "SQUAD" | "TACTICS" | "DEBRIEF" | "TIMELINE" {
  switch (category) {
    case "TACTICAL":
      return "TACTICS";
    case "FORM":
      return "TIMELINE";
    case "SEASON_OBJECTIVE":
      return "DEBRIEF";
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
      return "Log a result";
    default:
      return "Open squad";
  }
}
