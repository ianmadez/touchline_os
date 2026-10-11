"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, formatMoneyExact } from "@/lib/ui/format";
import type { FinanceRulesReport, RuleStatus, RuleVerdict } from "@/lib/services/finance-rules-service";
import type { LedgerEntry, TransferLedger } from "@/lib/services/transfer-ledger-service";
import { IconAlert, IconArrowIn, IconArrowOut, IconCheck, IconPlus, IconTrend, IconUserEntry, IconWallet } from "@/components/ui/icons";

import { apiFetch } from "@/lib/platform/api-client";

/**
 * The two money surfaces added for Tier 3: the transfer ledger and the league rules.
 *
 * THE LEDGER'S JOB is to answer two questions without inventing anything: what did he cost us, and what did
 * we make. It shows the fees the save carries and the deals the manager typed in, with each row tagged, and
 * it never averages the two into one confident number.
 *
 * THE RULES PANEL'S JOB is to write down what a division actually requires without pretending to know
 * something it does not. Every rule lands in one of four states - inside the line, past it, listed for
 * reference, or nothing to compare - and the state is printed. In strict realism they read as checks; in the
 * relaxed modes the same comparisons are context.
 *
 * Neither panel is decorated for its own sake: one table, one list, one form, and the caveats where the
 * numbers are.
 */
