# Post-deploy checklist

Run this immediately after uploading a new `out-browser/` build to Cloudflare Pages. It is short on
purpose — if it takes long, it will not get run.

## Why this file exists

One thing here **cannot** be verified locally, and a local pass actively hides it.

The optional local bridge works by having the deployed page fetch `http://127.0.0.1:<port>`. That is a
request from a **public** origin to a **loopback** address, which is exactly what Chromium's Private
Network Access (PNA) rules are about: the browser may send a preflight carrying
`Access-Control-Request-Private-Network: true`, and the bridge must answer
`Access-Control-Allow-Private-Network: true` or the request is refused.

Testing locally does not exercise that path, because a page served from `localhost:4173` calling a bridge
on `127.0.0.1:4977` is **local → local**, not public → local. So the preflight never fires, everything
passes, and the gap stays hidden until a real user on the real domain hits it.

That is the whole reason item 3 below is not optional.

## Before uploading

- [ ] `npx tsc --noEmit --incremental false` is clean.
- [ ] `npx eslint src` is at the known baseline (currently 1 error, 2 warnings — both pre-existing).
- [ ] `npm run build:browser` exits 0.
- [ ] `npm run bridge:build` exits 0 and `public/bridge/touchline-bridge.zip` exists.
- [ ] The screenshot reader's runtime is complete: `public/ocr/worker.min.js`, the six
      `public/ocr/core/tesseract-core*.wasm.js` builds and `public/ocr/lang/eng.traineddata.gz` all exist.
      The worker and the core are staged by the build and the model is committed, so a missing one of the
      three is a build that will fail in front of a manager rather than here.

## After uploading

1. [ ] **The site loads.** Landing page renders; no blank screen.
2. [ ] **The first-visit notice appears once**, dismisses, and stays dismissed across a hard reload.
3. [ ] **Bridge over the real HTTPS origin — the PNA test.** This is the one that needs the deployment.
   - Run the bridge locally (`TouchlineBridge.cmd`) and note its pairing code.
   - Open the **deployed HTTPS** site in Chrome or Edge.
   - Enter the pairing code in the bridge panel and press Connect.
   - Expect: **"Connected to your local bridge"**, and a save detected without any file dialog.
   - Then reload the page and confirm it reconnects with no click.
4. [ ] **If item 3 fails, read the failure properly before changing anything:**
   - A **CORS / Private Network Access** error in the console: inspect the `OPTIONS` preflight in the
     Network panel. It must be `204` and carry `access-control-allow-private-network: true`. If that
     header is missing from the response, the bug is in the bridge's CORS helper, not in the browser.
   - A **mixed content** error: the loopback-is-trustworthy assumption has changed in that browser.
     `http://localhost` and `http://127.0.0.1` are specified as potentially trustworthy origins, so this
     should not happen — but if it does, it is a real regression worth knowing about, and the bridge
     would need its own TLS certificate to work around it.
   - **Allowed the preflight but 401 on the request**: that is normal CORS working. The pairing code was
     wrong or not sent.
5. [ ] **Firefox still works without the bridge.** No console errors, file picker still opens, and the
   save loads. Firefox never supported the File System Access API, so this path is the one its users get.
6. [ ] **Faces render** on the squad view. They are fetched from a public CDN and cached in the browser.
7. [ ] **Bridge download works.** `…/bridge/touchline-bridge.zip` downloads and extracts to four files.
8. [ ] **Unpaired state is honest.** With no bridge running and nothing paired, the panel offers the
   download and the file picker still works.
9. [ ] **The screenshot reader works on the deployed origin.** Open a debrief, switch Match figures to
   Screenshot, and add a capture of the game's Match Facts Summary screen. Expect the four figures it carries
   (shots, expected goals, possession, passes) to land in the boxes, the picture to sit beside them, and a
   line saying the rest of the screen is kept with the match. This is the only check that proves the worker,
   the wasm core and the language model are all served from the deployment rather than from a CDN, because a
   scan makes no other request at all. A refusal names its reason instead of failing silently, and the Manual
   pane still works.
10. [ ] **The Match facts section is on the record.** Open the debrief that scan produced and expand Match
   facts on the detail card. Expect the Summary screen's own figures, us against them, and nothing editable.
   Shooting, Passing and Defending are listed in the pane's legend as not read yet: the three captures that
   would turn them on have not been supplied, so those screens ship disabled.
11. [ ] **A loan is recorded properly.** In Finance, add a deal, choose Loan, pick the player from the search,
   enter his wage and your share, and save. Expect a Loan badge, the wage line with your share, and the
   share inside the spend rather than beside it. Add one with no split and expect the row to say the wage is
   not in the totals.
12. [ ] **Expected goals is the game's own figure.** Add a debrief by hand, type 1.9 into Expected goals, and
   expect Shot quality to appear beside Finishing, which reads to one decimal. Nothing on that panel should
   mention big chances.

## Once the production domain is known

The bridge's Origin allowlist currently accepts `*.pages.dev` plus any loopback origin, because no
production domain is recorded anywhere in the repo. To pin it down, set `TOUCHLINE_BRIDGE_ORIGINS` to a
comma-separated list of exact origins when starting the bridge, or add the domain to `PAGES_ORIGIN`'s
neighbourhood in `bridge/bridge-server.ts`.

Narrowing it is defence in depth, not the gate: the pairing code is what actually authorises reading a
save, and a wrong-origin request gets no CORS headers even with a valid code.

## Record of runs

| Date | Build | Item 3 (PNA) | Notes |
| ---- | ----- | ------------ | ----- |
| —    | —     | not yet run  | First run is pending the first deploy of the bridge. |
