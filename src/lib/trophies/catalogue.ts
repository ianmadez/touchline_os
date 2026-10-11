/**
 * Which trophies exist, per country, and what to call their artwork.
 *
 * TWO SOURCES, and the split is deliberate.
 *
 * The LEAGUES are not listed here. The save's own catalogue already names every competition it ships,
 * with the country and the tier on each row, so the cabinet reads them from there. That is why this
 * file has no Premier League in it, and why a league the game adds later needs no change here.
 *
 * The CUPS are listed here, because the save does NOT name them. Measured on a real career: the
 * three domestic cups of the nations in that world appear in the save's competition table with an
 * EMPTY name (they are localised in the game, not stored), and `career_competitionprogress` is empty,
 * so nothing in the file can tell us a cup is called the FA Cup. The names and the tiers below are
 * therefore first-party reference data, written the way the games themselves present them. They are
 * editable in one place on purpose.
 *
 * Cups are also never auto-detected, by design: a cup win is something the manager reports at the end
 * of a season, and the cabinet shows the competitions he can win so he can say so. A cup the game
 * ships but that is missing below costs nothing except one line in this table.
 *
 * THE KEY IS THE ARTWORK FILENAME. `key` doubles as the `<slug>` in `/trophies/<slug>.png`, so the
 * cabinet, the database and the artwork can never drift apart. League keys are `league-<saveId>`
 * because the save's own id is the only stable identifier a league has.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS LIST WAS AUDITED AGAINST (2026-10-12)
 *
 * THE TRAP IS THE WORD "LICENSED". A licensed-competitions list (25 competitions in FC 25, 27 in FC 26)
 * is about BRANDING and trophy presentation, not about which cups are played. The KNVB Beker is on
 * neither list and is still played in career mode, which is measurable from any Ajax career. So a cup the
 * game does not license is still a cup a manager can win, and this table keeps it. Pruning by "not
 * licensed" would have deleted most of the list and been wrong.
 *
 * Two kinds of evidence were used instead, in this order:
 *
 *   1. THE SAVE'S OWN COMPETITION TABLE. `competition` carries no names - 169 rows of adboards, badges
 *      and colours, measured with `scripts/probe-competition-names.ts` - but it binds a competition to a
 *      country, and for England that binding is EXACTLY four: the FA Cup, the EFL Cup, the EFL Trophy and
 *      the Community Shield. The same save's `career_competitionprogress` shows the club entering four
 *      competitions in its League One season (league + FA Cup + EFL Cup + EFL Trophy) and three in the
 *      Championship, which is how those four were identified rather than assumed.
 *   2. THE GAMES' OWN COMPETITION LISTS, for what a save cannot show. That check is what found the two
 *      competitions this file had been MISSING: the UEFA Super Cup and the CONMEBOL Recopa.
 *
 * DROPPED, each with its reason, because offering a trophy the game cannot award is worse than a missing
 * line:
 *
 *   - FIFA Confederations Cup: discontinued after 2017, and in no modern title.
 *   - FIFA Club World Cup: not a career competition in FC 25 or FC 26. EA's Club World Cup content is in
 *     FC Mobile, a different game.
 *   - UEFA Nations League: not in the game. UEFA's competitions there are the Champions League, the
 *     Europa League, the Conference League, the Super Cup and the European Championship.
 *   - Supercopa de España: on no competition list for either title, and one of the competitions
 *     third-party career-mode overhauls add. The COPA DEL REY stays, because a La Liga career plays it.
 *
 * If a manager wins something that is not below, adding one line to this table is the whole cost, and it
 * is deliberately lower than the cost of offering him a competition his game does not run.
 */

export type TrophyKind = "LEAGUE" | "DOMESTIC_CUP" | "CONTINENTAL" | "INTERNATIONAL";

/** A confederation, which is what decides the continental competitions a club can enter. */
export type Region = "UEFA" | "CONMEBOL" | "AFC" | "CONCACAF";

export interface CupDefinition {
  /** Stable key, and the artwork filename stem. Never change one without renaming the artwork. */
  key: string;
  name: string;
  /**
   * The league tiers that can enter it. Null means every tier can, which is true of a nation's main
   * cup. A competition only the top division enters is `[1]`, and a lower-league cup is `[3, 4]`.
   */
  openToTiers: readonly number[] | null;
}

/**
 * Domestic cups per nation id, matching the ids the save uses for `leagues.country_id` and for a
 * player's nationality, so the two need no translation.
 *
 * Only the nations the save's league catalogue actually covers are here. Women's competitions are
 * deliberately absent: this cabinet follows the men's career.
 */
