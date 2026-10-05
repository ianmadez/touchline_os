# TouchlineOS bridge

A small program you run on your own computer so the TouchlineOS website can read your EA SPORTS FC save file automatically.

Normally a website has to ask you to pick your save file, and browsers make it re-ask. This removes that: you run this once, pair it once, and the site syncs on its own from then on. It works in every browser, including Firefox and Safari, which cannot do this any other way.

**It is optional.** TouchlineOS works without it, you just have pick your save file each visit on some browsers.

## What it needs

Node.js. That is the only requirement — nothing to install, no `npm install`.

If you don't have it, get the LTS version from <https://nodejs.org>, then run this again.

## How to run it

Double-click **`TouchlineBridge.cmd`**.

A window opens showing a pairing code and the folders it found your saves in. Leave it open while you want the site to sync automatically. The first time, type that pairing code into TouchlineOS in your browser; after that you never need to think about it again.

To stop it, close the window or press `Ctrl+C`. Your career is unaffected either way — the site just goes back to asking for your save file.

If you want it available every time you turn the computer on, put a shortcut to `TouchlineBridge.cmd` in your Startup folder.

## What it actually does

It looks in the same folders EA SPORTS FC writes career saves to, and serves the bytes of your save file to the TouchlineOS page in your browser. That is all.

- **It never changes your save.** It only ever reads.
- **It never talks to the internet.** It listens on `127.0.0.1` — your own computer — and nothing else.
  There is no setting to make it reachable from other devices on your network, deliberately.
- **It does not upload anything anywhere.** Your save file goes to the page in your browser and stops there.
- **It contains no parser.** It hands over bytes; the website does the decoding. That is why it is small, and why it cannot quietly disagree with the app about what your save says.

## What keeps it safe

Two things:

1. **Only the TouchlineOS website is allowed to talk to it.** Requests from other websites are refused, and the browser then blocks them from reading anything. Your save is never served to a page that isn't TouchlineOS.

2. **The pairing code.** Nothing reads your save without it.

The code is stored at `%LOCALAPPDATA%\TouchlineOS\bridge.json` so it stays the same between runs. To disconnect, use the Disconnect option in TouchlineOS, or delete that file for a new code.

## Removing it

Close the window and delete this folder. Nothing else on your computer was touched, and nothing was installed.
