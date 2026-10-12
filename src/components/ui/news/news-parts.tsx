"use client";

import React, { useEffect } from "react";

import { portal } from "@/components/ui/portal";
import { PlayerFace } from "@/components/ui/squad/player-face";
import type { NewsItem, NewsTone } from "@/lib/news/news-engine";

/**
 * The shared furniture of the paper.
 *
 * Kept apart from the two screens because they are the same newspaper at two sizes, and a headline that
 * looks one way in the window and another on the full page reads as two products.
 *
 * THE FURNITURE IS THE APP'S, NOT A WEBSITE'S. The reference art for this feature was a console game's
 * news screens, and what came back from the first pass was that the solid colour blocks and the coloured
 * band down the side of every card belonged to that game rather than here. So a category is a tinted chip
 * in the same language as the rest of the app (soft fill, quiet hairline, coloured text), the tone shows in
 * the chip and in one word of the copy, and nothing else on the card is coloured at all.
 */

export interface ToneStyle {
  /** The tinted category chip. Matches the app's own label chips. */
  chip: string;
  /** Faint wash behind the lead story's picture area. */
  wash: string;
}

export const TONES: Record<NewsTone, ToneStyle> = {
  GOOD: {
    chip: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
    wash: "from-emerald-500/12 via-emerald-500/4",
  },
  NEUTRAL: {
    chip: "bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-300",
    wash: "from-slate-500/10 via-slate-500/3",
  },
  CONCERN: {
    chip: "bg-[#E11D48]/12 text-[#E11D48] border-[#E11D48]/30 dark:text-[#FF8C7A]",
    wash: "from-[#E11D48]/12 via-[#E11D48]/4",
  },
};

