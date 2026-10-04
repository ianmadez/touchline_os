/**
 * Realism mode: how plausible a move is, and how strict the advisory warnings are.
 *
 * This module was deleted and is now back, because deleting it exposed what it was really for. It was
 * described as "how strict the warnings are", which made it look decorative - a setting that changed
 * wording and nothing else, so it went. But the same question it answers ("how much room do we allow
 * before we complain?") is also the question that stops a scouting list recommending a Barcelona
 * winger to a Championship side. Realism is not a tone of voice. It is the distance between the club
 * you are and the player you are looking at.
 *
 * So it now has two consumers, and the rule that still holds is the one that mattered before: realism
 * NEVER touches a save fact. A raw `transfer_budget`, a player's `wage` or an `inGameDate` reads the
 * same in every mode. It selects thresholds, and it scales an opinion. Nothing else.
 *
 * The five-value `RealismLevel` is the source of truth; it collapses to a two-value `RealismMode` here
 * because every consumer only ever asks one question. Keeping the collapse in one function is what
 * stops two advisories disagreeing about what "strict" means.
 */
import type { RealismLevel } from "./settings-vocabulary";

export type RealismMode = "STRICT" | "RELAXED" | "OFF";

/**
 * Which band a level falls into.
 *
 * Three bands, not two, because five levels collapsing into a pair made CASUAL and CHAOS behave
 * identically to BALANCED - so a manager who chose "no rules" still got a rule enforced. OFF is the
 * band that actually means none: nothing is vetoed and nothing is warned about.
 *
 * Unknown or absent levels relax, never tighten. A save we cannot read must not silently make the
 * app stricter than the manager asked for.
 */
export function realismModeOf(level: RealismLevel | string | null | undefined): RealismMode {
  switch (level) {
    case "STRICT_REALISM":
    case "REALISTIC":
      return "STRICT";
    case "BALANCED":
    case "CASUAL":
      return "RELAXED";
    case "CHAOS":
      return "OFF";
    default:
      return "RELAXED";
  }
}

/**
 * The advisory thresholds, per mode.
 *
 * `wageTurnoverWarning` is the ratio of the squad's annual wage bill to the derived tier revenue at
 * which the finance panel starts flagging an overrun; `wageTurnoverCritical` is where it turns red.
 * These are deliberately the ONLY place the numbers live.
 */
export const ADVISORY_THRESHOLDS: Record<
  RealismMode,
  { wageTurnoverWarning: number; wageTurnoverCritical: number }
> = {
  STRICT: { wageTurnoverWarning: 0.65, wageTurnoverCritical: 0.85 },
  RELAXED: { wageTurnoverWarning: 0.85, wageTurnoverCritical: 1 },
  // OFF still has to have a number: the advisory engine asks for a threshold unconditionally, and
  // this one is set past the point where any real wage bill reaches it.
  OFF: { wageTurnoverWarning: 0.95, wageTurnoverCritical: 1.1 },
};

/** Short label for a chip or tooltip. */
export function realismModeLabel(mode: RealismMode): string {
  return mode === "STRICT" ? "Strict realism" : mode === "OFF" ? "No realism rules" : "Relaxed realism";
}

/**
 * How many rating points above your own level a signing may sit before it stops being believable.
 *
 * STRICT assumes a club can only really shop at or just above its own level without a compelling
 * reason - European football, a big fee, a manager's reputation. RELAXED allows a manager some
 * licence, because a career mode is a game and a signings-only-your-own-level rule would remove the
 * entire point of promotion.
 *
 * These are the numbers the Realism fit dimension scales its ladder with. They are stated, and they
 * are the only place the numbers live, so the bar and the wording cannot drift apart.
 */
export const REALISM_STEP_TOLERANCE: Record<RealismMode, number> = {
  STRICT: 4,
  RELAXED: 9,
  // Nothing is out of reach when the manager has switched realism off. 99 sits above every rating
  // gap the save can produce (99 - 1), so no signing is ever judged implausible.
  OFF: 99,
};

/**
 * Whether this band is allowed to VETO a move outright.
 *
 * A veto is what stops the app recommending a player who would never join. It is switched off for OFF
 * and applies in both other bands - the difference between them is how wide the tolerance is, not
 * whether reality is allowed to say no.
 */
export const REALISM_VETOES_ENABLED: Record<RealismMode, boolean> = {
  STRICT: true,
  RELAXED: true,
  OFF: false,
};

/**
 * The international-reputation level at which a player is treated as an established name.
 *
 * Above this, a move down to a much smaller club is not a "step up we cannot afford" - it is a move
 * that does not happen, and the dimension caps hard rather than scaling with the rating gap.
 */
export const REALISM_ESTABLISHED_REP = 4;
