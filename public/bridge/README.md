# TouchlineOS bridge

One program you run on your own computer. It does two jobs, and you can use either without the other:

1. **It hands the website your save file automatically**, so you never pick it again.
2. **It lets your phone open the same career**, when you ask it to.

Both live in the same download now. There is no separate "core" to set up.

## What it needs

Node.js. That is the only requirement. There is nothing to install, no `npm install`, nothing to build.

If you don't have it, get the LTS version from <https://nodejs.org>, then run this again.

## How to run it

Double-click **`TouchlineBridge.cmd`**.

A window opens and stays open. Leave it open while you want the website to read your save by itself.

**To use your phone as well**, run it with `share`:

```
TouchlineBridge.cmd share
```

The window then also prints a pairing code and a QR code. Scan the QR with your phone's camera, or open
the address it prints and type the code. After that the phone opens your career like the website does,
and the two stay in step within a few seconds.

Pairing is off unless you ask for it. A plain double-click never opens a port on your network.

To stop, close the window or press `Ctrl+C`. Your career is unaffected either way.

If you want it available every time you turn the computer on, put a shortcut to `TouchlineBridge.cmd` in
your Startup folder.

## Where your career lives

The career database is `%LOCALAPPDATA%\TouchlineOS\career.db`, and the snapshots taken before anything
is replaced are in `%LOCALAPPDATA%\TouchlineOS\backups\`. Neither is inside this folder, so unzipping a
newer download over the top of this one never touches your career.

## What it actually does

It looks in the same folders EA SPORTS FC writes career saves to, reads the newest one, and:

- serves the bytes of your save to the TouchlineOS page in your browser, and
- with `share` on, serves the whole app to a paired phone on your own Wi-Fi.

- **It never changes your save.** It only ever reads.
- **It does not upload anything anywhere.** Nothing leaves your network. There is no account and no
  server of ours in the middle.
- **With pairing off it listens on `127.0.0.1` only**, which is your own computer.
- **With pairing on it opens one port on your own network**, and nothing else. A phone has to pair with
  the code before it can read anything.

The first time a phone opens the app, the core fetches the app's files from the TouchlineOS website and
keeps them in `%LOCALAPPDATA%\TouchlineOS\app`. After that a phone works with no internet at all. The
download does not carry the app because it is far too large to ship, and the website it is downloaded
from refuses files that big.

## What keeps it safe

Three things:

1. **Only the TouchlineOS website is allowed to talk to it.** Requests from other websites are refused.
   Your save is never served to a page that isn't TouchlineOS.
2. **The pairing code.** Nothing reads your save without it, and a phone has to pair before it can see
   anything.
3. **One writer at a time.** If the website and the phone are both open, one of them edits and the other
   shows *Viewing only* until you press *Take control*. Nothing is merged behind your back.

The code is stored at `%LOCALAPPDATA%\TouchlineOS\bridge.json` so it stays the same between runs. To
disconnect, use the Disconnect option in TouchlineOS, or delete that file for a new code.

## Updating it

The bridge and the website have to be built from the same schema, and the website is redeployed far more
often than the bridge is. When they disagree the page says so plainly ("This bridge is older than the web
page. Update the bridge.") and stops before it does anything with your career.

Updating is the same act as installing: download it again from TouchlineOS, close the old window, and
double-click the new `TouchlineBridge.cmd`. Your pairing code and your career are both outside this
folder, so they survive the update.
