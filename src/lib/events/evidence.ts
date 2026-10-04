/**
 * Storyline evidence.
 *
 * A storyline is only a container. What makes it worth reading is the set of facts sitting inside
 * it. This module is the write half of that (the probes, and the thresholds they are judged
 * against); `compose.ts` is the read half (how a set of facts becomes a sentence on a card).
 *
 * Three rules hold it together.
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
 * 3. **Every category states its own gate, and opens and clears on different numbers.** The table
 *    below is the contract, and the constants beside it are the machine-readable copy - they exist
 *    so the open and clear thresholds can never be read apart from each other, which is how a
 *    buffer quietly turns back into a single boundary:
 *
 *    | category         | opens on                          | readings | clears on                        |
 *    | ---------------- | --------------------------------- | -------- | -------------------------------- |
 *    | SQUAD_DEPTH      | a role below DEPTH_PROBLEM_BELOW  | 1        | DEPTH_SOLVED_AT, or a signing    |
 *    | CONTRACT         | expiry within CONTRACT_RADAR      | 1        | player sold, expiry moved        |
 *    |                  |                                   |          | further out, or expiry beyond    |
 *    |                  |                                   |          | CONTRACT_CLEARED_SEASONS         |
 *    | FORM             | a drop to FORM_SLUMP_AT across    | 2        | a reading at FORM_RECOVERED_AT,  |
 *    |                  | two snapshots                     |          | or the player leaving            |
 *    | TACTICAL         | an empty or mis-filled slot       | 1        | the slot is filled correctly     |
 *    | DEVELOPMENT      | an OVR or position move           | 2        | a later move redresses it        |
 *    | SEASON_OBJECTIVE | the season pass, not this module  | -        | the season transition            |
 *
 *    "Readings" is the minimum evidence to open: a squad list or a contract date is a structural
 *    fact and one reading is enough, while a form figure or a rating is a trend and needs something
 *    to be a trend *against*. Nothing opens on a single reading of a value it is calling movement.
 *
 * A probe is deliberately small: it answers "what do we know that bears on this thread?" and
 * returns plain facts. Deciding how alarming they are, and how to phrase the thread, happens later
 * and separately (see `composeStoryline`), so re-wording a card never rewrites history.
 */
import { sha1Hex } from "../parser/sha";
import type { Provenance } from "../db/schema";
import type { EnrichedPlayer } from "../services/squad-service";
import type { PitchSlotAssignment } from "../services/tactics-service";
import { UNKNOWN_POSITION } from "../parser/interface";

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
  | "PLAYER_POSITION_CHANGED"
  | "PLAYER_FORM_SLUMP"
  | "PLAYER_FORM_STREAK"
  | "PLAYER_OUT_OF_POSITION"
  | "TACTICAL_SLOT_UNASSIGNED"
  | "SQUAD_DEPTH_THIN"
  | "PLAYER_PRAISED";

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
  /**
   * How much this single fact moves the needle, set by the probe that observed it.
   *
   * The severity composer reads this, so urgency is never decided by a category name - it is
   * decided by what we actually know. A contract already in its final year is SERIOUS; one that
   * still has a season of room is NOTABLE. Omitted means NOTABLE.
   */
  weight?: EvidenceWeight;
}

export type EvidenceWeight = "NOTABLE" | "SERIOUS";

/**
 * Who wins when a thread could both be answered and be dropped.
 *
 * One rule, written once and called by every category, because four copies of a precedence check
 * drift apart silently. The rule: **an observed fact that answers a thread always beats a reason to
 * drop it.** A contract thread whose player was sold is resolved - it was dealt with, we saw it -
 * not dropped. "Dropped" is for threads we can no longer follow at all, never for ones we can.
 */
export function resolveOverStale(input: {
  /** A fact we observed that answers the thread: a signing, a renewal, a recovery, a sale. */
  answered: boolean;
  /** A reason the thread can no longer be followed: the player left, the reading stopped. */
  unobservable: boolean;
}): { status: "RESOLVED" | "STALE"; reason: string } | null {
  if (input.answered) return { status: "RESOLVED", reason: "answered" };
  if (input.unobservable) return { status: "STALE", reason: "unobservable" };
  return null;
}

