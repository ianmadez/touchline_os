/**
 * Runtime configuration for the local Node build.
 *
 * There used to be a second save-location list here, `savesSearchPaths`, and it is deliberately gone.
 * Nothing ever read it - the scan uses `searchLocations()` in `platform/save-source.ts` - and by the
 * time it was removed it had already drifted from that list: it built paths from
 * `USERPROFILE/AppData/Local` instead of the `LOCALAPPDATA` the scan prefers, and knew nothing about
 * the Roaming or OneDrive folders, including the env-var-driven OneDrive variants. Two lists of save
 * locations that must agree, living in two files, updated at two different times, is exactly how a
 * save gets found by one code path and silently missed by another. One list, in the module that
 * actually performs the scan.
 */
import path from "path";

export interface AppConfig {
  databasePath: string;
}

export const config: AppConfig = {
  databasePath: process.env.DATABASE_URL || path.join(process.cwd(), "data", "touchline.db"),
};