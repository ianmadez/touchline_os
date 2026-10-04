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

/** Where save files come from, and how their bytes are read. */
export interface SaveSource {
  /**
   * How this runtime finds a save, which decides how the UI should describe the action.
   *
   * `folders` means it enumerates known locations on disk and "re-scan" is the honest word for it.
   * `picker` means the manager chooses the file, and telling them to re-scan folders would describe
   * something that does not exist.
   */
  readonly mode: "folders" | "picker";
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
   * Caches face images for everyone in a career's squad.
   *
   * Called by the sync after it commits. It has to come through the port rather than being imported
   * directly, because the local implementation reads and writes `public/faces` on disk and shared
   * code that reaches it cannot be built for a browser. The browser implementation is a no-op: faces
   * are switched off there and the face component already renders initials on its own.
   */
  refreshSquadFaces(careerId: string): Promise<void>;
  /** Writes an export and reports where it landed and how big it is. */
  writeExport(fileName: string, contents: string): Promise<{ path: string; sizeBytes: number }>;
  /** Where exports land, for display. Null when the target has no meaningful location. */
  exportsLocation(): string | null;
}
