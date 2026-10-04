import type { NextConfig } from "next";

/**
 * Two targets, one source tree.
 *
 * `npm run dev` / `npm run build` leave `TOUCHLINE_TARGET` unset and get the local Node app, exactly
 * as before. `npm run dev:browser` / `npm run build:browser` set it to `browser` and get a static
 * export for Cloudflare Pages.
 *
 * The browser build must not contain the Node-only route handlers. Those are identified by their
 * `route.node.ts` file name: `node.ts` is a page extension for the Node target only, so the browser
 * build never resolves them as route handlers at all.
 */
const target = process.env.TOUCHLINE_TARGET === "browser" ? "browser" : "node";

/** The default app-router extensions, plus `node.ts` for the Node-only route handlers. */
const nodePageExtensions = ["tsx", "ts", "jsx", "js", "node.ts"];
const browserPageExtensions = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig =
  target === "browser"
    ? {
        // A folder of files, with no server: every route handler is named `route.node.ts` and is
        // not a page extension for this target, and every screen reads its data through the API
        // port instead of over HTTP.
        output: "export",
        // With `output: "export"`, `distDir` IS the output directory - the folder of files that gets
        // uploaded. Keeping it separate from `.next` means building or serving the browser target
        // never invalidates the `next dev` cache of the local app that is running alongside it.
        distDir: "out-browser",
        // There is no image optimizer to call: with a static export the default loader's `/_next/image`
        // endpoint does not exist, so every `next/image` would 404. This emits the plain image instead.
        images: { unoptimized: true },
        pageExtensions: browserPageExtensions,
        trailingSlash: true,
        turbopack: {
          // Prefer a `.browser.ts` twin over the `.ts` module when both exist, so an extensionless
          // import of a platform port resolves to the browser implementation and every other import
          // is unaffected. This overwrites the defaults, so they are repeated here.
          resolveExtensions: [".browser.ts", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
        },
      }
    : {
        pageExtensions: nodePageExtensions,
      };

export default nextConfig;
