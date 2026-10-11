"use client";

import React, { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";

/**
 * The head-to-head record.
 *
 * Everything here exists because the manager wrote a debrief. The game stores no fixtures and no results for
 * his own division, so there is no other possible source, and the panel says so at the top rather than
 * letting a table of numbers imply otherwise.
 *
 * "Everywhere it has been faced" is the rule: a meeting counts whatever competition it was in. The filter is
 * therefore by competition, and it narrows both the table and the meeting lists inside it, so a manager can
 * ask "how do we do against them in the cup" and get a straight answer.
 */

interface Meeting {
  eventId: string;
  matchDate: string | null;
  competition: string | null;
  venue: string | null;
  goalsFor: number;
  goalsAgainst: number;
  result: "WIN" | "DRAW" | "LOSS";
  scoreline: string;
}

interface Opponent {
  opponent: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  biggestWin: string | null;
  longestUnbeaten: number;
  competitions: string[];
  meetings: Meeting[];
}

interface Record {
  opponents: Opponent[];
  competitions: string[];
  totals: {
    opponents: number;
    meetings: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  empty: boolean;
}

const ALL = "__ALL__";

export function HeadToHeadPanel({ careerId }: { careerId: string }) {
  const [record, setRecord] = useState<Record | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [competition, setCompetition] = useState<string>(ALL);
  const [openOpponent, setOpenOpponent] = useState<string | null>(null);

  useEffect(() => {
    if (!careerId) return;
    let cancelled = false;
    apiFetch(`/api/h2h?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { success?: boolean; record?: Record; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.success || !body.record) {
          setError(body.error ?? "Could not build the head-to-head record.");
          return;
        }
        setRecord(body.record);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [careerId]);

  /** The record as the filter leaves it: meetings narrowed first, so a club with none in that competition drops out. */
  const filtered = useMemo(() => {
    if (!record) return null;
    if (competition === ALL) return record;
    return {
      ...record,
      opponents: record.opponents
        .map((opponent) => ({ ...opponent, meetings: opponent.meetings.filter(inCompetition(competition)) }))
        .filter((opponent) => opponent.meetings.length > 0)
        .map((opponent) => summarise(opponent)),
    };
  }, [record, competition]);

  const totals = useMemo(() => {
    if (!filtered) return null;
    const meetings = filtered.opponents.reduce((total, opponent) => total + opponent.played, 0);
    return {
      opponents: filtered.opponents.length,
      meetings,
      wins: filtered.opponents.reduce((total, opponent) => total + opponent.wins, 0),
      draws: filtered.opponents.reduce((total, opponent) => total + opponent.draws, 0),
      losses: filtered.opponents.reduce((total, opponent) => total + opponent.losses, 0),
      goalsFor: filtered.opponents.reduce((total, opponent) => total + opponent.goalsFor, 0),
      goalsAgainst: filtered.opponents.reduce((total, opponent) => total + opponent.goalsAgainst, 0),
    };
  }, [filtered]);

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-sub text-amber-700 dark:text-amber-300">
        {error}
      </div>
    );
  }

  if (!record || !filtered || !totals) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200/80 bg-white/60 dark:border-slate-800/80 dark:bg-slate-900/60" />
        <div className="h-64 animate-pulse rounded-2xl border border-slate-200/80 bg-white/60 dark:border-slate-800/80 dark:bg-slate-900/60" />
      </div>
    );
  }

  if (record.empty) {
    return (
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          No opponents faced yet
        </h3>
        <p className="mt-2 max-w-prose font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          A head-to-head record is built from your own match debriefs, and there is nothing to build from on
          this save yet. The save itself records no fixtures and no results for your division, so a debrief is
          the only way a meeting ever reaches the app.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Head to head
            </h3>
            <p className="mt-1 max-w-2xl font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Every meeting you have written up, in every competition. Built from your debriefs, because the
              save records no fixtures or results for your own division.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 font-sub text-micro uppercase tracking-wider text-slate-400 dark:text-slate-500">
            <Stat label="Opponents" value={`${totals.opponents}`} />
            <Stat label="Meetings" value={`${totals.meetings}`} />
            <Stat label="W-D-L" value={`${totals.wins}-${totals.draws}-${totals.losses}`} />
            <Stat label="Goals" value={`${totals.goalsFor}-${totals.goalsAgainst}`} />
          </div>
        </div>

        {record.competitions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <span className="mr-1 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Where
            </span>
            <FilterChip active={competition === ALL} onClick={() => setCompetition(ALL)}>
              Every competition
            </FilterChip>
            {record.competitions.map((name) => (
              <FilterChip key={name} active={competition === name} onClick={() => setCompetition(name)}>
                {name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {filtered.opponents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 text-xs font-sub text-slate-500 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/90 dark:text-slate-400">
          No meetings recorded in that competition.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          {/* A table on a wide screen and stacked rows on a narrow one: the same data, read the only way it can be. */}
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                {["Opponent", "P", "W", "D", "L", "For", "Against", "Best win", "Unbeaten"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className={`px-4 py-3 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 ${
                      heading === "Opponent" || heading === "Best win" ? "text-left" : "text-center"
                    }`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.opponents.map((opponent) => (
                <React.Fragment key={opponent.opponent}>
                  <tr
                    onClick={() =>
                      setOpenOpponent(openOpponent === opponent.opponent ? null : opponent.opponent)
                    }
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-sans text-xs font-semibold text-slate-900 dark:text-slate-100">
                        <span aria-hidden="true" className="font-sub text-slate-300 dark:text-slate-600">
                          {openOpponent === opponent.opponent ? "▾" : "▸"}
                        </span>
                        {opponent.opponent}
                      </span>
                    </td>
                    <Cell>{opponent.played}</Cell>
                    <Cell>{opponent.wins}</Cell>
                    <Cell>{opponent.draws}</Cell>
                    <Cell>{opponent.losses}</Cell>
                    <Cell>{opponent.goalsFor}</Cell>
                    <Cell>{opponent.goalsAgainst}</Cell>
                    <td className="px-4 py-3 font-sans text-xs text-slate-600 tabular-nums dark:text-slate-300">
                      {opponent.biggestWin ?? "not yet"}
                    </td>
                    <Cell>{opponent.longestUnbeaten}</Cell>
                  </tr>
                  {openOpponent === opponent.opponent && (
                    <tr className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800/60 dark:bg-slate-950/40">
                      <td colSpan={9} className="px-4 py-3">
                        <MeetingList meetings={opponent.meetings} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/60">
            {filtered.opponents.map((opponent) => (
              <li key={opponent.opponent} className="p-4">
                <button
                  type="button"
                  onClick={() =>
                    setOpenOpponent(openOpponent === opponent.opponent ? null : opponent.opponent)
                  }
                  className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                >
                  <span className="font-sans text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {opponent.opponent}
                  </span>
                  <span className="font-sans text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {opponent.played}P · {opponent.wins}W {opponent.draws}D {opponent.losses}L
                  </span>
                </button>
                <p className="mt-1 font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {opponent.goalsFor}-{opponent.goalsAgainst} goals
                  {opponent.biggestWin ? `  ·  best ${opponent.biggestWin}` : ""}
                  {opponent.longestUnbeaten > 1 ? `  ·  ${opponent.longestUnbeaten} unbeaten` : ""}
                </p>
                {openOpponent === opponent.opponent && (
                  <div className="mt-3">
                    <MeetingList meetings={opponent.meetings} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One opponent's meetings, newest first, with the competition and ground on each. */
function MeetingList({ meetings }: { meetings: Meeting[] }) {
  return (
    <ul className="space-y-1.5">
      {meetings.map((meeting) => (
        <li
          key={meeting.eventId}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-sans text-xs"
        >
          <span className="flex items-center gap-2">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                meeting.result === "WIN"
                  ? "bg-emerald-500"
                  : meeting.result === "LOSS"
                    ? "bg-rose-500"
                    : "bg-amber-500"
              }`}
              aria-hidden="true"
            />
            <span className="text-slate-500 dark:text-slate-400">
              {[meeting.matchDate, meeting.competition ?? "Unrecorded", venueWord(meeting.venue)]
                .filter(Boolean)
                .join("  ·  ")}
            </span>
          </span>
          <span className="text-slate-900 tabular-nums dark:text-slate-100">
            {meeting.scoreline}{" "}
            <span className="font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {meeting.result === "WIN" ? "won" : meeting.result === "LOSS" ? "lost" : "drew"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3 text-center font-sans text-xs tabular-nums text-slate-600 dark:text-slate-300">
      {children}
    </td>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col rounded-xl border border-slate-200 px-3 py-1.5 dark:border-slate-800">
      <span className="text-[9px] tracking-wider text-slate-400">{label}</span>
      <span className="font-sans text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider transition-[border-color,background-color,color] duration-200 ease-[var(--ease-brand)] cursor-pointer ${
        active
          ? "border-[#E11D48]/40 bg-[#E11D48]/10 text-[#E11D48] dark:text-[#FF8C7A]"
          : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function inCompetition(name: string) {
  return (meeting: Meeting) => (meeting.competition ?? "Unrecorded") === name;
}

/** Recomputes an opponent's totals over whatever meetings the filter left them. */
function summarise(opponent: Opponent): Opponent {
  const wins = opponent.meetings.filter((meeting) => meeting.result === "WIN");
  const best = [...wins].sort(
    (left, right) => right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst)
  )[0];
  let longestUnbeaten = 0;
  for (const meeting of opponent.meetings) {
    if (meeting.result === "LOSS") break;
    longestUnbeaten += 1;
  }
  return {
    ...opponent,
    played: opponent.meetings.length,
    wins: wins.length,
    draws: opponent.meetings.filter((meeting) => meeting.result === "DRAW").length,
    losses: opponent.meetings.filter((meeting) => meeting.result === "LOSS").length,
    goalsFor: opponent.meetings.reduce((total, meeting) => total + meeting.goalsFor, 0),
    goalsAgainst: opponent.meetings.reduce((total, meeting) => total + meeting.goalsAgainst, 0),
    biggestWin: best
      ? `${best.scoreline}${best.venue ? ` (${best.venue.toLowerCase()})` : ""}`
      : null,
    longestUnbeaten,
    competitions: [...new Set(opponent.meetings.map((meeting) => meeting.competition ?? "Unrecorded"))],
  };
}

function venueWord(venue: string | null): string | null {
  if (!venue) return null;
  const upper = venue.toUpperCase();
  if (upper === "HOME") return "home";
  if (upper === "AWAY") return "away";
  return "neutral";
}
