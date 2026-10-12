"use client";

import React, { useEffect, useMemo, useState } from "react";

import { SubTabs } from "@/components/ui/sub-tabs";
import type { ArchivedNewsItem } from "@/lib/services/news-archive";
import { useNewsPaper } from "./use-news";
import {
  ArticleDialog,
  CategoryChip,
  EvidenceDialog,
  FaceRow,
  LeadPlate,
  QuoteBlock,
  deskDate,
} from "./news-parts";

/**
 * The paper.
 *
 * An inner surface rather than a tab: it is reached only from the window on the dashboard and it carries no
 * navbar entry, because a news desk is not a section of an app, it is somewhere you go and come back from.
 *
 * TWO PAGES, and the second one is the manager's own. The front page is the archive: everything the desk
 * has published, newest edition first, oldest first to be overwritten when the paper reaches its cap.
 * "Saved" is the shelf of stories he has kept, and nothing there is ever overwritten or dismissed.
 *
 * A story is published once and never rewritten, so what is on screen is what was printed. Opening the
 * paper marks it read, which is what the unread count means and what clears it.
 */
export function NewsView({
  careerId,
  clubName,
  badgeUrl,
  onBack,
}: {
  careerId: string;
  clubName: string;
  /** The manager's own club badge, when he has given the app one. Shown beside a story's picture. */
  badgeUrl?: string | null;
  onBack: () => void;
}) {
  const { paper, error, loading, notice, dismissNotice, setSaved, dismiss, markRead } =
    useNewsPaper(careerId);
  const [page, setPage] = useState<"FRONT" | "SAVED">("FRONT");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The story whose working is being shown. Null when the paper is just a paper. */
  const [evidenceFor, setEvidenceFor] = useState<ArchivedNewsItem | null>(null);
  /** The story that has been opened to be read properly. */
  const [articleFor, setArticleFor] = useState<ArchivedNewsItem | null>(null);

  const items = useMemo(() => paper?.items ?? [], [paper]);
  const saved = useMemo(() => items.filter((item) => item.saved), [items]);
  const [lead] = items;

  // Opening the paper is what reading it means. Guarded on the count so an empty paper writes nothing, and
  // depended on the count rather than on the items so marking read cannot loop.
  const unseen = paper?.unseen ?? 0;
  useEffect(() => {
    if (unseen > 0) void markRead();
  }, [unseen, markRead]);

  const act = async (id: string, run: () => Promise<void>) => {
    setBusyId(id);
    try {
      await run();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Masthead */}
      <div className="rounded-2xl border border-slate-200 bg-white/90 px-5 py-4 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-baseline gap-2 font-heading text-xl uppercase tracking-[0.22em] text-slate-900 dark:text-slate-50 sm:text-2xl">
              Club News
              {unseen > 0 ? (
                <span className="font-sub text-base font-bold tabular-nums tracking-normal text-[#E11D48] dark:text-[#FF8C7A]">
                  ({unseen})
                </span>
              ) : null}
            </h1>
            <p className="mt-1 font-sub text-label uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {[clubName, paper?.leagueName, paper ? `Season ${paper.seasonNumber}` : null]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="group flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 font-sub text-label font-semibold uppercase tracking-[0.12em] text-slate-600 transition-[border-color,color,background-color] duration-200 ease-[var(--ease-brand)] hover:border-slate-300 hover:text-[#E11D48] cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-[#FF8C7A]"
          >
            <span
              aria-hidden="true"
              className="transition-transform duration-200 ease-[var(--ease-brand)] group-hover:-translate-x-0.5"
            >
              ←
            </span>
            Dashboard
          </button>
        </div>

        {/* The double rule of a masthead, drawn with two borders rather than an image. */}
        <div className="mt-4 border-t-2 border-slate-900/80 dark:border-slate-100/80" />
        <div className="mt-[3px] border-t border-slate-900/30 dark:border-slate-100/30" />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-sub text-micro uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          {paper?.inGameDate ? <span className="tabular-nums">{deskDate(paper.inGameDate)}</span> : null}
          <span>
            {items.length} {items.length === 1 ? "story" : "stories"} in the paper
          </span>
          {paper ? (
            <span>
              written from {paper.matchesConsidered}{" "}
              {paper.matchesConsidered === 1 ? "logged debrief" : "logged debriefs"}
            </span>
          ) : null}
          <span>
            keeping the latest {paper?.limit ?? 30}, {saved.length} saved
          </span>
        </div>
      </div>

      <SubTabs
        tabs={[
          { id: "FRONT", label: "Front page" },
          { id: "SAVED", label: `Saved (${saved.length})` },
        ]}
        active={page}
        onChange={(id) => setPage(id as "FRONT" | "SAVED")}
      />

      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <p className="font-sans text-xs text-amber-900 dark:text-amber-100">{notice}</p>
          <button
            type="button"
            onClick={dismissNotice}
            aria-label="Dismiss message"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-amber-800 transition-colors hover:text-amber-950 cursor-pointer dark:text-amber-200"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4" aria-hidden="true">
          <div className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60" />
            <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60" />
          </div>
        </div>
      ) : error && items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 dark:border-slate-800 dark:bg-slate-900/90">
          <p className="font-sans text-sm text-slate-600 dark:text-slate-300">{error}</p>
        </div>
      ) : page === "SAVED" ? (
        <section className="space-y-4">
          <PageHeading
            title="Saved"
            note="Stories you have kept. Nothing here is ever overwritten or dismissed, however long the career runs."
          />
          {saved.length === 0 ? (
            <EmptyNote text="Nothing saved yet. Use Keep on any story and it moves in here for good." />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {saved.map((item) => (
                <StoryCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onToggleSaved={() => void act(item.id, () => setSaved(item.id, false))}
                  onDismiss={null}
                  onEvidence={() => setEvidenceFor(item)}
                  onOpen={() => setArticleFor(item)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : items.length === 0 ? (
        <EmptyNote text="The desk writes from evidence, so it stays quiet until there is some. A match debrief puts scorers, goal minutes and the shooting figures on the record and the reports follow from them." />
      ) : (
        <div className="space-y-6">
          {/* The lead */}
          <article className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90 sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:gap-6">
              <LeadPlate
                item={lead}
                clubName={clubName}
                badgeUrl={badgeUrl}
                className="h-36 w-full sm:h-40 sm:w-40 md:h-40 md:w-40"
              />
              <div className="min-w-0 flex-1">
                <StoryMeta item={lead} />
                <h2 className="mt-3 font-heading text-lg leading-snug text-slate-900 dark:text-slate-50 sm:text-xl md:text-2xl">
                  {lead.headline}
                </h2>
                <p className="mt-2.5 max-w-prose font-sans text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {lead.body}
                </p>
                {lead.quote ? <QuoteBlock text={lead.quote} className="mt-3 max-w-prose" /> : null}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <FaceRow item={lead} size={28} />
                  <StoryActions
                    item={lead}
                    busy={busyId === lead.id}
                    onToggleSaved={() => void act(lead.id, () => setSaved(lead.id, !lead.saved))}
                    onDismiss={() => void act(lead.id, () => dismiss(lead.id))}
                    onEvidence={() => setEvidenceFor(lead)}
                  />
                </div>
                <ReadOnButton onClick={() => setArticleFor(lead)} />
              </div>
            </div>
          </article>

          {/* Everything else, grouped by what the story is about */}
          <DeskSections
            items={items.slice(1)}
            busyId={busyId}
            onToggleSaved={(id, next) => void act(id, () => setSaved(id, next))}
            onDismiss={(id) => void act(id, () => dismiss(id))}
            onEvidence={(item) => setEvidenceFor(item)}
            onOpen={(item) => setArticleFor(item)}
          />
        </div>
      )}

      {evidenceFor && (
        <EvidenceDialog item={evidenceFor} onClose={() => setEvidenceFor(null)} />
      )}

      {articleFor && (
        <ArticleDialog
          item={articleFor}
          clubName={clubName}
          badgeUrl={badgeUrl}
          busy={busyId === articleFor.id}
          onClose={() => setArticleFor(null)}
          onEvidence={() => setEvidenceFor(articleFor)}
          onToggleSaved={() => {
            const next = !articleFor.saved;
            // Optimistic on the same path the card uses, so the button answers immediately either way.
            setArticleFor({ ...articleFor, saved: next });
            void act(articleFor.id, () => setSaved(articleFor.id, next));
          }}
        />
      )}
    </div>
  );
}

/**
 * The subjects a club paper is divided into.
 *
 * A story's topic decides its section, and the order here is only a fallback: the sections are printed in
 * the order of their best story, so a day when the money is the story puts the money first.
 */
const SECTIONS: { id: string; title: string; note: string; kinds: ArchivedNewsItem["kind"][] }[] = [
  {
    id: "PITCH",
    title: "On the pitch",
    note: "the result and the run behind it",
    kinds: ["MATCH", "FORM", "TABLE"],
  },
  {
    id: "SQUAD",
    title: "The squad",
    note: "players, injuries and deals",
    kinds: ["TEAMNEWS", "PLAYER", "SQUAD", "CONTRACT", "TRANSFER"],
  },
  { id: "MONEY", title: "The money", note: "budgets and wages", kinds: ["FINANCE"] },
  { id: "OPINION", title: "Opinion", note: "the desk's own view", kinds: ["OPINION"] },
  { id: "RECORD", title: "The record", note: "trophies and milestones", kinds: ["TROPHY", "MILESTONE"] },
];

/**
 * Where a story goes when its topic is not one the paper has a page for.
 *
 * Reachable only by a row written before a topic existed, and a story the reader can still read belongs on
 * the page even if the desk has since decided it is filed under something else.
 */
const OTHER_SECTION = {
  id: "OTHER",
  title: "Also on the desk",
  note: "the rest of what the desk has filed",
  kinds: [] as ArchivedNewsItem["kind"][],
};

/**
 * The stories after the lead, in the sections a paper is divided into.
 *
 * NOT grouped by the edition that published them, which is what this used to do. An edition is a fact about
 * how the paper is STORED rather than about what is in it, so it produced a second half headed "Earlier" -
 * a word that tells a reader nothing, and one that made the shape of the page an artefact of when the manager
 * last happened to open it.
 *
 * The sections are the subjects a club paper actually has, and they run in the order of their best story, so
 * relevance still decides what a reader meets first. Within a section the paper's own order is kept, which is
 * why this only partitions the list and never sorts it.
 */
function DeskSections({
  items,
  busyId,
  onToggleSaved,
  onDismiss,
  onEvidence,
  onOpen,
}: {
  items: ArchivedNewsItem[];
  busyId: string | null;
  onToggleSaved: (id: string, next: boolean) => void;
  onDismiss: (id: string) => void;
  onEvidence: (item: ArchivedNewsItem) => void;
  onOpen: (item: ArchivedNewsItem) => void;
}) {
  const sections = useMemo(() => {
    const buckets = new Map<string, ArchivedNewsItem[]>();
    for (const item of items) {
      const section = SECTIONS.find((candidate) => candidate.kinds.includes(item.kind)) ?? OTHER_SECTION;
      const bucket = buckets.get(section.id);
      if (bucket) bucket.push(item);
      else buckets.set(section.id, [item]);
    }
    return [...SECTIONS, OTHER_SECTION]
      .map((section) => ({ section, group: buckets.get(section.id) ?? [] }))
      .filter((entry) => entry.group.length > 0)
      .sort((left, right) => items.indexOf(left.group[0]) - items.indexOf(right.group[0]));
  }, [items]);

  if (items.length === 0) return null;

  return (
    <>
      {sections.map(({ section, group }) => (
        <section key={section.id} className="space-y-4">
          <PageHeading title={section.title} note={section.note} />
          <ul className="grid gap-4 md:grid-cols-2">
            {group.map((item) => (
              <StoryCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onToggleSaved={() => onToggleSaved(item.id, !item.saved)}
                onDismiss={() => onDismiss(item.id)}
                onEvidence={() => onEvidence(item)}
                onOpen={() => onOpen(item)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function PageHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-heading text-label uppercase tracking-[0.2em] text-slate-900 dark:text-slate-100">
        {title}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      <span className="font-sub text-micro uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {note}
      </span>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 dark:border-slate-800 dark:bg-slate-900/90">
      <h2 className="font-heading text-sm uppercase tracking-[0.16em] text-slate-900 dark:text-slate-100">
        Nothing to report
      </h2>
      <p className="mt-2 max-w-prose font-sans text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {text}
      </p>
    </div>
  );
}

/** The chip, the dateline and the unread marker: everything above a headline. */
function StoryMeta({ item, size = "md" }: { item: ArchivedNewsItem; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <CategoryChip category={item.category} tone={item.tone} size={size} />
      {deskDate(item.publishedOn) ? (
        <span className="font-sub text-micro uppercase tracking-[0.14em] tabular-nums text-slate-400 dark:text-slate-500">
          {deskDate(item.publishedOn)}
        </span>
      ) : null}
      {!item.read ? (
        <span className="font-sub text-micro font-bold uppercase tracking-[0.14em] text-[#E11D48] dark:text-[#FF8C7A]">
          New
        </span>
      ) : null}
    </div>
  );
}

function StoryCard({
  item,
  busy,
  onToggleSaved,
  onDismiss,
  onEvidence,
  onOpen,
}: {
  item: ArchivedNewsItem;
  busy: boolean;
  onToggleSaved: () => void;
  onDismiss: (() => void) | null;
  onEvidence: () => void;
  onOpen: () => void;
}) {
  return (
    // `group` so the read-on pill answers a hover anywhere on the card: one target, lit up, rather than a
    // second invisible one inside it.
    <li className="group flex flex-col rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-xl transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-brand)] hover:-translate-y-px hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700">
      <StoryMeta item={item} size="sm" />
      {/*
        The headline is the target, which is what a reader tries first. A button rather than a click handler on
        the card, because the card also holds three real controls and nesting them inside another clickable
        region is how a keyboard ends up in the wrong place.
      */}
      <h3 className="mt-2.5 font-heading text-sm leading-snug text-slate-900 dark:text-slate-50">
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="cursor-pointer text-left transition-colors hover:text-[#E11D48] dark:hover:text-[#FF8C7A]"
        >
          {item.headline}
        </button>
      </h3>
      <p className="mt-1.5 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {item.body}
      </p>
      {item.quote ? <QuoteBlock text={item.quote} className="mt-2.5" /> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <FaceRow item={item} />
        <StoryActions
          item={item}
          busy={busy}
          onToggleSaved={onToggleSaved}
          onDismiss={onDismiss}
          onEvidence={onEvidence}
        />
      </div>
      <ReadOnButton onClick={onOpen} />
    </li>
  );
}

/**
 * "Read on" - the affordance that says the card opens.
 *
 * A bordered pill rather than bare text, in the same language as the dashboard window's "Read the paper":
 * a reader should be able to tell what is pressable without hovering to find out. It lights up when the
 * pointer is anywhere on the card, so there is one target rather than two competing ones.
 */
function ReadOnButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-3 flex justify-end border-t border-slate-200 pt-3 dark:border-slate-800">
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 font-sub text-label font-semibold uppercase tracking-[0.12em] text-slate-700 transition-[border-color,background-color,color] duration-200 ease-[var(--ease-brand)] group-hover:border-[#E11D48]/40 group-hover:bg-[#E11D48]/8 group-hover:text-[#E11D48] cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:group-hover:border-[#FF8C7A]/40 dark:group-hover:text-[#FF8C7A]"
      >
        Read on
        <span
          aria-hidden="true"
          className="font-sub text-sm transition-transform duration-200 ease-[var(--ease-brand)] group-hover:translate-x-0.5"
        >
          →
        </span>
      </button>
    </div>
  );
}

/**
 * Keep, and Unsave or Dismiss.
 *
 * Two icon buttons on every story. "Keep" is the important one and the label changes with the state, so a
 * saved story says so on its own face rather than only in the Saved tab. Dismiss is absent on the Saved tab
 * because the server refuses it there, and offering a button that always fails would be worse than not
 * offering it.
 */
function StoryActions({
  item,
  busy,
  onToggleSaved,
  onDismiss,
  onEvidence,
}: {
  item: ArchivedNewsItem;
  busy: boolean;
  onToggleSaved: () => void;
  onDismiss: (() => void) | null;
  onEvidence: () => void;
}) {
  const button =
    "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-[border-color,color,background-color] duration-200 ease-[var(--ease-brand)] hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100";
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onEvidence}
        aria-haspopup="dialog"
        title="Why this ran"
        aria-label="Why this ran"
        className={button}
      >
        <span aria-hidden="true" className="font-heading text-xs">
          i
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleSaved}
        disabled={busy}
        aria-pressed={item.saved}
        title={item.saved ? "Remove from saved" : "Keep this story for good"}
        className={`${button} gap-1.5 px-2.5 font-sub text-micro font-bold uppercase tracking-wider ${
          item.saved ? "text-[#E11D48] dark:text-[#FF8C7A]" : ""
        }`}
      >
        <span aria-hidden="true">{item.saved ? "★" : "☆"}</span>
        {item.saved ? "Saved" : "Keep"}
      </button>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          title="Dismiss this story"
          aria-label="Dismiss this story"
          className={button}
        >
          <span aria-hidden="true">✕</span>
        </button>
      ) : null}
    </span>
  );
}