export function TransferLedgerPanel({ careerId, symbol }: { careerId: string | null; symbol: string }) {
  const [ledger, setLedger] = useState<TransferLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!careerId) {
      setLedger(null);
      return;
    }
    try {
      const response = await apiFetch(`/api/transfer-ledger?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        ledger?: TransferLedger | null;
        error?: string;
      };
      if (payload.success) {
        setLedger(payload.ledger ?? null);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read the transfer ledger.");
      }
    } catch {
      setError("Could not reach the ledger service.");
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const write = useCallback(
    async (path: string, init: RequestInit) => {
      if (!careerId) return false;
      setBusy(true);
      try {
        const response = await apiFetch(path, init);
        const payload = (await response.json()) as {
          success?: boolean;
          ledger?: TransferLedger | null;
          error?: string;
        };
        if (payload.success && payload.ledger) {
          setLedger(payload.ledger);
          setError(null);
          return true;
        }
        setError(payload.error ?? "Could not record that.");
        return false;
      } catch {
        setError("Could not reach the ledger service.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [careerId]
  );

  const savedCount = ledger ? ledger.entries.filter((entry) => entry.provenance === "SAVE").length : 0;
  const typedCount = ledger ? ledger.entries.length - savedCount : 0;
  const profitLines = useMemo(
    () => (ledger ? ledger.profitLines.filter((line) => line.profit !== null) : []),
    [ledger]
  );

  return (
    <section
      data-tour="finance-ledger"
      className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            <IconWallet className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            Transfer ledger
          </h3>
          <p className="mt-1 max-w-2xl font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
            Every move this club is on one side of, with the fee the save recorded. A saved deal carries
            two dates: the day it was agreed and the day the player actually moves, which is often the next
            window. Anything the game never wrote down is yours to add, and every row says which it is.
          </p>        </div>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-heading text-[10px] font-bold uppercase tracking-wider text-slate-700 transition-colors hover:border-[#E11D48]/40 hover:text-[#E11D48] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-[#FF8C7A]/40 dark:hover:text-[#FF8C7A]"
        >
          <IconPlus className="h-3 w-3" />
          {adding ? "Close" : "Add a deal"}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 font-sub text-[11px] text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {adding && careerId && (
        <AddDealForm
          careerId={careerId}
          symbol={symbol}
          busy={busy}
          onSubmit={async (values) => {
            const done = await write("/api/transfer-ledger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values),
            });
            if (done) setAdding(false);
          }}
        />
      )}

      {!ledger ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400">Reading the ledger…</p>
      ) : ledger.empty ? (
        <div className="space-y-2">
          <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
            No move involving this club is on file. The save records a fee only where a contract was
            pre-signed, so nothing here is a gap in your history, it is a gap in the file.
          </p>
          <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
            Signed a player or sold one before TouchlineOS was installed? Add it and the totals below
            become real.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LedgerStat label="Spent" value={formatMoney(ledger.totals.spent, symbol)} exact={formatMoneyExact(ledger.totals.spent, symbol)} />
            <LedgerStat label="Received" value={formatMoney(ledger.totals.received, symbol)} exact={formatMoneyExact(ledger.totals.received, symbol)} />
            <LedgerStat
              label="Net spend"
              value={formatMoney(ledger.totals.net, symbol)}
              exact={formatMoneyExact(ledger.totals.net, symbol)}
              tone={ledger.totals.net > 0 ? "over" : "ok"}
            />
          </div>

          <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
            {savedCount} {savedCount === 1 ? "fee" : "fees"} from the save
            {typedCount > 0 ? `, ${typedCount} you entered` : ""}. Nothing above is an estimate: every
            line is a fee from somewhere.
          </p>

          {ledger.seasons.length > 1 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <Th>Season</Th>
                    <Th align="right">Spent</Th>
                    <Th align="right">Received</Th>
                    <Th align="right">Net</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.seasons.map((season) => (
                    <tr
                      key={String(season.season)}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                    >
                      <Td>{season.season ?? "Season not recorded"}</Td>
                      <Td align="right">{formatMoney(season.spent, symbol)}</Td>
                      <Td align="right">{formatMoney(season.received, symbol)}</Td>
                      <Td align="right" tone={season.net > 0 ? "over" : undefined}>
                        {formatMoney(season.net, symbol)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {ledger.entries.map((entry) => (
              <LedgerRow
                key={entry.id}
                entry={entry}
                symbol={symbol}
                busy={busy}
                onRemove={
                  entry.editable && careerId
                    ? () =>
                        void write(
                          `/api/transfer-ledger?careerId=${encodeURIComponent(careerId)}&id=${encodeURIComponent(entry.id)}`,
                          { method: "DELETE" }
                        )
                    : undefined
                }
                onName={
                  careerId
                    ? (name) =>
                        void write("/api/transfer-ledger", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ careerId, dealId: entry.id, name }),
                        })
                    : undefined
                }
              />
            ))}
          </ul>

          {profitLines.length > 0 && (
            <div>
              <p className="mb-2 font-heading text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Bought and sold
              </p>
              <ul className="space-y-1.5">
                {profitLines.map((line) => (
                  <li
                    key={line.playerName}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-slate-200/70 px-3 py-2 dark:border-slate-800/70"
                  >
                    <span className="font-sub text-xs font-bold text-slate-800 dark:text-slate-100">
                      {line.playerName}
                    </span>
                    <span className="font-sub text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                      in for {formatMoney(line.paid ?? 0, symbol)} · out for{" "}
                      {formatMoney(line.received ?? 0, symbol)} ·{" "}
                      <span
                        className={
                          (line.profit ?? 0) >= 0
                            ? "font-bold text-emerald-600 dark:text-emerald-400"
                            : "font-bold text-rose-600 dark:text-rose-400"
                        }
                      >
                        {(line.profit ?? 0) >= 0 ? "+" : ""}
                        {formatMoney(line.profit ?? 0, symbol)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                Only players with both a purchase and a sale on file appear here. A profit is never
                estimated for a player whose move in or out is missing.
              </p>
            </div>
          )}

          <p className="border-t border-slate-200 pt-3 font-sans text-[10px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            The arrow is the direction of the move. Club names come from the save&apos;s own player records,
            which name every club in the world, so a deal with a club outside your division still reads
            properly. If one is ever missing, name it yourself and the row keeps your wording.
          </p>
        </div>
      )}
    </section>
  );
}

interface DealValues {
  careerId: string;
  direction: "IN" | "OUT";
  playerName: string;
  counterparty: string;
  fee: number;
  movedOn: string | null;
  season: number | null;
  note: string | null;
}

/** The one form. Small on purpose: a name, a direction, a fee, and whatever else is known. */
function AddDealForm({
  careerId,
  symbol,
  busy,
  onSubmit,
}: {
  careerId: string;
  symbol: string;
  busy: boolean;
  onSubmit: (values: DealValues) => Promise<void>;
}) {
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [playerName, setPlayerName] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [fee, setFee] = useState("");
  const [movedOn, setMovedOn] = useState("");
  const [note, setNote] = useState("");

  const parsedFee = fee.trim() === "" ? null : Math.round(Number(fee));
  const ready = playerName.trim() !== "" && parsedFee !== null && Number.isFinite(parsedFee) && parsedFee >= 0;

  return (
    <form
      className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void onSubmit({
          careerId,
          direction,
          playerName: playerName.trim(),
          counterparty: counterparty.trim(),
          fee: parsedFee as number,
          movedOn: movedOn.trim() === "" ? null : movedOn.trim(),
          season: movedOn.trim() === "" ? null : Number(movedOn.slice(0, 4)),
          note: note.trim() === "" ? null : note.trim(),
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {(["IN", "OUT"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDirection(option)}
            aria-pressed={direction === option}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 font-heading text-[10px] font-bold uppercase tracking-wider transition-colors ${
              direction === option
                ? "border-[#E11D48] bg-[#E11D48] text-white dark:border-[#FF8C7A] dark:bg-[#FF8C7A] dark:text-slate-950"
                : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
            }`}
          >
            {option === "IN" ? "Signed" : "Sold"}
          </button>
        ))}
        <span className="font-sans text-[10px] text-slate-500 dark:text-slate-400">
          A deal you recorded is badged as yours wherever it appears.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Player">
          <input
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Name as you know it"
            className={inputClass}
          />
        </Field>
        <Field label={direction === "IN" ? "Signed from" : "Sold to"}>
          <input
            value={counterparty}
            onChange={(event) => setCounterparty(event.target.value)}
            placeholder="Club"
            className={inputClass}
          />
        </Field>
        <Field label={`Fee (${symbol})`}>
          <input
            type="number"
            min={0}
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            placeholder="0 for a free"
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field label="Date (optional)">
          <input
            type="date"
            value={movedOn}
            onChange={(event) => setMovedOn(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Note (optional)">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add-ons, a swap, anything that explains the number"
          className={inputClass}
        />
      </Field>

      <button
        type="submit"
        disabled={!ready || busy}
        className="cursor-pointer rounded-lg bg-[#E11D48] px-4 py-2 font-heading text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
      >
        {busy ? "Recording…" : "Record the deal"}
      </button>
    </form>
  );
}

