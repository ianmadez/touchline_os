/**
 * The actions replication offers a screen, as a build-time switch point.
 *
 * The local Node build owns the career outright and has nothing to replicate to, so everything here is a
 * no-op there. The browser build substitutes the real implementation (`agent.ts`), which is the only
 * module that holds a timer and talks to `/sync/*`.
 *
 * This indirection is not ceremonial: `agent.ts` imports `platform/storage`, and on the Node target that
 * is better-sqlite3. A screen importing the agent directly would drag a native database driver into the
 * client bundle of the desktop build. Screens import this file instead, so which implementation they get
 * is decided by the build, exactly as `api-client` and `storage` already are.
 */
export function maybeStartAgent(): void {
  // Nothing to do: the desktop app is the only copy.
}

export function stopAgent(): void {
  // Nothing to stop.
}

export async function keepBrowserCopy(careerId: string): Promise<boolean> {
  // The desktop build owns the only copy, so there is nothing to send anywhere.
  void careerId;
  return false;
}

export async function takePcCopy(careerId: string): Promise<boolean> {
  // The desktop build's copy IS the PC's copy, so this would be replacing a database with itself.
  void careerId;
  return false;
}
