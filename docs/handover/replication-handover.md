# Replication handover

Last updated 2026-10-24. Last action: built sections 5.1 to 5.12 and proved them with
`npm run replication:test`; see section 13 for what changed after this brief was written.

This is the single source of truth for the next session, which starts with no memory of the work that produced it.

---

## 1. Goal and model

The deployed web page (Cloudflare Pages) keeps the manager's real career in its browser database (OPFS). The bridge on the PC holds a **live replica**. The phone is a **client of that replica**.

- **PAGE careers**: the page's OPFS database is the source of truth. The bridge database is a replica. The phone is a client of the bridge. No export, import or sync button: pairing makes the phone show and edit the same career, live.
- **LOCAL careers**: the Node build's PC database is the real database, exactly as already built. None of the page replication runs for these. The phone is still a client of the bridge.
- **One writer at a time**, through the existing writer lease and epoch. No merging anywhere. Replication only moves a single writer's changes in order.
- **The bridge sequences.** It assigns a per-career revision to every accepted change; every node applies in revision order and idempotently.
- **Browser storage is never deleted.** The PC database is never overwritten without a backup first.
- **Firefox is the primary test browser.** Ian works in Firefox on the deployed page. Verified: a page served at `https://touchline-os.pages.dev` can fetch `http://127.0.0.1:4977` in Firefox (200 on `/status`, 10 saves with the code). Chromium refuses it ("Permission was denied for this request to access the `loopback` address space"), which is a known and accepted limit, and a pre-existing one for the bridge.

## 2. Locked decisions

