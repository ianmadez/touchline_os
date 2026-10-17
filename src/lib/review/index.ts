/**
 * `composeReview`: the one entry point.
 *
 * Given a window, a context and a block band, this produces the whole Review. Nothing here reads the clock, the
 * network or a random number, and nothing here writes anything, so regenerating a review over the same data gives
 * the same object.
 *
 * THE SECTIONS ARE DERIVED, NEVER LISTED BY HAND. A finding lands in "What the numbers say" because it needed a
 * figure, and in "What the scores alone say" because it did not. That is why a block of group logged matches reads
 * as a scoreline report without a single special case: the figure rules decline, and the section that needed them
 * says so in its counts instead of printing zeroes.
 */
import { buildContrast } from "./contrast";
import { questionFor, sectionOpener, SECTION_ORDER, SECTION_TITLES, windowPhrase } from "./copy";
import { evaluateFindings } from "./findings";
import { buildOptions } from "./options";
import { buildWindow, type WindowInput, type WindowResult } from "./window";
import type {
  Finding,
  Review,
  ReviewContext,
  ReviewMatch,
  ReviewSection,
  ReviewSectionId,
} from "./types";

export interface ComposeReviewInput extends WindowInput {
  context: ReviewContext;
  /** The block band, when the block itself was summarised. Passed in so the band and the review cannot disagree. */
  band: Review["block"];
}

function tally(matches: ReviewMatch[]): Review["record"] {
  const played = matches.filter((match) => match.points !== null);
  const wins = played.filter((match) => match.points === 3).length;
  const draws = played.filter((match) => match.points === 1).length;
  const losses = played.filter((match) => match.points === 0).length;
  return {
    wins,
    draws,
    losses,
    goalsFor: matches.reduce((total, match) => total + (match.goalsFor ?? 0), 0),
    goalsAgainst: matches.reduce((total, match) => total + (match.goalsAgainst ?? 0), 0),
    points: wins * 3 + draws,
    possible: played.length * 3,
    played: played.length,
  };
}

function restingOf(matches: ReviewMatch[]): Review["resting"] {
  const withFigures = matches.filter((match) => match.hasFigures).length;
  const scorelineOnly = matches.filter(
    (match) => !match.hasFigures && match.goalsFor !== null && match.goalsAgainst !== null
  ).length;
  return {
    withFigures,
    scorelineOnly,
    notRecorded: matches.length - withFigures - scorelineOnly,
  };
}

function recordLine(record: Review["record"]): string {
  if (record.played === 0) return "No result was reported in this window.";
  const parts = [
    `${record.points} of ${record.possible} points`,
    `${record.wins}W ${record.draws}D ${record.losses}L`,
    `${record.goalsFor} scored, ${record.goalsAgainst} conceded`,
  ];
  return `${parts.join(". ")}.`;
}

function section(
  id: ReviewSectionId,
  seed: string,
  findings: Finding[],
  paragraphs: string[],
  counts: Array<{ label: string; value: string }> = []
): ReviewSection {
  return {
    id,
    title: SECTION_TITLES[id],
    paragraphs: [sectionOpener(id, seed), ...paragraphs].filter((line) => line.trim() !== ""),
    findings,
    counts,
  };
}

export function composeReview(input: ComposeReviewInput): Review {
  const window: WindowResult = buildWindow(input);
  const { matches } = window;
  const seed = window.key;
  const findings = evaluateFindings(matches, input.context);
  const figuresFindings = findings.filter((finding) => finding.needsFigures);
  const scoreFindings = findings.filter((finding) => !finding.needsFigures);
  const record = tally(matches);
  const resting = restingOf(matches);
  const { offered, blocked } = buildOptions(matches, input.context, input.band);
  const thin = resting.withFigures < 5;
  const contrast = buildContrast(matches);

  const windowParagraphs = [
    windowPhrase(matches.length, window.window.from, window.window.to) + ".",
    recordLine(record),
    ...(window.merged > 0
      ? [`${window.merged} ${window.merged === 1 ? "match was" : "matches were"} logged both ways and counted once.`]
      : []),
  ];

  const notClaiming = [
    ...new Set(
      findings.flatMap((finding) => finding.confounds).filter((line) => line.trim() !== "")
    ),
  ];

  const questions = findings
    .map((finding) => questionFor(finding.id, seed))
    .filter((question): question is string => question !== null);

  const sections: ReviewSection[] = SECTION_ORDER.map((id) => {
    switch (id) {
      case "WINDOW":
        return section(id, seed, [], windowParagraphs, [
          { label: "Matches", value: String(matches.length) },
          { label: "Recorded from", value: window.window.from ?? "not recorded" },
          { label: "Recorded to", value: window.window.to ?? "not recorded" },
        ]);
      case "NUMBERS":
        return section(
          id,
          seed,
          figuresFindings,
          figuresFindings.length === 0
            ? [
                "No rule that needs a figure had enough of one to report. Nothing here is a zero: a match with no figures is a match with no figures.",
              ]
            : [],
          [
            { label: "Matches with figures", value: `${resting.withFigures} of ${matches.length}` },
          ]
        );
      case "SCORES":
        return section(id, seed, scoreFindings, []);
      case "CONTRAST":
        return section(
          id,
          seed,
          [],
          contrast === null
            ? ["Two matches are needed before anything can be set against anything else."]
            : [
                contrast.line,
                `${contrast.basis === "FIGURES" ? "Best" : "Better"}: ${contrast.bestLabel}. ${contrast.basis === "FIGURES" ? "Thinnest" : "Other"}: ${contrast.worstLabel}.`,
                contrast.basis === "FIGURES"
                  ? "Both matches had a figure behind them."
                  : "Neither comparison uses a figure: this window has scorelines only.",
              ],
          []
        );
      case "PREVIOUS":
        return section(
          id,
          seed,
          findings.filter((finding) => finding.id === "against-previous-block"),
          input.context.previousBlock === null
            ? ["There is no earlier block in this season to compare against."]
            : [],
          []
        );
      case "NOT_CLAIMING":
        return section(id, seed, [], notClaiming.slice(0, 8), []);
      case "RESTS_ON":
        return section(id, seed, [], [], [
          { label: "With figures", value: `${resting.withFigures} of ${matches.length}` },
          { label: "Scoreline only", value: `${resting.scorelineOnly} of ${matches.length}` },
          { label: "Not recorded", value: `${resting.notRecorded} of ${matches.length}` },
        ]);
      case "QUESTIONS":
        return section(
          id,
          seed,
          [],
          questions.length === 0
            ? ["Nothing in this window raises a question the scoreline cannot answer."]
            : questions,
          []
        );
    }
  });

  return {
    key: window.key,
    kind: input.request.kind === "BLOCK" ? "BLOCK" : "WINDOW",
    matches,
    window: window.window,
    record,
    mergedBothWays: window.merged,
    contrast,
    findings,
    options: offered,
    sections,
    block: input.band,
    thin,
    resting,
    blockedBy: blocked,
  };
}
