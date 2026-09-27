/**
 * Storyline evidence.
 *
 * A storyline is only a container. What makes it worth reading is the set of facts sitting inside
 * it, and until now nothing ever put anything in one: `storyline_events` was declared, indexed and
 * joined, but never written to, so every story read as a bare flag with a dead "Evidence (N)"
 * control. This module is the write half.
 *
 * Two rules hold it together.
 *
 * 1. **Every fact has a deterministic identity.** The evidence event's primary key is a hash of
 *    what the fact *says*, not of when we noticed it. Running a probe again over unchanged data
 *    therefore computes the same id, and the insert is discarded. Hydration can run as often as
 *    the manager reloads without the career history growing by accident - which matters, because
 *    this runs on every hydration, not on a schedule.
 *
 * 2. **Evidence never invents a fact.** A probe reads a value that is already persisted - a save
 *    field, or a number this codebase derived from save data - and states it plainly. Nothing here
 *    guesses, and nothing here is written by a model.
 *
 * A probe is deliberately small: it answers "what do we know that bears on this thread?" and
 * returns plain facts. Deciding how alarming they are, and how to phrase the thread, happens later
 * and separately (see `composeStoryline`), so re-wording a card never rewrites history.
 */
import { createHash } from "crypto";
import type { Provenance } from "@/lib/db/schema";
import type { EnrichedPlayer } from "@/lib/services/squad-service";
import { UNKNOWN_POSITION } from "@/lib/parser/interface";

/**
 * The spine event types evidence is allowed to use.
 *
 * Kept as its own union rather than folded into `CoreEventType`, because these rows are supporting
 * detail attached to a thread and are not career transitions. The sync engine's event budget must
 * not silently acquire new members, so this list stays separate and explicit.
 */
export type EvidenceEventType =
  | "STORYLINE_OPENED"
  | "PLAYER_CONTRACT_EXPIRING"
  | "PLAYER_DEVELOPED"
  | "PLAYER_POSITION_CHANGED";

/** A single thing we know, in a form that can be stored and shown without further interpretation. */
export interface EvidenceFact {
  eventType: EvidenceEventType;
  source: Provenance;
  /** The entity the fact is about - a player row id, or the storyline for an opening fact. */
  entityId: string;
  /**
   * Stable identity of the fact itself, independent of storage. Two runs that observe the same
   * thing must produce the same key; a genuinely new observation must produce a different one.
   */
  key: string;
  /** One plain sentence, safe to render as-is. No jargon, no template placeholders. */
  summary: string;
  payload: Record<string, unknown>;
}

/**
 * The evidence event's primary key, derived from the fact rather than from the clock.
 *
 * SHA-1 is used here as a naming function, not as a security primitive: it only has to turn a long
 * canonical string into a short collision-resistant id.
 */
