import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import {
  players,
  playerSnapshots,
  playerUserProfiles,
  careerSnapshots,
  Provenance,
} from "../db/schema";
import { UNKNOWN_POSITION, calculateAgeFromBirthdate } from "../parser/interface";

export interface EnrichedPlayer {
  id: string;
  careerId: string;
  eaPlayerId: number;
  name: string;
  primaryPosition: string;
  overallRating: number;
  potentialRating: number;
  age: number | null;
  birthdate: number | null;
  wage: number;
  wageProvenance: Provenance;
  /**
   * Player match form, read directly from save `teamplayerlinks.form`.
   *
   * SAVE fact. The schema declares this field 0-5 (`rangehigh="5"`), and 0 means the game recorded
   * no reading - which is what every newgen in the reference save carries. Earlier comments here
   * claimed a 0-10 scale; nothing consumed it, so no copy was wrong, but a consumer built on that
   * scale would have called the entire first team a slump. Form is also flat across the fit players
   * in a real save, so a single reading is not a signal: `formFacts` compares two snapshots.
   */
  form: number | null;
  /**
   * The year the contract runs out, as the save records it. Null when the save omits the player.
   *
   * A SAVE fact written through unchanged - the evidence pass only compares it to the current
   * season, it never adjusts the number.
   */
  contractValidUntil: number | null;
  /**
   * Raw `teamplayerlinks.injury`, carried so it is visible rather than silently dropped.
   *
   * **Measured as 0 for all 24 players in every save we hold**, including players an in-game
   * injury screen would flag. The reference implementation independently reached the same
   * conclusion and identified `career_playerlastgrowth.injurydate` as the real source, which our
   * parser does not yet read. So this value is not usable as an injury signal today, and nothing
   * should be built on it until the parser reads the growth table. It is exposed here so the fact
   * is visible in one place instead of being re-discovered.
   */
  injury: number | null;
  isYouthProspect: boolean;
  provenance: Provenance;
  latestSnapshotId: string | null;
  // User Profile Overlay
  userProfile?: {
    assignedRole: string | null;
    trustLevel: string | null;
    importanceMarker: string | null;
    userNotes: string | null;
    /** Explicit position override; null/undefined means trust the save-derived role. */
    positionOverride: string | null;
  };
}

export interface PlayerGrowthPoint {
  snapshotNumber: number;
  inGameDate: string | null;
  overallRating: number;
  potentialRating: number;
  createdAt: string;
}

export interface PositionDepthInfo {
  position: string;
  count: number;
  players: EnrichedPlayer[];
  isThin: boolean;
  minRequired: number;
}

export interface SquadDepthAnalysis {
  thinPositions: PositionDepthInfo[];
  totalPlayers: number;
  positionMap: Record<string, EnrichedPlayer[]>;
}

/**
 * Re-derives age from the persisted birthdate against the career's latest in-game date so a
 * displayed age cannot drift between syncs. Falls back to the age stored with the snapshot.
 */
function deriveDisplayAge(
  birthdate: number | null,
  storedAge: number | null,
  inGameDate: string | null
): number | null {
  if (birthdate === null || !inGameDate) return storedAge;
  const reference = new Date(`${inGameDate}T00:00:00Z`);
  if (Number.isNaN(reference.getTime())) return storedAge;
  return calculateAgeFromBirthdate(birthdate, null, reference) ?? storedAge;
}

export class SquadService {
  /**
   * Retrieves the active current-state squad with user profile overlays.
   */
  async getCurrentSquad(
    careerId: string,
    inGameDate: string | null = null
  ): Promise<EnrichedPlayer[]> {
    const rawPlayers = await db
      .select()
      .from(players)
      .where(eq(players.careerId, careerId));

    const userProfiles = await db
      .select()
      .from(playerUserProfiles)
      .where(eq(playerUserProfiles.careerId, careerId));

    const profileMap = new Map(userProfiles.map((p) => [p.playerId, p]));

    return rawPlayers.map((player) => {
      const profile = profileMap.get(player.id);
      return {
        ...player,
        form: player.form,
        // A user override wins, then the derived role. Falls back to UNKNOWN (not SUB) so an
        // unmapped code stays visible and fixable instead of masquerading as a real substitute.
        primaryPosition: profile?.primaryPosition || player.primaryPosition || UNKNOWN_POSITION,
        // Re-derived from the stored birthdate so it cannot drift between syncs.
        age: deriveDisplayAge(player.birthdate, player.age, inGameDate),
        wageProvenance: player.wageProvenance as Provenance,
        provenance: player.provenance as Provenance,
        userProfile: profile
          ? {
              assignedRole: profile.assignedRole,
              trustLevel: profile.trustLevel,
              importanceMarker: profile.importanceMarker,
              userNotes: profile.userNotes,
              positionOverride: profile.primaryPosition,
            }
          : undefined,
      };
    });
  }

