"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import { TOGGLE_BOX_CLASS } from "@/components/ui/sub-tabs";
import { ordinal } from "@/lib/ui/format";

/**
 * The honours cabinet.
 *
 * A cabinet, not a list of achievements: every competition the manager can win is ON the shelf, and the
 * ones he has not won are greyed out. He has to be able to see the empty space next to the ones he has,
 * or there is nothing to aim at. That is why nothing is hidden for having not been won.
 *
 * TWO VIEWS, and the default is the narrow one. "My division" shows what the club he is at right now can
 * actually lift: his own league, the cups his division enters, and Europe only if his division feeds it.
 * "Whole country" opens the shelf up to every trophy available in that country, which is what a manager
 * looking a few seasons ahead wants. A League Two club does not play in Europe, so showing it by default
 * would be noise; hiding it entirely would be a lie about what the country offers.
 *
 * A WIN IS A SEASON. Recording one is a toggle on a season, so "x2" falls out of two seasons being
 * recorded rather than being a number anyone has to keep correct. The league titles the save itself
 * reports arrive already counted and cannot be removed here - they are not the manager's data to delete.
 *
 * Artwork is optional. A missing `/trophies/<key>.png` falls back to a drawn cup shape, so the cabinet
 * is complete before a single image exists.
 */

interface CabinetTrophy {
  key: string;
  name: string;
  kind: "LEAGUE" | "DOMESTIC_CUP" | "CONTINENTAL";
  level: number | null;
  artwork: string;
  won: boolean;
  count: number;
  seasonsWon: number[];
  seasonsFromSave: number[];
  openToCurrentTier: boolean;
  isCurrentDivision: boolean;
}

interface Cabinet {
  careerId: string;
  countryId: number | null;
  countryName: string | null;
  currentLeagueId: number | null;
  currentLeagueName: string | null;
  currentLevel: number | null;
  leagues: CabinetTrophy[];
  cups: CabinetTrophy[];
  seasons: number[];
  totals: { won: number; possible: number; possibleRelevant: number; wonRelevant: number };
}

/**
 * How many cards stagger their entrance before the rest arrive together.
 *
 * The shelf is opened, not re-rendered per keystroke, so a short stagger reads as the cards arriving
 * rather than as a wait. It is capped, because past the eighth card a delay stops being a flourish and
 * starts being something the manager waits through.
 */
const STAGGER_LIMIT = 8;
const STAGGER_STEP_MS = 45;

/** A drawn cup, used when no artwork has been dropped in for this competition. */
function DrawnTrophy({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H5.5a2 2 0 0 0 0 4H7" />
      <path d="M17 5h1.5a2 2 0 0 1 0 4H17" />
      <path d="M12 13v4" />
      <path d="M8.5 20h7" />
      <path d="M10 17h4l1 3H9l1-3Z" />
    </svg>
  );
}

/**
 * The photo area, edge to edge.
 *
 * The drawing is rendered FIRST and the image fades in over it. The obvious order, an `<img>` with an
 * `onError` that swaps in the drawing, shows the browser's broken-image glyph for as long as the request
 * takes to fail, which with no artwork collected yet is every card on every load. This way the shelf
 * looks deliberate whether or not a single file exists, and a competition that gains artwork starts
 * showing it with no change here.
 *
 * It is deliberately the biggest thing on the card, full width and full bleed. A trophy is a physical
 * object and the appeal of a cabinet is looking at the thing itself, so the photo gets the room and the
 * metadata is arranged around it. The wash of light behind a won trophy is what carries the pride: the
 * silverware sits in a glow rather than being labelled as won. An unwon trophy gets the same composition
 * with the light off and the metal drained, which is the entire difference between the two states.
 */
