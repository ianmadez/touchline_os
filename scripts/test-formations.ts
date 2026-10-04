/**
 * The gate for multi-formation storage.
 *
 * Proves the thing the feature exists for: a manager can keep several formations, and editing one
 * never disturbs another. Run against a COPY - it writes and deletes formation rows.
 *
 *   Copy-Item data/touchline.db data/touchline.formations-test.db   # + -wal / -shm if present
 *   $env:DATABASE_URL="<abs>/data/touchline.formations-test.db"
 *   npx tsx scripts/test-formations.ts
 */
import { TacticsService } from "../src/lib/services/tactics-service";

const CAREER = process.argv[2] ?? "career_club_1917";
const GUARD = "formations-test";
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes(GUARD)) {
    console.error("Refusing to run: DATABASE_URL must point at a formations-test copy.");
    process.exit(1);
  }

  const svc = new TacticsService();
  const before = await svc.listFormations(CAREER);
  console.log(`baseline formations: ${before.length}`);

  const a = await svc.createFormation(CAREER, { formationName: "4-3-3-holding", label: "Primary" });
  const b = await svc.createFormation(CAREER, { formationName: "4-3-3-holding", label: "Plan B" });
  const c = await svc.createFormation(CAREER, { formationName: "4-3-3-holding", label: "Cup away" });

  const after = await svc.listFormations(CAREER);
  check("three formations added", after.length === before.length + 3, `${before.length} -> ${after.length}`);
  check("labels are distinct", new Set([a.label, b.label, c.label]).size === 3, `${a.label}/${b.label}/${c.label}`);

  // Edit ONLY Plan B's first slot, then confirm the others are byte-identical.
  const editedB = b.slots.map((slot, index) =>
    index === 0 ? { ...slot, playerId: "test_player", playerName: "Test" } : slot
  );
  await svc.saveTacticalSystem({ ...b, slots: editedB });

  const reloaded = await svc.listFormations(CAREER);
  const bAfter = reloaded.find((f) => f.label === b.label)!;
  const aAfter = reloaded.find((f) => f.label === a.label)!;
  const cAfter = reloaded.find((f) => f.label === c.label)!;
  check("Plan B kept its edit", bAfter.slots[0]?.playerId === "test_player", String(bAfter.slots[0]?.playerId));
  check("Primary untouched", aAfter.slots.every((s) => s.playerId === null));
  check("Cup away untouched", cAfter.slots.every((s) => s.playerId === null));
  check("saving slots does not move the default flag", bAfter.isDefault === b.isDefault);

  // Promotion is explicit, and there is exactly one current XI.
  await svc.setDefaultFormation(CAREER, b.label);
  const promoted = await svc.listFormations(CAREER);
  check(
    "exactly one default after promotion",
    promoted.filter((f) => f.isDefault).length === 1 && promoted.find((f) => f.isDefault)?.label === b.label
  );

  // The last formation is never deleted.
  await svc.deleteFormation(CAREER, a.label);
  await svc.deleteFormation(CAREER, c.label);
  await svc.deleteFormation(CAREER, b.label);
  const end = await svc.listFormations(CAREER);
  check("the last formation survives deletion", end.length === Math.max(before.length, 1), `${end.length}`);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
