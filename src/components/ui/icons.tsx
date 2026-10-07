import React from "react";

/**
 * The app's icon set.
 *
 * Hand-drawn inline SVG rather than an icon dependency or emoji: emoji render differently on every
 * platform (and read as decoration rather than interface), while a font/stroke-matched set keeps
 * the weight consistent with the rest of the UI. Utility icons use a 24x24 viewBox and `currentColor`
 * strokes; brand marks keep their own silhouette and use `currentColor` fill.
 */
export interface IconProps {
  className?: string;
  /** Decorative by default. Pass a label only when the icon is the sole carrier of meaning. */
  label?: string;
}

/** The Discord Clyde mark, traced from the user-provided logo. */
export function IconDiscord({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 384 296"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M139 0 151 22c13-4 27-5 41-4 14-1 28 0 41 4l14-21c27 5 54 13 78 23 25 26 44 66 55 111 8 34 8 72 4 109l-96 52-25-49c-20 11-43 17-71 17s-51-6-71-17l-24 49L0 244c-4-37-4-75 4-109C15 90 34 50 59 24 84 13 112 5 139 0Zm-10 129a34 34 0 1 0 0 68 34 34 0 0 0 0-68Zm128 0a34 34 0 1 0 0 68 34 34 0 0 0 0-68Zm-165 111 8-5c15 8 30 14 46 18 14 4 29 6 46 6s32-2 46-6c16-4 31-10 46-18l8 5c-16 11-32 18-49 23-16 5-33 7-51 7s-35-2-51-7c-17-5-33-12-49-23Z"
      />
    </svg>
  );
}

function Svg({ className = "h-4 w-4", label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/** A finish flag — used for "your target for this block". */
export function IconFlag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 22V4" />
      <path d="M4 5h14l-2 4 2 4H4" />
    </Svg>
  );
}

/** A crosshair — used for a per-match points target. */
export function IconTarget(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  );
}

/** A spark — used for the dream outcome. */
export function IconSpark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </Svg>
  );
}

/** A warning triangle — used for the concern threshold. */
export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4l8.5 15h-17z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  );
}

/** A shield — used for the defensive/target summary band. */
export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
    </Svg>
  );
}

/** A lined note — used for free-text notes. */
export function IconNote(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4h14v16H5z" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </Svg>
  );
}

/** A wallet — used for wage/finance surfaces. */
export function IconWallet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H6a3 3 0 01-3-3z" />
      <path d="M3 7V6a2 2 0 012-2h11" />
      <path d="M17 13h.01" />
    </Svg>
  );
}

/** A rising trend — used for trajectory/growth surfaces. */
export function IconTrend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Svg>
  );
}

/** A magnifier — used for scouting/search. */
export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </Svg>
  );
}

/** A calendar — used for season scoping. */
export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

/** A trophy — used for silverware/achievement context. */
export function IconTrophy(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4h8v5a4 4 0 01-8 0z" />
      <path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3" />
      <path d="M12 13v3M9 20h6M10 20l.5-4h3l.5 4" />
    </Svg>
  );
}

/** A person — used for player/youth surfaces. */
export function IconPerson(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </Svg>
  );
}

/** A plus — new-entry affordance. */
export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** A bin — destructive affordance. */
export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </Svg>
  );
}

/** A tick — "this figure is real / verified". */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 13l4 4L19 7" />
    </Svg>
  );
}

/** A barred circle — "the save does not support this metric". */
export function IconUnavailable(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.5 17.5l11-11" />
    </Svg>
  );
}

/** A question mark — used for values the manager has not supplied. */
export function IconUnknown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 9a3 3 0 116 0c0 2-3 2.5-3 5" />
      <path d="M12 18h.01" />
    </Svg>
  );
}

/** A shield-with-check — "this is the manager's own entry". */
export function IconUserEntry(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

/** Download/copy affordance. */
export function IconExport(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 20h14" />
    </Svg>
  );
}

/** A table/grid — tabular surfaces. */
export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </Svg>
  );
}

/** A clock — history/timeline surfaces. */
export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </Svg>
  );
}

/** A sliders glyph — preferences/configuration surfaces. */
export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </Svg>
  );
}

/** A whistle — the group/summary debrief surface. */
export function IconWhistle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 8h7a2 2 0 012 2v1a5 5 0 01-5 5h-2.5A5.5 5.5 0 011 14.5 5.5 5.5 0 016.5 9H9" />
      <path d="M13 8V5h4M9 9v3" />
    </Svg>
  );
}
