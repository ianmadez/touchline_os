import { eq, desc } from "drizzle-orm";
import { sha256Hex } from "../parser/sha";
import { storage } from "../platform/storage";
import {
  careers,
  careerSnapshots,
  playerSnapshots,
  clubFinanceSnapshots,
  players,
  clubFinances,
  careerEvents,
  seasonHistory,
  careerObjectives,
  leaguePositions,
  leagueTeams,
  leagues,
  transferDeals,
  worldPlayers,
  youthProspects,
} from "../db/schema";
import {
  SaveCandidate,
  UNKNOWN_POSITION,
  type SeasonHistoryRow,
  type WorldPlayerEntry,
} from "../parser/interface";
import { assetStore } from "../platform/asset-store";
import { createSaveParser } from "../platform/parse-resources";
import { saveSource } from "../platform/save-source";
import { SeasonService } from "../services/season-service";
import { WorldValueModelService } from "../services/world-value-model";
import { DeterministicDiffEngine, SnapshotStateRecord } from "../events/diff-engine";

export interface SyncResult {
  status: "NO_CHANGE" | "SYNCED";
  careerId: string;
  snapshotId?: string;
  snapshotNumber?: number;
  eventsEmittedCount: number;
  events: Array<{ eventType: string; payload: unknown }>;
  /** Non-fatal parser findings (container quirks, truncated tables, ...). */
  warnings: string[];
  clubName: string;
  managerName: string;
}

/**
 * Bump this whenever the derived-state pipeline changes (name resolution,
 * squad extraction, finance extraction, ...). It is folded into the payload
 * hash, so an improved pipeline re-derives already-synced careers on the next
 * sync instead of reporting NO_CHANGE with stale data.
 *
 * v4: canonical 0-29 EA position table (base roles, UNKNOWN fallback), month/day-aware
 * age derived from the persisted birthdate, real in-game date + season year, and
 * non-zero finance extraction. Only the current-state caches (`players`, `club_finances`)
 * and the `careers` identity row are rewritten in place - prior snapshots and every
 * existing `career_events` row are preserved untouched.
 *
 * v5: record buy/sale are the peak across every `career_managerhistory` season row instead of
 * season 1 only. A mapping fix does not change the extracted payload, so without a version bump
 * the hash would match and the sync would short-circuit at NO_CHANGE, leaving the stale season-1
 * figures in `club_finances` forever.
 *
 * v6: the six `SquadEntry` fields that were parsed and then thrown away (jersey, contract expiry,
 * form, injury, the raw 0-29 position code, name source) are now persisted on `players` and
 * `player_snapshots`, alongside the head-asset flags the face importer needs to skip the network.
 * The parser also stops collapsing `career_managerhistory` to row [0].
 *
 * v7: every `career_managerhistory` season is mirrored into `season_history` instead of only the
 * first row being read, and the division size is counted into `careers.league_size` so a points
 * projection has a real denominator. These rows are written after the hash check, so without a
 * bump an unchanged save would short-circuit at NO_CHANGE and leave both tables empty.
 *
 * v8: the save's own table hints for our club (`currenttableposition`, `highestprobable`, form)
 * are captured into `league_positions` as a SAVE row, which is what seeds the position inference.
 * Also written after the hash check, so it needs its own bump for the same reason.
 *
 * v9: agreed transfer fees from `career_presignedcontract` are persisted into `transfer_deals`,
 * so a value estimate has real market prices to be fitted on instead of an invented price table.
 *
 * v10: our division is persisted club by club into `league_teams` - names from `teams`, order and
 * form from `leagueteamlinks`. The debrief screen offers those clubs as opponents instead of a
 * free-text box, and a picked club keeps a stable id rather than a spelling.
 *
 * No bump for the league catalogue: it is written before the hash check (see the `leagues` upsert),
 * so a save that has not changed still repopulates it, and no career row derives anything from it.
 */
/**
 * Raised whenever the parser starts producing something the sync must now write.
 *
 * It folds into the payload hash, so raising it forces the next sync to re-run the whole transaction
 * even when the save file is byte-identical. That is the point: a parser change ALONE does not trigger
 * a re-sync, because change detection is against the save, not against our code. The academy landed as
 * a silent no-op for exactly that reason - the parser was decoding the prospects correctly, and the
 * sync was returning NO_CHANGE before it ever reached the write. Verified by watching `youth_prospects`
 * stay empty through two successful syncs that both reported `success: true`.
 *
 * 11 - the academy: `youthProspects` from `career_youthplayers`, written to `youth_prospects`.
 */
export const SYNC_PIPELINE_VERSION = "11";

