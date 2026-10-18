/**
 * The save watcher: the reason a career can change while nobody is looking at the app.
 *
 * Every other way of getting a save into TouchlineOS needs a page open - the wizard, the file picker,
 * the bridge handing bytes to a tab. A phone cannot read `Documents/FC 26/settings` at all. So the core,
 * which is the only thing in this system that can see the save file, reads it itself and runs the same
 * parse and sync the app would have run: `parse-save` is imported here rather than reimplemented, so a
 * save imported by the watcher and a save imported by the wizard produce identical rows and identical
 * events. There is one decode pipeline, and it is the one every other path already uses.
 *
 * It watches the files it has already seen rather than the folders: a stat of a handful of known paths
 * is cheap enough to do on a timer, a directory walk is not. A new save appearing in a folder that was
 * empty when the core started is caught by the same full scan that runs every few minutes, which also
 * picks up a save directory that changed.
 *
 * The watcher follows the sharing switch. A core that is not shared does not touch the career on its
 * own, because a manager reading a career on their own PC expects the app to be the thing that writes
 * to it.
 */
import type { SaveCandidate } from "../src/lib/parser/interface";
import { parseAndSyncSave } from "../src/lib/operations/parse-save";
import { saveSource } from "../src/lib/platform/save-source";

/** How often a stat pass runs. Short enough to feel like "it noticed", long enough to be free. */
export const WATCH_INTERVAL_MS = 15_000;

/** How often the full scan runs, so a save in a folder nothing had seen before is still found. */
export const FULL_SCAN_INTERVAL_MS = 5 * 60_000;

export interface WatchOutcome {
  at: string;
  fileName: string;
  /** `NO_CHANGE` means the bytes were re-read and the database already agreed. */
  status: "NO_CHANGE" | "SYNCED" | "FAILED";
  eventsEmitted: number;
  /** Present when a sync ran and produced one, so the console can say what it saw. */
  message?: string;
}

export interface SaveWatcherOptions {
  onOutcome?: (outcome: WatchOutcome) => void;
  /** Fires when a sync actually wrote something, which is what other devices need to hear about. */
  onChanged?: (outcome: WatchOutcome) => void;
  log?: (line: string) => void;
  /** Overridden by tests so a check does not wait fifteen seconds. */
  intervalMs?: number;
  fullScanMs?: number;
  /**
   * The scan, and the sync.
   *
   * Both are seams for the test: the real ones walk this machine's save folders and parse a real save,
   * which is neither fast nor something a unit check should depend on. The defaults are the real
   * functions, so production behaviour has no branch of its own.
   */
  detect?: () => Promise<SaveCandidate[]>;
  syncCandidate?: (candidate: SaveCandidate) => Promise<WatchOutcome>;
}

export interface SaveWatcher {
  start: () => void;
  stop: () => void;
  /** One pass, now. Used on start and by tests. */
  check: () => Promise<WatchOutcome | null>;
  /** The most recent outcome, for the console banner and for `/status`. */
  last: () => WatchOutcome | null;
}

function signature(candidate: SaveCandidate): string {
  return `${candidate.filePath}|${candidate.lastModified.getTime()}|${candidate.fileSizeBytes}`;
}

/** The newest career save in a list. `database` slots are storage blobs, not careers. */
export function pickNewestCandidate(candidates: SaveCandidate[]): SaveCandidate | null {
  const careers = candidates.filter((candidate) => candidate.slotKind !== "database");
  if (careers.length === 0) return null;
  return careers.reduce((newest, candidate) =>
    candidate.lastModified.getTime() > newest.lastModified.getTime() ? candidate : newest
  );
}

/**
 * Parses the save and syncs the database, through the same operation the app's own screen calls.
 *
 * The body shape is the operation's, and every branch is reported rather than thrown: a save that
 * cannot be read is a normal thing to happen to a file the game may be mid-write on, and the next pass
 * tries again.
 */
async function syncNewest(candidate: SaveCandidate): Promise<WatchOutcome> {
  const outcome: WatchOutcome = {
    at: new Date().toISOString(),
    fileName: candidate.fileName,
    status: "FAILED",
    eventsEmitted: 0,
  };

  try {
    const result = await parseAndSyncSave(JSON.stringify({ saveId: candidate.id }));
    const body = result.body as {
      success?: boolean;
      syncStatus?: "NO_CHANGE" | "SYNCED";
      eventsEmitted?: number;
      error?: string;
    };

    if (result.status === 200 && body?.success) {
      outcome.status = body.syncStatus === "SYNCED" ? "SYNCED" : "NO_CHANGE";
      outcome.eventsEmitted = body.eventsEmitted ?? 0;
      if (outcome.status === "SYNCED") {
        outcome.message = `${outcome.eventsEmitted} change(s) recorded`;
        console.log(`  synced ${candidate.fileName}: ${outcome.message}`);
      }
      return outcome;
    }

    outcome.message = body?.error ?? `the parse answered ${result.status}`;
    console.log(`  could not read ${candidate.fileName}: ${outcome.message}`);
    return outcome;
  } catch (error) {
    outcome.message = (error as Error).message;
    console.log(`  could not read ${candidate.fileName}: ${outcome.message}`);
    return outcome;
  }
}

export function createSaveWatcher(options: SaveWatcherOptions = {}): SaveWatcher {
  const log = options.log ?? ((line: string) => console.log(line));
  const intervalMs = options.intervalMs ?? WATCH_INTERVAL_MS;
  const fullScanMs = options.fullScanMs ?? FULL_SCAN_INTERVAL_MS;
  const detect = options.detect ?? (() => saveSource.detectSaves());

  let timer: NodeJS.Timeout | null = null;
  let lastSeen = new Map<string, string>();
  let lastFullScan = 0;
  let lastOutcome: WatchOutcome | null = null;
  let running = false;

  const sync = options.syncCandidate ?? syncNewest;

  const check = async (): Promise<WatchOutcome | null> => {
    if (running) return lastOutcome;
    running = true;
    try {
      const full = Date.now() - lastFullScan >= fullScanMs;
      if (full) lastFullScan = Date.now();

      const candidates = await detect();
      const newest = pickNewestCandidate(candidates);

      // The first pass always syncs: it is also how a core with an empty database gets its career,
      // and re-running it over unchanged data is a no-change by construction.
      const fresh = lastSeen.size === 0;
      if (!newest) return null;

      const current = signature(newest);
      const known = lastSeen.get(newest.filePath);
      const changed = fresh || full || known !== current;

      // Every candidate is remembered, so a save the manager switched to counts as new even though
      // the file itself is old.
      lastSeen = new Map(candidates.map((candidate) => [candidate.filePath, signature(candidate)]));

      if (!changed) return lastOutcome;

      const outcome = await sync(newest);
      lastOutcome = outcome;
      options.onOutcome?.(outcome);
      if (outcome.status === "SYNCED") options.onChanged?.(outcome);
      return outcome;
    } catch (error) {
      log(`  save watch failed: ${(error as Error).message}`);
      return lastOutcome;
    } finally {
      running = false;
    }
  };

  return {
    start: () => {
      if (timer) return;
      void check();
      timer = setInterval(() => void check(), intervalMs);
      // Never the reason the process stays alive: Ctrl+C has to be enough to stop this.
      timer.unref();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    check,
    last: () => lastOutcome,
  };
}
