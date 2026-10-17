/**
 * The season, read back as a whole.
 *
 * WHY THIS EXISTS. A season that ends without a moment of its own just becomes the next one: the table
 * resets, the objectives close silently, and nothing says what the manager actually did. This file
 * assembles the one page that closes a season, and the short list of things that should follow him into
 * the next one.
 *
 * TWO HALVES, NEVER MERGED. The save's half is the record - position, points, board codes - and the
 * observed half is what TouchlineOS watched and what the manager typed. Every section below names which
 * half it came from, because presenting a logged goal count as a save fact would be the app claiming
 * something the file never said.
 *
 * Pure: no database, no clock. `readSeasonReview` feeds it.
 */
import { weaknessFamily } from "../events/weakness-family";
import type { SeasonDossier } from "../services/season-archive-service";
import type { ReviewBlockBand } from "../review/types";
import type { HypothesisWithEvidence } from "../hypotheses/types";
import type { Assignment } from "../assignments/types";
import { ordinal } from "../ui/format";

export type CarryOverKind = "OBJECTIVE" | "HYPOTHESIS" | "ASSIGNMENT" | "FORMATION";

/** One thing that follows the manager into the next season unless he says otherwise. */
export interface CarryOverItem {
  kind: CarryOverKind;
  refId: string;
  label: string;
  detail: string;
}

export type SeasonSectionId =
  | "RECORD"
  | "OBJECTIVES"
  | "TACTICS"
  | "SQUAD"
  | "PATTERNS"
  | "QUESTIONS"
  | "YOUTH"
  | "MONEY";

export interface SeasonReviewSection {
  id: SeasonSectionId;
  title: string;
  /** Which half the section reads: the save, what we watched, or the manager's own record. */
  provenance: "SAVE" | "OBSERVED" | "USER";
  lines: string[];
  counts: Array<{ label: string; value: string }>;
}

export interface SeasonReview {
  season: number;
  complete: boolean;
  /** True when this is the season the career is in now, so the page can say "so far". */
  current: boolean;
  headline: string;
  subhead: string;
  sections: SeasonReviewSection[];
  carryOver: CarryOverItem[];
  /** What the season has to be remembered by, in the manager's own words where they exist. */
  closing: string | null;
}

export interface SeasonReviewInput {
  dossier: SeasonDossier;
  /** Every block the manager saved in this season. */
  blocks: ReviewBlockBand[];
  hypotheses: HypothesisWithEvidence[];
  assignments: Assignment[];
}

