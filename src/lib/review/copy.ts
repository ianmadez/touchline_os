/**
 * The review's wording.
 *
 * Two rules hold this file together. Nothing here claims a cause: the phrases describe what was counted, and the
 * sections for confounds and questions carry the rest. And every phrase is chosen by the existing hash picker from
 * the window key, so the same window reads the same way on every visit and a regenerated review is not a new one.
 */
import { pickVariant } from "../events/compose";
import type { ReviewSectionId } from "./types";

export const SECTION_TITLES: Record<ReviewSectionId, string> = {
  WINDOW: "The window",
  NUMBERS: "What the numbers say",
  SCORES: "What the scores alone say",
  CONTRAST: "The key contrast",
  PREVIOUS: "Against the last block",
  NOT_CLAIMING: "What I am not claiming",
  RESTS_ON: "What this rests on",
  QUESTIONS: "Questions this raises",
};

/** The order the sections are read in. Locked: the report reads as evidence first and questions last. */
export const SECTION_ORDER: ReviewSectionId[] = [
  "WINDOW",
  "NUMBERS",
  "SCORES",
  "CONTRAST",
  "PREVIOUS",
  "NOT_CLAIMING",
  "RESTS_ON",
  "QUESTIONS",
];

const OPENERS: Record<ReviewSectionId, readonly string[]> = {
  WINDOW: [
    "The matches this reads, newest first.",
    "This is the run the review was taken over.",
  ],
  NUMBERS: [
    "Findings that needed a figure you logged.",
    "What the counted figures support.",
  ],
  SCORES: [
    "Findings that need nothing but the scoreline.",
    "What the results alone can carry.",
  ],
  CONTRAST: [
    "Two matches from this window, side by side.",
    "The two matches worth putting next to each other.",
  ],
  PREVIOUS: [
    "The same read against the block before this one.",
    "How this run compares with the previous block.",
  ],
  NOT_CLAIMING: [
    "Every finding above lists what else could be behind it. None of them says why.",
    "This is a description of what happened, not a reason for it.",
  ],
  RESTS_ON: [
    "What the review had to work with.",
    "How much of this is measured and how much is remembered.",
  ],
  QUESTIONS: [
    "What would settle each of these.",
    "The questions this run leaves open.",
  ],
};

export function sectionOpener(id: ReviewSectionId, seed: string): string {
  return pickVariant(OPENERS[id], seed, `opener:${id}`);
}

/**
 * The question a finding leaves open.
 *
 * Written per finding id rather than per sentence, so a new rule needs its question here or none is printed. A
 * generic question bolted onto every finding would be worse than silence: it would read as a prompt to answer
 * something the review never asked.
 */
const QUESTIONS: Record<string, readonly string[]> = {
  "result-against-performance": [
    "Were the chances falling to the players you would want taking them?",
    "Did the figures come from the same spells of the match as the goals?",
  ],
  "best-result-worst-performance": [
    "What was different about the match where the chances did not arrive?",
  ],
  "concession-timing": [
    "Who was on the pitch when the late goals went in?",
    "Did the changes come before or after the goals against?",
  ],
  "recurring-weakness": [
    "Which of these notes describes the same problem twice?",
  ],
  "results-by-formation": [
    "Were the two shapes used against similar opposition?",
    "Did the shape change during any of these matches?",
  ],
  "against-previous-block": [
    "Which of the two blocks had the harder fixture list?",
  ],
  "venue-split": ["Is the difference in results or in performance?"],
  "scoring-spread": ["Who else is getting into the positions that produce the goals?"],
  control: ["Where on the pitch was the possession held?"],
  "objective-progress": ["What does the gap to the target look like over the next five?"],
  standouts: ["Is this the same player each week, or the same role?"],
  margins: ["How many of these were level going into the last twenty minutes?"],
};

/** The open question for a finding, or null when the rule has none written. */
export function questionFor(findingId: string, seed: string): string | null {
  const base = findingId.startsWith("recurring-weakness") ? "recurring-weakness" : findingId;
  const options = QUESTIONS[base];
  return options === undefined ? null : pickVariant(options, seed, `question:${base}`);
}

/** How the card describes a window of matches. */
export function windowPhrase(count: number, from: string | null, to: string | null): string {
  if (count === 0) return "no matches";
  if (from === null || to === null) return `${count} match${count === 1 ? "" : "es"}, no dates recorded`;
  if (from === to) return `${count} match${count === 1 ? "" : "es"} on ${from}`;
  return `${count} matches from ${from} to ${to}`;
}
