/**
 * Club signing cultures.
 *
 * A handful of real clubs have identity rules that change what a move even means, and a scouting
 * panel that scores a target 100% on need, age and tactical fit without mentioning that his club only
 * signs players of a particular background is answering a question nobody asked.
 *
 * THE IMPORTANT PART IS WHAT THIS DOES NOT DO.
 *
 * The obvious implementation is a filter: "Bilbao only sign Basque players, so exclude anyone who is
 * not Spanish". That filter would be WRONG, and the club's own squad proves it. Athletic Bilbao's rule
 * is territorial - native to, or trained in, the greater Basque Country - not national. Their current
 * squad includes Iñaki Williams (Ghana, born in Bilbao), Álvaro Djaló (Guinea-Bissau), Maroan Sannadi
 * (Morocco) and Johaneko Louis-Jean (France). A nationality filter would have excluded every one of
 * them while happily admitting any Spanish player from Seville.
 *
 * The save carries no birthplace-earliest-club trail, so the rule is NOT TESTABLE from what we hold.
 *
 * That is the finding of a survey of every major European league, not an assumption: see
 * LEAGUE_CULTURE_SURVEY below. There is exactly ONE continuously-enforced heritage signing rule in
 * top-division European football today, and it is Athletic Bilbao's. Everything else that gets called
 * a club identity is a cantera culture, a buy-young/sell-high financial model, or corporate ownership -
 * none of which decides who a club may sign, so none of which belongs in this file as a rule.
 *
 * So these entries produce a NOTE, never a filter and never a veto. They tell the manager something
 * true that the numbers cannot see. A run that genuinely wants to enforce a rule needs the manager to
 * state it, because only he knows which version of it he is playing.
 */

export type CultureKind =
  /** A rule the club enforces today on who may play for it. */
  | "IDENTITY_RULE"
  /** A real rule that has since been abandoned. Kept only so pre-abandonment seasons read right. */
  | "HISTORICAL";

export interface ClubCulture {
  /** The club's own one-line identity, shown verbatim. */
  label: string;
  /** The rule as the club states it. */
  rule: string;
  kind: CultureKind;
  /** The year the practice ended, or null while it remains in force. */
  ended: string | null;
  /**
   * Whether the app can decide compliance from the save. False for every entry below, deliberately -
   * see the note at the top of this file. Kept as a field so a future, testable rule can say so.
   */
  testable: boolean;
  /** Appended to the Realism explanation for any target at this club. */
  note: string;
}

/**
 * Keyed by a normalised club name, because the save's wording varies between competitions.
 *
 * Deliberately short. A long list would look like thoroughness and would actually be a list of clubs
 * with a STYLE, and a style cannot be wrong about a player. Only two entries describe something a
 * transfer has to reckon with.
 */
export const CLUB_CULTURES: Readonly<Record<string, ClubCulture>> = {
  "athletic bilbao": {
    label: "Cantera policy",
    rule: "Only players born in, or football-trained in, the greater Basque Country may play for the club.",
    kind: "IDENTITY_RULE",
    ended: null,
    testable: false,
    // Written with "their" rather than the club's name, because this always follows a sentence that
    // has already named the club. The version that said "Bilbao... Bilbao are the one club..." read
    // like two facts stapled together rather than one thought.
    note: "Their policy restricts them to Basque-trained players, and the save does not record where a player came from - so treat any move for one of theirs as unlikely to be entertained, whatever the fee.",
  },
  "real sociedad": {
    label: "Basque tradition",
    rule: "Basque-only from 1962 until 1989; still Basque-heavy by tradition rather than by rule.",
    kind: "IDENTITY_RULE",
    ended: null,
    testable: false,
    note: "Their squad leans Basque by tradition, which makes it harder to buy out of than their league position suggests. The binding part of that policy ended in 1989, so this is a tendency rather than a wall.",
  },
};

