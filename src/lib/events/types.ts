import { Provenance, StorylineCategory, StorylineStatus } from "../db/schema";

export type CoreEventType =
  | "CAREER_INITIALIZED"
  | "SNAPSHOT_CREATED"
  | "PLAYER_SIGNED"
  | "PLAYER_SOLD"
  | "PLAYER_OVR_CHANGED"
  | "PLAYER_POTENTIAL_CHANGED"
  | "FINANCE_CHANGED"
  | "SQUAD_SIZE_CHANGED"
  // USER-sourced events. MATCH_DEBRIEF is written directly by POST /api/debrief and
  // is never produced by DeterministicDiffEngine, so it cannot affect sync event counts.
  | "MATCH_DEBRIEF"
  // DERIVED: raised when the save writes a finishing position for a season, which is the only
  // "the season is over" signal the file carries. There is no SEASON_ENDED flag in the save itself.
  | "SEASON_ENDED"
  | "STORYLINE_OPENED"
  | "STORYLINE_RESOLVED"
  | "STORYLINE_STALE"
  // STORYLINE EVIDENCE. These are attached to a thread and describe what we know about it, rather
  // than reporting a change in the career. Neither is ever produced by DeterministicDiffEngine, so
  // they cannot move the sync event count - the only writer is the evidence pass, which runs during
  // hydration and is idempotent by deterministic id.
  | "PLAYER_CONTRACT_EXPIRING"
  | "PLAYER_DEVELOPED"
  | "PLAYER_POSITION_CHANGED";

export interface BaseEventPayload {
  careerId: string;
  snapshotId: string;
  inGameDate?: string;
  [key: string]: unknown;
}

export interface PlayerSignedPayload extends BaseEventPayload {
  eaPlayerId: number;
  name: string;
  overallRating: number;
  potentialRating: number;
  wage: number;
  isYouthProspect: boolean;
}

export interface PlayerSoldPayload extends BaseEventPayload {
  eaPlayerId: number;
  name: string;
  lastOverallRating: number;
}

export interface PlayerOvrChangedPayload extends BaseEventPayload {
  eaPlayerId: number;
  name: string;
  oldOvr: number;
  newOvr: number;
  delta: number;
}

export interface FinanceChangedPayload extends BaseEventPayload {
  oldTransferBudget: number;
  newTransferBudget: number;
  oldWageBudget: number;
  newWageBudget: number;
}

/**
 * A manager-logged goals/assists contribution for a single player in a single match.
 *
 * FC25 career saves expose no per-match event data (no scorers, no assist minutes), so every
 * value here is USER provenance - an observation the manager recorded, never a parsed fact.
 * AI layers must treat it as read-only input, never as something to regenerate.
 */
export interface MatchContribution {
  playerId: string;
  playerName: string;
  goals: number;
  assists: number;
}

export interface DomainEvent {
  id: string;
  careerId: string;
  snapshotId: string;
  eventType: CoreEventType;
  source: Provenance;
  entityType: "CAREER" | "PLAYER" | "FINANCE" | "SQUAD" | "MATCH" | "STORYLINE" | "EVIDENCE";
  entityId: string;
  payloadJson: string;
  timestamp?: string;
}

export interface StorylineOpenedPayload extends BaseEventPayload {
  storylineId: string;
  title: string;
  category: StorylineCategory;
  openingEventId?: string;
}

export interface StorylineResolvedPayload extends BaseEventPayload {
  storylineId: string;
  title: string;
  category: StorylineCategory;
  resolvingEventId?: string;
}

export interface StorylineItem {
  id: string;
  careerId: string;
  title: string;
  category: StorylineCategory;
  status: StorylineStatus;
  openedAt: string;
  /**
   * How long the thread has been open, in days, floored at 1.
   *
   * Computed on the server: reading the clock during render is impure, and a client-only reading
   * would hydrate to a different value than the server produced.
   */
  daysActive?: number;
  resolvedAt: string | null;
  openingEventId: string | null;
  resolvingEventId: string | null;
  updatedAt: string;
  evidenceEvents?: DomainEvent[];
}