/** The category, as a chip in the app's own label language. */
export function CategoryChip({
  category,
  tone,
  size = "md",
}: {
  category: string;
  tone: NewsTone;
  size?: "sm" | "md";
}) {
  const sizing =
    size === "sm"
      ? "text-micro px-1.5 py-[3px] tracking-[0.14em]"
      : "text-label px-2 py-1 tracking-[0.16em]";
  return (
    <span
      className={`inline-block shrink-0 rounded-md border font-sub font-bold uppercase ${sizing} ${TONES[tone].chip}`}
    >
      {category}
    </span>
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A date as a newspaper prints it: "3 Oct 2026".
 *
 * Split by hand rather than through `new Date(iso)`, because that constructor reads a bare `YYYY-MM-DD`
 * as UTC and would print the previous day for anyone west of Greenwich. Anything that is not a plain
 * date passes through unchanged, so a season label or an ISO timestamp is never mangled.
 */
export function deskDate(value: string | null): string | null {
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  const month = MONTHS[Number(parts[2]) - 1] ?? parts[2];
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}

/**
 * The lead story's picture area.
 *
 * A face when the club's own records resolve the name. A story about the CLUB rather than about a player gets
 * the club's badge, which is the picture for club news: a badge is what a paper prints beside a piece about a
 * club's season, and the initials were only ever standing in for one. Where the manager has given the app no
 * badge at all, the monogram is still the honest answer - there is no picture of a league position, and a
 * stock photograph would be an invention.
 */
export function LeadPlate({
  item,
  clubName,
  badgeUrl,
  className = "",
}: {
  item: NewsItem & { playerIds?: number[] };
  clubName: string;
  badgeUrl?: string | null;
  className?: string;
}) {
  const leadId = item.playerIds?.[0] ?? null;
  const leadName = item.playerNames[0] ?? "";
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br to-transparent p-3 ring-1 ring-black/5 dark:ring-white/10 ${TONES[item.tone].wash} ${className}`}
    >
      {leadId !== null ? (
        <PlayerFace eaPlayerId={leadId} name={leadName} size={116} />
      ) : (
        <ClubCrest clubName={clubName} badgeUrl={badgeUrl} size={104} className="rounded-xl" />
      )}
    </div>
  );
}

/** Two letters from a club's name: "Wigan Athletic" gives "WA", "Arsenal" gives "AR". */
function monogram(name: string): string {
  const words = name.split(/[\s.]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * What the manager said afterwards.
 *
 * A pull quote rather than a coloured panel: it is the only place on a card where the manager's own voice
 * appears, and the type is enough to mark it. The left rule is the ordinary typographic one for a quote,
 * not a category band.
 */
export function QuoteBlock({ text, className = "" }: { text: string; className?: string }) {
  return (
    <blockquote
      className={`border-l-2 border-slate-300 pl-3 font-sans text-xs italic leading-relaxed text-slate-700 dark:border-slate-600 dark:text-slate-200 ${className}`}
    >
      &ldquo;{text}&rdquo;
    </blockquote>
  );
}

/**
 * Why a story ran, as a dialog rather than as furniture on the card.
 *
 * It was printed under every story to begin with, and it was the wrong place for it: a newspaper does not
 * explain itself between the paragraphs, and a line reading "Delta -1" under a headline pulls the reader out
 * of the piece. The information is still the point of this app - nothing presented as a fact may be
 * unverifiable - so it lives one press away, where a manager who wants to check the working can find it and a
 * manager who wants to read the paper is left alone.
 */
export function EvidenceDialog({
  item,
  onClose,
}: {
  item: { headline: string; category: string; tone: NewsTone; evidence: string[] };
  onClose: () => void;
}) {
  // Escape is part of being a dialog. The storyline evidence view learned this first and it is not worth
  // re-learning per panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return portal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-overlay-in sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-evidence-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl animate-panel-in dark:border-slate-800 dark:bg-slate-900/95"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-heading text-label uppercase tracking-[0.2em] text-slate-900 dark:text-slate-100">
              Why this ran
            </span>
            <p className="mt-1.5 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              The figures the desk wrote this story from. They are the app&apos;s own reasoning, not a
              reporter&apos;s knowledge.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-900 cursor-pointer dark:hover:text-slate-100"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <CategoryChip category={item.category} tone={item.tone} size="sm" />
        </div>
        <h2
          id="news-evidence-title"
          className="mt-2 font-heading text-sm leading-snug text-slate-900 dark:text-slate-50"
        >
          {item.headline}
        </h2>

        <ul className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
          {item.evidence.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-300"
            >
              <span
                aria-hidden="true"
                className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
              />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The faces a story is about, for the rows that are too small for a plate. */
export function FaceRow({
  item,
  size = 26,
}: {
  item: NewsItem & { playerIds?: number[] };
  size?: number;
}) {
  const ids = item.playerIds ?? [];
  if (ids.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1.5">
      {ids.slice(0, 3).map((id, index) => (
        <PlayerFace
          key={`${id}-${index}`}
          eaPlayerId={id}
          name={item.playerNames[index] ?? ""}
          size={size}
        />
      ))}
    </span>
  );
}

/**
 * The club's crest, when the manager has given the app one, and its monogram when he has not.
 *
 * The badge is USER data - uploaded or linked in onboarding - so a career without one is normal rather than
 * broken, and the initials are the honest stand-in. Sits inside the article's picture area, which is where a
 * paper puts a crest beside a face.
 */
export function ClubCrest({
  clubName,
  badgeUrl,
  size = 44,
  className = "",
}: {
  clubName: string;
  badgeUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const url = (badgeUrl ?? "").trim();
  if (url !== "") {
    // A manager-supplied badge is any URL or data URL, which the Next image loader cannot optimise and must
    // not proxy, so the plain element is the right one here. Same rule as the navbar's own badge.
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={`shrink-0 rounded-lg object-contain ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex shrink-0 select-none items-center justify-center rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 font-heading text-slate-600 ring-1 ring-black/10 dark:from-slate-700 dark:to-slate-800 dark:text-slate-300 dark:ring-white/10 ${className}`}
    >
      <span style={{ fontSize: Math.round(size * 0.34) }}>{monogram(clubName)}</span>
    </span>
  );
}

/**
 * The paper's dialogs are portalled by the shared helper, which owns both the reason and the scroll lock.
 */

/**
 * The story, opened.
 *
 * The card is the short read; this is the piece. Picture and crest on the left, the article on the right,
 * the byline under the headline and the dateline in the corner, which is the shape of a page rather than the
 * shape of a panel.
 *
 * Two things are deliberately NOT here. There is no share button and no comment box: this is a career mode,
 * not a website, and furniture that does nothing is worse than absent. And there is no second copy of the
 * app's reasoning - the "why this ran" figures stay one press away, where the manager can check the working
 * without the reporter apparently knowing them.
 */
export function ArticleDialog({
  item,
  clubName,
  badgeUrl,
  onClose,
  onEvidence,
  onToggleSaved,
  busy,
}: {
  item: NewsItem & { playerIds?: number[]; saved?: boolean };
  clubName: string;
  badgeUrl?: string | null;
  onClose: () => void;
  onEvidence: () => void;
  onToggleSaved: (() => void) | null;
  busy: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const leadId = item.playerIds?.[0] ?? null;
  const leadName = item.playerNames[0] ?? "";
  const date = deskDate(item.publishedOn);

  return portal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm animate-overlay-in sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-article-title"
      onClick={onClose}
    >
      <article
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl animate-panel-in dark:border-slate-800 dark:bg-slate-900/95"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-6 sm:p-6">
          {/* The picture area. A piece about a player carries his face and the club's badge beside it; a
              piece about the club carries the badge itself rather than a monogram standing in for it, and
              then there is no second badge to print beside it. */}
          <div className="flex shrink-0 items-start gap-3">
            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br to-transparent p-3 ring-1 ring-black/5 dark:ring-white/10 ${TONES[item.tone].wash}`}
            >
              {leadId !== null ? (
                <PlayerFace eaPlayerId={leadId} name={leadName} size={148} />
              ) : (
                <ClubCrest clubName={clubName} badgeUrl={badgeUrl} size={124} className="rounded-xl" />
              )}
            </div>
            {leadId !== null ? <ClubCrest clubName={clubName} badgeUrl={badgeUrl} size={48} /> : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <CategoryChip category={item.category} tone={item.tone} size="sm" />
                {date ? (
                  <span className="font-sub text-micro uppercase tracking-[0.14em] tabular-nums text-slate-400 dark:text-slate-500">
                    {date}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close the article"
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-900 cursor-pointer dark:hover:text-slate-100"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <h2
              id="news-article-title"
              className="mt-2.5 font-heading text-lg leading-snug text-slate-900 dark:text-slate-50 sm:text-xl"
            >
              {item.headline}
            </h2>

            {/* The byline block: who wrote it, for whom, and where it was filed from. */}
            {item.byline ? (
              <p className="mt-2 border-b border-slate-200 pb-3 font-sub text-micro uppercase tracking-[0.14em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {item.byline.writer}
                {item.byline.writerRole ? `, ${item.byline.writerRole}` : ""}
                {"  ·  "}
                {item.byline.outlet}
                {item.byline.dateline ? `  ·  ${item.byline.dateline}` : ""}
              </p>
            ) : (
              <p className="mt-2 border-b border-slate-200 pb-3 font-sub text-micro uppercase tracking-[0.14em] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                From the TouchlineOS desk
              </p>
            )}

            <div className="mt-3 space-y-3">
              {item.article.map((paragraph, index) => (
                <p
                  // Paragraphs are stable strings from the desk, but a repeated sentence inside one article
                  // is possible, so the index is part of the key.
                  key={`${index}-${paragraph.slice(0, 24)}`}
                  className={`font-sans leading-relaxed text-slate-700 dark:text-slate-200 ${
                    index === 0 ? "text-sm font-semibold text-slate-900 dark:text-slate-50" : "text-sm"
                  }`}
                >
                  {paragraph}
                </p>
              ))}
            </div>

            {item.quote ? <QuoteBlock text={item.quote} className="mt-4" /> : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <FaceRow item={item} size={26} />
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onEvidence}
                  aria-haspopup="dialog"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 font-sub text-micro font-bold uppercase tracking-wider text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  Why this ran
                </button>
                {onToggleSaved ? (
                  <button
                    type="button"
                    onClick={onToggleSaved}
                    disabled={busy}
                    aria-pressed={item.saved === true}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 font-sub text-micro font-bold uppercase tracking-wider text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  >
                    {item.saved ? "★ Saved" : "☆ Keep"}
                  </button>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}


