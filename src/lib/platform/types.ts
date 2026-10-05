/**
 * Runtime ports.
 *
 * One source tree has to run in two places: the local Node build (today's `npm run dev`) and a
 * static browser build. Everything that genuinely differs between them is expressed as one of these
 * interfaces, so shared code never asks "which target am I running in?" - it asks the port.
 *
 * The local build uses the Node implementations in `./save-source`, `./storage` and `./asset-store`.
 * The browser target substitutes those three modules at build time, which is why nothing else in the
 * codebase may import a Node-only module directly.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import type { SaveCandidate, SaveSearchLocation } from "../parser/interface";

/** The Drizzle handle the services talk to, bound to the app schema. */
export type AppDatabase = BetterSQLite3Database<typeof schema>;

/**
 * What a runtime knows about a save file it has already been given.
 *
 * `none` covers both "nothing remembered" and "the manager refused this file": those are the same
 * situation from the UI's point of view, and both end at the file picker. `granted` is the state that
 * lets a visit sync itself with no interaction, and `needs-permission` means a save is remembered but
 * only the manager can confirm access - which, by design, can never happen silently.
 */
export type RememberedSave = "none" | "granted" | "needs-permission";

/**
 * How a runtime gets at a save file.
 *
 * `folders` enumerates known locations on disk; `picker` has the manager choose a file; `bridge` asks a
 * small helper program the manager runs on their own machine. All three produce the same candidates,
 * which is why everything downstream of them is identical.
 */
export type SaveSourceMode = "folders" | "picker" | "bridge";

/**
 * What the optional local bridge is doing.
 *
 * Declared here rather than beside the browser implementation, because it is part of what the port
 * promises the UI - and the UI has to be able to render this without knowing which runtime it is in.
 */
export type BridgeState =
  /** Not switched on. Nothing has been requested, and nothing will be. */
  | "off"
  /** Switched on, but nothing answered on the port. The bridge is probably not running. */
  | "unreachable"
  /** Switched on, reachable, and the pairing code was accepted. */
  | "paired"
  /** Switched on and reachable, but there is no code yet or the bridge rejected it. */
  | "needs-code"
  /** This runtime has no bridge concept at all. The UI hides the feature rather than disabling it. */
  | "unsupported";

/**
 * The bridge's default port.
 *
 * Lives here rather than beside the browser client so the operation layer can default it too: the port
 * has to be quoted in two places or neither, and one of them drifting is how a "bridge not found" gets
 * reported for a bridge that is running perfectly well. Chosen to avoid 4126, which the reference
 * companion uses and which a manager may therefore already have occupied.
 */
export const DEFAULT_BRIDGE_PORT = 4977;

