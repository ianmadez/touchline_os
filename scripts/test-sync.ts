import { FeasibilitySaveParser } from "../src/lib/parser/feasibility-parser";
import { SyncService } from "../src/lib/sync/sync-service";

async function runSyncTest() {
  console.log("=== TOUCHLINE OS: PHASE 2 SYNC & DIFF ENGINE TEST ===");

  const parser = new FeasibilitySaveParser();
  const candidates = await parser.detectSaves();

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