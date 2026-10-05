/**
 * Proves the bridge's security contract, against a real server on a real port.
 *
 * The bridge hands a file off the user's disk to a web page, so the assertions that matter are the
 * refusals, not the happy path:
 *
 *   - an origin that is not on the allowlist must get NO CORS header, which is what makes the browser
 *     block the page from reading the response
 *   - `Access-Control-Allow-Origin` must never be `*`, or any site the user visits could pull their save
 *   - a missing or wrong pairing code must be refused even from an allowed origin
 *   - the bytes must arrive byte-for-byte, which a 200 alone would not prove
 *
 * It builds the server in-process on an ephemeral port rather than spawning one, so it asserts the
 * headers directly instead of through a shell.
 *
 * Touches no database: the bridge scans folders and reads files, and never opens the app's data. The
 * copy guard the other scripts in this folder carry would be meaningless here.
 *
 *   npx tsx scripts/test-bridge.ts
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createBridgeServer,
  CODE_HEADER,
  loadOrCreateConfig,
  type BridgeConfig,
} from "../bridge/bridge-server";

/** A loopback origin: allowed, and the one the static export is served from during testing. */
const ALLOWED_ORIGIN = "http://localhost:4173";

/** A Pages origin, which the allowlist tolerates so preview deployments work. */
const PAGES_ORIGIN = "https://touchline-os.pages.dev";

/** Anything else: must be refused. */
const FOREIGN_ORIGIN = "https://not-our-site.example.com";

/** Matches the code pattern: no I, O, 0 or 1. */
const CODE = "ABCD23";

interface Probe {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * One request. Built on `node:http` rather than `fetch` on purpose: `Origin` is a forbidden header name
 * in the fetch spec, so a browser-shaped client may drop it - and this whole file is about what happens
 * for a given Origin. Driving the socket directly avoids that entire question.
 */
function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function json(probe: Probe): Record<string, unknown> {
  try {
    return JSON.parse(probe.body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  console.log("=== TOUCHLINE OS: BRIDGE TEST ===\n");

  const config: BridgeConfig = { code: CODE, port: 0 };
  const server = createBridgeServer(config);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  console.log(`Bridge listening on 127.0.0.1:${port} (ephemeral)\n`);

  try {
    // ---------------------------------------------------------------- discovery
    console.log("1. Discovery (/status), which cannot be behind a code");
    const status = await request(port, "/status");
    const statusBody = json(status);
    check("answers without a pairing code", status.status === 200, `status ${status.status}`);
    check(
      "identifies itself so a page can tell a bridge from anything else on the port",
      statusBody.service === "touchline-bridge",
      `service "${String(statusBody.service)}"`
    );
    check(
      "says nothing about the save",
      !("saves" in statusBody) && !("path" in statusBody),
      `keys: ${Object.keys(statusBody).join(", ")}`
    );

    const statusForeign = await request(port, "/status", { headers: { origin: FOREIGN_ORIGIN } });
    check(
      "a foreign origin gets no CORS header, so the browser blocks the read",
      statusForeign.status === 200 && !statusForeign.headers["access-control-allow-origin"],
      statusForeign.headers["access-control-allow-origin"]
        ? `leaked "${String(statusForeign.headers["access-control-allow-origin"])}"`
        : "no ACAO header"
    );

    // ---------------------------------------------------------------- pairing gate
    console.log("\n2. The pairing code is the gate");
    const noCode = await request(port, "/saves", { headers: { origin: ALLOWED_ORIGIN } });
    check("refuses /saves without a code", noCode.status === 401, `status ${noCode.status}`);

    const wrongCode = await request(port, "/saves", {
      headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: "ZZZZ99" },
    });
    check("refuses a wrong code", wrongCode.status === 401, `status ${wrongCode.status}`);

    const lowerCase = await request(port, "/saves", {
      headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE.toLowerCase() },
    });
    check(
      "accepts the code typed in lower case, as a human might",
      lowerCase.status === 200,
      `status ${lowerCase.status}`
    );

    const good = await request(port, "/saves", {
      headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE },
    });
    check("accepts the right code", good.status === 200, `status ${good.status}`);

    // ---------------------------------------------------------------- CORS
    console.log("\n3. CORS: an allowlist, never a wildcard");
    const acao = good.headers["access-control-allow-origin"];
    check(
      "echoes the exact origin rather than *",
      acao === ALLOWED_ORIGIN,
      `Access-Control-Allow-Origin: ${String(acao)}`
    );
    check(
      "sets Access-Control-Allow-Private-Network for the PNA preflight",
      good.headers["access-control-allow-private-network"] === "true",
      String(good.headers["access-control-allow-private-network"] ?? "(absent)")
    );
    check(
      "allows the pairing-code header on the request",
      String(good.headers["access-control-allow-headers"] ?? "")
        .toLowerCase()
        .includes(CODE_HEADER),
      String(good.headers["access-control-allow-headers"] ?? "(absent)")
    );

    const pages = await request(port, "/saves", {
      headers: { origin: PAGES_ORIGIN, [CODE_HEADER]: CODE },
    });
    check(
      "allows a Cloudflare Pages origin so preview deploys work",
      pages.headers["access-control-allow-origin"] === PAGES_ORIGIN,
      String(pages.headers["access-control-allow-origin"] ?? "(absent)")
    );

    const foreign = await request(port, "/saves", {
      headers: { origin: FOREIGN_ORIGIN, [CODE_HEADER]: CODE },
    });
    check(
      "a foreign origin gets NO CORS header even WITH the right code",
      !foreign.headers["access-control-allow-origin"],
      "the code is not a substitute for the origin check, and vice versa"
    );

    // ---------------------------------------------------------------- preflight
    console.log("\n4. Preflight (both ordinary CORS and Private Network Access)");
    const preflight = await request(port, "/saves", {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-private-network": "true",
      },
    });
    check("answers an allowed preflight with 204", preflight.status === 204, `status ${preflight.status}`);
    check(
      "and carries the PNA grant the browser asked for",
      preflight.headers["access-control-allow-private-network"] === "true",
      String(preflight.headers["access-control-allow-private-network"] ?? "(absent)")
    );

