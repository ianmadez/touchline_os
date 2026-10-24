"use client";

/**
 * The first screen a phone sees.
 *
 * A page served by a core is the real app with no pairing yet, which is the one state the app has never
 * had: the desktop build always owns its database. So this is deliberately not a wizard - there is
 * nothing to configure and no career to choose. It asks for the six characters shown in the window on
 * the PC, and then the app it was already looking at appears.
 *
 * Two details that matter on a phone:
 *
 * - The field is `inputMode="text"` with `autocapitalize="characters"`, because the code is six capital
 *   letters and digits, and a keyboard that starts in lower case makes it wrong every time.
 * - A `?pair=` in the URL fills it in. That is what the QR code in the other window encodes, so a scan
 *   arrives with the code already typed and the manager only has to press one button.
 */
import React, { useEffect, useRef, useState } from "react";
import { currentDeviceName, pairWithBridge } from "@/lib/platform/remote";
import type { RemoteState } from "@/lib/remote/protocol";

interface RemotePairingScreenProps {
  /** Called with the core's first state once pairing succeeds. */
  onPaired: (state: RemoteState) => void;
  /** Shown when the page could not reach a core at all, rather than being refused by one. */
  offline?: boolean;
}

/** Six characters, and the alphabet the core uses: no I, O, 0 or 1 to misread. */
const CODE_LENGTH = 6;

function normalise(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

/** The code from `?pair=`, so a scanned QR arrives pre-filled. */
function codeFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return normalise(params.get("pair") ?? "");
}

export function RemotePairingScreen({ onPaired, offline = false }: RemotePairingScreenProps) {
  const [initial] = useState(() => codeFromUrl());
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const complete = code.length === CODE_LENGTH;

  const submit = async (value: string) => {
    if (busy || value.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    const answer = await pairWithBridge(value, currentDeviceName());
    setBusy(false);
    if (!answer.ok) {
      setError(answer.error);
      input.current?.select();
      return;
    }
    // The code has done its job, so it is removed from the address bar: a pairing URL sitting in the
    // history is a pairing code in the history.
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (answer.state) {
      onPaired(answer.state);
    } else {
      window.location.reload();
    }
  };

  // A scanned code submits itself: the manager scanned it to get here, and making them press a button
  // as well is the kind of second step that produces a support message. Deferred a tick, because the
  // submit sets state and a synchronous setState inside an effect is a lint error here.
  useEffect(() => {
    if (initial.length !== CODE_LENGTH) return;
    const timer = window.setTimeout(() => void submit(initial), 0);
    return () => window.clearTimeout(timer);
    // Runs once: `initial` is read from the URL at mount and never changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initial) input.current?.focus();
  }, [initial]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-10 bg-slate-50 dark:bg-[#090D16]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="font-heading text-2xl tracking-wider text-slate-900 dark:text-slate-100">
            TOUCHLINE<span className="text-[#E11D48]">OS</span>
          </span>
          <p className="mt-3 font-sub text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Connect to your PC
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xl space-y-5">
          <p className="font-sans text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {offline
              ? "This PC is not answering. Check that TouchlineOS is running there, that both devices are on the same Wi-Fi, and try again."
              : "Type the code shown in the TouchlineOS window on your PC. It is six characters, and it stays the same until you reset it."}
          </p>

          {!offline && (
            <p className="font-sans text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Pairing puts the same career on this phone as the one open on your PC. A change on either
              device appears on the other within a few seconds, and one device edits at a time: this one
              shows Viewing only until you take control.
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(code);
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="font-sub text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Pairing code
              </span>
              <input
                ref={input}
                value={code}
                onChange={(event) => setCode(normalise(event.target.value))}
                onPaste={(event) => {
                  event.preventDefault();
                  setCode(normalise(event.clipboardData.getData("text")));
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={CODE_LENGTH}
                placeholder="ABCD23"
                aria-label="Pairing code"
                className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-3 text-center font-heading text-2xl tracking-[0.4em] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none focus:border-[#E11D48]"
              />
            </label>

            {error && (
              <p role="alert" className="font-sans text-xs leading-relaxed text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!complete || busy}
              className="w-full min-h-12 rounded-xl bg-[#E11D48] px-5 font-sub text-xs font-bold uppercase tracking-wider text-white transition-[background-color,transform] duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 hover:bg-[#FF8C7A] cursor-pointer disabled:cursor-not-allowed"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </form>

          <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-4">
            Nothing is uploaded, and nothing leaves your network. Your phone talks straight to your PC
            over your own Wi-Fi. It runs over plain HTTP on that network, so pair only on a network you
            trust. If the code has been forgotten, it is printed every time the TouchlineOS window opens.
          </p>
        </div>

        <p className="mt-6 text-center font-sub text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-600">
          Your PC is the one running TouchlineOS. This page came from it.
        </p>
      </div>
    </main>
  );
}
