"use client";

import { useEffect, useState } from "react";
import { labelFor, REALISM_HINTS, type RealismLevel } from "@/lib/settings-vocabulary";
import { normalisePlaystyle, PLAYSTYLE_DEFINITIONS, type Playstyle } from "@/lib/playstyles";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The two modes TouchlineOS is judging this career by, shown on the dashboard.
 *
 * Both of these change what the app tells you - realism sets how much licence a move gets, playstyle
 * sets what kind of player you are looking for - and neither was visible anywhere except the Settings
 * screen. A verdict you cannot see the setting behind is a verdict you have to take on trust, so the
 * chips sit where the verdicts are.
 *
 * Deliberately NOT in the navigation bar: they are context, not destinations. Nothing happens when you
 * click one, so it is a label rather than a button.
 *
 * The colours are the same muted slate the rest of the dashboard meta uses. An amber "warning" chip
 * and an emerald "good" chip would imply these are statuses that can be right or wrong. They are not
 * statuses, they are your own choices, and colouring a choice as good or bad is a lie.
 *
 * Fetched here rather than threaded down from the page because the dashboard is the only consumer, and
 * a null render until it lands keeps it from claiming a mode it has not read yet.
 */

const CHIP =
  "rounded-lg border border-slate-300/70 bg-slate-500/10 px-2.5 py-1 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700/70 dark:text-slate-300";

export function ModeChips() {
  const [modes, setModes] = useState<{ realism: RealismLevel; playstyle: Playstyle } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { settings?: { realismLevel?: string; playstyle?: string } }) => {
        if (cancelled) return;
        const settings = body.settings;
        if (!settings) return;
        setModes({
          realism: (settings.realismLevel ?? "NORMAL") as RealismLevel,
          playstyle: normalisePlaystyle(settings.playstyle),
        });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing until the settings have actually been read. Rendering a default would briefly claim a mode
  // the career may not be in.
  if (modes === null) return null;

  const playstyle = PLAYSTYLE_DEFINITIONS[modes.playstyle];
  const realismHint = REALISM_HINTS[modes.realism] ?? REALISM_HINTS.NORMAL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={CHIP} title={realismHint}>
        {labelFor(modes.realism)}
      </span>
      <span className={CHIP} title={`${playstyle.blurb} ${playstyle.needs}`}>
        {playstyle.label}
      </span>
    </div>
  );
}