export function evidenceEventId(careerId: string, fact: EvidenceFact): string {
  const digest = createHash("sha1")
    .update([careerId, fact.eventType, fact.entityId, fact.key].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `evt_ev_${digest}`;
}

/** Deterministic id for a thread's opening fact, so re-evaluating cannot open it twice. */
export function storylineOpenedEventId(careerId: string, storylineId: string): string {
  const digest = createHash("sha1")
    .update(["open", careerId, storylineId].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `evt_ev_${digest}`;
}

/**
 * How many seasons ahead counts as "contract news".
 *
 * A deal running out at the end of next season is a decision the manager still has time to make;
 * further out than that it is not news yet, and including it would bury the urgent rows.
 */
export const CONTRACT_RADAR_SEASONS = 1;

/**
 * Contracts running out inside the radar window.
 *
 * Provenance is SAVE: `contractValidUntil` is read from the save file and written through
 * unchanged. The only thing added here is the comparison against the current season.
 */
export function contractExpiryFacts(
  squad: EnrichedPlayer[],
  currentSeason: number
): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  for (const player of squad) {
    const until = player.contractValidUntil;
    if (until === null || until === undefined) continue;
    if (until > currentSeason + CONTRACT_RADAR_SEASONS) continue;

    const seasonsLeft = until - currentSeason;
    facts.push({
      eventType: "PLAYER_CONTRACT_EXPIRING",
      source: "SAVE",
      entityId: player.id,
      // The year is part of the key: if the contract is renewed to a later date, that is a new
      // fact and deserves its own row rather than overwriting the old one.
      key: `contract:${until}`,
      summary:
        seasonsLeft <= 0
          ? `${player.name}'s contract has reached its final year (${until}).`
          : `${player.name}'s contract runs out at the end of ${until}.`,
      payload: {
        playerId: player.id,
        eaPlayerId: player.eaPlayerId,
        name: player.name,
        primaryPosition: player.primaryPosition,
        contractValidUntil: until,
        seasonsLeft,
      },
    });
  }

  return facts;
}

/**
 * A development move observed by comparing one player across two snapshots.
 *
 * `fromOvr`/`toOvr` are the two readings; neither is derived, both were written by the save. What
 * is derived here is only the pairing - that these two readings belong to the same player.
 */
export interface DevelopmentObservation {
  playerId: string;
  eaPlayerId: number;
  name: string;
  fromOvr: number;
  toOvr: number;
  fromSnapshot: number;
  toSnapshot: number;
  fromDate: string | null;
  /** Position labels on each side, as the save recorded them. */
  fromPosition: string | null;
  toPosition: string | null;
  /** The save's own position codes. The comparison uses these, not the labels. */
  fromPositionCode: number | null;
  toPositionCode: number | null;
}

/**
 * Development movement between two recorded snapshots.
 *
 * Provenance is DERIVED: the save records each rating, but the movement is our subtraction. Only
 * players present in both snapshots are reported - a player who appears in one of them was signed
 * or sold, not developed, and calling that growth would be wrong.
 */
export function developmentFacts(observations: DevelopmentObservation[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  for (const observation of observations) {
    const delta = observation.toOvr - observation.fromOvr;
    if (delta === 0) continue;

    facts.push({
      eventType: "PLAYER_DEVELOPED",
      source: "DERIVED",
      entityId: observation.playerId,
      // The whole movement is the key, so a later further move adds a row instead of replacing
      // the earlier one. The history is the point.
      key: `ovr:${observation.fromOvr}->${observation.toOvr}@${observation.toSnapshot}`,
      summary:
        delta > 0
          ? `${observation.name} has gone from ${observation.fromOvr} to ${observation.toOvr} overall.`
          : `${observation.name} has slipped from ${observation.fromOvr} to ${observation.toOvr} overall.`,
      payload: {
        playerId: observation.playerId,
        eaPlayerId: observation.eaPlayerId,
        name: observation.name,
        oldOvr: observation.fromOvr,
        newOvr: observation.toOvr,
        delta,
        fromSnapshot: observation.fromSnapshot,
        toSnapshot: observation.toSnapshot,
        fromDate: observation.fromDate,
      },
    });
  }

  return facts;
}

/**
 * Positions that are not a place on the pitch.
 *
 * A player who reads `SUB` or `UNKNOWN` in one snapshot and `CB` in the next has not moved - the
 * earlier reading simply had no position recorded, or predated the position mapping. Treating that
 * as a change would report a move that never happened, and in this career it would have reported
 * **24 of them at once**, because that is exactly how many players were unmapped before the mapping
 * was fixed. `RES` is in the list for the same reason.
 */
const NON_POSITIONS = new Set([UNKNOWN_POSITION, "SUB", "RES"]);

/**
 * A player's position changing between two recorded snapshots.
 *
 * The comparison is on the save's own numeric `position_code`, not on our derived label. The label
 * is ours and changes whenever the mapping improves; the code is the save's and only changes when
 * the game moves the player. Comparing labels is what produced the phantom moves described above.
 *
 * Provenance is SAVE: both readings are the save's own. What is ours is only the pairing.
 */
export function positionChangeFacts(observations: DevelopmentObservation[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  for (const observation of observations) {
    const from = observation.fromPosition;
    const to = observation.toPosition;

    // No code on either side means the save did not say where this player plays, so there is
    // nothing to compare and no change to report.
    if (observation.fromPositionCode === null || observation.toPositionCode === null) continue;
    if (observation.fromPositionCode === observation.toPositionCode) continue;
    if (!from || !to) continue;
    // One side being a non-position means a recording gap closed, not that the player moved.
    if (NON_POSITIONS.has(from.toUpperCase()) || NON_POSITIONS.has(to.toUpperCase())) continue;

    facts.push({
      eventType: "PLAYER_POSITION_CHANGED",
      source: "SAVE",
      entityId: observation.playerId,
      key: `position:${observation.fromPositionCode}->${observation.toPositionCode}@${observation.toSnapshot}`,
      summary: `${observation.name} has moved from ${from} to ${to}.`,
      payload: {
        playerId: observation.playerId,
        eaPlayerId: observation.eaPlayerId,
        name: observation.name,
        fromPosition: from,
        toPosition: to,
        fromPositionCode: observation.fromPositionCode,
        toPositionCode: observation.toPositionCode,
        fromSnapshot: observation.fromSnapshot,
        toSnapshot: observation.toSnapshot,
        fromDate: observation.fromDate,
      },
    });
  }

  return facts;
}
