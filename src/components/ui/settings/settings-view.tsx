"use client";

import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AI_PROVIDERS,
  AppSettingsPatch,
  CURRENCY_SYMBOLS,
  ClientAppSettings,
  DEBRIEF_FREQUENCIES,
  labelFor,
  REALISM_HINTS,
  REALISM_LEVELS,
  SYNC_TRIGGERS,
  WAGE_FORMATS,
} from "@/lib/settings-vocabulary";
import { PLAYSTYLE_DEFINITIONS, PLAYSTYLES } from "@/lib/playstyles";
import { ThemeMode } from "@/lib/session";
import {
  countUnseen,
  getSeenSnapshot,
  markSeen,
  seenForCareer,
  subscribeSeen,
} from "@/lib/session";
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import { SubTabs, type SubTabOption } from "@/components/ui/sub-tabs";
import { CareerTimeline } from "@/components/ui/settings/career-timeline";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Mirrors GET /api/diagnostics. Kept local so the client never imports the database layer. */
export interface Diagnostics {
  activeCareer: {
    careerId: string;
    clubName: string;
    managerName: string;
    currentSeason: number;
    inGameDate: string | null;
    updatedAt: string;
  } | null;
  database: { path: string; exists: boolean; sizeBytes: number | null };
  counts: {
    careers: number;
    snapshots: number;
    playerSnapshots: number;
    careerEvents: number;
    players: number;
    latestSnapshotNumber: number | null;
  };
  careers: Array<{
    careerId: string;
    clubName: string;
    managerName: string;
    currentSeason: number;
    updatedAt: string;
    snapshotCount: number;
  }>;
  exportsDirectory: string;
}

interface SettingsViewProps {
  settings: ClientAppSettings | null;
  settingsError: string | null;
  savingField: string | null;
  diagnostics: Diagnostics | null;
  diagnosticsError: string | null;
  themeMode: ThemeMode;
  /** The career timeline feed. It lives inside Settings rather than owning a top-level tab. */
  timeline: ParsedCareerEvent[];
  onUpdateSetting: (field: string, patch: AppSettingsPatch) => void;
  onSetTheme: (mode: ThemeMode) => void;
  onRefreshDiagnostics: () => void;
  onExport: () => Promise<ActionResult>;
  /**
   * Applies a backup file the manager chose.
   *
   * Takes the file's text rather than a path: the local build could read a path, but a page cannot,
   * and the same handler serves both.
   */
  onImport: (contents: string) => Promise<ActionResult>;
  onResetCareer: () => Promise<ActionResult>;
}

type SettingsSubTab = "PREFERENCES" | "TIMELINE";

