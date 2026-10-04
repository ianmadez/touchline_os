/**
 * The four fit dimensions.
 *
 * This is the question the app exists to answer, and it is deliberately NOT part of the ranking.
 * Ranking says "who is best"; fit says "why him, for THIS squad, in THIS system, at THIS price".
 * They are separate because they can disagree: the highest-ranked player in the pool is almost never
 * the right signing for a League One side with one centre-mid and no money.
 *
 * Every dimension returns a 0-100 score AND the sentence explaining it. A percentage with no
 * derivation is a horoscope, so the explanation is not optional decoration - it is the part that
 * makes the number checkable against facts the manager can see for himself.
 *
 * The squad context is built ONCE per search and then each candidate costs O(1), because this runs
 * across the whole pool rather than a page of results.
 */

import type { RealismMode } from "../realism";
import { REALISM_ESTABLISHED_REP, REALISM_STEP_TOLERANCE, REALISM_VETOES_ENABLED } from "../realism";
import { clubCultureOf } from "../club-culture";
import {
  AGE_PAST,
  AGE_PRIME,
  ADVISORY_BLOCKER_HEADLINE,
  ADVISORY_PARTIAL_DETAIL,
  ADVISORY_PARTIAL_HEADLINE,
  ADVISORY_STRONG_HEADLINE,
  ADVISORY_UNJUDGEABLE_HEADLINE,
  ADVISORY_VETO_DETAIL,
  ADVISORY_VETO_HEADLINE,
  FINANCIAL_AFFORDABLE,
  FINANCIAL_CLOSE,
  FINANCIAL_MIDPOINT,
  FINANCIAL_NO_BUDGET,
  FINANCIAL_OUT_OF_REACH,
  FINANCIAL_STRETCH,
  FINANCIAL_UNPRICED,
  FINANCIAL_ZERO,
  REALISM_CULTURE,
  REALISM_ESTABLISHED,
  REALISM_FAR,
  REALISM_LARGE,
  REALISM_LEVEL,
  REALISM_STEP,
  say,
} from "../fit-copy";
import {
  PLAYSTYLE_DEFINITIONS,
  PLAYSTYLE_TOLERANCE_MULTIPLIER,
  type Playstyle,
} from "../playstyles";

/**
 * A stable per-player seed for the wording.
 *
 * Built from facts this module already holds rather than from the player id, so nothing new has to be
 * threaded through. Two players sharing all four would share wording, which does no harm: they would
 * read identically in every other sentence on the panel too.
 */
function seedOf(candidate: FitCandidate): string {
  return [candidate.clubName ?? "", candidate.primaryPosition, candidate.age, candidate.overallRating].join("|");
}

export type FitKey = "TACTICAL" | "NEED" | "FINANCIAL" | "AGE" | "REALISM";

export interface FitDimension {
  key: FitKey;
  label: string;
  /** 0-100, or null when the dimension cannot be judged from what is known. */
  score: number | null;
  /** The one-line reason, naming the actual numbers behind the score. */
  explanation: string;
  /**
   * True when this dimension ALONE makes the move impossible, whatever the other three say.
   *
   * A score of zero and a veto are different claims: zero means "this is bad", a veto means "this does
   * not happen". Only Realism can set it, and the advisory has to name it before anything else.
   */
  disqualifying?: boolean;
}

export interface FitAdvisory {
  headline: string;
  detail: string;
  tone: "GOOD" | "MIXED" | "POOR";
}

export interface PlayerFit {
  dimensions: FitDimension[];
  /** Equally weighted mean of the dimensions that could be judged. Null if none could. */
  overall: number | null;
  advisory: FitAdvisory;
}

/** Only what the fit needs, so callers can pass a squad row or a pool row interchangeably. */
export interface FitSquadPlayer {
  primaryPosition: string;
  overallRating: number;
  potentialRating: number | null;
  age: number | null;
  assignedRole?: string | null;
}

export interface FitCandidate {
  primaryPosition: string;
  overallRating: number | null;
  potentialRating: number | null;
  age: number | null;
  /** The band midpoint, used for Financial Fit. Null when no band could be formed. */
  valueMid: number | null;
  /** The band top, so "affordable" means the pessimistic end fits, matching the search filter. */
  valueHigh: number | null;
  /** Named in the Realism explanation, because "he plays for Barcelona" says more than a rating. */
  clubName?: string | null;
  /** The save's 0-5 international reputation. Above the stated bar, a move down simply does not happen. */
  internationalRep?: number | null;
}