    const preflightForeign = await request(port, "/saves", {
      method: "OPTIONS",
      headers: { origin: FOREIGN_ORIGIN, "access-control-request-method": "GET" },
    });
    check(
      "refuses a preflight from an unlisted origin",
      preflightForeign.status === 403,
      `status ${preflightForeign.status}`
    );

    // ---------------------------------------------------------------- the bytes
    console.log("\n5. The bytes, byte for byte");
    const list = json(good);
    const saves = (list.saves ?? []) as { id: string; filePath: string; fileName: string }[];
    check("the candidate list is non-empty", saves.length > 0, `${saves.length} candidate(s)`);

    if (saves.length > 0) {
      const first = saves[0];
      const fetched = await request(port, `/saves/${encodeURIComponent(first.id)}`, {
        headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE },
      });
      check("serves the file", fetched.status === 200, `status ${fetched.status}`);

      const onDisk = fs.readFileSync(first.filePath);
      check(
        "the served bytes equal the file on disk exactly",
        fetched.body.equals(onDisk),
        `served ${fetched.body.byteLength} bytes, on disk ${onDisk.byteLength}`
      );
      check(
        "declares a length, so a short read cannot pass as a complete file",
        Number(fetched.headers["content-length"]) === onDisk.byteLength,
        `content-length ${String(fetched.headers["content-length"] ?? "(absent)")}`
      );

      const missing = await request(port, "/saves/does-not-exist", {
        headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE },
      });
      check("404s an unknown id rather than serving anything", missing.status === 404, `status ${missing.status}`);
    }

    // ---------------------------------------------------------------- misc
    console.log("\n6. Everything else is refused");
    const unknown = await request(port, "/../secret", {
      headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE },
    });
    check("404s an unknown route", unknown.status === 404, `status ${unknown.status}`);

    const post = await request(port, "/saves", {
      method: "POST",
      headers: { origin: ALLOWED_ORIGIN, [CODE_HEADER]: CODE },
    });
    check("405s a write attempt: this server only ever reads", post.status === 405, `status ${post.status}`);
    // ---------------------------------------------------------------- the config file
    console.log("\n7. The remembered pairing code survives a byte-order mark");
    const configFile = path.join(os.tmpdir(), `touchline-bridge-test-${process.pid}.json`);
    const remembered = "QWER45";
    // Exactly what PowerShell's `Set-Content -Encoding utf8` writes, and what Notepad writes when a file
    // is saved as UTF-8. `JSON.parse` rejects a leading BOM and Node does not strip it, so without the
    // handling in `loadOrCreateConfig` a config the manager had merely opened and re-saved would fail to
    // parse, be treated as absent, and silently mint a new code - pairing would appear to break on its
    // own, with nothing to explain why.
    fs.writeFileSync(
      configFile,
      `\uFEFF${JSON.stringify({ code: remembered, port: 4977 })}`,
      "utf8"
    );
    const loaded = loadOrCreateConfig(4977, {
      TOUCHLINE_BRIDGE_CONFIG: configFile,
    } as unknown as NodeJS.ProcessEnv);
    check(
      "keeps the remembered code rather than minting a new one",
      loaded.code === remembered,
      `expected "${remembered}", got "${loaded.code}"`
    );
    fs.rmSync(configFile, { force: true });  } finally {
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
