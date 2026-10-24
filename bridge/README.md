# TouchlineOS bridge

A small program you run on your own computer so the TouchlineOS website can read your EA SPORTS FC save file automatically.

> **This is the download, not the core.** It reads your save and hands the bytes to the website in your
> browser; the site does the parsing and keeps the career in the browser. If you want your **phone** to
> open the same career, that is the core - `npm run core`, run from the repository. The core needs the
> app's dependencies, so it is not a one-file download. See
> [../docs/remote-access.md](../docs/remote-access.md). The two are separate on purpose, and this
> program stays small.

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
  There is no setting to make *this program* reachable from other devices on your network, deliberately.
  (The core is the one that can serve a paired phone, and only when you start it with sharing on.)
- **It does not upload anything anywhere.** Your save file goes to the page in your browser and stops there.
- **It contains no parser.** It hands over bytes; the website does the decoding. That is why it is small, and why it cannot quietly disagree with the app about what your save says.

## What keeps it safe

Two things:

1. **Only the TouchlineOS website is allowed to talk to it.** Requests from other websites are refused, and the browser then blocks them from reading anything. Your save is never served to a page that isn't TouchlineOS.

2. **The pairing code.** Nothing reads your save without it.

The code is stored at `%LOCALAPPDATA%\TouchlineOS\bridge.json` so it stays the same between runs. To disconnect, use the Disconnect option in TouchlineOS, or delete that file for a new code.

## Updating it

The bridge and the website have to be built from the same schema, and the website is redeployed far more
often than the bridge is. When they disagree the page says so plainly ("This bridge is older than the web
page. Update the bridge.") and stops before it does anything with your career.

Updating is the same act as installing: download it again from TouchlineOS, close the old window, and
double-click the new `TouchlineBridge.cmd`. Your pairing code is remembered in
`%LOCALAPPDATA%\TouchlineOS\bridge.json`, so nothing needs re-pairing.

You can check what you have without opening the page: <http://127.0.0.1:4977/status> reports
`schemaVersion` and `migrationLevel`.

## Keeping a copy of the career

This download does not hold your career, so there is nothing here to keep in step. The core does. The
career in this browser is the main copy, and the core keeps a live copy of it so your phone can open the
same career: it is sent once when you pair, the PC's old copy is saved to a backup folder first, and from
then on a change on either device appears on the other within a few seconds. See
[The site's copy and the PC's copy](../docs/remote-access.md#the-sites-copy-and-the-pcs-copy).

The calls that do that work answer only on the core's loopback listener. This program has no `/sync`
routes at all, and the core's shared listener answers 404 to every one of them.

## Removing it

Close the window and delete this folder. Nothing else on your computer was touched, and nothing was installed.
