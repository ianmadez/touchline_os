/**
 * Proves the scan offers only files that could be a career, and that the split is the one the list
 * needs rather than a guess about names.
 *
 * The bug this covers, in the manager's words: "0.00 MB test saves appear in the picker". Three
 * different things were producing them, so three kinds of file have to be excluded here or the fix is
 * only covering the one that happened to be reported:
 *
 *   - an empty file, or one left half-written by an interrupted copy
 *   - a fixture small enough to render as `0.00 MB` at two decimal places
 *   - a reference save in a folder that says it is not the manager's, which the scan walked into
 *
 * And one thing must SURVIVE all three: an ordinary career save, which is what the list is for.
 *
 * No database, no network, no real save folder: everything happens in a temporary directory. Run with
 *   npx tsx scripts/test-save-scan.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSource } from "../src/lib/platform/save-source";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Writes a file of the given size without allocating every byte for the big ones. */
function writeSave(file: string, bytes: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: WHAT THE SAVE SCAN OFFERS ===\n");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "touchline-scan-test-"));
  const MB = 1024 * 1024;

  writeSave(path.join(root, "ManagerCareer20261010032537767"), 2.5 * MB);
  writeSave(path.join(root, "Career20180108121239"), 2729);
  writeSave(path.join(root, "ManagerCareer20250101000000000"), 0);
  writeSave(path.join(root, "settings", "ManagerCareer20240909101010101"), 4 * MB);
  writeSave(path.join(root, "not-my-own-saves", "CmMgrC20261006225936249"), 15.7 * MB);
  writeSave(path.join(root, "not-my-own-saves", "extracted_fc27_db.bin"), 7.5 * MB);
  writeSave(path.join(root, "Squads20261010"), 3 * MB);

  try {
    const candidates = await saveSource.detectSaves(root);
    const names = candidates.map((candidate) => candidate.fileName).sort();

    console.log(`Offered (${names.length}): ${names.join(", ") || "(none)"}\n`);

    check(
      "offers the real career save",
      names.includes("ManagerCareer20261010032537767"),
      "2.5 MB"
    );
    check(
      "offers a career nested in a subfolder, which older games do",
      names.includes("ManagerCareer20240909101010101"),
      "settings/"
    );
    check("drops the empty file", !names.includes("ManagerCareer20250101000000000"), "0 bytes");
    check("drops the tiny fixture", !names.includes("Career20180108121239"), "2.7 KB");
    check(
      "drops everything inside a not-my-own folder",
      !names.includes("CmMgrC20261006225936249") && !names.includes("extracted_fc27_db.bin"),
      "the folder is never walked"
    );
    check("keeps dropping storage files", !names.includes("Squads20261010"), "Squads is not a career");

    check(
      "and offers nothing else",
      candidates.length === 2,
      `${candidates.length} candidate(s), expected 2`
    );

    // The size band is a filter on what is OFFERED. A path the manager hands over still resolves, so
    // a save the scan would not list is not a save the app refuses to open.
    const small = path.join(root, "Career20180108121239");
    const resolved = await saveSource.resolveCandidate({ savePath: small });
    check(
      "an explicitly chosen small save still opens",
      resolved?.fileName === "Career20180108121239",
      resolved ? `${resolved.fileSizeBytes} bytes` : "refused"
    );
    const empty = await saveSource.resolveCandidate({
      savePath: path.join(root, "ManagerCareer20250101000000000"),
    });
    check("but an empty one is still refused", empty === null, empty ? "allowed" : "null");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(
    `\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`
  );
  if (failures > 0) process.exit(1);
}

void main();
