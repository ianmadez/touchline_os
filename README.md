# TouchlineOS

A local-first companion app for EA SPORTS FC Career Mode. It automatically reads and saves your actual save file, keeps an honest, immutable record of your career, and layers deterministic advice, storylines and season intelligence on top, without ever inventing a fact the save didn't give it.

## Compatibility

Every title below is read by the same parser. What differs between them is the **datasheet**: the game's own `fifa_ng_db-meta.xml`, which maps the four-character ids inside a save (`zgrE`, `biWl`) to real table and field names. A save is identified from its own table directory and read with the datasheet that explains it, so adding a title means shipping its datasheet rather than writing a new parser. Datasheet provenance and licensing are recorded in [`public/parse-resources/README.md`](public/parse-resources/README.md).

`Status` distinguishes claims that are not interchangeable. **Verified** means a career the game itself wrote has been read end to end. **Reader verified** means the layout and the datasheet have been exercised against a save built to that game's format, which proves the reader and not the game. **Partly supported** means the save is read and not everything on it works yet. No real FIFA 17 to 21 save has been tested here yet.

| Game Version | Save Parsing | Browser Support | Status |
|---|---|---|---|
| FIFA 17 | Own datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Reader verified. Transfer ledger unavailable, FIFA 17 records no agreed transfers. |
| FIFA 18 | Own datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Reader verified. No real save tested yet. |
| FIFA 19 | Own datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Reader verified. No real save tested yet. |
| FIFA 20 | Own datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Reader verified. No real save tested yet. |
| FIFA 21 | Own datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Reader verified. No real save tested yet. |
| EA SPORTS FC 25 | FC datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Verified |
| EA SPORTS FC 26 | FC datasheet, classic 16-byte descriptors | Chrome / Edge / Brave / Firefox | Verified |
| EA SPORTS FC 27 | FC 26 datasheet, compact 9-byte descriptors | Chrome / Edge / Brave / Firefox | **Partly supported.** No FC 27 database description exists, so it is read with the FC 26 one: fields that description does not declare come back as unknown, and its career block is decoded by locating descriptor runs rather than by reading the directory, so a table that cannot be located is skipped with a warning. Open it, and expect parts of the career to be missing. |

The browser build reads exactly the same formats in all four browsers, because it runs the same parser and fetches the datasheets it needs. The one difference between browsers is not the format but **acquiring the file**: Chrome, Edge and Brave can remember the save you picked, while Firefox and Safari cannot keep a file handle at all, so those browsers ask again on each visit unless you run the optional local bridge. See `docs/post-deploy-checklist.md`.

FIFA 16 and earlier are deliberately **not** supported. Their career saves are not `fifa_ng_db` databases, so there is no datasheet to ship and no folder to scan: reading them would mean reverse engineering a bespoke serialisation, and no public research to build on. Credits for the FIFA 17 to 21 datasheets: [sammygriffiths/fifa-career-save-parser](https://github.com/sammygriffiths/fifa-career-save-parser) (ISC).

<img width="1917" height="935" alt="image" src="https://github.com/user-attachments/assets/055151fc-34f9-4c72-acd9-53feb5e822e8" />

---

## What this is

As a Career Mode - Manager Career player I've always struggled with immersion especially as the years went on and the charm of older FIFA games faded away. I tried getting into tracking in my phone's notepad, a book, and those really-confusing looking excel templates that are basically a second job, and none worked for me. I looked into other companion apps and none really felt like ME, you know? So, I built TouchlineOS, the normal game gives you your squad, a league table, and a save file that quietly loses context every time you close the game. TouchlineOS sits beside it as a semi-autonomous layer and remembers what happened, in your own words where the save can't tell you, and in the save's own words where it can, and it never blurs the two.

Every value stored anywhere in the app carries a provenance:

| Tag | Meaning |
|---|---|
| **SAVE** | Read directly from your career file. A fact. |
| **USER** | Something you told TouchlineOS yourself. |
| **DERIVED** | Calculated from SAVE and/or USER data by deterministic code. |
| **AI** | Reserved for a future narrative layer. Never a source of truth. |

Nothing downstream is allowed to present a `DERIVED` estimate as a `SAVE` fact, or invent a `SAVE` value that isn't actually in the file. Where the save is ambiguous, unreliable, or simply doesn't contain something, the app says so instead of guessing — this shows up throughout the product as visible "Projected," "Inferred," or "not decoded yet" tags rather than confident-looking numbers.

---

## Core principles

- **Immutable history.** Every sync creates a new snapshot. Nothing is ever overwritten. A diff engine compares snapshots and emits events onto a permanent spine (`career_events`). Re-syncing an unchanged save produces zero new events, every time, verified.
- **Deterministic first, AI last.** Every advisory, storyline, and inference in the app today is plain code, thresholds, arithmetic, and comparisons, all with zero LLM involvement. The architecture is built so an AI narration layer can be added later purely as an *interpreter* of this data, never as its source.
- **No silent guessing.** If a field can't be reliably read from the save (transfer values, wages, a board objective's meaning, a live league table), the app either derives a labeled estimate with a visible band, asks the manager directly, or states plainly that it doesn't know — never all three collapsed into one confident-looking fact.
- **Football language, not database language.** No jargon, no internal field names, no "provenance" badges. The distinction between a save fact and a manager's own note is made in plain football language throughout the UI.

