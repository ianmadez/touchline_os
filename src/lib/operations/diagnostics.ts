import { assetStore } from "../platform/asset-store";
import { storage } from "../platform/storage";
import { collectDiagnostics } from "../services/diagnostics-service";
import { failed, ok, type OperationResult } from "./types";

/**
 * Everything the Data Management panel needs to describe what is actually stored: the active career,
 * the database size, snapshot/event counts, and where exports land. Read-only - it never mutates.
 */
export async function readDiagnostics(): Promise<OperationResult<unknown>> {
  try {
    const { activeCareer, careerRows, snapshotCountByCareer, counts } = await collectDiagnostics();
    const database = await storage.databaseInfo();

    return ok({
      success: true,
      activeCareer: activeCareer
        ? {
            careerId: activeCareer.id,
            clubName: activeCareer.clubName,
            managerName: activeCareer.managerName,
            currentSeason: activeCareer.currentSeason,
            inGameDate: activeCareer.inGameDate,
            updatedAt: activeCareer.updatedAt,
          }
        : null,
      database: {
        path: database.location,
        exists: database.exists,
        sizeBytes: database.sizeBytes,
      },
      counts,
      careers: careerRows.map((row) => ({
        careerId: row.id,
        clubName: row.clubName,
        managerName: row.managerName,
        currentSeason: row.currentSeason,
        updatedAt: row.updatedAt,
        snapshotCount: snapshotCountByCareer.get(row.id) ?? 0,
      })),
      exportsDirectory: assetStore.exportsLocation(),
    });
  } catch (error) {
    console.error("[api/diagnostics] failed:", error);
    return failed(500, (error as Error).message ?? "Could not read diagnostics.");
  }
}
