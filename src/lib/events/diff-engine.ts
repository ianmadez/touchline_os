import { DomainEvent } from "./types";
import { Provenance } from "../db/schema";

export interface SnapshotStateRecord {
  careerId: string;
  snapshotId: string;
  inGameDate?: string;
  players: Array<{
    eaPlayerId: number;
    name: string;
    primaryPosition?: string;
    overallRating: number;
    potentialRating: number;
    age?: number | null;
    wage: number;
    isYouthProspect: boolean;
  }>;
  finances?: {
    transferBudget: number;
    wageBudget: number;
    totalEarnings: number;
    recordBuy: number;
    recordSale: number;
  };
}

export class DeterministicDiffEngine {
  public static computeDiff(
    prev: SnapshotStateRecord | null,
    next: SnapshotStateRecord,
    source: Provenance = "SAVE"
  ): DomainEvent[] {
    const events: DomainEvent[] = [];

    // 1. Initial Snapshot Event
    if (!prev) {
      events.push({
        id: crypto.randomUUID(),
        careerId: next.careerId,
        snapshotId: next.snapshotId,
        eventType: "CAREER_INITIALIZED",
        source,
        entityType: "CAREER",
        entityId: next.careerId,
        payloadJson: JSON.stringify({
          careerId: next.careerId,
          snapshotId: next.snapshotId,
          inGameDate: next.inGameDate,
          initialSquadSize: next.players.length,
        }),
      });
      return events;
    }

    // 2. Player Map Indexing
    const prevPlayersMap = new Map(prev.players.map((p) => [p.eaPlayerId, p]));
    const nextPlayersMap = new Map(next.players.map((p) => [p.eaPlayerId, p]));

    // 3. Detect Signings & Rating Changes (Present in Next)
    for (const [eaId, nextPlayer] of nextPlayersMap.entries()) {
      const prevPlayer = prevPlayersMap.get(eaId);

      if (!prevPlayer) {
        // PLAYER_SIGNED
        events.push({
          id: crypto.randomUUID(),
          careerId: next.careerId,
          snapshotId: next.snapshotId,
          eventType: "PLAYER_SIGNED",
          source,
          entityType: "PLAYER",
          entityId: `${next.careerId}_${eaId}`,
          payloadJson: JSON.stringify({
            careerId: next.careerId,
            snapshotId: next.snapshotId,
            eaPlayerId: eaId,
            name: nextPlayer.name,
            overallRating: nextPlayer.overallRating,
            potentialRating: nextPlayer.potentialRating,
            wage: nextPlayer.wage,
            isYouthProspect: nextPlayer.isYouthProspect,
          }),
        });
      } else {
        // PLAYER_OVR_CHANGED
        if (nextPlayer.overallRating !== prevPlayer.overallRating) {
          const delta = nextPlayer.overallRating - prevPlayer.overallRating;
          events.push({
            id: crypto.randomUUID(),
            careerId: next.careerId,
            snapshotId: next.snapshotId,
            eventType: "PLAYER_OVR_CHANGED",
            source,
            entityType: "PLAYER",
            entityId: `${next.careerId}_${eaId}`,
            payloadJson: JSON.stringify({
              careerId: next.careerId,
              snapshotId: next.snapshotId,
              eaPlayerId: eaId,
              name: nextPlayer.name,
              primaryPosition: nextPlayer.primaryPosition ?? prevPlayer.primaryPosition ?? "SUB",
              oldOvr: prevPlayer.overallRating,
              newOvr: nextPlayer.overallRating,
              delta,
              isYouthProspect: nextPlayer.isYouthProspect,
              isBreakthrough: delta >= 3 || (nextPlayer.isYouthProspect && delta >= 2),
            }),
          });
        }

        // PLAYER_POTENTIAL_CHANGED
        if (nextPlayer.potentialRating !== prevPlayer.potentialRating) {
          events.push({
            id: crypto.randomUUID(),
            careerId: next.careerId,
            snapshotId: next.snapshotId,
            eventType: "PLAYER_POTENTIAL_CHANGED",
            source,
            entityType: "PLAYER",
            entityId: `${next.careerId}_${eaId}`,
            payloadJson: JSON.stringify({
              careerId: next.careerId,
              snapshotId: next.snapshotId,
              eaPlayerId: eaId,
              name: nextPlayer.name,
              oldPotential: prevPlayer.potentialRating,
              newPotential: nextPlayer.potentialRating,
            }),
          });
        }
      }
    }

    // 4. Detect Sales / Departures (Present in Prev, Missing in Next)
    for (const [eaId, prevPlayer] of prevPlayersMap.entries()) {
      if (!nextPlayersMap.has(eaId)) {
        events.push({
          id: crypto.randomUUID(),
          careerId: next.careerId,
          snapshotId: next.snapshotId,
          eventType: "PLAYER_SOLD",
          source,
          entityType: "PLAYER",
          entityId: `${next.careerId}_${eaId}`,
          payloadJson: JSON.stringify({
            careerId: next.careerId,
            snapshotId: next.snapshotId,
            eaPlayerId: eaId,
            name: prevPlayer.name,
            lastOverallRating: prevPlayer.overallRating,
          }),
        });
      }
    }

    // 5. Squad Size Change
    if (next.players.length !== prev.players.length) {
      events.push({
        id: crypto.randomUUID(),
        careerId: next.careerId,
        snapshotId: next.snapshotId,
        eventType: "SQUAD_SIZE_CHANGED",
        source,
        entityType: "SQUAD",
        entityId: next.careerId,
        payloadJson: JSON.stringify({
          careerId: next.careerId,
          snapshotId: next.snapshotId,
          oldSize: prev.players.length,
          newSize: next.players.length,
          delta: next.players.length - prev.players.length,
        }),
      });
    }

    // 6. Financial Changes
    if (prev.finances && next.finances) {
      const transferDelta = next.finances.transferBudget - prev.finances.transferBudget;
      const wageDelta = next.finances.wageBudget - prev.finances.wageBudget;

      if (transferDelta !== 0 || wageDelta !== 0) {
        events.push({
          id: crypto.randomUUID(),
          careerId: next.careerId,
          snapshotId: next.snapshotId,
          eventType: "FINANCE_CHANGED",
          source,
          entityType: "FINANCE",
          entityId: next.careerId,
          payloadJson: JSON.stringify({
            careerId: next.careerId,
            snapshotId: next.snapshotId,
            oldTransferBudget: prev.finances.transferBudget,
            newTransferBudget: next.finances.transferBudget,
            oldWageBudget: prev.finances.wageBudget,
            newWageBudget: next.finances.wageBudget,
            transferDelta,
            wageDelta,
          }),
        });
      }
    }

    return events;
  }
}