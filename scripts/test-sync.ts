import { saveSource } from "../src/lib/platform/save-source";
import { SyncService } from "../src/lib/sync/sync-service";

async function runSyncTest() {
  console.log("=== TOUCHLINE OS: PHASE 2 SYNC & DIFF ENGINE TEST ===");

  // Refuses the live database. This test writes snapshots, events and cache rows, so pointing it at
  // `data/touchline.db` would change the manager's own career - the same guard the other scripts in
  // this folder carry, for the same reason.
  if (!process.env.DATABASE_URL?.includes("sync-test")) {
    console.error("Refusing to run: DATABASE_URL must point at a sync-test copy, not the live database.");
    process.exit(1);
  }

  const candidates = await saveSource.detectSaves();

  if (candidates.length === 0) {
    console.error("No save candidate found to test sync. Exiting.");
    process.exit(1);
  }

  const selectedSave = candidates[0];
  console.log(`Testing Sync against save: ${selectedSave.fileName}`);

  const syncService = new SyncService();

  // Run 1: First sync (Initial Baseline)
  console.log("\n--- Executing Sync Run 1 (Initial Baseline) ---");
  const result1 = await syncService.syncCandidate(selectedSave);
  console.log(`Status: ${result1.status}`);
  console.log(`Career ID: ${result1.careerId}`);
  console.log(`Snapshot Number: ${result1.snapshotNumber}`);
  console.log(`Events Emitted: ${result1.eventsEmittedCount}`);
  result1.events.forEach((evt) => {
    console.log(`  └─ [${evt.eventType}]`, JSON.stringify(evt.payload));
  });

  // Run 2: Second sync (Testing Idempotency / No Change)
  console.log("\n--- Executing Sync Run 2 (Testing Hash Check Idempotency) ---");
  const result2 = await syncService.syncCandidate(selectedSave);
  console.log(`Status: ${result2.status}`);
  console.log(`Events Emitted: ${result2.eventsEmittedCount}`);

  console.log("\n=== PHASE 2 TEST COMPLETE ===");
}

runSyncTest().catch((err) => {
  console.error("Sync test failed:", err);
  process.exit(1);
});