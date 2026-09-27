/**
 * Tactical roles, grouped by the part of the pitch they belong to.
 *
 * The dossier's role field used to be free text, and it shows: the stored values in this career
 * include "9", "ten", "CB", "Backup RB", "YA" and "Box-to-box " (trailing space and all). That is
 * what happens when one box has to serve as a position field, a squad-status field and a role field
 * at once. Positions now have their own field, so this one can mean one thing.
 *
 * Two deliberate choices:
 *
 * 1. **The stored value is the label.** No ids to keep in sync with display copy, and a value that
 *    already happens to read "Poacher" keeps working. Migration-free.
 *
 * 2. **Roles are scoped to the player's position group.** A centre-back is offered the centre-back
 *    roles, a striker the striker's. That is the point of a controlled vocabulary - a list that
 *    offers every role to everyone is just a free-text box with extra steps. A player whose position
 *    is unknown sees every group, because that is the one case where we genuinely cannot narrow it.
 *
 * A manager who wants to assign an out-of-group role does it the way the game works: change the
 * player's position first (the Position Override field), and the role list follows.
 */
import { KNOWN_POSITION_ROLES, UNKNOWN_POSITION } from "../parser/interface";

/** The four bands of the pitch a player can belong to. */
export type PositionGroup = "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";

/**
 * Which band each save position sits in.
 *
 * Covers every value `positionCodeToRole` can produce, so a position that came from the save always
 * lands somewhere. `SUB`/`RES`/`UNKNOWN` are absent on purpose - they say nothing about where the
 * player plays, and guessing a band from them would put a substitute in the wrong list.
 */
const GROUP_BY_POSITION: Record<string, PositionGroup> = {
  GK: "GOALKEEPER",
  SW: "DEFENDER",
  CB: "DEFENDER",
  LB: "DEFENDER",
  RB: "DEFENDER",
  LWB: "DEFENDER",
  RWB: "DEFENDER",
  CDM: "MIDFIELDER",
  CM: "MIDFIELDER",
  CAM: "MIDFIELDER",
  LM: "MIDFIELDER",
  RM: "MIDFIELDER",
  LW: "FORWARD",
  RW: "FORWARD",
  CF: "FORWARD",
  ST: "FORWARD",
};

export const POSITION_GROUP_LABELS: Record<PositionGroup, string> = {
  GOALKEEPER: "Goalkeeper",
  DEFENDER: "Defender",
  MIDFIELDER: "Midfielder",
  FORWARD: "Forward",
};

export const POSITION_GROUP_ORDER: readonly PositionGroup[] = [
  "GOALKEEPER",
  "DEFENDER",
  "MIDFIELDER",
  "FORWARD",
];

/**
 * The band a position belongs to, or null when the position cannot say.
 *
 * Null is a real answer, not a failure: a player the save has not positioned has no band, and the
 * caller should widen the role list rather than pick one for them.
 */
export function positionGroupOf(position: string | null | undefined): PositionGroup | null {
  if (!position) return null;
  const normalised = position.trim().toUpperCase();
  return GROUP_BY_POSITION[normalised] ?? null;
}

export interface TacticalRole {
  label: string;
  group: PositionGroup;
  /** What the role asks of a player, in one line. Shown as the option's title. */
  hint: string;
}

/**
 * The vocabulary.
 *
 * Kept to roles a manager would actually name out loud, rather than every permutation a tactics
 * screen could express. Roles that only make sense on one side (an inverted full-back, an inside
 * forward) are stated in the neutral form, since the position field already carries which flank.
 */