/** Only shown once there is something new, so the badge never reads as decoration. */
function settingsSubTabs(unseenTimeline: number): ReadonlyArray<SubTabOption<SettingsSubTab>> {
  return [
    { id: "PREFERENCES", label: "Preferences" },
    {
      id: "TIMELINE",
      label: "Career Timeline",
      badge: unseenTimeline > 0 ? `${unseenTimeline} new` : undefined,
    },
  ];
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl">
      <h3 className="font-heading text-sm uppercase tracking-wider text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-3">
        {title}
      </h3>
      {description && (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400 mt-3">{description}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** A segmented control - clearer than a select for 2-3 mutually exclusive options. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  name,
}: {
  value: T | undefined;
  options: readonly T[];
  onChange: (next: T) => void;
  disabled?: boolean;
  name: string;
}) {
  // `flex w-full` rather than `inline-flex`. With `inline-flex` the group sized itself to max-content,
  // which made IT the widest thing on the page - so at narrow widths it pushed the whole card wider
  // than the viewport and the segments leaked off the edge of the screen. `flex-wrap` never fired,
  // because a flex container that sizes to its content has nothing to wrap against. Taking the full
  // width of its column gives it a real edge to wrap at, and `min-w-0` on the Field's control column
  // lets that column shrink. The explanation lives here rather than beside the attribute: a JSX
  // `{/* */}` comment is not legal between the attributes of an opening tag, which is what broke this
  // file the first time it was written.
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex w-full min-w-0 flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`max-w-full whitespace-normal text-center px-3 py-1.5 rounded-lg font-sub text-[11px] font-bold uppercase cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-[#E11D48] text-white"
                : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  saving,
  children,
}: {
  label: string;
  hint?: string;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-[12rem] flex-1">
        <span className="block font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          {label}
          {saving && (
            <span className="ml-2 font-normal normal-case text-[#E11D48] dark:text-[#FF8C7A]">
              saving…
            </span>
          )}
        </span>
        {hint && (
          <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
        )}
      </div>
      {/* `min-w-0` and deliberately NOT `shrink-0`.
          The control used to refuse to shrink, which made it the widest thing on the page: at narrow
          widths it pushed the whole card past the viewport edge and the segments leaked off screen.
          A control that cannot shrink cannot wrap either, so `flex-wrap` on the group never fired. */}
      <div className="min-w-0 max-w-full">{children}</div>
    </div>
  );
}

export function SettingsView({
  settings,
  settingsError,
  savingField,
  diagnostics,
  diagnosticsError,
  themeMode,
  timeline,
  onUpdateSetting,
  onSetTheme,
  onRefreshDiagnostics,
  onExport,
  onImport,
  onResetCareer,
}: SettingsViewProps) {
  const [subTab, setSubTab] = useState<SettingsSubTab>("PREFERENCES");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"export" | "import" | "reset" | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const importInput = React.useRef<HTMLInputElement>(null);

  const activeCareerId = diagnostics?.activeCareer?.careerId ?? null;
  const canReset = activeCareerId !== null && confirmText === activeCareerId && busy === null;

  // ---------------------------------------------------------------------------
  // The timeline badge counts what has arrived since the manager last opened the tab. Like a
  // notification, opening it is what clears it - deferred a tick so the count is still on screen
  // for the click that opened it rather than vanishing under the cursor.
  // ---------------------------------------------------------------------------
  const seenRaw = useSyncExternalStore(subscribeSeen, getSeenSnapshot, () => null);
  const seenAt = useMemo(() => seenForCareer(seenRaw, activeCareerId), [seenRaw, activeCareerId]);
  const unseenTimeline = useMemo(
    () => countUnseen(timeline.map((event) => event.timestamp), seenAt.TIMELINE),
    [timeline, seenAt.TIMELINE]
  );
  const subTabs = useMemo(() => settingsSubTabs(unseenTimeline), [unseenTimeline]);

  useEffect(() => {
    if (subTab !== "TIMELINE") return;
    const timer = window.setTimeout(() => markSeen(activeCareerId, "TIMELINE"), 0);
    return () => window.clearTimeout(timer);
  }, [subTab, activeCareerId]);

  const runExport = async () => {
    setBusy("export");
    setResult(null);
    try {
      setResult(await onExport());
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (file: File) => {
    setBusy("import");
    setResult(null);
    try {
      // Read as text here rather than streaming the file: the whole package is parsed in one go on
      // either runtime, and a page has no path to hand over instead.
      setResult(await onImport(await file.text()));
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message ?? "Could not read that file." });
    } finally {
      setBusy(null);
      // Cleared so choosing the same file twice still fires a change event.
      if (importInput.current) importInput.current.value = "";
    }
  };

  const runReset = async () => {
    setBusy("reset");
    setResult(null);
    try {
      setResult(await onResetCareer());
      setConfirmText("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl">
        <span className="text-xs font-sub font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A]">
          System Configuration
        </span>
        <h2 className="font-heading text-lg text-slate-900 dark:text-slate-100 uppercase mt-0.5">
          Settings
        </h2>
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400 mt-1">
          Every value here is stored with <span className="font-bold">USER</span> provenance. Changes
          save immediately.
        </p>
      </div>

      <SubTabs tabs={subTabs} active={subTab} onChange={setSubTab} />

      {settingsError && (
        <p className="rounded-xl border border-rose-300 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 font-sub text-xs text-rose-700 dark:text-rose-300">
          {settingsError}
        </p>
      )}

      {subTab === "TIMELINE" ? (
        <CareerTimeline events={timeline} />
      ) : !settings ? (
        <p className="font-sans text-xs text-slate-600 dark:text-slate-400">Loading settings…</p>
      ) : (
        <>
          <Section
            title="Appearance"
            description="System follows your operating system until you pick a theme yourself."
          >
            <Field label="Theme">
              <Segmented
                name="Theme"
                value={themeMode}
                options={["light", "dark", "system"] as const}
                onChange={(next) => onSetTheme(next)}
              />
            </Field>
          </Section>

          <Section
            title="Sync Behaviour"
            description="Controls whether the entry screen syncs your save automatically when you open the app."
          >
            <Field
              label="On launch"
              hint="Prompt on launch syncs the newest save as soon as you enter. Manual only waits for you."
              saving={savingField === "syncTrigger"}
            >
              <Segmented
                name="Sync on launch"
                value={settings.syncTrigger}
                options={SYNC_TRIGGERS}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("syncTrigger", { syncTrigger: next })}
              />
            </Field>
          </Section>

          <Section
            title="Debrief"
            description="How often you want to be asked for a post-match debrief."
          >
            <Field
              label="Frequency"
              hint="Recorded now, but nothing acts on it yet — the automatic prompt is future work, so this will not change today's behaviour."
              saving={savingField === "debriefFrequency"}
            >
              <select
                value={settings.debriefFrequency}
                disabled={savingField !== null}
                onChange={(e) =>
                  onUpdateSetting("debriefFrequency", {
                    debriefFrequency: e.target.value as ClientAppSettings["debriefFrequency"],
                  })
                }
                className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 p-2.5 rounded-xl focus:outline-none focus:border-[#E11D48] cursor-pointer font-sub"
              >
                {DEBRIEF_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {labelFor(value)}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Career & Display">
            <Field label="Realism level" saving={savingField === "realismLevel"}>
              <Segmented
                name="Realism level"
                value={settings.realismLevel}
                options={REALISM_LEVELS}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("realismLevel", { realismLevel: next })}
              />
              <p className="mt-2 max-w-full font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {/* Falls back to NORMAL rather than rendering nothing: a client holding a value from
                    before the ladder was collapsed would otherwise show an empty paragraph. */}
                {REALISM_HINTS[settings.realismLevel] ?? REALISM_HINTS.NORMAL}
              </p>
            </Field>

            <Field label="Manager playstyle" saving={savingField === "playstyle"}>
              <Segmented
                name="Manager playstyle"
                value={settings.playstyle}
                options={PLAYSTYLES}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("playstyle", { playstyle: next })}
              />
              <p className="mt-2 max-w-full font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {PLAYSTYLE_DEFINITIONS[settings.playstyle]?.hint ?? PLAYSTYLE_DEFINITIONS.OWN.hint}
              </p>
            </Field>

            <Field label="Currency" saving={savingField === "currencySymbol"}>
              <Segmented
                name="Currency"
                value={settings.currencySymbol}
                options={CURRENCY_SYMBOLS}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("currencySymbol", { currencySymbol: next })}
              />
            </Field>

            <Field label="Wage display" saving={savingField === "wageFormat"}>
              <Segmented
                name="Wage display"
                value={settings.wageFormat}
                options={WAGE_FORMATS}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("wageFormat", { wageFormat: next })}
              />
            </Field>
          </Section>

          <Section
            title="Advanced — AI (not yet available)"
            description="AI is not in this build yet. It only arrives once the rules-based advice works well without it, so these settings are saved but do nothing for now."
          >
            <Field label="Provider" saving={savingField === "aiProvider"}>
              <Segmented
                name="AI provider"
                value={settings.aiProvider}
                options={AI_PROVIDERS}
                disabled={savingField !== null}
                onChange={(next) => onUpdateSetting("aiProvider", { aiProvider: next })}
              />
            </Field>
            <Field
              label="API key"
              hint={
                settings.aiApiKeyConfigured
                  ? "A key is stored. It is never sent back to the browser."
                  : "No key stored."
              }
            >
              <span className="font-sub text-[11px] uppercase text-slate-500 dark:text-slate-400">
                {settings.aiApiKeyConfigured ? "Configured" : "Not configured"}
              </span>
            </Field>
          </Section>

          <Section
            title="Data Management"
            description="What is actually stored on disk, and the tools to take a copy or clear it."
          >
            <div className="flex items-center justify-between">
              <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Storage
              </span>
              <button
                type="button"
                onClick={onRefreshDiagnostics}
                className="font-sub text-[10px] font-bold uppercase text-[#E11D48] dark:text-[#FF8C7A] hover:underline cursor-pointer"
              >
                Refresh
              </button>
            </div>

            {diagnosticsError && (
              <p className="font-sub text-xs text-rose-600 dark:text-rose-400">{diagnosticsError}</p>
            )}

            {diagnostics ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 font-sans text-xs">
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Active career</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 truncate">
                    {diagnostics.activeCareer?.careerId ?? "none"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Snapshots</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {diagnostics.counts.snapshots}
                    {diagnostics.counts.latestSnapshotNumber !== null &&
                      ` · latest #${diagnostics.counts.latestSnapshotNumber}`}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Database size</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatBytes(diagnostics.database.sizeBytes)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Timeline events</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {diagnostics.counts.careerEvents}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Player rows</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {diagnostics.counts.players}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400">Snapshot rows</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {diagnostics.counts.playerSnapshots}
                  </dd>
                </div>
                <div className="sm:col-span-2 font-mono text-[10px] text-slate-500 dark:text-slate-400 break-all">
                  {diagnostics.database.path}
                </div>
              </dl>
            ) : (
              <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                Reading storage details…
              </p>
            )}

            <Field
              label="Snapshot retention"
              hint="Snapshot pruning is not implemented, so every snapshot is kept forever. This cannot be changed here — lowering it would delete history, which the immutable-snapshot guarantee forbids."
            >
              <span className="font-sub text-[11px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                Keep everything
              </span>
            </Field>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void runExport()}
                disabled={busy !== null || activeCareerId === null}
                className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-sub text-[11px] font-bold uppercase cursor-pointer transition-colors hover:bg-[#E11D48] dark:hover:bg-[#FF8C7A] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "export" ? "Exporting…" : "Export career to JSON"}
              </button>
              <button
                type="button"
                onClick={() => importInput.current?.click()}
                disabled={busy !== null}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-sub text-[11px] font-bold uppercase cursor-pointer transition-colors hover:border-[#E11D48] hover:text-[#E11D48] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "import" ? "Importing…" : "Import career from JSON"}
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void runImport(file);
                }}
              />
            </div>

            <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
              Export writes a full backup to{" "}
              <span className="font-mono">
                {diagnostics?.exportsDirectory ?? "a file this browser downloads"}
              </span>
              . Always export before resetting.
            </p>

            <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
              Import reads one of those files and rebuilds that career here — every table it owns,
              one-way and one-time, with nothing moving on its own. If the same career is already
              here it is replaced outright, so what you end up with is exactly what you exported.
            </p>
          </Section>

          <Section
            title="Reset Career Data"
            description="Permanently deletes the active career and everything that belongs to it — every snapshot, squad note, timeline event, storyline, scouting target, finance record and league table. There is no undo."
          >
            <label className="block font-sub text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Type{" "}
              <span className="font-mono text-[#E11D48] dark:text-[#FF8C7A]">
                {activeCareerId ?? "career id"}
              </span>{" "}
              to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={activeCareerId ?? ""}
              disabled={activeCareerId === null}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#E11D48] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void runReset()}
              disabled={!canReset}
              className="w-full px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-heading text-xs font-bold uppercase cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === "reset" ? "Resetting…" : "Permanently reset career data"}
            </button>
          </Section>
        </>
      )}

      {result && subTab === "PREFERENCES" && (
        <p
          className={`rounded-xl border px-4 py-3 font-sub text-xs ${
            result.ok
              ? "border-emerald-300 dark:border-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-rose-300 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
