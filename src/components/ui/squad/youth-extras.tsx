"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/platform/api-client";

/**
 * The Youth tab's two inner pages beyond the academy list:
 *
 *   - Graduate Wall: every player the academy has sent up, with how far he has come since.
 *   - Mentors: senior players paired with prospects, the progress made under them, and suggestions.
 *
 * Both read the same /api/youth payload the academy list reads, each on its own, so a tab only costs
 * a request when it is opened.
 */

interface Graduate {
  playerId: number;
  name: string | null;
  promotion: { source: "SAVE" | "USER"; recordedAt: string };
  overallRating: number | null;
  potentialRating: number | null;
  primaryPosition: string | null;
  age: number | null;
  atPromotion: { overallRating: number | null; potentialRating: number | null } | null;
  growth: number | null;
  appearances: number;
  averageRating: number | null;
  inSquad: boolean;
}

interface Prospect {
  playerId: number;
  name: string | null;
  displayName?: string | null;
  primaryPosition: string | null;
  overallRating: number | null;
  potentialRating: number | null;
  age: number | null;
  promotion?: unknown;
}

interface Mentorship {
  prospectId: number;
  prospectName: string | null;
  mentorId: number;
  mentorName: string;
  pairedAt: string;
  atPairing: { overallRating: number | null; potentialRating: number | null };
  currentOverall: number | null;
  progress: number | null;
  notes: { at: string; text: string }[];
}

interface MentorCandidate {
  playerId: number;
  name: string;
  primaryPosition: string;
  overallRating: number;
  age: number | null;
  reasons: string[];
  mentees: number;
}

interface YouthPayload {
  success?: boolean;
  error?: string;
  prospects?: Prospect[];
  graduates?: Graduate[];
  mentors?: { mentorships: Mentorship[]; suggestions: Record<string, MentorCandidate[]> };
}

function useYouth(careerId: string) {
  const [data, setData] = useState<YouthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/youth?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" });
      const body = (await response.json()) as YouthPayload;
      if (!response.ok || !body.success) {
        setError(body.error ?? `Could not read the academy (${response.status}).`);
        return;
      }
      setData(body);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [careerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await apiFetch("/api/youth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, ...payload }),
      });
      const body = (await response.json()) as YouthPayload;
      if (!response.ok || !body.success) {
        setError(body.error ?? `That did not save (${response.status}).`);
        return;
      }
      setData(body);
      setError(null);
    },
    [careerId]
  );

  return { data, error, post };
}

const label = "font-sub text-label font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400";

