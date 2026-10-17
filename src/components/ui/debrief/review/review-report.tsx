"use client";

import React from "react";

import type { Review, ReviewSection } from "@/lib/review/types";
import { IconAlert } from "@/components/ui/icons";
import { FindingCard } from "./review-card";

/**
 * The expanded report: the eight sections, in the order the review is read.
 *
 * WHAT THIS FILE IS FOR. The card answers "how did it go and what should I do". This answers "how do you know", and
 * it is the surface a manager opens when he disagrees with the card. That is why the confounds and the counts are
 * printed here in full rather than summarised: a review that cannot show its working is asking to be trusted.
 */

export function ReviewReportSection({ section }: { section: ReviewSection }) {
  return (
    <section className="space-y-2">
      <h4 className="font-heading text-[11px] uppercase tracking-wide text-slate-700 dark:text-slate-300">
        {section.title}
      </h4>
      {section.paragraphs.map((paragraph, index) => (
        <p
          key={`${section.id}-${index}`}
          className="font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
        >
          {paragraph}
        </p>
      ))}
      {section.counts.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-100/70 px-3 py-2 dark:bg-slate-950/50">
          {section.counts.map((count) => (
            <span
              key={count.label}
              className="font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400"
            >
              {count.label}:{" "}
              <span className="font-bold text-slate-700 tabular-nums dark:text-slate-200">
                {count.value}
              </span>
            </span>
          ))}
        </div>
      )}
      {section.findings.map((finding) => (
        <FindingCard key={finding.id} finding={finding} />
      ))}
      {section.id === "NOT_CLAIMING" && section.paragraphs.length > 1 && (
        <p className="flex items-start gap-1.5 font-sans text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
          <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Each line above is a different reading of the same run of matches.
        </p>
      )}
    </section>
  );
}

export function ReviewReport({ review }: { review: Review }) {
  return (
    <div data-tour="review-report" className="space-y-4">
      {review.sections.map((section) => (
        <ReviewReportSection key={section.id} section={section} />
      ))}
    </div>
  );
}
