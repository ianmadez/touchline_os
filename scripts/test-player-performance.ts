#!/usr/bin/env -S npx tsx
/**
 * Checks the reading rules behind the squad's match-stats table and the dossier's form panel.
 *
 * The cases that matter are the refusals and the floors: a cameo must not move a player's form, a
 * missing rating must not read as zero, and the season boundary must not put last August's match in
 * this season. Every expectation here is a stated product rule, not a re-run of the implementation.
 *
 *   npx tsx scripts/test-player-performance.ts
 */
import {
  MIN_MINUTES_FOR_FORM,
  MIN_RATINGS_FOR_TREND,
  countsTowardForm,
  formatRating,
  ratingBand,
} from "../src/lib/squad/performance";
import { inSeason, seasonStartFor } from "../src/lib/squad/season-scope";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}\n        expected ${b}\n        actual   ${a}`);
  }
}

console.log("seasonStartFor");
check("August is in the season that opened that July", seasonStartFor("2026-08-11"), "2026-07-01");
check("June belongs to the season that opened the year before", seasonStartFor("2026-06-30"), "2025-07-01");
check("July itself opens a season", seasonStartFor("2026-07-01"), "2026-07-01");
check("December is the same season", seasonStartFor("2026-12-02"), "2026-07-01");
check("no date, no scope", seasonStartFor(null), null);
check("nonsense in, nothing out", seasonStartFor("last Tuesday"), null);
check("a save with no date means nothing is scoped", inSeason("2026-08-01", null), true);
check("a stage before the boundary is out", inSeason("2026-06-30", "2026-07-01"), false);
check("the boundary day itself is in", inSeason("2026-07-01", "2026-07-01"), true);
check("no date cannot be inside a scoped season", inSeason(null, "2026-07-01"), false);

console.log("countsTowardForm");
check("a full match counts", countsTowardForm(90), true);
check("exactly the floor counts", countsTowardForm(MIN_MINUTES_FOR_FORM), true);
check("a minute under the floor does not", countsTowardForm(MIN_MINUTES_FOR_FORM - 1), false);
check("a cameo does not", countsTowardForm(9), false);
check("minutes the save never recorded still count", countsTowardForm(-1), true);
check("zero minutes is a cameo", countsTowardForm(0), false);

console.log("ratingBand");
check("7.5 is good", ratingBand(7.5), "GOOD");
check("above 7.5 is good", ratingBand(10), "GOOD");
check("7.4 is fair", ratingBand(7.4), "FAIR");
check("6.0 is fair", ratingBand(6), "FAIR");
check("5.9 is poor", ratingBand(5.9), "POOR");
check("the save's floor reads poor", ratingBand(4), "POOR");

console.log("formatRating");
check("a rating is one decimal", formatRating(7), "7.0");
check("a half is kept", formatRating(7.55), "7.5");
check("an average keeps its precision", formatRating(6.64), "6.6");
check("three ratings is the trend floor", MIN_RATINGS_FOR_TREND, 3);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