---

## Feature tour

### Save sync & snapshots
Simple as pointing TouchlineOS at your save file, which it tries to automatically detect. Each sync produces a new immutable snapshot and a diff against the last one, you get a plain-English summary of what changed (transfers, squad changes, contract events) every time you sync.

<img width="500" height="261" alt="image" src="https://github.com/user-attachments/assets/db366d38-8f0d-4a88-89a2-bc3921d1cd58" />

### Phone pairing
The same career on a second screen. The optional core on your PC serves the whole app to a paired phone, tablet or laptop on the same Wi-Fi: no account, no cloud copy, nothing leaving the house. Pairing is one six-character code, or a QR scan that fills it in for you; every paired device is listed in Settings → Devices with a Revoke button. One device holds the pen at a time, so two people cannot write over each other, and the other keeps reading until it takes control. While sharing is on, the core also watches your save folders, so a match played on the PC is already on the phone.

The steps are on the landing page, in Settings → Devices, and in [docs/remote-access.md](docs/remote-access.md).

### Squad
Your full roster is read straight from the save: OVR, potential, age, position, contract, form, jersey number + a manager's-eye layer you control yourself: assigned role, trust level, and importance marker (untouchable / key player / rotation / surplus). Faces are fetched automatically for real squad players, not youth, with a clean initials-disc fallback for anyone without one.

<img width="1915" height="931" alt="Screenshot 2026-09-29 214404" src="https://github.com/user-attachments/assets/62186272-9ffd-4b5f-8329-12938ebf50e1" />

### Tactics
A pitch view with click-to-assign player placement per formation. Role changes are logged as real events, feeding the storyline engine below.

<img width="1917" height="937" alt="Screenshot 2026-09-29 214435" src="https://github.com/user-attachments/assets/57374c7c-8d5d-4105-8fd7-6fecafa40b0b" />

### Season & Campaign Hub
Season-by-season record, pulled directly from the save, alongside a manager-set objective and the save's own board objective shown side by side — never merged, never silently overwritten by one another. Where the save's own fields are known to be unreliable or ambiguous (league position, competition scope), the app is explicit about it rather than presenting a guess as fact.

<img width="1540" height="815" alt="Screenshot 2026-09-30 163154" src="https://github.com/user-attachments/assets/77b0a9b4-4237-48aa-9018-cc11612b2348" />

<img width="1531" height="806" alt="image" src="https://github.com/user-attachments/assets/0d75ec9e-fc93-4c89-a20f-5927e3298493" />

### Timeline
A chronological feed built entirely from the event spine — plain, legible sentences generated from what actually happened, not a narrative library.

<img width="542" height="386" alt="image" src="https://github.com/user-attachments/assets/8eed5d65-559e-4a67-a89b-019a047ba81a" />

### Storylines
The deterministic advisor's flagship feature: threads that open on a real trigger (e.g. thin depth at a position) and *compound*, every subsequent sync or debrief can add further evidence to an already-open thread, rather than firing a single static flag. Threads resolve when a manager action genuinely addresses them (a signing, a renewal) and go stale when nothing does. Every thread's full evidence trail is reviewable on its own subpage.

<img width="637" height="521" alt="image" src="https://github.com/user-attachments/assets/a16ca56c-9d35-46a0-8a23-5a9701994e68" />

### Match Debrief
Log a result and answer a handful of context-aware follow-up questions. The question set isn't static — it's driven by an anomaly engine that looks at your rolling recent form (defensive leaks, goal droughts, big wins/losses, a player in hot form, a recurring weakness resurfacing) and only asks about what's actually notable, with the wording varying naturally match to match rather than repeating the same template.

<img width="1462" height="812" alt="image" src="https://github.com/user-attachments/assets/f4d70517-8649-49c3-84e1-373ed059d3c4" />

<img width="1455" height="640" alt="image" src="https://github.com/user-attachments/assets/6cdc6ff1-6ce9-4da6-8ac8-ef12a0f163a2" />

### Settings
Sync behavior, theme, and career/data management, all kept honest, there are no controls for features that don't exist yet.

<img width="981" height="773" alt="image" src="https://github.com/user-attachments/assets/10bffd2f-99ba-4999-a65d-8a7dc177fde3" />

---

## Local privacy model

