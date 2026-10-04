"use client";

/**
 * The small "x" that dismisses one dashboard card.
 *
 * Deliberately a separate component rather than an inline button: the Recent Activity rows are
 * themselves buttons, and a button inside a button is invalid HTML that browsers resolve by
 * dropping one of them. Keeping the affordance here makes it obvious at the call site that this
 * must be a SIBLING of the row, not a child.
 *
 * The tooltip is the native `title` (plus an aria-label for screen readers), which is the
 * convention everywhere else in this app - there is no tooltip library, and a hover explanation was
 * explicitly asked for.
 */
interface DismissButtonProps {
  /** The tooltip / accessible name, e.g. "Dismiss this storyline". */
  label: string;
  onDismiss: () => void;
}

export function DismissButton({ label, onDismiss }: DismissButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // The row it sits beside is itself clickable, so the click must not fall through to it.
        event.stopPropagation();
        onDismiss();
      }}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
