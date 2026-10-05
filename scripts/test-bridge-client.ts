/**
 * Proves the browser save source works through the local bridge.
 *
 * This is the regression test for a bug that shipped: `resolveCandidate` only ever consulted the map the
 * FILE PICKER fills, so a bridge candidate - which is never "picked" - resolved to null. A sync then
 * answered 404 for a save the page had literally just displayed, and the screen showed "No EA SPORTS FC
 * career save found at that location" directly beneath the card naming that save.
 *
 * It runs the real bridge server, real `fetch`, and the real browser save source, with only the page
 * globals stubbed - so it exercises the actual code path rather than a stand-in for it.
 *
 * Touches no database: this is save discovery and byte transfer, not sync.
 *
 *   npx tsx scripts/test-bridge-client.ts
 */
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createBridgeServer } from "../bridge/bridge-server";
import { saveSource } from "../src/lib/platform/save-source.browser";
import {
  saveEmptyLabel,
  saveProvenanceLabel,
  saveRefreshLabel,
  saveScanningLabel,
  saveUnreadableMessage,
} from "../src/lib/ui/save-source-copy";

const CODE = "TEST99";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * The page globals the browser build expects.
 *
 * `localStorage` is where a pairing lives, and `document` exists only so the module can tell it *could*
 * fall back to a file input. Deliberately no `showOpenFilePicker`: the bridge path must win before
 * anything reaches for a picker, and leaving it absent is what proves that.
 */
function installPageGlobals(port: number): void {
  const store = new Map<string, string>([
    ["touchline.bridge.v1", JSON.stringify({ enabled: true, port, code: CODE })],
  ]);

  const windowStub = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = windowStub;
  globals.document = {
    body: { appendChild: () => undefined },
    createElement: () => ({
      type: "",
      multiple: false,
      style: {},
      files: null,
      addEventListener: () => undefined,
      remove: () => undefined,
      click: () => undefined,
    }),
  };
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: BRIDGE -> SAVE SOURCE TEST ===\n");

  const server = createBridgeServer({ code: CODE, port: 0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  console.log(`Bridge listening on 127.0.0.1:${port} (ephemeral)\n`);

  installPageGlobals(port);

  try {
    // ---------------------------------------------------------------- discovery
    console.log("1. The bridge supplies the saves");
    const candidates = await saveSource.detectSaves();
    check("candidates come back at all", candidates.length > 0, `${candidates.length} candidate(s)`);
    check(
      "and the mode reports the bridge rather than the picker",
      saveSource.mode === "bridge",
      `mode "${saveSource.mode}"`
    );
    check(
      "every candidate declares where it came from",
      candidates.length > 0 && candidates.every((entry) => entry.foundIn === "local bridge"),
      candidates[0]?.foundIn ?? "(none)"
    );
    check(
      "and it says so in words a manager reads",
      saveUnreadableMessage("bridge").length > 0,
      "copy available for the bridge mode"
    );

    if (candidates.length === 0) throw new Error("no bridge candidates to test with");

    // ---------------------------------------------------------------- THE BUG
    console.log("\n2. resolveCandidate resolves a bridge candidate (the shipped bug)");
    const first = candidates[0];
    const resolved = await saveSource.resolveCandidate({ saveId: first.id });
    check(
      "a bridge candidate resolves by id",
      resolved !== null,
      resolved ? `resolved "${resolved.fileName}"` : "returned null, which is what broke the sync"
    );
    check(
      "and it is the same save the list offered",
      resolved?.id === first.id,
      `${resolved?.id ?? "null"} vs ${first.id}`
    );
    check(
      "an unknown id is still refused rather than guessed",
      (await saveSource.resolveCandidate({ saveId: "not-a-real-id" })) === null,
      "no match returns null"
    );

    // ---------------------------------------------------------------- the bytes
    console.log("\n3. The bytes arrive intact");
    const bytes = await saveSource.readBytes(first);
    const onDisk = fs.readFileSync(first.filePath);
    check(
      "readBytes returns the file byte for byte",
      Buffer.from(bytes).equals(onDisk),
      `${bytes.byteLength} from the bridge, ${onDisk.byteLength} on disk`
    );

    // ---------------------------------------------------------------- the wording
    console.log("\n4. The failure message speaks the right language");
    const bridgeMessage = saveUnreadableMessage("bridge").toLowerCase();
    const folderMessage = saveUnreadableMessage("folders").toLowerCase();
    check(
      "a browser is not told to re-scan save folders",
      !bridgeMessage.includes("re-scan"),
      `"${saveUnreadableMessage("bridge")}"`
    );
    check(
      "but the desktop build still is, because it has folders to re-scan",
      folderMessage.includes("re-scan"),
      `"${saveUnreadableMessage("folders")}"`
    );

    // ---------------------------------------------------------------- one vocabulary
    console.log("\n5. One vocabulary, and only the folders mode may mention folders");
    check(
      "the folders mode re-scans folders, because it has them",
      saveRefreshLabel("folders").toLowerCase().includes("re-scan"),
      `"${saveRefreshLabel("folders")}"`
    );
    check(
      "the picker mode asks for a file instead",
      !saveRefreshLabel("picker").toLowerCase().includes("re-scan"),
      `"${saveRefreshLabel("picker")}"`
    );
    check(
      "the bridge mode refreshes from the bridge",
      saveRefreshLabel("bridge").toLowerCase().includes("bridge"),
      `"${saveRefreshLabel("bridge")}"`
    );
    check(
      "no browser mode talks about folders it cannot see",
      !["picker", "bridge"].some((mode) =>
        [saveRefreshLabel, saveScanningLabel, saveEmptyLabel].some((label) =>
          label(mode as "picker" | "bridge").toLowerCase().includes("folder")
        )
      ),
      "every non-folders string is folder-free"
    );
    check(
      "the provenance line names the bridge rather than echoing a path",
      saveProvenanceLabel("local bridge") === "Read from your local bridge",
      `"${String(saveProvenanceLabel("local bridge"))}"`
    );
    check(
      "and declares nothing when a candidate says nothing",
      saveProvenanceLabel(undefined) === null,
      "null rather than an empty line"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

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