/**
 * Deterministic id for a thread's closing fact, so a re-run cannot file it twice.
 *
 * Status is part of the id: a thread that is resolved and later dropped (or the reverse) has two
 * genuinely different facts to record, and both belong in its history.
 */
export function storylineClosureEventId(
  careerId: string,
  storylineId: string,
  status: "RESOLVED" | "STALE"
): string {
  const digest = sha1Hex(["close", careerId, storylineId, status].join("|")).slice(0, 24);
  return `evt_ev_${digest}`;
}

/**
 * The evidence event's primary key, derived from the fact rather than from the clock.
 *
 * SHA-1 is used here as a naming function, not as a security primitive: it only has to turn a long
 * canonical string into a short collision-resistant id.
 */
export function evidenceEventId(careerId: string, fact: EvidenceFact): string {
  const digest = sha1Hex([careerId, fact.eventType, fact.entityId, fact.key].join("|")).slice(0, 24);
  return `evt_ev_${digest}`;
}

/** Deterministic id for a thread's opening fact, so re-evaluating cannot open it twice. */
export function storylineOpenedEventId(careerId: string, storylineId: string): string {
  const digest = sha1Hex(["open", careerId, storylineId].join("|")).slice(0, 24);
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
 * Where a contract thread stops being news again - the resolve side of its buffer.
 *
 * The open threshold and the resolve threshold are deliberately different numbers. A thread opens
 * when a deal is inside one year, and only clears on the window alone once it is beyond two. If both
 * used the same number, a contract sitting exactly on the boundary would open and resolve on
 * alternate syncs, and the manager would watch a card flicker for a whole year.
 *
 * The buffer is not the only way out: the evaluator also clears the thread when the save's own date
 * has provably moved further out, because a renewal of a single year is still a renewal. Without
 * that, the buffer would swallow exactly the case it is most likely to see.
 */
export const CONTRACT_CLEARED_SEASONS = CONTRACT_RADAR_SEASONS + 1;

/**
 * Squad depth: a role is a problem below two players, and only considered solved at three.
 *
 * Structural fact (one reading opens it - a squad list is not a trend). The gap between the two
 * numbers is the buffer: with one reading resolving it, a squad that dips to one specialist and
 * then signs a second would open and resolve the same thread repeatedly.
 */
export const DEPTH_PROBLEM_BELOW = 2;
export const DEPTH_SOLVED_AT = DEPTH_PROBLEM_BELOW + 1;

/**
 * Manager praise: rolling window size and trigger thresholds.
 *
 * Evaluates manager debriefs over a rolling 5-match lookback. A player praised in 3+ debriefs
 * within the window triggers or adopts a PRAISE storyline. If 5 consecutive debriefs elapse
 * with 0 praise mentions for that player, the thread decays and resolves.
 */
export const ROLLING_DEBRIEF_WINDOW = 5;
export const PRAISE_THRESHOLD = 3;

/**
 * The save's own form scale, and where a thread opens and clears on it.
 *
 * `teamplayerlinks.form` is declared INTEGER with `rangehigh="5"` in `fifa_ng_db-meta.xml`, and the
 * reference implementation labels 1-5 (Awful/Poor/Okay/Good/Excellent) with 0 meaning the game has
 * no reading for that player at all - which is what our five newgens carry. Earlier comments in
 * this codebase described a 0-10 scale, which would have flagged almost every senior player as
 * being in a "severe slump" the moment anything consumed it.
 *
 * Trend fact (two readings needed - a level on its own says nothing). It is not merely that a
 * single reading is thin evidence: in the reference save every fit senior player reads exactly 3,
 * so a level-based rule would either never fire or fire for the entire first team. The movement is
 * the signal, which is why FORM is opened from the snapshot comparison rather than from the value.
 */
export const FORM_SCALE_MAX = 5;
export const FORM_SLUMP_AT = 2;
export const FORM_RECOVERED_AT = 4;

/** The save's own wording for each form reading, mirroring the reference implementation. */
export const FORM_GRADE_LABELS: Record<number, string> = {
  1: "awful",
  2: "poor",
  3: "okay",
  4: "good",
  5: "excellent",
};

/**
 * A usable form reading, or null.
 *
 * 0 and anything outside 1-5 is not a reading: the save uses 0 for "no reading recorded", which is
 * what every newgen in the reference save carries. Treating it as a very bad form score would
 * invent a slump out of missing data.
 */
function readFormGrade(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > FORM_SCALE_MAX) return null;
  return value;
}

