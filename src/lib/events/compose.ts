/**
 * Turning a thread's facts into a conclusion.
 *
 * A storyline is a small number of categories with an unbounded number of real facts attached to
 * each. This module is where those facts become a card: how urgent the thread is, and what it
 * actually means in football's language. Listing fact sentences is not a conclusion - the manager can
 * read the facts for themselves on the evidence view. What they cannot do is be told what the
 * situation *is*, in one line, and what decision it implies.
 *
 * Every active body has the same shape:
 *
 *   what the situation is now  ->  how it got there  ->  the call it implies
 *
 * The first part is built from the newest fact of each kind, so a thread with four kinds of fact
 * reads as four parts of one situation, while four readings of the *same* kind read as a position
 * that moved rather than four competing statements. That distinction is the whole difference between
 * compounding and repetition.
 *
 * Three rules:
 *
 * 1. **Severity is a function of the evidence, never of the category.** There is no table saying
 *    "contracts are urgent". One fact is a watch; facts stacking up is a warning; a fact whose own
 *    stated deadline has passed is critical. The probes decide how much a fact weighs (see
 *    `EvidenceFact.weight`); this module only reads that.
 * 2. **Nothing here is invented.** Every clause is built from a field the fact carries, and anything
 *    this module cannot phrase falls back to the fact's own stored sentence rather than to a guess.
 * 3. **Composing reads, it never writes.** Nothing here is persisted, so re-wording a card cannot
 *    rewrite what was observed. Stored facts keep the sentences they were recorded with.
 *
 * `inGameDate` is the save's own date, passed in rather than read from a clock. It is used for one
 * thing: deciding whether a deadline a fact mentions has passed. It is deliberately *not* used to
 * judge how long a thread has been compounding - evidence rows carry no in-game date per fact, so
 * that number does not exist yet, and inventing it from wall-clock time would be a lie.
 */
import type { StorylineCategory, StorylineStatus } from "../db/schema";
import type { DomainEvent } from "./types";
import { FORM_GRADE_LABELS, type EvidenceWeight } from "./evidence";

/** How urgent a thread is. Computed on every read - never stored, never set by hand. */
export type Severity = "WATCH" | "WARNING" | "CRITICAL";

/** One fact, in the shape composing needs: what it says, how much it weighs, when we recorded it. */
export interface ComposableFact {
  eventType: string;
  summary: string;
  weight: EvidenceWeight;
  payload: Record<string, unknown>;
  /** When we recorded it (a real timestamp). Ordering only; see the note on `inGameDate` above. */
  observedAt: string;
}

const FORM_GRADES: Record<number, string> = FORM_GRADE_LABELS;

/** Records that a thread exists, not anything about the career. Shown alone if it is all there is. */
const BOOKKEEPING_TYPES = new Set(["STORYLINE_OPENED"]);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Where a player stands in the manager's own thinking, from the fields the fact carries.
 *
 * Only ever read off recorded state: the manager's starting XI (`isStarter`) and the save's own
 * youth flag. A fact that carries neither is a squad player, which is the safe middle. Nothing here
 * infers standing from a rating, because a rating is not a role.
 */
function standingOf(payload: Record<string, unknown>): "STARTER" | "YOUTH" | "SQUAD" {
  if (payload.isStarter === true) return "STARTER";
  if (payload.isYouthProspect === true) return "YOUTH";
  return "SQUAD";
}

/**
 * A small stable hash, used only to choose between equivalent phrasings.
 *
 * Determinism matters more than variety here: the card is composed on the server and re-rendered on
 * the client, so the same thread must read the same way every time it is read. Picking at random
 * would make the copy change under the manager on every hydration.
 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One of several ways of saying the same thing.
 *
 * Seeded from the thread plus the newest fact it is about, so each card reads stably while no two
 * threads read alike - and a genuinely new fact is allowed to refresh the wording. `slot` keeps the
 * choices independent, so a headline and its closing line never move together.
 *
 * Every option in a list has to be interchangeable in meaning. That is the invariant the tests hold:
 * the same facts composed under many seeds must still make the same claims, so variety can never
 * quietly become a different statement.
 */
function pickVariant(options: readonly string[], seed: string, slot: string): string {
  return options[hashString(`${seed}|${slot}`) % options.length];
}

