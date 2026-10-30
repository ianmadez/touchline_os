"use client";

/**
 * How to turn a phone on, written the same way everywhere it appears.
 *
 * Two screens need this and they must not drift: the landing page, where a manager first finds out the
 * feature exists, and Settings, where they come back to it. One component means one set of commands,
 * one order, and one place to fix a step that changes.
 *
 * The commands are PowerShell, because the PC side this targets is Windows (the save folders, the
 * launchers and the pairing config all already assume it). The alternative with the `tsx` entry point is
 * offered underneath because `npm` treats an unknown `--flag` as its own config rather than forwarding
 * it, which silently starts the core without sharing - exactly the failure that looks like a broken
 * feature.
 */
import React, { useEffect, useRef, useState } from "react";

const GUIDE_URL = "https://github.com/ianmadez/touchline_os/blob/main/docs/remote-access.md";

function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return (
    <div className="flex items-stretch gap-2 max-w-xl">
      {/* Wraps rather than scrolls: on a 360px phone the second command is two lines long, and a
          one-line box would hide most of it behind an invisible horizontal scroll. Copy still takes the
          whole string. */}
      <code className="min-w-0 flex-1 select-text rounded-lg bg-slate-100 dark:bg-slate-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
        {command}
      </code>
      <button
        type="button"
        data-compact
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1600);
          } catch {
            // A browser that refuses the clipboard (or a page not on a secure origin) leaves the
            // command on screen to be read and typed. Nothing else to do, and nothing to apologise for.
          }
        }}
        className="shrink-0 min-h-9 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] cursor-pointer"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 font-heading text-[11px] text-[#E11D48] dark:text-rose-400">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-sub text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          {title}
        </p>
        <div className="font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">{children}</div>
      </div>
    </li>
  );
}

export function PairingInstructions({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-4">
      <p className="font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        {compact
          ? "Phone pairing needs a listener on the PC, so it is switched on from the PC. Three steps, once."
          : "The career in this browser is the main copy, and the PC keeps a live copy of it so your phone can open the same career. Turn the phone link on there, pair the phone once, and a change on either device appears on the other within a few seconds."}
      </p>

      <ol className="space-y-3.5">
        <Step number="01" title="Build the copy your phone will load">
          <p className="mb-2">
            Once, and again after any page change. The PC serves this build to the phone.
          </p>
          <Command command="npm run build:browser" />
        </Step>

        <Step number="02" title="Turn on the phone link">
          <p className="mb-2">
            One command, in the project folder. It opens a single port on your home network so a phone
            can load the app, prints a pairing code, and stays open while you want the phone to work.
          </p>
          <Command command="npm run phone" />
          <details className="mt-2">
            <summary className="cursor-pointer font-sub text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              What it actually does
            </summary>
            <div className="mt-2 space-y-1.5 font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              <p>
                Normally the app only answers the PC it is running on, which is why a phone cannot see it.
                This command starts the same program with that one restriction lifted: it also answers
                devices on your own Wi-Fi, at the address it prints.
              </p>
              <p>
                It is off unless you run it. Closing the window turns it off again, and nothing about it
                reaches the internet. If you would rather not use npm,{" "}
                <code className="font-mono">npx tsx bridge/touchline-core.ts --share</code> is the same
                thing: <code className="font-mono">--share</code> is the switch that lifts that
                restriction.
              </p>
              <p>
                Downloaded the one-file bridge instead? Run <code className="font-mono">share</code> on it:{" "}
                <code className="font-mono">TouchlineBridge.cmd share</code>.
              </p>
            </div>
          </details>
        </Step>

        <Step number="03" title="Open the address on the phone">
          <p>
            Same Wi-Fi. Type the six-character code once, or scan the QR the window prints and it fills
            itself in.
          </p>
        </Step>
      </ol>

      <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
        <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Pair only on a network you trust: it runs over plain HTTP on your own Wi-Fi. Nothing is
          uploaded, and nothing leaves your network. The phone link only exists while that window is
          open. Windows may ask once whether Node.js may accept connections, so allow it on private
          networks only.
        </p>
        <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          If both copies change while they are apart, TouchlineOS asks which one to keep. It never merges
          them.
        </p>
        <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          The core runs from the project folder, so these two commands need it checked out. Nothing is
          installed and no account is created.
        </p>
        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block font-sub text-[10px] font-bold uppercase tracking-wider text-[#E11D48] dark:text-[#FF8C7A] underline underline-offset-2"
        >
          Full guide, including what keeps it safe
        </a>
      </div>
    </div>
  );
}
