"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { AdvisoryLevel, EstimateProvenance, FinanceReport } from "@/lib/services/finance-service";
import { formatMoney, formatMoneyExact, currencySymbolFor } from "@/lib/ui/format";
import {
  IconAlert,
  IconCheck,
  IconPlus,
  IconTrend,
  IconUserEntry,
  IconWallet,
} from "@/components/ui/icons";

import { apiFetch } from "@/lib/platform/api-client";
/**
 * The Finances screen.
 *
 * The rule this page is built on: a figure is either something the save says, something Touchline
 * worked out and can explain, or something the manager typed in. Every card states which.
 *
 * The two budgets deserve a note. Neither is stored in the save file, so there
 * is no fact to read and no honest way to derive one - a card that only complains about that is an
 * apology, not information. They are inputs instead: type the number and the card becomes real.
 */
export function FinanceView({ careerId }: { careerId: string | null }) {
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!careerId) {
      setReport(null);
      setLoading(false);
      return;
    }
    try {
      const response = await apiFetch(`/api/finance?careerId=${encodeURIComponent(careerId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        report?: FinanceReport | null;
        error?: string;
      };
      if (payload.success) {
        setReport(payload.report ?? null);
        setError(null);
      } else {
        setError(payload.error ?? "Could not build the finance report.");
      }
    } catch {
      setError("Could not reach the finance service.");
    } finally {
      setLoading(false);
    }
  }, [careerId]);

  // Deferred by a tick: setState must not run synchronously inside an effect body.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const saveAmount = useCallback(
    async (field: "transferBudget" | "wageBudget", value: number | null) => {
      if (!careerId) return;
      setSaving(true);
      try {
        const response = await apiFetch("/api/finance", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ careerId, [field]: value }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          report?: FinanceReport;
          error?: string;
        };
        if (payload.success && payload.report) {
          setReport(payload.report);
          setError(null);
        } else {
          setError(payload.error ?? "Could not save that figure.");
        }
      } catch {
        setError("Could not reach the finance service.");
      } finally {
        setSaving(false);
      }
    },
    [careerId]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400">
          Building the finance picture…
        </p>
      </div>
    );
  }

  if (!careerId || !report) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Header report={null} />
        {error && <ErrorBanner message={error} />}
        <p className="rounded-2xl border border-slate-200 bg-white p-6 font-sans text-xs text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Sync a career from the Portal and its wage bill, contract commitments and the money the save
          records will appear here.
        </p>
      </div>
    );
  }

  const symbol = currencySymbolFor(report.currency);
  const exact = (value: number | null | undefined) =>
    value === null || value === undefined ? undefined : formatMoneyExact(value, symbol);
  const percent = (value: number | null) => (value === null ? null : `${Math.round(value * 100)}%`);

  const wagePrimary =
    report.wageFormat === "ANNUAL"
      ? { label: "Wage bill · season", value: report.squadAnnualWage }
      : { label: "Wage bill · week", value: report.squadWeeklyWage };
  const wageOther =
    report.wageFormat === "ANNUAL"
      ? { label: "week", value: report.squadWeeklyWage }
      : { label: "season", value: report.squadAnnualWage };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div data-tour="finance-summary">
        <Header report={report} />
      </div>

      {error && <ErrorBanner message={error} />}

      {report.wageTurnoverAdvisory && <AdvisoryCallout advisory={report.wageTurnoverAdvisory} />}

      <section data-tour="finance-budgets" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetCard
          label="Transfer budget"
          value={report.transferBudget}
          source={report.transferBudgetSource}
          symbol={symbol}
          pending={saving}
          onSave={(value) => void saveAmount("transferBudget", value)}
          note="Not stored in the save file, so there is nothing here to read. Enter it and it becomes a figure you set."
        />
        <BudgetCard
          label="Wage budget"
          value={report.wageBudget}
          source={report.wageBudgetSource}
          symbol={symbol}
          pending={saving}
          onSave={(value) => void saveAmount("wageBudget", value)}
          note="Set it yourself if remembering the number matters more than keeping it empty. It is yours, and TouchlineOS never revises it."
        />
        <FigureCard
          icon={<IconWallet className="h-4 w-4" />}
          label="Total earnings"
          value={moneyText(report.totalEarnings, symbol)}
          exact={exact(report.totalEarnings)}
          provenance="SAVE"
        />
        <FigureCard
          icon={<IconTrend className="h-4 w-4" />}
          label={wagePrimary.label}
          value={moneyText(wagePrimary.value, symbol)}
          exact={exact(wagePrimary.value)}
          provenance="DERIVED_ESTIMATE"
          note={`Summed across every decoded player · ${formatMoney(wageOther.value, symbol)} a ${wageOther.label}.`}
        />
      </section>

      <section data-tour="finance-figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FigureCard
          icon={<IconTrend className="h-4 w-4" />}
          label="Est. tier revenue"
          value={moneyText(report.estimatedTierRevenue, symbol)}
          exact={exact(report.estimatedTierRevenue)}
          provenance="DERIVED_ESTIMATE"
          note="A TouchlineOS benchmark for this division, not a save figure. It exists so wage-to-turnover has a denominator."
        />
        <FigureCard
          icon={<IconTrend className="h-4 w-4" />}
          label="Wage to turnover"
          value={percent(report.wageToTurnover) ?? "Not computable"}
          unknown={report.wageToTurnover === null}
          provenance="DERIVED_ESTIMATE"
          note={report.realismMode === "STRICT" ? "Against the 65% advisory line your strict realism level sets." : "Against the 85% advisory line your realism level sets."}
        />
        <FigureCard
          icon={<IconWallet className="h-4 w-4" />}
          label="Record buy"
          value={moneyText(report.recordBuy, symbol)}
          exact={exact(report.recordBuy)}
          provenance="SAVE"
          note="Your biggest fee paid, as the save records it."
        />
        <FigureCard
          icon={<IconWallet className="h-4 w-4" />}
          label="Record sale"
          value={moneyText(report.recordSale, symbol)}
          exact={exact(report.recordSale)}
          provenance="SAVE"
          note="Your biggest fee received, as the save records it."
        />
      </section>

      <section data-tour="finance-contract" className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100">
            <IconWallet className="h-4 w-4 text-[#E11D48] dark:text-[#FF8C7A]" />
            Contract commitment
          </h3>
          <ProvenanceBadge provenance="DERIVED_ESTIMATE" />
        </div>

        {report.contractLiability.length === 0 ? (
          <p className="font-sans text-xs text-slate-600 dark:text-slate-300">
            No contract end dates are decoded for this squad, so no forward commitment can be
            projected.
          </p>
        ) : (
          <>
            {/* Internal scroll: a long commitment list can never stretch the page. */}
            <ul className="max-h-[280px] space-y-3 overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
              {report.contractLiability.map((row) => {
                const share = report.estimatedTierRevenue
                  ? row.committedAnnualWage / report.estimatedTierRevenue
                  : null;
                return (
                  <li key={row.season} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-heading text-xs uppercase tracking-wide text-slate-900 dark:text-slate-100">
                        {row.seasonLabel}
                      </span>
                      <span className="font-sub text-xs text-slate-600 tabular-nums dark:text-slate-300">
                        {formatMoney(row.committedAnnualWage, symbol)} · {row.playersUnderContract}{" "}
                        {row.playersUnderContract === 1 ? "player" : "players"}
                        {share !== null ? ` · ${Math.round(share * 100)}% of est. revenue` : ""}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-[#E11D48] dark:bg-[#FF8C7A]"
                        style={{ width: `${Math.min(100, share !== null ? share * 100 : 0)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {report.nextSeasonLiabilityToTurnover !== null && (
              <p className="mt-4 border-t border-slate-200 pt-3 font-sans text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-400">
                Next season&apos;s committed wage is{" "}
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {percent(report.nextSeasonLiabilityToTurnover)}
                </span>{" "}
                of the tier revenue estimate. Only players whose contract end dates are decoded are
                counted, so this is a floor rather than the full bill.
              </p>
            )}
          </>
        )}
      </section>

      <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
        <ProvenanceRow
          provenance="SAVE"
          text="Read straight from the save file, untouched. Nothing derived can rewrite these."
        />
        <ProvenanceRow
          provenance="USER"
          text="A figure you entered yourself, because the save does not carry it."
        />
        <ProvenanceRow
          provenance="DERIVED_ESTIMATE"
          text="Worked out by TouchlineOS from save facts plus the model noted on the card. Advisory only, and it never writes back."
        />
      </div>
    </div>
  );
}