- **Parsing runs on your device.** The save decoder runs in your browser, with SQLite compiled to WebAssembly, or in the local Node service on the desktop build. Your save is read there and nowhere else.
- **Zero cloud database uploads.** There is no server holding your career. Nothing about your save file, your squad or your notes leaves the machine, and there are no accounts to create.
- **Session persistence is local.** A reference to the save file you picked, and your career database itself, live in your browser's own private storage: IndexedDB for the file reference and OPFS for the database image. On the desktop build the same data is a plain local SQLite file.
- **A second screen stays on your network.** The optional core can serve the app to a paired phone over your own Wi-Fi. Nothing is uploaded, there is no relay and no account: the phone talks to the PC directly, and the listener only exists while you have turned sharing on. See [docs/remote-access.md](docs/remote-access.md).

---

## Architecture

```
FC Career Save
      │
      ▼
Save Parser (interface-bound, swappable)
      │
      ▼
Immutable Snapshot ──► Diff Engine ──► career_events (the spine)
      │                                      │
      ▼                                      ▼
SQLite (Drizzle ORM)              Deterministic Evaluators
      │                          (advisories · storylines · season model)
      ▼                                      │
      └──────────────► UI (Next.js / React) ◄┘
```

- **Local-first.** SQLite on disk, no account, no cloud dependency. Your career data never leaves your machine.
- **Parser sits behind one interface.** The parser is the least stable part of the stack — tied to a specific save-format decode — so nothing else in the app talks to it directly. It can be patched or swapped without touching anything downstream.
- **One spine, many readers.** `career_events` is the single source of truth for everything that's happened in a career. Storylines, the season model, and advisories all read from it rather than maintaining their own parallel histories.
- **Idempotent by construction.** Every write path — sync, hydration, season transitions, storyline evaluation — is tested to produce zero changes and zero new events on a re-run over unchanged data.

---

## Tech stack

- **Frontend:** Next.js / React, Tailwind
- **Backend:** local Node service, Next API routes
- **Database:** SQLite via Drizzle ORM
- **Save parsing:** a dedicated EA football save-format decoder, driven by each game's own `fifa_ng_db-meta.xml` datasheet. FIFA 17 to FC 26 saves use the classic 16-byte descriptor layout and FC 27 saves use the compact 9-byte layout; the game is identified from the save's own table directory before any field is decoded, so a save cannot be read with the wrong game's schema. `npm run meta:index` regenerates the identification index from the datasheets.

---

## Provenance in practice — a worked example

The clearest illustration of the whole philosophy: **league position**.

The save file keeps no live, reliable table for the manager's own division. So position isn't read but *inferred*, from three ranked sources of trust:

1. **The save's own field**, when present — shown, but flagged as a seed rather than an answer, since it's been independently verified as sometimes disagreeing with what the game itself displays.
2. **A points-per-game model**, fitted against the manager's own confirmed readings over time and the club's own completed-season history.
3. **The manager's own logged match results**, reconciled against the save's season record.

The result is always shown as a **band**, with its basis and evidence count stated plainly — never a single confident number pretending to be more certain than the underlying data supports.

---

## What's deliberately not here yet

- No AI/LLM layer. Every insight in the app today is deterministic code.
- No deep youth academy tracking beyond what the save itself exposes.
- No cloud sync, no accounts, no remote access from outside your own network. A phone can share the career over the LAN, deliberately and on your terms - see [docs/remote-access.md](docs/remote-access.md) - but there is no server in the middle and no way to reach it from the internet.

---

## Setup

```bash
git clone <repo>
cd touchline-os
npm install
npm run db:init
npm run dev
```

Point the app at your FC Career save when prompted on first launch. Nothing is uploaded anywhere — all parsing and storage happens locally.

### On a phone

```powershell
npm run build:browser                        # once, and after pulling changes
$env:TOUCHLINE_REMOTE="1"; npm run core      # prints a pairing code and an address
```

Open the printed address on the phone, on the same Wi-Fi, and enter the six-character code once - or
scan the QR the window draws. After that the phone is paired and reopening the address goes straight to
the career.

The same three steps are on the landing page and in **Settings → Devices**, which is also where the
device list, **Take control**, **Revoke** and **Stop sharing** live. The security model, the firewall
prompt and the troubleshooting table are in [docs/remote-access.md](docs/remote-access.md).

The core runs from the project folder, so pairing a phone needs the repo checked out with `npm install`
behind it. That is a limitation of the current packaging, not of the feature: a downloadable core is
future work, and the landing page says so rather than implying the hosted site can do it on its own.

---

## A note on honesty

Several features in this app exist specifically *because* something was found to be unreliable, ambiguous, or simply absent in the save, and the honest answer was judged more valuable than a confident-looking guess. Wages and transfer values are shown as bands with a stated confidence level, never a bare number. Board objectives the save can't decode are shown as undecoded rather than captioned with an invented meaning. Season totals are labeled for what they verifiably are (all-competition figures, not league-only) rather than mislabeled for what would look tidier. This isn't a limitation apologized for in a footnote but it's the design. Thank you and enjoy TouchlineOS 

## Donations
[![Donate](https://shields.io)](https://ko-fi.com/ianmadezoss)
