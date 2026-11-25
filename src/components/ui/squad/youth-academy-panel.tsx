"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import { Hint } from "@/components/ui/hint";
import { NationFlag } from "./nation-flag";
import { SubTabs } from "@/components/ui/sub-tabs";
import { GraduateWall, MentorBoard } from "./youth-extras";
/**
 * The academy: the save's own unpromoted prospects.
 *
 * This replaces a panel that showed the first-team squad filtered to 21 and under. That was a proxy,
 * not an academy - it could never show a 15-year-old, because a 15-year-old is not in the squad, and it
 * showed senior players who merely happened to be young. The rows here come from `career_youthplayers`,
 * the save's own academy table.
 *
 * Two things shape how it reads.
 *
 * The first is that some prospects are assessed more than once and the assessments DISAGREE, with
 * nothing in the save to say which is current. Those fields are shown as the observed range and carry
 * the dashed "not settled" treatment the transfer-value bands already use. A prospect with a single
 * reading gets a plain value and no range styling, because inventing uncertainty where the save gave
 * one reading is its own kind of lie.
 *
 * The second is `swingLowPotential`, which is a DELTA and can be negative. A negative swing low is the
 * game saying the player may never reach his headline potential, so it is shown next to the potential
 * rather than buried - a prospect whose range straddles zero is a genuine gamble, and the panel should
 * say so instead of printing 95 and letting the manager assume.
 */

interface Prospect {
  playerId: number;
  /**
   * The name the manager typed, which outranks the save's own when the save has none.
   *
   * Set from the player dossier's Notebook, reached from the squad table's YOUTH filter. Null when he has not
   * named the player yet.
   */
  displayName?: string | null;
  name: string | null;
  nameSource: string;
  primaryPosition: string | null;
  age: number | null;
  /** The save's own nationality code, plus the country name our reference table gives it. */
  nationalityId: number | null;
  nationality: string | null;
  overallRating: number | null;
  potentialRating: number | null;
  tierLow: number | null;
  tierHigh: number | null;
  swingLowMin: number | null;
  swingLowMax: number | null;
  varianceMin: number | null;
  varianceMax: number | null;
  monthsInSquad: number | null;
  assessmentCount: number;
  goals: number | null;
  appearances: number | null;
  /** Set once promoted, by the save (seen in the first team) or by the manager's Promote button. */
  promotion?: { source: "SAVE" | "USER"; recordedAt: string } | null;
}

interface Graduate {
  playerId: number;
  name: string | null;
  promotion: { source: "SAVE" | "USER"; recordedAt: string };
  overallRating: number | null;
  potentialRating: number | null;
  primaryPosition: string | null;
  age: number | null;
}

interface Leaver {
  playerId: number;
  name: string | null;
  primaryPosition: string | null;
  overallRating: number | null;
  potentialRating: number | null;
  leftAt: string;
  released: boolean;
}

/**
 * Prospects who vanished from the academy without turning up in the squad. The save gives no reason,
 * so the manager says: released (the usual case) or promoted (the save just has not shown it yet).
 */
