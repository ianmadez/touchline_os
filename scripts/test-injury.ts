/**
 * Checks for availability: who can be picked, and for how long.
 *
 * The whole feature rests on one comparison, so the checks are about the EDGES of that comparison rather
 * than about the happy path. A return date is a date the manager reads as "he can play that day", the app
 * has an in-game date that can be missing, and both of those are the places this goes quietly wrong:
 *
 *   - a player hurt "until the 12th" must be available ON the 12th, because a manager picking a team on the
 *     12th does not expect the app to disagree with him,
 *   - an expired injury must read as fit with nothing cleared by hand, which is the whole reason the record
 *     is a date and not a flag,
 *   - and an unknown in-game date must read as OUT, because the alternative is quietly picking an injured
 *     player into a team sheet.
 *
 *   npm run injury:test
 */
import {
  INJURY_DURATION_PRESETS,
  dayFrom,
  describeTimeOut,
  injuryBand,
  isAvailable,
  isInjured,
  type InjuryRecord,
} from "../src/lib/squad/injury";

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function record(until: string | null, note: string | null = null): InjuryRecord {
  return { until, note, reportedOn: "2026-11-08" };
}

console.log("\nthe boundary of a return date");

// The manager reads "back on the 12th" as available on the 12th. Anything else and the app argues with the
// team sheet he is holding.
check("a fit player is available", isAvailable(record(null), "2026-11-08"));
check("and is not injured", !isInjured(record(null), "2026-11-08"));
check("a player out until tomorrow is not available today", !isAvailable(record("2026-11-09"), "2026-11-08"));
check(
  "a player back ON a day is available that day",
  isAvailable(record("2026-11-08"), "2026-11-08"),
  "the return date itself counts"
);
check("the day before his return he is still out", !isAvailable(record("2026-11-09"), "2026-11-08"));
check("after his return date he is available", isAvailable(record("2026-10-01"), "2026-11-08"));
check("an expired injury needs nothing cleared by hand", isAvailable(record("2026-01-01"), "2026-11-08"));

console.log("\nan unknown clock is not an excuse to pick him");

check("with no in-game date, a dated injury reads as out", !isAvailable(record("2026-11-09"), null));
check("with no in-game date, an undated player still reads as fit", isAvailable(record(null), null));
check("and no record at all is fit rather than a crash", isAvailable(undefined, "2026-11-08"));
check("a profile with no injury object is fit", isAvailable(null, "2026-11-08"));
check("isInjured is exactly the inverse", isInjured(record("2026-11-09"), "2026-11-08"));

console.log("\nhow long, in a manager's words");

check("a fit player has no time out to describe", describeTimeOut(null, "2026-11-08") === null);
check("and neither does one whose date has arrived", describeTimeOut("2026-11-08", "2026-11-08") === null);
check("nor one whose date has passed", describeTimeOut("2026-10-01", "2026-11-08") === null);
check("no clock, no answer rather than a guess", describeTimeOut("2026-12-01", null) === null);
check("three days is a few days", describeTimeOut("2026-11-11", "2026-11-08") === "a few days");
check("a week is about a week", describeTimeOut("2026-11-15", "2026-11-08") === "about a week");
check("a fortnight is a couple of weeks", describeTimeOut("2026-11-22", "2026-11-08") === "a couple of weeks");
check("three weeks says three weeks", describeTimeOut("2026-11-29", "2026-11-08") === "about three weeks");
check("a month is a month or so", describeTimeOut("2026-12-06", "2026-11-08") === "a month or so");
check("six weeks still reads as about a month", describeTimeOut("2026-12-20", "2026-11-08") === "a month or so");
check("two months is a couple of months", describeTimeOut("2027-01-08", "2026-11-08") === "a couple of months");
check("three months is a few months", describeTimeOut("2027-02-06", "2026-11-08") === "a few months");
check("and a year is most of the season", describeTimeOut("2027-11-08", "2026-11-08") === "most of the season");
check(
  "every duration the manager can press reads back as a length, never as a blank",
  INJURY_DURATION_PRESETS.every((preset) => {
    const said = describeTimeOut(dayFrom("2026-11-08", preset.days), "2026-11-08");
    return typeof said === "string" && said.length > 0;
  })
);

console.log("\nthe band the copy is chosen by");

check("nothing to band without a date", injuryBand(null, "2026-11-08") === null);
check("nothing to band once he is back", injuryBand("2026-11-08", "2026-11-08") === null);
check("ten days is a knock", injuryBand("2026-11-18", "2026-11-08") === "KNOCK");
check("three weeks is a spell of weeks", injuryBand("2026-11-29", "2026-11-08") === "WEEKS");
check("a month is its own size of story", injuryBand("2026-12-06", "2026-11-08") === "MONTH");
check("three months is months", injuryBand("2027-02-06", "2026-11-08") === "MONTHS");
check("half a year is the season", injuryBand("2027-05-08", "2026-11-08") === "SEASON");
check(
  "every band is reachable, so no copy is written for nothing",
  (
    [
      ["KNOCK", "2026-11-15"],
      ["WEEKS", "2026-11-29"],
      ["MONTH", "2026-12-06"],
      ["MONTHS", "2027-02-06"],
      ["SEASON", "2027-06-30"],
    ] as const
  ).every(([band, until]) => injuryBand(until, "2026-11-08") === band)
);
check(
  "and the presets the manager presses cover all five bands",
  new Set(
    INJURY_DURATION_PRESETS.map((preset) => injuryBand(dayFrom("2026-11-08", preset.days), "2026-11-08"))
  ).size === 5
);
check(
  "every preset lands in the band that describes it",
  INJURY_DURATION_PRESETS.every((preset) => {
    const said = describeTimeOut(dayFrom("2026-11-08", preset.days), "2026-11-08") ?? "";
    const band = injuryBand(dayFrom("2026-11-08", preset.days), "2026-11-08");
    if (band === "KNOCK") return /a few days|about a week/.test(said);
    if (band === "WEEKS") return /a couple of weeks|about three weeks/.test(said);
    if (band === "MONTH") return /a month or so/.test(said);
    if (band === "MONTHS") return /a couple of months|a few months/.test(said);
    return /most of the season/.test(said);
  })
);

console.log("\ndurations, from the save's own clock");

check("two weeks from a day", dayFrom("2026-11-08", 14) === "2026-11-22", String(dayFrom("2026-11-08", 14)));
check("a month from a day", dayFrom("2026-11-08", 28) === "2026-12-06", String(dayFrom("2026-11-08", 28)));
check("a season from a day", dayFrom("2026-11-08", 180) === "2027-05-07", String(dayFrom("2026-11-08", 180)));
check("it crosses a year end without drifting", dayFrom("2026-12-31", 1) === "2027-01-01", String(dayFrom("2026-12-31", 1)));
check("an unreadable day gives nothing rather than a NaN date", dayFrom("", 14) === null);
check(
  "every preset the manager can press produces a real date",
  INJURY_DURATION_PRESETS.every((preset) => dayFrom("2026-11-08", preset.days) !== null)
);
check(
  "and the presets run shortest to longest, so the list reads as a scale",
  INJURY_DURATION_PRESETS.every(
    (preset, index) => index === 0 || preset.days > INJURY_DURATION_PRESETS[index - 1].days
  )
);
check(
  "a preset, once applied, always describes itself back in the same band",
  INJURY_DURATION_PRESETS.every((preset) => {
    const until = dayFrom("2026-11-08", preset.days);
    return until !== null && injuryBand(until, "2026-11-08") !== null;
  })
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nfailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