const DOMESTIC_CUPS: Record<number, readonly CupDefinition[]> = {
  14: [
    { key: "fa-cup", name: "FA Cup", openToTiers: null },
    { key: "efl-cup", name: "EFL Cup", openToTiers: [1, 2, 3, 4] },
    { key: "efl-trophy", name: "EFL Trophy", openToTiers: [3, 4] },
    { key: "community-shield", name: "Community Shield", openToTiers: [1] },
  ],
  45: [
    // The Supercopa de España is NOT here: it is on no competition list for FC 25 or FC 26, and it is one
    // of the competitions third-party career overhauls add. See the audit note at the top of this file.
    { key: "copa-del-rey", name: "Copa del Rey", openToTiers: null },
  ],
  21: [
    { key: "dfb-pokal", name: "DFB-Pokal", openToTiers: null },
    { key: "dfl-supercup", name: "DFL-Supercup", openToTiers: [1, 2] },
  ],
  27: [
    { key: "coppa-italia", name: "Coppa Italia", openToTiers: null },
    { key: "supercoppa-italiana", name: "Supercoppa Italiana", openToTiers: [1] },
  ],
  18: [
    { key: "coupe-de-france", name: "Coupe de France", openToTiers: null },
    { key: "trophee-des-champions", name: "Trophée des Champions", openToTiers: [1, 2] },
  ],
  34: [{ key: "knvb-beker", name: "KNVB Beker", openToTiers: null }],
  38: [
    { key: "taca-de-portugal", name: "Taça de Portugal", openToTiers: null },
    { key: "taca-da-liga", name: "Taça da Liga", openToTiers: [1, 2] },
  ],
  7: [{ key: "belgian-cup", name: "Belgian Cup", openToTiers: null }],
  48: [{ key: "turkish-cup", name: "Turkish Cup", openToTiers: null }],
  42: [
    { key: "scottish-cup", name: "Scottish Cup", openToTiers: null },
    { key: "scottish-league-cup", name: "Scottish League Cup", openToTiers: null },
  ],
  4: [{ key: "austrian-cup", name: "Austrian Cup", openToTiers: null }],
  47: [{ key: "swiss-cup", name: "Swiss Cup", openToTiers: null }],
  13: [{ key: "danish-cup", name: "Danish Cup", openToTiers: null }],
  36: [{ key: "norwegian-cup", name: "Norwegian Cup", openToTiers: null }],
  46: [{ key: "svenska-cupen", name: "Svenska Cupen", openToTiers: null }],
  37: [{ key: "polish-cup", name: "Polish Cup", openToTiers: null }],
  39: [{ key: "cupa-romaniei", name: "Cupa României", openToTiers: null }],
  25: [{ key: "fai-cup", name: "FAI Cup", openToTiers: null }],
  95: [
    { key: "us-open-cup", name: "US Open Cup", openToTiers: null },
    { key: "mls-cup", name: "MLS Cup", openToTiers: [1] },
  ],
  52: [{ key: "copa-argentina", name: "Copa Argentina", openToTiers: null }],
  155: [{ key: "chinese-fa-cup", name: "Chinese FA Cup", openToTiers: null }],
  167: [{ key: "korean-fa-cup", name: "Korean FA Cup", openToTiers: null }],
  183: [{ key: "king-cup", name: "King Cup", openToTiers: null }],
  195: [{ key: "australia-cup", name: "Australia Cup", openToTiers: null }],
  159: [{ key: "indian-super-cup", name: "Indian Super Cup", openToTiers: null }],
};

/**
 * The continental competitions, per confederation.
 *
 * The tier lists are a JUDGEMENT, and the only one in this file. In reality a European place comes from
 * a league finish OR from winning a domestic cup, and the domestic cups are open to every tier, so
 * "reachable" is not strictly a tier question at all. What is modelled here is the route a manager
 * actually has: the Champions League needs a top-division finish, while the Europa and Conference
 * Leagues are reachable from the second tier through the cups that carry a place. Lower divisions see
 * none of them in the "my division" view, which is the honest answer for a club that would have to win
 * a major cup to get there.
 */
const CONTINENTAL: Record<Region, readonly CupDefinition[]> = {
  UEFA: [
    { key: "ucl", name: "UEFA Champions League", openToTiers: [1] },
    { key: "uel", name: "UEFA Europa League", openToTiers: [1, 2] },
    { key: "uecl", name: "UEFA Conference League", openToTiers: [1, 2] },
    // Played by the Champions League winner against the Europa League winner, and licensed in both FC 25
    // and FC 26. It was missing from this file until the audit.
    { key: "uefa-super-cup", name: "UEFA Super Cup", openToTiers: [1] },
  ],
  CONMEBOL: [
    { key: "libertadores", name: "CONMEBOL Libertadores", openToTiers: [1] },
    { key: "sudamericana", name: "CONMEBOL Sudamericana", openToTiers: [1, 2] },
    // The Libertadores winner against the Sudamericana winner. Licensed in both titles, and the save's own
    // competition table carries it under its CONMEBOL group, so it was missing rather than absent.
    { key: "recopa-sudamericana", name: "CONMEBOL Recopa", openToTiers: [1, 2] },
  ],
  AFC: [
    // The current names, renamed by the confederation in 2024-25: the AFC Champions League became the
    // Champions League Elite and the AFC Cup became the Champions League Two. The JSON keys stay as they
    // are so the artwork filenames do not move.
    { key: "afc-champions-league", name: "AFC Champions League Elite", openToTiers: [1] },
    { key: "afc-cup", name: "AFC Champions League Two", openToTiers: [1, 2] },
  ],
  CONCACAF: [{ key: "concacaf-champions-cup", name: "CONCACAF Champions Cup", openToTiers: [1] }],
};

