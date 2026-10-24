# Using your career on a phone

TouchlineOS is one career on one PC. This page is about the second screen: a phone, a tablet, or a
laptop on the same Wi-Fi, reading and editing **the same career**, with the PC as the only machine
that holds it.

It is off by default, it never leaves your own network, and nothing is uploaded anywhere.

---

## Two programs, two jobs

| | `bridge/touchline-bridge.ts` (the download) | `bridge/touchline-core.ts` (this repo) |
|---|---|---|
| What it does | hands save **bytes** to the website in your browser | serves the **whole app and its database** |
| Needs | Node.js, nothing else | the repo's dependencies (`npm install`) |
| Talks to | the hosted site, on `127.0.0.1:4977` | a page it serves itself, on your LAN |
| Contains a parser | no | yes - the same one the app uses |
| Contains your career | no | yes: `%LOCALAPPDATA%\TouchlineOS\career.db` |
| Reachable from another device | never | only while sharing is on |

If you only want the hosted site to stop asking for your save file, the download is enough. If you want
your phone to open your career, you want the core.

---

## Starting it

```powershell
npm install
npm run build:browser     # once, and again after any page change
$env:TOUCHLINE_REMOTE="1" # or: npx tsx bridge/touchline-core.ts --share
npm run core
```

**What this needs today.** The core is run from a checkout, with `npm install` behind it, because it
hosts the whole app: a real SQLite database and the parser both need the project's dependencies. The
downloaded one-file bridge cannot do this job - it deliberately has no dependencies, no parser and no
database - so there is no way yet for someone who only uses the hosted website to pair a phone. Packaging
the core as a single downloadable program is the obvious next step, and until it exists this page says
so rather than pretending otherwise.

The window prints four things: where the database is, the pairing code, the address a phone should
open, and a QR code for it.

```
    Career database:  C:\Users\you\AppData\Local\TouchlineOS\career.db
    Snapshot taken:   career_2026-10-18_09-14-02.db
    Pairing code:     K7M2QX
    This PC only:     http://127.0.0.1:4977
    Your phone:       http://192.168.1.24:4978  (same Wi-Fi)
```

Open the phone address, or scan the QR, and the app asks for the six-character code once. After that the
phone is paired, and the code is only needed for the *next* device.

The same three steps appear inside the app, so nobody has to come back to this file: the landing page has
a **Use The Same Career On Your Phone** section, and **Settings → Devices** repeats the commands with copy
buttons and then becomes the device list once a phone is paired. If the page you are looking at was
served by a core, that section shows the QR and code directly instead of the instructions.

`npm run core` on its own starts the loopback listener and nothing else: a page on the PC itself can use
the career, a phone cannot.

---

## What it actually does

- **The PC serves the career, and keeps a copy the phone can read.** The database, the save file and the
  parser stay on the PC. A career kept in this browser is the main copy, and the PC keeps a live copy of
  it so the phone can open the same career. The phone talks to the PC and never holds anything it could
  not get back.
- **The save watcher reads your save for you.** While sharing is on, the core stats the save folders
  every 15 seconds and does a full scan every five minutes. When the game writes a new save it runs the
  same parse and sync the app has always run, records the changes, and tells every connected screen to
  refresh. That is what makes "play a match on the PC, open the phone in the kitchen, the result is
  there" work.
- **One device edits at a time.** The first device to write becomes the editing one. Another device that
  tries shows **Viewing only** and is refused with a plain explanation until it presses **Take control**.
  Taking control moves the edit permission, so a screen that was open before cannot write over the top of
  what the new device did.
- **Everything else is read-only.** A device that is viewing can read every screen.

---

## The site's copy and the PC's copy

There are two kinds of career in TouchlineOS, and they behave differently.

