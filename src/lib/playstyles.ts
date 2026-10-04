/**
 * Manager playstyles: the identity a manager plays the save with.
 *
 * These are not difficulty settings and they are not filters. They are the answer to "what kind of
 * squad am I building", and they exist because a career with no stated identity makes every scout
 * report equally right and therefore useless. A moneyball manager and a veterans manager can look at
 * the same 26-year-old striker and both be correct - the difference is the rule they set themselves.
 *
 * The shape below is deliberate, and it is the same shape as `club-culture.ts`: a LABEL to show, a
 * RULE to state, and a NEEDS line recording what the app must actually be able to see for the
 * playstyle to be playable rather than decorative.
 *
 * That last field is the honest part. A playstyle whose criteria the save cannot supply is a label
 * that does nothing, and it is better to say so here than to ship a mode button that changes no
 * behaviour. Several entries below are partially or wholly unplayable today for exactly this reason,
 * and they say which part is missing.
 *
 * `OWN` is the default and it is a first-class choice, not an absence. A manager who has no fixed
 * rule should be able to say so, and the app should then judge players on merit instead of inventing
 * a constraint he never set.
 */

export type Playstyle =
  | "OWN"
  | "MONEYBALL"
  | "YOUTH_ONLY"
  | "YOUNG_SIGNINGS"
  | "FORGOTTEN_LEGENDS"
  | "VETERANS";

/**
 * What a playstyle asks of the app, in machine-readable form.
 *
 * Nulls mean "no constraint from this playstyle", which is different from a zero. `maxAge: null` on
 * VETERANS is not "sign nobody", it is "age is not what this playstyle restricts".
 */
export interface PlaystyleCriteria {
  /** Hard ceiling on a target's age. */
  maxAge: number | null;
  /** Hard floor. Used by the two veteran styles, which are about proven players. */
  minAge: number | null;
  /**
   * True when the style shops on value rather than on rating. Read by the scouting note, and the
   * signal a future ranking pass would weight on.
   */
  prefersValueEfficiency: boolean;
  /**
   * True when the playstyle EXPECTS its targets to be famous.
   *
   * This exists because of a direct conflict with Realism. Realism caps and vetoes any target whose
   * international reputation reaches the established bar, on the sound reasoning that a household
   * name does not drop to a smaller club. But a forgotten legend is precisely a household name who
   * has stopped being picked - the reputation is the whole point of the playstyle. Without this flag
   * the two features contradict each other and Forgotten legends returns an empty list forever.
   */
  toleratesEstablishedRep: boolean;
}

export interface PlaystyleDefinition {
  /** The name, shown verbatim. */
  label: string;
  /** Expanded name for places with room, e.g. a chip tooltip. */
  fullLabel: string;
  /** What it is, in one line. */
  blurb: string;
  /** The rule the manager is setting himself, stated as a constraint. */
  rule: string;
  /**
   * What the app must be able to see for this to be playable rather than decorative.
   *
   * Written as an honest audit, not an aspiration: if the save cannot supply it, it says so.
   */
  needs: string;
  /** Short line shown under the control in Settings and onboarding. */
  hint: string;
  criteria: PlaystyleCriteria;
}

const NO_CONSTRAINT: PlaystyleCriteria = {
  maxAge: null,
  minAge: null,
  prefersValueEfficiency: false,
  toleratesEstablishedRep: false,
};

export const PLAYSTYLES: readonly Playstyle[] = [
  "OWN",
  "MONEYBALL",
  "YOUTH_ONLY",
  "YOUNG_SIGNINGS",
  "FORGOTTEN_LEGENDS",
  "VETERANS",
];