export interface SquadContext {
  /** How many slots the active formation gives each role. */
  demand: Map<string, number>;
  /** How many squad players can cover each role, counting a manager's manual role assignment. */
  supply: Map<string, number>;
  /** Every rating at each position, descending. Used for the "is he an upgrade" line. */
  ratingsByPosition: Map<string, number[]>;
  /** Best potential on the books at each position. */
  potentialByPosition: Map<string, number>;
  /** Roles the active formation wants but the squad cannot cover twice. */
  gaps: Array<{ role: string; have: number; want: number }>;
  /** True when a formation was available to judge against. */
  hasFormation: boolean;
  /** Your squad's average senior rating - the line Realism measures a target against. */
  averageRating: number | null;
  /** The manager's realism level, already collapsed to its strictness band. */
  mode: RealismMode;
  /**
   * The manager's run identity. Only Realism reads it, and only to decide whether a famous target is
   * a reason to rule a move out or the whole point of the move.
   */
  playstyle: Playstyle;
}

/**
 * Where a position's value peaks, in years.
 *
 * A single global age curve would say a 30-year-old is a 30-year-old, which is exactly wrong here:
 * keepers and centre-backs are entering their best years at 30 while a winger is leaving his. The
 * window is `peak - 3` to `peak + 1`, which is the span managers actually treat as "now".
 */
const POSITION_PEAK_AGE: Record<string, number> = {
  GK: 30,
  SW: 29,
  CB: 28,
  LB: 26,
  RB: 26,
  LWB: 26,
  RWB: 26,
  CDM: 27,
  CM: 26,
  LM: 26,
  RM: 26,
  CAM: 26,
  LW: 25,
  RW: 25,
  CF: 26,
  ST: 26,
  SUB: 26,
};

/** Positions the app could not map from the save are judged as unknown, never assumed. */
const UNKNOWN_PEAK_AGE = 27;

/**
 * The rating at which a player is considered to be operating at a peak-window level already.
 *
 * This exists so age is never read on its own. 85 is the threshold where "young" stops meaning
 * "unfinished": below it, being short of the peak is a genuine readiness question; at or above it,
 * he is simply early.
 */
const ELITE_RATING = 85;

function peakAgeFor(position: string): number {
  return POSITION_PEAK_AGE[position.toUpperCase()] ?? UNKNOWN_PEAK_AGE;
}

/**
 * Reads the squad and the active formation into the shape the fit needs.
 *
 * `demand` is how many slots the formation gives a role; `supply` is how many players can actually
 * play it. A gap is where supply < demand, which is the same rule the dashboard's structural
 * vulnerability storyline uses - deliberately, so the scout and the dashboard cannot disagree about
 * what "short" means.
 */
