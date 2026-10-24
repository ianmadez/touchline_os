/**
 * The browser twin of `sync-actions`: the real thing, forwarded straight through.
 *
 * One line per export and no logic, on purpose. The screens need functions with the same names and
 * signatures as the local no-ops, and a wrapper with its own copy of any decision would be a second place
 * that decision could drift.
 */
export {
  maybeStartAgent,
  stopAgent,
  keepBrowserCopy,
  takePcCopy,
} from "../sync/replication/agent";
