/**
 * The news archive.
 *
 * The paper the manager reads, as opposed to the edition the desk writes.
 *
 * A story is PUBLISHED once and then kept, and everything the manager asked for follows from that:
 *
 *   - the paper is CAPPED, so it cannot grow without limit, and once the cap is reached the oldest
 *     unsaved story is overwritten by the new one. An edition therefore does not live forever, which is
 *     what a newspaper is.
 *   - a story can be DISMISSED, which deletes it and frees its slot immediately, rather than waiting to
 *     be pushed out by the cap.
 *   - a story can be SAVED, which exempts it from both, and saved stories are reachable on their own tab.
 *   - the unread count is a count of STORED rows nobody has looked at, so the badge is a fact rather than
 *     a timestamp comparison.
 *
 * Publishing is idempotent: a story whose id is already in the archive is not written again, so a story
 * that keeps being true does not fill the paper with itself, and a running story that CHANGES ("4 in 5"
 * becoming "5 in 5") has a different id and therefore reads as the new story it is.
 */

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { newsItems, newsPublished } from "../db/schema";
import { NewsService, type NewsEdition } from "./news-service";
import {
  MAX_EDITION_STORIES,
  NEWS_COPY_VERSION,
  relevanceOf,
  salienceOf,
  type NewsItem,
  type StoryKind,
} from "../news/news-engine";

/**
 * How many unsaved stories one career keeps.
 *
 * Big enough that a manager who plays for a while has a real paper to scroll, small enough that the oldest
 * news does eventually go. Saved stories are outside the count entirely, which is the point of saving one.
 */
export const NEWS_ARCHIVE_LIMIT = 30;

/** One stored story, as the screen receives it. */
export interface ArchivedNewsItem extends NewsItem {
  playerIds: number[];
  saved: boolean;
  read: boolean;
  edition: number;
  /**
   * How much this story is about what has just happened, as of this read.
   *
   * Re-computed on every read rather than stored, because it depends on which match is the latest one NOW -
   * a story about the previous fixture stops being about the latest the moment the next one is logged. Shown
   * with the story so the order the paper is in can be checked against the stories themselves.
   */
  relevance: number;
}

/**
 * One stored row, scored the way the front page is ordered.
 *
 * `kind` comes back from the database as a string and is narrowed here and nowhere else: `relevanceOf`
 * switches on it, and a value it does not recognise falls to the floor of its table rather than throwing, so
 * a row written before a topic existed still prints.
 *
 * The ties are broken by edition and then by the desk's own order inside it, which keeps the order stable -
 * two stories of equal salience hold their places between reads instead of swapping.
 */
function rankStored<
  T extends { id: string; kind: string; weight: number; edition: number; sortIndex: number },
>(rows: T[], matchEventIds: readonly string[]): { row: T; relevance: number; salience: number }[] {
  return rows
    .map((row) => {
      const story = { id: row.id, kind: row.kind as StoryKind, weight: row.weight };
      return {
        row,
        relevance: relevanceOf(story, matchEventIds),
        salience: salienceOf(story, matchEventIds),
      };
    })
    .sort(
      (left, right) =>
        right.salience - left.salience ||
        right.row.edition - left.row.edition ||
        left.row.sortIndex - right.row.sortIndex ||
        left.row.id.localeCompare(right.row.id)
    );
}

export interface NewsPaper {
  careerId: string;
  clubName: string;
  managerName: string;
  leagueName: string | null;
  seasonNumber: number;
  inGameDate: string | null;
  matchesConsidered: number;
  /**
   * In the order the front page is printed: most relevant first, and within that the desk's own order.
   *
   * Not newest first. That was the earlier rule and it is what put a piece about a wage bill at the top of
   * the paper, because the top of the page was simply whatever the most recent read had happened to publish.
   */
  items: ArchivedNewsItem[];
  /** How many stored stories nobody has looked at. */
  unseen: number;
  /** How many unsaved stories are kept, so the screen can say what the cap is. */
  limit: number;
  /** How many editions are on file. */
  editions: number;
  /** True when this read published something the manager has not seen. */
  published: number;
}

