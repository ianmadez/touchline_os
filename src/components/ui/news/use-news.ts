"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/platform/api-client";
import type { NewsPaper } from "@/lib/services/news-archive";

/**
 * The one place the paper is fetched and changed.
 *
 * The archive lives on the server, so this is a thin client over four verbs: read (which also publishes
 * anything new), bookmark, dismiss, mark read. Reads are cached per career for the life of the module so
 * that opening the paper from the dashboard window does not flash a skeleton over content that was on
 * screen a frame earlier, and every write updates that cache optimistically and then re-reads, so a failed
 * request corrects itself instead of leaving the screen lying.
 *
 * There is deliberately no loading flag to set: "loading" is derived from having neither a paper for this
 * career nor an error, so no effect sets state synchronously on mount.
 */
const cache = new Map<string, NewsPaper>();

export interface NewsPaperState {
  paper: NewsPaper | null;
  error: string | null;
  loading: boolean;
  /** The last thing a write refused to do, so the screen can explain itself rather than flicker. */
  notice: string | null;
  dismissNotice: () => void;
  refresh: () => void;
  setSaved: (id: string, saved: boolean) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  markRead: () => Promise<void>;
}

export function useNewsPaper(careerId: string): NewsPaperState {
  const [paper, setPaper] = useState<NewsPaper | null>(() => cache.get(careerId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  // A career switch must not show the previous club's paper while the new one is on its way.
  const scoped = paper && paper.careerId === careerId ? paper : null;

  useEffect(() => {
    if (!careerId) return;
    let cancelled = false;
    apiFetch(`/api/news?careerId=${encodeURIComponent(careerId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          success?: boolean;
          paper?: NewsPaper;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.success || !body.paper) {
          setError(body.error ?? `Could not put the paper together (${response.status}).`);
          return;
        }
        cache.set(careerId, body.paper);
        setPaper(body.paper);
        setError(null);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [careerId, token]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  const write = useCallback(
    async (url: string, init: RequestInit, apply: (current: NewsPaper) => NewsPaper) => {
      setPaper((current) => {
        if (!current) return current;
        const next = apply(current);
        cache.set(careerId, next);
        return next;
      });
      try {
        const response = await apiFetch(url, init);
        if (!response.ok) {
          // A refused write is usually a rule rather than a fault - "that story is saved" is the common one -
          // so the server's own sentence is shown rather than a generic failure.
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setNotice(body?.error ?? `That did not work (${response.status}).`);
          refresh();
          return;
        }
        setNotice(null);
      } catch {
        setNotice("That did not reach the server.");
        refresh();
      }
    },
    [careerId, refresh]
  );

  const setSaved = useCallback(
    async (id: string, saved: boolean) => {
      await write(
        "/api/news",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ careerId, id, saved }),
        },
        (current) => ({
          ...current,
          items: current.items.map((item) => (item.id === id ? { ...item, saved } : item)),
        })
      );
    },
    [careerId, write]
  );

  const dismiss = useCallback(
    async (id: string) => {
      // The id travels in the URL, because the route reads it from the query string: the collection URL with
      // a body would be a request the server has to reject, and the optimistic update would then be undone
      // by the refresh that follows.
      await write(
        `/api/news?careerId=${encodeURIComponent(careerId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
        (current) => {
          const items = current.items.filter((item) => item.id !== id);
          return { ...current, items, unseen: items.filter((item) => !item.read).length };
        }
      );
    },
    [careerId, write]
  );

  const markRead = useCallback(async () => {
    setPaper((current) => {
      if (!current || current.unseen === 0) return current;
      const next = {
        ...current,
        unseen: 0,
        items: current.items.map((item) => (item.read ? item : { ...item, read: true })),
      };
      cache.set(current.careerId, next);
      return next;
    });
    const id = careerId;
    try {
      await apiFetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ careerId: id }),
      });
    } catch {
      // A badge that clears locally is not worth a second request: the next read settles it.
    }
  }, [careerId]);

  return {
    paper: scoped,
    error,
    loading: scoped === null && error === null,
    notice,
    dismissNotice: () => setNotice(null),
    refresh,
    setSaved,
    dismiss,
    markRead,
  };
}
