/**
 * The API port.
 *
 * Every screen in this app reads its data over `/api/...`. Under the local Node build that is a real
 * same-origin HTTP request to the route handlers. The browser build is a static export with no
 * server at all, so the same call has to be answered in the page - by calling the operation the
 * route used to wrap.
 *
 * This module is the switch point. The Node implementation is `fetch`, unchanged, so nothing about
 * the local app moves; the browser implementation parses the URL and dispatches to
 * `@/lib/operations/*` with no HTTP hop in between.
 *
 * Callers keep writing URLs rather than importing operations directly. That is deliberate: the
 * screens then hold no opinion about which runtime they are in, and the mapping from URL to
 * operation lives in exactly one file.
 */
export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** `fetch`, verbatim. The local build talks to its own route handlers exactly as it always has. */
export const apiFetch: ApiFetch = (input, init) => fetch(input, init);