export const TACTICAL_ROLES: readonly TacticalRole[] = [
  // --- Goalkeeper ---
  { label: "Shot Stopper", group: "GOALKEEPER", hint: "Judged on saves; stays on his line" },
  { label: "Sweeper Keeper", group: "GOALKEEPER", hint: "Plays high, covers in behind" },
  { label: "Ball-Playing Goalkeeper", group: "GOALKEEPER", hint: "Starts attacks from the back" },

  // --- Defender ---
  { label: "No-Nonsense Centre-Back", group: "DEFENDER", hint: "Clears first, asks questions later" },
  { label: "Ball-Playing Defender", group: "DEFENDER", hint: "Steps out and passes through the lines" },
  { label: "Stopper", group: "DEFENDER", hint: "Steps into midfield to meet the ball" },
  { label: "Cover Defender", group: "DEFENDER", hint: "Holds depth behind an aggressive partner" },
  { label: "Full-Back", group: "DEFENDER", hint: "Defends the flank, supports when it is on" },
  { label: "Wing-Back", group: "DEFENDER", hint: "Provides the width in a back three or five" },
  { label: "Inverted Full-Back", group: "DEFENDER", hint: "Tucks into midfield in possession" },
  { label: "Overlapping Full-Back", group: "DEFENDER", hint: "Runs beyond the winger" },

  // --- Midfielder ---
  { label: "Anchor", group: "MIDFIELDER", hint: "Sits in front of the back line" },
  { label: "Deep-Lying Playmaker", group: "MIDFIELDER", hint: "Dictates tempo from deep" },
  { label: "Ball-Winning Midfielder", group: "MIDFIELDER", hint: "Wins it back and gives it simple" },
  { label: "Box-to-Box Midfielder", group: "MIDFIELDER", hint: "Covers ground in both boxes" },
  { label: "Mezzala", group: "MIDFIELDER", hint: "Drifts into the half-space from central midfield" },
  { label: "Carrilero", group: "MIDFIELDER", hint: "Shuttles wide to cover an attacking full-back" },
  { label: "Advanced Playmaker", group: "MIDFIELDER", hint: "Creates between the lines" },
  { label: "Shadow Striker", group: "MIDFIELDER", hint: "Arrives late in the box from deep" },
  { label: "Wide Midfielder", group: "MIDFIELDER", hint: "Holds width, tracks the full-back" },

  // --- Forward ---
  { label: "Poacher", group: "FORWARD", hint: "Lives in the box, finishes moves" },
  { label: "Advanced Forward", group: "FORWARD", hint: "Leads the line and runs the channels" },
  { label: "Target Man", group: "FORWARD", hint: "Holds it up and wins the first ball" },
  { label: "Complete Forward", group: "FORWARD", hint: "Does all of it, asked to do everything" },
  { label: "Deep-Lying Forward", group: "FORWARD", hint: "Drops off to link play" },
  { label: "Pressing Forward", group: "FORWARD", hint: "Sets the press from the front" },
  { label: "Inside Forward", group: "FORWARD", hint: "Starts wide, attacks the box" },
  { label: "Winger", group: "FORWARD", hint: "Hugs the touchline, beats his man" },
  { label: "Inverted Winger", group: "FORWARD", hint: "Cuts inside onto his stronger foot" },
  { label: "False Nine", group: "FORWARD", hint: "Drops deep to pull a centre-back out" },
];

/** Roles for one band, in the order defined above. */
export function rolesForGroup(group: PositionGroup): TacticalRole[] {
  return TACTICAL_ROLES.filter((role) => role.group === group);
}

/**
 * The roles to offer for a player at `position`.
 *
 * Returns the matching band's roles, the other bands separately (empty when the band is known), and
 * the player's own band so the caller can label the list. When the position cannot say - an
 * unmapped player, or a substitute - every band is returned instead of none, because there is
 * nothing to narrow by and an empty dropdown would be a dead end.
 */
export function rolesForPosition(position: string | null | undefined): {
  group: PositionGroup | null;
  primary: TacticalRole[];
  other: TacticalRole[];
} {
  const group = positionGroupOf(position);

  if (group === null) {
    return { group: null, primary: [...TACTICAL_ROLES], other: [] };
  }

  return {
    group,
    primary: rolesForGroup(group),
    other: TACTICAL_ROLES.filter((role) => role.group !== group),
  };
}

/**
 * Whether a stored role belongs to the player's band.
 *
 * Used only to decide whether a legacy or hand-entered value still needs to be shown. Values the
 * manager recorded before the vocabulary existed are never dropped - the dossier keeps showing them
 * so they can be seen and replaced deliberately, rather than silently disappearing on next save.
 */
export function roleBelongsToGroup(role: string | null | undefined, group: PositionGroup | null): boolean {
  if (!role) return true;
  if (group === null) return true;
  const match = TACTICAL_ROLES.find((entry) => entry.label === role);
  // An unrecognised value is not evidence of a mismatch; the caller keeps it visible.
  return match ? match.group === group : true;
}

/** True when a stored role is one the vocabulary knows about. */
export function isKnownRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return TACTICAL_ROLES.some((entry) => entry.label === role);
}

/** Every position a player's position field may legitimately hold, for validation. */
export const VALID_POSITIONS: readonly string[] = KNOWN_POSITION_ROLES;

export { UNKNOWN_POSITION };
