# Plan: season-to-season player stats, and finishing the debrief OCR

Written 2026-11-22. Nothing here is built yet. Both parts are scoped for their own runs.

---

## Part 1: Player stats (Squad → Stats tab)

### Goal
Every match and season a player has spent at the club stays viewable, summarised but not lost. FC/FIFA
throws this history away; we keep it.

### What exists today
- `player_match_ratings` (from `career_playermatchratinghistory`): one row per player per match with rating
  and minutes. **It is rewritten on every sync**, so anything the save drops is gone for good.
- Debrief logs: goals and assists the manager enters per match.
- `player_snapshots`: OVR, POT, age and wage at every sync. `SquadService.getPlayerGrowthHistory` reads this,
  but nothing calls it yet.
- The drawer shows only the current season (rating sparkline plus logged goals/assists).

### Data changes
1. **`player_match_archive`**: append-only. It is upserted from `player_match_ratings` on every sync, keyed by
   `(career_id, artificial_key)`, with `season_number`, `match_date`, `opponent_team_id`, `minutes`, `rating`.
   It is never deleted from. This is what makes history permanent.
2. **`player_season_summary`**: one row per `(career_id, player_id, season_number)`. It holds apps (≥15 min),
   minutes, average rating, best/worst rating, goals, assists (from debriefs), and OVR/POT at the start and end
   of the season (from snapshots), plus `left_club` when the player is no longer in the squad. It is recomputed
   from the archive and debriefs at the end of each sync, so it is derived and cheap to rebuild.
3. Departed players keep their rows. The archive is keyed by player id, not squad membership.

### UI (fifth sub-tab, next to Youth)
- **Stats list**: every player who has played for the club. Current squad first, then an "Include former
  players" toggle. Columns: seasons at club, apps, mins, avg, G, A, OVR then→now. Same dense FM-style table
  and column-priority rules as the squad table; cards on phones.
- **Player view**, with inner tabs:
  1. **Overview**: totals at the club, peak OVR, best season, best match.
  2. **Seasons**: one row per season, expandable to that season's matches.
  3. **Matches**: every match, filterable by season, with rating chip, minutes, G/A and opponent.
  4. **Development**: OVR/POT line over time from `getPlayerGrowthHistory`, with season markers.
- Provenance is labelled the same way the app already does it: SAVE for ratings and minutes, LOGGED for goals
  and assists.

### Order
archive table + sync upsert → season summary builder (with tests on the FC25 reference save) → service
and API → Stats list → player view tabs → mobile pass.

---

## Part 2: Finishing the OCR

### Where it stands
- tesseract.js, LSTM, with assets served locally. Summary is enabled. Shooting, Passing and Defending are
  written but disabled.
- **Shared cause of failure:** cells that read a lone `0` come back empty. The empty-cell retry crops one
  cell and uses PSM 7 with no padding. Tesseract needs a clear border around a single glyph, and a thin ring
  on a translucent panel reads as nothing.
- **All-or-nothing storage:** one unread row and nothing from the screen is kept. On every golden capture,
  3–12 rows go unread.
- Golden set: `data/ocr-golden` (FC25 Wigan: summary, shooting, passing, defending; one clean summary).
  It is gitignored.

### What `references/match-stats` shows
- **FC25/FC26 tabbed screens** (`myfc25-stats1-4`, `fc25-stats.jpg`): three columns (ours / label / theirs).
  Coloured bars sit right next to the numbers (`17▌`, `▌3`). On Shooting, the right column can carry a goal
  marker and a scorer count, e.g. `1 ⚽ 10`, which is two numbers in one cell.
- **`fc26-stats.webp`** is a phone photo of a TV: perspective skew, moiré, glare. The whole category needs
  perspective correction before any row logic.
- **FIFA 17/18/19** use a different single "Match Facts" panel: team names as column headers and about 8 rows.
  It needs its own layout profile; it is not a variant of FC25.

### Fixes, in order of payoff
1. **Digit reader for value cells.** The game font is fixed, so match digits against templates instead of
   asking tesseract. Split each cell into ink blobs, normalise each to about 20×28, and pick the nearest
   template harvested from the golden captures. A fixed font this way usually beats general OCR by a wide
   margin, and a lone `0` is just one blob. Tesseract stays for labels and for detecting which screen it is.
2. **Better single-cell retry** (a quick win before #1 lands): pad 12 px, upscale glyphs to about 48 px tall,
   use PSM 10 (single character) or PSM 8 (single word) with a digits-only whitelist.
3. **Strip the decorations.** Mask saturated green/blue before reading, which removes the bars. In the right
   column, take the right-most number token, which ignores the goal marker and scorer count.
4. **Arithmetic checks.** On + Off + Blocked = Total; the shot types sum to Total; Inside + Outside = Total;
   possession sums to 100. Use these to verify each read and to fill in **one** missing cell per constraint.
   Mark any filled-in cell as inferred.
5. **Fill-and-flag instead of all-or-nothing.** Give each cell a confidence (template distance + engine
   confidence + constraint agreement). Fill every cell, highlight the uncertain ones in amber, and show "Check
   the highlighted values before saving". Store the result with SCAN provenance only after the manager
   confirms. This matches "80% accurate still cuts the headache, just double check", and the UI says so
   plainly.
6. **Photos.** Find the panel's rule lines, apply a homography to straighten the panel, then run the normal
   pipeline.
7. **More profiles and golden data.** Transcribe the `references/match-stats` images into golden JSON. Add an
   FC26 profile (check whether it matches FC25) and a FIFA 17–19 "Match Facts" profile. Aim for 3+ captures
   per screen per game.

### Targets (measured with `npm run ocr:eval`)
- Clean screenshots: ≥95% cell accuracy. Phone photos: ≥80%.
- **Zero confident wrong values.** Any wrong cell must also be highlighted.
- Turn Shooting, Passing and Defending on as each one clears the targets on its own captures.

### Needed from Ian
More captures, especially FC26 PC/console screenshots of all four tabs, a couple of phone photos, and at
least one FIFA 17–21 Match Facts screen per game version you want to support.