/** Money, or the honest phrase when the save carries nothing. A blank is never rendered as zero. */
function moneyText(value: number | null | undefined, symbol: string): string {
  return value === null || value === undefined ? "Not in the save" : formatMoney(value, symbol);
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 font-sub text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
      {message}
    </p>
  );
}

function Header({ report }: { report: FinanceReport | null }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
      <span className="text-xs font-sub font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
        Money
      </span>
      <h1 className="font-heading text-2xl uppercase tracking-wide text-slate-900 dark:text-slate-100">
        Finances
      </h1>
      <p className="mt-1 max-w-2xl font-sans text-xs text-slate-600 dark:text-slate-400">
        Every figure below is labelled with where it came from. Where the save carries nothing, you
        can state it yourself.
      </p>

      {report && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip label={report.tierLabel ?? "Division unrecorded"} />
          <Chip
            label={`${report.currency} · ${report.wageFormat === "ANNUAL" ? "annual" : "weekly"} wages`}
          />
          <Chip
            label={report.realismMode === "STRICT" ? "Strict realism" : "Relaxed realism"}
            tone={report.realismMode === "STRICT" ? "warn" : "neutral"}
          />
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={`rounded-lg border px-2.5 py-1 font-sub text-[10px] font-bold uppercase tracking-wider ${
        tone === "warn"
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
      }`}
    >
      {label}
    </span>
  );
}

