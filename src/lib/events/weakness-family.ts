/**
 * The weakness note families, shared by the news desk and the review.
 *
 * A manager's note is his own shorthand and it is not written for print: "Switched off after scoring" is a note to
 * self, not a sentence in a paper. Both readers therefore need the same translation from a note to the thing it is
 * about, and having two tables would let the paper and the review describe the same note differently.
 *
 * The `key` is stable per family, which is what a story id or a repeat count is built from. An id that embedded the
 * note itself would change with a stray capital letter and republish a story the reader had already seen.
 */

/** A note reduced to a shape that can be compared. */
export function normaliseNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The families, in match order: the first one a note hits wins. */
export const WEAKNESS_FAMILIES: ReadonlyArray<{ key: string; test: RegExp; line: string }> = [
  {
    key: "switching-off",
    test: /switch(ed|ing)? off|concentrat|focus|complacen|mentali|off the pace/,
    line: "a spell of switching off after the goal",
  },
  {
    key: "set-pieces",
    test: /set piece|setpiece|corner|free kick|dead ball|cross/,
    line: "the set pieces",
  },
  {
    key: "counter-attack",
    test: /counter|break|transition|caught on|exposed|played through/,
    line: "the way the side was caught upfield",
  },
  {
    key: "finishing",
    test: /finish|chance|wasteful|clinical|missed|proflig|conversion/,
    line: "what happened in front of goal",
  },
  {
    key: "passing",
    test: /pass|possession|control|sloppy|loose|giveaway|gave the ball/,
    line: "the passing",
  },
  {
    key: "tempo",
    test: /press|intensity|energy|slow|lethargic|flat|tempo/,
    line: "the tempo",
  },
  {
    key: "shape",
    test: /defen|back line|backline|shape|offside|discipline|foul/,
    line: "the shape without the ball",
  },
  {
    key: "late-on",
    test: /fitness|tired|legs|fade|stamina|late/,
    line: "the way the match ran away late on",
  },
  { key: "injuries", test: /injur|knock|fitness doubt/, line: "the injuries" },
  { key: "goalkeeping", test: /keeper|goalkeep|goalie|shot stopping/, line: "the goalkeeping" },
  { key: "width", test: /width|wing|flank|wide/, line: "the width" },
  { key: "bench", test: /sub|bench|changes|rotation/, line: "the changes from the bench" },
];

/**
 * What a weakness note amounts to.
 *
 * A note that matches nothing returns null and the caller falls back to a weaker but never wrong sentence.
 */
export function weaknessFamily(note: string): { key: string; line: string } | null {
  const text = normaliseNote(note);
  if (text.length === 0) return null;
  const found = WEAKNESS_FAMILIES.find((family) => family.test.test(text));
  return found ? { key: found.key, line: found.line } : null;
}
