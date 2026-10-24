/**
 * Read-only diagnostics: what is actually stored, counted per table.
 *
 * Split out of the route so the route no longer reaches the database client directly, and so the
 * browser build can produce the same numbers from its own storage.
 */
import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { pickActiveCareer } from "../career-selection";
import {
  careers,
  careerSnapshots,
  careerEvents,
  players,
  playerSnapshots,
  worldPlayers,
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
  /**
   * Players the save never named, kept out of every list, search and roster.
   *
   * Reported HERE and nowhere else, which is the point: it is a fact about the save's missing data
   * rather than something a manager can act on mid-search, and a placeholder in a results table would
   * look like a player with a strange name instead.
   */
  unresolvedPlayers: number;
  unresolvedWorldPool: number;
}

export interface DiagnosticsData {
  activeCareer: typeof careers.$inferSelect | undefined;
  careerRows: (typeof careers.$inferSelect)[];
  snapshotCountByCareer: Map<string, number>;
  counts: DiagnosticsCounts;
}

export async function collectDiagnostics(): Promise<DiagnosticsData> {
  // The same rule the app opens a career by, so this panel never labels one career "active" while the
  // screens behind it are showing another. Counted with a join for the reason documented in
  // `CareerService.getLatestCareerRow`: an unqualified column inside a raw `sql` subquery counts zero.
  const careerCandidates = await db
    .select({
      career: careers,
      squadSize: sql<number>`count(${players.id})`,
    })
    .from(careers)
    .leftJoin(players, eq(players.careerId, careers.id))
    .groupBy(careers.id, careers.updatedAt)
    .orderBy(desc(careers.updatedAt));

  const activeCareer = pickActiveCareer(careerCandidates, (row) => Number(row.squadSize))?.career;

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

  // Unnamed players, counted rather than shown: the squad and the academy for the active career, and
  // the world pool it can be scouted from. A player the manager has named himself counts as named.
  const unnamedSquad = activeCareer
    ? await db
        .select({ value: sql<number>`count(*)` })
        .from(players)
        .where(and(eq(players.careerId, activeCareer.id), eq(players.nameSource, "unresolved")))
        .get()
    : undefined;
  const unnamedPool = activeCareer
    ? await db
        .select({ value: sql<number>`count(*)` })
        .from(worldPlayers)
        .where(and(eq(worldPlayers.careerId, activeCareer.id), eq(worldPlayers.nameResolved, false)))
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
      unresolvedPlayers: unnamedSquad?.value ?? 0,
      unresolvedWorldPool: unnamedPool?.value ?? 0,
    },
  };
}