function TrophyArtwork({ trophy }: { trophy: CabinetTrophy }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showDrawing = !loaded || failed;

  return (
    <div
      className={`relative flex h-28 items-center justify-center overflow-hidden px-3 sm:h-32 ${
        trophy.won
          ? "bg-[radial-gradient(120%_90%_at_50%_118%,rgba(225,29,72,0.22),rgba(225,29,72,0.06)_45%,transparent_72%)] dark:bg-[radial-gradient(120%_90%_at_50%_118%,rgba(225,29,72,0.32),rgba(225,29,72,0.08)_45%,transparent_72%)]"
          : "bg-slate-50 dark:bg-slate-950"
      }`}
    >
      {showDrawing && (
        <DrawnTrophy
          className={`h-20 w-20 shrink-0 sm:h-24 sm:w-24 ${trophy.won ? "" : "opacity-35"}`}
        />
      )}
      {!failed && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={trophy.artwork}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute max-h-20 w-auto object-contain transition-[opacity,filter] duration-300 ease-[var(--ease-brand)] sm:max-h-24 ${
            loaded ? "opacity-100" : "opacity-0"
          } ${
            // A trophy not yet won is DRAINED rather than hidden: the shape stays recognisable, so the
            // shelf still says which competition it is. `drop-shadow` rather than a ring, because the
            // artwork has transparent edges and a ring would draw a box around nothing.
            trophy.won ? "drop-shadow-[0_10px_18px_rgba(15,23,42,0.22)]" : "opacity-40 grayscale"
          }`}
        />
      )}
    </div>
  );
}

/**
 * One shelf item: the name and count band, the photo, then what the manager can do about it.
 *
 * A WON trophy is red and an unwon one is grey, because the app already means "this is the live thing"
 * with the brand red (the active tab). So a filled shelf reads as a run of red cards and the work still
 * to do reads as grey, at a glance, without a legend.
 *
 * The count is printed on every card, zero included. A shelf of zeros is a target; hiding them would
 * leave a manager who has won nothing looking at an empty screen.
 */
function TrophyCard({
  trophy,
  seasons,
  busy,
  index,
  onToggleSeason,
}: {
  trophy: CabinetTrophy;
  seasons: number[];
  busy: boolean;
  index: number;
  onToggleSeason: (trophy: CabinetTrophy, season: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const savedSeasons = useMemo(() => new Set(trophy.seasonsFromSave), [trophy.seasonsFromSave]);

  const reachability = trophy.isCurrentDivision
    ? "Your division"
    : trophy.openToCurrentTier
      ? "Open to your division"
      : "Out of reach from your division";

  return (
    <div
      className={`flex animate-fade-in-up flex-col overflow-hidden rounded-2xl border shadow-card transition-[border-color,box-shadow] duration-200 ease-[var(--ease-brand)] ${
        trophy.won
          ? "border-rose-200 dark:border-rose-900/60"
          : "border-slate-200 dark:border-slate-800"
      } bg-white dark:bg-slate-900`}
      // A staged entrance for an infrequent event. Capped, because past the eighth card a delay stops
      // being a flourish and starts being a wait.
      style={index < STAGGER_LIMIT ? { animationDelay: `${index * STAGGER_STEP_MS}ms` } : undefined}
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          trophy.won
            ? "bg-[#E11D48] text-white"
            : "bg-slate-100 text-slate-500 dark:bg-slate-950 dark:text-slate-400"
        }`}
      >
        <span className="font-sub text-label font-bold uppercase leading-tight tracking-wider">
          {trophy.name}
        </span>
        <span
          className={`shrink-0 font-heading text-xl leading-none tabular-nums ${
            trophy.count > 0 ? "" : "opacity-60"
          }`}
          title={
            trophy.count > 0
              ? `Won in ${trophy.seasonsWon.map((season) => `season ${season}`).join(", ")}`
              : "Not won yet"
          }
        >
          {trophy.count}
        </span>
      </div>

      <TrophyArtwork trophy={trophy} />

      <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
        <div className="flex flex-1 flex-wrap content-start items-center gap-1.5">
          {trophy.won ? (
            trophy.seasonsWon.map((season) => (
              <span
                key={season}
                title={
                  savedSeasons.has(season)
                    ? `Your save records this in season ${season}`
                    : `You recorded this win in season ${season}`
                }
                className={`rounded px-1.5 py-0.5 font-sub text-micro font-bold uppercase tabular-nums ${
                  savedSeasons.has(season)
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-slate-500/15 text-slate-700 dark:text-slate-300"
                }`}
              >
                S{season}
                {savedSeasons.has(season) ? " · save" : ""}
              </span>
            ))
          ) : (
            <span className="font-sans text-dense leading-snug text-slate-500 dark:text-slate-400">
              {reachability}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={`inline-flex min-h-10 w-full items-center justify-center rounded-lg px-2 font-sub text-label font-bold uppercase tracking-wider transition-[background-color,color,transform] duration-200 ease-[var(--ease-brand)] active:scale-[0.96] cursor-pointer ${
            trophy.won
              ? "bg-[#E11D48]/10 text-[#E11D48] hover:bg-[#E11D48]/20 dark:text-[#FF8C7A]"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          }`}
        >
          {open ? "Done" : trophy.won ? "Change" : "Record a win"}
        </button>

        {open && (
          <div>
            <p className="mb-1.5 font-sans text-dense leading-snug text-slate-500 dark:text-slate-400">
              Tick every season it was won. Two seasons is an x2.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {seasons.map((season) => {
                const recorded = trophy.seasonsWon.includes(season);
                const fromSave = savedSeasons.has(season);
                return (
                  <button
                    key={season}
                    type="button"
                    disabled={busy || fromSave}
                    onClick={() => onToggleSeason(trophy, season)}
                    aria-pressed={recorded}
                    title={
                      fromSave
                        ? `Your save already records this in season ${season}, so it cannot be removed here`
                        : `Season ${season}`
                    }
                    className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg px-2 font-sub text-label font-bold uppercase tabular-nums transition-[background-color,color,transform] duration-200 ease-[var(--ease-brand)] ${
                      recorded
                        ? "bg-[#E11D48] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    } ${
                      busy || fromSave ? "cursor-default opacity-70" : "cursor-pointer active:scale-[0.96]"
                    }`}
                  >
                    S{season}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TrophyCabinet({ careerId }: { careerId: string }) {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wholeCountry, setWholeCountry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/trophies?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          success?: boolean;
          cabinet?: Cabinet;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.success || !body.cabinet) {
          setError(body.error ?? `Could not read your honours (${response.status}).`);
          return;
        }
        setCabinet(body.cabinet);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [careerId]);

  /**
   * Records or clears one season, and takes the server's answer as the new truth.
   *
   * The write returns the rebuilt cabinet rather than a success flag, so the screen never has to predict
   * what a change did to the totals. On failure the previous cabinet stays on screen, because a stale
   * cabinet is a better answer than a blank one.
   */
  const toggleSeason = useCallback(
    async (trophy: CabinetTrophy, season: number) => {
      setBusy(true);
      try {
        const recorded = trophy.seasonsWon.includes(season);
        const response = recorded
          ? await apiFetch(
              `/api/trophies?careerId=${encodeURIComponent(careerId)}&key=${encodeURIComponent(trophy.key)}&season=${season}`,
              { method: "DELETE" }
            )
          : await apiFetch("/api/trophies", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                careerId,
                key: trophy.key,
                name: trophy.name,
                kind: trophy.kind,
                countryId: cabinet?.countryId ?? null,
                level: trophy.level,
                season,
              }),
            });
        const body = (await response.json()) as { success?: boolean; cabinet?: Cabinet; error?: string };
        if (!response.ok || !body.success || !body.cabinet) {
          setError(body.error ?? `That change was not saved (${response.status}).`);
          return;
        }
        setCabinet(body.cabinet);
        setError(null);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    // `cabinet` is declared whole rather than as `cabinet?.countryId`: the React Compiler infers the
    // object from that read and refuses to preserve a memo whose declared dependency is a narrower
    // property of what it inferred. Declaring the object is also the honest dependency, since that is
    // what the callback reads.
    [cabinet, careerId]
  );

  if (error && !cabinet) {
    return <p className="font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>;
  }

  if (!cabinet) {
    return (
      <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Reading your honours…</p>
    );
  }

  const relevant = wholeCountry ? null : true;
  const leagues = relevant
    ? cabinet.leagues.filter((t) => t.isCurrentDivision || t.openToCurrentTier)
    : cabinet.leagues;
  const cups = relevant ? cabinet.cups.filter((t) => t.openToCurrentTier) : cabinet.cups;
  // A country with no catalogue entry has cups and no leagues to show, and saying so is more useful
  // than an empty shelf.
  const hasAnything = leagues.length > 0 || cups.length > 0;
  const countryLabel = cabinet.countryName ?? "this country";

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-card backdrop-blur-xl sm:p-6 dark:border-slate-800/80 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Honours
          </h2>
          <p className="mt-1 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {cabinet.currentLeagueName
              ? `You are in the ${cabinet.currentLeagueName}${
                  cabinet.currentLevel !== null ? `, tier ${cabinet.currentLevel} of ${countryLabel}` : ""
                }.`
              : "Sync a save with a division in it to see which trophies are in reach."}
          </p>
        </div>

        <div className={`flex items-center gap-1.5 rounded-xl ${TOGGLE_BOX_CLASS} p-1.5`}>
          {[
            { id: false, label: "My division" },
            { id: true, label: "Whole country" },
          ].map((option) => (
            <button
              key={String(option.id)}
              type="button"
              onClick={() => setWholeCountry(option.id)}
              aria-pressed={wholeCountry === option.id}
              className={`cursor-pointer rounded-lg px-3 py-1.5 font-sub text-label font-bold uppercase tracking-wider transition-colors ${
                wholeCountry === option.id
                  ? "bg-[#E11D48] text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
        {wholeCountry
          ? `${cabinet.totals.won} of ${cabinet.totals.possible} won in ${countryLabel}`
          : `${cabinet.totals.wonRelevant} of ${cabinet.totals.possibleRelevant} in reach from your division`}
      </p>

      {error && (
        <p className="mt-3 font-sans text-xs text-rose-600 dark:text-rose-400" role="status">
          {error}
        </p>
      )}

      {!hasAnything && (
        <p className="mt-4 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          This save&apos;s league catalogue names no competitions for {countryLabel}, so there is nothing
          to put on the shelf yet. Everything else in the app is unaffected.
        </p>
      )}

      {leagues.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2.5 font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {wholeCountry ? `Every division in ${countryLabel}` : "Your division"}
          </h3>
          <div data-tour="trophy-leagues" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {leagues.map((trophy, index) => (
              <TrophyCard
                key={trophy.key}
                trophy={trophy}
                seasons={cabinet.seasons}
                busy={busy}
                index={index}
                onToggleSeason={toggleSeason}
              />
            ))}
          </div>
        </section>
      )}

      {cups.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2.5 font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Cups
          </h3>
          <div data-tour="trophy-cups" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {cups.map((trophy, index) => (
              <TrophyCard
                key={trophy.key}
                trophy={trophy}
                seasons={cabinet.seasons}
                busy={busy}
                index={index + leagues.length}
                onToggleSeason={toggleSeason}
              />
            ))}
          </div>
        </section>
      )}

      <p className="mt-5 border-t border-slate-200 pt-3 font-sans text-dense leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        League titles come from your save: a completed season it records as finishing {ordinal(1)} is
        counted here without you doing anything. A cup is yours to report, because the save names no cup
        and records no cup result. Nothing is removed for being unwon, so the shelf shows what is still
        possible.
      </p>
    </div>
  );
}