/** Where save files come from, and how their bytes are read. */
export interface SaveSource {
  /**
   * How this runtime finds a save, which decides how the UI should describe the action.
   *
   * `folders` means it enumerates known locations on disk and "re-scan" is the honest word for it.
   * `picker` means the manager chooses the file, and telling them to re-scan folders would describe
   * something that does not exist.
   *
   * `bridge` is the browser build talking to the optional helper the manager runs themselves. It is only
   * ever reported when a bridge is paired AND answering, so a browser reporting `picker` is one with no
   * bridge in play rather than one where the feature has failed.
   */
  readonly mode: SaveSourceMode;
  /** Candidates to offer, using the default save locations when `saveDirectory` is omitted. */
  detectSaves(saveDirectory?: string): Promise<SaveCandidate[]>;
  /**
   * Resolves a sync request into one concrete candidate.
   *
   * The desktop build resolves an explicit filesystem path first and treats it as authoritative;
   * a page has no paths at all, so the browser build resolves the picked file's id instead. Keeping
   * the rule here is what lets the browser build drop the path entirely rather than special-casing
   * a field it can never honour.
   */
  resolveCandidate(request: { savePath?: string; saveId?: string }): Promise<SaveCandidate | null>;
  /** The raw bytes of one candidate. */
  readBytes(candidate: SaveCandidate): Promise<Uint8Array>;
  /** The locations the last `detectSaves` probed, so the UI can explain an empty result. */
  lastScan(): SaveSearchLocation[];
  /**
   * Why this runtime cannot offer saves at all, or null when it can.
   *
   * The browser build returns a plain-language reason on browsers without the File System Access
   * API. Surfacing it lets the UI say so honestly instead of showing a control that does nothing.
   */
  unavailableReason(): string | null;
  /**
   * What this runtime knows about a save it was already given.
   *
   * A page cannot enumerate a filesystem, so "finding a save automatically" can only ever mean "still
   * being allowed to read the one that was picked". The desktop build always answers `none`: it
   * enumerates folders, so it has nothing to remember and nothing to re-ask for.
   */
  rememberedSave(): Promise<RememberedSave>;
  /**
   * Re-opens the remembered save, asking for access if it has to. MUST be called from a user gesture.
   *
   * A browser refuses to grant access to a file without one, so this can never be run on page load -
   * the whole point is that it hangs off a button. Returns null when nothing is remembered, access was
   * refused, or the file has gone since it was picked. The desktop build always returns null.
   */
  reconnectRememberedSave(): Promise<SaveCandidate | null>;
  /**
   * Drops the remembered save, so the next `detectSaves` falls back to asking for a file.
   *
   * This is the "use a different save" path, and it has to exist: a browser that already holds a
   * granted handle would otherwise keep handing back that same save, with no way to point the app at
   * another one.
   */
  forgetRememberedSave(): Promise<void>;
  /**
   * What the optional local bridge is doing.
   *
   * OPTIONAL, and absent on the desktop build on purpose. That build already scans this machine's save
   * folders directly, so a helper process running alongside it would add a moving part and no
   * capability at all. Absent means "this runtime has no bridge", which the UI answers by hiding the
   * feature rather than by showing a control that could never work.
   */
  bridgeStatus?(): Promise<BridgeState>;
  /**
   * Switches the bridge on and checks a pairing code, reporting the state that left it in.
   *
   * Only ever called from a click. Pairing is a decision the manager makes; nothing should begin talking
   * to a port on their machine because a page happened to load.
   */
  pairBridge?(port: number, code: string): Promise<BridgeState>;
  /**
   * Switches the bridge off and forgets the code, so no future visit requests anything.
   *
   * The counterpart to pairing, and it has to exist for the same reason the save-permission work needed
   * a Disconnect: a connection the manager cannot see or end is not a feature, it is a leak.
   */
  forgetBridge?(): Promise<void>;
}

/** The persistence seam. */
export interface Storage {
  readonly db: AppDatabase;
  /**
   * Runs `work` atomically.
   *
   * Synchronous by contract. The local driver's transactions are synchronous and the shared code is
   * written to keep every write inside the callback synchronous, so the callback is deliberately
   * typed as returning `T` - not `T | Promise<T>`. An implementation that cannot offer synchronous
   * transactions must say so rather than committing early and calling it atomic.
   */
  withTransaction<T>(work: (tx: AppDatabase) => T): T;
  /** Describes where the data lives, for the diagnostics panel. */
  databaseInfo(): Promise<{ location: string | null; exists: boolean; sizeBytes: number | null }>;
}

/** Bytes that live outside the database: player faces and career exports. */
export interface AssetStore {
  faceExists(eaPlayerId: number): Promise<boolean>;
  readFace(eaPlayerId: number): Promise<Uint8Array | null>;
  writeFace(eaPlayerId: number, bytes: Uint8Array): Promise<void>;
  listFaces(): Promise<number[]>;
  /**
   * Caches face images for everyone in a career's senior squad.
   *
   * Called by the sync after it commits, and by the import after it applies. It has to come through
   * the port rather than being imported directly, because the local implementation reads and writes
   * `public/faces` on disk and shared code that reaches it cannot be built for a browser. The browser
   * implementation caches into OPFS, and additionally repairs its own cache on demand whenever a
   * face is rendered and found missing, so a career that arrived by import is covered too.
   */
  refreshSquadFaces(careerId: string): Promise<void>;
  /** Writes an export and reports where it landed and how big it is. */
  writeExport(fileName: string, contents: string): Promise<{ path: string; sizeBytes: number }>;
  /** Where exports land, for display. Null when the target has no meaningful location. */
  exportsLocation(): string | null;
}
