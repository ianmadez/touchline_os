"use client";

/**
 * Who is connected to this career, and who currently has the pen.
 *
 * The card exists because a career opened from a phone is no longer obviously one person's file on one
 * disk. "Which devices can see this?" and "who is editing right now?" are the two questions that
 * creates, and they are answered here rather than in a dialog nobody opens.
 *
 * Deliberately no "turn sharing on" switch. Sharing is a listener, and switching a listener on is the
 * one action that must happen at the machine that owns the data - a phone cannot open a port on a PC
 * that is not listening for it. Stopping it *is* offered, because that is the action somebody worried
 * about a phone left on a train actually wants.
 */
import React, { useState } from "react";
import { forgetRemoteSession, revokeDevice, setSharing } from "@/lib/platform/remote";
import type { RemoteState } from "@/lib/remote/protocol";
import { SyncLine, useSyncSnapshot } from "@/components/ui/bridge/sync-line";
import { TwoCopies } from "@/components/ui/bridge/two-copies";
import { PairingInstructions } from "./pairing-instructions";
import { useRemote, useWriteAccess } from "./remote-provider";

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes <= 0) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-300/70 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-0.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
      {children}
    </span>
  );
}

/**
 * The answers to "what is the PC actually holding?", collapsed by default.
 *
 * It is a question asked once, so it does not deserve a paragraph on every visit. It is the same block
 * on both kinds of page - one served by the core and one that pairs with it - because the facts do not
 * change with which page you are looking at.
 */
function HowItWorks() {
  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3.5 py-3">
      <summary className="cursor-pointer list-none font-sub text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ▸
          </span>
          How it works
        </span>
      </summary>
      <ul className="mt-3 space-y-2 font-sans text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
        <li>
          The career in this browser is the main copy. The PC keeps a live copy of it so your phone can
          open the same career.
        </li>
        <li>
          The first time you paired, this browser&apos;s copy was sent to the PC, and whatever the PC held
          before was saved to a backup folder first.
        </li>
        <li>A change on either device appears on the other within a few seconds.</li>
        <li>One device edits at a time. The other shows Viewing only, and Take control switches.</li>
        <li>
          If both copies changed while they were apart, TouchlineOS asks which one to keep. It never
          merges them.
        </li>
        <li>
          A phone edit made while the page is closed waits, and is applied the next time the page opens.
        </li>
        <li>
          Both devices must be on the same Wi-Fi. It runs over plain HTTP on your own network, so pair
          only on a network you trust, and nothing leaves your network.
        </li>
        <li>The local desktop build keeps its own database and works as before.</li>
      </ul>
    </details>
  );
}

