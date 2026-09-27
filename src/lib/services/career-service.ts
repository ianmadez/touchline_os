import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  careers,
  careerSnapshots,
  managerOnboardingProfiles,
  playerSnapshots,
  storylines,
  storylineEvents,
  leagueTeams,
  careerEvents,
  StorylineCategory,
  StorylineStatus,
} from "../db/schema";
import { EventService, ParsedCareerEvent } from "./event-service";
import { EnrichedPlayer, SquadService } from "./squad-service";
import { PitchSlotAssignment, TacticsService } from "./tactics-service";
import { SeasonService, type SeasonState } from "./season-service";
import { ValueService, type PlayerValuation } from "./value-service";
import { FORMATIONS_REGISTRY, getFormationById } from "../tactics/formations";
import { StorylineItem, DomainEvent } from "../events/types";
import {
  EvidenceFact,
  contractExpiryFacts,
  developmentFacts,
  positionChangeFacts,
  evidenceEventId,
  storylineOpenedEventId,
  type DevelopmentObservation,
} from "../events/evidence";

/** A fact together with the thread it should be attached to. */
interface PendingEvidence {
  fact: EvidenceFact;
  storylineId: string;
}

/**
 * A thread id derived from what the thread is about, rather than a fresh uuid.
 *
 * This is what makes the rules below safe to re-run: "the contract thread for this player" is the
 * same id every time, so re-evaluating finds the existing thread instead of opening a second one.
 * SHA-1 is doing duty as a naming function here, not as anything security-related.
 */
