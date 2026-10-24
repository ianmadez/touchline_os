/**
 * The version handshake between the web page and the bridge.
 *
 * The page is redeployed more often than the bridge, so the common failure is a page that has moved on
 * and a bridge started weeks ago. That has to be a sentence, not a mysterious failure halfway through a
 * sync, so both sides publish the same two numbers and both compare them before doing anything else.
 *
 * `SCHEMA_VERSION` is a fingerprint of the DDL and the migration list rather than a number somebody has
 * to remember to bump. Forgetting to bump it is the one mistake that would make this check lie, and a
 * derived hash cannot be forgotten. `MIGRATION_LEVEL` is the count of migrations, which reads plainly in
 * a log ("bridge is at 41, page at 43").
 *
 * This module deliberately holds no logic that touches a database: it is imported by the browser bundle
 * and by the bridge process, and by nothing that needs a driver.
 */
import { SCHEMA_DDL, SCHEMA_MIGRATIONS } from "../db/schema-sql";
import { sha1Hex } from "../parser/sha";

/** How many migrations this build knows about. */
export const MIGRATION_LEVEL = SCHEMA_MIGRATIONS.length;

/** A short fingerprint of the exact schema this build expects. */
export const SCHEMA_VERSION = sha1Hex(`${SCHEMA_DDL}\n${SCHEMA_MIGRATIONS.join("\n")}`).slice(0, 12);

export interface SchemaReport {
  schemaVersion?: unknown;
  migrationLevel?: unknown;
}

export type Compatibility =
  /** Both sides were built from the same schema. */
  | "same"
  /** The bridge predates the page. It has to be updated. */
  | "bridge-older"
  /** The bridge postdates the page, which means the browser is running a cached build. */
  | "page-older"
  /** The bridge did not say, which is a bridge old enough to have no such field. */
  | "unknown";

/** Compares what a bridge reported against what this build expects. */
export function compareSchema(report: SchemaReport | null | undefined): Compatibility {
  if (!report || typeof report.schemaVersion !== "string" || report.schemaVersion === "") return "unknown";
  if (report.schemaVersion === SCHEMA_VERSION) return "same";

  const theirs = typeof report.migrationLevel === "number" ? report.migrationLevel : null;
  if (theirs === null) return "unknown";
  if (theirs < MIGRATION_LEVEL) return "bridge-older";
  if (theirs > MIGRATION_LEVEL) return "page-older";
  // Same migration count, different fingerprint: the DDL itself moved without a migration (a new index,
  // say), so neither side can be called the older one. Updating the bridge is the resolution that is
  // always safe, because the download is built from the same source as the page.
  return "unknown";
}

/**
 * The sentence a manager reads. Plain, and it names the action rather than the cause.
 *
 * `unknown` is treated as "older" on purpose: a bridge with no version field at all cannot be newer than
 * this build, and it is exactly the stale-download case the update step in the bridge README covers.
 */
export function compatibilityMessage(state: Compatibility): string | null {
  if (state === "same") return null;
  if (state === "page-older") {
    return "This bridge is newer than the web page. Refresh the web page to catch up.";
  }
  return "This bridge is older than the web page. Update the bridge.";
}

/** True when the two may talk to each other at all. */
export function compatible(state: Compatibility): boolean {
  return state === "same";
}
