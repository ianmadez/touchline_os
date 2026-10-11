/**
 * Whether the media come looking for the manager after a match, and what they actually ask.
 *
 * This is the one place that decides, and it is a pure function of the match plus a little context, so the
 * same debrief always gets the same answer: a manager who re-opens a saved debrief must not be asked a second
 * time, and a manager who said nothing is not asked again just because they looked.
 *
 * Not every match is worth a word. A press room is only interested in something that HAPPENED - a heavy
 * result, a pile of goals, a clean sheet in a win, a goal in the last few minutes - and even then it does not
 * always come asking, which is what keeps it from feeling like a form to fill in.
 *
 * WHAT THEY ASK IS THE POINT. The first version of this asked "The media want a word on the 4-0 win over
 * Harborough United", which is not a question and reads like a notification. A reporter asks something a
 * manager can actually answer, about the match that has just happened: the margin, the goalscorer, the
 * minute it turned, the clean sheet, what it does to the season, whether a cup run is worth the league
 * points. Every question below is answerable from the match itself, which is what stops it sounding like a
 * machine reading a template.
 *
 * WHO ASKS IS AUTHORED FICTION, from the same press library the paper uses, so the person in the room is the
 * person who writes it up afterwards.
 */

import { bylineFor } from "./outlets";

export type MediaInterest = "STRONG" | "MEDIUM" | "ORDINARY" | "NONE";

export interface MediaFacts {
  opponent: string | null;
  ourScore: number;
  theirScore: number;
  goalMinutes: number[];
  concededMinutes: number[];
  /** Everything below is optional so an older caller keeps working; each one only sharpens the question. */
  competition?: string | null;
  venue?: string | null;
  scorers?: string[];
  clubName?: string;
  countryId?: number | null;
}

export interface MediaAsk {
  /** Whether the prompt should appear at all. */
  asked: boolean;
  /** How interesting the match was, so the prompt can be worded with more or less weight. */
  interest: MediaInterest;
  /** What the comment would be about: "the 4-0 win over Harborough United". */
  subject: string;
  /** The fictional outlet that came asking, and who from. Null when nobody did. */
  outlet: string | null;
  writer: string | null;
  writerRole: string | null;
  /** The question on its own, ready to print. */
  question: string;
  /** Ready to show: who is asking, and what they want to know. */
  prompt: string;
}

/** An FNV-1a hash, matching the news engine's so a seed means the same thing in both. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

function pick(options: readonly string[], seed: string, slot: string): string {
  return options[hash(`${seed}|${slot}`) % options.length];
}

/** How likely the press room is to come looking, by how much happened. */
const ASK_CHANCE: Record<Exclude<MediaInterest, "NONE">, number> = {
  STRONG: 85,
  MEDIUM: 60,
  ORDINARY: 25,
};

/**
 * The media's interest in one match, whether they act on it, and what they ask.
 *
 * `seed` is the debrief's own event id, so the roll is a property of the match rather than of the moment
 * the screen asked.
 */
