import { SquadService } from "../src/lib/services/squad-service";
import { EventService } from "../src/lib/services/event-service";
import { UserProfileService } from "../src/lib/services/user-profile-service";

async function runPhase3Test() {
  console.log("=== TOUCHLINE OS: PHASE 3 DATA SERVICES TEST ===");

  // Refuses the live database. Step 2 of this test writes a user profile onto a real squad player, so
  // pointing it at `data/touchline.db` would change the manager's own career - the same guard the
  // other scripts in this folder carry, for the same reason.
  if (!process.env.DATABASE_URL?.includes("phase3-test")) {
    console.error("Refusing to run: DATABASE_URL must point at a phase3-test copy, not the live database.");
    process.exit(1);
  }

  const squadService = new SquadService();
  const eventService = new EventService();
  const userProfileService = new UserProfileService();

  const careerId = "career_club_1917"; // Wigan Athletic from Phase 2 sync

  // 1. Fetch Current Squad
  console.log("\n1. Fetching Active Squad...");
  const currentSquad = await squadService.getCurrentSquad(careerId);
  console.log(`Found ${currentSquad.length} players in current squad.`);

  if (currentSquad.length === 0) {
    console.error("No players found. Did you run `npm run sync:test` first?");
    process.exit(1);
  }

  const samplePlayer = currentSquad[0];
  console.log(
    `Sample Player: ${samplePlayer.name} (OVR: ${samplePlayer.overallRating}, Wage: £${samplePlayer.wage} [Provenance: ${samplePlayer.wageProvenance}])`
  );

  // 2. Set User Intent Overlay (e.g., Mark as UNTOUCHABLE and assign role)
  console.log(`\n2. Assigning User Intent to ${samplePlayer.name}...`);
  await userProfileService.setPlayerProfile({
    careerId,
    eaPlayerId: samplePlayer.eaPlayerId,
    assignedRole: "Dedicated 6",
    trustLevel: "HIGH",
    importanceMarker: "UNTOUCHABLE",
    userNotes: "Core engine of the midfield. Do not sell.",
  });

  // 3. Re-fetch Squad to Verify Overlay
  console.log("\n3. Verifying User Overlay Injection...");
  const updatedSquad = await squadService.getCurrentSquad(careerId);
  const updatedPlayer = updatedSquad.find((p) => p.eaPlayerId === samplePlayer.eaPlayerId);

  console.log(`Player: ${updatedPlayer?.name}`);
  console.log(`Assigned Role: ${updatedPlayer?.userProfile?.assignedRole}`);
  console.log(`Trust Level: ${updatedPlayer?.userProfile?.trustLevel}`);
  console.log(`Importance Marker: ${updatedPlayer?.userProfile?.importanceMarker}`);
  console.log(`Notes: ${updatedPlayer?.userProfile?.userNotes}`);

  // 4. Test Snapshot Time-Travel Query
  console.log("\n4. Testing Snapshot Time-Travel Query (Snapshot #1)...");
  const snapshot1Squad = await squadService.getSquadAtSnapshot(careerId, 1);
  console.log(`Successfully retrieved ${snapshot1Squad.length} players from Snapshot #1.`);

  // 5. Query Career Event Timeline
  console.log("\n5. Querying Career Event Timeline...");
  const timeline = await eventService.getTimeline(careerId, 10);
  console.log(`Retrieved ${timeline.length} timeline event(s):`);
  timeline.forEach((evt) => {
    console.log(`  └─ [${evt.timestamp}] ${evt.eventType} (Source: ${evt.source})`);
  });

  console.log("\n=== PHASE 3 TEST COMPLETE ===");
}

runPhase3Test().catch((err) => {
  console.error("Phase 3 test failed:", err);
  process.exit(1);
});