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
import { EnrichedPlayer, SquadService, type SquadDepthAnalysis } from "./squad-service";
import { PitchSlotAssignment, TacticsService } from "./tactics-service";
import { SeasonService, type SeasonState } from "./season-service";
import { ValueService, type PlayerValuation } from "./value-service";
import { FORMATIONS_REGISTRY, getFormationById } from "../tactics/formations";
import { StorylineItem, DomainEvent } from "../events/types";
import {
  CONTRACT_CLEARED_SEASONS,
  DEPTH_SOLVED_AT,
  EvidenceFact,
  FORM_RECOVERED_AT,
  contractExpiryFacts,
  developmentFacts,
  positionChangeFacts,
  formFacts,
  squadDepthFacts,
  evidenceEventId,
  resolveOverStale,
  storylineClosureEventId,
  storylineOpenedEventId,
  type DevelopmentObservation,
} from "../events/evidence";
import { composeStoryline, severityFor, severityReason, toComposableFact } from "../events/compose";

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

    // Facts collected during this pass, written once at the end so the write is in one place.
    const pending: PendingEvidence[] = [];

    // The probe compares contract dates against the season we are actually in, which the save
    // states. Falls back to the calendar year only if the career row is somehow missing.
    const careerRow = await db
      .select({ currentSeason: careers.currentSeason, inGameDate: careers.inGameDate })
      .from(careers)
      .where(eq(careers.id, careerId))
      .get();
    const currentSeason = careerRow?.currentSeason ?? new Date().getFullYear();
    // The save's own date, passed to the composer rather than letting it read a clock.
    const inGameDate = careerRow?.inGameDate ?? null;

    // Threads we know about: the rows read above plus anything opened during this pass.
    //
    // Keeping this in memory matters because the rules run in sequence - a thread opened by the
    // progress rule should be adopted by the breakthrough rule moments later, not duplicated.
    const knownThreads = existingStorylines.map((s) => ({
      id: s.id,
      category: s.category as StorylineCategory,
      title: s.title,
      status: s.status as StorylineStatus,
    }));

    /**
     * Opens a thread about this subject, adopts the open one, or reopens a closed one - and attaches
     * the fact that prompted it.
     *
     * Three behaviours, each for a reason:
     *
     * - **Adopt by subject.** Threads opened before ids were derived carry a random uuid, so matching
     *   the derived id alone would open a second thread about the same player or position. The
     *   subject token is what finds them, which is why every category keeps a stable subject in its
     *   title.
     * - **Reopen rather than duplicate.** A closed thread whose exact condition has provably returned
     *   (the same player's form drops again, the same role is thin again) is reopened, keeping its
     *   evidence history. That history is the point: a second slump is more interesting than the
     *   first, and only a compounding thread can say so.
     * - **Never invent a subject.** The fact is always attached to a real thread id, whether it was
     *   created, adopted or reopened.
     */
    const openOrAdoptThread = async (input: {
      category: StorylineCategory;
      discriminator: string;
      title: string;
      adoptBySubject?: string;
      fact: EvidenceFact;
      openingEventId?: string | null;
    }): Promise<string> => {
      const derivedId = deterministicStorylineId(careerId, input.category, input.discriminator);
      const openMatch = knownThreads.find(
        (thread) =>
          thread.category === input.category &&
          thread.status === "ACTIVE" &&
          (input.adoptBySubject
            ? thread.title.includes(input.adoptBySubject)
            : thread.id === derivedId)
      );

      if (openMatch) {
        pending.push({ fact: input.fact, storylineId: openMatch.id });
        return openMatch.id;
      }

      const now = new Date().toISOString();
      await db
        .insert(storylines)
        .values({
          id: derivedId,
          careerId,
          title: input.title,
          category: input.category,
          status: "ACTIVE",
          // The season this belongs to, which is what makes "its season has passed" answerable.
          seasonNumber: currentSeason,
          openedAt: now,
          openingEventId: input.openingEventId ?? null,
          updatedAt: now,
        })
        .onConflictDoNothing();

      const existing = knownThreads.find((thread) => thread.id === derivedId);
      if (existing) {
        existing.status = "ACTIVE";
        existing.title = input.title;
        await db
          .update(storylines)
          .set({ status: "ACTIVE", title: input.title, resolvedAt: null, updatedAt: now })
          .where(eq(storylines.id, derivedId));
      } else {
        knownThreads.push({
          id: derivedId,
          category: input.category,
          title: input.title,
          status: "ACTIVE",
        });
      }

      pending.push({ fact: input.fact, storylineId: derivedId });
      return derivedId;
    };

    // Rule 1: Squad Depth Gap Storylines
    //
    // Structural fact: one reading opens it, because a squad list is not a trend. The hysteresis is
    // on the clear side instead - a role only counts as solved at DEPTH_SOLVED_AT - so the signing
    // that fixes a gap does not close the thread on its way past, and a squad oscillating between
    // one and two specialists does not open and resolve the same thread over and over.
    const depthAnalysis = this.squadService.evaluateSquadDepth(squad);
    for (const fact of squadDepthFacts(depthAnalysis.thinPositions)) {
      const position = String(fact.payload.position);
      await openOrAdoptThread({
        category: "SQUAD_DEPTH",
        discriminator: fact.entityId,
        // The position stays the first word on purpose: it is the token that finds threads opened
        // by the older, uuid-based rule.
        title: `${position} depth: only ${String(fact.payload.count)} in the squad`,
        adoptBySubject: position,
        fact,
      });
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

    // Breakthroughs the diff engine spotted, keyed by the save's own player id. The diff event and
    // the snapshot comparison usually describe the same movement, so the breakthrough is used to
    // *escalate* that movement rather than to state it a second time. The exception is a player with
    // no earlier reading at all - a newly signed youngster - where the diff event is the only
    // witness and is therefore the fact itself.
    const breakthroughs = new Map<number, { delta: number; eventId: string; name: string }>();
    for (const event of recentEvents) {
      if (event.eventType !== "PLAYER_OVR_CHANGED") continue;
      try {
        const eventAny = event as unknown as Record<string, unknown>;
        const rawPayload = eventAny.payloadJson ?? eventAny.payload;
        const parsed: unknown =
          typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
        const payload = (parsed ?? {}) as {
          isBreakthrough?: boolean;
          delta?: number;
          name?: string;
          eaPlayerId?: number;
        };
        const isBreakthrough = payload.isBreakthrough ?? (payload.delta ?? 0) >= 3;
        if (!isBreakthrough || typeof payload.eaPlayerId !== "number") continue;
        breakthroughs.set(payload.eaPlayerId, {
          delta: payload.delta ?? 0,
          eventId: event.id,
          name: payload.name || "Squad Player",
        });
      } catch {
        /* an unreadable payload tells us nothing; the snapshot comparison still sees the move */
      }
    }

    /** One DEVELOPMENT thread per player: a rating move, a position move and a breakthrough are one story. */
    const attachToProgressThread = async (fact: EvidenceFact, openingEventId?: string | null) => {
      const playerName = String(fact.payload.name);
      await openOrAdoptThread({
        category: "DEVELOPMENT",
        discriminator: fact.entityId,
        title: `${playerName} - player progress`,
        adoptBySubject: playerName,
        fact,
        openingEventId,
      });
    };

    const movementCovered = new Set<number>();
    const movementFacts = [
      ...developmentFacts(trendObservations),
      ...positionChangeFacts(trendObservations),
    ];
    for (const fact of movementFacts) {
      const eaPlayerId = Number(fact.payload.eaPlayerId);
      const breakthrough = Number.isFinite(eaPlayerId) ? breakthroughs.get(eaPlayerId) : undefined;
      if (breakthrough) movementCovered.add(eaPlayerId);
      await attachToProgressThread(
        // A step the engine called a breakthrough is worth more than the same step it did not.
        breakthrough ? { ...fact, weight: "SERIOUS" } : fact,
        breakthrough?.eventId
      );
    }

    // Breakthroughs the snapshot comparison could not see, because the player had no earlier
    // reading to compare against.
    for (const [eaPlayerId, breakthrough] of breakthroughs) {
      if (movementCovered.has(eaPlayerId)) continue;
      const player = squad.find((candidate) => candidate.eaPlayerId === eaPlayerId);
      await attachToProgressThread(
        {
          eventType: "PLAYER_DEVELOPED",
          source: "DERIVED",
          entityId: player?.id ?? `ea_${eaPlayerId}`,
          key: `breakthrough:${breakthrough.eventId}`,
          weight: "SERIOUS",
          summary: `${breakthrough.name} has jumped ${breakthrough.delta} overall in one step.`,
          payload: {
            playerId: player?.id ?? `ea_${eaPlayerId}`,
            eaPlayerId,
            name: breakthrough.name,
            delta: breakthrough.delta,
            primaryPosition: player?.primaryPosition ?? null,
          },
        },
        breakthrough.eventId
      );
    }

    // Rule 1d: Form Storylines
    //
    // Trend fact: opened from the *movement* between two snapshots, never from the reading itself.
    // In the reference save every fit senior player reads exactly 3, so a level-based rule would
    // open either nothing or a thread for the entire first team - and against the 0-10 scale this
    // file used to claim, it would have been the latter.
    //
    // A recovery is evidence, not a storyline: good form is not a decision the manager has to make,
    // so PLAYER_FORM_STREAK only ever attaches to a thread that is already open.
    for (const fact of formFacts(trendObservations)) {
      const playerName = String(fact.payload.name);
      if (fact.eventType === "PLAYER_FORM_SLUMP") {
        await openOrAdoptThread({
          category: "FORM",
          discriminator: fact.entityId,
          title: `${playerName} - form watch`,
          adoptBySubject: playerName,
          fact,
        });
      } else {
        const open = knownThreads.find(
          (thread) => thread.category === "FORM" && thread.title.includes(playerName)
        );
        if (open) pending.push({ fact, storylineId: open.id });
      }
    }

    // The evidence pass. Writes the facts gathered above and guarantees every thread carries at
    // least its own opening fact, which is what makes a thread readable rather than a bare flag.
    await this.writeEvidence(careerId, pending);

    const threads = await db
      .select()
      .from(storylines)
      .where(eq(storylines.careerId, careerId))
      .orderBy(desc(storylines.updatedAt));

    const evidenceMap = await this.loadThreadEvidence(threads.map((thread) => thread.id));

    // The lifecycle pass. Every category decides closure through the same precedence rule, so no
    // category can quietly implement "answered beats dropped" differently to the others.
    await this.closeAnsweredThreads(
      careerId,
      threads,
      squad,
      evidenceMap,
      depthAnalysis,
      recentEvents,
      currentSeason
    );

    return threads.map((s) => {
      // Composed on read, never stored: re-wording a card must not rewrite what was observed. The
      // facts keep the sentences they were recorded with, and the composer only arranges them.
      const facts = (evidenceMap[s.id] || []).map(toComposableFact);
      const composed = composeStoryline(
        {
          // The thread's id seeds the wording: stable per thread, different between threads.
          id: s.id,
          category: s.category as StorylineCategory,
          title: s.title,
          status: s.status as StorylineStatus,
        },
        facts,
        inGameDate
      );

      return {
        id: s.id,
        careerId: s.careerId,
        title: composed.title,
        body: composed.body,
        severity: severityFor(s.category as StorylineCategory, facts, inGameDate),
        severityReason: severityReason(s.category as StorylineCategory, facts, inGameDate),
        openingTitle: s.title,
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
      };
    });
  }

  /**
   * Every fact attached to any of these threads, newest first.
   *
   * One query serves two readers: the lifecycle pass, which has to know who a thread is about, and
   * the card, which shows the facts. Id is the tiebreak because every row written in one pass shares
   * a timestamp, and an unstable sort would shuffle the list between renders.
   */
  private async loadThreadEvidence(
    storylineIds: string[]
  ): Promise<Record<string, DomainEvent[]>> {
    const evidenceMap: Record<string, DomainEvent[]> = {};
    if (storylineIds.length === 0) return evidenceMap;

    const links = await db
      .select({
        storylineId: storylineEvents.storylineId,
        event: careerEvents,
        // The save's own date at the snapshot a fact was filed against. Without it the best we can
        // say is when we noticed a fact, which is not when it happened in the career.
        inGameDate: careerSnapshots.inGameDate,
      })
      .from(storylineEvents)
      .innerJoin(careerEvents, eq(storylineEvents.eventId, careerEvents.id))
      .leftJoin(careerSnapshots, eq(careerEvents.snapshotId, careerSnapshots.id))
      .where(inArray(storylineEvents.storylineId, storylineIds))
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
        inGameDate: link.inGameDate ?? null,
      });
    }

    // "Opened: Darcy." sitting beside the contract fact that opened it is the same information twice,
    // so the bookkeeping row is dropped wherever the thread has real evidence to show instead. It is
    // only suppressed here on the way out; the row itself is never deleted.
    for (const [storylineId, events] of Object.entries(evidenceMap)) {
      if (events.length <= 1) continue;
      evidenceMap[storylineId] = events.filter((event) => event.eventType !== "STORYLINE_OPENED");
    }

    return evidenceMap;
  }

  /**
   * Closes threads that are answered, or that can no longer be followed.
   *
   * One pass, one precedence rule (`resolveOverStale`), called for every category - which is the
   * point of it: a copy of "an answer beats a drop" per category is a rule that drifts silently.
   * When a thread closes, *why* is recorded as a career event with a deterministic id, so the
   * timeline shows the lifecycle and re-running over unchanged data adds nothing.
   *
   * SEASON_OBJECTIVE threads are skipped on purpose: the season pass owns their lifecycle, and two
   * owners for one status is how a thread ends up opened, staled and opened again.
   */
  private async closeAnsweredThreads(
    careerId: string,
    threads: (typeof storylines.$inferSelect)[],
    squad: EnrichedPlayer[],
    evidenceMap: Record<string, DomainEvent[]>,
    depthAnalysis: SquadDepthAnalysis,
    recentEvents: ParsedCareerEvent[],
    currentSeason: number
  ): Promise<void> {
    const active = threads.filter((thread) => thread.status === "ACTIVE");
    if (active.length === 0) return;

    const snapshotId = await this.latestSnapshotId(careerId);
    const career = await db
      .select({ inGameDate: careers.inGameDate })
      .from(careers)
      .where(eq(careers.id, careerId))
      .get();
    const byPlayerRowId = new Map(squad.map((player) => [player.id, player]));
    const byEaPlayerId = new Map(squad.map((player) => [player.eaPlayerId, player]));
    const signingEventId = recentEvents.find((e) => e.eventType === "PLAYER_SIGNED")?.id ?? null;
    const soldEventId = recentEvents.find((e) => e.eventType === "PLAYER_SOLD")?.id ?? null;

    /** Who a thread is about, read back from the facts that opened it. Threads carry no entity column. */
    const subjectOf = (storylineId: string) => {
      for (const fact of evidenceMap[storylineId] ?? []) {
        try {
          const payload = JSON.parse(fact.payloadJson) as {
            playerId?: unknown;
            eaPlayerId?: unknown;
          };
          const playerId = typeof payload.playerId === "string" ? payload.playerId : null;
          const eaPlayerId = typeof payload.eaPlayerId === "number" ? payload.eaPlayerId : null;
          if (playerId || eaPlayerId) return { playerId, eaPlayerId };
        } catch {
          /* a fact we cannot read identifies nobody; keep looking */
        }
      }
      return { playerId: null as string | null, eaPlayerId: null as number | null };
    };

    const playerFor = (storylineId: string) => {
      const subject = subjectOf(storylineId);
      return (
        (subject.eaPlayerId !== null ? byEaPlayerId.get(subject.eaPlayerId) : undefined) ??
        (subject.playerId !== null ? byPlayerRowId.get(subject.playerId) : undefined)
      );
    };

    for (const thread of active) {
      let decision: ReturnType<typeof resolveOverStale> = null;
      let resolvingEventId: string | null = null;

      if (thread.category === "SQUAD_DEPTH") {
        // The subject is the first word of the title: the token the older rule wrote, which is why
        // `openOrAdoptThread` adopts by it too.
        const position = thread.title.split(" ")[0];
        const count = depthAnalysis.positionMap[position]?.length ?? 0;
        decision = resolveOverStale({ answered: count >= DEPTH_SOLVED_AT, unobservable: false });
        resolvingEventId = signingEventId;
      } else if (thread.category === "CONTRACT") {
        const player = playerFor(thread.id);
        if (!player) {
          // Not in the squad any more: sold, released or retired. That is the answer to the thread
          // rather than a reason to drop it - we saw how it ended, which is exactly what a manager
          // would say about it.
          decision = resolveOverStale({ answered: true, unobservable: false });
          resolvingEventId = soldEventId;
        } else {
          const until = player.contractValidUntil;
          // Two ways the situation can stop being news, and both matter:
          //
          //  - the deal has provably MOVED further out (the save's own field changed to a later
          //    date), which is a renewal however it was agreed and whether or not anything logged it;
          //  - or it now sits beyond the cleared window, which is the buffer's job: opening needs it
          //    inside one year, clearing needs it more than two out.
          const recorded = (evidenceMap[thread.id] ?? [])
            .map((fact) => {
              try {
                const payload = JSON.parse(fact.payloadJson) as { contractValidUntil?: unknown };
                return typeof payload.contractValidUntil === "number"
                  ? payload.contractValidUntil
                  : null;
              } catch {
                return null;
              }
            })
            .filter((value): value is number => value !== null);
          const earliestRecorded = recorded.length > 0 ? Math.min(...recorded) : null;

          decision = resolveOverStale({
            answered:
              until !== null &&
              ((earliestRecorded !== null && until > earliestRecorded) ||
                until > currentSeason + CONTRACT_CLEARED_SEASONS),
            unobservable: false,
          });
        }
      } else if (thread.category === "FORM") {
        const player = playerFor(thread.id);
        const form = player?.form ?? null;
        decision = resolveOverStale({
          // Recovery is the answer, and it has to clear the *upper* threshold rather than merely
          // stop being bad - that gap is the hysteresis that stops a wobbling reading flapping.
          answered: form !== null && form >= FORM_RECOVERED_AT,
          // If the player left the club the reading stopped, so there is nothing left to follow.
          // Answered wins when both hold - that precedence is the whole points of the shared rule.
          unobservable: !player,
        });
      } else if (thread.category === "DEVELOPMENT") {
        const player = playerFor(thread.id);
        // Nothing answers a progress thread yet, so the only closure is losing sight of the player.
        decision = resolveOverStale({ answered: false, unobservable: !player });
      }

      if (!decision) continue;

      const now = new Date().toISOString();
      const closureEventId = storylineClosureEventId(careerId, thread.id, decision.status);
      const closureEvent: DomainEvent = {
        id: closureEventId,
        careerId,
        snapshotId: snapshotId ?? "",
        eventType: decision.status === "RESOLVED" ? "STORYLINE_RESOLVED" : "STORYLINE_STALE",
        source: "DERIVED",
        // Mirrors the season pass, which is the only other writer of a lifecycle event.
        entityType: "STORYLINE",
        entityId: thread.id,
        payloadJson: JSON.stringify({
          careerId,
          storylineId: thread.id,
          title: thread.title,
          category: thread.category,
          summary:
            decision.status === "RESOLVED"
              ? `Answered: ${thread.title}.`
              : `Dropped: ${thread.title} - it can no longer be followed.`,
          reason: decision.reason,
        }),
        timestamp: now,
        inGameDate: career?.inGameDate ?? null,
      };

      await db.insert(careerEvents).values({
        id: closureEvent.id,
        careerId,
        snapshotId,
        eventType: closureEvent.eventType,
        source: closureEvent.source,
        entityType: closureEvent.entityType,
        entityId: closureEvent.entityId,
        payloadJson: closureEvent.payloadJson,
        timestamp: now,
      }).onConflictDoNothing();

      await db.insert(storylineEvents)
        .values({ id: crypto.randomUUID(), storylineId: thread.id, eventId: closureEventId })
        .onConflictDoNothing();

      // The card should be able to say why a thread closed, so the closure is part of its evidence.
      if (!evidenceMap[thread.id]) evidenceMap[thread.id] = [];
      evidenceMap[thread.id].unshift(closureEvent);

      // Prefer the career event a manager would point at - a signing, a sale - over our own note.
      const resolvedBy = thread.resolvingEventId ?? resolvingEventId ?? closureEventId;
      await db
        .update(storylines)
        .set({
          status: decision.status,
          resolvedAt: now,
          resolvingEventId: resolvedBy,
          updatedAt: now,
        })
        .where(eq(storylines.id, thread.id));

      // Keep the in-memory row in step so the payload this call returns shows the new state.
      thread.status = decision.status;
      thread.resolvedAt = now;
      thread.resolvingEventId = resolvedBy;
      thread.updatedAt = now;
    }
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
        // Form is read on the same pass as the rating: same two rows, same comparison, and a form
        // figure is only meaningful against the reading before it.
        fromForm: before.form,
        toForm: row.form,
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
            // After the spread on purpose: how much a fact weighs is the probe's judgement, and no
            // payload key may quietly override it.
            weight: fact.weight ?? "NOTABLE",
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

    // Threads that already carry evidence of their own. A thread opened *by* a fact does not also need
    // a synthetic "Opened: ..." row: the row says nothing the fact does not, and it was what made
    // every card read its own situation twice - once in the heading, once in the first evidence line.
    const threadsWithEvidence = new Set(existingLinks.map((link) => link.storylineId));

    for (const thread of allThreads) {
      if (threadsWithEvidence.has(thread.id)) continue;

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
