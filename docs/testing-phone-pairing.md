# Testing phone pairing, start to finish

The exact steps to prove the phone works with the deployed page on this machine. Run them in order the
first time. After that, step 3 onward is the whole routine.

Everything here was checked against `package.json`, `bridge/touchline-core.ts` and a real start of the
core on this PC. Nothing is remembered from an earlier version.

Both devices must be on the same Wi-Fi. It runs over plain HTTP on your own network, so pair only on a
network you trust. Nothing leaves your network.

---

## What the two copies are

The career in this browser is the main copy. The PC keeps a live copy of it so the phone can show the
same career.

The first time you pair, this browser's copy is sent to the PC, and whatever the PC held before is saved
to a backup folder first. From then on, a change on either device appears on the other within a few
seconds. One device edits at a time: the other shows Viewing only, and Take control switches.

---

## 1. Build the page

```powershell
npm run build:browser
```

That is `node scripts/with-target.mjs browser build`, which stages the SQLite engine and the OCR
runtime, then runs Next with `TOUCHLINE_TARGET=browser`.

The output is **`out-browser\`** in the repo root, and that folder is the whole deployment. `out-browser\index.html`
must exist when it finishes. If it does not, the build failed and the rest of this will not work.

## 2. Deploy it to Cloudflare Pages

This is a manual upload of a folder of files. There is no CI in this repo that does it.

1. Open <https://dash.cloudflare.com>, then **Workers & Pages**, then the `touchline-os` project.
2. Choose **Create deployment** and upload **the contents of `out-browser`**, not the folder itself.
   `index.html` has to sit at the root of the upload, next to `_next` and `sql-wasm.wasm`.
3. Wait for the deployment to go live, then open <https://touchline-os.pages.dev> and confirm the
   landing page renders.

There is nothing to configure on the Pages side: the app is static, and every database lives in the
browser or on the PC. No environment variables, no build command, no functions.

## 3. Start the core with sharing on

```powershell
$env:TOUCHLINE_REMOTE="1"; npm run core
```

The equivalent, which takes the flag directly:

```powershell
npx tsx bridge/touchline-core.ts --share
```

Use the second form if you would rather not set an environment variable. Do not write `npm run core -- --share`:
npm treats an unknown `--flag` as its own configuration and does not forward it, which starts the core with
sharing silently off.

It prints this, and the pairing code is on the `Pairing code:` line:

```
  TouchlineOS core is running.

    Career database:  C:\Users\<you>\AppData\Local\TouchlineOS\career.db
    Snapshot:         none yet (first run)
    Pairing code:     9Y976V
    This PC only:     http://127.0.0.1:4977
    Your phone:       http://192.168.1.24:4978  (same Wi-Fi)
    Paired devices:   0
```

Then it draws a QR code and says `Press Ctrl+C to stop.`

Four things worth knowing about that window:

- The code is remembered in `%LOCALAPPDATA%\TouchlineOS\bridge.json`. It stays the same between runs
  until you delete that file, so you type it once per device, not once per start.
- `http://127.0.0.1:4977` is the PC-only listener. The deployed page in your browser uses this one.
- `http://192.168.1.24:4978` is the address for the phone. The port is 4978 unless you pass `--port`.
- Leave the window open. Closing it stops sharing, and the app goes back to reading the copy in this
  browser only. Nothing is lost.

## 4. Where the core gets the app it serves to the phone

The core serves the **static build on this PC**, not the Cloudflare deployment. The default folder is
`out-browser` relative to the working directory, which is why step 1 has to run before step 3.

**Yes, it needs rebuilding when the page changes.** The phone always gets whatever was last built into
`out-browser`. If you deploy a new page and the phone still looks old, run `npm run build:browser` again
and restart the core.

To serve a build from somewhere else, either pass `--app` or set `TOUCHLINE_APP_DIR`:

```powershell
npx tsx bridge/touchline-core.ts --share --app .\out-browser
```

If `out-browser` has no `index.html`, the window says so and prints the build command.

## 5. Pair the desktop page

This is the step that makes the two copies. Do it in **Firefox**, on the deployed page.