export function mediaAskFor(seed: string, facts: MediaFacts): MediaAsk {
  const ours = facts.ourScore;
  const theirs = facts.theirScore;
  const total = ours + theirs;
  const margin = Math.abs(ours - theirs);
  const won = ours > theirs;
  const lost = ours < theirs;
  const against = facts.opponent ?? "the opposition";
  const scoreline = `${Math.max(ours, theirs)}-${Math.min(ours, theirs)}`;
  const lateGoal = [...facts.goalMinutes, ...facts.concededMinutes].some((minute) => minute >= 85);
  const earlyGoal = facts.goalMinutes.some((minute) => minute <= 10);
  const scorer = facts.scorers?.[0] ?? null;
  const cleanSheet = theirs === 0;
  const competition = facts.competition?.trim() || null;
  const isCup =
    competition !== null && /cup|trophy|shield|pokal|coppa|beker|taça|taca|coupe|libertadores/i.test(competition);

  let interest: MediaInterest = "NONE";
  let subject = "";
  if (margin >= 3) {
    interest = "STRONG";
    subject = won ? `the ${scoreline} win over ${against}` : `the ${scoreline} defeat against ${against}`;
  } else if (total >= 5) {
    interest = "STRONG";
    subject = `a ${total}-goal game with ${against}`;
  } else if (total >= 4) {
    interest = "MEDIUM";
    subject = `the ${scoreline} against ${against}`;
  } else if (won && cleanSheet) {
    interest = "MEDIUM";
    subject = `the clean sheet against ${against}`;
  } else if (lateGoal) {
    interest = "MEDIUM";
    subject = `the finish against ${against}`;
  } else if (won || lost) {
    interest = "ORDINARY";
    subject = won ? `the win over ${against}` : `the defeat against ${against}`;
  }

  if (interest === "NONE") {
    return {
      asked: false,
      interest,
      subject: "",
      outlet: null,
      writer: null,
      writerRole: null,
      question: "",
      prompt: "",
    };
  }

  // The question is built from what actually happened, so it can always be answered: a margin, a hatful of
  // goals, a scorer, the minute it turned, a clean sheet, the cup, or what the result does to the season.
  const candidates: string[] = [];
  if (margin >= 3 && won) {
    candidates.push(`whether a ${scoreline} scoreline flattered ${against} at all`);
    candidates.push(`what you changed to get a margin like that`);
    candidates.push(`whether that was the most complete performance of your time here`);
  }
  if (margin >= 3 && lost) {
    candidates.push(`what went wrong after the ${facts.concededMinutes[0] ?? 1}th minute`);
    candidates.push(`whether the players' heads dropped after the second went in`);
    candidates.push(`how much of that was about ${against} rather than about your own players`);
  }
  if (total >= 4) {
    candidates.push(`whether a game like that says anything about the defence`);
    candidates.push(`whether you would rather win 4-3 than 1-0`);
  }
  if (scorer) {
    candidates.push(`whether ${scorer} has become undroppable`);
    candidates.push(`what ${scorer} gives you that nobody else in the squad does`);
    candidates.push(`whether ${scorer} is ahead of where you expected him to be`);
  }
  if (cleanSheet && won) {
    candidates.push(`whether the back line has finally settled`);
    candidates.push(`how much of that clean sheet belongs to the keeper`);
  }
  if (lateGoal) {
    candidates.push(`what you said to the players before it went to the wire`);
    candidates.push(`whether you thought the chance had gone`);
  }
  if (earlyGoal) {
    candidates.push(`whether scoring that early changed the plan`);
  }
  if (isCup) {
    candidates.push(`how much the ${competition} matters to you this season`);
    candidates.push(`whether a cup run is worth the league points it costs`);
  }
  candidates.push(`whether that result tells you anything about this squad you did not already know`);
  candidates.push(`where you think that leaves your season`);
  if (won) candidates.push(`whether you are starting to believe in this group`);
  if (lost) candidates.push(`whether anyone in that dressing room can say they played well`);

  const raw = pick(candidates, seed, "question");
  const question = `${raw.charAt(0).toUpperCase()}${raw.slice(1)}?`;
  const byline = bylineFor(seed, facts.countryId ?? null, facts.clubName ?? "the club", "press");
  const asked = hash(`${seed}|media`) % 100 < ASK_CHANCE[interest];

  // Strong interest gets the scene set first, because a heavy result is a room with people standing in it.
  const lead =
    interest === "STRONG"
      ? `${byline.outlet} are in the room after ${subject}. ${byline.writer} wants to know ${raw}.`
      : `${byline.writer} of ${byline.outlet} wants to know ${raw}.`;

  return {
    asked,
    interest,
    subject,
    outlet: byline.outlet,
    writer: byline.writer,
    writerRole: byline.writerRole,
    question,
    prompt: lead,
  };
}