function money(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

/** The shape totals across the season's blocks, best first. */
function formationTallies(
  blocks: ReviewBlockBand[]
): Array<{ label: string; matches: number; points: number; rate: number }> {
  const groups = new Map<string, { label: string; matches: number; points: number }>();
  for (const block of blocks) {
    const label = block.formationLabel ?? "not recorded";
    const entry = groups.get(label) ?? { label, matches: 0, points: 0 };
    entry.matches += Math.round(block.possible / 3);
    entry.points += block.points;
    groups.set(label, entry);
  }
  return [...groups.values()]
    .map((entry) => ({ ...entry, rate: entry.matches === 0 ? 0 : entry.points / entry.matches }))
    .sort((left, right) => right.rate - left.rate);
}

/**
 * The composure of a season, in one line.
 *
 * It leads with the save's own position and points, because that is the number the manager is judged by and the
 * number he will remember. When the season is not finished it says so rather than pretending.
 */
function headlineFor(dossier: SeasonDossier): { headline: string; subhead: string } {
  const { fromSave } = dossier;
  const position = fromSave.tablePosition;
  const points = fromSave.points;
  const league = fromSave.leagueName ?? "the league";

  if (!dossier.complete) {
    return {
      headline: `Season ${dossier.season}, still running`,
      subhead:
        fromSave.played === null
          ? "The save has not written a record yet."
          : `${fromSave.played} played, ${points ?? 0} points${position === null ? "" : `, ${ordinal(position)} in ${league}`}.`,
    };
  }

  const record =
    fromSave.played === null
      ? ""
      : `${fromSave.played} played, ${fromSave.wins ?? 0}W ${fromSave.draws ?? 0}D ${fromSave.losses ?? 0}L, ${points ?? 0} points.`;

  return {
    headline:
      position === null
        ? `Season ${dossier.season} finished`
        : `Season ${dossier.season} finished ${ordinal(position)} in ${league}`,
    subhead: [record, dossier.current ? "This is the season you are in." : ""].filter(Boolean).join(" "),
  };
}

function recordSection(dossier: SeasonDossier): SeasonReviewSection {
  const { fromSave } = dossier;
  const lines: string[] = [];
  if (fromSave.goalsFor !== null && fromSave.goalsAgainst !== null) {
    const difference = fromSave.goalsFor - fromSave.goalsAgainst;
    lines.push(
      `${fromSave.goalsFor} scored, ${fromSave.goalsAgainst} conceded, ${difference >= 0 ? "+" : ""}${difference}.`
    );
  }
  if (fromSave.biggestSigning !== null) {
    lines.push(
      `Biggest buy: ${fromSave.biggestSigning.name}${fromSave.biggestSigning.fee === null ? "" : ` for ${money(fromSave.biggestSigning.fee)}`}.`
    );
  }
  if (fromSave.biggestSale !== null) {
    lines.push(
      `Biggest sale: ${fromSave.biggestSale.name}${fromSave.biggestSale.fee === null ? "" : ` for ${money(fromSave.biggestSale.fee)}`}.`
    );
  }
  if (fromSave.leagueTrophies !== null && fromSave.leagueTrophies > 0) {
    lines.push(`The save records ${fromSave.leagueTrophies} league title${fromSave.leagueTrophies === 1 ? "" : "s"}.`);
  }
  if (!dossier.coverage.observed) {
    lines.push("TouchlineOS was not watching this season, so there is nothing below from the observed half.");
  } else if (dossier.coverage.saveRecordWhenFirstSeen !== null) {
    const seen = dossier.coverage.saveRecordWhenFirstSeen;
    lines.push(
      `You started using TouchlineOS with the season already at ${seen.played ?? "?"} played and ${seen.points ?? "?"} points${seen.position === null ? "" : `, ${ordinal(seen.position)}`}.`
    );
  }

  return {
    id: "RECORD",
    title: "The record",
    provenance: "SAVE",
    lines,
    counts: [
      { label: "Position", value: fromSave.tablePosition === null ? "not recorded" : ordinal(fromSave.tablePosition) },
      { label: "Points", value: fromSave.points === null ? "not recorded" : String(fromSave.points) },
      { label: "Played", value: fromSave.played === null ? "not recorded" : String(fromSave.played) },
    ],
  };
}

/**
 * Objectives against outcomes.
 *
 * The user's target is judged mechanically because it carries a position. The save's own objective is quoted as a
 * code and left unjudged, because its result code has no decoded meaning and inventing one would be worse than
 * admitting we cannot read it.
 */
function objectivesSection(dossier: SeasonDossier): SeasonReviewSection {
  const observed = dossier.observed;
  if (observed === null) {
    return {
      id: "OBJECTIVES",
      title: "Objectives against outcomes",
      provenance: "USER",
      lines: ["Nothing was recorded for this season."],
      counts: [],
    };
  }

  const lines: string[] = [];
  for (const objective of observed.objectives) {
    if (objective.source === "USER") {
      const target =
        objective.targetPosition === null ? "no position target" : `target ${ordinal(objective.targetPosition)}`;
      lines.push(`${objective.text ?? "Your objective"}: ${target}, ${objective.outcome ?? "not judged"}`);
    } else {
      lines.push(
        `The board's own objective: ${objective.text ?? "not named"}. Result as the save gives it: ${objective.outcome ?? "not recorded"}.`
      );
    }
  }

  for (const objective of observed.boardObjectives) {
    lines.push(
      `${objective.title}: ${objective.status.toLowerCase()}${objective.notes === null ? "" : `, ${objective.notes}`}`
    );
  }

  if (lines.length === 0) lines.push("No objective was set for this season, by you or by the board.");

  return {
    id: "OBJECTIVES",
    title: "Objectives against outcomes",
    provenance: "USER",
    lines,
    counts: [
      { label: "Met", value: String(observed.objectives.filter((objective) => objective.status === "MET").length) },
      { label: "Missed", value: String(observed.objectives.filter((objective) => objective.status === "MISSED").length) },
      { label: "Board goals", value: String(observed.boardObjectives.length) },
    ],
  };
}

/**
 * The season's tactics.
 *
 * Read from the blocks the manager saved, because a block is the only place a shape is attached to a result. A
 * season with no blocks gets a line saying so rather than an empty table.
 */
function tacticsSection(blocks: ReviewBlockBand[]): SeasonReviewSection {
  const tallies = formationTallies(blocks);
  const recorded = tallies.filter((entry) => entry.label !== "not recorded");
  const lines: string[] = [];

  if (blocks.length === 0) {
    lines.push("No group debriefs were saved this season, so no shape can be tied to a result.");
  } else if (recorded.length === 0) {
    lines.push("The blocks this season carry no recorded shape, so there is no formation to compare.");
  } else {
    const best = recorded[0];
    lines.push(
      `${best.label} returned ${best.points} points from ${best.matches} matches, ${best.rate.toFixed(1)} a game.`
    );
    if (recorded.length > 1) {
      const worst = recorded[recorded.length - 1];
      lines.push(`${worst.label} returned ${worst.points} from ${worst.matches}, ${worst.rate.toFixed(1)} a game.`);
      lines.push(
        `The gap between your best and worst shape was ${(best.rate - worst.rate).toFixed(1)} points a game.`
      );
    }
  }

  return {
    id: "TACTICS",
    title: "Tactical evolution",
    provenance: "USER",
    lines,
    counts: [
      { label: "Blocks saved", value: String(blocks.length) },
      { label: "Shapes recorded", value: String(recorded.length) },
    ],
  };
}

function squadSection(dossier: SeasonDossier): SeasonReviewSection {
  const squad = dossier.observed?.squad ?? null;
  if (squad === null) {
    return {
      id: "SQUAD",
      title: "Squad development",
      provenance: "SAVE",
      lines: ["No snapshot pair covers this season, so nothing can be said about movement."],
      counts: [],
    };
  }

  const lines: string[] = [];
  if (squad.avgOverallFirst !== null && squad.avgOverallLast !== null) {
    const delta = squad.avgOverallLast - squad.avgOverallFirst;
    lines.push(
      `The squad's average overall went from ${squad.avgOverallFirst} to ${squad.avgOverallLast}${delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`}.`
    );
  }
  if (squad.risers.length > 0) {
    lines.push(
      `Up: ${squad.risers
        .slice(0, 3)
        .map((entry) => `${entry.name} ${entry.from} to ${entry.to}`)
        .join(", ")}.`
    );
  }
  if (squad.fallers.length > 0) {
    lines.push(
      `Down: ${squad.fallers
        .slice(0, 3)
        .map((entry) => `${entry.name} ${entry.from} to ${entry.to}`)
        .join(", ")}.`
    );
  }
  if (squad.arrivalCount > 0 || squad.departureCount > 0) {
    lines.push(`${squad.arrivalCount} arrived, ${squad.departureCount} left.`);
  }

  return {
    id: "SQUAD",
    title: "Squad development",
    provenance: "SAVE",
    lines,
    counts: [
      { label: "Squad", value: `${squad.sizeFirst} to ${squad.sizeLast}` },
      { label: "Risers", value: String(squad.risers.length) },
      { label: "Fallers", value: String(squad.fallers.length) },
    ],
  };
}

/**
 * What kept happening.
 *
 * The weaknesses are grouped through the same family table the news desk and the review use, so a season summary can
 * never disagree with the weekly one about what a note is about.
 */
function patternsSection(dossier: SeasonDossier): SeasonReviewSection {
  const digest = dossier.observed?.debriefs ?? null;
  if (digest === null || digest.logged === 0) {
    return {
      id: "PATTERNS",
      title: "What kept happening",
      provenance: "USER",
      lines: ["No match was logged this season, so there is nothing of yours to read back."],
      counts: [],
    };
  }

  const lines: string[] = [];
  const topScorer = digest.scorers[0];
  if (topScorer !== undefined) {
    lines.push(
      `${topScorer.name} led what you logged: ${topScorer.goals} goals and ${topScorer.assists} assists across ${topScorer.matches} matches.`
    );
  }
  const praised = digest.standouts[0];
  if (praised !== undefined) {
    lines.push(`You singled out ${praised.name} ${praised.times} time${praised.times === 1 ? "" : "s"}.`);
  }

  const families = new Map<string, { line: string; count: number }>();
  for (const weakness of digest.weaknesses) {
    const family = weaknessFamily(weakness.note);
    if (family === null) continue;
    const entry = families.get(family.key) ?? { line: family.line, count: 0 };
    entry.count += 1;
    families.set(family.key, entry);
  }
  const worst = [...families.values()].sort((left, right) => right.count - left.count)[0];
  if (worst !== undefined) {
    lines.push(
      `The note you made most often was about ${worst.line}, ${worst.count} time${worst.count === 1 ? "" : "s"}.`
    );
  }

  return {
    id: "PATTERNS",
    title: "What kept happening",
    provenance: "USER",
    lines,
    counts: [
      { label: "Matches logged", value: String(digest.logged) },
      { label: "Goals logged", value: String(digest.goalsFor) },
      { label: "Conceded", value: String(digest.goalsAgainst) },
    ],
  };
}

function questionsSection(
  hypotheses: HypothesisWithEvidence[],
  assignments: Assignment[]
): SeasonReviewSection {
  const open = hypotheses.filter((hypothesis) => hypothesis.status !== "RESOLVED");
  const lines: string[] = [];
  for (const hypothesis of open.slice(0, 4)) {
    lines.push(
      `${hypothesis.claim} ${hypothesis.matchesSeen} of ${hypothesis.reviewAfterMatches} matches read, ${hypothesis.forCount} for and ${hypothesis.againstCount} against.`
    );
  }
  for (const assignment of assignments.filter((entry) => entry.status === "ACTIVE").slice(0, 3)) {
    lines.push(
      assignment.type === "POINTS_TARGET"
        ? `An open points target of ${assignment.targetPoints ?? "?"} points.`
        : assignment.type === "TACTICAL_EXPERIMENT"
          ? `An open experiment in ${assignment.formationLabel ?? "a shape"}.`
          : `An open watch on ${assignment.playerId ?? "a player"}.`
    );
  }
  if (lines.length === 0) lines.push("Nothing was left open. Nothing carries over.");

  return {
    id: "QUESTIONS",
    title: "Questions still open",
    provenance: "USER",
    lines,
    counts: [
      { label: "Questions", value: String(open.length) },
      { label: "Assignments", value: String(assignments.filter((entry) => entry.status === "ACTIVE").length) },
    ],
  };
}

function youthSection(dossier: SeasonDossier): SeasonReviewSection {
  const squad = dossier.observed?.squad ?? null;
  const board = dossier.observed?.boardObjectives ?? [];
  const youthGoals = board.filter((objective) => objective.category.toUpperCase().includes("YOUTH"));
  const lines: string[] = [];
  if (squad !== null) {
    lines.push(`${squad.youthCount} of the squad are youth prospects at the end of the season.`);
    for (const riser of squad.risers.filter((entry) => entry.delta >= 2).slice(0, 2)) {
      lines.push(`${riser.name} climbed ${riser.delta} overall, from ${riser.from} to ${riser.to}.`);
    }
  }
  for (const goal of youthGoals) {
    lines.push(`Board goal: ${goal.title}, ${goal.status.toLowerCase()}.`);
  }
  if (lines.length === 0) lines.push("Nothing about the youth pathway was recorded this season.");

  return {
    id: "YOUTH",
    title: "The pathway",
    provenance: "SAVE",
    lines,
    counts: [{ label: "Prospects", value: squad === null ? "not recorded" : String(squad.youthCount) }],
  };
}

function moneySection(dossier: SeasonDossier): SeasonReviewSection {
  const finance = dossier.observed?.finance ?? null;
  if (finance === null) {
    return {
      id: "MONEY",
      title: "Money",
      provenance: "SAVE",
      lines: ["No budget figures were recorded for this season, so nothing here would be a fact."],
      counts: [],
    };
  }
  const lines: string[] = [];
  if (finance.transferBudget.first !== null || finance.transferBudget.last !== null) {
    lines.push(
      `Transfer budget moved from ${finance.transferBudget.first === null ? "not recorded" : money(finance.transferBudget.first)} to ${finance.transferBudget.last === null ? "not recorded" : money(finance.transferBudget.last)}.`
    );
  }
  if (finance.recordBuy !== null) lines.push(`The biggest fee paid was ${money(finance.recordBuy)}.`);
  if (finance.recordSale !== null) lines.push(`The biggest fee received was ${money(finance.recordSale)}.`);
  if (lines.length === 0) lines.push("The budgets were not recorded, so this stays empty rather than guessed.");

  return {
    id: "MONEY",
    title: "Money",
    provenance: "SAVE",
    lines,
    counts: [
      {
        label: "Wage bill",
        value: finance.wageBudget.last === null ? "not recorded" : money(finance.wageBudget.last),
      },
    ],
  };
}

/** The last reflection the manager wrote, which is the closest thing a season has to a closing word. */
function closingWordOf(dossier: SeasonDossier): string | null {
  const reflections = dossier.observed?.debriefs.reflections ?? [];
  const last = reflections[0];
  return last === undefined ? null : last.note;
}

/**
 * Everything that should follow the manager into the next season.
 *
 * The default is always to keep, and nothing here can hold a transition up: a row is a suggestion he can turn down,
 * not a gate. Each item names the object it points at, so the decision is stored against a stable id rather than a
 * sentence that may since have been edited.
 */
export function carryOverFrom(input: SeasonReviewInput): CarryOverItem[] {
  const items: CarryOverItem[] = [];
  const observed = input.dossier.observed;

  const missedTarget = observed?.objectives.find(
    (objective) => objective.source === "USER" && objective.status === "MISSED"
  );
  if (missedTarget !== undefined) {
    items.push({
      kind: "OBJECTIVE",
      refId: missedTarget.id,
      label: `Target ${missedTarget.targetPosition === null ? "the same position" : ordinal(missedTarget.targetPosition)} again`,
      detail: missedTarget.outcome ?? "The target was missed, so it is offered again next season.",
    });
  }

  for (const hypothesis of input.hypotheses.filter((entry) => entry.status !== "RESOLVED").slice(0, 4)) {
    items.push({
      kind: "HYPOTHESIS",
      refId: hypothesis.id,
      label: hypothesis.claim,
      detail: `${hypothesis.matchesSeen} of ${hypothesis.reviewAfterMatches} matches read. It keeps counting if you carry it.`,
    });
  }

  for (const assignment of input.assignments.filter((entry) => entry.status === "ACTIVE").slice(0, 3)) {
    items.push({
      kind: "ASSIGNMENT",
      refId: assignment.id,
      label:
        assignment.type === "POINTS_TARGET"
          ? `Points target of ${assignment.targetPoints ?? "?"}`
          : assignment.type === "TACTICAL_EXPERIMENT"
            ? `Experiment in ${assignment.formationLabel ?? "a shape"}`
            : `Watch on ${assignment.playerId ?? "a player"}`,
      detail: "It stays active into the new season unless you drop it.",
    });
  }

  const tallies = formationTallies(input.blocks).filter((entry) => entry.label !== "not recorded");
  if (tallies.length > 1) {
    const best = tallies[0];
    items.push({
      kind: "FORMATION",
      refId: best.label,
      label: `Start next season in ${best.label}`,
      detail: `It was your best shape this season at ${best.rate.toFixed(1)} points a game.`,
    });
  }

  return items;
}

/** The whole page. */
export function composeSeasonReview(input: SeasonReviewInput): SeasonReview {
  const { dossier } = input;
  const { headline, subhead } = headlineFor(dossier);
  const sections = [
    recordSection(dossier),
    objectivesSection(dossier),
    tacticsSection(input.blocks),
    squadSection(dossier),
    patternsSection(dossier),
    questionsSection(input.hypotheses, input.assignments),
    youthSection(dossier),
    moneySection(dossier),
  ].filter((section) => section.lines.length > 0 || section.counts.length > 0);

  return {
    season: dossier.season,
    complete: dossier.complete,
    current: dossier.current,
    headline,
    subhead,
    sections,
    carryOver: carryOverFrom(input),
    closing: closingWordOf(dossier),
  };
}

/** A carry-over row's storage key: stable per object. */
export function carryOverOptionId(kind: CarryOverKind, refId: string): string {
  return `${kind}:${refId}`;
}

/** The review key carry-over decisions live under, per the plan's single decisions table. */
export function carryOverReviewKey(season: number): string {
  return `carry:${season}`;
}