1. Open <https://touchline-os.pages.dev> and open your career, so the landing page knows which career
   you mean.
2. Find **Prefer to stop picking your save file?** on the landing page, or the same card in the save
   step of the wizard.
3. Type the six-character code from the core window and press **Connect**.
4. Expect **Connected to your local bridge**, and a sync line under it that reaches **Synced with this
   PC** within a few seconds.

What happens behind that: this browser's copy is sent to the PC. The PC writes a snapshot of whatever it
held before, then replaces it. There is no export, no import and no sync button. Pairing is the setup.

### The first seed, and where the backup lands

The snapshot is `%LOCALAPPDATA%\TouchlineOS\backups\<careerId>-pre-sync-<timestamp>.db`, with five kept.
The newest one is the copy that was replaced. If that folder is empty, either the PC had no copy of this
career yet (the ordinary first case, so nothing was overwritten) or the seed has not run.

## 6. Turn Share on

Sharing is a listener on the PC, so it is switched on from the PC, by starting the core with sharing
(step 3). There is deliberately no button on a phone that opens a port on somebody else's computer.

Confirm it in the core window: the `Your phone:` line shows an address rather than `sharing is off`, and
`Paired devices:` counts what has paired so far. The same window carries the QR code.

A page the core itself is serving (the phone, or the PC's own LAN address) also shows **Sharing on ·
<computer name>** with the QR and the code, and that card is where **Stop sharing** lives. The deployed
page in your desktop browser is not served by the core, so it shows the instructions instead, and cannot
switch sharing on or off.

**Stop sharing** closes the port on the PC. Your career is untouched by that, and the devices you have
already paired stay paired: start the core with sharing again and they reconnect.

## 7. Pair the phone with the QR

1. Point the phone's camera at the QR in the core window.
2. Opening the link lands on the pairing screen with the code already filled in, and it submits itself.
3. The phone then shows the same career.

By hand instead: open `http://<pc-address>:4978` on the phone, on the same Wi-Fi, type the six characters,
press **Connect**. The code never uses `I`, `O`, `0` or `1`.

The code is removed from the phone's address bar after pairing, so it does not sit in the history.

## 8. Windows Firewall

The first time the LAN listener starts, Windows asks whether Node.js may accept connections.

- Allow it on **private networks** only. Never on public networks.
- If you dismissed it, the phone will not connect. Fix it in **Windows Security → Firewall & network
  protection → Allow an app through the firewall**, find Node.js, and tick Private.
- The PC-only listener on `127.0.0.1:4977` never triggers this prompt, so a working desktop page and a
  phone that cannot connect is usually this prompt and nothing else.

## 9. If the Two copies screen appears

It appears when the PC already holds a career with the same id, and holds something this browser does
not: rows this browser lacks, or rows edited more recently on the PC. It is a question, not an error, and
nothing is written until you answer.

It shows:

- **Two copies of this career**, with one sentence naming what the PC has that this browser does not.
- Two side-by-side counts: **This browser** and **Your PC**, each with its row count and newest edit.
- **Keep this browser's copy**: the PC copy is snapshotted, then replaced. This is the usual choice,
  because the browser is the main copy.
- **Use the PC copy**: asks you to type `REPLACE`, downloads this browser's copy as a file first, then
  replaces it. This is the only action in the app that discards a copy you can see, which is why it has
  both a typed word and a download in front of it.

There is no merge, here or anywhere.

## 10. Confirm the two copies match

The app does this on its own every minute and after every reconnect, and the sync line says **Synced
with this PC** when it agrees. To look at the raw numbers, ask the PC directly. This is read-only.

```powershell
$code = (Get-Content "$env:LOCALAPPDATA\TouchlineOS\bridge.json" | ConvertFrom-Json).code
Invoke-RestMethod -Uri "http://127.0.0.1:4977/sync/status?careerId=career_club_1917" `
  -Headers @{ "x-touchline-bridge-code" = $code } |
  Select-Object revision, counts, hashes
```

Replace `career_club_1917` with your career id if it differs. `counts` is rows per table on the PC, and
`hashes` is a fingerprint per table: two sides that agree have equal fingerprints even though you cannot
read them.

To compare counts against this browser, the cheap version is to read the same numbers twice a minute
apart while you edit on the phone. `revision` must move when you edit, and `counts` must match what the
screens show. The hash is the part that catches an edit which changed a value without changing a count.

This route only answers on `127.0.0.1`, so it cannot be reached from the phone or from the internet.

## 11. Unpair a device

In **Settings → Devices** on a page the core is serving (the phone, or the PC's own LAN address). The list
shows every paired device with **Revoke**, and the row for the device in your hand has **Unpair**.
Revoking takes effect on that device's next request, and the stream it was holding is closed.

The desktop page in your browser is not served by the core, so its Devices card shows the instructions
rather than the list.

To forget every device, delete `%LOCALAPPDATA%\TouchlineOS\remote.json` with the core stopped.

## 12. Restore the PC copy from a backup

Stop the core first with `Ctrl+C`. A database cannot be replaced while it is open, and Windows will
refuse the copy.

```powershell
$backups = "$env:LOCALAPPDATA\TouchlineOS\backups"
$db = "$env:LOCALAPPDATA\TouchlineOS\career.db"

# 1. Look at what is there, newest last. The pre-sync ones are the seeds.
Get-ChildItem $backups\*.db | Sort-Object LastWriteTime | Select-Object Name, LastWriteTime

# 2. Put the current file aside rather than deleting it.
Move-Item $db "$db.before-restore"
Remove-Item "$db-wal", "$db-shm" -ErrorAction SilentlyContinue

# 3. Copy the snapshot you chose into place.
Copy-Item "$backups\<the-file-you-chose>.db" $db
```

Then start the core again. It takes a snapshot of what you just restored before it opens, so the restore
is itself reversible.

If you would rather not touch files, the alternative is **Settings → Data Management → Export** on the
copy you want to keep, and **Import** on the one you want to replace, but that moves a career through a
file and is a different operation from restoring a snapshot.

## 13. Switch sync off

There are two separate switches, and they do different things:

- **This browser stops sending to the PC**: on the page, press **Disconnect the bridge**. The page keeps
  working from this browser's copy, and nothing is sent again until you pair once more.
- **The PC stops answering the phone**: close the core window, or press **Stop sharing** on a page the
  core is serving (on the phone, **Settings → Devices**). Paired devices stay paired and reconnect when
  sharing comes back.

---

## Phone checklist

Run this in order on the phone, with the core window open and the desktop page in Firefox. Each line is
something you can see or do, not a state to infer.

- [ ] **[phone] Same data on the phone.** Open `http://<pc-address>:4978`. The dashboard shows the same
      club, the same season and the same date as the desktop page.
- [ ] **[phone] Phone edit reaches the page.** Change something you can see on both, for example a trust
      level on a squad player. Within a few seconds the desktop page shows it without a manual refresh.
- [ ] **[phone] Page edit reaches the phone without reload.** Type a note on the desktop page. It appears
      on the phone on its own, no pull to refresh, inside the same few seconds.
- [ ] **[phone] Viewing only, then Take control.** Put a note in the phone's field while the desktop page
      is editing. Expect the phone to say **Viewing**, and **Take control**. Press it, make the same
      edit, and it saves. The desktop page now says **Viewing** instead.
- [ ] **[phone] An edit made while the page is closed.** Close the desktop page's tab entirely. Make an
      edit on the phone. Open the page again: the edit is there. A change made on the phone while the
      page was closed waits and is applied the next time the page opens.
- [ ] **[phone] Wi-Fi drop and recovery.** Turn the phone's Wi-Fi off, make an edit, and confirm the
      phone still keeps it. Turn Wi-Fi back on. The edit reaches the page once the phone reconnects, and
      the sync line goes back to **Synced**.
- [ ] **[phone] Nothing escapes the network.** With the phone on mobile data and Wi-Fi off, the address
      does not open at all. That is the intended answer.

One extra worth doing once, on the phone:

- [ ] **[phone] The page is not blank after a rebuild.** After `npm run build:browser` and a core
      restart, reload the address on the phone. If it still looks like the old app, the build finished
      after the core started: restart the core again.
