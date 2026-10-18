/**
 * The API port, browser build.
 *
 * A static export has no server, so `/api/...` cannot be a request. Two things decide how a call is
 * answered, in this order:
 *
 * 1. **Served by the TouchlineOS core.** The page carries a `touchline-remote` marker in its head -
 *    see `./remote` - and then the ordinary `fetch` is the right answer, because the core really is
 *    the server for this page. The local database and the save file are on the PC the page came from.
 * 2. **No core.** Every URL the app already calls is dispatched through `@/lib/operations/dispatch`
 *    and answered in the page, with no HTTP hop at all.
 *
 * Both paths return a real `Response`, so no caller can tell which one it got.
 */
import { dispatch, rawBody } from "../operations/dispatch";
import type { RemoteErrorBody } from "../remote/protocol";
import { announceLeaseRefusal, isRemoteRuntime, remoteInit } from "./remote";
import type { ApiFetch } from "./api-client";

export const apiFetch: ApiFetch = async (input: string, init?: RequestInit) => {
  if (isRemoteRuntime()) {
    const response = await fetch(input, remoteInit(init));

    // A write refused because another device holds the pen is not a failure the caller can handle on
    // its own - the screen has no idea a second phone exists. Announced here, once, so the shell can
    // say who has it and offer to take over. The body is cloned: the caller still reads its own copy.
    if (response.status === 409) {
      void response
        .clone()
        .json()
        .then((body: RemoteErrorBody | null) => {
          if (body?.code !== "lease") return;
          announceLeaseRefusal({ message: body.error, leaseEpoch: body.leaseEpoch });
        })
        .catch(() => {
          // Not JSON: the caller's own handling is the right place for whatever it is.
        });
    }
    return response;
  }

  // The origin is a parsing device only - nothing is requested, and `input` is always same-origin.
  const url = new URL(input, "http://localhost");
  const outcome = await dispatch({
    method: (init?.method ?? "GET").toUpperCase(),
    path: url.pathname.replace(/\/+$/, "") || "/",
    params: url.searchParams,
    raw: rawBody(init),
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { "content-type": "application/json" },
  });
};