function LedgerRow({
  entry,
  symbol,
  busy,
  onRemove,
  onName,
}: {
  entry: LedgerEntry;
  symbol: string;
  busy: boolean;
  onRemove?: () => void;
  /** Saves the manager's own name for a club the save cannot name. Absent on a row already named. */
  onName?: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState(entry.counterparty ?? "");

  const counterpartyText = (() => {
    if (entry.counterparty) return entry.counterparty;
    if (entry.counterpartyTeamId !== null) return `club ${entry.counterpartyTeamId}`;
    return "a club the save does not name";
  })();

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Direction as an arrow rather than the words SIGNED and SOLD: the words were on every row and told
              the reader nothing the arrow does not, while the name beside it is different every time. */}
          <span
            title={entry.direction === "IN" ? "Arrived at the club" : "Left the club"}
            aria-label={entry.direction === "IN" ? "Arrived at the club" : "Left the club"}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${
              entry.direction === "IN"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
            }`}
          >
            {entry.direction === "IN" ? (
              <IconArrowIn className="h-3.5 w-3.5" />
            ) : (
              <IconArrowOut className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="font-sub text-xs font-bold text-slate-900 dark:text-slate-100">
            {entry.playerName}
          </span>
          <SourceTag source={entry.provenance} />
          {/* Only on a SAVED deal: a typed row is already badged as the manager's, and two identical
              badges beside each other read as a rendering fault. */}
          {entry.counterpartyFromManager && entry.provenance === "SAVE" ? <SourceTag source="USER" /> : null}
          {entry.pending ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              Not yet completed
            </span>
          ) : null}
        </div>

        <p className="mt-1 font-sans text-[11px] text-slate-600 dark:text-slate-400">
          {entry.direction === "IN" ? "from" : "to"} {counterpartyText}
          {/* Both dates, because they are different things: the day it was agreed and the day he moves. */}
          {entry.completedOn
            ? ` · moves ${deskDay(entry.completedOn)}${entry.agreedOn && entry.agreedOn !== entry.completedOn ? ` (agreed ${deskDay(entry.agreedOn)})` : ""}`
            : entry.agreedOn
              ? ` · ${deskDay(entry.agreedOn)}`
              : ""}
          {entry.note ? ` · ${entry.note}` : ""}
        </p>

        {onName && (entry.counterparty === null || entry.counterpartyFromManager) ? (
          naming ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onName(draft.trim());
                setNaming(false);
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setNaming(false);
                }}
                placeholder="Which club?"
                aria-label={`Name the club this ${entry.direction === "IN" ? "player came from" : "player went to"}`}
                className="w-52 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-sub text-[11px] text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={busy}
                className="cursor-pointer rounded-lg bg-[#E11D48] px-3 py-1.5 font-heading text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
              >
                Save name
              </button>
              <button
                type="button"
                onClick={() => setNaming(false)}
                className="cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              {entry.counterpartyFromManager ? (
                <span className="font-sans text-[10px] text-slate-400 dark:text-slate-500">
                  Clearing it puts the row back to the save&apos;s own number.
                </span>
              ) : null}
            </form>
          ) : (
            /* The save names no club outside this division, so the ledger asks rather than explaining. A name
               already given stays editable: a typo he cannot fix would be worse than no field at all. */
            <button
              type="button"
              onClick={() => {
                setDraft(entry.counterparty ?? "");
                setNaming(true);
              }}
              className="mt-1 cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-[#E11D48] hover:underline dark:text-[#FF8C7A]"
            >
              {entry.counterpartyFromManager ? "Change this name" : "Name this club"}
            </button>
          )
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-heading text-sm tabular-nums text-slate-900 dark:text-slate-100">
          {formatMoney(entry.fee, symbol)}
        </span>
        {onRemove && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/** A saved date as a short day. Mirrors the paper's own formatter so a date reads the same everywhere. */
function deskDay(value: string | null): string {
  if (!value) return "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(parts[3])} ${months[Number(parts[2]) - 1] ?? parts[2]} ${parts[1]}`;
}