export function buildSquadContext(
  squad: readonly FitSquadPlayer[],
  formationSlots: readonly { role: string }[] | null,
  /** Defaults to the more permissive band: an unknown level relaxes, it never tightens. */
  mode: RealismMode = "RELAXED",
  playstyle: Playstyle = "OWN"
): SquadContext {
  const demand = new Map<string, number>();
  const supply = new Map<string, number>();
  const ratingsByPosition = new Map<string, number[]>();
  const potentialByPosition = new Map<string, number>();

  for (const slot of formationSlots ?? []) {
    const role = (slot.role || "").toUpperCase();
    if (!role) continue;
    demand.set(role, (demand.get(role) ?? 0) + 1);
  }

  for (const player of squad) {
    const position = (player.primaryPosition || "").toUpperCase();
    if (!position) continue;

    // A manager's manual role assignment is real cover, so it counts - the same rule the dashboard
    // applies when it decides whether a role is thin.
    const coverable = new Set<string>([position]);
    const assigned = (player.assignedRole || "").toUpperCase();
    if (assigned) coverable.add(assigned);
    for (const role of coverable) {
      supply.set(role, (supply.get(role) ?? 0) + 1);
    }

    const list = ratingsByPosition.get(position) ?? [];
    list.push(player.overallRating);
    ratingsByPosition.set(position, list);

    const potential = player.potentialRating ?? player.overallRating;
    if (potential > (potentialByPosition.get(position) ?? 0)) {
      potentialByPosition.set(position, potential);
    }
  }

  for (const list of ratingsByPosition.values()) list.sort((a, b) => b - a);

  const gaps: Array<{ role: string; have: number; want: number }> = [];
  for (const [role, want] of demand) {
    const have = supply.get(role) ?? 0;
    if (have < want) gaps.push({ role, have, want });
  }
  gaps.sort((a, b) => a.have - b.have || a.role.localeCompare(b.role));

  const averageRating =
    squad.length === 0
      ? null
      : Math.round(squad.reduce((total, player) => total + player.overallRating, 0) / squad.length);

  return {
    demand,
    supply,
    ratingsByPosition,
    potentialByPosition,
    gaps,
    hasFormation: demand.size > 0,
    averageRating,
    mode,
    playstyle,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Tactical Fit: does the system want this role, and is it thin?
 *
 * The scores are a stated ladder rather than a continuous curve, because the underlying facts are
 * discrete - you either have cover or you do not - and a smooth curve would imply a precision the
 * squad list cannot support.
 */
function tacticalFit(context: SquadContext, candidate: FitCandidate): FitDimension {
  const position = (candidate.primaryPosition || "").toUpperCase();
  const label = "Tactical fit";

  if (!context.hasFormation) {
    return {
      key: "TACTICAL",
      label,
      score: null,
      explanation: "No active formation to judge against, so tactical fit cannot be scored.",
    };
  }

  const want = context.demand.get(position) ?? 0;
  const have = context.supply.get(position) ?? 0;

  if (want === 0) {
    return {
      key: "TACTICAL",
      label,
      score: 20,
      explanation: `Your system fields no ${position}, so he would be a body without a slot.`,
    };
  }

  if (have < want) {
    const short = want - have;
    return {
      key: "TACTICAL",
      label,
      score: have === 0 ? 100 : 88,
      explanation:
        `Fills a real gap: your system wants ${want} at ${position} and you have ${have}.` +
        (short > 1 ? ` He would not close it alone - you are still ${short - 1} short after him.` : ""),
    };
  }

  return {
    key: "TACTICAL",
    label,
    score: 55,
    explanation: `Covered already: your system wants ${want} at ${position} and you have ${have}. He would add quality, not numbers.`,
  };
}

/**
 * Squad Need: how much better than what is actually on the books.
 *
 * Measured against the SECOND-best player at the position, not the best. A signing only changes a
 * team if he improves the weakest of the two who would otherwise play, so beating the first-choice
 * player is worth less than the raw rating gap suggests.
 */
function needFit(context: SquadContext, candidate: FitCandidate): FitDimension {
  const position = (candidate.primaryPosition || "").toUpperCase();
  const label = "Squad need";
  const ratings = context.ratingsByPosition.get(position) ?? [];

  if (candidate.overallRating === null) {
    return {
      key: "NEED",
      label,
      score: null,
      explanation: "The save carries no rating for him, so his place in the pecking order is unknown.",
    };
  }

  if (ratings.length === 0) {
    return {
      key: "NEED",
      label,
      score: 100,
      explanation: `Nobody in your squad plays ${position}, so he would be the first.`,
    };
  }

  const depthLine = ratings.length >= 2 ? ratings[1] : ratings[0];
  const delta = candidate.overallRating - depthLine;
  const bestPotential = context.potentialByPosition.get(position) ?? 0;
  const hisPotential = candidate.potentialRating ?? candidate.overallRating;

  // Stated ladder on the rating delta against the depth line.
  let score: number;
  if (delta >= 5) score = 100;
  else if (delta >= 3) score = 90;
  else if (delta >= 1) score = 78;
  else if (delta === 0) score = 62;
  else if (delta >= -2) score = 42;
  else if (delta >= -5) score = 25;
  else score = 10;

  // Potential can lift a younger player who is not yet ahead, but only by one band, and never into
  // the top band: being good later is not the same as being good now.
  let potentialNote = "";
  if (hisPotential > bestPotential && hisPotential - bestPotential >= 3) {
    score = Math.min(90, score + 12);
    potentialNote = ` His ceiling (${hisPotential}) is above anything you have at ${position} (${bestPotential}).`;
  }

  const relation = delta > 0 ? `${delta} better than` : delta === 0 ? "level with" : `${Math.abs(delta)} below`;
  return {
    key: "NEED",
    label,
    score: clamp(score),
    explanation: `Rated ${candidate.overallRating}, ${relation} your second-best ${position} (${depthLine}).${potentialNote}`,
  };
}

/** Financial Fit: the same affordability verdict the search filters on, expressed as a score. */
function financialFit(
  candidate: FitCandidate,
  budget: number | null,
  symbol: string,
  seed: string
): FitDimension {
  const label = "Financial fit";

  if (budget === null) {
    return {
      key: "FINANCIAL",
      label,
      score: null,
      explanation: say(FINANCIAL_NO_BUDGET, seed, {}, 1),
    };
  }
  // A recorded zero is an ANSWER, not a missing value, and it needs its own sentence: "no budget
  // set" would tell a manager who just typed 0 that he typed nothing.
  if (budget === 0) {
    return {
      key: "FINANCIAL",
      label,
      score: 0,
      explanation: say(FINANCIAL_ZERO, seed, { symbol }, 2),
    };
  }
  if (candidate.valueHigh === null || candidate.valueMid === null) {
    return {
      key: "FINANCIAL",
      label,
      score: null,
      explanation: say(FINANCIAL_UNPRICED, seed, {}, 3),
    };
  }

  const format = (value: number) => `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  const vars = { mid: format(candidate.valueMid), high: format(candidate.valueHigh), budget: format(budget) };

  if (candidate.valueHigh <= budget) {
    return {
      key: "FINANCIAL",
      label,
      score: 100,
      explanation: say(FINANCIAL_AFFORDABLE, seed, vars, 4),
    };
  }
  if (candidate.valueMid <= budget) {
    return {
      key: "FINANCIAL",
      label,
      score: 62,
      explanation: say(FINANCIAL_MIDPOINT, seed, vars, 5),
    };
  }

  // Everything below is out of budget, and the score is graded by HOW FAR out rather than being a
  // flat zero. That flat zero was the loose application: a player whose band opened a shade above the
  // budget was scored the same as one costing four times as much, so both were labelled "the blocker"
  // and a deal that needed one instalment was described as impossible. The advisory calls something a
  // blocker at 25 or below, and only the genuinely distant band now lands there.
  const ratio = budget / candidate.valueMid;
  const scaled = { ...vars, ratio: (candidate.valueMid / budget).toFixed(1) };

  if (ratio >= 0.75) {
    return {
      key: "FINANCIAL",
      label,
      score: 58,
      explanation: say(FINANCIAL_CLOSE, seed, scaled, 6),
    };
  }
  if (ratio >= 0.4) {
    return {
      key: "FINANCIAL",
      label,
      score: 34,
      explanation: say(FINANCIAL_STRETCH, seed, scaled, 7),
    };
  }
  return {
    key: "FINANCIAL",
    label,
    score: 8,
    explanation: say(FINANCIAL_OUT_OF_REACH, seed, scaled, 8),
  };
}

/**
 * Age Fit: how close he is to the years the position actually rewards.
 *
 * Scored around the position's peak window rather than penalising youth generally, because a
 * 19-year-old winger and a 19-year-old centre-back are not the same proposition.
 */
function ageFit(context: SquadContext, candidate: FitCandidate): FitDimension {
  const position = (candidate.primaryPosition || "").toUpperCase();
  const label = "Age fit";
  const peak = peakAgeFor(position);
  const seed = seedOf(candidate);

  if (candidate.age === null) {
    return {
      key: "AGE",
      label,
      score: null,
      explanation: "The save carries no age for him, so his fit against the age curve is unknown.",
    };
  }

  const age = candidate.age;
  const windowStart = peak - 3;
  const windowEnd = peak + 1;

  if (age >= windowStart && age <= windowEnd) {
    return {
      key: "AGE",
      label,
      score: 100,
      explanation: say(AGE_PRIME, seed, { age, position, from: windowStart, to: windowEnd }, 23),
    };
  }

  if (age < windowStart) {
    const years = windowStart - age;
    const yearsText = `${years} year${years === 1 ? "" : "s"}`;
    const rating = candidate.overallRating;
    const best = context.ratingsByPosition.get(position)?.[0] ?? 0;

    // Being before the peak is only a concern if he is not good enough yet. Judging on age alone
    // called a 90-rated 19-year-old "not ready to carry it", which is the kind of answer that makes
    // every other number on the panel look invented. If he already operates at the level the window
    // is meant to REACH, the years before the peak are upside, not a wait.
    const alreadyElite = rating !== null && rating >= ELITE_RATING;
    const alreadyBest = rating !== null && rating > best;

    if (alreadyElite || alreadyBest) {
      return {
        key: "AGE",
        label,
        score: 100,
        explanation:
          `Age ${age}, ${yearsText} before the prime window for ${position} (${windowStart}-${windowEnd})` +
          (alreadyBest && best > 0
            ? ` - but at ${rating} he would already be the best you have there. The years before his peak are upside, not a wait.`
            : ` - and at ${rating} he is already at the level that window is meant to reach. Upside, not a wait.`),
      };
    }

    return {
      key: "AGE",
      label,
      score: years >= 4 ? 45 : 70,
      explanation: `${yearsText} short of the prime window for ${position} (${windowStart}-${windowEnd}), at ${rating ?? "an unknown rating"}. Room to grow, but not yet at the level your team needs.`,
    };
  }

  const years = age - windowEnd;
  return {
    key: "AGE",
    label,
    score: years >= 5 ? 20 : years >= 3 ? 40 : 62,
    explanation: say(
      AGE_PAST,
      seed,
      {
        years: `${years} year${years === 1 ? "" : "s"}`,
        position,
        from: windowStart,
        to: windowEnd,
      },
      24
    ),
  };
}

/**
 * Realism Fit: would he actually come?
 *
 * This is the dimension whose absence produced the worst answer the panel ever gave. A 90-rated
 * winger at a European giant was being scored 100% on tactical need, 100% on squad need and 100% on
 * age - three perfect scores and a recommendation to sign him, for a Championship club with no money.
 * Every one of those three scores was individually correct. The list was still nonsense, because
 * nothing was asking whether the move could happen at all.
 *
 * Measured as the rating gap between him and your squad's own average, against a tolerance the
 * realism level sets. The save's international reputation caps it hard: above the stated bar he is an
 * established name, and a player like that does not drop to a smaller club because a list says so.
 */
function realismFit(context: SquadContext, candidate: FitCandidate): FitDimension {
  const label = "Realism";

  if (candidate.overallRating === null) {
    return {
      key: "REALISM",
      label,
      score: null,
      explanation: "No rating in the save, so there is nothing to measure him against your level with.",
    };
  }
  if (context.averageRating === null) {
    return {
      key: "REALISM",
      label,
      score: null,
      explanation: "No squad average to compare against yet.",
    };
  }

  const seed = seedOf(candidate);
  const gap = candidate.overallRating - context.averageRating;
  // The band widens for a playstyle that is ABOUT shopping above your level. Without this the
  // reputation flag above never fires on a real save, because every famous player is also far above
  // the squad - measured, not assumed.
  const tolerance = Math.round(
    REALISM_STEP_TOLERANCE[context.mode] * PLAYSTYLE_TOLERANCE_MULTIPLIER[context.playstyle]
  );
  const vetoes = REALISM_VETOES_ENABLED[context.mode];
  // Named once, here, and never again in the same explanation. The culture note below refers to the
  // club as "their" precisely so the panel cannot say "He plays for Athletic Club de Bilbao. Bilbao
  // are the one club in Europe that..." - which is what it used to say.
  const where = candidate.clubName ? ` He plays for ${candidate.clubName}.` : "";
  const rep = candidate.internationalRep ?? 0;
  // A playstyle may EXPECT a famous target.
  //
  // Forgotten legends is the case this exists for: a big name who has stopped being picked is the
  // entire point of the playstyle, so applying the reputation veto to it would make the mode
  // impossible by construction rather than merely difficult. Reputation stops counting as a reason to
  // say no, and the move is then judged on the normal rating gap - which still has to pass.
  const expectsFamous = PLAYSTYLE_DEFINITIONS[context.playstyle].criteria.toleratesEstablishedRep;
  const established = rep >= REALISM_ESTABLISHED_REP && !expectsFamous;
  const culture = clubCultureOf(candidate.clubName);

  const vars = {
    gap,
    average: context.averageRating,
    rating: candidate.overallRating,
    rep,
  };

  if (gap <= tolerance) {
    return {
      key: "REALISM",
      label,
      score: 100,
      explanation: say(REALISM_LEVEL, seed, vars, 10) + where + cultureSuffix(culture, seed),
    };
  }

  let score: number;
  let sentence: string;
  if (gap <= tolerance * 2) {
    score = 62;
    sentence = say(REALISM_STEP, seed, vars, 11);
  } else if (gap <= tolerance * 3) {
    score = 28;
    sentence = say(REALISM_LARGE, seed, vars, 12);
  } else {
    score = 0;
    sentence = say(REALISM_FAR, seed, vars, 13);
  }

  // An established international caps every band, not just the extreme one. The fee is not what is
  // stopping this - the player's own position is - so no amount of money should read as progress.
  const finalScore = established ? Math.min(score, 10) : score;

  // A veto is only available in the bands that permit one, and only where the move is genuinely
  // impossible: far above your level, or an established name who does not make this move at any price.
  const disqualifying = vetoes && (score === 0 || established);

  return {
    key: "REALISM",
    label,
    score: finalScore,
    disqualifying,
    explanation:
      sentence +
      (established ? ` ${say(REALISM_ESTABLISHED, seed, vars, 14)}` : "") +
      where +
      cultureSuffix(culture, seed),
  };
}

/**
 * The culture caveat, or nothing.
 *
 * Kept out of the main sentences because it is the one part of the panel that is a caveat about what
 * the SAVE cannot know rather than a judgement about the player, and it should not be able to disturb
 * the sentence it follows.
 */
function cultureSuffix(culture: ReturnType<typeof clubCultureOf>, seed: string): string {
  return culture ? ` ${say(REALISM_CULTURE, seed, { note: culture.note }, 15)}` : "";
}

/**
 * The advisory. Its job is to name the single thing most likely to stop the signing, because that is
 * the decision the manager is actually making - not to restate the average.
 */
function buildAdvisory(fits: FitDimension[], seed: string): FitAdvisory {
  // A disqualifier outranks every score, and it is checked first.
  //
  // This is the fix for the worst answer the panel ever gave. Bellingham to a Championship side read
  // "Financial fit is the blocker", because financial was the only zero on the board - so the app
  // told the manager his budget was the reason. It was not the reason, and saying so buried the one
  // that was. A veto now names itself and suppresses the rest, because the rest is moot.
  const veto = fits.find((fit) => fit.disqualifying);
  if (veto) {
    return {
      headline: say(ADVISORY_VETO_HEADLINE, seed, { label: veto.label }, 16),
      detail: say(ADVISORY_VETO_DETAIL, seed, { explanation: veto.explanation }, 17),
      tone: "POOR",
    };
  }

  const scored = fits.filter((fit): fit is FitDimension & { score: number } => fit.score !== null);
  if (scored.length === 0) {
    return {
      headline: say(ADVISORY_UNJUDGEABLE_HEADLINE, seed, {}, 18),
      // Counted, not written down. This said "None of the four dimensions" and stayed saying it after
      // a fifth was added, which is the kind of sentence that quietly teaches a manager to distrust
      // every other number on the panel.
      detail: `None of the ${fits.length} dimensions could be scored from what the save holds.`,
      tone: "MIXED",
    };
  }

  const overall = Math.round(scored.reduce((total, fit) => total + fit.score, 0) / scored.length);
  const weakest = [...scored].sort((a, b) => a.score - b.score)[0];
  const strongest = [...scored].sort((a, b) => b.score - a.score)[0];

  if (overall >= 78) {
    return {
      headline: say(ADVISORY_STRONG_HEADLINE, seed, {}, 19),
      detail: `${strongest.label} is the reason: ${strongest.explanation}`,
      tone: "GOOD",
    };
  }
  if (weakest.score <= 25) {
    return {
      headline: say(ADVISORY_BLOCKER_HEADLINE, seed, { label: weakest.label }, 20),
      detail: weakest.explanation,
      tone: "POOR",
    };
  }
  return {
    headline: say(ADVISORY_PARTIAL_HEADLINE, seed, {}, 21),
    detail: say(
      ADVISORY_PARTIAL_DETAIL,
      seed,
      {
        strong: strongest.label,
        strongScore: strongest.score,
        weak: weakest.label,
        weakScore: weakest.score,
        explanation: weakest.explanation,
      },
      22
    ),
    tone: "MIXED",
  };
}

/**
 * The four dimensions for one candidate.
 *
 * `overall` is an equally weighted mean rather than a weighted one on purpose: weighting the
 * dimensions differently for each manager strategy would make two managers' "fit" incomparable, and
 * the strategy presets already express the manager's preference through ranking.
 */
export function evaluateFit(
  context: SquadContext,
  candidate: FitCandidate,
  budget: number | null,
  symbol: string
): PlayerFit {
  const seed = seedOf(candidate);
  const dimensions: FitDimension[] = [
    tacticalFit(context, candidate),
    needFit(context, candidate),
    financialFit(candidate, budget, symbol, seed),
    ageFit(context, candidate),
    realismFit(context, candidate),
  ];

  const scored = dimensions.filter((fit) => fit.score !== null) as Array<
    FitDimension & { score: number }
  >;
  const overall =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((total, fit) => total + fit.score, 0) / scored.length);

  return { dimensions, overall, advisory: buildAdvisory(dimensions, seed) };
}
