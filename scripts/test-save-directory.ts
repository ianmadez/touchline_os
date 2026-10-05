/**
 * Proves the configured save folder actually constrains the scan.
 *
 * The setting existed end to end and nothing read it, so a manager who typed a folder into Settings
 * got the built-in list anyway, with no sign their choice was being ignored. This checks the fix from
 * both directions in one run, because either half alone is weak evidence:
 *
 *   - with a folder set, the scan must probe EXACTLY that folder and nothing else
 *   - with the folder cleared, it must go back to the built-in list
 *
 * The second half is what stops the first from passing on a scan that simply ignores the setting and
 * happens to return one location for an unrelated reason.
 *
 * Run against a copy - this writes the settings row.
 *   $env:DATABASE_URL="<abs>/data/touchline.savedir-test.db"; npx tsx scripts/test-save-directory.ts
 */
import path from "path";
import { config } from "../src/lib/config";
import { listSaveCandidates } from "../src/lib/operations/saves";
import { SettingsService } from "../src/lib/services/settings-service";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

interface ScanReport {
  locations: number;
  labels: string[];
  paths: string[];
}

/** Saves the given folder, then runs the real operation the UI calls and reports what it probed. */
async function scanWith(saveDirectory: string): Promise<ScanReport> {
  const service = new SettingsService();
  await service.saveSettings({ saveDirectory });

  const outcome = await listSaveCandidates();
  const body = outcome.body as
    | { scannedLocations?: { path: string; label: string }[] }
    | undefined;
  const locations = body?.scannedLocations ?? [];

  return {
    locations: locations.length,
    labels: locations.map((entry) => entry.label),
    paths: locations.map((entry) => entry.path),
  };
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: CONFIGURED SAVE FOLDER TEST ===\n");

  // The guard the other writing scripts in this folder carry: this one writes the settings row, so
  // pointing it at the manager's own database would change a real preference.
  if (!config.databasePath.includes("savedir-test")) {
    console.error(
      `Refusing to run: DATABASE_URL must point at a savedir-test copy, not ${config.databasePath}.`
    );
    process.exit(1);
  }
  console.log(`Database: ${config.databasePath}\n`);

  const service = new SettingsService();
  const original = (await service.getSettings()).saveDirectory;
  const target = path.join(process.cwd(), "data", "saves");

  console.log(`Configured folder under test: ${target}\n`);

  // 1. No folder set: the built-in list, which is the scan the app has always done.
  const builtIn = await scanWith("");

  // 2. A folder set: the setting must be the whole list. This is the assertion that failed before
  //    the fix, because the folder was accepted all the way down and then never passed to the scan.
  const configured = await scanWith(target);

  // 3. Cleared again: back to the built-in list, so the override is not somehow sticky.
  const cleared = await scanWith("");

  console.log("1. No folder configured (the built-in list)");
  check(
    "scans the built-in locations",
    builtIn.locations > 1,
    `${builtIn.locations} locations: ${builtIn.labels.slice(0, 3).join(", ")}${builtIn.locations > 3 ? ", …" : ""}`
  );

  console.log("\n2. Folder configured (must constrain the scan)");
  check(
    "scans EXACTLY the configured folder",
    configured.locations === 1,
    `${configured.locations} location(s): ${configured.labels.join(", ")}`
  );
  check(
    "and that location is the configured one",
    configured.paths.length === 1 && configured.paths[0] === path.resolve(target),
    configured.paths[0] ?? "(none)"
  );
  check(
    "the built-in list is NOT also scanned",
    configured.labels[0] === "explicit path",
    `labelled "${configured.labels[0] ?? "(none)"}", which only the override branch produces`
  );

  console.log("\n3. Folder cleared again");
  check(
    "the built-in list comes back",
    cleared.locations === builtIn.locations,
    `${cleared.locations} locations, same as step 1`
  );

  // Restore whatever the manager had, so a test run leaves no trace in the copy either.
  await service.saveSettings({ saveDirectory: original });

  console.log(
    `\nBefore the fix, every scan above returned the built-in list (${builtIn.locations} locations) ` +
      `regardless of the setting. Now the configured run returns ${configured.locations}.`
  );

  if (failures > 0) {
    console.error(`\n=== ${failures} CHECK(S) FAILED ===`);
    process.exit(1);
  }
  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
