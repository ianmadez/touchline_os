"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * Scouting memory: the targets the manager set aside, and whether anything has changed.
 *
 * Two things live here because they are the same thought. Setting a target aside is only half the
 * act - the other half is recording WHY, because the reason is what decides whether the target is
 * ever worth looking at again. Putting the reason picker anywhere other than next to the archive list
 * would let a rejection be recorded with no memory attached to it.
 *
 * The list leads with anything that has actually changed, because that is the only part of it that
 * asks the manager to do something.
 */

interface Assessment {
  target: {
    id: string;
    name: string;
    clubName: string | null;
    age: number | null;
    overallRating: number | null;
    archiveReason: string;
    archivedAt: string | null;
    notes: string | null;
  };
  trigger: "VALUE_DROP" | "BUDGET_RISE" | "NONE";
  shouldResurface: boolean;
  comparables: number;
  confidence: "RELIABLE" | "NO_RELIABLE_ESTIMATE";
  detail: string;
}

interface BoardTarget {
  id: string;
  name: string;
}

const REASONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "TOO_EXPENSIVE", label: "Too expensive" },
  { value: "WAGE_HIGH", label: "Wages too high" },
  { value: "AGE_MISMATCH", label: "Wrong age" },
  { value: "POSTPONED", label: "Not now" },
];

export function ScoutingMemoryPanel({ careerId }: { careerId: string }) {
  const [rows, setRows] = useState<Assessment[] | null>(null);
  const [board, setBoard] = useState<BoardTarget[]>([]);
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("TOO_EXPENSIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reloading after an archive is driven by a token rather than by calling an async loader from the
  // click handler. Fetching inside the effect and setting state from the promise callback is the shape
  // this codebase's lint rules accept; an async loader shared by the effect and the handlers trips
  // `react-hooks/set-state-in-effect`.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch(`/api/scouting/memory?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" }),
      apiFetch(`/api/scouting?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" }),
    ])
      .then(async ([memoryResponse, boardResponse]) => {
        const memory = (await memoryResponse.json()) as {
          success?: boolean;
          assessments?: Assessment[];
        };
        const boardBody = (await boardResponse.json()) as {
          success?: boolean;
          board?: { targets?: Array<{ id: string; name: string }> };
        };
        if (cancelled) return;
        if (memory.success) setRows(memory.assessments ?? []);
        const targets = boardBody.board?.targets;
        if (Array.isArray(targets)) {
          setBoard(targets.map((target) => ({ id: target.id, name: target.name })));
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [careerId, reloadToken]);

  const archive = async () => {
    if (!targetId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/scouting/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId, targetId, reason }),
      });
      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? `Could not archive that target (${response.status}).`);
      }
      setTargetId("");
      setReloadToken((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/scouting/memory?careerId=${encodeURIComponent(careerId)}&targetId=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? `Could not restore that target (${response.status}).`);
      }
      setReloadToken((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const changed = (rows ?? []).filter((row) => row.shouldResurface).length;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          Scouting memory
        </h2>
        {rows !== null && rows.length > 0 && (
          <span className="font-sub text-label font-bold uppercase tracking-wider tabular-nums text-slate-500 dark:text-slate-400">
            {rows.length} set aside
            {changed > 0 ? ` · ${changed} worth another look` : ""}
          </span>
        )}
      </div>

      {/* Recording the reason IS the feature, so the form sits above the list it fills. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Target
          </span>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={busy || board.length === 0}
            className="min-h-10 rounded-xl border border-slate-300 bg-slate-50 p-2.5 font-sub text-xs text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">
              {board.length === 0 ? "Nobody on the board yet" : "Pick a target"}
            </option>
            {board.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Why
          </span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            className="min-h-10 rounded-xl border border-slate-300 bg-slate-50 p-2.5 font-sub text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void archive()}
          disabled={busy || !targetId}
          className="min-h-10 rounded-xl bg-[#E11D48] px-4 py-2.5 font-sub text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-[#FF8C7A] disabled:opacity-40 cursor-pointer"
        >
          Set aside
        </button>
      </div>

      {error && (
        <p className="font-sans text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {rows === null ? (
        <p className="font-sans text-xs text-slate-500 dark:text-slate-400">Loading memory…</p>
      ) : rows.length === 0 ? (
        <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
          Nothing set aside yet. Recording WHY a target was turned down is what lets this list tell
          you when he becomes worth another look.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.target.id}
              className={`rounded-xl border p-3 ${
                row.shouldResurface
                  ? "border-emerald-400/40 bg-emerald-500/5"
                  : "border-slate-200 bg-slate-50 dark:border-slate-800/80 dark:bg-slate-950/60"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-sm text-slate-900 dark:text-slate-100">
                      {row.target.name}
                    </span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {row.target.archiveReason.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {row.shouldResurface && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-sub text-label font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Worth another look
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {row.detail}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void restore(row.target.id)}
                  disabled={busy}
                  className="min-h-10 shrink-0 rounded-lg border border-slate-300 px-3 py-2 font-sub text-label font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Back on the board
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        A price alert needs {3} similar players behind it before it fires, so a single moved estimate
        cannot raise one on its own. Age rejections never return, because age only moves one way.
      </p>
    </section>
  );
}