- **A career in the browser** (the hosted site at <https://touchline-os.pages.dev>) lives in that
  browser's own storage. That copy is the main one. The PC keeps a **live copy** of it so the phone can
  open the same career.
- **A career in the core** (`npm run core`) lives in `%LOCALAPPDATA%\TouchlineOS\career.db`. That is
  already the PC's own database, so there is nothing to send it. The phone is a client of it.

### The first pair

Pair the bridge from the site and the site sends this browser's copy to the PC once. Before it is written,
whatever the PC held before is saved to `backups\` (`<careerId>-pre-sync-<timestamp>.db`, five kept), so
the PC copy is always backed up before it is replaced.

From then on it is live. A change on either device appears on the other within a few seconds. There is no
export, no import and no sync button: pairing is the whole setup.

Both devices must be on the same Wi-Fi. It runs over plain HTTP on your own network, so pair only on a
network you trust. Nothing leaves your network.

### What is never done

- **Nothing is merged.** Two copies of a football career differ in ways only a person can judge, so the
  app never guesses. If the PC holds something this browser does not, sync stops and asks.
- **This browser's data is never deleted** except by the one action on the **Two copies** screen, which
  downloads a copy of it first.
- **The PC copy is never overwritten without a backup.** A refused sync writes nothing at all.

### Two copies

If the PC already holds a career with the same id and holds anything this browser does not (rows, or rows
edited more recently), sync stops and says **Two copies**. You get the row count and the newest edit on
each side, and two choices:

- **Keep this browser's copy.** The PC copy is backed up, then replaced. The browser is the main copy for
  a browser career, so this is usually the right one.
- **Use the PC copy.** This replaces what is in this browser. It downloads a copy of this browser's career
  as a file first, and it asks you to type `REPLACE`, because it is the only action in the app that
  discards a copy you can see.

### What the sync line means

| It says | It means |
|---|---|
| Synced with this PC | Both copies hold the same rows. Nothing is waiting. |
| Sending N changes | Local edits are on their way to the PC. |
| This PC is not reachable | The bridge window is closed or the PC is asleep. Edits wait in this browser and go when it comes back. Nothing is lost. |
| Catching up (N changes) | The PC has changes this tab has not applied yet. Writes made now are made against a slightly old picture. |
| This bridge is older than the web page | Update the bridge before syncing. |
| Another tab is doing the syncing | Only one tab syncs, so two tabs cannot overwrite each other. Leave one tab open. |

Every minute the two sides also compare row counts and content fingerprints. If they disagree, the PC copy
is replaced from this browser, after a backup. A phone edit made while the page is closed waits, and is
applied the next time the page opens.

The full end-to-end check, with every command, is in
[testing-phone-pairing.md](testing-phone-pairing.md).

---

## What keeps it safe

- **It listens on your network, and only when you ask.** The LAN listener does not exist unless
  `--share` / `TOUCHLINE_REMOTE=1` was given. Stopping sharing closes the socket; starting it again is a
  decision made at the PC.
- **A device token for every call.** Pairing returns a 32-byte token, stored hashed on the PC. It travels
  in a header; the cookie that is also set is only there because `EventSource` cannot send a header.
  Revoking a device takes effect on its very next request.
- **The pairing code is rate limited.** Ten wrong codes from one address in ten minutes and that address
  is refused for the rest of the window, which is what stops a six-character code being guessed by a
  loop.
- **`Host` and `Origin` are both checked.** A request whose `Host` is not an address this machine has is
  refused, which is what stops DNS rebinding from turning a page in your browser into a request to your
  own PC. A request whose `Origin` is another site is refused before its body is read, so a hostile tab
  cannot edit a career by knowing a URL.
- **Sizes and rates are capped.** 32 MB per request, 300 requests a minute per address. A stuck phone
  cannot fill the disk or the log.
- **The career is snapshotted before every start.** `VACUUM INTO` writes a consistent copy to
  `%LOCALAPPDATA%\TouchlineOS\backups\` and the ten newest are kept.

### What it does not protect against

- **Anyone who can read the pairing code, or the token file, can read the career.** This is a personal
  tool on a home network, not a multi-user service.
- **A network you do not control.** Public Wi-Fi, a shared office VLAN, a hotel - these are networks
  where "same Wi-Fi" is not a trust boundary. Use it at home.
- **Windows Firewall will ask once.** The first time the LAN listener starts, Windows shows a prompt
  asking whether Node.js may accept connections. Allow it on **private networks** only; do not allow it
  on public networks. If the phone cannot connect, that prompt is the first thing to check
  (Windows Security → Firewall & network protection → Allow an app through the firewall).

---

## Running it every day

- **Put a shortcut in your Startup folder** if you want sharing always available.
- **Build the app once after any page change.** The core serves `out-browser/`, which is
  `npm run build:browser`. A stale build is a stale app on the phone, and the `/status` handshake exists
  so a stale app says so rather than failing on an endpoint that changed shape.
- **The pairing code never changes** unless you delete
  `%LOCALAPPDATA%\TouchlineOS\bridge.json`. That is deliberate: a code that rotated on every start would
  mean pairing on every start.
- **Devices are listed in Settings → Devices**, along with who is editing, a QR to pair another one, and
  a Revoke button for each.
- **To move a career to another machine**, use Settings → Data Management → Export on this core and
  Import on the other. The transfer package is the migration path; the database file is not.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| The phone says the PC is not answering | The core is not running, or the two devices are on different networks, or the firewall prompt was dismissed. |
| The code field rejects the code | The code is six characters from the set shown on the PC; the letters `I`, `O`, `0` and `1` are never used. |
| Everything says "Viewing" | Another device is editing. Press **Take control**. |
| "This is out of date" | The app build on the phone is older than the PC's core. Rebuild with `npm run build:browser`, restart the core, and reload. |
| "Two copies of this career" | The PC holds rows this browser does not. Choose one side on that screen. Nothing is merged and nothing changes until you do. |
| "Another tab is doing the syncing" | That is correct and deliberate: one tab syncs. Close the others if you want this one to do it. |
| An edit on the phone has not reached the page | The page applies it the next time it opens. Open the tab and give it a few seconds. |
| Port 4978 is in use | Start on another port: `npx tsx bridge/touchline-core.ts --share --port 4979`. |
| A page opened at `localhost` cannot reach the career | The loopback listener only serves this machine's own origins. Use the LAN address for a phone. |