export function RemoteDevices() {
  const { remote, state, adopt, takeControl, refresh } = useRemote();
  const { viewing, holderName } = useWriteAccess();
  const snapshot = useSyncSnapshot();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!remote) {
    return (
      <div className="space-y-4">
        {snapshot.phase === "two-copies" && snapshot.conflict && (
          <TwoCopies careerId={snapshot.conflict.careerId} comparison={snapshot.conflict} />
        )}
        <SyncLine />
        <HowItWorks />
        <PairingInstructions compact />
      </div>
    );
  }

  if (!state) {
    return (
      <p className="font-sans text-xs text-slate-600 dark:text-slate-400">
        Loading the connection state from the PC…
      </p>
    );
  }

  const run = async (label: string, work: () => Promise<{ ok: boolean; error?: string; state?: RemoteState }>) => {
    setBusy(label);
    setError(null);
    const answer = await work();
    setBusy(null);
    if (!answer.ok) {
      setError(answer.error ?? "That did not work.");
      void refresh();
      return;
    }
    if (answer.state) adopt(answer.state);
    else void refresh();
  };

  const paired = state.devices.filter((device) => !device.self);
  const self = state.self;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-sub text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
          Connected to {state.hostName}
        </span>
        <span className="font-sans text-[11px] text-slate-500 dark:text-slate-400 break-all">{state.url}</span>
        <Chip>{state.sharing ? "sharing on" : "sharing off"}</Chip>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3.5 py-3">
        <p className="font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          {viewing ? (
            <>
              <span className="font-sub font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Viewing ·{" "}
              </span>
              {holderName ?? "Another device"} is editing, so changes made here are refused until you
              take control.
            </>
          ) : (
            <>
              <span className="font-sub font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Editing ·{" "}
              </span>
              One device edits at a time, and this is the one. Changes made here reach the other device
              within a few seconds.
            </>
          )}
        </p>
        {viewing && (
          <button
            type="button"
            onClick={() => void takeControl()}
            className="mt-3 min-h-10 rounded-lg bg-[#E11D48] px-4 font-sub text-[11px] font-bold uppercase tracking-wider text-white transition-[background-color,transform] duration-150 active:scale-[0.97] hover:bg-[#FF8C7A] cursor-pointer"
          >
            Take control
          </button>
        )}
      </div>

      {/* Collapsed by default: this is the answer to "what is the PC actually holding?", which is a
          question you ask once, not a paragraph to read past every visit. */}
      <HowItWorks />

      {state.pairing && (
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          {state.pairing.qr && (
            /* The SVG is rendered by the core from its own pairing URL, and it is a data URL so it
               cannot phone anything home. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={state.pairing.qr}
              alt="QR code for pairing another device"
              className="h-32 w-32 rounded-xl border border-slate-200 dark:border-slate-800 bg-white p-1"
            />
          )}
          <div className="min-w-0 space-y-1.5">
            <p className="font-sub text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pair another device
            </p>
            <p className="font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Scan the code, or open{" "}
              <span className="font-sub text-slate-800 dark:text-slate-200 break-all">{state.pairing.url}</span>{" "}
              on the other device and type the code.
            </p>
            <p className="font-heading text-lg tracking-[0.35em] text-slate-900 dark:text-slate-100">
              {state.pairing.code}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="font-sub text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Devices
        </p>

        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
          {self && (
            <li className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-sub text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {self.name}
                </p>
                <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                  This device · seen {relative(self.lastSeenAt)}
                </p>
              </div>
              {self.writer && <Chip>editing</Chip>}
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("unpair");
                  await forgetRemoteSession();
                  window.location.reload();
                }}
                data-compact
                className="min-h-9 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 px-3 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 transition-colors hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer disabled:opacity-50"
              >
                Unpair
              </button>
            </li>
          )}

          {paired.length === 0 && (
            <li className="px-3.5 py-3 font-sans text-[11px] text-slate-500 dark:text-slate-400">
              No other devices.
            </li>
          )}

          {paired.map((device) => (
            <li key={device.id} className="flex items-center gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-sub text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {device.name}
                </p>
                <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
                  Paired {relative(device.pairedAt)} · seen {relative(device.lastSeenAt)}
                </p>
              </div>
              {device.writer && <Chip>editing</Chip>}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`revoke-${device.id}`, () => revokeDevice(device.id))}
                data-compact
                className="min-h-9 shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 px-3 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 transition-colors hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer disabled:opacity-50"
              >
                {busy === `revoke-${device.id}` ? "Removing…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("sharing", () => setSharing(false))}
          data-compact
          className="min-h-9 rounded-lg border border-slate-300 dark:border-slate-700 px-3 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 transition-colors hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer disabled:opacity-50"
        >
          Stop sharing
        </button>
        <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Closes the PC&apos;s network port. Your career is untouched, and the devices you have already
          paired stay paired: start the core with sharing again and they reconnect.
        </p>
      </div>

      {error && (
        <p role="alert" className="font-sans text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {state.devices.length === 0 && (
        <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
          No device is paired right now. Reload this page to pair again.
        </p>
      )}
    </div>
  );
}