/** Which confederation each playable nation belongs to, so its continental entries can be found. */
const REGION_OF_NATION: Record<number, Region> = {
  14: "UEFA", 45: "UEFA", 21: "UEFA", 27: "UEFA", 18: "UEFA", 34: "UEFA", 38: "UEFA",
  7: "UEFA", 48: "UEFA", 42: "UEFA", 4: "UEFA", 47: "UEFA", 13: "UEFA", 36: "UEFA",
  46: "UEFA", 37: "UEFA", 39: "UEFA", 25: "UEFA",
  52: "CONMEBOL",
  95: "CONCACAF",
  155: "AFC", 167: "AFC", 183: "AFC", 195: "AFC", 159: "AFC",
};

/**
 * The international competitions, for a manager who takes a national job.
 *
 * Club management and international management are the same career file, and a manager who wins a World Cup
 * should be able to say so. These are never auto-detected - nothing in a club save records a national-team
 * result - so they are offered the way a cup is: the manager records the win and the cabinet keeps it.
 *
 * The keys are the artwork filenames, exactly as the club cups are.
 *
 * The FIFA Confederations Cup, the FIFA Club World Cup and the UEFA Nations League are deliberately NOT
 * here: none of them is a competition in a modern title. The audit note at the top of this file has the
 * reasoning, and a confederation's flagship tournament stays even though only its winner's own save would
 * ever show it.
 */
const INTERNATIONAL: readonly CupDefinition[] = [
  { key: "fifa-world-cup", name: "FIFA World Cup", openToTiers: null },
  { key: "euro", name: "UEFA European Championship", openToTiers: null },
  { key: "copa-america", name: "Copa America", openToTiers: null },
  { key: "afcon", name: "Africa Cup of Nations", openToTiers: null },
  { key: "afc-asian-cup", name: "AFC Asian Cup", openToTiers: null },
  { key: "concacaf-gold-cup", name: "CONCACAF Gold Cup", openToTiers: null },
];

/** The artwork file one trophy looks for. The key IS the filename, so the two cannot drift. */
export function trophyArtworkPath(key: string): string {
  return `/trophies/${key}.png`;
}

export function domesticCupsFor(countryId: number | null): readonly CupDefinition[] {
  if (countryId === null) return [];
  return DOMESTIC_CUPS[countryId] ?? [];
}

export function continentalFor(countryId: number | null): readonly CupDefinition[] {
  if (countryId === null) return [];
  const region = REGION_OF_NATION[countryId];
  return region ? CONTINENTAL[region] : [];
}

/** True when a club in that division could enter it. Null means everybody can. */
export function isOpenToTier(definition: CupDefinition, tier: number | null): boolean {
  if (definition.openToTiers === null) return true;
  if (tier === null) return false;
  return definition.openToTiers.includes(tier);
}

/** Every international competition the cabinet can hold, whether or not the manager has one. */
export function internationalTrophies(): readonly CupDefinition[] {
  return INTERNATIONAL;
}

/** True when a key belongs to the international set, so a screen can file it under its own heading. */
export function isInternationalKey(key: string): boolean {
  return INTERNATIONAL.some((competition) => competition.key === key);
}

/** Every cup a manager in this country could win, tiers ignored. Used by the "whole country" view. */
export function allCupsFor(countryId: number | null): readonly CupDefinition[] {
  return [...domesticCupsFor(countryId), ...continentalFor(countryId)];
}

/** The nations this catalogue knows a cup list for. Used by the checks script. */
export function knownCupNations(): number[] {
  return Object.keys(DOMESTIC_CUPS).map(Number).sort((a, b) => a - b);
}

/**
 * Every key the catalogue defines, once each.
 *
 * Flat over the nations and the confederations, so a shared competition (the Champions League is offered
 * to every European nation) appears once. This is the list of artwork filenames the cabinet can ask for,
 * which is what makes it useful to a script or to anyone gathering the images.
 */
export function catalogueKeys(): string[] {
  const keys = new Set<string>();
  for (const cups of Object.values(DOMESTIC_CUPS)) {
    for (const cup of cups) keys.add(cup.key);
  }
  for (const cups of Object.values(CONTINENTAL)) {
    for (const cup of cups) keys.add(cup.key);
  }
  for (const competition of INTERNATIONAL) keys.add(competition.key);
  return [...keys].sort();
}

/** Every definition the catalogue holds, once each, in the same spirit as `catalogueKeys`. */
export function catalogueCups(): readonly CupDefinition[] {
  const byKey = new Map<string, CupDefinition>();
  for (const cups of Object.values(DOMESTIC_CUPS)) {
    for (const cup of cups) byKey.set(cup.key, cup);
  }
  for (const cups of Object.values(CONTINENTAL)) {
    for (const cup of cups) byKey.set(cup.key, cup);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
