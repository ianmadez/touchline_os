/**
 * What a competition is called on screen.
 *
 * The database holds the save's own wording, untouched - "England Championship (2)", tier suffix and
 * all. That is EA's string, not this app's: it prefixes the country and numbers the tier, and for the
 * competitions a manager actually plays in, football uses a shorter name. This file is where that
 * renaming lives, and it is the only place that knows any of it.
 *
 * Keyed by the save's own name (minus the tier suffix), NOT by `leagueid`. An id is an internal
 * number that can be renumbered by an editor or a future edition, while the name is what the save
 * actually said - so this map keeps working when ids drift.
 *
 * Nothing here is invented, and nothing here is save data. An unlisted competition is shown exactly
 * as the save spells it, and a league id the catalogue has no name for falls back to `League ID <n>`,
 * which is honest about being an unresolved key - unlike the "Division <n>" it replaces, which
 * claimed a resolved identity that was never there.
 *
 * Deliberately small: add an entry when a real save's wording reads badly, not speculatively.
 */
const LEAGUE_DISPLAY_NAMES: Record<string, string> = {
  // England, tier by tier - the pyramid a career moves through.
  "England Premier League": "English Premier League",
  "England Championship": "Championship",
  "England League One": "League One",
  "England League Two": "League Two",

  // The rest of Europe's top divisions the save carries.
  "Spain Primera División": "La Primera División",
  "Spain Segunda División": "La Segunda División",
  "Italy Serie A": "Serie A",
  "Italy Serie B": "Serie B",
  "Germany 1. Bundesliga": "Bundesliga",
  "Germany 2. Bundesliga": "2. Bundesliga",
  "Germany 3. Liga": "3. Liga",
  "France Ligue 1": "Ligue 1",
  "France Ligue 2": "Ligue 2",
  "Holland Eredivisie": "Eredivisie",
  "Portugal Primeira Liga": "Primeira Liga",
  "Belgium Pro League": "Belgian Pro League",
  "Turkey Süper Lig": "Süper Lig",
  "Scotland Premiership": "Scottish Premiership",
  "Austria Bundesliga": "Austrian Bundesliga",
  "Switzerland Super League": "Swiss Super League",
  "Denmark Superliga": "Danish Superliga",
  "Norway Eliteserien": "Eliteserien",
  "Sweden Allsvenskan": "Allsvenskan",
  "Poland Ekstraklasa": "Ekstraklasa",
  "Romania Liga I": "Liga I",
  "Rep. Ireland Premier Division": "League of Ireland Premier Division",

  // Beyond Europe.
  "USA Major League Soccer": "MLS",
  "Australia A-League": "A-League",
  "Argentina Primera División": "Argentine Primera División",
  "Korea K League 1": "K League 1",
  "China Super League": "Chinese Super League",

  // The women's game, managed on the same terms as the men's.
  "England WSL": "Women's Super League",
  "USA NWSL": "NWSL",
  "Germany Frauen-Bundesliga": "Frauen-Bundesliga",
  "Spain Liga F Femenina": "Liga F",
  "France Division 1 Féminine": "Division 1 Féminine",
};

/** The save marks the tier with a trailing " (n)" on the name. It is noise in a label. */
const TIER_SUFFIX_RE = /\s*\(\d+\)$/;

/** Trim, and drop a trailing tier marker. Null for a name that is absent or effectively empty. */
function normaliseLeagueName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(TIER_SUFFIX_RE, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The save's name for a competition, in this app's vocabulary, or null when there is no name that can
 * be rendered honestly. See `leagueLabel` for what a null becomes on screen.
 */
export function resolveLeagueName(raw: string | null | undefined): string | null {
  const normalised = normaliseLeagueName(raw);
  if (normalised === null) return null;
  return LEAGUE_DISPLAY_NAMES[normalised] ?? normalised;
}

/**
 * The label for a league, in order of what is actually known:
 *
 *   1. this app's name for the competition, when the save named it and we have an entry;
 *   2. the save's own name (tier suffix dropped) when the save named it and we have no entry;
 *   3. `League ID <n>` when the save never named it - an unresolved key, said plainly;
 *   4. an em dash when there is no league id either.
 */
export function leagueLabel(name: string | null, leagueId: number | null): string {
  return resolveLeagueName(name) ?? (leagueId !== null ? `League ID ${leagueId}` : "—");
}
