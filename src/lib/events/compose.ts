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
            `${subject} - deal has run out`,
            `${subject} - past the date on his deal`,
            `${subject} - deal is out of time`,
          ],
          seed,
          "headline"
        );
      }
      if (seasonsLeft !== null && seasonsLeft <= 0) {
        return pickVariant(
          [
            `${subject} - final year of his deal`,
            `${subject} - last season on his contract`,
            `${subject} - into the last year of his deal`,
          ],
          seed,
          "headline"
        );
      }
      return until === null
        ? `${subject} - contract`
        : pickVariant(
            [
              `${subject} - deal ends ${until}`,
              `${subject} - contract runs to ${until}`,
              `${subject} - signed up to ${until}`,
            ],
            seed,
            "headline"
          );
    }
    case "SQUAD_DEPTH_THIN": {
      const count = num(p.count);
      if (count === null) return `${subject} - short on numbers`;
      return count === 0
        ? pickVariant(
            [
              `${subject} - nobody there`,
              `${subject} - no cover at all`,
              `${subject} - nobody to call on`,
            ],
            seed,
            "headline"
          )
        : pickVariant(
            [
              `${subject} - down to ${count}`,
              `${subject} - only ${count} to call on`,
              `${subject} - ${count} and no more`,
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
    default:
      return fallbackTitle;
  }
}

/**
 * The call the thread implies, with the alternatives named.
 *
 * This is the part that has to be worth reading: "it needs covering" tells a manager nothing, while
 * naming the two things they could actually do turns the card into a decision.
 */
function askFor(category: StorylineCategory, leading: ComposableFact[], seed: string): string {
  const first = leading[0];

  switch (category) {
    case "CONTRACT": {
      const seasonsLeft = first ? num(first.payload.seasonsLeft) : null;
      return seasonsLeft !== null && seasonsLeft <= 0
        ? pickVariant(
            [
              "The call is whether to renew him now or accept that he goes when the deal ends.",
              "It comes down to renewing him now or accepting that he leaves when the deal ends.",
              "Decide now: renew, or plan for him to leave when the deal ends.",
            ],
            seed,
            "ask"
          )
        : pickVariant(
            [
              "The call is whether to open renewal talks this season or let the deal run down.",
              "It comes down to opening talks this season or letting the deal run down.",
              "Decide between opening talks now and letting the deal run down.",
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
              "The call is whether to sign cover or set up in a way that does not need one.",
              "It comes down to signing cover or setting up so that you do not need any.",
            ],
            seed,
            "ask"
          )
        : pickVariant(
            [
              "The call is whether to add a second option or accept that one injury changes your shape.",
              "It comes down to adding a second option or accepting that one injury changes your shape.",
              "Add a second option, or accept that one injury changes your shape.",
            ],
            seed,
            "ask"
          );
    }
    case "FORM":
      return pickVariant(
        [
          "The call is whether to keep picking him and let him play through it, or take him out for a game.",
          "Keep picking him and let him play through it, or take him out for a game - that is the call.",
        ],
        seed,
        "ask"
      );
    case "TACTICAL":
      return pickVariant(
        [
          "The call is whether to fill the slot as it is or change the shape to suit who you have.",
          "It comes down to filling the slot as it is or changing the shape to suit who you have.",
        ],
        seed,
        "ask"
      );
    case "DEVELOPMENT":
      return pickVariant(
        [
          "Nothing is being asked of you here - the job is to keep the minutes coming.",
          "No decision here: the job is to keep the minutes coming.",
          "Nothing to decide - keep the minutes coming.",
        ],
        seed,
        "ask"
      );
    case "SEASON_OBJECTIVE":
      return pickVariant(
        ["The board judges it when the season ends.", "It gets judged when the season ends."],
        seed,
        "ask"
      );
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
  parts.push(askFor(thread.category, leading, seed));

  return {
    title: headlineFor(subject, leading, thread.title, yearFromInGameDate(inGameDate), seed),
    body: parts.join(" "),
  };
}