/** The save's in-game date as a year, or null when it is missing or not a date we can read. */
function yearFromInGameDate(inGameDate: string | null): number | null {
  if (!inGameDate) return null;
  const match = /^(\d{4})/.exec(inGameDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year > 1900 && year < 2200 ? year : null;
}

/** Reads a stored evidence row back into the shape composing works with. */
export function toComposableFact(event: DomainEvent): ComposableFact {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(event.payloadJson);
    if (parsed !== null && typeof parsed === "object") {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    /* an unreadable payload costs us context, not the fact: the fallback is the stored sentence */
  }

  return {
    eventType: event.eventType,
    summary: typeof payload.summary === "string" ? payload.summary : "",
    weight: payload.weight === "SERIOUS" ? "SERIOUS" : "NOTABLE",
    payload,
    observedAt: event.timestamp ?? "",
  };
}

/**
 * How urgent a thread is, from the facts alone.
 *
 * Ordered from the calmest thing up, so the answer is the loudest signal present:
 *
 * - one fact on record - a watch;
 * - two or three - a warning, because facts about a thread only accumulate for a reason;
 * - four or more - critical, because a single thread carrying four independent pieces of news is past
 *   reminding and into telling;
 * - any fact the probes marked SERIOUS - at least a warning, whatever the count;
 * - any fact whose own stated deadline has passed - critical, regardless of everything else.
 *
 * The category is accepted so call sites read the same for every rule, and is deliberately not
 * consulted: the moment severity depends on a category name, urgency is a hardcoded opinion again
 * rather than something the evidence earned.
 */
export function severityFor(
  _category: StorylineCategory,
  facts: ComposableFact[],
  inGameDate: string | null
): Severity {
  if (facts.length === 0) return "WATCH";

  if (hasPassedDeadline(facts, inGameDate)) return "CRITICAL";
  if (facts.length >= 4) return "CRITICAL";
  if (facts.some((fact) => fact.weight === "SERIOUS")) return "WARNING";
  if (facts.length >= 2) return "WARNING";
  return "WATCH";
}

/**
 * Why the thread is as urgent as it is, in one line, or null when it needs no explaining.
 *
 * Shown under the severity chip. A severity a manager cannot account for is a severity they learn to
 * ignore, and every reason here names something that is genuinely on the thread.
 */
export function severityReason(
  _category: StorylineCategory,
  facts: ComposableFact[],
  inGameDate: string | null
): string | null {
  if (facts.length === 0) return null;

  if (hasPassedDeadline(facts, inGameDate)) {
    return "The date the save records for this has already passed.";
  }
  if (facts.length >= 4) return `${facts.length} separate facts are stacked on this one thread.`;
  if (facts.some((fact) => fact.weight === "SERIOUS")) {
    return "What is recorded here is already an open decision, not a warning sign.";
  }
  if (facts.length >= 2) return `${facts.length} facts are stacked on this one thread.`;
  return null;
}

/** Whether any fact states a deadline the save's own date has already gone past. */
function hasPassedDeadline(facts: ComposableFact[], inGameDate: string | null): boolean {
  const currentYear = yearFromInGameDate(inGameDate);
  if (currentYear === null) return false;
  return facts.some((fact) => {
    const until = num(fact.payload.contractValidUntil);
    return until !== null && until <= currentYear;
  });
}

/**
 * Present-tense clause for one fact, read off the fields the fact carries.
 *
 * Null when this module cannot phrase the fact honestly, so the caller falls back to the fact's own
 * stored sentence instead of a guess. Every clause reads after a colon: "Darcy: <clause>".
 */
function clauseFor(fact: ComposableFact, currentYear: number | null): string | null {
  const p = fact.payload;

  switch (fact.eventType) {
    case "PLAYER_CONTRACT_EXPIRING": {
      const seasonsLeft = num(p.seasonsLeft);
      const until = num(p.contractValidUntil);
      // A deal the save dates to a year that has already gone is not "in its final year" - saying so
      // would be plainly wrong, and it is the one case where the reader most needs telling.
      if (until !== null && currentYear !== null && until <= currentYear) {
        return `his deal has already passed the date the save records (${until})`;
      }
      if (seasonsLeft !== null && seasonsLeft <= 0) return "his deal ends with this season";
      return until === null ? null : `his deal runs out at the end of ${until}`;
    }
    case "PLAYER_FORM_SLUMP": {
      const to = num(p.toForm);
      return to === null ? null : `his form has dropped to ${FORM_GRADES[to] ?? to}`;
    }
    case "PLAYER_FORM_STREAK": {
      const to = num(p.toForm);
      return to === null ? null : `his form has come back up to ${FORM_GRADES[to] ?? to}`;
    }
    case "PLAYER_DEVELOPED": {
      const delta = num(p.delta);
      if (delta === null || delta === 0) return null;
      return `he has gone ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} overall`;
    }
    case "PLAYER_POSITION_CHANGED": {
      const from = text(p.fromPosition);
      const to = text(p.toPosition);
      return from && to ? `he has been moved from ${from} to ${to}` : null;
    }
    case "SQUAD_DEPTH_THIN": {
      const position = text(p.position);
      const count = num(p.count);
      if (position === null || count === null) return null;
      if (count === 0) return "nobody is listed there";
      return `${count} player${count === 1 ? " is" : "s are"} listed there, where two are wanted`;
    }
    case "PLAYER_OUT_OF_POSITION": {
      const slot = text(p.slotLabel) ?? text(p.assignedSlotRole);
      const natural = text(p.naturalPosition);
      return slot && natural ? `he is being played at ${slot} rather than ${natural}` : null;
    }
    case "TACTICAL_SLOT_UNASSIGNED": {
      const label = text(p.label) ?? text(p.role);
      return label === null ? null : `${label} has nobody assigned to it`;
    }
    case "PLAYER_PRAISED": {
      const count = num(p.praiseCount);
      const windowSize = num(p.windowSize);
      const matchDetails = Array.isArray(p.matchDetails) ? (p.matchDetails as string[]) : [];
      if (count === null || windowSize === null) return null;
      if (matchDetails.length > 0) {
        const recentMatch = matchDetails[matchDetails.length - 1];
        return `you have singled him out in ${count} of your last ${windowSize} debriefs (most recently vs ${recentMatch})`;
      }
      return `you have singled him out in ${count} of your last ${windowSize} debriefs`;
    }
    default:
      return null;
  }
}

/** Past-tense fragment for a fact that is history rather than the current position. */
function historyFor(fact: ComposableFact): string | null {
  const p = fact.payload;
  const from = num(p.fromForm);
  const to = num(p.toForm);

  switch (fact.eventType) {
    case "PLAYER_DEVELOPED": {
      const oldOvr = num(p.oldOvr);
      const newOvr = num(p.newOvr);
      return oldOvr !== null && newOvr !== null ? `overall went ${oldOvr} to ${newOvr}` : null;
    }
    case "PLAYER_POSITION_CHANGED": {
      const fromPos = text(p.fromPosition);
      const toPos = text(p.toPosition);
      return fromPos && toPos ? `position moved from ${fromPos} to ${toPos}` : null;
    }
    case "PLAYER_FORM_SLUMP":
    case "PLAYER_FORM_STREAK": {
      if (from === null || to === null) return null;
      return `form was ${FORM_GRADES[from] ?? from}, then ${FORM_GRADES[to] ?? to}`;
    }
    case "PLAYER_CONTRACT_EXPIRING": {
      const until = num(p.contractValidUntil);
      return until === null ? null : `the deal was recorded as ending ${until}`;
    }
    case "SQUAD_DEPTH_THIN": {
      const count = num(p.count);
      return count === null ? null : `depth was recorded at ${count}`;
    }
    case "PLAYER_PRAISED": {
      const count = num(p.praiseCount);
      const windowSize = num(p.windowSize);
      return count !== null && windowSize !== null ? `praised in ${count}/${windowSize} debriefs` : null;
    }
    default:
      return null;
  }
}

/**
 * The subject a thread is about, taken from the title it was stored with.
 *
 * Adoption by subject is why every category's opening title starts with a stable token (a position, a
 * player's name); this reads that token back out rather than inventing a second naming rule.
 */
function subjectOf(title: string): string {
  const trimmed = title.trim();
  if (trimmed.includes(" - ")) return trimmed.split(" - ")[0].trim();
  const contract = /^Contract:\s*(.+?)\s+runs out/.exec(trimmed);
  if (contract) return contract[1];
  const depth = /^([A-Z]{2,3})\s+depth/.exec(trimmed);
  if (depth) return depth[1];
  return trimmed;
}

/** A short headline that says what the situation is, not what kind of fact it is. */
function headlineFor(
  subject: string,
  leading: ComposableFact[],
  fallbackTitle: string,
  currentYear: number | null,
  seed: string
): string {
  const first = leading[0];
  if (!first) return fallbackTitle;
  const p = first.payload;

  switch (first.eventType) {
    case "PLAYER_CONTRACT_EXPIRING": {
      const seasonsLeft = num(p.seasonsLeft);
      const until = num(p.contractValidUntil);
      if (until !== null && currentYear !== null && until <= currentYear) {
        return pickVariant(
          [
            `Contract Watch: ${subject} past the recorded expiry`,
            `Contract Watch: ${subject} - deal already out of time`,
            `Contract Watch: ${subject} - the recorded date has gone`,
          ],
          seed,
          "headline"
        );
      }
      if (seasonsLeft !== null && seasonsLeft <= 0) {
        return pickVariant(
          [
            `Contract Watch: ${subject} entering final 12 months`,
            `Contract Watch: ${subject} into the last year of his deal`,
            `Contract Watch: ${subject} - final season`,
          ],
          seed,
          "headline"
        );
      }
      return until === null
        ? `Contract Watch: ${subject}`
        : pickVariant(
            [
              `Contract Watch: ${subject} - deal to ${until}`,
              `Contract Watch: ${subject} - signed to ${until}`,
              `Contract Watch: ${subject} - ${until} expiry`,
            ],
            seed,
            "headline"
          );
    }
    case "SQUAD_DEPTH_THIN": {
      const count = num(p.count);
      const position = text(p.position) ?? subject;
      if (count === null) return `Structural Vulnerability: ${position} short on numbers`;
      return count === 0
        ? pickVariant(
            [
              `Structural Vulnerability: No specialist ${position} in the first team`,
              `Structural Vulnerability: Nobody at ${position}`,
              `Structural Vulnerability: ${position} with no cover at all`,
            ],
            seed,
            "headline"
          )
        : pickVariant(
            [
              `Structural Vulnerability: Only ${count} ${position} in the first team`,
              `Structural Vulnerability: ${position} down to ${count}`,
              `Structural Vulnerability: ${count} ${position} and no more`,
            ],
            seed,
            "headline"
          );
    }
    case "PLAYER_FORM_SLUMP": {
      const to = num(p.toForm);
      const grade = to === null ? null : FORM_GRADES[to] ?? String(to);
      return grade === null
        ? `${subject} - form watch`
        : pickVariant(
            [
              `${subject} - form down to ${grade}`,
              `${subject} - form has dipped to ${grade}`,
              `${subject} - ${grade} form`,
            ],
            seed,
            "headline"
          );
    }
    case "PLAYER_FORM_STREAK": {
      const to = num(p.toForm);
      const grade = to === null ? null : FORM_GRADES[to] ?? String(to);
      return grade === null
        ? `${subject} - form watch`
        : pickVariant(
            [
              `${subject} - form back to ${grade}`,
              `${subject} - form recovering to ${grade}`,
              `${subject} - back up to ${grade}`,
            ],
            seed,
            "headline"
          );
    }
    case "PLAYER_DEVELOPED": {
      const delta = num(p.delta);
      if (delta === null || delta === 0) return `${subject} - progress`;
      const size = Math.abs(delta);
      // A step of three or more is a different event from a gradual move: the growth has already
      // happened, and the question becomes whether the first team keeps pace with it.
      if (delta >= 3) {
        return pickVariant(
          [
            `${subject} - breakthrough: up ${size} overall`,
            `${subject} - ${size}-point surge in overall`,
            `Breakthrough: ${subject} up ${size} overall`,
          ],
          seed,
          "headline"
        );
      }
      return delta > 0
        ? pickVariant(
            [
              `${subject} - up ${size} overall`,
              `${subject} - ${size} better off overall`,
              `${subject} - rating up ${size}`,
            ],
            seed,
            "headline"
          )
        : pickVariant(
            [
              `${subject} - down ${size} overall`,
              `${subject} - ${size} worse off overall`,
              `${subject} - rating down ${size}`,
            ],
            seed,
            "headline"
          );
    }
    case "PLAYER_POSITION_CHANGED": {
      const to = text(p.toPosition);
      return to === null
        ? `${subject} - position change`
        : pickVariant(
            [
              `${subject} - now played at ${to}`,
              `${subject} - moved to ${to}`,
              `${subject} - now at ${to}`,
            ],
            seed,
            "headline"
          );
    }
    case "PLAYER_OUT_OF_POSITION": {
      const slot = text(p.slotLabel);
      return slot === null
        ? `${subject} - out of position`
        : pickVariant(
            [
              `${subject} - out of position at ${slot}`,
              `${subject} - playing out of position at ${slot}`,
              `${subject} - out of place at ${slot}`,
            ],
            seed,
            "headline"
          );
    }
    case "TACTICAL_SLOT_UNASSIGNED": {
      const label = text(p.label) ?? text(p.role);
      return label === null
        ? "An empty slot in the XI"
        : pickVariant(
            [`${label} has nobody in it`, `${label} is unfilled`, `Nobody in the ${label} slot`],
            seed,
            "headline"
          );
    }
    case "PLAYER_PRAISED": {
      const name = text(p.name) ?? "Squad player";
      const count = num(p.praiseCount);
      const windowSize = num(p.windowSize);
      if (count === null || windowSize === null) return `${name} manager praise`;
      return pickVariant(
        [
          `${name}: Key Performer in Recent Debriefs`,
          `${name} Singled Out ${count} Times in ${windowSize} Matches`,
          `Managerial Focus: ${name}'s Rising Influence`,
          `${name} Driving Matchday Results (${count}/${windowSize} Debriefs)`,
        ],
        seed,
        "headline"
      );
    }
    default:
      return fallbackTitle;
  }
}

/**
 * The fact a category's copy is actually about.
 *
 * A thread can carry several kinds of fact - a contract thread showing a rating move, say - and the
 * copy has to read the fields of the fact it is describing, not of whichever fact happens to be
 * newest. Falls back to the newest fact so a card carrying only tangential evidence still composes.
 */
const CATEGORY_FACT_TYPES: Partial<Record<StorylineCategory, readonly string[]>> = {
  CONTRACT: ["PLAYER_CONTRACT_EXPIRING"],
  SQUAD_DEPTH: ["SQUAD_DEPTH_THIN"],
  FORM: ["PLAYER_FORM_SLUMP", "PLAYER_FORM_STREAK"],
  DEVELOPMENT: ["PLAYER_DEVELOPED", "PLAYER_POSITION_CHANGED"],
};

function leadingFactFor(
  category: StorylineCategory,
  leading: ComposableFact[]
): ComposableFact | undefined {
  const types = CATEGORY_FACT_TYPES[category];
  if (types) {
    const match = leading.find((fact) => types.includes(fact.eventType));
    if (match) return match;
  }
  return leading[0];
}

/**
 * What is actually at stake, in the words of the decision rather than the fact.
 *
 * Kept separate from `askFor` so the risk reads as a consequence and the ask reads as a set of
 * options. Null where a category carries no risk of its own - a praise card is good news, and a
 * closed season thread has already been decided.
 *
 * Read only off fields the fact carries. The one cross-cutting input is the save's own year, used
 * to tell a deadline that has passed from one that is merely near.
 */
function riskFor(
  category: StorylineCategory,
  leading: ComposableFact[],
  currentYear: number | null,
  seed: string
): string | null {
  const first = leadingFactFor(category, leading);
  if (!first) return null;
  const p = first.payload;

  switch (category) {
    case "CONTRACT": {
      const name = text(p.name) ?? "He";
      const until = num(p.contractValidUntil);
      if (until !== null && currentYear !== null && until <= currentYear) {
        return pickVariant(
          [
            `${name}'s deal has already run past the date the save records, so the club no longer controls the outcome - he can leave for nothing.`,
            `The recorded expiry on ${name}'s deal has gone, which means the club has lost the ability to renew or sell on its own terms.`,
          ],
          seed,
          "risk"
        );
      }
      const standing = standingOf(p);
      if (standing === "STARTER") {
        return pickVariant(
          [
            `Losing ${name} costs you a starter you cannot replace in-house, and a free transfer returns nothing to reinvest.`,
            `${name} is in your XI, so the exposure is a hole in the shape only the market can fill - and a free transfer pays for none of it.`,
          ],
          seed,
          "risk"
        );
      }
      if (standing === "YOUTH") {
        return pickVariant(
          [
            `${name} is not a first-team fixture yet, so the exposure is losing a developing asset for nothing rather than losing a starter.`,
            `The risk here is a prospect leaving before he has returned anything on the minutes already invested in him.`,
          ],
          seed,
          "risk"
        );
      }
      return pickVariant(
        [
          `Let it run down and ${name} leaves for nothing, or for a fraction of his value in the final window.`,
          `The longer it runs, the less the club can ask for ${name} - and at the end of it, nothing at all.`,
        ],
        seed,
        "risk"
      );
    }
    case "SQUAD_DEPTH": {
      const count = num(p.count);
      const position = text(p.position) ?? "the position";
      // Zero and one are different alarms. With nobody at all there is no natural answer on the
      // bench; with one specialist the answer exists but carries the whole load.
      if (count === 0) {
        return pickVariant(
          [
            `There is no specialist at all: one injury or suspension forces a makeshift solution, and the matchday squad cannot absorb fatigue at ${position}.`,
            `With nobody at ${position}, a single booking or knock changes the shape mid-match and the bench has no natural answer.`,
          ],
          seed,
          "risk"
        );
      }
      return pickVariant(
        [
          `A single specialist carries the whole position: fatigue, a booking or one injury and the shape has to change mid-match.`,
          `One specialist means no rotation at ${position} - the fixture list, not form, decides when he breaks down.`,
        ],
        seed,
        "risk"
      );
    }
    case "FORM": {
      // FORM deliberately stays fact-local: the debriefs' view of this player is a PRAISE thread,
      // and the two are allowed to disagree. Nothing here reads across categories.
      if (first.eventType === "PLAYER_FORM_STREAK") {
        return pickVariant(
          [
            "He is on an upswing; the risk now is breaking the run by changing his role or resting him at the wrong moment.",
            "The ratings are climbing - the wrong intervention here ends the run rather than protecting it.",
          ],
          seed,
          "risk"
        );
      }
      return pickVariant(
        [
          "His recent ratings have dropped, and a run of low readings in a position you rely on drags the shape down with it.",
          "A slump in a role you depend on is not only his problem - it shows up as goals and points elsewhere.",
        ],
        seed,
        "risk"
      );
    }
    case "DEVELOPMENT": {
      if (first.eventType === "PLAYER_POSITION_CHANGED") {
        return pickVariant(
          [
            "The move only pays off if the tactical setup actually uses him in the new role.",
            "A new position is only realised in the team sheet - until the shape uses him there, nothing has changed.",
          ],
          seed,
          "risk"
        );
      }
      const delta = num(p.delta);
      if (delta !== null && delta >= 3) {
        return pickVariant(
          [
            "A surge this size is the point where a player outgrows a bit-part role - the growth is already there, and the question is whether the first team keeps pace.",
            "He has moved further, faster than the squad around him; the risk is stalling it with minutes that do not match the level.",
          ],
          seed,
          "risk"
        );
      }
      if (delta !== null && delta < 0) {
        return pickVariant(
          [
            "The rating has slipped, which usually points to minutes or role rather than ability.",
            "A drop this size is normally about opportunity, not talent - left alone it becomes both.",
          ],
          seed,
          "risk"
        );
      }
      return pickVariant(
        [
          "The growth is real but gradual; he needs minutes to keep it moving rather than a role he is not ready to hold.",
          "Steady progress is easy to stall - without a clear pathway the curve flattens.",
        ],
        seed,
        "risk"
      );
    }
    default:
      return null;
  }
}

/**
 * The call the thread implies, with the alternatives named.
 *
 * This is the part that has to be worth reading: "it needs covering" tells a manager nothing, while
 * naming the two things they could actually do turns the card into a decision.
 */
function askFor(category: StorylineCategory, leading: ComposableFact[], seed: string): string {
  const first = leadingFactFor(category, leading);

  switch (category) {
    case "CONTRACT": {
      const seasonsLeft = first ? num(first.payload.seasonsLeft) : null;
      if (seasonsLeft !== null && seasonsLeft <= 0) {
        return pickVariant(
          [
            "The call is whether to renew him now, list him in the next window while he still has value, or hold him to the end of the season and risk losing him for nothing.",
            "Decide between renewing now, cashing in during the next window, or holding to the end of the season and accepting the free-transfer risk.",
          ],
          seed,
          "ask"
        );
      }
      return pickVariant(
        [
          "The call is whether to open renewal talks now, list him while his value holds, or leave it until the end of the season.",
          "It comes down to opening talks now, moving him on while the fee is real, or leaving it late.",
          "It comes down to opening renewal talks now, listing him while his value holds, or leaving it until the end of the season.",
        ],
        seed,
        "ask"
      );
    }
    case "SQUAD_DEPTH": {
      const count = first ? num(first.payload.count) : null;
      return count === 0
        ? pickVariant(
            [
              "The call is whether to promote from the youth setup, convert a secondary-position player, or make this a priority in the next transfer window.",
              "Decide between promoting youth cover, moving a secondary-position player across, or signing a specialist in the next window.",
            ],
            seed,
            "ask"
          )
        : pickVariant(
            [
              "The call is whether to promote cover from within, move a secondary-position player across, or sign a second specialist in the next window.",
              "Decide between promoting from within, converting a squad player, or adding a specialist in the next window.",
            ],
            seed,
            "ask"
          );
    }
    case "FORM": {
      // A recovery and a slump are opposite situations and must not share a closing line. FORM
      // stays fact-local by design: what the debriefs say about this player lives on a PRAISE
      // thread, and the two cards are allowed to tell different stories about the same man.
      if (first?.eventType === "PLAYER_FORM_STREAK") {
        return pickVariant(
          [
            "The call is whether to keep him in and ride the streak, or rest him to protect the run - changing his role now would break it.",
            "Keep him in and let the run continue, or manage his minutes so the role does not change under him.",
          ],
          seed,
          "ask"
        );
      }
      return pickVariant(
        [
          "The call is whether to take him out for a tactical reset, change his role in the formation, or keep picking him and let him play through it.",
          "Decide between a game out to reset him, a change of role, or backing him to play through the slump.",
        ],
        seed,
        "ask"
      );
    }
    case "TACTICAL":
      return pickVariant(
        [
          "The call is whether to fill the slot as it is or change the shape to suit who you have.",
          "It comes down to filling the slot as it is or changing the shape to suit who you have.",
        ],
        seed,
        "ask"
      );
    case "DEVELOPMENT": {
      // A position move, a surge and a gradual rise are three different planning calls, so they do
      // not share a closing line. The newest fact decides which one this card is about.
      if (first?.eventType === "PLAYER_POSITION_CHANGED") {
        return pickVariant(
          [
            "The call is whether to lock him into the new role in the system, or accept that he stays a squad option there.",
            "Decide whether the new position becomes part of the setup, or stays a stop-gap.",
          ],
          seed,
          "ask"
        );
      }
      const delta = first ? num(first.payload.delta) : null;
      if (delta !== null && delta >= 3) {
        return pickVariant(
          [
            "The call is whether to grant him a starting role now, or keep managing his minutes and risk stalling the surge.",
            "Decide between handing him a starting role or rationing his minutes while the growth settles.",
          ],
          seed,
          "ask"
        );
      }
      if (delta !== null && delta < 0) {
        return pickVariant(
          [
            "The call is whether to change his role, or accept that his ceiling in this squad is a supporting one.",
            "Decide between a different role and accepting a squad-level ceiling.",
          ],
          seed,
          "ask"
        );
      }
      return pickVariant(
        [
          "The call is whether to loan him out for regular minutes or keep him around the first team.",
          "Decide between a loan for minutes and keeping him in the first-team group.",
        ],
        seed,
        "ask"
      );
    }
    case "SEASON_OBJECTIVE":
      return pickVariant(
        ["The board judges it when the season ends.", "It gets judged when the season ends."],
        seed,
        "ask"
      );
    case "PRAISE": {
      const payload = (first?.payload ?? {}) as Record<string, unknown>;
      const name = text(payload.name) ?? "The player";
      const count = num(payload.praiseCount) ?? 3;
      const windowSize = num(payload.windowSize) ?? 5;
      const matchDetails = Array.isArray(payload.matchDetails) ? (payload.matchDetails as string[]) : [];
      const recentMatch = matchDetails.length > 0 ? matchDetails[matchDetails.length - 1] : null;

      const matchClause = recentMatch ? ` (most recently in the debrief vs ${recentMatch})` : "";

      if (count >= 4) {
        return pickVariant(
          [
            `${name} has established himself as the tactical heartbeat of your matchdays, earning individual praise in ${count} of your last ${windowSize} debriefs${matchClause}. Your post-match notes show consistent reliance on his execution when matches are on the line.`,
            `Across your recent 5-match window, ${name} has been singled out ${count} times as a standout performer${matchClause}. His form and tactical adherence have set the benchmark for the rest of the squad.`,
          ],
          seed,
          "body"
        );
      }

      return pickVariant(
        [
          `Your recent match debriefs show a clear trend: ${name} has been named as a key contributor in ${count} of your last ${windowSize} matches${matchClause}. He is gaining your trust as a reliable tactical option.`,
          `${name}'s influence is growing in your post-match notes, with ${count} standout mentions over the last ${windowSize} debriefs${matchClause}. He is consistently fulfilling his tactical assignments.`,
        ],
        seed,
        "body"
      );
    }
  }
}

function listClauses(clauses: string[]): string {
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
}

/**
 * The rendered headline and body for a thread, from however many facts it has.
 *
 * One fact is a sentence and a decision. Four facts of different kinds are a situation with four
 * parts, stated once each. Four readings of the same kind are a position that moved, so they become
 * history instead of four competing clauses - and nothing appears as both.
 */
export function composeStoryline(
  thread: { id?: string; category: StorylineCategory; title: string; status: StorylineStatus },
  facts: ComposableFact[],
  inGameDate: string | null
): { title: string; body: string } {
  const subject = subjectOf(thread.title);
  // Newest first, so "the newest of each kind" is well defined regardless of how the rows came back.
  const ordered = [...facts].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const citable = ordered.filter((fact) => !BOOKKEEPING_TYPES.has(fact.eventType));

  // Seeded from the thread and its newest fact: the same card keeps its wording, two different threads
  // do not share one, and a genuinely new fact may refresh it. Facts are what separate two threads
  // that look alike, so the more a thread compounds the less likely it is to read like another card.
  const seed = [
    thread.id ?? thread.title,
    citable[0]?.eventType ?? "",
    citable[0]?.observedAt ?? "",
  ].join("|");

  if (citable.length === 0) {
    // Nothing but the record that it exists - a season-scoped thread looks like this until the season
    // moves. Saying what the thread is, and what it is waiting on, beats announcing an empty drawer.
    return { title: thread.title, body: `${subject}. ${askFor(thread.category, [], seed)}` };
  }

  // One clause per kind of fact, newest wins; every older reading becomes history. Nothing appears as
  // both, which is what keeps the body from saying the same thing twice - and the older readings are
  // kept rather than dropped, because "down to one, now none" IS the story of a thread.
  const leading: ComposableFact[] = [];
  const history: ComposableFact[] = [];
  const seenTypes = new Set<string>();
  for (const fact of citable) {
    if (seenTypes.has(fact.eventType)) {
      history.push(fact);
      continue;
    }
    seenTypes.add(fact.eventType);
    leading.push(fact);
  }

  const historyLines = history
    .map(historyFor)
    .filter((line): line is string => line !== null)
    .slice(0, 4);

  if (thread.status !== "ACTIVE") {
    // A closed thread is a record, not a decision: what happened, then how it got there.
    const outcome =
      thread.status === "RESOLVED"
        ? pickVariant(
            [
              "This was answered, so it is no longer asking anything of you.",
              "Answered - it is kept here for the record.",
            ],
            seed,
            "outcome"
          )
        : pickVariant(
            [
              "This was dropped - it could not be followed any further.",
              "Dropped - it stopped being something we could track.",
            ],
            seed,
            "outcome"
          );
    const recount = citable
      .map((fact) => historyFor(fact) ?? fact.summary)
      .filter((line) => line.length > 0)
      .slice(0, 4);
    const traced = [...historyLines, ...recount];

    return {
      title: `${subject} - ${thread.status === "RESOLVED" ? "answered" : "dropped"}`,
      body: traced.length > 0 ? `${outcome} How it went: ${traced.join("; ")}.` : outcome,
    };
  }

  const clauses = leading
    .map((fact) => clauseFor(fact, yearFromInGameDate(inGameDate)) ?? text(fact.summary))
    .filter((line): line is string => line !== null);

  const clauseList = listClauses(clauses);
  const lead =
    clauses.length === 0
      ? `${subject}: ${thread.title}.`
      : clauses.length === 1
        ? pickVariant([`${subject}: ${clauseList}.`, `${subject} - ${clauseList}.`], seed, "lead")
        : pickVariant(
            [
              `${subject}: ${clauseList}.`,
              `${clauses.length} things on ${subject}: ${clauseList}.`,
            ],
            seed,
            "lead"
          );

  const parts = [lead];
  if (historyLines.length > 0) {
    parts.push(
      `${pickVariant(["How it got there:", "The run-up:", "How it got to this:"], seed, "history")} ${historyLines.join(
        "; "
      )}.`
    );
  }
  const risk = riskFor(thread.category, leading, yearFromInGameDate(inGameDate), seed);
  if (risk) parts.push(risk);
  parts.push(askFor(thread.category, leading, seed));

  return {
    title: headlineFor(subject, leading, thread.title, yearFromInGameDate(inGameDate), seed),
    body: parts.join(" "),
  };
}