export class NewsArchiveService {
  /**
   * Writes any new stories into the archive, then returns the paper.
   *
   * Publishing on read rather than on a schedule is deliberate: the desk is a pure function of evidence the
   * app already holds, so there is no work for a background job to do, and this way the paper is always as
   * fresh as the data behind it.
   */
  async read(careerId: string): Promise<NewsPaper | null> {
    const edition = await new NewsService().buildStories(careerId);
    if (!edition) return null;
    // Before publishing: anything on the paper written in an older voice is cleared so the desk rewrites it.
    await this.reprintOutdatedCopy(careerId);
    const published = await this.publish(edition);
    // Trimmed on EVERY read, not only when something was published: a career can cross the cap through
    // rows that arrived another way, and a trim that only runs on a new story would leave it over the limit
    // until the desk happened to have something to say.
    await this.enforceLimit(careerId, edition.matchEventIds);
    const items = await this.listItems(careerId, edition.matchEventIds);
    const unseen = items.filter((item) => !item.read).length;
    const editions = items.reduce((highest, item) => Math.max(highest, item.edition), 0);
    return {
      careerId: edition.careerId,
      clubName: edition.clubName,
      managerName: edition.managerName,
      leagueName: edition.leagueName,
      seasonNumber: edition.seasonNumber,
      inGameDate: edition.inGameDate,
      matchesConsidered: edition.matchesConsidered,
      items,
      unseen,
      limit: NEWS_ARCHIVE_LIMIT,
      editions,
      published,
    };
  }

  /**
   * Clears what the desk itself has rewritten, so it can be written again in the current voice.
   *
   * The rule the whole archive rests on is that a story is printed once and kept. This is the one exception
   * and it is narrow: a row is only cleared when the DESK changed, not when the facts did, and only when it
   * is still sitting on the paper. Three states are deliberately untouched:
   *
   *   - a SAVED story, because a bookmark is the manager's and rewording it under him would be worse than
   *     leaving one story in the old voice,
   *   - a DISMISSED story, which has a tombstone and no row at all, so it cannot come back,
   *   - and its tombstone is removed only alongside a row that exists, which is what keeps the two in step.
   *
   * The clear is ONE statement carrying the staleness predicate, rather than a select followed by deletes by
   * id. Two reads of the same career arrive together - the app fires a second one the moment the first lands
   * - and a select-then-delete let the second read delete a row the first had already rewritten in the new
   * voice, taking the tombstone with it. Scoping the delete to the version being retired means a row written
   * at the current version is not a candidate for it, whatever else is running.
   */
  private async reprintOutdatedCopy(careerId: string): Promise<number> {
    const cleared = await db
      .delete(newsItems)
      .where(
        and(
          eq(newsItems.careerId, careerId),
          eq(newsItems.saved, false),
          lt(newsItems.copyVersion, NEWS_COPY_VERSION)
        )
      )
      .returning({ id: newsItems.id });

    for (const row of cleared) {
      await db
        .delete(newsPublished)
        .where(and(eq(newsPublished.careerId, careerId), eq(newsPublished.id, row.id)));
    }

    return cleared.length;
  }

