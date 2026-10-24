/**
 * Which career the app opens when nothing names one.
 *
 * ## Why "newest" alone is the wrong question
 *
 * The app stores no pointer to an active career: `careers` rows are ordered by `updated_at` and the
 * newest one wins, in the Node build, in the page and in the replicator alike. That rule is right for
 * the ordinary case, where a database holds the manager's own career and nothing else, and wrong the
 * moment a second row exists that was never meant to be opened. A fixture parsed by a test, or a
 * career left behind by an interrupted seed, is written LAST and therefore wins. The manager then sees
 * an empty squad, or a club that is not theirs, with no career picker in the app to explain it.
 *
 * So the rule is: newest career *that can actually be managed*, falling back to the newest overall.
 *
 * ## Why a squad size, and why eleven
 *
 * A career is identified by its id, which comes from the club and carries no sign of whether the row
 * is complete. Its squad does. A manager career that cannot field a team is not a career anyone can
 * open: every screen behind it is empty, and the ones that are not (finance, tactics) describe a
 * division of two clubs that does not exist. Eleven is the smallest number of players that makes a
 * squad a squad, which is a fact about football rather than about any particular fixture.
 *
 * ## Why the fallback stays
 *
 * A database that holds only a partial record must still report a career. "No career found" would
 * send the manager back to the wizard, and re-syncing over the top of the only row they have is worse
 * than showing them the incomplete one they can recognise. So the preference is a preference, never a
 * filter: nothing here deletes or hides a career, it only decides which one is opened.
 */

/** The smallest squad that can take the field. */
export const RESUMABLE_SQUAD_SIZE = 11;

export function isResumableSquadSize(squadSize: number): boolean {
  return Number.isFinite(squadSize) && squadSize >= RESUMABLE_SQUAD_SIZE;
}

/**
 * The career to open, from rows already sorted newest first.
 *
 * The caller supplies the squad count rather than this module reaching for a database, because the
 * two callers read it in different ways: the Node build through Drizzle, the page through raw SQL on
 * the same in-memory database.
 */
export function pickActiveCareer<Row>(
  rows: readonly Row[],
  squadSizeOf: (row: Row) => number
): Row | null {
  if (rows.length === 0) return null;
  return rows.find((row) => isResumableSquadSize(squadSizeOf(row))) ?? rows[0];
}
