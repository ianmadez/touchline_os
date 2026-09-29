/**
 * The save's own league catalogue, read back out.
 *
 * `leagues.leaguename` maps EA's `leagueid` to a real competition name ("England Championship (2)").
 * The parser decodes it on every parse and the sync mirrors it into the `leagues` table per career;
 * this is the single place that hands those names out again. A season row, the club-by-club division
 * roster, and any future rival / standings / scouting screen all resolve a league id the same way
 * instead of each re-deriving a map from a parse.
 *
 * Nothing here reformats a name or fills a gap. A league the save has no name for resolves to null so
 * the caller is forced to say so out loud (`League ID <n>`), rather than quietly showing a number
 * that looks like a name.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { leagues, type LeagueCatalogRow } from "../db/schema";

/** Every league a career's save knows about, keyed by the save's own `leagueid`. */
export type LeagueDirectory = Map<number, LeagueCatalogRow>;

export class LeagueService {
  async getDirectory(careerId: string): Promise<LeagueDirectory> {
    const rows = await db.select().from(leagues).where(eq(leagues.careerId, careerId));
    return new Map(rows.map((row) => [row.leagueId, row]));
  }
}

/**
 * The save's name for a league id, or null when it has none.
 *
 * Null covers both "the catalogue has no row for this id" (an edited save, or a league added by a
 * future edition) and "the row exists but the save's name was empty", which is a real case: one row
 * in the reference save carries an empty `leaguename`.
 */
export function leagueNameOf(directory: LeagueDirectory, leagueId: number | null): string | null {
  if (leagueId === null) return null;
  const name = directory.get(leagueId)?.name.trim();
  return name ? name : null;
}
