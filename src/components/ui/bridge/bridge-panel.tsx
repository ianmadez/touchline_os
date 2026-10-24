"use client";

import React, { useState } from "react";
import type { BridgeState } from "@/lib/platform/types";
import { lastBridgeCompatibility } from "@/lib/platform/bridge-version";
import { SyncLine, useSyncSnapshot } from "./sync-line";
import { TwoCopies } from "./two-copies";

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

/**
 * The long explanation, folded away.
 *
 * The main menu is a single screen that must fit without scrolling, and four paragraphs of prose in a
 * panel that is often the fourth thing down it was enough to push `ENTER OS` below the fold. The
 * explanation still has to exist - a paired bridge that behaves invisibly is the wrong kind of
 * invisible - so it collapses instead: the state line above stays, and the detail opens on request.
 * The body scrolls inside itself rather than growing the panel, so opening it cannot push the menu
 * around either.
 */
function BridgeExplainer({ children }: { children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2">
      <summary className="cursor-pointer list-none font-sub text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ▸
          </span>
          How it works
        </span>
      </summary>
      <div className="mt-2 max-h-[7.5rem] space-y-2 overflow-y-auto overscroll-contain pr-1">{children}</div>
    </details>
  );
}

export function BridgePanel({
  state,
  onPair,
  onDisconnect,
  busy = false,
  error = null,
}: BridgePanelProps) {
  const [code, setCode] = useState("");
  const snapshot = useSyncSnapshot();

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
      <div className="space-y-3">
        {snapshot.phase === "two-copies" && snapshot.conflict && (
          <TwoCopies
            careerId={snapshot.conflict.careerId}
            comparison={snapshot.conflict}
          />
        )}
        <div className={card}>
          <div className="flex items-center justify-between gap-3">
            <span className={label}>Connected to your local bridge</span>
            <span className="font-sub text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              ● Automatic
            </span>
          </div>
          <p className={body}>
            The bridge is watching your save folder on this PC, so there is nothing to pick, and it holds
            the live copy your phone opens. A change on either device shows up on the other within a few
            seconds.
          </p>
          <BridgeExplainer>
            <p className={body}>
              It keeps its own list of your saves up to date as it goes, so a save the game has just
              written turns up on its own.
            </p>
            <p className={body}>
              The career in this browser is the main copy. The PC keeps a live copy of it so your phone
              can show the same career. One device edits at a time: the other shows Viewing only, and Take
              control switches. A phone edit made while this page is closed waits, and is applied the next
              time the page opens.
            </p>
            <p className={body}>
              The first time you paired, this browser&rsquo;s copy was sent to the PC, and whatever the PC
              held before was saved to a backup folder first. If both copies ever change while they are
              apart, TouchlineOS asks which one to keep, and it never merges them.
            </p>
            <p className={body}>
              It only ever listens on this machine, only answers this site, and never writes to your save.
              All of that lasts as long as the bridge window is open: close it and the site quietly goes
              back to asking for your file, with nothing broken and your career untouched.
            </p>
          </BridgeExplainer>
          <SyncLine />
          <button onClick={onDisconnect} disabled={busy} className={secondary}>
            {busy ? "Disconnecting…" : "Disconnect the bridge"}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- reachable, wrong version
  //
  // Checked before the pairing form, because a re-pair would not help: the two sides disagree about the
  // schema, so the honest action is to update whichever one is older. The page is redeployed far more
  // often than the bridge, so "update the bridge" is the usual answer - and the message says which.
  if (state === "outdated") {
    const direction = lastBridgeCompatibility();
    return (
      <div className={card}>
        <span className={label}>
          {direction === "page-older"
            ? "This bridge is newer than this page"
            : "This bridge is older than this page"}
        </span>
        <p className={body}>
          {direction === "page-older"
            ? "Refresh the web page to catch up. The bridge you are running understands a newer shape of the data than the page in this tab is holding."
            : "Update the bridge. The one running on this PC was built before the page you are looking at, so the two would disagree about the data even though every request would succeed."}
        </p>
        <p className={body}>
          Nothing has been changed. Your save and your career are untouched, and picking your save file
          above still works exactly as it did.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {direction === "page-older" ? (
            <button onClick={() => window.location.reload()} className={primary}>
              Refresh the page
            </button>
          ) : (
            <a href={DOWNLOAD_HREF} className={primary} download>
              Download the current bridge
            </a>
          )}
          <button onClick={onDisconnect} disabled={busy} className={secondary}>
            {busy ? "Disconnecting…" : "Stop using it"}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- enabled, but not answering
  if (state === "unreachable") {
    return (
      <div className={card}>
        <span className={label}>Your local bridge isn&rsquo;t running</span>
        <p className={body}>
          It was paired, but nothing is answering on its port now, which usually means the bridge window
          was closed. Start{" "}
          <code className="font-mono text-[10px] text-slate-900 dark:text-slate-100">
            TouchlineBridge.cmd
          </code>{" "}
          again and this reconnects on its own. This browser remembers the pairing code, so you will not
          need it a second time.
        </p>
        <p className={body}>
          Until then you can simply pick your save file above. Nothing is lost either way.
        </p>
        <SyncLine />
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
            The bridge is running on this machine and waiting to be introduced. Paste the pairing code
            from the bridge window and this browser will be allowed to read your save through it.
          </>
        ) : (
          <>
            Browsers insist on asking for your save file more than once. The bridge is a small optional
            helper on your own PC: it watches your save folder and hands the file to this page, so there
            is nothing to pick.
          </>
        )}
      </p>

      {!needsCode && (
        <BridgeExplainer>
          <p className={body}>
            Run it once, pair it once, and every visit reads your save on its own. It keeps its own list
            of your saves fresh as it goes, so a save the game has just written is noticed without a
            nudge, and it holds the live copy your phone opens.
          </p>
          <p className={body}>
            It only listens on your machine, only answers this site, and never writes to your save file.
          </p>
          <p className={body}>
            That works in every browser, including Firefox and Safari, which cannot remember a file at
            all. You will need Node.js, which is the only requirement, and nothing else to install.
            Entirely optional: everything works without it.
          </p>
        </BridgeExplainer>
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
