"use client";

import React from "react";

import { useNewsPaper } from "./use-news";
import { CategoryChip, deskDate } from "./news-parts";

/**
 * The window on the dashboard: today's paper, folded.
 *
 * It sits directly above Recent Activity and holds the shape of a front page in miniature - a masthead with
 * the unread count beside it, the lead story's chip and headline, then a strip of what else is in, then one
 * affordance that opens the paper properly. It is a WINDOW rather than a link, because a manager should be
 * able to read the top of the news without leaving the dashboard.
 *
 * The whole card is one button. Nothing inside it is separately clickable, which is what makes that honest:
 * there is no second target to hit and no nested control to fight with a keyboard. Saving and dismissing
 * live on the full paper, where there is room to explain them.
 */
export function NewsWindow({
  careerId,
  clubName,
  onOpen,
}: {
  careerId: string;
  clubName: string;
  onOpen: () => void;
}) {
  const { paper, error, loading } = useNewsPaper(careerId);
  const [lead, ...rest] = paper?.items ?? [];
  const secondary = rest.slice(0, 2);
  const unseen = paper?.unseen ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the news desk"
      className="group block w-full rounded-2xl border border-slate-200 bg-white/90 p-5 text-left shadow-xl backdrop-blur-xl transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-brand)] hover:-translate-y-px hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E11D48] dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-slate-700"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className="font-heading text-xs uppercase tracking-[0.2em] text-slate-900 dark:text-slate-100">
            Club News
          </span>
          {unseen > 0 ? (
            <span
              title={`${unseen} ${unseen === 1 ? "story" : "stories"} you have not read.`}
              className="font-sub text-xs font-bold tabular-nums text-[#E11D48] dark:text-[#FF8C7A]"
            >
              ({unseen})
            </span>
          ) : null}
        </span>
        <span className="font-sub text-micro uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {paper ? `${paper.items.length} in the paper` : "The desk"}
        </span>
      </div>

      <div className="mt-3 h-px bg-slate-200 dark:bg-slate-800" />

      {loading ? (
        <div className="mt-4 space-y-2.5" aria-hidden="true">
          <div className="h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
        </div>
      ) : error && !lead ? (
        <p className="mt-4 font-sans text-xs text-slate-500 dark:text-slate-400">{error}</p>
      ) : !lead ? (
        <p className="mt-4 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Nothing to report yet. Log a debrief after a match and the desk will have something to write
          about.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <CategoryChip category={lead.category} tone={lead.tone} size="sm" />
              {deskDate(lead.publishedOn) ? (
                <span className="font-sub text-micro uppercase tracking-wider tabular-nums text-slate-400 dark:text-slate-500">
                  {deskDate(lead.publishedOn)}
                </span>
              ) : null}
              {!lead.read ? (
                <span className="font-sub text-micro font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
                  New
                </span>
              ) : null}
            </div>
            <h3 className="font-heading text-base leading-snug text-slate-900 transition-colors group-hover:text-[#E11D48] dark:text-slate-50 dark:group-hover:text-[#FF8C7A]">
              {lead.headline}
            </h3>
            <p className="font-sans text-xs leading-relaxed text-slate-500 line-clamp-2 dark:text-slate-400">
              {lead.body}
            </p>
            {lead.quote ? (
              <p className="border-l-2 border-slate-300 pl-2.5 font-sans text-xs italic leading-relaxed text-slate-600 line-clamp-2 dark:border-slate-600 dark:text-slate-300">
                &ldquo;{lead.quote}&rdquo;
              </p>
            ) : null}
          </div>

          {secondary.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              {secondary.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
                  />
                  <span className="font-sans text-xs leading-snug text-slate-600 line-clamp-1 dark:text-slate-300">
                    {item.headline}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <span className="mt-4 flex items-center justify-end border-t border-slate-200 pt-3 dark:border-slate-800">
        {/* A bordered pill rather than bare text, because it is the thing that opens the paper and it has to
            look like something to press. The whole card is the target, so the pill lights up on hovering
            anywhere: two nested targets would be a worse answer than one honest one. */}
        <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 font-sub text-label font-semibold uppercase tracking-[0.12em] text-slate-700 transition-[border-color,background-color,color,box-shadow] duration-200 ease-[var(--ease-brand)] group-hover:border-[#E11D48]/40 group-hover:bg-[#E11D48]/8 group-hover:text-[#E11D48] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:group-hover:border-[#FF8C7A]/40 dark:group-hover:text-[#FF8C7A]">
          Read the paper
          <span
            aria-hidden="true"
            className="font-sub text-sm transition-transform duration-200 ease-[var(--ease-brand)] group-hover:translate-x-0.5"
          >
            →
          </span>
        </span>
      </span>

      <span className="sr-only">{clubName} club news desk</span>
    </button>
  );
}
