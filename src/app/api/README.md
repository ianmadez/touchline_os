# Why there is no `route.ts` here

Every handler in this folder is named **`route.node.ts`**, not `route.ts`. That is deliberate, and it is
the whole mechanism that lets one source tree produce two builds.

`next.config.ts` gives each target its own `pageExtensions`:

| Target | Page extensions |
|---|---|
| `npm run dev` / `npm run build` (the local Node app) | `tsx`, `ts`, `jsx`, `js`, **`node.ts`** |
| `npm run build:browser` (the static export) | `tsx`, `ts`, `jsx`, `js` |

`node.ts` is only a page extension for the Node target, so to the browser target these files are not
route handlers at all - they are not even resolved. That matters because the browser build is a static
export (`output: "export"`) served from Cloudflare Pages, which cannot run a route handler, and because
several of these handlers reach for the filesystem.

The screens still call the same URLs. Under the Node target `@/lib/platform/api-client` is `fetch` and
the request reaches these files as it always has; under the browser target the same URL is answered in
the page by calling the operation directly, through `@/lib/operations/*`.

So:

- **Do not** add or rename a plain `route.ts` here. Doing so puts a route handler back into the static
  export, which fails the browser build, and it splits each endpoint's behaviour across two files.
- **Do not** move the logic into the handler. Each file here is a thin adapter: it translates `Request`
  in and `NextResponse` out. The behaviour lives in `src/lib/operations/`, which is what the browser
  build calls with no HTTP hop in between.
- A route whose *contract* is unusual - `debrief`, `season/blocks` and `parse-save` answer a
  non-JSON body with a 500 rather than a 400, because their handlers have always parsed the body inside
  their own `try` - passes the **raw body text** to the operation, and the operation parses it. Keeping
  that in one place is why the two runtimes agree.

If a handler ever needs a new endpoint, add `route.node.ts` plus an operation, then add the URL to the
dispatch table in `src/lib/platform/api-client.browser.ts`. That table is the only place that knows the
URL-to-operation mapping.
