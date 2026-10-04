/**
 * Read-only diagnostics: what is actually stored, counted per table.
 *
 * Split out of the route so the route no longer reaches the database client directly, and so the
 * browser build can produce the same numbers from its own storage.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  careers,
  careerSnapshots,
  careerEvents,
  players,
  playerSnapshots,
} from "../db/schema";

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

export interface DiagnosticsCounts {
  careers: number;
  snapshots: number;
  playerSnapshots: number;
  careerEvents: number;
  players: number;
  latestSnapshotNumber: number | null;
}

export interface DiagnosticsData {
  activeCareer: typeof careers.$inferSelect | undefined;
  careerRows: (typeof careers.$inferSelect)[];
  snapshotCountByCareer: Map<string, number>;
  counts: DiagnosticsCounts;
}

export async function collectDiagnostics(): Promise<DiagnosticsData> {
  const activeCareer = await db
    .select()
    .from(careers)
    .orderBy(desc(careers.updatedAt))
    .limit(1)
    .get();

  const snapshotCounts = await db
    .select({ careerId: careerSnapshots.careerId, value: sql<number>`count(*)` })
    .from(careerSnapshots)
    .groupBy(careerSnapshots.careerId);

  const careerRows = await db.select().from(careers).orderBy(desc(careers.updatedAt));

  const latestSnapshot = activeCareer
    ? await db
        .select({ snapshotNumber: careerSnapshots.snapshotNumber })
        .from(careerSnapshots)
        .where(eq(careerSnapshots.careerId, activeCareer.id))
        .orderBy(desc(careerSnapshots.snapshotNumber))
        .limit(1)
        .get()
    : undefined;

  return {
    activeCareer,
    careerRows,
    snapshotCountByCareer: new Map(snapshotCounts.map((row) => [row.careerId, row.value])),
    counts: {
      careers: careerRows.length,
      snapshots: await countRows(careerSnapshots),
      playerSnapshots: await countRows(playerSnapshots),
      careerEvents: await countRows(careerEvents),
      players: await countRows(players),
      latestSnapshotNumber: latestSnapshot?.snapshotNumber ?? null,
    },
  };
}
