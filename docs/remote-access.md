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
npm run build:browser     # once, and again after pulling changes
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

- **The PC owns the data.** The database, the save file and the parser stay on the PC. The phone sends
  requests and receives rendered data; it never holds a copy of the career it could not get back.
- **The save watcher reads your save for you.** While sharing is on, the core stats the save folders
  every 15 seconds and does a full scan every five minutes. When the game writes a new save it runs the
  same parse and sync the app has always run, records the changes, and tells every connected screen to
  refresh. That is what makes "play a match on the PC, open the phone in the kitchen, the result is
  there" work.
- **One pen.** Only one device can write at a time. The first device to write takes it; another device
  that tries is refused with a plain explanation and can press **Take control**. Taking it moves the
  lease to a new epoch, so a screen that was open before cannot write over the top of what the new
  holder did.
- **Everything else is read-only.** A device without the pen can read every screen.

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
- **Build the app once after pulling changes.** The core serves `out-browser/`, which is
  `npm run build:browser`. A stale build is a stale app, and the `/status` handshake exists so a stale
  app says so rather than failing on an endpoint that changed shape.
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
| Everything says "Viewing" | Another device holds the pen. Press **Take control**. |
| "This is out of date" | The app build on the phone is older than the PC's core. Rebuild with `npm run build:browser` and reload. |
| Port 4978 is in use | Start on another port: `npx tsx bridge/touchline-core.ts --share --port 4979`. |
| A page opened at `localhost` cannot reach the career | The loopback listener only serves this machine's own origins. Use the LAN address for a phone. |