const ADVISORY_STYLES: Record<AdvisoryLevel, string> = {
  OK: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300",
  WATCH:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300",
  OVER: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300",
};

function AdvisoryCallout({
  advisory,
}: {
  advisory: NonNullable<FinanceReport["wageTurnoverAdvisory"]>;
}) {
  const Icon = advisory.level === "OK" ? IconCheck : IconAlert;
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-5 ${ADVISORY_STYLES[advisory.level]}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="space-y-1">
        <p className="font-heading text-xs uppercase tracking-wider">{advisory.headline}</p>
        <p className="font-sans text-xs leading-relaxed opacity-90">{advisory.detail}</p>
      </div>
    </div>
  );
}

/**
 * A budget the save does not carry.
 *
 * Unset, it invites a figure; set, it becomes a normal card carrying a "you entered this" badge. The
 * draft lives inside this component so typing in one card cannot re-render the other.
 */
function BudgetCard({
  label,
  value,
  source,
  symbol,
  pending,
  note,
  onSave,
}: {
  label: string;
  value: number | null;
  source: "SAVE" | "USER" | null;
  symbol: string;
  pending: boolean;
  note: string;
  onSave: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Math.round(Number(trimmed));
    onSave(parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col rounded-2xl border border-[#E11D48]/40 bg-white p-4 shadow-sm dark:border-[#FF8C7A]/40 dark:bg-slate-900">
        <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <input
          type="number"
          min={0}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setEditing(false);
          }}
          placeholder={symbol}
          aria-label={`${label} in ${symbol}`}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <p className="mt-1.5 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          Leave it blank to clear. Enter 0 if you genuinely have nothing.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={commit}
            disabled={pending}
            className="flex-1 cursor-pointer rounded-lg bg-[#E11D48] px-3 py-2 font-heading text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#c4173d] disabled:opacity-50 dark:bg-[#FF8C7A] dark:text-slate-950"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(value === null ? "" : String(value));
              setEditing(false);
            }}
            className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 font-heading text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const unset = value === null;

  return (
    <div
      className={`flex flex-col rounded-2xl border p-4 shadow-sm transition-colors ${
        unset
          ? "border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/60"
          : "border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-slate-400">
        <IconWallet className="h-4 w-4" />
        <span className="font-sub text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p
        className={`font-heading text-lg tabular-nums ${
          unset ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {unset ? "Not in the save" : formatMoney(value, symbol)}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {source && <ProvenanceBadge provenance={source} />}
        <button
          type="button"
          onClick={() => {
            setDraft(unset ? "" : String(value));
            setEditing(true);
          }}
          className="inline-flex cursor-pointer items-center gap-1 font-sub text-[10px] font-bold uppercase tracking-wider text-[#E11D48] hover:underline dark:text-[#FF8C7A]"
        >
          <IconPlus className="h-3 w-3" />
          {unset ? "Set it" : "Change"}
        </button>
      </div>
      <p className="mt-2 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        {note}
      </p>
    </div>
  );
}

function FigureCard({
  icon,
  label,
  value,
  exact,
  unknown = false,
  provenance,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  exact?: string;
  unknown?: boolean;
  provenance: EstimateProvenance;
  note?: string;
}) {
  return (
    <div
      title={exact}
      className={`flex flex-col rounded-2xl border p-4 shadow-sm transition-colors ${
        unknown
          ? "border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/60"
          : "border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-slate-400">
        {icon}
        <span className="font-sub text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p
        className={`font-heading text-lg tabular-nums ${
          unknown ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </p>
      <div className="mt-2">
        <ProvenanceBadge provenance={provenance} />
      </div>
      {note && (
        <p className="mt-2 font-sans text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          {note}
        </p>
      )}
    </div>
  );
}

const PROVENANCE_STYLES: Record<EstimateProvenance, string> = {
  SAVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  USER: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  DERIVED_ESTIMATE: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function ProvenanceBadge({ provenance }: { provenance: EstimateProvenance }) {
  const Icon =
    provenance === "SAVE" ? IconCheck : provenance === "USER" ? IconUserEntry : IconTrend;
  const label =
    provenance === "SAVE" ? "Save" : provenance === "USER" ? "You entered" : "Derived estimate";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sub text-[9px] font-bold uppercase tracking-wider ${PROVENANCE_STYLES[provenance]}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function ProvenanceRow({ provenance, text }: { provenance: EstimateProvenance; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">
        <ProvenanceBadge provenance={provenance} />
      </span>
      <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}