function Status({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>;
  if (loading) return <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Loading…</p>;
  return null;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1 font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

function Growth({ value }: { value: number | null }) {
  if (value === null) return <span className="font-sub text-xs text-slate-400">—</span>;
  const tone =
    value > 0
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : value < 0
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : "bg-slate-500/15 text-slate-600 dark:text-slate-300";
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-heading text-xs tabular-nums ${tone}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/* ---------------------------------------------------------------------------------------------- */

export function GraduateWall({ careerId, query }: { careerId: string; query: string }) {
  const { data, error, post } = useYouth(careerId);
  const [busy, setBusy] = useState<number | null>(null);
  if (!data) return <Status error={error} loading />;

  const needle = query.trim().toLowerCase();
  const all = data.graduates ?? [];
  const graduates = (needle ? all.filter((g) => (g.name ?? "").toLowerCase().includes(needle)) : all)
    // The wall's order is its argument: who has come furthest, then who has played most.
    .slice()
    .sort((a, b) => (b.growth ?? -99) - (a.growth ?? -99) || b.appearances - a.appearances);

  if (all.length === 0) {
    return (
      <Empty
        title="No graduates yet"
        body="Promote a prospect from the Academy tab, or sync a save where one has moved up, and he goes on the wall with his figures from the day he was promoted."
      />
    );
  }

  const inSquad = all.filter((g) => g.inSquad).length;
  const apps = all.reduce((sum, g) => sum + g.appearances, 0);
  const best = all.reduce<Graduate | null>((top, g) => (g.growth !== null && (top === null || g.growth > (top.growth ?? -99)) ? g : top), null);

  return (
    <div className="space-y-4" data-tour="youth-wall">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Graduates", String(all.length)],
          ["Still with you", String(inSquad)],
          ["First-team apps", String(apps)],
          ["Biggest riser", best && best.growth !== null ? `${best.name ?? "Unnamed"} +${best.growth}` : "—"],
        ].map(([title, value]) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-900/90">
            <p className={label}>{title}</p>
            <p className="mt-1 truncate font-heading text-base text-slate-900 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Scroll container: about two rows of cards, then the wall scrolls inside itself so a big
          academy never pushes the page down. */}
      <ul
        tabIndex={0}
        aria-label="Graduates"
        className="grid max-h-[22rem] gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2 lg:grid-cols-3"
      >
        {graduates.map((g, index) => (
          <li
            key={g.playerId}
            className={`relative overflow-hidden rounded-2xl border p-4 ${
              g.inSquad
                ? "border-amber-300/70 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/30 dark:from-amber-500/10 dark:to-slate-900"
                : "border-slate-200 bg-slate-50 opacity-80 dark:border-slate-800 dark:bg-slate-900/60"
            }`}
          >
            {index < 3 && g.growth !== null && g.growth > 0 && !needle && (
              <span className="absolute right-3 top-3 text-lg" aria-label={`Number ${index + 1} riser`} title={`Number ${index + 1} riser`}>
                {["🥇", "🥈", "🥉"][index]}
              </span>
            )}
            <p className="pr-8 font-heading text-base text-slate-900 dark:text-slate-100">{g.name || "Unnamed graduate"}</p>
            <p className={label}>
              {g.primaryPosition ?? "—"}
              {g.age !== null ? ` · age ${g.age}` : ""} · promoted {shortDate(g.promotion.recordedAt)}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <span className="font-heading text-sm tabular-nums text-slate-500">{g.atPromotion?.overallRating ?? "?"}</span>
              <span className="text-slate-400">→</span>
              <span className="font-heading text-2xl tabular-nums text-slate-900 dark:text-slate-100">{g.overallRating ?? "?"}</span>
              <Growth value={g.growth} />
              <span className="ml-auto font-sub text-xs text-emerald-600 dark:text-emerald-400">POT {g.potentialRating ?? "—"}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-sub text-xs text-slate-600 dark:text-slate-300">
              <span>
                <strong className="tabular-nums">{g.appearances}</strong> first-team apps
              </span>
              {g.averageRating !== null && (
                <span>
                  avg <strong className="tabular-nums">{g.averageRating.toFixed(2)}</strong>
                </span>
              )}
              <span className="text-slate-400">{g.inSquad ? "In your squad" : "Moved on"}</span>
              {g.promotion.source === "USER" && (
                <button
                  type="button"
                  disabled={busy === g.playerId}
                  onClick={() => {
                    setBusy(g.playerId);
                    void post({ playerId: g.playerId, undo: true }).finally(() => setBusy(null));
                  }}
                  title="You promoted him by hand. Undo puts him back in the academy list."
                  className="ml-auto cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-rose-600 disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {graduates.length === 0 && <p className="font-sans text-xs text-slate-500">No graduate matches that name.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export function MentorBoard({ careerId, query }: { careerId: string; query: string }) {
  const { data, error, post } = useYouth(careerId);
  const [busy, setBusy] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  if (!data) return <Status error={error} loading />;

  const run = async (prospectId: number, payload: Record<string, unknown>) => {
    setBusy(prospectId);
    try {
      await post({ playerId: prospectId, ...payload });
    } finally {
      setBusy(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const matches = (name: string | null | undefined) => !needle || (name ?? "").toLowerCase().includes(needle);
  const mentorships = (data.mentors?.mentorships ?? []).filter((m) => matches(m.prospectName) || matches(m.mentorName));
  const suggestions = data.mentors?.suggestions ?? {};
  const unpaired = (data.prospects ?? []).filter((p) => !p.promotion && suggestions[p.playerId] !== undefined && matches(p.displayName || p.name));

  const button =
    "cursor-pointer rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-6" data-tour="youth-mentors">
      <Status error={error} loading={false} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">Pairings</h2>
          <span className={label}>Progress is measured from the day each pairing began</span>
        </div>
        {mentorships.length === 0 ? (
          <p className="font-sans text-xs text-slate-500 dark:text-slate-400">No prospect has a mentor yet. Pick one below.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {mentorships.map((m) => (
              <li key={m.prospectId} className="rounded-xl border border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/90">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-heading text-sm text-slate-900 dark:text-slate-100">
                    {m.prospectName || "Unnamed prospect"} <span className="text-slate-400">with</span> {m.mentorName}
                  </p>
                  <button type="button" disabled={busy === m.prospectId} onClick={() => void run(m.prospectId, { action: "unmentor" })} className={`${button} border-slate-300 text-slate-500 hover:text-rose-600`}>
                    End
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 font-sub text-xs text-slate-600 dark:text-slate-300">
                  <span>Since {shortDate(m.pairedAt)}:</span>
                  <span className="tabular-nums">{m.atPairing.overallRating ?? "?"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-heading tabular-nums text-slate-900 dark:text-slate-100">{m.currentOverall ?? "?"}</span>
                  <Growth value={m.progress} />
                </div>
                {m.notes.length > 0 && (
                  <ul className="mt-3 max-h-24 space-y-1 overflow-y-auto overscroll-contain border-l-2 border-slate-200 pl-3 dark:border-slate-700" tabIndex={0} aria-label="Mentor notes">
                    {m.notes
                      .slice()
                      .reverse()
                      .map((note) => (
                        <li key={note.at} className="font-sans text-xs text-slate-600 dark:text-slate-300">
                          <span className="text-slate-400">{shortDate(note.at)}</span> {note.text}
                        </li>
                      ))}
                  </ul>
                )}
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = (drafts[m.prospectId] ?? "").trim();
                    if (!text) return;
                    void run(m.prospectId, { action: "mentorNote", text }).then(() => setDrafts((d) => ({ ...d, [m.prospectId]: "" })));
                  }}
                >
                  <label className="sr-only" htmlFor={`mentor-note-${m.prospectId}`}>
                    Progress note
                  </label>
                  <input
                    id={`mentor-note-${m.prospectId}`}
                    value={drafts[m.prospectId] ?? ""}
                    onChange={(event) => setDrafts((d) => ({ ...d, [m.prospectId]: event.target.value }))}
                    maxLength={280}
                    placeholder="Progress note, e.g. first-team training this week"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sans text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <button type="submit" disabled={busy === m.prospectId || !(drafts[m.prospectId] ?? "").trim()} className={`${button} border-slate-300 text-slate-600 dark:text-slate-300`}>
                    Add
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">Needs a mentor</h2>
          <span className={label}>Suggested from your senior players in the same line</span>
        </div>
        {unpaired.length === 0 ? (
          <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Every prospect in the academy has a mentor.</p>
        ) : (
          <ul className="space-y-2">
            {unpaired.map((p) => {
              const options = suggestions[p.playerId] ?? [];
              return (
                <li key={p.playerId} className="rounded-xl border border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/90">
                  <p className="font-heading text-sm text-slate-900 dark:text-slate-100">
                    {p.displayName || p.name || "Unnamed prospect"}{" "}
                    <span className={label}>
                      {p.primaryPosition ?? "—"} · {p.overallRating ?? "?"} → {p.potentialRating ?? "?"}
                    </span>
                  </p>
                  {options.length === 0 ? (
                    <p className="mt-2 font-sans text-xs text-slate-500">No senior player (25+) in his line of the pitch to pair him with.</p>
                  ) : (
                    <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                      {options.map((c, index) => (
                        <li key={c.playerId} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-heading text-xs text-slate-900 dark:text-slate-100">
                              {index === 0 && <span className="mr-1 text-amber-500" title="Best fit">★</span>}
                              {c.name}
                            </span>
                            <span className="font-sub text-xs tabular-nums text-slate-500">
                              {c.primaryPosition} {c.overallRating}
                            </span>
                          </div>
                          <ul className="space-y-0.5">
                            {c.reasons.slice(0, 3).map((reason) => (
                              <li key={reason} className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                                · {reason}
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            disabled={busy === p.playerId}
                            onClick={() => void run(p.playerId, { action: "mentor", mentorId: c.playerId })}
                            className={`${button} mt-auto border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300`}
                          >
                            Pair
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
