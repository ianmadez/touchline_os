/**
 * The shared Drizzle handle.
 *
 * The driver itself lives behind the platform `Storage` port (`@/lib/platform/storage`); this module
 * only re-exports it, so the existing `import { db } from "../db/client"` call sites keep working
 * unchanged while the target's driver is swapped underneath them.
 */
import { storage } from "../platform/storage";

export const db = storage.db;