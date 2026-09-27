import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  careers,
  careerSnapshots,
  careerEvents,
  players,
  playerSnapshots,
} from "@/lib/db/schema";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Counts rows in a table, optionally scoped to one career. */
async function countRows(
  table: typeof players | typeof playerSnapshots | typeof careerEvents | typeof careerSnapshots,
  careerId?: string
): Promise<number> {
  const query = db.select({ value: sql<number>`count(*)` }).from(table);
  const scoped = careerId
    ? await query.where(eq(table.careerId, careerId)).get()
    : await query.get();
  return scoped?.value ?? 0;
}

/**
 * GET /api/diagnostics
 *
 * Everything the Data Management panel needs to describe what is actually stored on disk:
 * the active career, the SQLite file size, snapshot/event counts, and the export directory.
 * Read-only - it never mutates anything.
 */
export async function GET() {
  try {
    const career = await db
      .select()
      .from(careers)
      .orderBy(desc(careers.updatedAt))
      .limit(1)
      .get();

    const snapshotCounts = await db
      .select({ careerId: careerSnapshots.careerId, value: sql<number>`count(*)` })
      .from(careerSnapshots)
      .groupBy(careerSnapshots.careerId);

    const countByCareer = new Map(snapshotCounts.map((row) => [row.careerId, row.value]));

    const careerRows = await db
      .select()
      .from(careers)
      .orderBy(desc(careers.updatedAt));

    let databaseSizeBytes: number | null = null;
    let databaseExists = false;
    try {
      const stat = fs.statSync(config.databasePath);
      databaseSizeBytes = stat.size;
      databaseExists = stat.isFile();
    } catch {
      // A missing database file is a valid state (nothing synced yet), not an error.
    }

    const latestSnapshot = career
      ? await db
          .select({ snapshotNumber: careerSnapshots.snapshotNumber })
          .from(careerSnapshots)
          .where(eq(careerSnapshots.careerId, career.id))
          .orderBy(desc(careerSnapshots.snapshotNumber))
          .limit(1)
          .get()
      : undefined;

    return NextResponse.json({
      success: true,
      activeCareer: career
        ? {
            careerId: career.id,
            clubName: career.clubName,
            managerName: career.managerName,
            currentSeason: career.currentSeason,
            inGameDate: career.inGameDate,
            updatedAt: career.updatedAt,
          }
        : null,
      database: {
        path: config.databasePath,
        exists: databaseExists,
        sizeBytes: databaseSizeBytes,
      },
      counts: {
        careers: careerRows.length,
        snapshots: await countRows(careerSnapshots),
        playerSnapshots: await countRows(playerSnapshots),
        careerEvents: await countRows(careerEvents),
        players: await countRows(players),
        latestSnapshotNumber: latestSnapshot?.snapshotNumber ?? null,
      },
      careers: careerRows.map((row) => ({
        careerId: row.id,
        clubName: row.clubName,
        managerName: row.managerName,
        currentSeason: row.currentSeason,
        updatedAt: row.updatedAt,
        snapshotCount: countByCareer.get(row.id) ?? 0,
      })),
      exportsDirectory: path.join(process.cwd(), "data", "exports"),
    });
  } catch (error) {
    console.error("[api/diagnostics] failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read diagnostics." },
      { status: 500 }
    );
  }
}