  /**
   * Stores the stories that are not already on file, then trims the archive.
   *
   * Returns how many were new, so the caller can say the paper has grown without re-reading it.
   */
  private async publish(edition: NewsEdition): Promise<number> {
    if (edition.items.length === 0) return 0;

    // A story is published ONCE, EVER. The archives hold what is on the paper; the tombstones hold every id
    // this career has ever printed, so a story that has been dismissed or overwritten cannot come back the
    // next time the desk still has the evidence for it.
    const archived = await db
      .select({ id: newsItems.id })
      .from(newsItems)
      .where(eq(newsItems.careerId, edition.careerId));
    const tombstoned = await db
      .select({ id: newsPublished.id })
      .from(newsPublished)
      .where(eq(newsPublished.careerId, edition.careerId));
    const known = new Set([...archived.map((row) => row.id), ...tombstoned.map((row) => row.id)]);
    /**
     * Deduplicated by id, then filtered against what is on file.
     *
     * `id` is the primary key, so two drafts sharing one could not both be stored and the second insert would
     * abort the whole edition rather than skip one story. The desk's ids are built to be unique, and this is
     * the guard that keeps a duplicate an editorial accident rather than a 500.
     */
    const fresh = [...new Map(edition.items.map((item) => [item.id, item])).values()].filter(
      (item) => !known.has(item.id)
    );
    if (fresh.length === 0) {
      return 0;
    }

    const latest = await db
      .select({ edition: newsItems.edition })
      .from(newsItems)
      .where(eq(newsItems.careerId, edition.careerId))
      .orderBy(desc(newsItems.edition))
      .limit(1);
    const nextEdition = (latest[0]?.edition ?? 0) + 1;

    // `sortIndex` records the order the desk put the paper in, so the interleaving it worked out (no two
    // neighbouring stories of the same kind) survives storage instead of being re-derived on read.
    const stored = await db
      .insert(newsItems)
      .values(
        fresh.map((item, index) => ({
        id: item.id,
        careerId: edition.careerId,
        category: item.category,
        tone: item.tone,
        headline: item.headline,
        body: item.body,
        kind: item.kind,
        stance: item.byline?.stance ?? item.stance ?? "STRAIGHT",
        articleJson: JSON.stringify(item.article),
        outlet: item.byline?.outlet ?? null,
        writer: item.byline?.writer ?? null,
        writerRole: item.byline?.writerRole ?? null,
        dateline: item.byline?.dateline ?? null,
        evidenceJson: JSON.stringify(item.evidence),
        playerNamesJson: JSON.stringify(item.playerNames),
        playerIdsJson: JSON.stringify(item.playerIds),
        quote: item.quote,
        publishedOn: item.publishedOn,
        weight: item.weight,
        sortIndex: index,
        copyVersion: NEWS_COPY_VERSION,
        saved: false,
        edition: nextEdition,
        createdAt: new Date().toISOString(),
      }))
    )
      // A second read of the same career can reach this line holding the same ids. The tombstone insert below
      // has always ignored conflicts; this one did not, which turned a harmless overlap into an error page.
      // `returning` therefore counts what was really stored rather than what was offered.
      .onConflictDoNothing()
      .returning({ id: newsItems.id });

    // Tombstoned in the same pass, so a crash between the two writes cannot leave a story printable twice:
    // the tombstone is the cheaper and safer of the two to have written first, and the id is the primary key
    // of both tables.
    await db
      .insert(newsPublished)
      .values(
        fresh.map((item) => ({
          id: item.id,
          careerId: edition.careerId,
          firstPublishedAt: new Date().toISOString(),
        }))
      )
      .onConflictDoNothing();

    await this.enforceLimit(edition.careerId, edition.matchEventIds);
    return stored.length;
  }
  /**
   * Overwrites the LEAST RELEVANT unsaved stories once the cap is reached.
   *
   * Not the oldest, which is what this used to drop. The cap exists because the paper cannot grow without
   * limit, and it has to choose what goes; choosing by age means the first thing thrown away is whatever has
   * been on the page longest, which is the right rule for an archive and the wrong one for a newspaper. What
   * a reader would drop is the story about nothing in particular, and relevance is the only thing here that
   * can tell the difference between that and the report of the match.
   *
   * Saved rows are excluded from the count AND from the deletion, in that order: a manager who saves
   * everything must not end up with a paper that is mostly bookmarks and no room for news, so the limit
   * counts only what can be overwritten.
   */
  private async enforceLimit(careerId: string, matchEventIds: readonly string[]): Promise<void> {
    const unsaved = await db
      .select({
        id: newsItems.id,
        kind: newsItems.kind,
        weight: newsItems.weight,
        edition: newsItems.edition,
        sortIndex: newsItems.sortIndex,
      })
      .from(newsItems)
      .where(and(eq(newsItems.careerId, careerId), eq(newsItems.saved, false)));

    const doomed = rankStored(unsaved, matchEventIds)
      .slice(NEWS_ARCHIVE_LIMIT)
      .map((entry) => entry.row.id);
    if (doomed.length === 0) return;
    for (const id of doomed) {
      await db.delete(newsItems).where(and(eq(newsItems.careerId, careerId), eq(newsItems.id, id)));
    }
  }

