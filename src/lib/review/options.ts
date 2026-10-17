/**
 * The decision step: what the review offers to do next.
 *
 * AN OPTION IS A PROPOSAL, NOT AN INSTRUCTION. Each one names what accepting it would create, and each one is
 * offered only when the window can support it: no shape change without a second formation, no points target
 * without a block that missed its band.
 *
 * THE RULES PROFILE ONLY EVER REMOVES. A blocked option is not shown at all, and the reason it is gone is kept so
 * the card can say which toggle removed it. An empty decision step with no explanation would read as a bug.
 */
import { formationFamily } from "../events/tactics-stamp";
import { DEFAULT_MATCHES_TARGET } from "../assignments/propose";
import type { AssignmentProposal, PointsTargetProposal } from "../assignments/types";
import { ordinal } from "../ui/format";
import type {
  ReviewBlockBand,
  ReviewContext,
  ReviewMatch,
  ReviewOption,
  RulesToggleId,
} from "./types";

export interface OptionOutcome {
  offered: ReviewOption[];
  /** The toggles that removed something, in the order the toggle list declares them. */
  blocked: RulesToggleId[];
}

const TOGGLE_ORDER: RulesToggleId[] = [
  "keepFormationFamily",
  "neverRotateKeyPlayers",
  "fixedPointsBand",
  "preferYouthMinutes",
];

function isOn(context: ReviewContext, toggle: RulesToggleId): boolean {
  return context.profile.toggles[toggle] === true;
}

function pointsPerGame(matches: ReviewMatch[]): number {
  if (matches.length === 0) return 0;
  return matches.reduce((total, match) => total + (match.points ?? 0), 0) / matches.length;
}

/** The shape with the best return in the window, and the shape with the worst. */
function formationRates(matches: ReviewMatch[]): {
  best: { label: string; formationName: string; rate: number; count: number; points: number } | null;
  worst: { label: string; formationName: string; rate: number; count: number; points: number } | null;
} {
  const groups = new Map<string, { label: string; formationName: string; matches: ReviewMatch[] }>();
  for (const match of matches) {
    if (match.formation === null || match.points === null) continue;
    const entry = groups.get(match.formation.label) ?? {
      label: match.formation.label,
      formationName: match.formation.formationName,
      matches: [],
    };
    entry.matches.push(match);
    groups.set(match.formation.label, entry);
  }
  if (groups.size < 2) return { best: null, worst: null };
  const ranked = [...groups.values()]
    .map((group) => ({
      label: group.label,
      formationName: group.formationName,
      rate: pointsPerGame(group.matches),
      count: group.matches.length,
      points: group.matches.reduce((total, match) => total + (match.points ?? 0), 0),
    }))
    .sort((left, right) => right.rate - left.rate);
  return { best: ranked[0], worst: ranked[ranked.length - 1] };
}

/** The player named most often as a standout, with the count. */
function mostNamed(matches: ReviewMatch[]): { name: string; count: number } | null {
  const counted = new Map<string, number>();
  for (const match of matches) {
    for (const name of match.standouts) counted.set(name, (counted.get(name) ?? 0) + 1);
  }
  const top = [...counted.entries()].sort((left, right) => right[1] - left[1])[0];
  return top ? { name: top[0], count: top[1] } : null;
}

  /** A player watch, in the shape the assignment store takes. */
  function watchFor(playerName: string, rationale: string): AssignmentProposal {
    return {
      type: "PLAYER_WATCH",
      playerName,
      matchesTarget: DEFAULT_MATCHES_TARGET,
      rationale,
    };
  }

