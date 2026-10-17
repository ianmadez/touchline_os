"use client";

import React from "react";

import {
  FORMATION_NOT_RECORDED,
  FORMATION_USE_DEFAULT,
  defaultFormationChoice,
  formationDisplayName,
  formationShapeName,
  type FormationChoice,
  type FormationStamp,
} from "@/lib/events/tactics-stamp";
import { formationSourceLabel } from "@/lib/ui/labels";

/**
 * The shape a match was played in, as a picker.
 *
 * WHY IT IS ASKED AT ALL. The Tactics tab changes, and it holds only today's answer. A match reported in March
 * and replayed in the review in May needs the shape that actually played, so the form asks once and the answer
 * is stamped on the record.
 *
 * THE DEFAULT IS NOT "4-3-3". It is whatever the Tactics tab marks current at the moment of the report, resolved
 * when the form is submitted. A career whose manager never opened Tactics has nothing to resolve, and the picker
 * says so rather than offering a shape nobody chose.
 */
export function FormationSelect({
  value,
  formations,
  onChange,
  label = "Formation",
  className = "",
}: {
  value: string;
  formations: FormationChoice[];
  onChange: (next: string) => void;
  label?: string;
  className?: string;
}) {
  const current = defaultFormationChoice(formations);
  // A stamp written before the formation was renamed or deleted still has to read back, so the stored label is
  // offered as itself rather than silently resetting to the default on the next save.
  const orphan =
    value !== FORMATION_USE_DEFAULT &&
    value !== FORMATION_NOT_RECORDED &&
    !formations.some((choice) => choice.label === value)
      ? value
      : null;

  /**
   * The manager picks by his own names, so the label leads and the shape follows. That is the opposite order to
   * the detail card, which leads with the shape because a reader there is comparing matches rather than editing.
   */
  const optionText = (choice: FormationChoice): string => {
    const shape = formationShapeName(choice.formationName);
    return shape === null ? choice.label : `${choice.label} · ${shape}`;
  };
  const defaultShape = current === null ? null : formationShapeName(current.formationName);

  return (
    <label className={className}>
      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      >
        <option value={FORMATION_USE_DEFAULT}>
          {defaultShape === null ? "Same as Tactics" : `Same as Tactics · ${defaultShape}`}
        </option>
        {formations
          .filter((choice) => choice.label !== current?.label)
          .map((choice) => (
            <option key={choice.label} value={choice.label}>
              {optionText(choice)}
            </option>
          ))}
        {orphan !== null && <option value={orphan}>{`${orphan} (no longer in Tactics)`}</option>}
        <option value={FORMATION_NOT_RECORDED}>Not recorded</option>
      </select>
    </label>
  );
}

/**
 * A stamp as the line a reader sees, including the case where there is none.
 *
 * "Not recorded" rather than a blank: an empty cell in the review would read as a rendering fault, and a match
 * logged before this existed is a real answer, not a missing one.
 */
export function formationRecordText(stamp: FormationStamp | null): string {
  if (stamp === null) return "not recorded";
  const source = formationSourceLabel(stamp.source);
  const name = formationDisplayName(stamp);
  return source === null ? name : `${name}, ${source}`;
}