function deterministicStorylineId(
  careerId: string,
  category: StorylineCategory,
  discriminator: string
): string {
  const digest = crypto
    .createHash("sha1")
    .update([careerId, category, discriminator].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `st_${digest}`;
}

export interface OnboardingInput {
  managerName?: string | null;
  nationality?: string | null;
  tacticalPhilosophy?: string | null;
  realismLevel?: string | null;
  favFormations?: string[] | null;
  managerObjective?: string | null;
  boardObjective?: string | null;
  personalObjective?: string | null;
  /** Uploaded badge (data URL) or a remote link. USER provenance. */
  clubLogoUrl?: string | null;
}

export interface CareerSummary {
  careerId: string;
  managerName: string;
  clubName: string;
  clubId: number;
  season: number;
  inGameDate: string | null;
  latestSnapshotNumber: number | null;
}

export interface CareerOnboardingState {
  nationality: string | null;
  tacticalPhilosophy: string | null;
  realismLevel: string;
  favFormations: string[];
  managerObjective: string | null;
  boardObjective: string | null;
  personalObjective: string | null;
  clubLogoUrl: string | null;
}

/**
 * Single source of truth for "give me everything the app shell needs for a career".
 * Both POST /api/parse-save (after a sync) and GET /api/career (page refresh) return
 * this exact shape, so the client has one hydration path and no duplicated mapping.
 */
export interface CareerHydrationPayload extends CareerSummary {
  players: EnrichedPlayer[];
  formationId: string;
  tacticsSlots: PitchSlotAssignment[];
  recentEvents: ParsedCareerEvent[];
  storylines: StorylineItem[];
  onboarding: CareerOnboardingState | null;
  /** Season history, the two board-objective tracks, and the derived season outlook. */
  seasonState: SeasonState;
  /**
   * Estimated value per player, keyed by EA player id. DERIVED, never a save fact - the save holds
   * no player valuation at all. A player the model cannot support is simply absent, or present with
   * `available: false`.
   */
  valuations: Record<number, PlayerValuation>;
  /**
   * Every club in the manager's own division, so the app can name opponents instead of asking the
   * manager to type them. SAVE provenance, and order/form only - the save carries no rival record.
   */
  leagueTeams: LeagueTeamSummary[];
}

/** One club in the division, as the save describes it. */
export interface LeagueTeamSummary {
  teamId: number;
  name: string;
  /** Null when the save states no position for this club. Never guessed. */
  tablePosition: number | null;
  previousYearPosition: number | null;
  /** The save's opaque result code string, e.g. "22111". */
  form: string | null;
  isOwnClub: boolean;
}

/** Maps a human label ("4-3-3 Holding") or an id ("4-3-3-holding") onto a registry id. */
export function resolveFormationId(label: string | null | undefined): string | null {
  if (!label) return null;
  const normalised = label.trim().toLowerCase();
  const match = FORMATIONS_REGISTRY.find(
    (formation) =>
      formation.id.toLowerCase() === normalised || formation.name.toLowerCase() === normalised
  );
  return match?.id ?? null;
}

export class CareerService {
  private squadService = new SquadService();
  private tacticsService = new TacticsService();
  private eventService = new EventService();
  private seasonService = new SeasonService();
  private valueService = new ValueService();

  async getCareerRow(careerId: string) {
    return db.select().from(careers).where(eq(careers.id, careerId)).get();
  }

  /** Most recently touched career, used when a refresh has no career id stored. */
  async getLatestCareerRow() {
    return db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(1).get();
  }

  async hydrate(careerId: string): Promise<CareerHydrationPayload | null> {
    const career = await this.getCareerRow(careerId);
    if (!career) return null;

    const [players, tacticState, recentEvents, onboardingRow, latestSnapshot, leagueTeamRows] =
      await Promise.all([
        this.squadService.getCurrentSquad(careerId, career.inGameDate),
        this.tacticsService.getTacticalSystem(careerId),
        this.eventService.getTimeline(careerId, 25),
        db
          .select()
          .from(managerOnboardingProfiles)
          .where(eq(managerOnboardingProfiles.careerId, careerId))
          .get(),
        db
          .select()
          .from(careerSnapshots)
          .where(eq(careerSnapshots.careerId, careerId))
          .orderBy(desc(careerSnapshots.snapshotNumber))
          .limit(1)
          .get(),
        db
          .select()
          .from(leagueTeams)
          .where(eq(leagueTeams.careerId, careerId))
          // Alphabetical here only so the input to the display sort below is deterministic; the
          // ordering that matters (own club first, then by position) is applied to the payload.
          .orderBy(leagueTeams.name),
      ]);

    const activeStorylines = await this.evaluateAndSyncStorylines(
      careerId,
      players,
      recentEvents
    );

    // The end-of-season pass. Idempotent by construction: it only writes where it actually
    // transitions a season-scoped objective or thread, so re-hydrating unchanged data is a no-op
    // and cannot manufacture spine events on every refresh.
    await this.seasonService.evaluateSeasonTransition(careerId);
    const seasonState = await this.seasonService.getState(careerId);
    // Fitted once for the whole squad, so every player is valued against the same model.
    const valuations = await this.valueService.valueSquad(careerId, players);

    return {
      careerId: career.id,
      managerName: career.managerName,
      clubName: career.clubName,
      clubId: career.clubId,
      season: career.currentSeason,
      inGameDate: career.inGameDate,
      latestSnapshotNumber: latestSnapshot?.snapshotNumber ?? null,
      players,
      formationId: tacticState.formationName,
      tacticsSlots: tacticState.slots,
      recentEvents,
      storylines: activeStorylines,
      seasonState,
      valuations,
      leagueTeams: leagueTeamRows
        .map((row) => ({
          teamId: row.teamId,
          name: row.name,
          tablePosition: row.tablePosition,
          previousYearPosition: row.previousYearPosition,
          form: row.form,
          isOwnClub: row.isOwnClub,
        }))
        .sort((a, b) => {
          if (a.isOwnClub !== b.isOwnClub) return a.isOwnClub ? -1 : 1;
          const aPos = a.tablePosition ?? Number.MAX_SAFE_INTEGER;
          const bPos = b.tablePosition ?? Number.MAX_SAFE_INTEGER;
          if (aPos !== bPos) return aPos - bPos;
          return a.name.localeCompare(b.name);
        }),
      onboarding: onboardingRow
        ? {
            nationality: onboardingRow.nationality,
            tacticalPhilosophy: onboardingRow.tacticalPhilosophy,
            realismLevel: onboardingRow.realismLevel,
            favFormations: onboardingRow.favFormationsJson
              ? (JSON.parse(onboardingRow.favFormationsJson) as string[])
              : [],
            managerObjective: onboardingRow.managerObjective,
            boardObjective: onboardingRow.boardObjective,
            personalObjective: onboardingRow.personalObjective,
            clubLogoUrl: onboardingRow.clubLogoUrl,
          }
        : null,
    };
  }

  async upsertOnboarding(careerId: string, input: OnboardingInput): Promise<void> {
    const existing = await db
      .select()
      .from(managerOnboardingProfiles)
      .where(eq(managerOnboardingProfiles.careerId, careerId))
      .get();

    const favFormationsJson = input.favFormations ? JSON.stringify(input.favFormations) : null;
    const updatedAt = new Date().toISOString();

    if (existing) {
      await db
        .update(managerOnboardingProfiles)
        .set({
          nationality: input.nationality ?? existing.nationality,
          tacticalPhilosophy: input.tacticalPhilosophy ?? existing.tacticalPhilosophy,
          realismLevel: input.realismLevel ?? existing.realismLevel,
          favFormationsJson: favFormationsJson ?? existing.favFormationsJson,
          managerObjective: input.managerObjective ?? existing.managerObjective,
          boardObjective: input.boardObjective ?? existing.boardObjective,
          personalObjective: input.personalObjective ?? existing.personalObjective,
          clubLogoUrl: input.clubLogoUrl ?? existing.clubLogoUrl,
          updatedAt,
        })
        .where(eq(managerOnboardingProfiles.id, existing.id));
    } else {
      await db.insert(managerOnboardingProfiles).values({
        id: crypto.randomUUID(),
        careerId,
        nationality: input.nationality ?? null,
        tacticalPhilosophy: input.tacticalPhilosophy ?? null,
        realismLevel: input.realismLevel ?? "REALISTIC",
        favFormationsJson,
        managerObjective: input.managerObjective ?? null,
        boardObjective: input.boardObjective ?? null,
        personalObjective: input.personalObjective ?? null,
        clubLogoUrl: input.clubLogoUrl ?? null,
        provenance: "USER",
      });
    }

    await this.touchCareer(careerId);
  }

  /**
   * Seeds the tactical system from the manager's favourite formation the first time a
   * career is opened. Existing user layouts are never overwritten.
   */
  async ensureInitialTactics(careerId: string, favFormations?: string[] | null): Promise<void> {
    const formationId = resolveFormationId(favFormations?.[0]);
    if (!formationId) return;

    const current = await this.tacticsService.getTacticalSystem(careerId);
    const hasAssignedPlayer = current.slots.some((slot) => slot.playerId !== null);
    const hasStoredSystem = current.formationName !== "4-3-3-holding" || hasAssignedPlayer;
    if (hasStoredSystem) return;

    const definition = getFormationById(formationId);
    await this.tacticsService.saveTacticalSystem({
      careerId,
      formationName: formationId,
      slots: definition.slots.map((slot) => ({
        slotIndex: slot.slotIndex,
        role: slot.role,
        label: slot.label,
        playerId: null,
        eaPlayerId: null,
        playerName: null,
        overallRating: null,
      })),
    });
  }

  async saveTactics(
    careerId: string,
    formationId: string,
    slots: PitchSlotAssignment[]
  ): Promise<void> {
    const current = await this.tacticsService.getTacticalSystem(careerId);
    await this.tacticsService.saveTacticalSystem({
      careerId,
      formationName: resolveFormationId(formationId) ?? formationId,
      slots,
      inPossessionShape: current.inPossessionShape,
      outOfPossessionShape: current.outOfPossessionShape,
      pressingStyle: current.pressingStyle,
      buildUpStyle: current.buildUpStyle,
      notes: current.notes,
    });
    await this.touchCareer(careerId);
  }

  /**
   * Deterministic Storyline Engine Evaluator.
   * Runs on every career sync/hydration to open, update, resolve, or stale storylines.
   */
  async evaluateAndSyncStorylines(
    careerId: string,
    squad: EnrichedPlayer[],
    recentEvents: ParsedCareerEvent[]
  ): Promise<StorylineItem[]> {
    const existingStorylines = await db
      .select()
      .from(storylines)
      .where(eq(storylines.careerId, careerId));

    const activeStorylines = existingStorylines.filter((s) => s.status === "ACTIVE");

    // Facts collected during this pass, written once at the end so the write is in one place.
    const pending: PendingEvidence[] = [];

    // The probe compares contract dates against the season we are actually in, which the save
    // states. Falls back to the calendar year only if the career row is somehow missing.
    const careerRow = await db
      .select({ currentSeason: careers.currentSeason })
      .from(careers)
      .where(eq(careers.id, careerId))
      .get();
    const currentSeason = careerRow?.currentSeason ?? new Date().getFullYear();

    // Rule 1: Squad Depth Gap Storylines
    const depthAnalysis = this.squadService.evaluateSquadDepth(squad);
    for (const thinPos of depthAnalysis.thinPositions) {
      const existing = activeStorylines.find(
        (s) => s.category === "SQUAD_DEPTH" && s.title.includes(thinPos.position)
      );
      if (!existing) {
        const id = crypto.randomUUID();
        // The position stays the first word on purpose: the resolve rule below finds a thread
        // again by splitting the title and matching that first token.
        const title = `${thinPos.position} depth: only ${thinPos.count} in the squad`;
        const openedAt = new Date().toISOString();
        await db.insert(storylines).values({
          id,
          careerId,
          title,
          category: "SQUAD_DEPTH",
          status: "ACTIVE",
          openedAt,
          updatedAt: openedAt,
        });
      }
    }

    // Resolve SQUAD_DEPTH storylines if depth threshold is restored
    const thinPosSet = new Set(depthAnalysis.thinPositions.map((p) => p.position));
    for (const active of activeStorylines) {
      if (active.category === "SQUAD_DEPTH") {
        const posMatch = active.title.split(" ")[0];
        if (posMatch && !thinPosSet.has(posMatch)) {
          const latestSigning = recentEvents.find((e) => e.eventType === "PLAYER_SIGNED");
          await db
            .update(storylines)
            .set({
              status: "RESOLVED",
              resolvedAt: new Date().toISOString(),
              resolvingEventId: latestSigning?.id ?? null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(storylines.id, active.id));
        }
      }
    }

    // Rule 1b: Contract Expiry Storylines
    //
    // One thread per player whose deal is inside the radar window, because that is how a manager
    // thinks about it - a decision about a named person, not a squad-wide statistic. The thread id
    // is derived from the player rather than random, so re-evaluating cannot open a second thread
    // about the same contract.
    for (const fact of contractExpiryFacts(squad, currentSeason)) {
      const threadId = deterministicStorylineId(careerId, "CONTRACT", fact.entityId);
      // The title states the situation, not just the name - a card headed only "Trygve Danielsen"
      // tells the manager nothing about why it is on the screen.
      const desiredTitle = `Contract: ${String(fact.payload.name)} runs out in ${String(
        fact.payload.contractValidUntil
      )}`;
      const existing = existingStorylines.find((s) => s.id === threadId);

      if (!existing) {
        const now = new Date().toISOString();
        await db
          .insert(storylines)
          .values({
            id: threadId,
            careerId,
            title: desiredTitle,
            category: "CONTRACT",
            status: "ACTIVE",
            openedAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      } else if (existing.title !== desiredTitle) {
        // A renewal, or a correction to how we word the situation. Only the wording moves; the
        // timestamp is deliberately left alone, because re-phrasing a card is not career news and
        // bumping it would reshuffle the manager's feed for no reason.
        await db
          .update(storylines)
          .set({ title: desiredTitle })
          .where(eq(storylines.id, threadId));
      }

      pending.push({ fact, storylineId: threadId });
    }

    // Rule 1c: Player Progress Storylines
    //
    // The save records a rating and a position per snapshot; the movement and the comparison are
    // ours. Only players present in both comparable snapshots are reported - someone who appears in
    // just one was signed or sold, and counting that as progress would be wrong.
    //
    // Ratings and positions share a thread per player. Two threads about the same person, both
    // saying something changed, is noise rather than depth.
    const trendObservations = await this.developmentObservations(careerId);

    const attachToProgressThread = async (fact: EvidenceFact) => {
      const playerName = String(fact.payload.name);
      // Reuse any active thread already about this player, matching the depth rule's approach, so
      // a breakthrough detected elsewhere and a trend detected here do not become two threads.
      const existing = activeStorylines.find(
        (s) => s.category === "DEVELOPMENT" && s.title.includes(playerName)
      );
      let threadId = existing?.id;
      if (!threadId) {
        threadId = deterministicStorylineId(careerId, "DEVELOPMENT", fact.entityId);
        const now = new Date().toISOString();
        await db
          .insert(storylines)
          .values({
            id: threadId,
            careerId,
            title: `${playerName} - player progress`,
            category: "DEVELOPMENT",
            status: "ACTIVE",
            openedAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      pending.push({ fact, storylineId: threadId });
    };

    for (const fact of developmentFacts(trendObservations)) {
      await attachToProgressThread(fact);
    }

    // Position moves read from the same snapshot pair, so this costs no extra query.
    for (const fact of positionChangeFacts(trendObservations)) {
      await attachToProgressThread(fact);
    }

    // Rule 2: Breakthrough & Youth Development Storylines
    for (const event of recentEvents) {
      if (event.eventType === "PLAYER_OVR_CHANGED") {
        try {
          const eventAny = event as unknown as Record<string, unknown>;
          const rawPayload = eventAny.payloadJson ?? eventAny.payload;
          const parsed: unknown =
            typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
          const payload = (parsed ?? {}) as {
            isBreakthrough?: boolean;
            delta?: number;
            name?: string;
          };
          if (payload.isBreakthrough || (payload.delta !== undefined && payload.delta >= 3)) {
            const playerName = payload.name || "Squad Player";
            const delta = payload.delta ?? 3;
            const title = `Breakthrough Development: ${playerName} (+${delta} OVR)`;
            const exists = existingStorylines.some((s) => s.title === title);
            if (!exists) {
              await db.insert(storylines).values({
                id: crypto.randomUUID(),
                careerId,
                title,
                category: "DEVELOPMENT",
                status: "ACTIVE",
                openedAt: new Date().toISOString(),
                openingEventId: event.id,
                updatedAt: new Date().toISOString(),
              });
            }
          }
        } catch {
          /* ignore payload parse errors */
        }
      }
    }

    // The evidence pass. Writes the facts gathered above and guarantees every thread carries at
    // least its own opening fact, which is what turns the card's "Evidence (N)" control from dead
    // chrome into something that opens.
    await this.writeEvidence(careerId, pending);

    // Fetch refreshed list with evidence event links
    const allStorylines = await db
      .select()
      .from(storylines)
      .where(eq(storylines.careerId, careerId))
      .orderBy(desc(storylines.updatedAt));

    const storylineIds = allStorylines.map((s) => s.id);
    const evidenceMap: Record<string, DomainEvent[]> = {};

    if (storylineIds.length > 0) {
      const links = await db
        .select({
          storylineId: storylineEvents.storylineId,
          event: careerEvents,
        })
        .from(storylineEvents)
        .innerJoin(careerEvents, eq(storylineEvents.eventId, careerEvents.id))
        .where(inArray(storylineEvents.storylineId, storylineIds))
        // Newest first for the card. Id is the tiebreak because every row written in one pass
        // shares a timestamp, and an unstable sort would shuffle the list between renders.
        .orderBy(desc(careerEvents.timestamp), desc(careerEvents.id));

      for (const link of links) {
        if (!evidenceMap[link.storylineId]) {
          evidenceMap[link.storylineId] = [];
        }
        evidenceMap[link.storylineId].push({
          id: link.event.id,
          careerId: link.event.careerId,
          snapshotId: link.event.snapshotId || "",
          // These columns are plain TEXT in SQLite, so they read back as `string`. Narrowing here is
          // the honest cast: the values are only ever written from these very unions.
          eventType: link.event.eventType as DomainEvent["eventType"],
          source: link.event.source as DomainEvent["source"],
          entityType: link.event.entityType as DomainEvent["entityType"],
          entityId: link.event.entityId,
          payloadJson: link.event.payloadJson,
          timestamp: link.event.timestamp,
        });
      }
    }

    return allStorylines.map((s) => ({
      id: s.id,
      careerId: s.careerId,
      title: s.title,
      category: s.category as StorylineCategory,
      status: s.status as StorylineStatus,
      openedAt: s.openedAt,
      // The clock is read here, on the server, rather than in the component: a render-time
      // Date.now() is impure and would hydrate to a different number than the server rendered.
      daysActive: Math.max(
        1,
        Math.floor((Date.now() - new Date(s.openedAt).getTime()) / 86_400_000)
      ),
      resolvedAt: s.resolvedAt,
      openingEventId: s.openingEventId,
      resolvingEventId: s.resolvingEventId,
      updatedAt: s.updatedAt,
      evidenceEvents: evidenceMap[s.id] || [],
    }));
  }

  private async touchCareer(careerId: string): Promise<void> {
    await db
      .update(careers)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(careers.id, careerId));
  }

  /** The snapshot a new spine event should be filed against. */
  private async latestSnapshotId(careerId: string): Promise<string | null> {
    const snapshot = await db
      .select({ id: careerSnapshots.id })
      .from(careerSnapshots)
      .where(eq(careerSnapshots.careerId, careerId))
      .orderBy(desc(careerSnapshots.snapshotNumber))
      .limit(1)
      .get();
    return snapshot?.id ?? null;
  }

  /**
   * Rebuilds development movement by comparing the two most recent snapshots.
   *
   * Returns nothing until there are two snapshots to compare. With a single reading there is no
   * movement to describe, and presenting a rating on its own as progress would be a lie.
   */
  private async developmentObservations(
    careerId: string
  ): Promise<DevelopmentObservation[]> {
    const recent = await db
      .select()
      .from(careerSnapshots)
      .where(eq(careerSnapshots.careerId, careerId))
      .orderBy(desc(careerSnapshots.snapshotNumber))
      .limit(2);

    if (recent.length < 2) return [];

    const [latest, previous] = recent;
    const [currentRows, previousRows] = await Promise.all([
      db.select().from(playerSnapshots).where(eq(playerSnapshots.snapshotId, latest.id)),
      db.select().from(playerSnapshots).where(eq(playerSnapshots.snapshotId, previous.id)),
    ]);

    const previousByPlayer = new Map(previousRows.map((row) => [row.eaPlayerId, row]));

    const observations: DevelopmentObservation[] = [];
    for (const row of currentRows) {
      const before = previousByPlayer.get(row.eaPlayerId);
      // Absent from the earlier snapshot means they were signed, not that they grew.
      if (!before) continue;
      observations.push({
        playerId: row.id,
        eaPlayerId: row.eaPlayerId,
        name: row.name,
        fromOvr: before.overallRating,
        toOvr: row.overallRating,
        fromSnapshot: previous.snapshotNumber,
        toSnapshot: latest.snapshotNumber,
        fromDate: previous.inGameDate,
        fromPosition: before.primaryPosition,
        toPosition: row.primaryPosition,
        fromPositionCode: before.positionCode,
        toPositionCode: row.positionCode,
      });
    }

    return observations;
  }

  /**
   * Persists evidence and attaches it to the thread it belongs to.
   *
   * Every row is keyed by a hash of what it says rather than by when we noticed it, so a second
   * pass over unchanged data computes the same ids and both inserts are discarded. That is what
   * lets this run on every hydration without the career history growing by accident - a reload is
   * not an event.
   *
   * It also guarantees every thread has an opening fact, because a card whose "Evidence" control
   * opens onto nothing is worse than no control at all. Where an opening event already exists for
   * the thread - season-scoped threads have one written by the season pass - that row is linked
   * rather than a second one being invented.
   */
  private async writeEvidence(
    careerId: string,
    pending: PendingEvidence[]
  ): Promise<void> {
    const snapshotId = await this.latestSnapshotId(careerId);

    for (const { fact, storylineId } of pending) {
      const eventId = evidenceEventId(careerId, fact);
      await db
        .insert(careerEvents)
        .values({
          id: eventId,
          careerId,
          snapshotId,
          eventType: fact.eventType,
          source: fact.source,
          // Deliberately not "STORYLINE": evidence is supporting detail, so the generic activity
          // feed can leave it out while the thread it belongs to still shows it in full.
          entityType: "EVIDENCE",
          entityId: fact.entityId,
          payloadJson: JSON.stringify({
            careerId,
            storylineId,
            summary: fact.summary,
            ...fact.payload,
          }),
        })
        .onConflictDoNothing();

      await db
        .insert(storylineEvents)
        .values({ id: crypto.randomUUID(), storylineId, eventId })
        // The (storyline, event) unique index makes a repeat link a no-op, so the row's own id
        // never needs to be deterministic.
        .onConflictDoNothing();
    }

    // Opening evidence for every thread in this career, newest threads first.
    const allThreads = await db
      .select({ id: storylines.id, title: storylines.title, category: storylines.category })
      .from(storylines)
      .where(eq(storylines.careerId, careerId));

    if (allThreads.length === 0) return;

    const existingLinks = await db
      .select({ storylineId: storylineEvents.storylineId, eventId: storylineEvents.eventId })
      .from(storylineEvents)
      .where(
        inArray(
          storylineEvents.storylineId,
          allThreads.map((thread) => thread.id)
        )
      );
    const linkedEvents = new Set(existingLinks.map((link) => link.eventId));

    // Opening events that exist but were never attached - the season pass writes one per
    // season-scoped thread and has no reason to know about this table.
    const openedEvents = await db
      .select({ id: careerEvents.id, payloadJson: careerEvents.payloadJson })
      .from(careerEvents)
      .where(
        and(
          eq(careerEvents.careerId, careerId),
          eq(careerEvents.eventType, "STORYLINE_OPENED")
        )
      );

    const openedByThread = new Map<string, string>();
    for (const event of openedEvents) {
      try {
        const payload = JSON.parse(event.payloadJson) as { storylineId?: unknown };
        if (typeof payload.storylineId === "string") {
          openedByThread.set(payload.storylineId, event.id);
        }
      } catch {
        /* a payload we cannot read tells us nothing; fall through to writing our own */
      }
    }

    for (const thread of allThreads) {
      const existing = openedByThread.get(thread.id);
      const eventId = existing ?? storylineOpenedEventId(careerId, thread.id);
      if (linkedEvents.has(eventId)) continue;

      if (!existing) {
        await db
          .insert(careerEvents)
          .values({
            id: eventId,
            careerId,
            snapshotId,
            eventType: "STORYLINE_OPENED",
            source: "DERIVED",
            entityType: "EVIDENCE",
            entityId: thread.id,
            payloadJson: JSON.stringify({
              careerId,
              storylineId: thread.id,
              title: thread.title,
              category: thread.category,
              summary: `Opened: ${thread.title}.`,
            }),
          })
          .onConflictDoNothing();
      }

      await db
        .insert(storylineEvents)
        .values({ id: crypto.randomUUID(), storylineId: thread.id, eventId })
        .onConflictDoNothing();
    }
  }
}
