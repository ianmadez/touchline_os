/**
 * The wording of the fit panel, kept apart from the judging of it.
 *
 * Three problems this exists to solve.
 *
 * The first is repetition. Every realism explanation used to be assembled from one sentence shape -
 * "N points above your squad average (M)." - followed by one of three fixed endings. Correct, and by
 * the twentieth target it reads like a mail merge rather than a judgement. Variation is a feature of
 * scouting copy, not decoration.
 *
 * The second is worse than repetition: sentences that were FALSE for the player they were printed
 * against. Copy chosen by which branch the code took, rather than by what is actually known, produces
 * claims like "he is an established international" next to a reputation of 1, or a club's name twice
 * in one breath. So every template here is selected against a fact that is present, and every exporter
 * degrades to something readable when the fact is absent.
 *
 * The third is stability, and it is the reason this is not random. A scout report that changes when
 * you look away is not a report. Variation comes from a seed derived from the player, so two targets
 * read differently while any one target reads the same way every time you open it.
 */

/**
 * FNV-1a over the string form of the seed. Chosen because it is short, has no state to reset, and
 * spreads adjacent ids (277643, 277644) to unrelated outputs - a naive modulo would give adjacent
 * players adjacent variants and the list would still look templated.
 */
function hash(seed: string | number): number {
  const text = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One variant, chosen by seed.
 *
 * `offset` lets several independent choices be drawn from the same seed without them moving together.
 * Without it, the player who got variant 0 of the gap sentence would also get variant 0 of the
 * established clause every time, and those pairings would become the new template.
 */
export function pick(variants: readonly string[], seed: string | number, offset = 0): string {
  if (variants.length === 0) return "";
  // `Math.imul` returns a SIGNED 32-bit integer, so `Math.imul(offset, ...)` is negative for every
  // positive offset and the sum can go negative. A bare `%` then yields a negative index, and
  // `variants[-1]` is `undefined` - which reached `fill()` and threw while the panel was rendering.
  //
  // It only fired for SOME players, because `hash(seed)` is unsigned and large enough to keep the sum
  // positive whenever it exceeds the imul result. Six sampled players all worked and the seventh would
  // have blanked the dossier; the double modulo is what makes it seed-independent.
  const sum = hash(seed) + Math.imul(offset, 0x9e3779b9);
  const index = ((sum % variants.length) + variants.length) % variants.length;
  return variants[index];
}

/**
 * Substitutes `{name}` placeholders.
 *
 * An unknown placeholder is left as written rather than blanked, so a missing variable shows up as
 * `{gap}` on screen and gets noticed, instead of quietly deleting a word from the middle of a
 * sentence and leaving something that reads as broken English.
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

/** Pick a variant and fill it. The usual entry point. */
export function say(
  variants: readonly string[],
  seed: string | number,
  vars: Record<string, string | number>,
  offset = 0
): string {
  return fill(pick(variants, seed, offset), vars);
}

/* ------------------------------------------------------------------------------------------------
 * Realism
 *
 * Four bands by how far above the manager's own level the target sits. Each band has its own set so
 * that "he is a step up" never borrows the language of "he is out of the question".
 * ---------------------------------------------------------------------------------------------- */

/** Within the tolerance: he is a peer. */
export const REALISM_LEVEL: readonly string[] = [
  "At {rating} he sits level with your squad, whose average is {average} - nothing about this needs explaining.",
  "Rated {rating} against your average of {average}: this is your market.",
  "{rating} to your squad's {average} - he would arrive as a peer rather than as a coup.",
  "At {rating} he is inside touching distance of your own level ({average}). Moves like this happen.",
];

/** One band up: possible, needs money and a reason. */
export const REALISM_STEP: readonly string[] = [
  "{gap} points above your squad average of {average} - a step up, achievable with money and a reason.",
  "He sits {gap} clear of your average ({average}). Money and a pitch close that, not time.",
  "{gap} above your own level ({average}). Enough to need selling, not enough to need a miracle.",
  "That is {gap} points past your average of {average}. A real step up, and a normal one for a club on the rise.",
];

/** Two bands up: only a large fee or a change in standing closes it. */
export const REALISM_LARGE: readonly string[] = [
  "{gap} points above your squad average ({average}) - only a big fee or a rise in your standing closes that.",
  "At {gap} above your average of {average}, either real money or a real change in what your club is.",
  "{gap} clear of your level ({average}). Possible, but the fee would be doing most of the work.",
];

/** Beyond that: not a plan. */
export const REALISM_FAR: readonly string[] = [
  "{gap} points above your squad average ({average}). Nothing about your club makes this a conversation.",
  "{gap} above your level ({average}) - that is not a gap one good window closes.",
  "{gap} points clear of your average of {average}. This is a wish rather than a target.",
  "Your average is {average} and he is {gap} points beyond it. That is a different calibre of club talking.",
];

/** Appended when the save puts him among established internationals. */
export const REALISM_ESTABLISHED: readonly string[] = [
  "He is an established international (reputation {rep} of 5), and that is the part that does not move.",
  "With a reputation of {rep} of 5 he is a name in his own right; the fee is not what stands in the way.",
  "At reputation {rep} of 5 he has options well beyond you, and no bid changes that.",
];

/** Appended when the candidate's club has a signing culture the save cannot test. */
export const REALISM_CULTURE: readonly string[] = [
  "{note}",
  // No prefix ending in a colon here. The note is a complete sentence that starts with a capital, so
  // "Worth knowing as well: Their policy..." reads as two fragments pushed together. The prefix has
  // to be able to stand as its own sentence.
  "One more thing the save cannot settle either way. {note}",
];

/* ------------------------------------------------------------------------------------------------
 * Financial
 *
 * The score bands and the sentences come from the same ratio, so a player cannot be described as
 * reachable while being scored as unreachable.
 * ---------------------------------------------------------------------------------------------- */

export const FINANCIAL_NO_BUDGET: readonly string[] = [
  "No transfer budget is set, so affordability cannot be judged. Set one in Finances.",
];

/** A recorded zero. Distinct from "not set" on purpose: it is an answer, not a blank. */
export const FINANCIAL_ZERO: readonly string[] = [
  "Your transfer budget is {symbol}0, so no fee is payable at all. Only a free transfer or a loan is open to you.",
  "There is no money to spend ({symbol}0). Anything on this list is a free transfer, a loan, or a name to revisit later.",
  "A {symbol}0 budget means nothing here can be bought at any price. Free transfers and loans only.",
];

export const FINANCIAL_UNPRICED: readonly string[] = [
  "No value band could be formed for him, so he cannot be priced against your budget.",
  "He has no value band in the save, so there is nothing to compare with your budget.",
];

export const FINANCIAL_AFFORDABLE: readonly string[] = [
  "Affordable at the top of his band: {high} against a {budget} budget.",
  "Within budget even at {high}, against a {budget} budget.",
  "His whole band fits: {high} at the top of it, {budget} available.",
];

export const FINANCIAL_MIDPOINT: readonly string[] = [
  "Affordable on the midpoint ({mid}) but his band reaches {high} against a {budget} budget.",
  "The middle of his range fits ({mid}); the top of it does not ({high} against {budget}).",
];

export const FINANCIAL_CLOSE: readonly string[] = [
  "Just short: {mid} against {budget}. Close enough that opening the conversation is worth it.",
  "His band opens at {mid} and you hold {budget}. A gap narrow enough to bridge with structure.",
];

export const FINANCIAL_STRETCH: readonly string[] = [
  "His band opens at {mid} against {budget}. A stretch, and one that leans on instalments and add-ons.",
  "{mid} against your {budget} - short, but inside the range where a deal can be built.",
];

export const FINANCIAL_OUT_OF_REACH: readonly string[] = [
  "Out of reach: his band opens at {mid} against a {budget} budget, about {ratio} times what you hold.",
  "At {mid} against {budget} you are short by a distance no negotiation closes.",
  "{mid} against {budget}. Not a gap that instalments fix.",
];

/* ------------------------------------------------------------------------------------------------
 * Age
 * ---------------------------------------------------------------------------------------------- */

export const AGE_PRIME: readonly string[] = [
  "Age {age} sits in the prime window for {position} ({from}-{to}).",
  "{age} is squarely inside the years {position} rewards most ({from}-{to}).",
];

export const AGE_PAST: readonly string[] = [
  "Past the prime window for {position} ({from}-{to}) by {years}.",
  "{years} beyond the years {position} usually rewards ({from}-{to}).",
];

/* ------------------------------------------------------------------------------------------------
 * Advisory
 *
 * The headline names one thing. These are the ways of naming it without every target reading the
 * same, and the details are deliberately built from the winning dimension's own explanation rather
 * than from a second sentence written to say it again.
 * ---------------------------------------------------------------------------------------------- */

export const ADVISORY_VETO_HEADLINE: readonly string[] = [
  "{label} rules this out",
  "This stops at {label}",
  "{label} closes this one",
];

export const ADVISORY_VETO_DETAIL: readonly string[] = [
  "{explanation} Nothing else on this panel matters until that changes.",
  "{explanation} Every other line here is beside the point while that stands.",
];

export const ADVISORY_UNJUDGEABLE_HEADLINE: readonly string[] = [
  "Not enough to go on",
  "Too little to judge",
];

export const ADVISORY_STRONG_HEADLINE: readonly string[] = [
  "Strong fit",
  "Fits on every count",
  "This one stacks up",
];

export const ADVISORY_BLOCKER_HEADLINE: readonly string[] = [
  "{label} is the blocker",
  "{label} is what stands in the way",
  "{label} is the problem",
];

export const ADVISORY_PARTIAL_HEADLINE: readonly string[] = [
  "Partial fit",
  "Mixed picture",
  "Fits in places",
];

export const ADVISORY_PARTIAL_DETAIL: readonly string[] = [
  "{strong} works ({strongScore}); {weak} is the weak point ({weakScore}). {explanation}",
  "{strong} is fine ({strongScore}). {weak} is not ({weakScore}). {explanation}",
];