/**
 * The survey that produced the two entries above.
 *
 * Recorded because the population of this list is the interesting fact, and because "we did not check"
 * and "we checked and there is nothing" are different answers that a future reader cannot tell apart
 * from an empty list.
 *
 * KEYED BY THE LEAGUES THE GAME ACTUALLY SHIPS, taken from the `leagues` table rather than from a list
 * of leagues that exist in the world. An earlier version of this survey covered Russia, Ukraine,
 * Greece, Croatia, Serbia, Czechia and Hungary - none of which are in the game, so every line about
 * them was unreadable advice about a division no manager can be in. The leagues absent from this
 * record are absent because the save has no such league, not because they were skipped.
 *
 * The rules that were found in the wider search but deliberately EXCLUDED, and why:
 * - Rangers (Scotland): would not knowingly sign a Catholic until July 1989, when Graeme Souness
 *   signed Mo Johnston. An unwritten practice, never a formal rule, and gone for 35 years - it cannot
 *   apply to a modern save and religion is not in the database.
 * - Celtic (Scotland): often cited as the reciprocal case. Unproven - Celtic's Catholic roots are
 *   communal and historical, and no documented bar on signing was found. Excluded as unverifiable.
 * - Beitar Jerusalem (Israel): the only major Israeli club never to have signed an Arab player. A de
 *   facto practice rather than a policy, loosened since 2013, based on ethnicity, and Israel is not a
 *   league in this game.
 * - Shakhtar Donetsk (Ukraine) and the Russian clubs: Brazilian-attacker patterns and local-player
 *   quotas, neither of which applies to a league the game ships.
 * - Bundesliga 50+1: an ownership and voting-rights clause in the league's licensing rules. It has no
 *   bearing on who a club signs and must never be used as a transfer signal.
 * - The Turkish foreign-player limit: a federation rule that binds every club in the Süper Lig
 *   equally. It is a property of the LEAGUE, so modelling it as club identity would wrongly single out
 *   individual clubs - and Süper Lig IS in the game, so this one is live rather than academic.
 */
export const LEAGUE_CULTURE_SURVEY: Readonly<Record<string, string>> = {
  "Spain Primera División":
    "Athletic Club de Bilbao hold the only hard, currently-enforced identity rule in European football. Real Sociedad held the same rule from 1962 to 1989 and still lean Basque by tradition. Osasuna and Eibar have Basque-heavy squads as a budget and cantera effect, not a rule.",
  "Spain Segunda División":
    "None. Basque-heavy squads below the top flight reflect where those players come from rather than a policy.",
  "England Premier League":
    "None. Brentford's analytics model and Brighton's buy-to-sell cycle are operating structures, not rules about who may play for them.",
  "England Championship": "None.",
  "England League One": "None.",
  "England League Two": "None.",
  "Germany 1. Bundesliga":
    "None. No club restricts who it signs. The 50+1 rule governs ownership voting rights, not recruitment.",
  "Germany 2. Bundesliga": "None.",
  "Germany 3. Liga": "None.",
  "Italy Serie A":
    "None. Atalanta's and Sassuolo's academy-first identities are sporting preferences that have never barred a signing.",
  "Italy Serie B": "None.",
  "France Ligue 1": "None. Monaco's and Lyon's young-player models are financial strategy.",
  "France Ligue 2": "None.",
  "Holland Eredivisie":
    "None. Ajax's academy-first culture is a preference; they have always bought players as well as produced them.",
  "Portugal Primeira Liga":
    "None. The big three's buy-low/sell-high cycle is a business model rather than an identity.",
  "Belgium Pro League": "None verified.",
  "Scotland Premiership":
    "Historical only, and outside a modern save. Rangers would not knowingly sign a Catholic until 1989; Celtic's Catholic identity was communal and never a documented bar.",
  "Turkey Süper Lig":
    "None at club level. The foreign-player limit is a federation rule binding every club in the division equally, so it is not club identity.",
  "Austria Bundesliga":
    "None. The RB group's young-player focus at Salzburg is a group strategy, not a rule.",
  "Switzerland Super League": "None verified.",
  "Denmark Superliga": "None verified.",
  "Norway Eliteserien": "None verified.",
  "Sweden Allsvenskan": "None verified.",
  "Poland Ekstraklasa": "None verified.",
  "Romania Liga I": "None verified.",
  "Rep. Ireland Premier Division": "None verified.",
  "Argentina Primera División":
    "None verified. The big clubs' youth-development identities are preferences, not signing restrictions.",
  "Australia A-League": "None verified.",
  "China Super League": "None verified.",
  "Indian Super League": "None verified.",
  "Korea K League 1": "None verified.",
  "Saudi Pro League": "None verified.",
  "USA Major League Soccer": "None verified.",
};

/** Lowercased, punctuation-stripped key so "FC Barcelona" and "Barcelona" cannot both miss. */
function normalise(clubName: string): string {
  return clubName
    .toLowerCase()
    .replace(/\b(fc|cf|cd|ac|afc|sc|club|de|the)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The culture for a club, if it has one worth mentioning.
 *
 * Matches on the normalised name and falls back to a contains-check, because the save writes club
 * names differently across competitions ("Athletic Club" here, "Athletic Bilbao" there).
 */
export function clubCultureOf(clubName: string | null | undefined): ClubCulture | null {
  if (!clubName) return null;
  const key = normalise(clubName);
  if (key === "") return null;
  const direct = CLUB_CULTURES[key];
  if (direct) return direct;
  for (const [candidate, culture] of Object.entries(CLUB_CULTURES)) {
    if (key.includes(candidate) || candidate.includes(key)) return culture;
  }
  return null;
}