  /**
   * Filters the active squad specifically for youth academy prospects.
   */
  async getYouthProspects(careerId: string): Promise<EnrichedPlayer[]> {
    const squad = await this.getCurrentSquad(careerId);
    return squad.filter((p) => p.isYouthProspect);
  }

  /**
   * Snapshot Time-Travel: Reconstructs exact squad state at a historical snapshot number.
   */
  async getSquadAtSnapshot(
    careerId: string,
    snapshotNumber: number
  ): Promise<Array<Omit<EnrichedPlayer, "latestSnapshotId" | "userProfile">>> {
    const targetSnapshot = await db
      .select()
      .from(careerSnapshots)
      .where(
        and(
          eq(careerSnapshots.careerId, careerId),
          eq(careerSnapshots.snapshotNumber, snapshotNumber)
        )
      )
      .get();

    if (!targetSnapshot) {
      throw new Error(
        `Snapshot number ${snapshotNumber} not found for career ${careerId}`
      );
    }

    const historicalPlayers = await db
      .select()
      .from(playerSnapshots)
      .where(eq(playerSnapshots.snapshotId, targetSnapshot.id));

    return historicalPlayers.map((p) => ({
      id: p.id,
      careerId: p.careerId,
      eaPlayerId: p.eaPlayerId,
      name: p.name,
      primaryPosition: p.primaryPosition || UNKNOWN_POSITION,
      overallRating: p.overallRating,
      potentialRating: p.potentialRating,
      age: p.age,
      birthdate: p.birthdate,
      wage: p.wage,
      wageProvenance: p.wageProvenance as Provenance,
      form: p.form,
      contractValidUntil: p.contractValidUntil,
      injury: p.injury,
      isYouthProspect: p.isYouthProspect,
      provenance: p.provenance as Provenance,
    }));
  }

  /**
   * Computes player OVR and Potential rating progression across historical snapshots.
   */
  async getPlayerGrowthHistory(
    careerId: string,
    eaPlayerId: number
  ): Promise<PlayerGrowthPoint[]> {
    const records = await db
      .select({
        snapshotNumber: careerSnapshots.snapshotNumber,
        inGameDate: careerSnapshots.inGameDate,
        overallRating: playerSnapshots.overallRating,
        potentialRating: playerSnapshots.potentialRating,
        createdAt: playerSnapshots.createdAt,
      })
      .from(playerSnapshots)
      .innerJoin(
        careerSnapshots,
        eq(playerSnapshots.snapshotId, careerSnapshots.id)
      )
      .where(
        and(
          eq(playerSnapshots.careerId, careerId),
          eq(playerSnapshots.eaPlayerId, eaPlayerId)
        )
      )
      .orderBy(careerSnapshots.snapshotNumber);

    return records;
  }

  /**
   * Evaluates squad depth across position groups to detect positional vulnerabilities.
   * Shared by Dashboard depth widgets, Storyline triggers, and Advisor engines.
   */
  evaluateSquadDepth(
    squad: EnrichedPlayer[],
    minPerPosition = 2
  ): SquadDepthAnalysis {
    const positionMap: Record<string, EnrichedPlayer[]> = {};

    for (const player of squad) {
      const pos = (player.primaryPosition || UNKNOWN_POSITION).toUpperCase();
      if (!positionMap[pos]) {
        positionMap[pos] = [];
      }
      positionMap[pos].push(player);
    }

    const thinPositions: PositionDepthInfo[] = [];
    const checkedPositions = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];

    for (const pos of checkedPositions) {
      const group = positionMap[pos] || [];
      if (group.length < minPerPosition) {
        thinPositions.push({
          position: pos,
          count: group.length,
          players: group,
          isThin: true,
          minRequired: minPerPosition,
        });
      }
    }

    return {
      thinPositions,
      totalPlayers: squad.length,
      positionMap,
    };
  }
}