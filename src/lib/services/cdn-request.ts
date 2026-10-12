/**
 * How this app is allowed to ask the sprite CDN for a file.
 *
 * WHY THIS IS A MODULE AND NOT TWO LINES AT THE CALL SITE. The CDN serves its sprites with
 * `Access-Control-Allow-Origin: *` and nothing else, and it answers a CORS preflight with
 * **405 Method Not Allowed**. That means any request that is not a "simple" cross-origin GET is
 * refused by the browser before its body is ever read. Measured against the live CDN:
 *
 *   GET  /assets/img/fc26/flags/14.png   -> 200, Access-Control-Allow-Origin: *
 *   OPTIONS (Access-Control-Request-Headers: user-agent) -> 405, no CORS headers at all
 *
 * A request stops being simple the moment a header is attached that is not CORS-safelisted, and
 * `User-Agent` is one of those. Whether that happens depends on the BROWSER, which is the trap that
 * broke this app in Firefox:
 *
 *   Chromium  silently DROPS a User-Agent set from script, so the request stayed simple and worked.
 *   Firefox   KEEPS it, so the request needed a preflight, the CDN answered 405, and `fetch`
 *             rejected. Faces and flags failed in Firefox with "Cross-Origin Request Blocked" and
 *             not one successful request in the log, while the same build worked perfectly in Edge.
 *
 * The header was there for Node's benefit and a browser never sent it anyway, so the rule is simply
 * that a browser attaches nothing: the request the CDN is happy to answer is the one with no headers
 * on it at all. `inBrowser` is a parameter rather than a closed-over constant so the rule can be
 * asserted in both directions from a test.
 */

/** Identifies this app to the CDN when the runtime is one we control. Meaningless in a browser. */
const USER_AGENT = "TouchlineOS/0.1 (local companion)";

/** True under the browser build, false under Node. */
export function isBrowserRuntime(): boolean {
  return typeof window !== "undefined";
}

/**
 * The fetch options for one sprite or flag request.
 *
 * `signal` is the caller's own timeout, and it is the only thing a browser is given: a signal is not
 * a header and does not affect whether the request is simple.
 */
export function cdnRequestInit(signal: AbortSignal, inBrowser: boolean = isBrowserRuntime()): RequestInit {
  return inBrowser ? { signal } : { signal, headers: { "User-Agent": USER_AGENT } };
}
