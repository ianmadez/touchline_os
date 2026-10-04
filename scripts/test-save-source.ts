/**
 * Proves the browser save source works where `showOpenFilePicker` does not exist.
 *
 * This is the branch Firefox, Safari and iOS Safari take, and it cannot be reached by opening the app
 * in Chrome - so it is checked here instead, against the module itself, with the same globals those
 * browsers provide. No `showOpenFilePicker`, a real user activation, and a `<input type="file">`.
 *
 * The cases that matter are the three ways the file dialog ends: a selection, a dismissal, and a
 * scan that had no user gesture behind it at all (which happens every time the wizard mounts).
 */
import { saveSource } from "../src/lib/platform/save-source.browser";

type Handler = (event?: unknown) => void;

interface FakeInput {
  type: string;
  multiple: boolean;
  style: Record<string, string>;
  files: FakeFile[] | null;
  removed: boolean;
  addEventListener(type: string, handler: Handler): void;
  remove(): void;
  click(): void;
  fire(type: string): void;
}

interface FakeFile {
  name: string;
  size: number;
  lastModified: number;
  bytes: Uint8Array;
  arrayBuffer(): Promise<ArrayBuffer>;
}

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function makeFile(name: string, contents: string): FakeFile {
  const bytes = new TextEncoder().encode(contents);
  return {
    name,
    size: bytes.length,
    lastModified: 1_700_000_000_000,
    bytes,
    async arrayBuffer() {
      // A fresh copy each time, so a reader cannot be handed the same buffer twice.
      return bytes.slice().buffer;
    },
  };
}

interface Harness {
  inputs: FakeInput[];
  windowHandlers: Record<string, Handler[]>;
  timers: (() => void)[];
  restore(): void;
}

/**
 * Installs the globals one browser profile provides, and records what the module did with them.
 *
 * `picker` decides whether `showOpenFilePicker` exists, and `active` stands in for whether the call
 * is inside a user gesture - the two things that actually change the module's behaviour.
 */
