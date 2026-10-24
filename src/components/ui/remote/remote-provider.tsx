"use client";

/**
 * The shell's picture of the PC it is talking to.
 *
 * One provider, one event stream, one heartbeat, and every remote surface reads from it. The screens
 * do not each open their own connection: three screens each holding a stream would triple the traffic
 * and disagree about who has the pen.
 *
 * Three things it does that are not obvious:
 *
 * - **`remote` is resolved in an effect, never during render.** A static export is prerendered on a
 *   machine with no `document`, so asking at render time would produce a hydration mismatch; asking
 *   after mount produces one correct re-render instead.
 * - **It listens for the lease refusal.** `apiFetch` cannot show anything - it is not a component - so
 *   it dispatches an event and this turns it into a sentence with a button on it.
 * - **It refreshes on `data-changed`.** A phone and a desktop looking at the same career must not
 *   disagree, and the cheapest honest way to guarantee that is to re-read after every write rather
 *   than to merge two realities.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  isRemoteRuntime,
  probeRemote,
  sendHeartbeat,
  subscribeRemote,
  takeControl as requestControl,
  type RemoteReach,
} from "@/lib/platform/remote";
import { REMOTE_DATA_EVENT, REMOTE_LEASE_EVENT, type RemoteState } from "@/lib/remote/protocol";

/** How often a visible page tells the core it is still being looked at. */
const HEARTBEAT_MS = 60_000;

interface LeaseRefusal {
  message: string;
}

interface RemoteContextValue {
  /** True when this page is a client of a core. False for the desktop app and the hosted build. */
  remote: boolean;
  reach: RemoteReach;
  state: RemoteState | null;
  /** True once the first answer has arrived, so a screen does not flash the pairing card. */
  resolved: boolean;
  /** The stream dropped and polling has taken over. */
  degraded: boolean;
  /** Bumped by every change the core reports, so screens can refetch. */
  dataRevision: number;
  /**
   * Bumped only by changes another device made.
   *
   * Separate from `dataRevision` on purpose: a screen keys on this to remount and re-read its own data,
   * and remounting on your own save would throw away the scroll position under the finger that saved.
   */
  externalRevision: number;
  leaseRefusal: LeaseRefusal | null;
  dismissLeaseRefusal: () => void;
  takeControl: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Adopted after a call that answers with a whole state, so the UI updates without a round trip. */
  adopt: (state: RemoteState) => void;
}

const RemoteContext = createContext<RemoteContextValue | null>(null);

export function useRemote(): RemoteContextValue {
  const value = useContext(RemoteContext);
  if (!value) {
    throw new Error("useRemote must be used inside <RemoteProvider>.");
  }
  return value;
}

export function RemoteProvider({ children }: { children: React.ReactNode }) {
  const [remote, setRemote] = useState(false);
  const [reach, setReach] = useState<RemoteReach>("offline");
  const [state, setState] = useState<RemoteState | null>(null);
  const [resolved, setResolved] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [externalRevision, setExternalRevision] = useState(0);
  const [leaseRefusal, setLeaseRefusal] = useState<LeaseRefusal | null>(null);

  // A ref, because the stream's handlers are installed once and would otherwise close over the state
  // as it was on the first render - and "is this my own write" is exactly the question that goes stale.
  const selfIdRef = useRef<string | null>(null);
  useEffect(() => {
    selfIdRef.current = state?.self?.id ?? null;
  }, [state]);

  const refresh = useCallback(async () => {
    if (!isRemoteRuntime()) return;
    const answer = await probeRemote();
    setReach(answer.reach);
    setState(answer.state);
    setResolved(true);
  }, []);

  useEffect(() => {
    // Deferred a tick: a synchronous setState inside an effect body is a lint error in this codebase,
    // and the deferral also means the first paint is the static shell rather than a half-initialised
    // remote one.
    const timer = window.setTimeout(() => {
      if (!isRemoteRuntime()) {
        setResolved(true);
        return;
      }
      setRemote(true);
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // The stream only exists once we know this page belongs to a core.
  useEffect(() => {
    if (!remote) return;
    const subscription = subscribeRemote({
      onState: (next) => {
        setState(next);
        setReach("paired");
      },
      onDataChanged: (revision, by) => {
        setDataRevision(revision);
        const mine = by !== null && by === selfIdRef.current;
        if (!mine) setExternalRevision((count) => count + 1);
      },
      onDegraded: () => setDegraded(true),
    });
    return () => subscription.close();
  }, [remote]);

  // A heartbeat only while somebody is looking: a phone in a pocket should let the pen go, and a phone
  // on the desk should keep it.
  useEffect(() => {
    if (!remote) return;
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void sendHeartbeat();
    };
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        beat();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    beat();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [remote, refresh]);

  useEffect(() => {
    if (!remote) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setLeaseRefusal({ message: detail?.message ?? "Another device is editing this career." });
    };
    window.addEventListener(REMOTE_LEASE_EVENT, handler);
    return () => window.removeEventListener(REMOTE_LEASE_EVENT, handler);
  }, [remote]);

  // A page that owns its own database has no stream to listen to, so replication announces its own
  // arrivals on the same event a remote change uses. Screens then refetch by exactly the path they
  // already use for another device, which is why none of them needed a second way to be told.
  useEffect(() => {
    if (remote) return;
    const handler = () => setExternalRevision((count) => count + 1);
    window.addEventListener(REMOTE_DATA_EVENT, handler);
    return () => window.removeEventListener(REMOTE_DATA_EVENT, handler);
  }, [remote]);

  const takeControl = useCallback(async () => {
    const answer = await requestControl();
    if (answer.ok) {
      setState(answer.state);
      setLeaseRefusal(null);
      setReach("paired");
    } else {
      setLeaseRefusal({ message: answer.error });
    }
  }, []);

  const adopt = useCallback((next: RemoteState) => {
    setState(next);
    setReach("paired");
  }, []);

  const value = useMemo<RemoteContextValue>(
    () => ({
      remote,
      reach,
      state,
      resolved,
      degraded,
      dataRevision,
      externalRevision,
      leaseRefusal,
      dismissLeaseRefusal: () => setLeaseRefusal(null),
      takeControl,
      refresh,
      adopt,
    }),
    [
      remote,
      reach,
      state,
      resolved,
      degraded,
      dataRevision,
      externalRevision,
      leaseRefusal,
      takeControl,
      refresh,
      adopt,
    ]
  );

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}

/**
 * The pen, described in one sentence.
 *
 * `mine` when nobody else can write, so every surface labelling itself agrees with itself. A device
 * that is not the writer is "viewing", which is the word the banner uses and the word the user needs.
 */
export function useWriteAccess(): { mine: boolean; holderName: string | null; viewing: boolean } {
  const { remote, state } = useRemote();
  const holder = state?.writer ?? null;
  const mine = !remote || holder === null || state?.self?.writer === true;
  return {
    mine,
    holderName: holder && !mine ? holder.name : null,
    viewing: remote && !mine,
  };
}