  /**
   * The stored paper, in the order a front page is printed.
   *
   * THE PAPER IS A FRONT PAGE, so it carries one page's worth of news rather than everything ever printed
   * for this career. Storage keeps more than this on purpose - a story that has been published is never
   * written again, and the tombstones are what stop the desk churning - but a reader opening a newspaper
   * does not get yesterday's front page stapled to today's.
   *
   * WHAT MAKES THE PAGE is RELEVANCE rather than recency, and that is the change that matters: the stories
   * shown are the ones most about what has just happened, not the ones written most recently. Ordering by
   * edition made the front page an artefact of when the manager last opened the paper, which is how the
   * report of the last match came to be stored but off the page, behind a squad note and two pieces about
   * money.
   *
   * SAVED stories are the exception and are always shown, however old. A bookmark is the manager's and hiding
   * one to keep the page short would be taking something away from him to save space.
   */
  private async listItems(
    careerId: string,
    matchEventIds: readonly string[]
  ): Promise<ArchivedNewsItem[]> {
    const rows = await db.select().from(newsItems).where(eq(newsItems.careerId, careerId));

    const shown: { row: (typeof rows)[number]; relevance: number; salience: number }[] = [];
    let unsaved = 0;
    for (const entry of rankStored(rows, matchEventIds)) {
      if (entry.row.saved) {
        shown.push(entry);
        continue;
      }
      if (unsaved >= MAX_EDITION_STORIES) continue;
      unsaved += 1;
      shown.push(entry);
    }

    return shown.map((entry) => {
      const row = entry.row;
      const article = parseJsonArray(row.articleJson).filter(
        (paragraph): paragraph is string => typeof paragraph === "string"
      );
      return {
        id: row.id,
        category: row.category,
        tone: row.tone as NewsItem["tone"],
        headline: row.headline,
        body: row.body,
        /**
         * Read back as stored, never re-derived.
         *
         * A row written before the column existed takes the column's own default, which is what the old id
         * rule would have decided anyway - so an old story reprints under the frame it was actually written
         * with rather than under whatever today's rules would choose.
         */
        kind: row.kind as NewsItem["kind"],
        stance: row.stance as NewsItem["stance"],
        // A story published before the article existed carries its summary as the whole piece. Better a short
        // read than an empty page, and the manager can still see everything the desk wrote at the time.
        article: article.length > 0 ? article : [row.body],
        byline:
          row.outlet !== null && row.writer !== null
            ? {
                outlet: row.outlet,
                writer: row.writer,
                writerRole: row.writerRole ?? "",
                dateline: row.dateline ?? "",
                // The column is NOT NULL, so a byline always knows the line it was filed in.
                stance: row.stance as NonNullable<NewsItem["stance"]>,
              }
            : null,
        evidence: parseJsonArray(row.evidenceJson).filter(
          (line): line is string => typeof line === "string"
        ),
        playerNames: parseJsonArray(row.playerNamesJson).filter(
          (name): name is string => typeof name === "string"
        ),
        playerIds: parseJsonArray(row.playerIdsJson).filter(
          (id): id is number => typeof id === "number"
        ),
        quote: row.quote,
        publishedOn: row.publishedOn,
        weight: row.weight,
        saved: row.saved,
        read: row.readAt !== null,
        edition: row.edition,
        relevance: entry.relevance,
      };
    });
  }

  /**
   * Bookmarks or un-bookmarks one story.
   *
   * A saved story is the manager's, so nothing else in this module will touch it: the cap skips it and a
   * dismiss refuses it.
   */
  async setSaved(careerId: string, id: string, saved: boolean): Promise<boolean> {
    const updated = await db
      .update(newsItems)
      .set({ saved })
      .where(and(eq(newsItems.careerId, careerId), eq(newsItems.id, id)))
      .returning({ id: newsItems.id });
    return updated.length > 0;
  }

  /**
   * Deletes one story, freeing its slot.
   *
   * Refuses a saved story rather than quietly unsaving it: a bookmark is an instruction, and a delete
   * button that overrode one would be a trap.
   */
  async dismiss(careerId: string, id: string): Promise<"removed" | "saved" | "missing"> {
    const rows = await db
      .select({ saved: newsItems.saved })
      .from(newsItems)
      .where(and(eq(newsItems.careerId, careerId), eq(newsItems.id, id)));
    if (rows.length === 0) return "missing";
    if (rows[0].saved) return "saved";
    await db.delete(newsItems).where(and(eq(newsItems.careerId, careerId), eq(newsItems.id, id)));
    return "removed";
  }

  /** Marks the whole paper read, which is what opening it means. */
  async markRead(careerId: string): Promise<number> {
    const updated = await db
      .update(newsItems)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(newsItems.careerId, careerId), isNull(newsItems.readAt)))
      .returning({ id: newsItems.id });
    return updated.length;
  }

  /** How many stored stories nobody has looked at. Used by the badge without publishing anything. */
  async unseenCount(careerId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsItems)
      .where(and(eq(newsItems.careerId, careerId), isNull(newsItems.readAt)));
    return rows[0]?.count ?? 0;
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