function Leavers({
  leavers,
  busyId,
  onRelease,
  onPromote,
}: {
  leavers: Leaver[];
  busyId: number | null;
  onRelease: (l: Leaver, released: boolean) => void;
  onPromote: (l: Leaver) => void;
}) {
  if (leavers.length === 0) return null;
  const button =
    "cursor-pointer rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider disabled:opacity-50";
  return (
    <section data-tour="youth-leavers" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">Left the academy</h2>
        <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Gone from the save&apos;s academy, not in your squad
        </span>
      </div>
      <ul tabIndex={0} className="grid max-h-[8.75rem] gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
        {leavers.map((l) => (
          <li key={l.playerId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="min-w-0">
              <p className="truncate font-heading text-sm text-slate-900 dark:text-slate-100">{l.name || "Unnamed prospect"}</p>
              <p className="font-sub text-label uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {l.primaryPosition ?? "—"} · last seen {l.overallRating ?? "—"} → {l.potentialRating ?? "—"}
                {l.released ? " · released" : ""}
              </p>
            </div>
            <div className="flex gap-1.5">
              {l.released ? (
                <button type="button" disabled={busyId === l.playerId} onClick={() => onRelease(l, false)} className={`${button} border-slate-300 text-slate-500`}>
                  Undo
                </button>
              ) : (
                <>
                  <button type="button" disabled={busyId === l.playerId} onClick={() => onRelease(l, true)} className={`${button} border-rose-400/60 text-rose-700 dark:text-rose-300`}>
                    Released
                  </button>
                  <button type="button" disabled={busyId === l.playerId} onClick={() => onPromote(l)} className={`${button} border-emerald-500/60 text-emerald-700 dark:text-emerald-300`}>
                    Promoted
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Academy graduates: everyone recorded as promoted, with today's squad figures when the save has them. */
function Graduates({ graduates, onUndo, busyId }: { graduates: Graduate[]; onUndo: (g: Graduate) => void; busyId: number | null }) {
  if (graduates.length === 0) return null;
  return (
    <section data-tour="youth-graduates" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">Graduates</h2>
        <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
          {graduates.length} promoted to the first team
        </span>
      </div>
      <ul tabIndex={0} className="grid max-h-[8.75rem] gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
        {graduates.map((g) => (
          <li key={g.playerId} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300/60 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="min-w-0">
              <p className="truncate font-heading text-sm text-slate-900 dark:text-slate-100">{g.name || "Unnamed graduate"}</p>
              <p className="font-sub text-label uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {g.primaryPosition ?? "—"} · {g.overallRating !== null ? `${g.overallRating} → ${g.potentialRating ?? "—"}` : "not in the squad yet"}
                {" · "}
                {g.promotion.source === "SAVE" ? "seen in first team" : "promoted by you"}
              </p>
            </div>
            {g.promotion.source === "USER" && (
              <button
                type="button"
                disabled={busyId === g.playerId}
                onClick={() => onUndo(g)}
                className="cursor-pointer rounded-lg px-2 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-rose-600 disabled:opacity-50"
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Summary {
  total: number;
  multiAssessed: number;
  unnamed: number;
  bestPotential: number | null;
}

/** A positive potential swing is an upside, so it is signed. A bare "10" reads as a rating. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * An observed value, or the range across disagreeing readings.
 *
 * A single reading renders as a plain value with no styling, because there is no uncertainty to
 * signal. Two or more that agree are also a single value - a range of "2 to 2" is noise.
 */
function Observed({
  low,
  high,
  format,
}: {
  low: number | null;
  high: number | null;
  format?: (value: number) => string;
}) {
  const render = format ?? String;
  if (low === null && high === null) {
    return <span className="font-sub text-xs text-slate-400">not recorded</span>;
  }
  if (low === null || high === null || low === high) {
    return (
      <span className="font-sub text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
        {render((low ?? high) as number)}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-dashed border-slate-400/60 bg-slate-500/5 px-1.5 py-0.5 font-sub text-xs font-bold tabular-nums text-slate-600 dark:border-slate-600 dark:text-slate-300">
      {render(low)} to {render(high)}
    </span>
  );
}

function AcademyTab({ careerId, query, onOpenWall }: { careerId: string; query: string; onOpenWall: () => void }) {
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namingId, setNamingId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [graduates, setGraduates] = useState<Graduate[]>([]);
  const [leavers, setLeavers] = useState<Leaver[]>([]);
  const [promotingId, setPromotingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/youth?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        success?: boolean;
        prospects?: Prospect[];
        graduates?: Graduate[];
        leavers?: Leaver[];
        summary?: Summary;
        error?: string;
      };
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not read the academy (${response.status}).`);
        return;
      }
      setRows(body.prospects ?? []);
      setGraduates(body.graduates ?? []);
      setLeavers(body.leavers ?? []);
      setSummary(body.summary ?? null);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * Names a prospect the save cannot.
   *
   * The academy is the ONE list where such a player stays visible, which makes this the one place the
   * manager can do something about it: everywhere else he is absent rather than shown as a placeholder.
   * Written through the same profile route the dossier uses, so the name is stored the same way and
   * survives the sync that rewrites every academy row.
   */
  const saveName = async (playerId: number) => {
    const displayName = nameDraft.trim().slice(0, 60);
    if (displayName.length === 0) return;
    setSavingName(true);
    try {
      const response = await apiFetch("/api/career", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, playerProfile: { eaPlayerId: playerId, displayName } }),
      });
      const body = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not save that name (${response.status}).`);
        return;
      }
      setNamingId(null);
      setNameDraft("");
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSavingName(false);
    }
  };

  /**
   * Promote, or undo a Promote. Only needed when the save has not shown the move yet: a sync that finds
   * a former prospect in the first team records the promotion by itself.
   */
  const setPromotion = async (playerId: number, name: string | null, undo: boolean, action?: "release" | "unrelease") => {
    setPromotingId(playerId);
    try {
      const response = await apiFetch("/api/youth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, playerId, name, undo, action }),
      });
      const body = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not update that promotion (${response.status}).`);
        return;
      }
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPromotingId(null);
    }
  };
  const undo = (g: Graduate) => void setPromotion(g.playerId, g.name, true);
  const leaversBlock = (
    <Leavers
      leavers={leavers}
      busyId={promotingId}
      onRelease={(l, released) => void setPromotion(l.playerId, l.name, false, released ? "release" : "unrelease")}
      onPromote={(l) => void setPromotion(l.playerId, l.name, false)}
    />
  );

  if (error) {
    return (
      <p className="font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>
    );
  }

  if (rows === null) {
    return (
      <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Loading your academy…</p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          No academy rows in this save
        </h3>
        <p className="mt-1 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Either this club has no unpromoted prospects on file, or your save does not carry the
          academy table. Nothing is being hidden from you — this is an empty set, not a failed read.
        </p>
        <div className="mt-4">
          <Graduates graduates={graduates} onUndo={undo} busyId={promotingId} />
          {leaversBlock}
        </div>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  // Promoted players move to Graduates, so the academy list stays the players still in it.
  const academy = rows.filter((row) => !row.promotion);
  const visible = needle
    ? academy.filter((row) => (row.name ?? "").toLowerCase().includes(needle))
    : academy;

  return (
    <div className="space-y-4">
      {/* One quiet strip instead of two competing headings: the inner tab already names the page,
          so this carries only the figures, and graduates are a link to their own tab. */}
      <div data-tour="youth-summary" className="flex flex-wrap items-center gap-2">
        {summary && (
          <>
            <span className="rounded-full bg-slate-200/70 px-2.5 py-1 font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {academy.length} prospect{academy.length === 1 ? "" : "s"}
            </span>
            {summary.bestPotential !== null && (
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-sub text-label font-bold uppercase tracking-wider tabular-nums text-emerald-700 dark:text-emerald-300">
                Best potential {summary.bestPotential}
              </span>
            )}
            {summary.unnamed > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-sub text-label font-bold uppercase tracking-wider tabular-nums text-amber-700 dark:text-amber-300">
                {summary.unnamed} unnamed
              </span>
            )}
          </>
        )}
        {graduates.length > 0 && (
          <button
            type="button"
            onClick={onOpenWall}
            className="ml-auto cursor-pointer rounded-full border border-amber-400/60 px-2.5 py-1 font-sub text-label font-bold uppercase tracking-wider text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          >
            {graduates.length} graduate{graduates.length === 1 ? "" : "s"} · Graduate Wall →
          </button>
        )}
      </div>

      <ul data-tour="youth-list" className="space-y-2">
        {visible.map((row) => (
          <li
            key={row.playerId}
            className="rounded-xl border border-slate-200 bg-white/90 p-4 shadow-xs dark:border-slate-800/80 dark:bg-slate-900/90"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-sm text-slate-900 dark:text-slate-100">
                  {row.displayName || row.name || "Name not stored in the save"}
                </span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {row.primaryPosition || "—"}
                </span>
                {(row.nationality !== null || row.nationalityId !== null) && (
                  <span
                    className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-800 dark:bg-slate-900"
                    title={
                      row.nationality
                        ? `Nationality recorded by your save: ${row.nationality}`
                        : `Your save records nationality code ${row.nationalityId}, which this build's country list does not name.`
                    }
                  >
                    <NationFlag nationId={row.nationalityId} name={row.nationality} height={11} />
                    {/* No name to print for a code this build cannot name; the flag and the tooltip
                        carry what is actually known rather than a placeholder country. */}
                    {row.nationality && (
                      <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {row.nationality}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <span className="flex items-center gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
                  {row.age !== null ? `Age ${row.age}` : "Age unknown"}
                </span>
                <button
                  type="button"
                  disabled={promotingId === row.playerId}
                  onClick={() => void setPromotion(row.playerId, row.displayName || row.name, false)}
                  title="Mark him as promoted to the first team. Your next sync confirms it once the save shows him in the squad."
                  className="cursor-pointer rounded-lg border border-emerald-500/60 px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
                >
                  {promotingId === row.playerId ? "Promoting…" : "Promote"}
                </button>
              </span>
            </div>

            {/* The one place an unnamed player is still shown, and therefore the one place he can be
                named. Every other list leaves him out, so "go here to add his name" has to be true. */}
            {!row.displayName && !row.name && (
              <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                {namingId === row.playerId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`youth-name-${row.playerId}`}>
                      Name for this prospect
                    </label>
                    <input
                      id={`youth-name-${row.playerId}`}
                      type="text"
                      autoFocus
                      maxLength={60}
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder="Type his name"
                      className="min-w-40 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={savingName || nameDraft.trim().length === 0}
                      onClick={() => void saveName(row.playerId)}
                      className="cursor-pointer rounded-lg bg-[#E11D48] px-3 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingName ? "Saving" : "Save name"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNamingId(null);
                        setNameDraft("");
                      }}
                      className="cursor-pointer rounded-lg px-2 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-sans text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                      Your save does not name him. Give him one here, and it is kept for this career.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setNamingId(row.playerId);
                        setNameDraft("");
                      }}
                      className="cursor-pointer rounded-lg border border-amber-500/60 bg-white px-2.5 py-1.5 font-sub text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-slate-950/40 dark:text-amber-300"
                    >
                      Give him a name
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="flex items-center gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Ability
                </span>
                <span className="font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
                  {row.overallRating ?? "—"}
                </span>
                <span className="text-slate-400">→</span>
                <span className="font-heading text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                  {row.potentialRating ?? "—"}
                </span>
              </span>

              <span className="flex items-center gap-2">
                <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tier
                </span>
                <Observed low={row.tierLow} high={row.tierHigh} />
              </span>

              <span className="flex items-center gap-2">
                <span
                  className="flex items-center gap-1 font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  title="How far below his headline potential he may fall. A negative swing means the game is warning he might never reach it."
                >
                  Swing
                  <Hint label="the swing">
                    How far below his headline potential he may fall. A negative swing means the
                    game is warning he might never reach it.
                  </Hint>
                </span>
                <Observed low={row.swingLowMin} high={row.swingLowMax} format={signed} />
              </span>

              <span className="font-sub text-label text-slate-500 dark:text-slate-400">
                {row.monthsInSquad !== null
                  ? `${row.monthsInSquad} month${row.monthsInSquad === 1 ? "" : "s"} in the academy`
                  : "Tenure not recorded"}
              </span>
            </div>

            {row.assessmentCount > 1 && (
              <p className="mt-2 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Your save scouted him {row.assessmentCount} times and the reports disagree, so tier and
                swing above are shown as the range rather than one report picked out as correct.
              </p>
            )}
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
          No prospect in your academy matches that name.
        </p>
      )}

      {leaversBlock}
    </div>
  );
}

type YouthInnerTab = "ACADEMY" | "WALL" | "MENTORS";

const YOUTH_TABS = [
  { id: "ACADEMY", label: "Academy", tour: "youth-tab-academy" },
  { id: "WALL", label: "Graduate Wall", tour: "youth-tab-wall" },
  { id: "MENTORS", label: "Mentors", tour: "youth-tab-mentors" },
] as const;

/** Squad > Youth: the academy itself, the honours board of its graduates, and mentor pairings. */
export function YouthAcademyPanel({ careerId, query }: { careerId: string; query: string }) {
  const [tab, setTab] = useState<YouthInnerTab>("ACADEMY");
  return (
    <div className="space-y-4">
      <SubTabs tabs={YOUTH_TABS} active={tab} onChange={setTab} tour="youth-subtabs" />
      {tab === "ACADEMY" && <AcademyTab careerId={careerId} query={query} onOpenWall={() => setTab("WALL")} />}
      {tab === "WALL" && <GraduateWall careerId={careerId} query={query} />}
      {tab === "MENTORS" && <MentorBoard careerId={careerId} query={query} />}
    </div>
  );
}
