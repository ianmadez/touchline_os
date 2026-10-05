"use client";

import React, { useState } from "react";
import type { BridgeState } from "@/lib/platform/types";

/**
 * The optional local bridge, as one control the manager can see and end.
 *
 * Shown in the two places a save gets chosen - the landing page and the wizard's save step - so the copy
 * and the behaviour cannot drift between them. The same reasoning that produced one storyline composer
 * rather than two.
 *
 * ## Why it is visible rather than silent
 *
 * A paired bridge that ran invisibly forever would be the wrong kind of invisible. The goal was never
 * "no visibility into what is connected", it was "no repeated prompts" - so the connected state is
 * stated, and it can be ended from here. That mirrors the save-permission work, where the app says what
 * it is doing rather than deciding on the manager's behalf.
 *
 * ## Why "not running" is said out loud
 *
 * Falling back to the file picker without a word, when the manager believes they are paired, is a real
 * trust cost: the picker reappears for no stated reason and they cannot tell whether pairing broke or
 * something else did. One honest line, with the picker still working, costs nothing and answers it.
 */
interface BridgePanelProps {
  state: BridgeState;
  onPair: (code: string) => void;
  onDisconnect: () => void;
  /** True while a pairing attempt is in flight. */
  busy?: boolean;
  /** Why the last attempt failed, straight from the operation. */
  error?: string | null;
}

/** Where the download lives. Served statically by both builds. */
const DOWNLOAD_HREF = "/bridge/touchline-bridge.zip";

export function BridgePanel({
  state,
  onPair,
  onDisconnect,
  busy = false,
  error = null,
}: BridgePanelProps) {
  const [code, setCode] = useState("");

  // The desktop build has no bridge and needs none - it already scans this machine directly. Hiding the
  // feature is the honest answer; offering a control that could never work is not.
  if (state === "unsupported") return null;

  const card =
    "py-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 text-left";
  const label =
    "font-sub text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200";
  const body = "font-sans text-xs text-slate-600 dark:text-slate-300 leading-relaxed";
  const primary =
    "px-3 py-1.5 rounded-lg bg-[#E11D48] hover:bg-[#FF8C7A] font-sub text-[11px] font-bold uppercase tracking-wider text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const secondary =
    "px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-sub text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors cursor-pointer";

  // ---------------------------------------------------------------- paired
  if (state === "paired") {
    return (
      <div className={card}>
        <div className="flex items-center justify-between gap-3">
          <span className={label}>Connected to your local bridge</span>
          <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            ● Automatic
          </span>
        </div>
        <p className={body}>
          TouchlineOS is reading your save from the bridge, so there is no file to pick and nothing to
          confirm. Your career syncs itself whenever you open the app.
        </p>
        <p className={body}>
          This works while the bridge window is open. If you close it, the site goes back to asking for
          your save file — nothing breaks, and your career is untouched either way.
        </p>
        <button onClick={onDisconnect} disabled={busy} className={secondary}>
          {busy ? "Disconnecting…" : "Disconnect the bridge"}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------- enabled, but not answering
  if (state === "unreachable") {
    return (
      <div className={card}>
        <span className={label}>Your local bridge isn&rsquo;t running</span>
        <p className={body}>
          It was paired, but nothing is answering on its port now. Start{" "}
          <code className="font-mono text-[10px] text-slate-900 dark:text-slate-100">
            TouchlineBridge.cmd
          </code>{" "}
          again and this will reconnect on its own, or just pick your save file above instead.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={DOWNLOAD_HREF} className={secondary} download>
            Download the bridge
          </a>
          <button onClick={onDisconnect} disabled={busy} className={secondary}>
            {busy ? "Disconnecting…" : "Stop using it"}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- offer, and pairing
  const needsCode = state === "needs-code";

  return (
    <div className={card}>
      <span className={label}>
        {needsCode ? "Your bridge is running — enter its code" : "Prefer to stop picking your save file?"}
      </span>

      <p className={body}>
        {needsCode ? (
          <>
            The bridge is up, but it has not been paired with this browser yet. Paste the pairing code
            from the bridge window below.
          </>
        ) : (
          <>
            TouchlineOS normally has to ask for your save file, and browsers make it ask again. A small
            optional helper removes that: run it once, pair it once, and every visit syncs on its own.
            It works in every browser, including Firefox and Safari. Entirely optional — everything works
            without it.
          </>
        )}
      </p>

      {!needsCode && (
        <p className={body}>
          You will need Node.js, which is the only requirement — nothing else to install.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.trim()) onPair(code);
          }}
          placeholder="PAIRING CODE"
          maxLength={6}
          spellCheck={false}
          autoComplete="off"
          className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#E11D48] focus:outline-none"
        />
        <button
          onClick={() => onPair(code)}
          disabled={busy || !code.trim()}
          className={primary}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
        <a href={DOWNLOAD_HREF} className={secondary} download>
          {needsCode ? "Get the bridge" : "Download the bridge"}
        </a>
      </div>

      {error && (
        <p className="font-sans text-xs leading-relaxed text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}