- **Seeding**: the page sends its whole career through the existing transfer package. The bridge writes `<careerId>-pre-sync-<timestamp>` into `data/backups` (five kept), then replaces.
- **Staleness rule**: replace automatically only when every `career_events` id the PC copy holds and every user-entered row also exists in the page copy, or is older by `updated_at`. If the PC copy holds anything the page lacks, do not replace: return 409 with the comparison payload and show **Two copies**. A career only on the PC is left alone. A career only on the page is created.
- **Two copies screen**: per-side counts and newest edit, two actions (Keep this browser's copy, Use the PC copy), typed confirmation to replace the browser copy, and a downloadable export of the replaced side first. Never merge.
- **Replication endpoints are loopback only**: pairing code header plus the Origin allowlist. The LAN listener must reject every `/sync/*` route.
- **Version handshake**: `/status` carries `schemaVersion` (fingerprint) and `migrationLevel`. Page newer than bridge: "This bridge is older than the web page. Update the bridge." Bridge newer: "Refresh the web page." Neither pairs nor replicates while mismatched. (Built.)
- **Table classes**: 25 delta tables and 14 bulk tables, `app_settings` never replicated. Bulk tables use content hashes and whole-table replace, never row deltas, because a save sync rewrites all 18,926 `world_players` rows.
- **Drift check** every 60 seconds and after every reconnect: row counts and table hashes; mismatch triggers an automatic reseed from the lease holder's side, after backing up the overwritten side.
- **One agent tab** via the Web Locks API, `BroadcastChannel` election fallback. Other tabs show Viewing.
- **Catch up before taking the lease**: a device gets write access only when its applied revision equals the bridge's latest. Shown as "Catching up (N changes)". A device releasing control flushes its outbox first.
- **Latency target**: a change on either device is visible on the other within 3 seconds on the same Wi-Fi.
- **Allowed simplification**: the page pull may be a 2 second poll of the bridge for changes since the last applied revision while the tab is visible, plus an immediate pull when the phone writes. No streaming client needed on the page.
- **Security**: nothing weakens the existing auth, Host and Origin checks, revocation or lease enforcement. Revoking a device closes its streams. Sync state and device lists stay out of the career database and out of exports.
- **No em dashes in any user-facing copy.** Anything ambiguous: take the safest option that cannot lose data, note it, move on.

## 3. State of the repo

**Built and proven:**

- The replication ledger and its 89 triggers, applied through `applySchema` on both drivers.
- The DDL proof passes on a copy of a real career.
- Earlier work still standing: the transfer package carries all 38 career tables; `/status` reports `schemaVersion` and `migrationLevel`; the bridge panel refuses a mismatched bridge.

**Untouched:** the six scenarios in section 7 as written, and the cleanup in section 9. Section 5 is built
and proved; `replication:e2e` covers scenario 1 and the page half of scenario 2, so what remains there is
the lease handoff, revocation, and the skew messages under a real second device.

**Git:** everything is **uncommitted**, by instruction.

**Data:** test databases are cleaned up (`data/replication-test.db*` and `data/replication-target.db*` deleted). `data/backups/pre-rework-2026-10-24_131953/` is the fixture source and **must never be written to**. Both proofs copy it into `data/` or a temp folder first. Never run anything against the real career databases.

## 4. Files already built

Modified (all uncommitted):

- `src/lib/db/schema-apply.ts` — runs `REPLICATION_DDL` after the migrations, on every open, both drivers.
- `src/lib/services/career-transfer-service.ts` — `CAREER_TABLES` now carries 38 tables, adding `career_trophies`, `debrief_marks`, `news_items`, `news_published`, `transfer_inputs`, `transfer_counterparty_names`. No format change; `TRANSFER_SCHEMA_VERSION` stays 2.
- `scripts/test-transfer.ts` — seeds a row into each of the six before the round trip.
- `src/lib/platform/bridge-client.browser.ts` — `bridgeStatusReport`, `outdated` state, records the compatibility direction.
- `src/lib/platform/types.ts` — `BridgeState` gains `"outdated"`.
- `src/components/ui/bridge/bridge-panel.tsx` — the `outdated` branch with the right action per direction.
- `bridge/bridge-server.ts` — `/status` adds `schemaVersion` and `migrationLevel`; `handleSaveRoutes`, `applyCors`, `sendJson` exported.
- `bridge/core-server.ts` — both `/status` and `/touchline/runtime.json` add the two version fields.
- `bridge/README.md` — "Updating it" section.

New files:

- `src/lib/sync/replication/tables.ts` — the 25 delta tables, the 14 bulk tables, `SKIP_TABLES`, `KEY_COLUMNS` (`leagues` composite), `PARENT_SCOPED` (`storyline_events`, `hypothesis_evidence`), `keyOf`, `tableClass`.
- `src/lib/sync/replication/schema.ts` — `SYNC_TABLES`, `REPLICATION_DDL` (ledger tables plus generated triggers), `isSyncTable`.
- `src/lib/sync/replication/ledger.ts` — `setLoggingSuppressed`, `pendingChanges`, `pendingCount`, `ackChanges`, `deltasFor`, `readTable`, `rowCounts`, `tableHash`, `dirtyBulkTables`, `clearBulkDirty`, `readMeta`, `writeMeta`, `PUSH_BATCH`.
- `src/lib/sync/versions.ts` — `SCHEMA_VERSION` (SHA-1 fingerprint of the DDL plus migrations), `MIGRATION_LEVEL`, `compareSchema`, `compatibilityMessage`, `compatible`.
- `src/lib/platform/bridge-version.ts` — holds the last compatibility direction, readable by components without importing the browser twin.
- `scripts/test-replication-ddl.ts` — the only proof of the triggers. Passes.
- `docs/replication-progress.md` — superseded by this brief, one-line pointer left behind.

Two facts the proof settled:

1. **`leagues` is a bulk table**, so the composite-key row-delta path is unused. `KEY_COLUMNS` stays as documentation; do not build against it.
2. **Suppression works** through `setLoggingSuppressed(true|false)`, which flips `_sync_flag.applying`; every trigger carries `WHEN (SELECT applying FROM _sync_flag WHERE id = 1) = 0`. A write while suppressed logged nothing, and logging resumed after.


## 5. Remaining work, file by file

Order: apply, seed, bridge replication, client, agent, UI, scenarios. Paths are real unless marked NEW.

1. `src/lib/sync/replication/apply.ts` NEW shared. `applyBatch(careerId, deltas, bulk)`: one transaction, `setLoggingSuppressed(true)` around it, revision order, idempotent by (table, key, op). Insert via INSERT OR REPLACE with the delta row, delete via `KEY_COLUMNS`. Bulk applied only when the hash differs from `readMeta("bulk:<table>")`. Uses `readMeta`/`writeMeta` from `ledger.ts`.
2. `src/lib/sync/replication/seed.ts` NEW shared. `decideSeed(localPackage, incomingPackage)` returns `created` | `stale` | `conflict` plus a comparison payload: per-table page-only and PC-only id counts and the newest `updated_at` per side. Conflict if any delta-table id or any `career_events` id exists locally and not incoming, or exists in both with a newer local `updated_at`. Reuses the package shape from `career-transfer-service.ts`.
3. `bridge/replication.ts` NEW. Revision sequencer and the five endpoints, loopback only. Journal table on the replica database: `rev INTEGER PRIMARY KEY AUTOINCREMENT, career_id, table_name, row_key, op, row_json, bulk_hash, origin` so pull can exclude a client`s own pushes. Phone writes are captured by the same `_sync_*` triggers on the replica and given revisions there. Use `prepareCore` from `bridge/core.ts` for backup paths and `importTransferPackage` for the seed.
4. `bridge/core-server.ts` CHANGE. Mount `/sync/*` behind the loopback auth (`codeMatches`, `readBody`, `sendJson`, `configuredOrigins`), and make the LAN branch return 404 for `/sync/*`.
5. `src/lib/sync/replication/client.ts` NEW page side. Thin calls to the five endpoints using `readBridgeSettings` from `src/lib/platform/bridge-client.browser.ts`, so port and pairing code come from existing code.
6. `src/lib/sync/replication/agent.ts` NEW page side. `startAgent(careerId)`: `navigator.locks.request("touchline.sync.agent", { ifAvailable: true })` with a `BroadcastChannel` fallback; 500 ms debounced push of `deltasFor` then `ackChanges`; 2 s pull poll while visible; `pagehide` flush; drift check every 60 s against `/sync/status`; catch up before the lease; outbox resume on load; phone writes applied before any local write. Dispatch `touchline:data-changed` after applying.
7. `src/lib/platform/bridge-client.browser.ts` and `src/lib/platform/api-client.browser.ts` CHANGE. Start and stop the agent on paired or unreachable, and surface state: `synced`, `catching-up`, `offline-queued`, `outdated`.
8. `src/components/ui/bridge/bridge-panel.tsx` and `src/components/ui/remote/devices-panel.tsx` CHANGE. One sync line: Synced, Catching up N, Bridge not reachable with queued changes, Update needed.
9. `src/components/ui/bridge/two-copies.tsx` NEW. Per-side summary, Keep this browser`s copy, Use the PC copy, typed confirmation to replace the browser copy, and a download of the replaced side first through `/api/career/export`.
10. `src/components/ui/remote/viewing-pill.tsx` CHANGE. "Catching up (N changes)" while catching up before taking control.
11. `src/lib/services/career-transfer-service.ts` CHECK. Confirm `_sync_*` tables are excluded (they are, `CAREER_TABLES` is a whitelist). Add one assertion to `scripts/test-transfer.ts` that no package table starts with `_sync_`.
12. `docs/remote-access.md` and `bridge/README.md` CHANGE. One section on how sync works, plus the update step.

## 6. Wire contracts

- `POST /sync/seed` `{ careerId, package }` returns `{ result: "created" | "replaced" | "unchanged", backup?, comparison? }`; `409` with `{ result: "conflict", comparison }` when the PC copy holds rows the page lacks.
- `POST /sync/push` `{ careerId, clientId, baseRevision, deltas: [{table, key, op, row, seq}], bulk: [{table, hash, rows}] }` returns `{ revision, ackedSeq }`. Idempotent on `(clientId, seq)`.
- `GET /sync/pull?careerId=&since=&clientId=` returns `{ revision, deltas, bulk }` after `since`, excluding entries whose `origin` is `clientId`.
- `GET /sync/status?careerId=` returns `{ revision, counts, hashes }` for the drift check.
- `POST /sync/reseed` `{ careerId, direction: "page-to-pc" | "pc-to-page", package? }`, backing up the overwritten side first.

## 7. The six scenarios

Existing Playwright firefox setup, two contexts: A the deployed page build served locally with real OPFS, B a 390 px phone on the bridge address. Fixtures only, copies deleted after.

1. Seed replaces a stale PC copy with a backup kept; refuses a PC copy holding PC-only rows and shows Two copies.
2. A page write reaches the phone and a phone write reaches the page OPFS within 3 seconds, no echo, no duplicates.
3. Bridge down then up drains the outbox silently; both sides changed shows Two copies with both backups made.
4. Lease handoff catches up first; a stale epoch is rejected with 409 by a direct request bypassing the UI.
5. The LAN listener rejects `/sync/*`; a revoked device loses reads, writes and streams.
6. Schema skew shows the right message both ways and does nothing else.

Nothing beyond the DDL proof and these six.

## 8. First actions next session

1. Re-run `bridge:test`, `remote:test`, `remote:e2e`, `browser:schema:test`, `transfer:test`, `tsc --noEmit`, `eslint`. This verification was never done after the ledger was wired: `applySchema` now runs 89 extra trigger statements on every open, in both drivers, and that is the largest unknown.
2. Then section 5 in order: apply, seed, bridge replication, client, agent, UI, scenarios.

## 9. Cleanup, last

Create `scripts/archive/fc27/README.md` with the FC27 findings: container and block layout, the one-byte header displacement and the normalise repair, descriptor layouts and widths, the vanilla database rules (header 40, descriptor entry layout, rows starting 5 bytes before the formula), the variable-length compacted rows in saves, which tables the FC27 meta lacks, what is unsolved.

Move these 48 untracked files: `ref27-step1` to `ref27-step7`, `ref27-inv1` to `ref27-inv23`, `ref27-follow1` to `ref27-follow4`, `ref27-meta`, `ref27-meta-compare`, `ref27-saves`, `descriptors`, `phase-0-career-block`, `phase-1-record-size`, `phase-1b-descriptor-solver`, `phase-2-chain-walk`, `save-pair`, `save-pair-normalise`, `string-1-anchors`, `step1-players-stride`, `step1-teams-bitstride`, `step1-teams-capacity`, `step2-slab-factoring`, `news-ids`, `sync-explicit`.

Delete `scripts/ask.ts` (0 KB) and seven duplicate probes: `probe-date-move`, `probe-gender-filter`, `probe-match-ratings`, `probe-name-coverage`, `probe-next-match`, `probe-own-division`, `probe-presigned-deals`.

Keep every tracked script and `scripts/test-replication-ddl.ts`. Exclude `scripts/archive/` from `tsconfig.json` `exclude` and `eslint.config.mjs` `ignores`. Track `scripts/archive` without committing. Re-run `build`, `build:browser`, the suites, `tsc`, `eslint`, and fix any `package.json` reference that breaks.

Never touch `references/reference-fc27`, the game databases, `data/ocr-golden`, `data/saves`, `data/backups` (including `pre-rework-2026-10-24_131953`), or any real career data.

## 10. Gotchas

- `init-db` DDL has no backticks; unique indexes go in `alterStatements`, not the table body.
- React Compiler lint: a synchronous `setState` in an effect body is an error (`react-hooks/set-state-in-effect`). Defer through a timer or derive. Pre-existing exceptions: `page.tsx:720` and two `<img>` warnings.
- Reads that write: hydration runs the storyline evaluator; the news paper publishes on read. Both fire the triggers. Derived writes must never bump a revision, so filter them at the journal by table and op.
- `sync-service.ts` deletes and reinserts `world_players`, `player_match_ratings`, `competition_teams`, `youth_prospects`, `transfer_deals` on every sync. That is why they are bulk.
- The OPFS driver persists a whole image every 750 ms and on `pagehide`, gated on `total_changes()`. A trigger insert moves that counter, so the ledger is durable with no extra code.
- `sql.js` and `better-sqlite3` differ on `exec` return shapes. Use the scalar helpers in `schema-apply.ts`.
- `npm run core -- --share` does not work, npm swallows the flag. Use `$env:TOUCHLINE_REMOTE="1"; npm run core`.
- Playwright`s pinned Chromium may be absent; use `C:/Users/ianth/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`, or Firefox (the target).
- The Next dev overlay (`nextjs-portal`) intercepts clicks bottom-left; harnesses hide it.
- Tours must be seeded done in localStorage or they open mid-test and move the page.
- tsx runs scripts as CJS: no top-level await. Wrap in `async function main()`.

## 11. Stop rules

Stop only if a step would replace or delete data with no backup first, or a previously passing suite now fails with no cause found after two honest attempts. Otherwise keep going without a check-in. Nothing is ever committed.

## 12. Resume prompt

Read `docs/handover/replication-handover.md` fully first. Section 5 is built; start with section 13 to see
what exists and what it was proved with. Then the six scenarios in section 7, then the cleanup in section
9, then one final report. Nothing committed. Never run anything against the real career data.

## 13. What the build session added

**Section 5, file by file**

- `src/lib/sync/replication/protocol.ts` NEW. The wire shapes, shared by both ends.
- `src/lib/sync/replication/apply.ts` NEW. `applyBatch(careerId, deltas, bulk)`: one transaction,
  logging suppressed, deletes of parent-scoped rows first and their inserts last, `INSERT OR REPLACE` for
  idempotency, `PRAGMA defer_foreign_keys = ON` so the bulk tables can be emptied and refilled in the
  journal's order, and bulk blocks skipped when the hash matches `_sync_meta`.
- `src/lib/sync/replication/seed.ts` NEW. `decideSeed(local, incoming)` gives `created` / `replaced` /
  `unchanged` / `conflict` plus a comparison of per-table counts, the newest edit on each side, the ids
  only the PC holds, and the rows the PC has newer. `describeConflict` writes the sentence.
- `bridge/replication.ts` NEW. The journal (`_sync_journal`, `_sync_push_seq`), `sequence()` which drains
  the replica's own `_sync_log` and `_sync_bulk_dirty` into revisions, the five routes, and
  `backupBeforeSync` (`VACUUM INTO`, five kept, beside the database).
- `bridge/core-server.ts` CHANGE. `/sync/*` mounted on the loopback listener behind the pairing code; the
  LAN listener answers 404 to the whole prefix; the loopback preflight now allows POST.
- `src/lib/sync/replication/client.ts` NEW. The five calls, the stable client id, and "no answer" as null.
- `src/lib/sync/replication/state.ts` NEW. One subscribable snapshot plus the sentences.
- `src/lib/sync/replication/agent.ts` NEW. Web Locks election with a localStorage lease fallback, a 500 ms
  flush tick, a 2 s pull while visible, a 60 s drift check, `pagehide` flush, seed on first run, and the
  two deliberate replacements.
- `src/lib/platform/sync-actions.ts` + `.browser.ts` NEW. The switch point that keeps `agent.ts` (and so
  better-sqlite3) out of the desktop build's client bundle. Screens import this, never the agent.
- `src/lib/platform/bridge-client.browser.ts` CHANGE. `bridgeState` starts and stops the agent, and
  records `offline` / `outdated` / `off`.
- `src/lib/platform/api-client.browser.ts` CHANGE. `maybeStartAgent()` after every in-page call, throttled to
  once a second, so the agent starts on the first screen rather than only on the landing page.
- `src/components/ui/bridge/sync-line.tsx`, `two-copies.tsx` NEW; `bridge-panel.tsx`,
  `src/components/ui/remote/devices-panel.tsx`, `viewing-pill.tsx`, `remote-provider.tsx` CHANGE.
- `docs/remote-access.md` and `bridge/README.md` CHANGE. "The site's copy and the PC's copy", and where
  `/sync` lives.
- `scripts/test-replication.ts` + `scripts/replication-test-host.ts` NEW. `npm run replication:test`,
  the wire proof with two databases in two processes.
- `scripts/replication-e2e.mjs` NEW. `npm run replication:e2e`, the page in Firefox against a real core.
- `scripts/test-transfer.ts` CHANGE. Excludes the ledger from the digest and asserts no package table is
  a ledger table, which is what made it fail once the triggers existed.
- `scripts/test-replication-ddl.ts` CHANGE. `contentHash` now reaches the two parent-scoped tables through
  their parent, which was a real bug in the proof rather than in the product.

**Decisions taken where the brief was silent**

- **Derived writes are not filtered out of the journal.** The set of derived tables is not knowable from
  here, and a wrong filter loses data silently. Applying a remote row is suppressed, so the two sides
  converge and stop; the cost is one extra round trip after a read that publishes news, not a loop.
- **The seed snapshot goes beside the database**, which is `data/backups` in a checkout and
  `%LOCALAPPDATA%\TouchlineOS\backups` for the core, rather than a hardcoded `data/backups`.
- **A push whose `baseRevision` is behind is refused with 409 `stale`**, so the page pulls, applies and
  sends again with current row values. Its outbox is untouched by the refusal.
- **The journal keeps 20,000 revisions per career** and trims older ones when it grows, because nothing
  else would ever shrink it.

**Proof**

`npm run replication:test` passes: seed creates, seed is idempotent, no code and a wrong code are 401,
the LAN listener 404s `/sync`, a pushed delta is numbered and acked, a device never receives its own push,
re-sending is a no-op, a phone write reaches the page and the hashes then match, a bulk table arrives as a
hash plus rows and applies, a stale push is 409, a replica holding a PC-only row refuses the seed with a
comparison, a reseed snapshots first and resets the journal, and `pc-to-page` hands the whole career back.

`npm run replication:e2e` passes too, and is the one that proves the page itself: the built browser app in
Firefox with a career in OPFS, a paired bridge, the agent elected, the seed sent, the replica holding the
same rows, and a write made on the PC arriving in the browser's own OPFS database exactly once.

Three things that e2e caught, all of which would have been silent in production:

1. **Firefox refuses `ifAvailable` and `signal` together** on `navigator.locks.request`. The request threw,
   the agent never ran, and the page just said nothing. The lock is now requested without a signal; the
   loop resolves on abort, which releases it anyway.
2. **The drift check ran on the first tick**, because `lastDrift` started at 0. It compared the two sides
   before the seed had settled and reseeded the replica for no reason, every time. `lastDrift` now starts
   at the current time.
3. **`tableHash` was order-sensitive.** A database built by replaying migrations has its columns in the
   order they were added; one built from the current DDL has them in the declared order. `SELECT *` then
   returns the same values in a different order and every table looked drifted. The hash now sorts a row's
   keys, which is what makes a page-side and a bridge-side hash comparable at all.

Also passing after this work: `transfer:test`, `bridge:test`, `remote:test`, `remote:e2e`,
`browser:schema:test`, `test-replication-ddl`, `tsc --noEmit`, and `npm run build` / `npm run build:browser`.
ESLint reports the pre-existing baseline only (the `page.tsx:720` effect, and the generated `out-browser`,
`public/ocr` and `references/` trees, which the config does not ignore).

## 14. The runbook and copy session

Three jobs were done after section 13: the phone runbook, one consistent set of words for the feature, and
the leftovers.

**Runbook.** `docs/testing-phone-pairing.md`. Every command was read out of `package.json` and
`bridge/touchline-core.ts`, and the core was actually started in a temp data directory to confirm the
banner, the pairing code line and the addresses. It covers build output (`out-browser`), the manual Pages
upload, the core, the app copy it serves, pairing the desktop page, sharing, the QR, the firewall, the
first seed and its backup path, the Two copies screen, the sync status check, unpairing, restoring a
snapshot, switching sync off, and a phone checklist.

**Copy.** One set of sentences, used on the landing section and its two phone FAQ entries, the root
README, both guides, the bridge panel, the Devices card (with a collapsed How it works), the Two copies
screen, the sync line and the phone's pairing screen. A Devices tour step was added and `TOUR_REVISION`
bumped to `2026-10-24-devices-and-sync`. No user-facing string uses OPFS, replica, lease, epoch, journal
or outbox.

**Scenarios mapped:**

| Section 7 scenario | Covered by |
|---|---|
| 1. Seed replaces a stale copy, refuses a PC-only copy | `replication:test` 9 and 10, `replication:e2e` |
| 2. A change each way, no echo, no duplicates | `replication:test` 4 to 6, `replication:e2e` 2 and 3 |
| 3. Bridge down then up; both sides changed | Partly: `replication:test` 9 and 10 cover the conflict and the backup. The outbox drain is not automated |
| 4. Lease handoff catches up, stale epoch refused | NEW in `remote:test` 5b: stale epoch is 409 by direct request, and the catch-up sentence is asserted |
| 5. LAN rejects `/sync`, revoked device loses everything | NEW in `remote:test` 7: read, write, state and the open stream are all refused or closed |
| 6. Schema skew both ways | NEW in `replication:test` 13 |

**A real bug found by running the suites.** The bulk marker insert was `INSERT OR IGNORE`. An UPSERT
(`INSERT ... ON CONFLICT DO UPDATE`, which `sync-service.ts` uses for `leagues` on every run) reaches its
UPDATE arm, fires the marker trigger again, and SQLite raised the marker's own primary key as a hard
error despite the OR IGNORE. `sync:test` failed with `UNIQUE constraint failed: _sync_bulk_dirty.career_id`
on the second sync of a save. Fixed by inserting conditionally (`WHERE NOT EXISTS`), and `test-replication-ddl`
now has section 4b doing exactly that upsert twice.

**Trigger bodies now land on existing databases.** `CREATE TRIGGER IF NOT EXISTS` left old bodies in
place, so the fix alone would never have reached a database opened before it. Every trigger is now dropped
and recreated, gated on a fingerprint stored in `_sync_meta`, so a current database is left untouched and
`browser:schema:test` still proves a second open rewrites nothing.

**Section 9 cleanup.** The FC27 archive brief is at `scripts/archive/fc27/README.md`, written only from
findings the surviving code still proves, with the displacement and vanilla-header notes marked as not
retained. The 48 probe files, `scripts/ask.ts` and six of the seven duplicate probes were already absent
from this working tree, so nothing was moved or deleted. `probe-presigned-deals.ts` is tracked and was
kept, per "keep every tracked script". `scripts/archive` is excluded in `tsconfig.json` and ignored by
ESLint.