export class SyncService {
  private parser = createSaveParser();

  /**
   * Builds the insertable world pool, value bands included.
   *
   * Deliberately OUTSIDE the transaction: better-sqlite3 transactions are synchronous, so the async
   * model fit (which reads `transfer_deals` and the existing pool) cannot run inside one. The bands
   * therefore reflect the deals present at sync time - which is the same set the search filters on,
   * so the row a manager sees and the budget that filtered it always come from one model.
   */
  private async buildWorldPool(
    careerId: string,
    pool: WorldPlayerEntry[]
  ): Promise<(typeof worldPlayers.$inferInsert)[]> {
    if (pool.length === 0) return [];

    const values = new WorldValueModelService();
    const model = await values.model(careerId);
    const now = new Date().toISOString();

    return pool.map((player) => {
      const band = values.evaluate(model, {
        overallRating: player.overall,
        potentialRating: player.potential,
        age: player.age,
      });
      return {
        id: `${careerId}_${player.playerId}`,
        careerId,
        eaPlayerId: player.playerId,
        name: player.name,
        // Only the NAME can be missing. Every other field below is present either way, which the
        // dossier proves by rendering in full for an unresolved row.
        nameResolved: player.nameSource !== "unresolved",
        clubId: player.clubId,
        clubName: player.clubName,
        positionCode: player.positionCode,
        primaryPosition: player.primaryPosition || UNKNOWN_POSITION,
        overallRating: player.overall,
        potentialRating: player.potential,
        age: player.age,
        preferredFoot: player.preferredFoot,
        weakFoot: player.weakFoot,
        skillMoves: player.skillMoves,
        internationalRep: player.internationalRep,
        heightCm: player.heightCm,
        valueLow: band?.low ?? null,
        valueMid: band?.mid ?? null,
        valueHigh: band?.high ?? null,
        valueConfidence: band?.confidence ?? null,
        attributesJson: JSON.stringify({
          pace: player.pace,
          shooting: player.shooting,
          passing: player.passing,
          dribbling: player.dribbling,
          defending: player.defending,
          physical: player.physical,
          goalkeeping: player.goalkeeping,
        }),
        updatedAt: now,
      };
    });
  }