export const PLAYSTYLE_DEFINITIONS: Record<Playstyle, PlaystyleDefinition> = {
  OWN: {
    label: "Own",
    fullLabel: "Your own",
    blurb: "No fixed rule. Players are judged on merit, not against an identity.",
    rule: "None. The app adds no constraint you did not ask for.",
    needs:
      "Nothing beyond what it already does. This is the default and it is the correct answer for most careers: inventing a constraint a manager never set is worse than having none.",
    hint: "No constraint beyond the ones you set yourself. Every target is judged on merit alone.",
    criteria: NO_CONSTRAINT,
  },

  MONEYBALL: {
    label: "Moneyball",
    fullLabel: "Moneyball",
    blurb:
      "Buy output rather than reputation: players whose numbers outrun their price, with resale value behind them.",
    rule: "Under 27, and only where the value band is cheap relative to what he produces.",
    needs:
      "Price against output, which the save supports: `world_players` carries a value band, an overall rating and an age, so value-per-rating is computable for every candidate. What it does NOT carry is per-90 output - no goals, assists, minutes or xG. So this playstyle can weigh price against RATING, which is a real proxy, but it cannot weigh price against production, and the difference is worth knowing before trusting it.",
    hint:
      "Favours cheap players with high ratings and resale value. Note the save has no goals or minutes, so this weighs price against rating, not output.",
    criteria: {
      maxAge: 26,
      minAge: null,
      prefersValueEfficiency: true,
      toleratesEstablishedRep: false,
    },
  },

  YOUTH_ONLY: {
    label: "Youth only",
    fullLabel: "Youth only",
    rule: "Nobody over 21 is signed. The first team is filled from your own academy.",
    blurb: "Build entirely from within. The transfer market is closed to you.",
    needs:
      "A real youth pipeline, which is Sequence 4 and is NOT built yet. `career_youthplayers` exists and holds 13 rows, but nothing decodes it, so today the Youth tab shows the world squad filtered to 21 or under rather than your actual academy. Until that decode lands this playstyle is a label: it can hide older targets, but it cannot show you the prospects you would be building around.",
    hint:
      "Hides every target over 21. Your academy intake is not decoded from the save yet, so this currently constrains the market without filling your squad from within.",
    criteria: {
      maxAge: 21,
      minAge: null,
      prefersValueEfficiency: false,
      toleratesEstablishedRep: false,
    },
  },

  YOUNG_SIGNINGS: {
    label: "Young signings",
    fullLabel: "Sign only youth",
    blurb: "You will buy, but only players young enough to grow into the side and be sold on.",
    rule: "Nobody over 23 is signed, whatever his rating.",
    needs:
      "Potential as well as ability, both of which the save carries: `potential_rating` is present for candidates, so a young target can be judged on the ceiling rather than the current number. Fully playable today.",
    hint: "Hides every target over 23. Prefer potential over present ability when two candidates are close.",
    criteria: {
      maxAge: 23,
      minAge: null,
      prefersValueEfficiency: false,
      toleratesEstablishedRep: false,
    },
  },

  FORGOTTEN_LEGENDS: {
    label: "Forgotten legends",
    fullLabel: "Forgotten legends",
    blurb:
      "Take players the big clubs have stopped picking: reputations far larger than their minutes, available cheaply.",
    rule: "Target 30 or over with a serious reputation who is not being played.",
    needs:
      "Reputation and age, both of which exist: `international_rep` is a 0-5 field on every world player, so fame is directly readable. What does NOT exist is minutes played, so 'has stopped being picked' cannot be verified - the app can find famous 30-somethings, but it cannot tell a frozen-out legend from a first-choice one. Treat the list as candidates to check, not as a shortlist.",
    hint:
      "Favours 30-plus players with a big reputation. Realism would normally rule these out, so this playstyle relaxes that rule for you.",
    criteria: {
      maxAge: null,
      minAge: 30,
      prefersValueEfficiency: true,
      // The one playstyle where the realism reputation veto has to stand down: the whole point is
      // signing players realism says would not come.
      toleratesEstablishedRep: true,
    },
  },

  VETERANS: {
    label: "Veterans",
    fullLabel: "Experienced squad",
    blurb: "Win now. Proven players in their late peak and beyond, with no interest in resale value.",
    rule: "Nobody under 28 is signed. Current ability matters, potential does not.",
    needs:
      "Age and current ability, both present. Fully playable. The honest caveat is that the age curve will score these targets down, and that is correct rather than a bug: this playstyle accepts a short window on purpose.",
    hint:
      "Favours 28-plus players and treats potential as irrelevant. The age curve will still score them down, which is the trade you are choosing.",
    criteria: {
      maxAge: null,
      minAge: 28,
      prefersValueEfficiency: false,
      toleratesEstablishedRep: false,
    },
  },
};

/**
 * How far each playstyle widens Realism's step tolerance.
 *
 * This exists because standing the reputation veto down was not enough, and the measurement is what
 * showed it: in this save there is no player at all with a reputation of 4 or more below a rating of
 * 79. Every famous player is also far above a Championship squad, so the RATING GAP is always the
 * binding constraint and the reputation flag never fires. Forgotten legends stayed an empty list.
 *
 * A playstyle whose entire premise is signing players above your level has to widen the band that
 * measures how far above your level a player is, or it cannot function. 3x the strict band is still
 * narrow - it admits a 12-point gap under STRICT_REALISM, not a 30-point one - and the manager chose
 * the playstyle, so this is his own rule loosening his own rule.
 */
export const PLAYSTYLE_TOLERANCE_MULTIPLIER: Record<Playstyle, number> = {
  OWN: 1,
  MONEYBALL: 1,
  YOUTH_ONLY: 1,
  YOUNG_SIGNINGS: 1,
  FORGOTTEN_LEGENDS: 3,
  VETERANS: 1,
};

/** Coerces any stored value into the current set, defaulting to OWN. */
export function normalisePlaystyle(raw: string | null | undefined): Playstyle {
  return PLAYSTYLES.includes(raw as Playstyle) ? (raw as Playstyle) : "OWN";
}

export function playstyleDefinition(playstyle: Playstyle): PlaystyleDefinition {
  return PLAYSTYLE_DEFINITIONS[playstyle];
}

/**
 * The line the scouting list prints about the current playstyle, or null for OWN.
 *
 * OWN returns null on purpose: a manager with no rule should not be told about a rule. Printing "Own:
 * no constraint" on every search would be noise dressed as information.
 */
export function playstyleScoutingNote(playstyle: Playstyle): string | null {
  if (playstyle === "OWN") return null;
  const definition = PLAYSTYLE_DEFINITIONS[playstyle];
  const bounds: string[] = [];
  if (definition.criteria.minAge !== null) bounds.push(`${definition.criteria.minAge} or over`);
  if (definition.criteria.maxAge !== null) bounds.push(`${definition.criteria.maxAge} or under`);
  const bound = bounds.length > 0 ? ` Target range: ${bounds.join(" and ")}.` : "";
  return `${definition.fullLabel}: ${definition.rule}${bound}`;
}