function installBrowser(options: { picker?: boolean; active?: boolean }): Harness {
  const inputs: FakeInput[] = [];
  const windowHandlers: Record<string, Handler[]> = {};
  const timers: (() => void)[] = [];

  const windowStub = {
    addEventListener(type: string, handler: Handler) {
      (windowHandlers[type] ??= []).push(handler);
    },
    removeEventListener(type: string, handler: Handler) {
      windowHandlers[type] = (windowHandlers[type] ?? []).filter((entry) => entry !== handler);
    },
    setTimeout(callback: () => void) {
      timers.push(callback);
      return timers.length;
    },
    showOpenFilePicker: options.picker
      ? async () => [
          {
            getFile: async () => makeFile("ManagerCareer20261005120000000", "picked through the handle"),
          },
        ]
      : undefined,
  };

  const documentStub = {
    body: { appendChild: () => undefined },
    createElement: () => {
      const handlers: Record<string, Handler[]> = {};
      const input: FakeInput = {
        type: "",
        multiple: false,
        style: {},
        files: null,
        removed: false,
        addEventListener(type, handler) {
          (handlers[type] ??= []).push(handler);
        },
        remove() {
          input.removed = true;
        },
        // Deliberately does not fire `change`: a dialog that has been opened is not a dialog that
        // has been answered, and the module has to cope with the gap between the two.
        click() {},
        fire(type) {
          for (const handler of handlers[type] ?? []) handler();
        },
      };
      inputs.push(input);
      return input;
    },
  };

  const original = Object.getOwnPropertyDescriptors(globalThis);
  const define = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

  define("window", windowStub);
  define("document", documentStub);
  define("navigator", { userActivation: { isActive: options.active ?? true } });

  return {
    inputs,
    windowHandlers,
    timers,
    restore() {
      for (const key of ["window", "document", "navigator"]) {
        const descriptor = original[key];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

async function detect(): Promise<Awaited<ReturnType<typeof saveSource.detectSaves>>> {
  const pending = saveSource.detectSaves();
  // Let the module reach the point where it is waiting for the dialog, then answer it.
  await new Promise((resolve) => setImmediate(resolve));
  return pending;
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: BROWSER SAVE SOURCE TEST ===\n");

  // --- 1. Firefox: no picker, a gesture, a chosen file ---------------------------------------
  console.log("1. No showOpenFilePicker (Firefox, Safari, iOS Safari)");
  {
    const browser = installBrowser({ picker: false, active: true });
    try {
      check("reports itself as available", saveSource.unavailableReason() === null);
      check("still describes the action as a picker", saveSource.mode === "picker");

      const pending = detect();
      check("opens the browser's own file control", browser.inputs.length === 1,
        `${browser.inputs.length} input(s)`);

      const file = makeFile("ManagerCareer20261005120000000", "career save bytes");
      browser.inputs[0].files = [file];
      browser.inputs[0].fire("change");

      const candidates = await pending;
      check("returns the chosen save as a candidate", candidates.length === 1,
        candidates[0]?.fileName);
      check("identifies it as a career save, not a storage file",
        candidates[0]?.slotKind !== "database", `slotKind ${candidates[0]?.slotKind}`);
      check("cleans the input out of the page", browser.inputs[0].removed === true);

      const resolved = await saveSource.resolveCandidate({ saveId: candidates[0].id });
      check("resolves the candidate by id", resolved?.fileName === file.name);

      const bytes = await saveSource.readBytes(candidates[0]);
      check("reads back the exact bytes", new TextDecoder().decode(bytes) === "career save bytes",
        `${bytes.length} bytes`);
    } finally {
      browser.restore();
    }
  }

  // --- 2. the mount-time scan, with no gesture behind it ------------------------------------
  console.log("\n2. A scan with no user gesture (what happens when the wizard mounts)");
  {
    const browser = installBrowser({ picker: false, active: false });
    try {
      const candidates = await detect();
      check("returns nothing", candidates.length === 0);
      check("does not open a dialog it could not open anyway", browser.inputs.length === 0,
        `${browser.inputs.length} input(s)`);
      check("says nothing has been chosen yet",
        saveSource.lastScan().some((entry) => /no save file chosen/i.test(entry.label)));
    } finally {
      browser.restore();
    }
  }

  // --- 3. the dialog dismissed without a choice ---------------------------------------------
  console.log("\n3. A dismissed dialog");
  {
    const browser = installBrowser({ picker: false, active: true });
    try {
      const pending = detect();
      check("opens the dialog", browser.inputs.length === 1);

      // No `change`. This is the browser finding out the dialog closed by getting focus back.
      for (const handler of browser.windowHandlers.focus ?? []) handler();
      for (const timer of browser.timers) timer();

      const candidates = await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("detectSaves never settled after a dismissal")), 2000)
        ),
      ]);
      check("settles instead of waiting for a file that is not coming", candidates.length === 0);
    } catch (error) {
      check("settles instead of waiting for a file that is not coming", false, (error as Error).message);
    } finally {
      browser.restore();
    }
  }

  // --- 4. a storage file rather than a save --------------------------------------------------
  console.log("\n4. A file that is not a career save");
  {
    const browser = installBrowser({ picker: false, active: true });
    try {
      const pending = detect();
      browser.inputs[0].files = [makeFile("storageInfo.bin", "not a save")];
      browser.inputs[0].fire("change");
      await pending;
      check("explains which file was the wrong one",
        saveSource.lastScan().some((entry) => /storage file, not a career save/.test(entry.label)),
        saveSource.lastScan()[0]?.label.slice(0, 60));
    } finally {
      browser.restore();
    }
  }

  // --- 5. Chrome and Edge keep the better control --------------------------------------------
  console.log("\n5. Where showOpenFilePicker exists (Chrome, Edge)");
  {
    const browser = installBrowser({ picker: true, active: true });
    try {
      const candidates = await detect();
      check("uses the picker rather than the input", browser.inputs.length === 0,
        `${browser.inputs.length} input(s)`);
      check("returns the picked file", candidates.length === 1, candidates[0]?.fileName);
      const bytes = await saveSource.readBytes(candidates[0]);
      check("reads through the handle", new TextDecoder().decode(bytes) === "picked through the handle");
    } finally {
      browser.restore();
    }
  }

  console.log(
    `\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