/**
 * Contracts running out inside the radar window.
 *
 * Provenance is SAVE: `contractValidUntil` is read from the save file and written through
 * unchanged. The only thing added here is the comparison against the current season.
 */
export function contractExpiryFacts(
  squad: EnrichedPlayer[],
  currentSeason: number,
  /** Player row ids in the manager's starting XI, so tone can tell a starter from a squad player. */
  starterIds?: ReadonlySet<string>
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
      // A deal already in its final season is a decision that has to be made now, not next summer.
      weight: seasonsLeft <= 0 ? "SERIOUS" : "NOTABLE",
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
        // Squad standing, so the composer can pitch the risk at a starter rather than a name.
        // Read from state we already hold: `isYouthProspect` is a save-derived flag and the
        // starter set is the manager's own XI. Absent means "not a starter", the honest default.
        isStarter: starterIds?.has(player.id) ?? false,
        isYouthProspect: player.isYouthProspect,
        age: player.age,
      },
    });
  }

  return facts;
}

/**
 * Form movement between the two most recent snapshots.
 *
 * Opens nothing on its own. The probe reports both directions and the evaluator decides: a drop is
 * a thread, a recovery is the evidence that closes one. See the FORM constants above for the scale
 * and for why the level alone is not evidence.
 */
export function formFacts(observations: DevelopmentObservation[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  for (const observation of observations) {
    const from = readFormGrade(observation.fromForm);
    const to = readFormGrade(observation.toForm);
    if (from === null || to === null || to === from) continue;

    const name = observation.name;
    const grade = FORM_GRADE_LABELS[to] ?? String(to);

    if (to < from && to <= FORM_SLUMP_AT) {
      facts.push({
        eventType: "PLAYER_FORM_SLUMP",
        source: "SAVE",
        entityId: observation.playerId,
        // The whole movement is the key, so a later further drop is a new fact rather than a
        // rewrite of this one.
        key: `form_drop:${from}->${to}@${observation.toSnapshot}`,
        weight: to <= 1 ? "SERIOUS" : "NOTABLE",
        summary: `${name}'s form has dropped to ${grade} (${to}/${FORM_SCALE_MAX}).`,
        payload: {
          playerId: observation.playerId,
          eaPlayerId: observation.eaPlayerId,
          name,
          fromForm: from,
          toForm: to,
          formScaleMax: FORM_SCALE_MAX,
          fromSnapshot: observation.fromSnapshot,
          toSnapshot: observation.toSnapshot,
          primaryPosition: observation.toPosition,
        },
      });
      continue;
    }

    if (to > from && to >= FORM_RECOVERED_AT) {
      facts.push({
        eventType: "PLAYER_FORM_STREAK",
        source: "SAVE",
        entityId: observation.playerId,
        key: `form_rise:${from}->${to}@${observation.toSnapshot}`,
        summary: `${name}'s form has recovered to ${grade} (${to}/${FORM_SCALE_MAX}).`,
        payload: {
          playerId: observation.playerId,
          eaPlayerId: observation.eaPlayerId,
          name,
          fromForm: from,
          toForm: to,
          formScaleMax: FORM_SCALE_MAX,
          fromSnapshot: observation.fromSnapshot,
          toSnapshot: observation.toSnapshot,
          primaryPosition: observation.toPosition,
        },
      });
    }
  }

  return facts;
}

/**
 * Out-of-position starting XI players and unassigned starting slots.
 */
export function tacticalFacts(
  squad: EnrichedPlayer[],
  tacticsSlots: PitchSlotAssignment[]
): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const playerMap = new Map(squad.map((p) => [p.id, p]));

  for (const slot of tacticsSlots) {
    if (!slot.playerId) {
      facts.push({
        eventType: "TACTICAL_SLOT_UNASSIGNED",
        source: "USER",
        entityId: `slot_${slot.slotIndex}`,
        key: `unassigned_slot:${slot.slotIndex}_${slot.role}`,
        summary: `Starting XI slot #${slot.slotIndex + 1} (${slot.label || slot.role}) has no player assigned.`,
        payload: {
          slotIndex: slot.slotIndex,
          role: slot.role,
          label: slot.label,
        },
      });
      continue;
    }

    const player = playerMap.get(slot.playerId);
    if (!player) continue;

    const naturalPos = player.primaryPosition;
    if (
      naturalPos &&
      naturalPos !== slot.role &&
      naturalPos !== "SUB" &&
      naturalPos !== UNKNOWN_POSITION
    ) {
      facts.push({
        eventType: "PLAYER_OUT_OF_POSITION",
        source: "DERIVED",
        entityId: player.id,
        key: `out_of_pos:${slot.slotIndex}_${slot.role}_${naturalPos}`,
        summary: `${player.name} (${naturalPos}) is deployed out of position at ${slot.label || slot.role}.`,
        payload: {
          playerId: player.id,
          eaPlayerId: player.eaPlayerId,
          name: player.name,
          naturalPosition: naturalPos,
          assignedSlotRole: slot.role,
          slotLabel: slot.label,
          slotIndex: slot.slotIndex,
        },
      });
    }
  }

  return facts;
}

