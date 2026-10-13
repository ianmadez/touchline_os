/**
 * The in-game day the season in progress is taken to have begun.
 *
 * Why this exists at all: the app has TWO notions of "a season", and they answer different questions.
 *
 *   - `season-archive-service` keys a season on a real-time observation window, derived from
 *     `career_objectives`. That is the right question for "what did we watch happen", because every row
 *     it reads (snapshots, logged events) carries a real timestamp.
 *   - A match rating and a logged debrief both carry the IN-GAME date the match was played. Scoping
 *     those by a real-time window would be comparing two different clocks, so a match played in-game
 *     last August but logged yesterday would land in the wrong season.
 *
 * So anything reading in-game dates is scoped by an in-game boundary instead. British football runs
 * August to May, so 1 July is the day nothing is ever played on: the most recent 1 July on or before
 * the save's own clock.
 *
 * No save date means no scope, and callers must say so rather than silently showing a whole career as
 * though it were one season.
 */
export function seasonStartFor(inGameDate: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec((inGameDate ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return `${month >= 7 ? year : year - 1}-07-01`;
}

/** True when an in-game `YYYY-MM-DD` date falls inside the season that `seasonStart` opens. */
export function inSeason(date: string | null, seasonStart: string | null): boolean {
  if (seasonStart === null) return true;
  return date !== null && date >= seasonStart;
}
