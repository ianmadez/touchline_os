"use client";

/**
 * The phone feature, as a thing you can use rather than a paragraph about a thing.
 *
 * It knows two states and shows the right one:
 *
 * - **This page came from a core.** Then it is the real organ: the address, the code and the QR for the
 *   next device, plus the way through to the device list. A manager on the landing page can pair a
 *   tablet without going into Settings first.
 * - **It did not.** Then there is nothing to switch on from here - a page cannot open a port on a PC -
 *   so it shows the three steps that do it, with copy buttons, instead of an offer that could not work.
 *
 * The second case is the common one on the hosted build and on the desktop app, which is why it is
 * written as instructions rather than as a disabled control.
 */
import React from "react";
import { useRemote } from "./remote-provider";
import { PairingInstructions } from "./pairing-instructions";

interface PhoneAccessCardProps {
  /** Takes the manager to Settings, where the device list, revoke and Stop sharing live. */
  onManageDevices?: () => void;
  /** Landing page styling is roomier than the Settings card. */
  variant?: "landing" | "settings";
}

export function PhoneAccessCard({ onManageDevices, variant = "landing" }: PhoneAccessCardProps) {
  const { remote, state, takeControl } = useRemote();
  const pairing = remote ? state?.pairing ?? null : null;

  if (!pairing) {
    return <PairingInstructions compact={variant === "settings"} />;
  }

  const self = state?.self ?? null;
  const otherDevices = (state?.devices ?? []).filter((device) => !device.self).length;

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
      {pairing.qr && (
        /* Rendered by the core from its own pairing address, as a data URL, so it cannot call home. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={pairing.qr}
          alt="QR code for pairing a phone with this PC"
          className="h-36 w-36 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white p-1.5 shadow-sm"
        />
      )}

      <div className="min-w-0 space-y-3">
        <div>
          <p className="font-sub text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Sharing on · {state?.hostName}
          </p>
          <p className="mt-1 font-sans text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Scan the code with the phone&apos;s camera, or type the address below into it. It asks for the
            code once, then that device is paired.
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="font-heading text-xl tracking-[0.35em] text-slate-900 dark:text-slate-100">
            {pairing.code}
          </p>
          <p className="min-w-0 break-all font-sub text-[11px] text-slate-500 dark:text-slate-400">
            {pairing.url}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onManageDevices && (
            <button
              type="button"
              onClick={onManageDevices}
              data-compact
              className="min-h-9 rounded-lg bg-[#E11D48] px-3.5 font-sub text-[10px] font-bold uppercase tracking-wider text-white transition-[background-color,transform] duration-150 active:scale-[0.97] hover:bg-[#FF8C7A] cursor-pointer"
            >
              Manage devices
            </button>
          )}
          {self && !self.writer && (
            <button
              type="button"
              onClick={() => void takeControl()}
              data-compact
              className="min-h-9 rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 font-sub text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 transition-colors hover:border-[#E11D48] hover:text-[#E11D48] dark:hover:text-[#FF8C7A] cursor-pointer"
            >
              Take control
            </button>
          )}
          <span className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
            {self ? `This device is ${self.writer ? "editing" : "viewing"}` : "Not paired here"}
            {otherDevices > 0 ? ` · ${otherDevices} other ${otherDevices === 1 ? "device" : "devices"}` : ""}
          </span>
        </div>

        <p className="font-sans text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-3">
          One device holds the pen at a time, so two people cannot write over each other. The other keeps
          reading, and can take control from the banner or from Settings → Devices.
        </p>
      </div>
    </div>
  );
}