export function FinanceRulesPanel({ careerId, symbol }: { careerId: string | null; symbol: string }) {
  const [report, setReport] = useState<FinanceRulesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!careerId) {
      setReport(null);
      return;
    }
    try {
      const response = await apiFetch(`/api/finance-rules?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        report?: FinanceRulesReport | null;
        error?: string;
      };
      if (payload.success) {
        setReport(payload.report ?? null);
        setError(null);
      } else {
        setError(payload.error ?? "Could not read the league rules.");
      }
    } catch {
      setError("Could not reach the rules service.");
    }
  }, [careerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!report) {
    return (
      <section
        data-tour="finance-rules"
        className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
      >
        <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
          League rules
        </h3>
        <p className="mt-2 font-sans text-xs text-slate-600 dark:text-slate-400">
          {error ?? "Checking the rules that apply to your division…"}
        </p>
      </section>
    );
  }

  const text = (verdict: RuleVerdict) => {
    if (verdict.limit === null) return "No fixed figure";
    if (verdict.unit === "PERCENT") return `${verdict.limit}%`;
    if (verdict.unit === "COUNT") return `${verdict.limit} players`;
    return formatMoney(verdict.limit, symbol);
  };

  const observed = (verdict: RuleVerdict) => {
    if (verdict.observed === null) return null;
    if (verdict.unit === "PERCENT") return `${verdict.observed}%`;
    if (verdict.unit === "COUNT") return `${verdict.observed}`;
    return formatMoney(verdict.observed, symbol);
  };

  // Three shapes, and the reading matters: a figure against a line, a figure with no line to sit against,
  // and a line with nothing to measure. "of no fixed figure" would be the fourth and it means nothing.
  const comparison = (verdict: RuleVerdict) => {
    const seen = observed(verdict);
    if (seen === null) return `line ${text(verdict)}`;
    if (verdict.limit === null) return `${seen}, no line set`;
    return `${seen} of ${text(verdict)}`;
  };

  return (
    <section
      data-tour="finance-rules"
      className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            <IconAlert className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            League rules
          </h3>
          <p className="mt-1 max-w-2xl font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
            {report.divisionName ?? "Your division"} · {report.coverageNote}{" "}
            {report.enforced
              ? "Your realism level is strict, so each line below is checked and judged."
              : "These are listed as context. Set strict realism to have them judged."}
          </p>
        </div>
        <span
          className={`rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider ${
            report.enforced
              ? "border-[#E11D48]/40 bg-[#E11D48]/5 text-[#E11D48] dark:border-[#FF8C7A]/40 dark:bg-[#FF8C7A]/10 dark:text-[#FF8C7A]"
              : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
          }`}
        >
          {report.enforced ? "Checks on" : "Reference only"}
        </span>
      </div>

      {report.verdicts.length === 0 ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
          No rule applies to this division in the reference data. Nothing is claimed rather than
          something being guessed.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {report.verdicts.map((verdict) => (
            <li
              key={verdict.ruleId}
              className="rounded-xl border border-slate-200/70 p-3.5 dark:border-slate-800/70"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-sub text-xs font-bold text-slate-900 dark:text-slate-100">
                    {verdict.label}
                  </span>
                  <span className="font-sub text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {verdict.basis}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-sub text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    {comparison(verdict)}
                  </span>
                  {report.enforced ? (
                    <StatusPill status={verdict.status} />
                  ) : (
                    <span className="rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Reference
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1.5 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                {verdict.note}
              </p>
              <p className="mt-1 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {verdict.detail}
              </p>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        {report.notes.map((note) => (
          <li
            key={note}
            className="font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400"
          >
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_STYLES: Record<RuleStatus, string> = {
  OK: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  OVER: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  REFERENCE_ONLY: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  NO_DATA: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const STATUS_LABELS: Record<RuleStatus, string> = {
  OK: "Inside",
  OVER: "Over",
  REFERENCE_ONLY: "Reference",
  NO_DATA: "No data",
};

function StatusPill({ status }: { status: RuleStatus }) {
  const Icon = status === "OK" ? IconCheck : status === "OVER" ? IconAlert : IconTrend;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[status]}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Where a line came from, in one word. Kept local so the ledger never borrows the finance card's badge. */
function SourceTag({ source }: { source: "SAVE" | "USER" }) {
  const Icon = source === "SAVE" ? IconCheck : IconUserEntry;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${
        source === "SAVE"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
      }`}
    >
      <Icon className="h-2.5 w-2.5" />
      {source === "SAVE" ? "Save" : "You entered"}
    </span>
  );
}

function LedgerStat({
  label,
  value,
  exact,
  tone,
}: {
  label: string;
  value: string;
  exact?: string;
  tone?: "ok" | "over";
}) {
  return (
    <div
      title={exact}
      className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-800/70 dark:bg-slate-950/50"
    >
      <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <p
        className={`mt-1 font-heading text-base tabular-nums ${
          tone === "over"
            ? "text-rose-600 dark:text-rose-400"
            : tone === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-sub text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`pb-2 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  tone,
}: {
  children: React.ReactNode;
  align?: "right";
  tone?: "over";
}) {
  return (
    <td
      className={`py-2 font-sub text-[11px] tabular-nums ${
        align === "right" ? "text-right" : "text-left"
      } ${tone === "over" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-200"}`}
    >
      {children}
    </td>
  );
}