/**
 * Squad depth gap facts for thin positions.
 */
export function squadDepthFacts(
  thinPositions: Array<{ position: string; count: number }>
): EvidenceFact[] {
  return thinPositions.map((thin) => ({
    eventType: "SQUAD_DEPTH_THIN",
    source: "DERIVED",
    entityId: `depth_${thin.position}`,
    key: `depth_thin:${thin.position}_${thin.count}`,
    // Nobody at all in a position is sharper than one specialist left covering it.
    weight: thin.count === 0 ? "SERIOUS" : "NOTABLE",
    summary: `${thin.position} depth is critically thin with only ${thin.count} player${
      thin.count === 1 ? "" : "s"
    } available.`,
    payload: {
      position: thin.position,
      count: thin.count,
    },
  }));
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
  /**
   * The save's form reading on each side (1-5), or null when it recorded none.
   *
   * Read on the same pass as the rating because it is the same comparison and the same two rows -
   * form movement is only meaningful against the reading before it.
   */
  fromForm: number | null;
  toForm: number | null;
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

/** A player the manager singled out, and how often, inside the rolling debrief window. */
export interface PraiseMention {
  player: EnrichedPlayer;
  count: number;
  matchDetails: string[];
}

/**
 * Every player the manager singled out in the rolling debrief window, with their mention count.
 *
 * Separate from `praiseFacts` because the trust pass needs the players at *zero* just as much as the
 * ones above the threshold: a count of zero is what decays an elevated status back to baseline, and
 * a function that only returned threads over the line could never see it.
 *
 * Enforces ID-first player matching discipline: reads `standoutPlayerIds` or
 * `contributions[].playerId` first, then falls back to string names only when no id resolved - a name
 * is a spelling, an id is an identity. Collects match context (opponent & scoreline) so narrative
 * composition can describe specific performances rather than generic praise.
 */
export function collectPraiseMentions(
  debriefEvents: Array<{ payloadJson: string; timestamp: string }>,
  squad: EnrichedPlayer[]
): Map<string, PraiseMention> {
  const windowDebriefs = debriefEvents.slice(-ROLLING_DEBRIEF_WINDOW);
  const praiseMap = new Map<string, PraiseMention>();
  if (windowDebriefs.length === 0) return praiseMap;

  const playerMapById = new Map(squad.map((p) => [p.id, p]));
  const playerMapByEaId = new Map(squad.map((p) => [p.eaPlayerId, p]));
  const playerMapByName = new Map(squad.map((p) => [p.name.toLowerCase(), p]));

  for (const debrief of windowDebriefs) {
    let parsed: {
      standoutPlayerIds?: string[];
      standoutPlayerNames?: string[];
      standoutPlayerName?: string;
      contributions?: Array<{ playerId?: string; playerName?: string }>;
      scoreline?: string;
      /** The club faced. The debrief route writes `opponent`; `opponentName` is the legacy shape. */
      opponent?: string;
      opponentName?: string;
    };
    try {
      parsed = typeof debrief.payloadJson === "string" ? JSON.parse(debrief.payloadJson) : debrief.payloadJson;
    } catch {
      continue;
    }

    const opponent = parsed.opponent ?? parsed.opponentName;
    const matchContext =
      parsed.scoreline && opponent
        ? `${parsed.scoreline} vs ${opponent}`
        : parsed.scoreline || "Match";

    const praisedInMatch = new Set<EnrichedPlayer>();

    // 1. ID-First Matching: Check contributions and standoutPlayerIds
    if (Array.isArray(parsed.contributions)) {
      for (const c of parsed.contributions) {
        if (c.playerId && playerMapById.has(c.playerId)) {
          praisedInMatch.add(playerMapById.get(c.playerId)!);
        }
      }
    }

    if (Array.isArray(parsed.standoutPlayerIds)) {
      for (const id of parsed.standoutPlayerIds) {
        if (playerMapById.has(id)) {
          praisedInMatch.add(playerMapById.get(id)!);
        } else {
          const numId = Number(id);
          if (!isNaN(numId) && playerMapByEaId.has(numId)) {
            praisedInMatch.add(playerMapByEaId.get(numId)!);
          }
        }
      }
    }

    // 2. Secondary Fallback: Check string names if no ID matched
    const rawNames: string[] = [];
    if (Array.isArray(parsed.standoutPlayerNames)) {
      rawNames.push(...parsed.standoutPlayerNames);
    }
    if (parsed.standoutPlayerName) {
      rawNames.push(parsed.standoutPlayerName);
    }

    for (const rawName of rawNames) {
      const matched = playerMapByName.get(rawName.trim().toLowerCase());
      if (matched) {
        praisedInMatch.add(matched);
      }
    }

    for (const player of praisedInMatch) {
      const entry = praiseMap.get(player.id) || { player, count: 0, matchDetails: [] };
      entry.count += 1;
      entry.matchDetails.push(matchContext);
      praiseMap.set(player.id, entry);
    }
  }

  return praiseMap;
}

/**
 * Extracts deep player praise facts from the rolling window of recent match debriefs.
 *
 * The facts flavour of `collectPraiseMentions`: it reports only the players who cleared
 * `PRAISE_THRESHOLD`, because a fact is a storyline. Everyone else is deliberately absent here and
 * visible there, which is what lets the trust pass decay an elevated player back to baseline.
 */
export function praiseFacts(
  debriefEvents: Array<{ payloadJson: string; timestamp: string }>,
  squad: EnrichedPlayer[]
): EvidenceFact[] {
  const windowSize = Math.min(debriefEvents.length, ROLLING_DEBRIEF_WINDOW);
  const praiseMap = collectPraiseMentions(debriefEvents, squad);

  const facts: EvidenceFact[] = [];

  for (const [playerId, { player, count, matchDetails }] of praiseMap.entries()) {
    if (count >= PRAISE_THRESHOLD) {
      facts.push({
        eventType: "PLAYER_PRAISED",
        source: "USER",
        entityId: playerId,
        key: `praise:${count}_in_${windowSize}:${matchDetails.length}`,
        weight: count >= 4 ? "SERIOUS" : "NOTABLE",
        summary: `Manager singled out ${player.name} in ${count} of the last ${windowSize} match debriefs.`,
        payload: {
          playerId: player.id,
          eaPlayerId: player.eaPlayerId,
          name: player.name,
          primaryPosition: player.primaryPosition,
          praiseCount: count,
          windowSize,
          matchDetails,
        },
      });
    }
  }

  return facts;
}
