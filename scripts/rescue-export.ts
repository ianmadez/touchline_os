/**
 * Builds an importable career JSON from a database file, without touching it.
 *   DATABASE_URL=<copy.db> npx tsx scripts/rescue-export.ts <careerId> <out.json>
 * Run it against a COPY: opening the database applies pending schema changes.
 */
import fs from "node:fs";

async function main() {
  const [careerId, out] = process.argv.slice(2);
  const { buildTransferPackage, incompletePackageReason } = await import("../src/lib/services/career-transfer-service");
  const pkg = await buildTransferPackage(careerId);
  if (!pkg) throw new Error(`No career ${careerId} in ${process.env.DATABASE_URL}`);
  const reason = incompletePackageReason(pkg);
  if (reason) throw new Error(`Package would be refused on import: ${reason}`);
  fs.writeFileSync(out, JSON.stringify(pkg, null, 2));
  console.log("wrote", out, JSON.stringify(pkg.counts));
}
main().catch((e) => { console.error(e); process.exit(1); });