  async syncCandidate(save: SaveCandidate): Promise<SyncResult> {
    // 1. Read the bytes, then parse the container - both before the DB transaction
    const bytes = await saveSource.readBytes(save);
    const rawData = await this.parser.parse(save, bytes);
    
    // 2. Compute a deterministic payload hash (raw container + pipeline version)
    //    so real save edits create a new snapshot, while pipeline upgrades re-derive.
    const payloadHash = sha256Hex(
      JSON.stringify({
        pipeline: SYNC_PIPELINE_VERSION,
        rawPayload: rawData.rawPayload,
        extractedTables: rawData.extractedTables,
      })
    );

    const managerName = rawData.saveMetadata.managerName || "Unknown Manager";
    const clubName = rawData.saveMetadata.clubName || "Unknown Club";
    const clubId = (rawData.extractedTables.career_managerinfo?.[0] as { clubteamid?: number })
      ?.clubteamid;

    if (typeof clubId !== "number" || clubId <= 0) {
      // This used to fall back to 0, producing the id `career_club_0` and silently merging every
      // save missing a clubteamid into one shared career. Refuse rather than invent an identity.
      throw new Error(
        "This save has no career_managerinfo.clubteamid, so it has no stable career identity. " +
          "Sync aborted instead of writing to a shared 'career_club_0'."
      );
    }

    const careerId = `career_club_${clubId}`;

    // Division size, counted from `leagueteamlinks` - the one part of the save's league data that is
    // reliable, because it is populated for the user's own division even though every points and
    // result column on it reads 0. A division of N clubs plays 2 x (N - 1) games, so this is what
    // turns "36 points so far" into a projection rather than a bare number.
    const leagueLinks = (rawData.extractedTables.leagueteamlinks || []) as Array<
      Record<string, unknown>
    >;
    const ownLeagueId =
      leagueLinks.find((link) => Number(link.teamid) === clubId)?.leagueid ?? null;
    const leagueSize =
      typeof ownLeagueId === "number"
        ? leagueLinks.filter((link) => Number(link.leagueid) === ownLeagueId).length
        : null;

    // 3. Execute atomic synchronous transaction through the storage port
    // The world pool's bands are fitted out here, not inside the transaction below.
    const worldPoolValues = await this.buildWorldPool(careerId, rawData.worldPlayers ?? []);

    const result = storage.withTransaction<SyncResult>((tx) => {
      // Ensure career identity exists
      const existingCareer = tx
        .select()
        .from(careers)
        .where(eq(careers.id, careerId))
        .get();

      if (!existingCareer) {
        tx.insert(careers).values({
          id: careerId,
          managerName,
          clubId,
          clubName,
          currentSeason: rawData.saveMetadata.seasonYear || 1,
          leagueId: typeof ownLeagueId === "number" ? ownLeagueId : null,
          leagueSize: leagueSize || null,
          inGameDate: rawData.saveMetadata.currentDate,
          provenance: "SAVE",
        }).run();
      } else {
        // `careers` is identity/current state, not history. Refreshing it stops a career first
        // synced before the season fix from reporting Season 1 forever.
        tx.update(careers)
          .set({
            managerName,
            clubName,
            clubId,
            currentSeason: rawData.saveMetadata.seasonYear ?? existingCareer.currentSeason,
            leagueId: typeof ownLeagueId === "number" ? ownLeagueId : existingCareer.leagueId,
            leagueSize: leagueSize || existingCareer.leagueSize,
            inGameDate: rawData.saveMetadata.currentDate ?? existingCareer.inGameDate,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(careers.id, careerId))
          .run();
      }

      // --- League catalogue (a SAVE fact, career-scoped) ------------------------------------
      //
      // `leagues.leaguename` is the save's own leagueid -> competition-name table. It has always been
      // decoded on every parse, but reached only one diagnostics fact, so `season_history.league_id`
      // arrived on screen as a raw foreign key ("Division 14"). Persisting it here is what lets any
      // surface resolve a league id the same way, without re-parsing or re-deriving a map.
      //
      // Deliberately BEFORE the snapshot hash check below: the catalogue is reference data, not
      // derived career state, so an unchanged save still gets it written and an existing database
      // self-heals on its next sync. That is also why this needs no SYNC_PIPELINE_VERSION bump - it
      // creates no snapshot and emits no event, so the NO_CHANGE invariant is untouched.
      for (const league of rawData.leagueDirectory) {
        tx.insert(leagues)
          .values({
            careerId,
            leagueId: league.leagueId,
            name: league.name,
            level: league.level,
            countryId: league.countryId,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: [leagues.careerId, leagues.leagueId],
            set: {
              name: league.name,
              level: league.level,
              countryId: league.countryId,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      }

      // Check latest snapshot hash
      const latestSnapshot = tx
        .select()
        .from(careerSnapshots)
        .where(eq(careerSnapshots.careerId, careerId))
        .orderBy(desc(careerSnapshots.snapshotNumber))
        .limit(1)
        .get();

      // --- World player pool (a SAVE fact, career-scoped) -------------------------------------
      //
      // Written in the reference-data section, BEFORE the snapshot hash check - the same position and
      // the same reasoning as the league catalogue above. It creates no snapshot and emits no event,
      // so the NO_CHANGE invariant is untouched and an existing career self-heals on its next sync
      // WITHOUT a SYNC_PIPELINE_VERSION bump. A bump folds into the payload hash and would force the
      // entire transaction body to re-run and a new snapshot to be created; that is not a cost worth
      // paying to populate one reference table.
      //
      // Rewritten on EVERY sync, deliberately.
      //
      // The obvious optimisation - skip when the pool exists and the save is unchanged - is wrong,
      // because the value bands are a MODEL output: refining the model would then never reach existing
      // rows, and the pool would silently keep bands computed by a curve that has since been fixed.
      // A stale band is a worse bug than half a second of writes, and a sync is already a parse of the
      // whole save. What the guard DOES still skip is the work when the save carries no pool at all.
      if (worldPoolValues.length > 0) {
        tx.delete(worldPlayers).where(eq(worldPlayers.careerId, careerId)).run();
        // Chunked because SQLite caps the bound variables in one statement: 21,160 rows x 25
        // columns in a single insert is far past the limit. A fixed chunk size also keeps this to
        // a single compiled statement shape for the whole loop.
        const CHUNK = 30;
        for (let at = 0; at < worldPoolValues.length; at += CHUNK) {
          tx.insert(worldPlayers)
            .values(worldPoolValues.slice(at, at + CHUNK))
            .run();
        }
      }

      if (latestSnapshot && latestSnapshot.rawPayloadHash === payloadHash) {
        return {
          status: "NO_CHANGE",
          careerId,
          snapshotId: latestSnapshot.id,
          snapshotNumber: latestSnapshot.snapshotNumber,
          eventsEmittedCount: 0,
          events: [],
          warnings: rawData.warnings,
          clubName,
          managerName,
        };
      }

      const nextSnapshotNumber = (latestSnapshot?.snapshotNumber || 0) + 1;
      const nextSnapshotId = `snap_${careerId}_${nextSnapshotNumber}`;

      // Create Immutable Parent Snapshot
      tx.insert(careerSnapshots).values({
        id: nextSnapshotId,
        careerId,
        snapshotNumber: nextSnapshotNumber,
        rawPayloadHash: payloadHash,
        inGameDate: rawData.saveMetadata.currentDate,
      }).run();

      // Extract Next Squad & Finances from Parsed DB Tables.
      // The parser's resolved squad sample is authoritative: it carries imported
      // name-table lookups and contract wages that raw `players` rows cannot express.
      const resolvedSquad = rawData.squadSample ?? [];
      const rawPlayers = (rawData.extractedTables.players || []) as Array<Record<string, unknown>>;
      const rawTeamLinks = (rawData.extractedTables.teamplayerlinks || []) as Array<Record<string, unknown>>;
      
      const clubPlayerIds = new Set(
        rawTeamLinks
          .filter((link) => Number(link.teamid) === clubId)
          .map((link) => Number(link.playerid))
      );

      const nextPlayersState =
        resolvedSquad.length > 0
          ? resolvedSquad.map((entry) => ({
              eaPlayerId: entry.playerId,
              name: entry.name,
              primaryPosition: entry.primaryPosition || UNKNOWN_POSITION,
              overallRating: entry.overall ?? 60,
              potentialRating: entry.potential ?? 60,
              age: entry.age,
              birthdate: entry.birthdate,
              jersey: entry.jersey,
              contractValidUntil: entry.contractValidUntil,
              form: entry.form,
              injury: entry.injury,
              positionCode: entry.position,
              nameSource: entry.nameSource,
              hasHighQualityHead: entry.hasHighQualityHead,
              headAssetId: entry.headAssetId,
              avatarPomId: entry.avatarPomId,
              wage: entry.wage ?? 0,
              isYouthProspect: (entry.age !== null && entry.age <= 21),
            }))
          : rawPlayers
              .filter((p) => clubPlayerIds.has(Number(p.playerid)))
              .map((p) => ({
                eaPlayerId: Number(p.playerid),
                name: `${p.firstname || ""} ${p.surname || ""}`.trim() || `Player ${p.playerid}`,
                primaryPosition: UNKNOWN_POSITION,
                overallRating: Number(p.overallrating) || 60,
                potentialRating: Number(p.potential) || 60,
                age: p.age ? Number(p.age) : null,
                birthdate: p.birthdate ? Number(p.birthdate) : null,
                // This fallback path reads bare `players` rows, which carry none of the fields that
                // come from teamplayerlinks / career_playercontract, and no position could be mapped.
                jersey: null,
                contractValidUntil: null,
                form: null,
                injury: null,
                positionCode: null,
                nameSource: null,
                hasHighQualityHead: null,
                headAssetId: null,
                avatarPomId: null,
                wage: Number(p.wage) || 0,
                isYouthProspect: Boolean(p.is_youth),
              }));

      const rawFinances = (rawData.extractedTables.career_managerpref?.[0] || {}) as Record<string, unknown>;
      const rawManagerInfo = (rawData.extractedTables.career_managerinfo?.[0] || {}) as Record<string, unknown>;
      // These were hardcoded to 0 even though the parser already decodes them, which is why the
      // dashboard always showed zero total earnings and no record buy/sale.
      //
      // `career_managerhistory` is ONE ROW PER SEASON, each holding that season's own biggest buy
      // and sale. Reading row [0] reported season 1's deals as the career records permanently
      // (the dashboard showed 1,550,000 / 920,000 while the real peaks were 5,500,000 / 12,800,000).
      // The career record is the peak across every season, so reduce over all rows.
      // `career_managerpref` and `career_managerinfo` genuinely are single-row, so [0] is correct there.
      const managerHistory = (rawData.extractedTables.career_managerhistory || []) as Array<
        Record<string, unknown>
      >;
      const peakAmount = (key: string): number =>
        managerHistory.reduce((max, row) => Math.max(max, Number(row[key]) || 0), 0);
      const nextFinancesState = {
        transferBudget: Number(rawFinances.transferbudget) || 0,
        wageBudget: Number(rawFinances.wagebudget) || 0,
        totalEarnings: Number(rawManagerInfo.totalearnings) || 0,
        recordBuy: peakAmount("bigbuyamount"),
        recordSale: peakAmount("bigsellamount"),
      };

      // Persist Immutable State Snapshots (N)
      for (const player of nextPlayersState) {
        tx.insert(playerSnapshots).values({
          id: `${nextSnapshotId}_${player.eaPlayerId}`,
          snapshotId: nextSnapshotId,
          careerId,
          eaPlayerId: player.eaPlayerId,
          name: player.name,
          primaryPosition: player.primaryPosition,
          overallRating: player.overallRating,
          potentialRating: player.potentialRating,
          age: player.age,
          birthdate: player.birthdate,
          jersey: player.jersey,
          contractValidUntil: player.contractValidUntil,
          form: player.form,
          injury: player.injury,
          positionCode: player.positionCode,
          nameSource: player.nameSource,
          wage: player.wage,
          wageProvenance: "DERIVED",
          isYouthProspect: player.isYouthProspect,
          provenance: "SAVE",
        }).run();
      }

      tx.insert(clubFinanceSnapshots).values({
        id: `${nextSnapshotId}_finances`,
        snapshotId: nextSnapshotId,
        careerId,
        transferBudget: nextFinancesState.transferBudget,
        transferBudgetProvenance: "DERIVED",
        wageBudget: nextFinancesState.wageBudget,
        wageBudgetProvenance: "DERIVED",
        totalEarnings: nextFinancesState.totalEarnings,
        recordBuy: nextFinancesState.recordBuy,
        recordSale: nextFinancesState.recordSale,
        provenance: "SAVE",
      }).run();

      // Retrieve Snapshot (N-1) State for Deterministic Diffing
      let prevSnapshotState: SnapshotStateRecord | null = null;

      if (latestSnapshot) {
        const prevPlayers = tx
          .select()
          .from(playerSnapshots)
          .where(eq(playerSnapshots.snapshotId, latestSnapshot.id))
          .all();

        const prevFinances = tx
          .select()
          .from(clubFinanceSnapshots)
          .where(eq(clubFinanceSnapshots.snapshotId, latestSnapshot.id))
          .get();

        prevSnapshotState = {
          careerId,
          snapshotId: latestSnapshot.id,
          inGameDate: latestSnapshot.inGameDate || undefined,
          players: prevPlayers.map((p) => ({
            eaPlayerId: p.eaPlayerId,
            name: p.name,
            overallRating: p.overallRating,
            potentialRating: p.potentialRating,
            age: p.age,
            wage: p.wage,
            isYouthProspect: p.isYouthProspect,
          })),
          finances: prevFinances
            ? {
                transferBudget: prevFinances.transferBudget,
                wageBudget: prevFinances.wageBudget,
                totalEarnings: prevFinances.totalEarnings,
                recordBuy: prevFinances.recordBuy,
                recordSale: prevFinances.recordSale,
              }
            : undefined,
        };
      }

      const nextSnapshotState: SnapshotStateRecord = {
        careerId,
        snapshotId: nextSnapshotId,
        inGameDate: rawData.saveMetadata.currentDate,
        players: nextPlayersState,
        finances: nextFinancesState,
      };

      // Compute Deterministic Events
      const generatedEvents = DeterministicDiffEngine.computeDiff(
        prevSnapshotState,
        nextSnapshotState,
        "SAVE"
      );

      // Persist Events into Spine Table
      for (const evt of generatedEvents) {
        tx.insert(careerEvents).values({
          id: evt.id,
          careerId: evt.careerId,
          snapshotId: evt.snapshotId,
          eventType: evt.eventType,
          source: evt.source,
          entityType: evt.entityType,
          entityId: evt.entityId,
          payloadJson: evt.payloadJson,
        }).run();
      }

      // Update Current State Read Caches
      for (const player of nextPlayersState) {
        tx.insert(players)
          .values({
            id: `${careerId}_${player.eaPlayerId}`,
            careerId,
            latestSnapshotId: nextSnapshotId,
            eaPlayerId: player.eaPlayerId,
            name: player.name,
            primaryPosition: player.primaryPosition,
            overallRating: player.overallRating,
            potentialRating: player.potentialRating,
            age: player.age,
            birthdate: player.birthdate,
            jersey: player.jersey,
            contractValidUntil: player.contractValidUntil,
            form: player.form,
            injury: player.injury,
            positionCode: player.positionCode,
            nameSource: player.nameSource,
            hasHighQualityHead: player.hasHighQualityHead,
            headAssetId: player.headAssetId,
            avatarPomId: player.avatarPomId,
            wage: player.wage,
            wageProvenance: "DERIVED",
            isYouthProspect: player.isYouthProspect,
            provenance: "SAVE",
          })
          .onConflictDoUpdate({
            target: [players.careerId, players.eaPlayerId],
            set: {
              latestSnapshotId: nextSnapshotId,
              name: player.name,
              primaryPosition: player.primaryPosition,
              overallRating: player.overallRating,
              potentialRating: player.potentialRating,
              wage: player.wage,
              age: player.age,
              birthdate: player.birthdate,
              // Every one of these must be listed here: a version bump only re-derives the columns
              // its `set` names, so an omission leaves stale values on existing rows forever.
              jersey: player.jersey,
              contractValidUntil: player.contractValidUntil,
              form: player.form,
              injury: player.injury,
              positionCode: player.positionCode,
              nameSource: player.nameSource,
              hasHighQualityHead: player.hasHighQualityHead,
              headAssetId: player.headAssetId,
              avatarPomId: player.avatarPomId,
              // Previously omitted from the conflict set, so a re-derivation could not correct a
              // stale youth flag on an existing row.
              isYouthProspect: player.isYouthProspect,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      }

      // ---- The academy -------------------------------------------------------------------------
      // The rows are DELETED first rather than upserted. The academy is a mirrored SET, not a growing
      // log: a prospect who graduates or is released has to disappear from the table, and an upsert
      // would leave him sitting there forever with no row in the save behind him.
      const prospects = rawData.youthProspects ?? [];
      tx.delete(youthProspects).where(eq(youthProspects.careerId, careerId)).run();
      for (const prospect of prospects) {
        tx.insert(youthProspects)
          .values({
            // Deterministic, so a re-sync replaces the same row rather than colliding on the unique
            // (career, player) index.
            id: `${careerId}_${prospect.playerId}`,
            careerId,
            playerId: prospect.playerId,
            name: prospect.name,
            nameSource: prospect.nameSource,
            positionCode: prospect.positionCode,
            primaryPosition: prospect.primaryPosition,
            age: prospect.age,
            birthdate: prospect.birthdate,
            overallRating: prospect.overallRating,
            potentialRating: prospect.potentialRating,
            // Ranges, not settled values - see `YouthProspectRow` for why.
            tierLow: prospect.tierLow,
            tierHigh: prospect.tierHigh,
            swingLowMin: prospect.swingLowMin,
            swingLowMax: prospect.swingLowMax,
            varianceMin: prospect.varianceMin,
            varianceMax: prospect.varianceMax,
            monthsInSquad: prospect.monthsInSquad,
            assessmentCount: prospect.assessmentCount,
            goals: prospect.goals,
            appearances: prospect.appearances,
            provenance: "SAVE",
            updatedAt: new Date().toISOString(),
          })
          .run();
      }

      tx.insert(clubFinances)
        .values({
          id: careerId,
          careerId,
          latestSnapshotId: nextSnapshotId,
          transferBudget: nextFinancesState.transferBudget,
          transferBudgetProvenance: "DERIVED",
          wageBudget: nextFinancesState.wageBudget,
          wageBudgetProvenance: "DERIVED",
          totalEarnings: nextFinancesState.totalEarnings,
          recordBuy: nextFinancesState.recordBuy,
          recordSale: nextFinancesState.recordSale,
          provenance: "SAVE",
        })
        .onConflictDoUpdate({
          target: [clubFinances.careerId],
          set: {
            latestSnapshotId: nextSnapshotId,
            transferBudget: nextFinancesState.transferBudget,
            wageBudget: nextFinancesState.wageBudget,
            // Previously omitted from the conflict set, so the finance cache kept its old zeros
            // after a re-derivation even once extraction was fixed.
            totalEarnings: nextFinancesState.totalEarnings,
            recordBuy: nextFinancesState.recordBuy,
            recordSale: nextFinancesState.recordSale,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();

      // --- Season history (SAVE facts) -----------------------------------------------------
      //
      // `career_managerhistory` holds one row per season. Mirroring every row is what stops the app
      // collapsing to season 1, and `tablePosition` is the save's only reliable "the season has
      // ended" signal: it stays 0 until the season completes, and there is no SEASON_ENDED flag
      // anywhere in the file.
      const seasonRows = rawData.seasonHistory.filter(
        (row): row is SeasonHistoryRow & { season: number } => row.season !== null
      );
      for (const season of seasonRows) {
        const seasonValues = {
          id: `${careerId}_s${season.season}`,
          careerId,
          season: season.season,
          leagueId: season.leagueId,
          gamesPlayed: season.gamesPlayed,
          wins: season.wins,
          draws: season.draws,
          losses: season.losses,
          points: season.points,
          goalsFor: season.goalsFor,
          goalsAgainst: season.goalsAgainst,
          tablePosition: season.tablePosition,
          leagueObjective: season.leagueObjective,
          leagueObjectiveResult: season.leagueObjectiveResult,
          domesticCupObjective: season.domesticCupObjective,
          europeCupObjective: season.europeCupObjective,
          leagueTrophies: season.leagueTrophies,
          bigBuyAmount: season.bigBuyAmount,
          bigBuyPlayerName: season.bigBuyPlayerName,
          bigSellAmount: season.bigSellAmount,
          bigSellPlayerName: season.bigSellPlayerName,
          provenance: "SAVE" as const,
          updatedAt: new Date().toISOString(),
        };
        tx.insert(seasonHistory)
          .values(seasonValues)
          .onConflictDoUpdate({
            target: [seasonHistory.careerId, seasonHistory.season],
            set: seasonValues,
          })
          .run();
      }

      // --- Board objective, SAVE track -----------------------------------------------------
      //
      // EA's own objective for the season, kept beside - never merged with - the free text the
      // manager typed at onboarding. Two provenances answering the same question; where they
      // disagree that difference is the interesting part, not something to resolve.
      //
      // The code itself is an unmapped 0-31 enum: there is no lookup table in the schema and the
      // three `seasonobjective1..3` slots on `career_managerinfo` all read 0 in this save (the
      // reference found the same), so the raw value is stored and never captioned as a meaning.
      const latestSeason = seasonRows.reduce<SeasonHistoryRow | null>(
        (newest, row) =>
          newest === null || (row.season ?? 0) > (newest.season ?? 0) ? row : newest,
        null
      );
      if (latestSeason && latestSeason.season !== null) {
        tx.insert(careerObjectives)
          .values({
            id: `${careerId}_s${latestSeason.season}_SAVE`,
            careerId,
            seasonNumber: latestSeason.season,
            source: "SAVE",
            text: null,
            targetPosition: null,
            status: "ACTIVE",
            outcome: null,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: [
              careerObjectives.careerId,
              careerObjectives.seasonNumber,
              careerObjectives.source,
            ],
            // Deliberately does NOT touch `status` or `outcome`: once a season has been closed out
            // by the season-end pass, re-syncing the same completed season must not reopen it.
            set: { updatedAt: new Date().toISOString() },
          })
          .run();
      }

      // --- Observed transfer prices ----------------------------------------------------------
      //
      // `career_presignedcontract` is every deal agreed across the save's world, fees included. It
      // was decoded and discarded for weeks. It is the only real market evidence in the file, and
      // the value model is fitted on it, so it is persisted rather than recomputed from a parse.
      for (const deal of rawData.presignedDeals) {
        const dealValues = {
          id: `${careerId}_${deal.playerId}_${deal.signedDate ?? 0}`,
          careerId,
          playerId: deal.playerId,
          offeredFee: deal.offeredFee,
          offeredWage: deal.offeredWage,
          signedDate: deal.signedDate,
          completeDate: deal.completeDate,
          buyingTeamId: deal.buyingTeamId,
          sellingTeamId: deal.sellingTeamId,
          isLoanBuy: deal.isLoanBuy,
          isExchangePlayer: deal.isExchangePlayer,
          provenance: "SAVE" as const,
          updatedAt: new Date().toISOString(),
        };
        tx.insert(transferDeals)
          .values(dealValues)
          .onConflictDoUpdate({
            target: [transferDeals.careerId, transferDeals.playerId, transferDeals.signedDate],
            set: dealValues,
          })
          .run();
      }

      // --- What the save itself says about our table position -------------------------------
      //
      // `leagueteamlinks` is zeroed for our division on points and results, but a few columns are
      // live: the current table position, the previous year's, the club's form string, and the
      // game's own best-plausible finish. Those are real SAVE facts about where we sit, and they
      // seed the position inference instead of making the manager guess from nothing.
      const ownLink = leagueLinks.find((link) => Number(link.teamid) === clubId);
      const asNumber = (value: unknown): number | null =>
        typeof value === "number" && Number.isFinite(value) ? value : null;
      const savePosition = ownLink ? asNumber(ownLink.currenttableposition) : null;
      if (savePosition !== null && savePosition > 0) {
        tx.insert(leaguePositions)
          .values({
            id: `${nextSnapshotId}_savehint`,
            careerId,
            snapshotId: nextSnapshotId,
            seasonYear: rawData.saveMetadata.seasonYear ?? null,
            position: savePosition,
            positionHigh: null,
            source: "SAVE",
            basis: "save-hint",
            evidenceCount: 1,
            projectedBest: ownLink ? asNumber(ownLink.highestprobable) : null,
            // Our own record, from the current season row - the division's other clubs have no
            // readable record at all, which is why the table can only ever be inferred.
            points: latestSeason?.points ?? null,
            played: latestSeason?.gamesPlayed ?? null,
            goalDifference:
              latestSeason && latestSeason.goalsFor !== null && latestSeason.goalsAgainst !== null
                ? latestSeason.goalsFor - latestSeason.goalsAgainst
                : null,
            note: ownLink ? `Form string: ${String(ownLink.teamform ?? "unknown")}` : null,
          })
          .onConflictDoNothing()
          .run();
      }

      // --- Our division, club by club -------------------------------------------------------
      //
      // `leagueteamlinks` carries every club in our division; `teams` supplies readable names. The
      // same rows give a table position, last year's position and a form string. What they do NOT
      // give is points or results - those are zeroed for the user's own division, and the earlier
      // investigation established that this is true for every club in it, not just ours. So this is
      // ORDER and FORM only, and nothing downstream may present it as a rival's record.
      //
      // Recording it is what lets the debrief screen offer the actual clubs the manager plays
      // against rather than a free-text box, and lets a picked club carry a stable id into the
      // record instead of whichever spelling was typed.
      const teamNames = new Map<number, string>();
      for (const team of (rawData.extractedTables.teams || []) as Array<Record<string, unknown>>) {
        const id = asNumber(team.teamid);
        const name = typeof team.teamname === "string" ? team.teamname.trim() : "";
        if (id !== null && name) teamNames.set(id, name);
      }

      if (typeof ownLeagueId === "number") {
        for (const link of leagueLinks) {
          if (Number(link.leagueid) !== ownLeagueId) continue;
          const teamId = asNumber(link.teamid);
          const name = teamId !== null ? teamNames.get(teamId) : undefined;
          // A club whose name did not decode is skipped rather than stored as a blank row - the
          // whole point of this table is to offer real names.
          if (teamId === null || !name) continue;

          const teamValues = {
            id: `${careerId}_${teamId}`,
            careerId,
            latestSnapshotId: nextSnapshotId,
            teamId,
            name,
            leagueId: ownLeagueId,
            // Sparse in the save: some clubs carry no position at all and a few share one. Stored
            // as-is, nulls included, rather than filled in with a guessed ordering.
            tablePosition: asNumber(link.currenttableposition),
            previousYearPosition: asNumber(link.previousyeartableposition),
            form:
              link.teamform === undefined || link.teamform === null
                ? null
                : String(link.teamform),
            lastGameResult: asNumber(link.lastgameresult),
            isOwnClub: teamId === clubId,
            provenance: "SAVE" as const,
            updatedAt: new Date().toISOString(),
          };

          tx.insert(leagueTeams)
            .values(teamValues)
            .onConflictDoUpdate({
              target: [leagueTeams.careerId, leagueTeams.teamId],
              set: teamValues,
            })
            .run();
        }
      }

      return {
        status: "SYNCED",
        careerId,
        snapshotId: nextSnapshotId,
        snapshotNumber: nextSnapshotNumber,
        eventsEmittedCount: generatedEvents.length,
        events: generatedEvents.map((e) => ({
          eventType: e.eventType,
          payload: JSON.parse(e.payloadJson),
        })),
        warnings: rawData.warnings,
        clubName,
        managerName,
      };
    });

    // Faces for anyone who arrived since the last sync.
    //
    // Outside the transaction on purpose: this is network I/O and must never sit inside an atomic
    // write. It is cheap when nothing changed - a player already on disk is a single existsSync and
    // no request - so the only real cost is a genuinely new signing. A failure here is not a sync
    // failure: the face component falls back to an initials disc and the next sync retries.
    if (result.status === "SYNCED") {
      try {
        const seasonService = new SeasonService();
        await seasonService.recordMatchdayProgress(careerId);
      } catch (err) {
        console.error("[sync-service] Failed to record matchday progress:", err);
      }
    }

    // Faces, for EVERY successful sync - not only one that wrote something.
    //
    // This used to sit inside the SYNCED branch, and that made an unresolved face permanent: a sync
    // that finds nothing new returns NO_CHANGE and skipped this whole block, so a player whose sprite
    // failed to arrive once - a dropped connection, a CDN blip - was never tried again on that save.
    // The pass is idempotent and cheap once the cache is warm (one lookup per player, no request), so
    // the only real cost is a genuinely new signing. A face that is still missing after this is
    // retried the next time the player is rendered.
    try {
      await assetStore.refreshSquadFaces(careerId);
    } catch {
      // Deliberately swallowed. Faces are presentation, and a dead CDN must not fail a sync.
    }

    return result;
  }
}