"use client";

import { useEffect, useState } from "react";
import type { SeasonRecord } from "@/lib/services/season-service";
import type {
  SeasonDebriefDigest,
  SeasonDossier,
  SeasonObservedHalf,
} from "@/lib/services/season-archive-service";
import { leagueLabel } from "@/lib/ui/leagues";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The Season Vault: one season, in two halves that are never blended.
 *
 * The save's own summary exists for every season it recorded - including seasons that finished
 * before TouchlineOS was ever installed. Everything else (squad movement, snapshots, storylines,
 * finance, and the manager's own logged match detail) only exists for the span in which the app was
 * actually running. A season with no such span says so plainly instead of padding itself with zeros,
 * because "we have nothing for this period" and "nothing happened in this period" are different
 * statements and only one of them is true.
 *
 * The manager's debrief digest is the part no other tool can show: goals, assists, the players they
 * singled out, the weaknesses they named and their own reflections live only in what they typed. It
 * is labelled as theirs throughout - it is the manager's observation, never the save's measurement.
 */

interface SeasonVaultViewProps {
  careerId: string;
  seasons: SeasonRecord[];
  selectedSeason: number | null;
  onSelectSeason: (season: number) => void;
}

export function SeasonVaultView({
  careerId,
  seasons,
  selectedSeason,
  onSelectSeason,
}: SeasonVaultViewProps) {
  const browsable = [...seasons].reverse();
  const active = browsable.find((s) => s.season === selectedSeason) ?? browsable[0] ?? null;

  // Keyed by season rather than a bare dossier, so "still loading" and "loaded and empty" stay
  // distinguishable without ever calling setState synchronously from the effect body.
  const [loaded, setLoaded] = useState<{
    season: number;
    dossier: SeasonDossier | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!careerId || active === null) return;

    // Guarded so a slow response for a season the manager has already clicked past cannot land on
    // top of the newer one.
    const season = active.season;
    let cancelled = false;

    apiFetch(`/api/season/dossier?careerId=${encodeURIComponent(careerId)}&season=${season}`)
      .then(async (response) => {
        const body = (await response.json()) as {
          success?: boolean;
          dossier?: SeasonDossier;
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.success || !body.dossier) {
          setLoaded({
            season,
            dossier: null,
            error: body.message ?? body.error ?? "Could not load this season.",
          });
          return;
        }
        setLoaded({ season, dossier: body.dossier, error: null });
      })
      .catch((cause) => {
        if (!cancelled) setLoaded({ season, dossier: null, error: String(cause) });
      });

    return () => {
      cancelled = true;
    };
  }, [careerId, active]);

  const current = active !== null && loaded?.season === active.season ? loaded : null;
  const dossier = current?.dossier ?? null;
  const error = current?.error ?? null;
  const loading = active !== null && current === null;

  if (seasons.length === 0) {
    return (
      <EmptyCard
        title="Nothing archived yet"
        body="Once a season appears in the save, it is archived here permanently — nothing in this view is ever rewritten."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div data-tour="vault-seasons" className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-xs backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <span className="mr-2 text-xs font-sub font-bold uppercase text-slate-400">Season</span>
        {browsable.map((s) => {
          const isSelected = active?.season === s.season;
          return (
            <button
              key={s.season}
              type="button"
              onClick={() => onSelectSeason(s.season)}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-sub font-bold uppercase transition-all ${
                isSelected
                  ? "bg-[#E11D48] text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              S{s.season}
              {!s.complete && <span className="ml-1 font-normal opacity-70">• live</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-sub text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {loading && !dossier && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 text-xs font-sub text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/90 dark:text-slate-400">
          Reading season {active?.season}…
        </div>
      )}

      {dossier && (
        <div className="space-y-6">
          <DossierHeader dossier={dossier} />
          <CoverageBanner dossier={dossier} />
          <SaveHalf dossier={dossier} />
          {dossier.observed ? (
            <ObservedHalf dossier={dossier} observed={dossier.observed} />
          ) : (
            <NotObservedPanel />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DossierHeader({ dossier }: { dossier: SeasonDossier }) {
  const finish = dossier.fromSave.tablePosition;
  return (
    <div data-tour="vault-header" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <div>
        <div className="text-xs font-sub font-bold uppercase text-[#E11D48] dark:text-[#FF8C7A]">
          {dossier.current ? "Current season · still being written" : "Archived season · read-only"}
        </div>
        <h2 className="font-heading text-xl uppercase tracking-wide text-slate-900 dark:text-slate-100">
          Season {dossier.season}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          {leagueLabel(dossier.fromSave.leagueName, dossier.fromSave.leagueId)}
        </span>
        {finish ? (
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            Finished {finish}
            {ordinalSuffix(finish)}
          </span>
        ) : (
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
            In progress
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The one line that decides how to read the rest of the page.
 *
 * Coverage is not a badge, it is a caveat with dates: either we have a real observation window and
 * can show it, or we do not and the page must stop pretending it might.
 */
function CoverageBanner({ dossier }: { dossier: SeasonDossier }) {
  const { coverage } = dossier;

  if (!coverage.observed) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
        <div className="flex items-center gap-2 text-xs font-sub font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          <span aria-hidden>◑</span> General information only — we weren&apos;t running yet
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed font-sub text-amber-800/90 dark:text-amber-200/80">
          This season finished before TouchlineOS was installed on this save, so everything shown below
          comes from the save file itself. No match detail, squad movement, boardroom threads or notes
          exist for this period — we do not estimate them, and we will not display a zero as if it were
          a result.
        </p>
      </div>
    );
  }

  const firstSeen = coverage.saveRecordWhenFirstSeen;
  const joinedLate = (firstSeen?.played ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <div className="flex items-center gap-2 text-xs font-sub font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <span aria-hidden>◉</span> Observed season — {coverage.from ? `from ${dayOf(coverage.from)}` : "fully watched"}
        {coverage.to ? ` to ${dayOf(coverage.to)}` : " to today"}
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed font-sub text-emerald-800/90 dark:text-emerald-200/80">
        {joinedLate ? (
          <>
            TouchlineOS started following this save while this season was already under way — the save
            had <Strong>{firstSeen?.played} matches</Strong> played
            {firstSeen?.points !== null && firstSeen?.points !== undefined ? (
              <>
                {" "}
                and <Strong>{firstSeen.points} points</Strong> on the board
              </>
            ) : null}{" "}
            by the time we first looked. Anything before that date was never seen, so the detail below
            covers only our share of the season.
          </>
        ) : (
          <>
            We were watching from the start of this season, so the observed detail below covers it from
            its opening matchday.
          </>
        )}
      </p>
    </div>
  );
}

/** The save's own half. Available for every season, including ones we never saw. */
function SaveHalf({ dossier }: { dossier: SeasonDossier }) {
  const s = dossier.fromSave;
  const record =
    s.wins !== null && s.draws !== null && s.losses !== null
      ? `${s.wins}W ${s.draws}D ${s.losses}L`
      : "—";

  return (
    <section data-tour="vault-save-half" className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <SectionTitle
        kicker="From the save"
        title="The season as the save recorded it"
        note="These totals span every match played in every competition this season entered — they are the save's own numbers, not league-only form."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Matches" value={s.played?.toString() ?? "—"} />
        <Stat label="Record" value={record} />
        <Stat label="Points" value={s.points?.toString() ?? "—"} />
        <Stat label="Goals for" value={s.goalsFor?.toString() ?? "—"} />
        <Stat label="Goals against" value={s.goalsAgainst?.toString() ?? "—"} />
        <Stat
          label="Goal diff"
          value={s.goalDifference === null ? "—" : `${s.goalDifference > 0 ? "+" : ""}${s.goalDifference}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Final league position"
          value={s.tablePosition ? `${s.tablePosition}${ordinalSuffix(s.tablePosition)}` : "—"}
          note="The one league-only figure the save keeps."
        />
        <Stat label="League trophies" value={s.leagueTrophies?.toString() ?? "—"} />
        <Stat
          label="Season objectives"
          value={objectiveCodes(s).join(" · ") || "—"}
          note={
            s.boardObjectiveResult !== null && s.boardObjectiveResult > 0
              ? `Board verdict code ${s.boardObjectiveResult}`
              : dossier.complete
                ? "No board verdict recorded"
                : "Board verdict not decided yet"
          }
        />
        <Stat
          label="Transfer business"
          value={
            s.biggestSigning || s.biggestSale
              ? [s.biggestSigning ? `IN ${s.biggestSigning.name}` : null, s.biggestSale ? `OUT ${s.biggestSale.name}` : null]
                  .filter(Boolean)
                  .join(" · ")
              : "—"
          }
          note={
            [s.biggestSigning?.fee ? `bought ${money(s.biggestSigning.fee)}` : null, s.biggestSale?.fee ? `sold ${money(s.biggestSale.fee)}` : null]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
      </div>

      {s.boardObjectiveCode !== null && (
        <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
          Board and cup objectives are stored as unmapped EA codes. They are shown as codes rather than
          guessed into words, because the meaning of a code is not decodable from the save.
        </p>
      )}
    </section>
  );
}

/** What TouchlineOS watched. Only ever rendered when an observation window exists. */
function ObservedHalf({
  dossier,
  observed,
}: {
  dossier: SeasonDossier;
  observed: SeasonObservedHalf;
}) {
  const soFar = dossier.current ? " so far" : "";
  const our = observed.ourRecord;
  const played = dossier.fromSave.played ?? 0;
  const digest = observed.debriefs;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <SectionTitle
          kicker="What we watched"
          title={`Coverage${soFar}`}
          note="TouchlineOS records a snapshot per sync. This is how much of the season we actually saw, and it is the reason the blocks below can exist at all."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Syncs in window" value={observed.snapshots.count.toString()} />
          <Stat
            label="Snapshot range"
            value={
              observed.snapshots.firstNumber === null
                ? "—"
                : `#${observed.snapshots.firstNumber} → #${observed.snapshots.lastNumber}`
            }
          />
          <Stat
            label="Save date at first sync"
            value={observed.snapshots.firstInGameDate ?? "—"}
            note={
              observed.snapshots.lastInGameDate && observed.snapshots.lastInGameDate !== observed.snapshots.firstInGameDate
                ? `last seen ${observed.snapshots.lastInGameDate}`
                : undefined
            }
          />
          <Stat
            label="Spine events logged"
            value={observed.timeline.length > 40 ? `${observed.timeline.length}+` : observed.timeline.length.toString()}
            note={observed.snapshots.allIdentical ? "every sync reported identical content" : "content changed between syncs"}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <SectionTitle
          kicker="Your logged matches"
          title={`What you recorded${soFar}`}
          note="Added up from the match debriefs you logged in this window. This is your own record of those matches — it is not the save's season total, and it covers only the matches you wrote up."
        />
        {our.logged === 0 ? (
          <EmptyCard
            title="No debriefs logged in this period"
            body="Log a match debrief after a game and it lands here: the scoreline, your scorers and assisters, who stood out, and whatever you noticed. Nothing below is inferred from the save — it comes from you."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat
                label="Matches logged"
                value={played > 0 ? `${our.logged} of ${played}` : our.logged.toString()}
                note={played > 0 ? "share of the save's match count" : undefined}
              />
              <Stat label="Record" value={`${our.wins}W ${our.draws}D ${our.losses}L`} />
              <Stat label="Points" value={`${our.points}`} note="3 for a win, 1 for a draw" />
              <Stat label="Scored" value={our.goalsFor.toString()} />
              <Stat label="Conceded" value={our.goalsAgainst.toString()} />
            </div>
            {our.unreadable > 0 && (
              <p className="text-[11px] font-sub text-amber-600 dark:text-amber-400">
                {our.unreadable} logged {our.unreadable === 1 ? "entry" : "entries"} could not be read
                back as a scoreline and {our.unreadable === 1 ? "was" : "were"} left out of these totals
                rather than guessed at.
              </p>
            )}
            <DebriefDigest digest={digest} />
          </>
        )}
      </section>

      {observed.squad && (
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <SectionTitle
            kicker="Squad"
            title={`How the squad moved${soFar}`}
            note="Compared between the first and last snapshot we hold for this season. Movement outside our window is invisible to us, so this is the change we can prove."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Squad size"
              value={`${observed.squad.sizeFirst} → ${observed.squad.sizeLast}`}
              note={`${observed.squad.arrivalCount} in, ${observed.squad.departureCount} out`}
            />
            <Stat
              label="Average rating"
              value={
                observed.squad.avgOverallFirst === null || observed.squad.avgOverallLast === null
                  ? "—"
                  : `${observed.squad.avgOverallFirst} → ${observed.squad.avgOverallLast}`
              }
            />
            <Stat
              label="Wage bill"
              value={`${money(observed.squad.wageBillFirst)} → ${money(observed.squad.wageBillLast)}`}
            />
            <Stat label="Youth players" value={observed.squad.youthCount.toString()} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <NameList title="Arrivals" names={observed.squad.arrivals} total={observed.squad.arrivalCount} tone="up" />
            <NameList title="Departures" names={observed.squad.departures} total={observed.squad.departureCount} tone="down" />
          </div>

          {(observed.squad.risers.length > 0 || observed.squad.fallers.length > 0) && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <MovementList
                title="Biggest improvers"
                rows={observed.squad.risers}
                format={(delta) => `+${delta}`}
              />
              <MovementList
                title="Biggest drops"
                rows={observed.squad.fallers}
                format={(delta) => `${delta}`}
              />
            </div>
          )}
        </section>
      )}

      {observed.finance && (
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <SectionTitle
            kicker="Money"
            title={`The boardroom${soFar}`}
            note="Budget readings taken at the edges of our window. They are point-in-time figures, not a running total."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Transfer budget" value={rangeText(observed.finance.transferBudget)} />
            <Stat label="Wage budget" value={rangeText(observed.finance.wageBudget)} />
            <Stat label="Total earnings" value={rangeText(observed.finance.totalEarnings)} />
            <Stat
              label="Record buy"
              value={observed.finance.recordBuy === null ? "—" : money(observed.finance.recordBuy)}
            />
            <Stat
              label="Record sale"
              value={observed.finance.recordSale === null ? "—" : money(observed.finance.recordSale)}
            />
          </div>
        </section>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <SectionTitle
          kicker="Threads"
          title={`What we were tracking${soFar}`}
          note="Storylines opened or still live inside our window, each with the count of facts attached to it."
        />
        {observed.storylines.length === 0 ? (
          <EmptyCard title="No threads" body="No storyline opened during our window for this season." />
        ) : (
          <ul className="space-y-2">
            {observed.storylines.map((thread) => (
              <li
                key={thread.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800/80 dark:bg-slate-950/60"
              >
                <div className="min-w-0">
                  <div className="font-heading text-sm text-slate-900 dark:text-slate-100">
                    {thread.title}
                  </div>
                  <div className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
                    {thread.category.replace(/_/g, " ")} · opened {dayOf(thread.openedAt)} ·{" "}
                    {thread.evidenceCount} {thread.evidenceCount === 1 ? "fact" : "facts"}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                    thread.status === "ACTIVE"
                      ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : thread.status === "RESOLVED"
                        ? "border border-slate-400/30 bg-slate-400/15 text-slate-600 dark:text-slate-300"
                        : "border border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {thread.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {observed.unplacedStorylines > 0 && (
          <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
            {observed.unplacedStorylines} further{" "}
            {observed.unplacedStorylines === 1 ? "thread is" : "threads are"} not tied to any season we
            observed, so they are counted here but not attributed to this one.
          </p>
        )}

        {observed.objectives.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-sub font-bold uppercase text-slate-400">Objectives</div>
            {observed.objectives.map((objective) => (
              <div
                key={objective.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-sub dark:border-slate-800/80 dark:bg-slate-950/60"
              >
                <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {objective.source}
                </span>
                <span className="text-slate-800 dark:text-slate-100">
                  {objective.text ??
                    (objective.source === "SAVE" && dossier.fromSave.boardObjectiveCode !== null
                      ? `Board objective code ${dossier.fromSave.boardObjectiveCode} (no wording in the save)`
                      : "(no text recorded)")}
                </span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">
                  {objective.targetPosition ? `· target ${objective.targetPosition}${ordinalSuffix(objective.targetPosition)}` : ""} ·{" "}
                  {objective.status}
                  {objective.outcome ? ` (${objective.outcome})` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {observed.boardObjectives.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
              What you set out to do
            </div>
            {observed.boardObjectives.map((objective) => (
              <div
                key={objective.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-sub dark:border-slate-800/80 dark:bg-slate-950/60"
              >
                <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  P{objective.priority}
                </span>
                <span className="text-slate-800 dark:text-slate-100">{objective.title}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">
                  · {objective.category.toLowerCase()} · {objective.status}
                </span>
                {objective.notes && (
                  <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {objective.notes}
                  </div>
                )}
              </div>
            ))}
            <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
              Goals you added to the Board Objectives tracker for this season. These are yours rather
              than the save&apos;s - the game never recorded them.
            </p>
          </div>
        )}

        {observed.positions.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
              Positions you logged
            </div>
            <div className="flex flex-wrap gap-2">
              {observed.positions.map((position) => (
                <span
                  key={`${position.enteredAt}-${position.position}`}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-sub ${
                    position.disputed
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
                  }`}
                  title={`${position.source}${position.basis ? ` · ${position.basis}` : ""}${position.points !== null ? ` · ${position.points} pts from ${position.played ?? "?"} matches` : ""}`}
                >
                  {position.position}
                  {ordinalSuffix(position.position)}
                  <span className="ml-1.5 text-slate-400">{dayOf(position.enteredAt)}</span>
                  {position.disputed && " · disputed"}
                </span>
              ))}
            </div>
            <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
              Every position you entered while we were watching, oldest first. Repeats are your own
              re-entries, not duplicates added by us.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function NotObservedPanel() {
  return (
    <section className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-slate-700 dark:bg-slate-900/60">
      <SectionTitle
        kicker="Not observed"
        title="What we cannot show for this season"
        note="No snapshot, squad, finance, thread or debrief data exists for this period, because TouchlineOS was not installed yet."
      />
      <ul className="space-y-1.5 text-xs font-sub text-slate-500 dark:text-slate-400">
        <li>· squad movement, arrivals and departures</li>
        <li>· boardroom and budget readings</li>
        <li>· storylines and the facts attached to them</li>
        <li>· your own logged matches, scorers, assists and notes</li>
      </ul>
      <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
        These appear for any season that begins after your first sync. The save&apos;s own summary above
        stays available for every season regardless.
      </p>
    </section>
  );
}

/** The manager's own record of a season - the part the save never holds. */
/**
 * A list only earns a scroll container once there is enough in it to scroll: one entry should not be
 * boxed behind its own scrollbar. Matches the trait used by the dashboard and finance lists.
 */
const scrollWhenMultiple = (count: number): string =>
  count >= 2
    ? "max-h-[280px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700"
    : "";

function DebriefDigest({ digest }: { digest: SeasonDebriefDigest }) {
  const contributors = digest.scorers.filter((s) => s.goals > 0 || s.assists > 0);
  const groupedWeaknesses = groupNotes(digest.weaknesses);
  const venues = [
    { label: "Home", value: digest.venues.home },
    { label: "Away", value: digest.venues.away },
    { label: "Neutral", value: digest.venues.neutral },
  ].filter((v) => v.value > 0);

  return (
    <div className="space-y-5 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-sub font-bold uppercase text-slate-400">
          From your debriefs
        </span>
        <span className="rounded bg-[#E11D48]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#E11D48] dark:text-[#FF8C7A]">
          your observations
        </span>
      </div>

      {contributors.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
            Goals and assists you recorded
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800/80">
            <table className="w-full text-left text-xs font-sub">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-bold">Player</th>
                  <th className="px-3 py-2 text-right font-bold">Goals</th>
                  <th className="px-3 py-2 text-right font-bold">Assists</th>
                  <th className="px-3 py-2 text-right font-bold">Logged in</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((player) => (
                  <tr
                    key={player.name}
                    className="border-t border-slate-100 text-slate-700 dark:border-slate-800/60 dark:text-slate-200"
                  >
                    <td className="px-3 py-2">{player.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{player.goals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{player.assists}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {player.matches}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {digest.standouts.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
            Players you singled out
          </div>
          <div className="flex flex-wrap gap-2">
            {digest.standouts.map((standout) => (
              <span
                key={standout.name}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-sub text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
              >
                {standout.name}
                <span className="ml-1.5 text-slate-400">×{standout.times}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] font-sub text-slate-500 dark:text-slate-400">
            A name appearing again and again is you telling us something the save cannot.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groupedWeaknesses.length > 0 && (
          <Cardlet title="Weaknesses you named">
            <ul className="space-y-1">
              {groupedWeaknesses.map((entry) => (
                <li key={entry.note} className="text-xs font-sub text-slate-600 dark:text-slate-300">
                  <span className="mr-1.5 text-slate-400">·</span>
                  {entry.note}
                  {entry.count > 1 && (
                    <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      ×{entry.count}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Cardlet>
        )}

        {(venues.length > 0 || digest.competitions.length > 0) && (
          <Cardlet title="How your logged matches split">
            <div className="flex flex-wrap gap-2">
              {venues.map((venue) => (
                <Chip key={venue.label} label={venue.label} value={venue.value} />
              ))}
              {digest.competitions.map((competition) => (
                <Chip key={competition.name} label={competition.name} value={competition.matches} />
              ))}
            </div>
            <p className="mt-2 text-[11px] font-sub text-slate-500 dark:text-slate-400">
              Competitions are labelled exactly as you typed them, so a typo shows up as its own entry.
            </p>
          </Cardlet>
        )}
      </div>

      {digest.reflections.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
            In your words
          </div>
          <ul className={`space-y-2 ${scrollWhenMultiple(digest.reflections.length)}`}>
            {digest.reflections.map((reflection, index) => (
              <li
                key={`${reflection.matchDate ?? "undated"}-${index}`}
                className="rounded-xl border-l-2 border-[#E11D48]/60 bg-slate-50 px-3 py-2 text-xs font-sub italic text-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
              >
                “{reflection.note}”
                {reflection.matchDate && (
                  <span className="ml-2 font-normal not-italic text-slate-400">
                    {reflection.matchDate}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.prompts.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-sub font-bold uppercase text-slate-400">
            Questions you answered
          </div>
          <ul className={`space-y-2 ${scrollWhenMultiple(digest.prompts.length)}`}>
            {digest.prompts.map((prompt, index) => (
              <li
                key={`${prompt.question}-${index}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800/80 dark:bg-slate-950/60"
              >
                <div className="text-xs font-sub text-slate-500 dark:text-slate-400">
                  {prompt.question}
                </div>
                <div className="text-xs font-sub text-slate-800 dark:text-slate-100">
                  {prompt.answer}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function SectionTitle({ kicker, title, note }: { kicker: string; title: string; note: string }) {
  return (
    <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
      <div className="text-[10px] font-sub font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
        {kicker}
      </div>
      <h3 className="font-heading text-sm uppercase tracking-wide text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="mt-1 max-w-3xl text-[11px] font-sub text-slate-500 dark:text-slate-400">{note}</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
      <span className="text-[10px] font-sub font-bold uppercase text-slate-400">{label}</span>
      <div className="mt-1 font-heading text-sm text-slate-900 dark:text-slate-100">{value}</div>
      {note && <div className="mt-0.5 text-[10px] font-sub text-slate-500 dark:text-slate-400">{note}</div>}
    </div>
  );
}

function Cardlet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
      <div className="text-[10px] font-sub font-bold uppercase text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-sub text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
      {label}
      <span className="ml-1.5 tabular-nums text-slate-400">{value}</span>
    </span>
  );
}

function NameList({
  title,
  names,
  total,
  tone,
}: {
  title: string;
  names: string[];
  total: number;
  tone: "up" | "down";
}) {
  return (
    <Cardlet title={title}>
      {names.length === 0 ? (
        <div className="text-xs font-sub text-slate-500 dark:text-slate-400">None recorded in window.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <span
              key={name}
              className={`rounded px-2 py-0.5 text-[11px] font-sub ${
                tone === "up"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {name}
            </span>
          ))}
        </div>
      )}
      {total > names.length && (
        <div className="text-[10px] font-sub text-slate-500 dark:text-slate-400">
          +{total - names.length} more
        </div>
      )}
    </Cardlet>
  );
}

function MovementList({
  title,
  rows,
  format,
}: {
  title: string;
  rows: { name: string; delta: number }[];
  format: (delta: number) => string;
}) {
  return (
    <Cardlet title={title}>
      {rows.length === 0 ? (
        <div className="text-xs font-sub text-slate-500 dark:text-slate-400">None in window.</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.name} className="text-xs font-sub text-slate-600 dark:text-slate-300">
              {row.name}
              <span className="ml-2 tabular-nums text-slate-400">{format(row.delta)}</span>
            </li>
          ))}
        </ul>
      )}
    </Cardlet>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="font-heading text-sm uppercase text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="mt-1 text-xs font-sub text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}

/** `YYYY-MM-DD HH:MM:SS` → the date, because the time of a sync is not what the manager cares about. */
function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Notes are grouped case-insensitively so "Conceded twice from set pieces" named three times reads as
 * one recurring problem with a count, instead of three separate lines that look like noise.
 */
function groupNotes(notes: { note: string; matchDate: string | null }[]): { note: string; count: number }[] {
  const grouped = new Map<string, { note: string; count: number }>();
  for (const entry of notes) {
    const key = entry.note.trim().toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(key, { note: entry.note.trim(), count: 1 });
    }
  }
  return [...grouped.values()];
}

/**
 * The save's own objective codes, shown as codes because the save stores them unmapped.
 *
 * Codes at or below zero are EA's "not applicable" sentinel and are dropped: printing "code -1" for a
 * competition the club was never in states nothing except that we read the field.
 */
function objectiveCodes(save: SeasonDossier["fromSave"]): string[] {
  return [
    save.boardObjectiveCode !== null && save.boardObjectiveCode > 0
      ? `board ${save.boardObjectiveCode}`
      : null,
    save.domesticCupObjective !== null && save.domesticCupObjective > 0
      ? `domestic cup ${save.domesticCupObjective}`
      : null,
    save.europeCupObjective !== null && save.europeCupObjective > 0
      ? `continental cup ${save.europeCupObjective}`
      : null,
  ].filter((code): code is string => code !== null);
}

function rangeText(range: { first: number | null; last: number | null }): string {
  if (range.first === null && range.last === null) return "—";
  if (range.first === null) return money(range.last as number);
  if (range.last === null) return money(range.first);
  if (range.first === range.last) return money(range.first);
  return `${money(range.first)} → ${money(range.last)}`;
}

/** Compact money: budgets run to the tens of millions and a full number adds nothing at a glance. */
function money(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return amount.toString();
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