export function buildOptions(
  matches: ReviewMatch[],
  context: ReviewContext,
  block: ReviewBlockBand | null,
  pointsTarget: PointsTargetProposal | null
): OptionOutcome {
  const candidates: ReviewOption[] = [];
  const scored = matches.filter((match) => match.points !== null);
  const windowRate = pointsPerGame(scored);

  const { best, worst } = formationRates(matches);
  if (best !== null && worst !== null && best.rate >= windowRate) {
    candidates.push({
      id: "keep-system",
      label: `Keep ${best.label}`,
      rationale: `${best.label} has returned ${best.points} points from ${best.count} matches, which is at or above the window's ${windowRate.toFixed(1)} a game.`,
      creates: "A monitor on the formation for the next block, so the next review compares like with like.",
      chips: ["monitor the formation", "next block"],
      blockedBy: null,
      // Nothing to follow afterwards: keeping the shape you already have is not a change to measure.
      assignment: null,
    });
  }

  if (best !== null && worst !== null && best.points - worst.points >= 3) {
    const changesFamily =
      formationFamily(best.formationName) !== formationFamily(worst.formationName);
    candidates.push({
      id: "change-shape",
      label: `Change one thing about ${worst.label}`,
      rationale: `${worst.label} has returned ${worst.points} from ${worst.count}; the best shape in the window returned ${best.points}.`,
      creates: "A tactical experiment for the next block, with this block as the baseline.",
      chips: ["tactical experiment", "field next block"],
      blockedBy: changesFamily && isOn(context, "keepFormationFamily") ? "keepFormationFamily" : null,
      assignment: {
        type: "TACTICAL_EXPERIMENT",
        formationLabel: best.label,
        matchesTarget: DEFAULT_MATCHES_TARGET,
        baselinePointsPerGame: Math.round(worst.rate * 10) / 10,
        rationale: `${worst.label} returned ${worst.points} from ${worst.count}; ${best.label} returned ${best.points} from ${best.count}.`,
      },
    });
  }

  const named = mostNamed(matches);
  if (named !== null) {
    const isKey = context.keyPlayerNames.some(
      (name) => name.toLowerCase() === named.name.toLowerCase()
    );
    const age = context.playerAges[named.name] ?? null;
    const restBlocked = isKey && isOn(context, "neverRotateKeyPlayers");
    const youngBlocked = age !== null && age <= 21 && named.count >= 2 && isOn(context, "preferYouthMinutes");
    const hasRestVariant = isKey;
    const hasYouthVariant = age !== null && age <= 21 && named.count >= 2;

    // The specific variants replace the plain watch, and a BLOCKED variant falls back to it. That is the difference
    // between "you may not rest him" and "you may not watch him": the toggle removes the rest, not the interest.
    let pushedSpecific = false;
    if (hasRestVariant) {
      candidates.push({
        id: "rest-player",
        label: `Rest ${named.name} for a match`,
        rationale: `${named.name} is marked as a key player and you named him in ${named.count} match${named.count === 1 ? "" : "es"}.`,
        creates: "A player watch with a rest built into it.",
        chips: ["player watch", "rest one match"],
        blockedBy: restBlocked ? "neverRotateKeyPlayers" : null,
        assignment: watchFor(named.name, `${named.name} is marked as a key player and you named him in ${named.count} match${named.count === 1 ? "" : "es"}.`),
      });
      pushedSpecific = pushedSpecific || !restBlocked;
    }

    if (hasYouthVariant) {
      candidates.push({
        id: "leave-out-young-player",
        label: `Leave ${named.name} out for a match`,
        rationale: `${named.name} is ${age} and you named him in ${named.count} matches.`,
        creates: "A player watch that builds a rest into the next block.",
        chips: ["player watch", "one match out"],
        blockedBy: youngBlocked ? "preferYouthMinutes" : null,
        assignment: watchFor(named.name, `${named.name} is ${age} and you named him in ${named.count} matches.`),
      });
      pushedSpecific = pushedSpecific || !youngBlocked;
    }

    if (!pushedSpecific) {
      candidates.push({
        id: "watch-player",
        label: `Watch ${named.name}`,
        rationale: `You named ${named.name} in ${named.count} of the ${matches.length} matches.`,
        creates: "A player watch, so the next block reports on him rather than on the team alone.",
        chips: ["player watch", "next block"],
        blockedBy: null,
        assignment: watchFor(named.name, `You named ${named.name} in ${named.count} of the ${matches.length} matches.`),
      });
    }
  }

  // A points target is only offered when a figure exists to put on it. The option promises a target worked out from
  // the blocks before it, and offering it with no block behind it would promise a number nobody had calculated.
  if (
    pointsTarget !== null &&
    block !== null &&
    (block.verdict === "BELOW_TARGET" || block.verdict === "CONCERN")
  ) {
    candidates.push({
      id: "adjust-target",
      label: `Set the next block's points target`,
      rationale: `Block ${block.blockIndex} finished on ${block.points} against a band of ${block.targetMin} to ${block.targetMax}. The target comes out at ${pointsTarget.value}.`,
      creates: "A points target for the next block, with the band filled in before you save it.",
      chips: ["points target", "next block"],
      blockedBy: isOn(context, "fixedPointsBand") ? "fixedPointsBand" : null,
      assignment: pointsTarget,
    });
  }

  const objectiveTarget = context.objective?.targetPosition ?? null;
  if (
    pointsTarget !== null &&
    objectiveTarget !== null &&
    context.currentPosition !== null &&
    context.currentPosition > objectiveTarget
  ) {
    candidates.push({
      id: "close-the-gap",
      label: `Close the gap to ${ordinal(objectiveTarget)}`,
      rationale: `You are ${ordinal(context.currentPosition)} against a target of ${ordinal(objectiveTarget)}. The points target comes out at ${pointsTarget.value}.`,
      creates: "A points target for the next block, worked out from the two blocks before it.",
      chips: ["points target", "next block"],
      blockedBy: isOn(context, "fixedPointsBand") ? "fixedPointsBand" : null,
      assignment: pointsTarget,
    });
  }

  const withFigures = matches.filter((match) => match.hasFigures).length;
  if (withFigures < 5) {
    candidates.push({
      id: "look-again",
      label: `Look again after ${withFigures === 0 ? "a few" : 5 - withFigures} more matches`,
      rationale:
        withFigures === 0
          ? "No match in this window has a figure behind it, so everything here is a scoreline."
          : `${withFigures} of ${matches.length} matches have a figure behind them.`,
      creates: "A reminder to run this review again once the sample is bigger.",
      chips: ["review reminder"],
      blockedBy: null,
      // A reminder is a decision, not a commitment, so there is no figure to follow.
      assignment: null,
    });
  }

  const offered = candidates.filter((option) => option.blockedBy === null);
  const blocked = TOGGLE_ORDER.filter((toggle) =>
    candidates.some((option) => option.blockedBy === toggle)
  );
  return { offered: capOffered(offered), blocked };
}

/**
 * At most four options.
 *
 * A manager looking at a run of matches can hold a few decisions, not a menu. The cap is by declared priority
 * rather than by the order the builders ran in, so adding a rule later cannot push the important choice off the
 * end: keeping the shape you already trust comes before a change, a change comes before a watch, and a points
 * target sits behind both because it is the least specific of the four.
 */
const PRIORITY: string[] = [
  "keep-system",
  "change-shape",
  "watch-player",
  "rest-player",
  "adjust-target",
  "close-the-gap",
  "look-again",
];

function capOffered(options: ReviewOption[]): ReviewOption[] {
  return [...options]
    .sort((left, right) => PRIORITY.indexOf(left.id) - PRIORITY.indexOf(right.id))
    .slice(0, 4);
}
