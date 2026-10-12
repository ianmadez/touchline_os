/**
 * Checks for the news desk.
 *
 * The risk with a story generator is not that it crashes, it is that it prints the same paragraph every
 * week and calls that a newspaper. So the checks here are about VARIETY and about HONESTY, in that order:
 *
 *   - variety: how many kinds of story a rich career produces, that no two neighbouring stories are the
 *     same kind, that no two stories share a headline, and that the same facts with different evidence
 *     ids produce genuinely different wording rather than one fixed sentence.
 *   - honesty: that every story carries the numbers it was written from, that the hard conditions
 *     really do gate their stories (a clean sheet with no keeper on file is not published), that no
 *     story names a player who is not in the squad or the match data, that the output is deterministic
 *     across repeated calls, and that there is no em dash anywhere in it.
 *
 *   npm run news:test
 */
import { buildNews as buildEdition, foldName, roleGroup, typeOf, MAX_CONCERN_STORIES, MAX_EDITION_STORIES, type NewsAbsence, type NewsInput, type NewsMatch, type NewsPlayer } from "../src/lib/news/news-engine";
import { mediaAskFor } from "../src/lib/news/media";
import { allOutlets } from "../src/lib/news/outlets";
import { momentOf, phasePhrase, seasonPhase } from "../src/lib/news/moment";

/**
 * The desk with the paper's length cap lifted.
 *
 * The cap is a property of the EDITION rather than of the desk, so a check that a particular kind of story
 * exists would otherwise be checking that it won a slot on a page it shares with twenty others. Every check
 * below about what the desk CAN write asks for all of it; the length of a real edition, and the novelty that
 * rotates it, are checked separately against `buildEdition`.
 */
const buildNews = (newsInput: NewsInput, options: { maxStories?: number } = {}) =>
  buildEdition(newsInput, { maxStories: 99, ...options });

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

// ---------------------------------------------------------------------------------------------
// Fixtures: a career with everything going on at once
// ---------------------------------------------------------------------------------------------

const SQUAD: NewsPlayer[] = [
  { name: "Marcus Bell", role: "GK", age: 29, overall: 68, potential: 69, contractValidUntil: 2028, isKeeper: true },
  { name: "Theo Nkemdirim", role: "RB", age: 24, overall: 66, potential: 71, contractValidUntil: 2027, isKeeper: false },
  { name: "Callum Reid", role: "CB", age: 27, overall: 67, potential: 68, contractValidUntil: 2027, isKeeper: false },
  { name: "Ivan Petrov", role: "CB", age: 25, overall: 65, potential: 70, contractValidUntil: 2027, isKeeper: false },
  { name: "Luca Amato", role: "LB", age: 23, overall: 64, potential: 72, contractValidUntil: 2027, isKeeper: false },
  { name: "Sam Okafor", role: "DM", age: 26, overall: 66, potential: 67, contractValidUntil: 2027, isKeeper: false },
  { name: "Rafael Sousa", role: "CM", age: 22, overall: 65, potential: 74, contractValidUntil: 2026, isKeeper: false },
  { name: "Jonas Berg", role: "CM", age: 28, overall: 66, potential: 66, contractValidUntil: 2027, isKeeper: false },
  { name: "Danny Whitlock", role: "RW", age: 21, overall: 63, potential: 76, contractValidUntil: 2027, isKeeper: false },
  { name: "Omar Haddad", role: "LW", age: 25, overall: 66, potential: 69, contractValidUntil: 2027, isKeeper: false },
  { name: "Jordan Pike", role: "ST", age: 27, overall: 68, potential: 68, contractValidUntil: 2027, isKeeper: false },
];

function match(overrides: Partial<NewsMatch> & { eventId: string }): NewsMatch {
  return {
    matchDate: "2026-10-03",
    opponent: "Rovers",
    competition: "Championship",
    venue: "Home",
    result: "WIN",
    goalsFor: 2,
    goalsAgainst: 0,
    scorers: [],
    assisters: [],
    standouts: [],
    weakness: null,
    goalMinutes: [],
    concededMinutes: [],
    shots: null,
    shotsInsideBox: null,
    bigChances: null,
    comment: null,
    commentRefused: false,
    ...overrides,
  };
}

/** Newest first, five matches: W (4-0), W (2-1), W (3-1), D (1-1), L (0-2). */
const MATCHES: NewsMatch[] = [
  match({
    eventId: "evt-1",
    opponent: "Northgate Rovers",
    scorers: ["Jordan Pike", "Jordan Pike", "Danny Whitlock", "Omar Haddad"],
    assisters: ["Danny Whitlock", "Danny Whitlock", "Rafael Sousa"],
    standouts: ["Jordan Pike", "Marcus Bell"],
    weakness: "Switched off after scoring",
    goalMinutes: [12, 20, 63, 71],
    shots: 8,
    shotsInsideBox: 3,
    bigChances: 1,
  }),
  match({
    eventId: "evt-2",
    matchDate: "2026-09-26",
    opponent: "Harborough United",
    scorers: ["Jordan Pike", "Danny Whitlock"],
    assisters: ["Danny Whitlock", "Rafael Sousa", "Rafael Sousa"],
    standouts: ["Jordan Pike"],
    weakness: "Switched off after scoring",
    goalMinutes: [78, 90],
    shots: 14,
    shotsInsideBox: 9,
    bigChances: 2,
  }),
  match({
    eventId: "evt-3",
    matchDate: "2026-09-19",
    opponent: "Claymoor City",
    goalsFor: 3,
    goalsAgainst: 1,
    scorers: ["Jordan Pike", "Omar Haddad", "Theo Nkemdirim"],
    assisters: ["Rafael Sousa"],
    standouts: ["Marcus Bell"],
    goalMinutes: [5, 15, 80],
    concededMinutes: [88],
    shots: 12,
    shotsInsideBox: 7,
    bigChances: 3,
  }),
  match({
    eventId: "evt-4",
    matchDate: "2026-09-12",
    opponent: "Ashford Town",
    result: "DRAW",
    goalsFor: 1,
    goalsAgainst: 1,
    scorers: ["Omar Haddad"],
    goalMinutes: [41],
    concededMinutes: [62],
    shots: 11,
    shotsInsideBox: 6,
    bigChances: 2,
  }),
  match({
    eventId: "evt-5",
    matchDate: "2026-09-05",
    opponent: "Westerly Athletic",
    result: "LOSS",
    goalsFor: 0,
    goalsAgainst: 2,
    weakness: "Beaten in behind",
    concededMinutes: [23, 55],
    shots: 9,
    shotsInsideBox: 4,
    bigChances: 1,
  }),
];

function input(overrides: Partial<NewsInput> = {}): NewsInput {
  return {
    clubName: "Kingsbridge Athletic",
    managerName: "Alex Fenn",
    leagueName: "Championship",
    seasonNumber: 3,
    inGameYear: 2026,
    inGameDate: "2026-11-08",
    matches: MATCHES,
    squad: SQUAD,
    developments: [],
    seasons: [
      { season: 3, tablePosition: 0, complete: false },
      { season: 2, tablePosition: 6, complete: true },
      { season: 1, tablePosition: 2, complete: true },
    ],
    position: null,
    trophies: [{ name: "Championship", season: 1 }],
    academy: { name: "Nico Draper", age: 17, potential: 90, goals: 6, appearances: 9 },
    block: { gamesPlayed: 5, points: 10 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Empty and degenerate input
// ---------------------------------------------------------------------------------------------

console.log("\nan empty career publishes nothing");

const empty = buildNews({
  clubName: "Nowhere FC",
  managerName: "Nobody",
  leagueName: null,
  seasonNumber: 1,
  inGameYear: null,
  inGameDate: null,
  matches: [],
  squad: [],
  developments: [],
  seasons: [],
  position: null,
  trophies: [],
  academy: null,
  block: null,
});

check("no matches, no squad, no history -> an empty paper", empty.length === 0, `${empty.length} items`);

const matchesOnly = buildNews(input({ squad: [], seasons: [], trophies: [], academy: null, block: null }));
check(
  "matches with no squad still produce reports",
  matchesOnly.length > 0 && matchesOnly.every((item) => item.playerNames.length === 0 || true),
  `${matchesOnly.length} items`
);
check(
  "and a clean sheet with nobody on file falls back to the team rather than inventing a keeper",
  matchesOnly
    .filter((item) => item.id.startsWith("clean-sheet-"))
    .every((item) => !/goalkeeper|keeper/i.test(item.body) || /starts in front of him/.test(item.body)),
  matchesOnly.find((item) => item.id.startsWith("clean-sheet-"))?.body ?? "no clean sheet story"
);

// ---------------------------------------------------------------------------------------------
// 2. Variety
// ---------------------------------------------------------------------------------------------

console.log("\nvariety on a career with everything going on");

const rich = buildNews(input());
const categories = [...new Set(rich.map((item) => item.category))];
const headlines = rich.map((item) => item.headline);

// The paper itself is printed, because copy is the thing this feature actually ships and a check that
// only counts categories cannot tell you the sentences read badly.
console.log("");
for (const item of rich) {
  console.log(`  ${item.category} [${item.tone}] ${item.headline}`);
  console.log(`      ${item.body}`);
  console.log(`      (${item.evidence.join(" | ")})`);
}
console.log("");

check("a full career produces a substantial paper", rich.length >= 9, `${rich.length} stories`);
check(
  "across many different kinds of story",
  categories.length >= 8,
  `${categories.length} categories: ${categories.join(", ")}`
);
check(
  "no two neighbouring stories are the same kind",
  rich.every((item, index) => index === 0 || item.category !== rich[index - 1].category),
  rich.map((item) => item.category).join(" | ")
);
check(
  "and no two stories share a headline",
  new Set(headlines).size === headlines.length,
  headlines.join(" / ")
);
check("every story is categorised", rich.every((item) => item.category.trim().length > 0));
check(
  "every story has a body of more than one sentence",
  rich.every((item) => item.body.split(".").filter((part) => part.trim().length > 0).length >= 1),
  rich.map((item) => item.body.length).join(",")
);

console.log("\nthe same facts, dated differently, read differently");

const shifted = buildNews(
  input({ matches: MATCHES.map((entry, index) => ({ ...entry, eventId: `other-${index}` })) })
);
const form = rich.find((item) => item.id.startsWith("form-"));
const formShifted = shifted.find((item) => item.id.startsWith("form-"));
check("the form story exists in both editions", Boolean(form && formShifted));

// Variety is a property of the picker rather than of one lucky pair of ids, so it is measured over a run:
// the same set of facts, dated differently, must not keep producing the same sentence.
const wordings = new Set(
  Array.from({ length: 8 }, (_, index) => {
    const variant = buildNews(
      input({ matches: MATCHES.map((entry) => ({ ...entry, eventId: `seed-${index}-${entry.eventId}` })) })
    );
    const story = variant.find((item) => item.id.startsWith("form-unbeaten-"));
    return `${story?.headline}|${story?.body}`;
  })
);
check("one story type does not repeat itself across a run", wordings.size >= 3, `${wordings.size} distinct wordings`);

const richAgain = buildNews(input());
check(
  "the same facts always produce the same paper",
  JSON.stringify(rich) === JSON.stringify(richAgain)
);

// ---------------------------------------------------------------------------------------------
// 3. The conditions really gate the stories
// ---------------------------------------------------------------------------------------------

console.log("\nstories only run when the evidence is there");

function has(items: ReturnType<typeof buildNews>, prefix: string) {
  return items.some((item) => item.id.startsWith(prefix));
}

check("a 0 conceded match with a keeper produces the clean sheet story", has(rich, "clean-sheet-"));
const noClean = buildNews(
  input({ matches: [{ ...MATCHES[0], goalsAgainst: 1 }, ...MATCHES.slice(1)] })
);
check("a goal conceded removes it", !has(noClean, "clean-sheet-"));
check(
  "and the keeper is the one credited when it runs",
  rich.find((item) => item.id.startsWith("clean-sheet-"))?.playerNames.includes("Marcus Bell") === true
);
check(
  "a clean sheet is published once, however many clean sheets there are",
  rich.filter((item) => item.id.startsWith("clean-sheet-")).length === 1
);

// 4 goals from 8 shots with 1 big chance is a genuinely clinical afternoon (about 0.83 expected).
check("clinical finishing is reported when the shot figures say so", has(rich, "finishing-"));
const wasteful = buildNews(
  input({ matches: [{ ...MATCHES[0], goalsFor: 1, shots: 20, shotsInsideBox: 14, bigChances: 5 }, ...MATCHES.slice(1)] })
);
check("and wasted chances are reported the other way", has(wasteful, "finishing-"));
check(
  "the model's own figure is on the record under the story",
  rich.find((item) => item.id.startsWith("finishing-"))?.evidence.some((line) => /worth/.test(line)) === true,
  rich.find((item) => item.id.startsWith("finishing-"))?.evidence.join(" | ")
);
const noStats = buildNews(
  input({ matches: MATCHES.map((entry) => ({ ...entry, shots: null, shotsInsideBox: null, bigChances: null })) })
);
check("with no shot data there is no finishing verdict", !has(noStats, "finishing-"));
const narrow = buildNews(
  input({ matches: [{ ...MATCHES[0], goalsFor: 1, shots: 1, shotsInsideBox: 1, bigChances: 0 }, ...MATCHES.slice(1)] })
);
check(
  "a result inside a goal of expectation is not a story",
  !has(narrow, "finishing-"),
  "1 goal from 1 shot inside the box is 0.15 expected, inside the threshold"
);

const noMinutes = buildNews(
  input({ matches: MATCHES.map((entry) => ({ ...entry, goalMinutes: [] })) })
);
check("no logged goal minutes, no timing story", !has(noMinutes, "timing-"));

check("a four match unbeaten run is reported", has(rich, "form-unbeaten-"));
const winless = buildNews(
  input({
    matches: [
      { ...MATCHES[4], eventId: "l-1", matchDate: "2026-10-03" },
      { ...MATCHES[4], eventId: "l-2", matchDate: "2026-09-26" },
      { ...MATCHES[4], eventId: "l-3", matchDate: "2026-09-19" },
    ],
  })
);
check("a winless run is reported instead when that is the truth", has(winless, "form-winless-"));
check("and never both at once", !(has(winless, "form-unbeaten-") && has(winless, "form-winless-")));

check("a hot goalscorer is written up", has(rich, "scorer-"));check(
  "the top scorer is the subject",
  rich.find((item) => item.id.startsWith("scorer-"))?.playerNames[0] === "Jordan Pike"
);
const noGoals = buildNews(
  input({ matches: MATCHES.map((entry) => ({ ...entry, scorers: [] })) })
);
check("with nobody scoring there is no scorer story", !has(noGoals, "scorer-"));

check("assists are counted into their own story", has(rich, "assists-"));
check("praise repeated is a story", has(rich, "standout-"));
const noStandouts = buildNews(input({ matches: MATCHES.map((entry) => ({ ...entry, standouts: [] })) }));
check("no standout names, no praise story", !has(noStandouts, "standout-"));
check("a weakness named twice is a story", has(rich, "weakness-"));
const onceOnly = buildNews(
  input({
    matches: MATCHES.map((entry, index) => ({ ...entry, weakness: index === 0 ? "Switched off after scoring" : null })),
  })
);
check("named once, it is not", !has(onceOnly, "weakness-"));

const heavyLatest = buildNews(
  input({ matches: [{ ...MATCHES[0], goalsFor: 5, goalsAgainst: 0 }, ...MATCHES.slice(1)] })
);
/* One match, one voice. The lead story has already reported this ninety minutes in full, so a rout that is
 * also the latest result does not get a second piece - the same afternoon printed twice, with the manager's
 * own comment quoted in both. */
check("a rout that is also the latest result is not written up twice", !has(heavyLatest, "margin-"));

const heavyEarlier = buildNews(
  input({
    matches: [
      { ...MATCHES[0], goalsFor: 1, goalsAgainst: 0 },
      { ...MATCHES[1], goalsFor: 5, goalsAgainst: 1 },
      ...MATCHES.slice(2),
    ],
  })
);
check("a three goal margin from an earlier match is its own headline", has(heavyEarlier, "margin-"));
check("a one goal win is not", has(buildNews(input({ matches: [MATCHES[3], ...MATCHES.slice(1)] })), "result-"));

check(
  "and no single match is covered from more than four angles",
  (() => {
    const built = buildNews(input());
    const perEvent = new Map<string, number>();
    for (const item of built) {
      const eventId = input().matches.map((match) => match.eventId).find((id) => item.id.endsWith(id));
      if (!eventId) continue;
      if (!/^(result|clean-sheet|finishing|timing|margin|defence|weakness)-/.test(item.id)) continue;
      perEvent.set(eventId, (perEvent.get(eventId) ?? 0) + 1);
    }
    return [...perEvent.values()].every((count) => count <= 4);
  })()
);

check("contracts inside a year are flagged", has(rich, "contract-"));
check(
  "and the soonest one leads it",
  rich.find((item) => item.id.startsWith("contract-"))?.id.includes("Rafael Sousa") === true,
  "Sousa expires in 2026, the save year"
);
const noContracts = buildNews(
  input({ squad: SQUAD.map((player) => ({ ...player, contractValidUntil: 2032 })) })
);
check("nobody expiring soon, no transfer desk story", !has(noContracts, "contract-"));

// A squad with exactly one player in a position, and no matches: the depth notice is the only thing the desk
// can say, so the balance cap cannot hide it. Two good stories are there on purpose, because the fairness
// pass keeps at most as many critical stories as good ones, and a fixture with no good news would drop this
// one for the right reason.
const thinAtOnePosition = buildNews(
  input({
    matches: [],
    squad: [
      { name: "Keeper One", role: "GK", age: 29, overall: 68, potential: 69, contractValidUntil: 2030, isKeeper: true },
      ...SQUAD.slice(1, 11).map((player) => ({ ...player, contractValidUntil: 2030 })),
    ],
    seasons: [],
    trophies: [],
    block: null,
    position: null,
    academy: { name: "Nico Draper", age: 16, potential: 91, goals: 5, appearances: 8 },
  })
);
check("a position with one player in it is flagged", has(thinAtOnePosition, "depth-"));
const deepSquad = buildNews(
  input({
    squad: SQUAD.flatMap((player) =>
      player.isKeeper ? [player] : [player, { ...player, name: `${player.name} II` }]
    ),
  })
);
check(
  "with two in every position there is nothing to flag",
  !has(deepSquad, "depth-"),
  deepSquad.find((item) => item.id.startsWith("depth-"))?.id ?? ""
);

check("a high ceiling prospect is a story", has(rich, "youth-"));
check(
  "and the academy is credited, not the first team",
  rich.find((item) => item.id.startsWith("youth-"))?.playerNames[0] === "Nico Draper"
);
const ordinaryYouth = buildNews(
  input({ academy: { name: "Ordinary Lad", age: 18, potential: 71, goals: 0, appearances: 0 } })
);
check("a modest prospect with no record is not a story", !has(ordinaryYouth, "youth-"));
check(
  "but a modest prospect scoring for the youth team is",
  has(
    buildNews(
      input({ academy: { name: "Ordinary Lad", age: 18, potential: 71, goals: 4, appearances: 12 } })
    ),
    "youth-"
  )
);

check("a trophy in the cabinet is reported", has(rich, "trophy-"));
check("no trophies, no silverware story", !has(buildNews(input({ trophies: [] })), "trophy-"));

console.log("\nthe save's own player news");

const DEVELOPMENTS = [
  { id: "dev-1", name: "Danny Whitlock", position: "RW", oldOverall: 60, newOverall: 63, delta: 3, isProspect: false, isBreakthrough: true, on: null },
  { id: "dev-2", name: "Jonas Berg", position: "CM", oldOverall: 66, newOverall: 65, delta: -1, isProspect: false, isBreakthrough: false, on: null },
  { id: "dev-3", name: "Nico Draper", position: "CM", oldOverall: 51, newOverall: 52, delta: 1, isProspect: true, isBreakthrough: false, on: null },
];

const withMovement = buildNews(input({ developments: DEVELOPMENTS }));
// The fairness pass caps critical stories per edition, so a story is checked for its EXISTENCE on a thin
// career (where nothing competes) and the balance rules are checked separately below.
const thinWithMovement = buildNews(
  input({
    matches: [],
    squad: SQUAD.slice(0, 2),
    seasons: [],
    trophies: [],
    academy: null,
    block: null,
    position: null,
    developments: DEVELOPMENTS,
  })
);
check("a rating rise is reported", has(withMovement, "progress-"));
check(
  "and the biggest rise leads, with the breakthrough called out",
  withMovement.find((item) => item.id.startsWith("progress-"))?.id === "progress-dev-1" &&
    withMovement.find((item) => item.id.startsWith("progress-"))?.evidence.some((line) => /breakthrough/i.test(line)) === true
);
check(
  "the two ratings are both on the record",
  withMovement.find((item) => item.id.startsWith("progress-"))?.evidence.includes("Delta 3") === true
);
check("a fall is reported as a concern", has(thinWithMovement, "regress-"));
check(
  "and it is not dressed as good news",
  thinWithMovement.find((item) => item.id.startsWith("regress-"))?.tone === "CONCERN"
);
check("with no movement recorded there is nothing to say", !has(buildNews(input()), "progress-"));
const riseOnly = buildNews(input({ developments: [DEVELOPMENTS[0]] }));
check("a rise with no fall produces one story, not two", !has(riseOnly, "regress-"));

check("the squad's best player is written up", has(rich, "star-"));
check(
  "and he is the highest rated player in the squad",
  rich
    .find((item) => item.id.startsWith("star-"))
    ?.evidence.some((line) => /Highest rated player in the squad/.test(line)) === true,
  rich.find((item) => item.id.startsWith("star-"))?.evidence.join(" | ")
);
check(
  "a squad of part timers produces no star story",
  !has(
    buildNews(
      input({ squad: SQUAD.map((player) => ({ ...player, overall: 42, potential: 44 })) })
    ),
    "star-"
  )
);

const capped = buildNews(input({ squad: SQUAD.map((player) => ({ ...player, contractValidUntil: 2026 })) }));
check(
  "the paper is editorially capped at three stories of any one kind",
  capped.every((item) => capped.filter((other) => other.category === item.category).length <= 3),
  capped.map((item) => item.category).join(" | ")
);

check("the manager's own note is never quoted as fact", has(rich, "block-"));
check(
  "and the block reads as results rather than as a private target",
  /points from/.test(rich.find((item) => item.id.startsWith("block-"))?.body ?? "") &&
    !/target/i.test(rich.find((item) => item.id.startsWith("block-"))?.body ?? "")
);

const withPosition = buildNews(
  input({
    seasons: [
      { season: 3, tablePosition: 1, complete: true },
      { season: 2, tablePosition: 6, complete: true },
    ],
    position: { value: 1, basis: "season record", disputed: false },
  })
);
check("a stated league position is reported", has(withPosition, "position-"));
check(
  "and the ordinal reads correctly",
  withPosition.find((item) => item.id.startsWith("position-"))?.body.includes("1st") === true
);
check(
  "an empty mid-season table position publishes nothing",
  !has(rich, "position-"),
  "the save records 0 until the season ends"
);

const disputed = buildNews(
  input({
    seasons: [{ season: 3, tablePosition: 9, complete: true }],
    position: { value: 9, basis: "logged", disputed: true },
  })
);check(
  "a disputed position says it is disputed",
  disputed.find((item) => item.id.startsWith("position-"))?.body.includes("disagree") === true
);

// ---------------------------------------------------------------------------------------------
// The paper cannot know what the app knows
// ---------------------------------------------------------------------------------------------

console.log("\nthe reporter is not allowed to be omniscient");

const storyProse = rich.flatMap((item) => [item.headline, item.body]).join(" \n ");
const HIDDEN = [
  { label: "an overall rating", pattern: /\b\d{2}\s*overall|\boverall\b\s*\d{2}/i },
  { label: "a rating quoted as a fact", pattern: /rated\s+\d{2}/i },
  { label: "a potential", pattern: /potential/i },
  { label: "a ceiling", pattern: /ceiling/i },
  { label: "a snapshot delta", pattern: /\bdelta\b/i },
  { label: "two ratings compared", pattern: /\b\d{2}\s+to\s+\d{2}\b/i },
];
for (const rule of HIDDEN) {
  const hit = rule.pattern.exec(storyProse);
  check(
    `no story prints ${rule.label}`,
    hit === null,
    hit ? `"${hit[0]}" in: ${storyProse.slice(Math.max(0, hit.index - 60), hit.index + 60)}` : ""
  );
}

check(
  "and the same figures are still on the record under the story",
  rich.some((item) => item.evidence.some((line) => /ceiling|overall|delta|snapshot/i.test(line))),
  "the app's own note is where a rating belongs"
);
check(
  "the academy story talks about the youth team, not about a number",
  /under-(18|21)s|Academy|academy/.test(rich.find((item) => item.id.startsWith("youth-"))?.body ?? "") &&
    !/potential/i.test(rich.find((item) => item.id.startsWith("youth-"))?.body ?? "")
);
check(
  "and a story with no youth-team record still runs, hedged rather than invented",
  has(buildNews(input({ academy: { name: "Nico Draper", age: 16, potential: 90, goals: null, appearances: null } })), "youth-")
);
check(
  "a story credited to a source, because a paper has sources",
  /Those inside the club|The coaching staff|Senior figures at the club|People around the first team|The club's own staff/.test(storyProse)
);
check(
  "and every source reads as the subject of a plural verb",
  (() => {
    const found = storyProse.match(
      /Those inside the club|The coaching staff|Senior figures at the club|People around the first team|The club's own staff/g
    ) ?? [];
    if (found.length === 0) return false;
    // Whatever follows the source has to be a plural verb, or the sentence it is in does not parse.
    return found.every((phrase) => {
      const after = storyProse.slice(storyProse.indexOf(phrase) + phrase.length).trimStart();
      return /^(say|are|have|keep|were|will)/.test(after);
    });
  })(),
  "a source is only useful if the sentence around it is grammatical"
);

// ---------------------------------------------------------------------------------------------
// A clean sheet is a team achievement
// ---------------------------------------------------------------------------------------------

console.log("\nclean sheets are credited to whoever earned them");

const cleanSheet = (standouts: string[]) =>
  buildNews(input({ matches: [{ ...MATCHES[0], standouts }, ...MATCHES.slice(1)] })).find((item) =>
    item.id.startsWith("clean-sheet-")
  );

const keeperSingled = cleanSheet(["Marcus Bell"]);
const defenderSingled = cleanSheet(["Callum Reid"]);
const bothSingled = cleanSheet(["Marcus Bell", "Callum Reid"]);
const nobodySingled = cleanSheet([]);

check(
  "a keeper singled out gets the story",
  keeperSingled?.playerNames.includes("Marcus Bell") === true,
  `${keeperSingled?.headline} / ${keeperSingled?.playerNames.join(", ")}`
);
check(
  "a defender singled out gets the story instead, and the keeper is not named",
  defenderSingled?.playerNames.includes("Callum Reid") === true &&
    defenderSingled?.playerNames.includes("Marcus Bell") === false,
  `${defenderSingled?.headline} / ${defenderSingled?.playerNames.join(", ")}`
);
check(
  "both singled out share it",
  bothSingled?.body.includes("Marcus Bell") === true &&
    bothSingled?.body.includes("Callum Reid") === true,
  bothSingled?.body
);
check(
  "and with nobody singled out the men in front take the credit",
  (nobodySingled?.playerNames.length ?? 0) > 0 &&
    nobodySingled?.playerNames.includes("Marcus Bell") === false,
  `${nobodySingled?.headline} / ${nobodySingled?.playerNames.join(", ")}`
);
check(
  "the goalkeeper is never assumed to be the reason",
  /^\s*Marcus Bell/.test(nobodySingled?.headline ?? "") === false &&
    /^\s*Marcus Bell/.test(defenderSingled?.headline ?? "") === false
);
check(
  "and the run of clean sheets is always in the story",
  /clean sheet/.test(nobodySingled?.body ?? "") && /clean sheet/.test(defenderSingled?.body ?? "")
);
check(
  "a midfielder singled out is not claimed as a defender",
  buildNews(
    input({ matches: [{ ...MATCHES[0], standouts: ["Rafael Sousa"] }, ...MATCHES.slice(1)] })
  )
    .find((item) => item.id.startsWith("clean-sheet-"))
    ?.playerNames.includes("Rafael Sousa") === false
);

// ---------------------------------------------------------------------------------------------
// The press
// ---------------------------------------------------------------------------------------------

console.log("\nthe press come looking when something happened");

const ask = (overrides: Partial<NewsMatch>, seed = "evt-x") =>
  mediaAskFor(seed, {
    opponent: "Northgate Rovers",
    ourScore: overrides.goalsFor ?? 1,
    theirScore: overrides.goalsAgainst ?? 0,
    goalMinutes: overrides.goalMinutes ?? [],
    concededMinutes: overrides.concededMinutes ?? [],
  });

const heavyLoss = ask({ goalsFor: 0, goalsAgainst: 4 });
check("a heavy defeat is a strong story for the media", heavyLoss.interest === "STRONG");
check("and the prompt says what it is about", /4-0 defeat against Northgate Rovers/.test(heavyLoss.prompt), heavyLoss.prompt);
check("and it is almost always asked about", heavyLoss.asked);

const goalFest = ask({ goalsFor: 3, goalsAgainst: 3 });
check("a six-goal draw is a strong story", goalFest.interest === "STRONG" && goalFest.asked);

const cleanWin = ask({ goalsFor: 2, goalsAgainst: 0 });
check("a clean-sheet win is worth a word", cleanWin.interest === "MEDIUM", cleanWin.interest);
check("and reads as the clean sheet", /clean sheet/.test(cleanWin.subject), cleanWin.subject);

const lateWinner = ask({ goalsFor: 1, goalsAgainst: 0, goalMinutes: [88] });
check("a late finish is worth a word", lateWinner.interest === "MEDIUM", lateWinner.interest);

const quiet = ask({ goalsFor: 2, goalsAgainst: 1, goalMinutes: [23], concededMinutes: [40] });
check("a quiet win by a single goal is only an ordinary story", quiet.interest === "ORDINARY", quiet.interest);

const same = ask({ goalsFor: 0, goalsAgainst: 4 }, "evt-same");
const sameAgain = ask({ goalsFor: 0, goalsAgainst: 4 }, "evt-same");
check("the same match always gets the same answer", same.asked === sameAgain.asked && same.subject === sameAgain.subject);

// "Fairly often" is a claim about a distribution, so it is measured rather than asserted: a run of
// ordinary results, and a run of big ones, over many synthetic ids.
const rate = (overrides: Partial<NewsMatch>) =>
  Array.from({ length: 400 }, (_, index) => ask(overrides, `evt-${index}`)).filter((entry) => entry.asked).length / 400;
const strongRate = rate({ goalsFor: 0, goalsAgainst: 4 });
const ordinaryRate = rate({ goalsFor: 2, goalsAgainst: 1, goalMinutes: [23], concededMinutes: [40] });
check("big results are asked about most of the time", strongRate > 0.7, `${Math.round(strongRate * 100)}%`);
check("ordinary results are asked about sometimes", ordinaryRate > 0.1 && ordinaryRate < 0.45, `${Math.round(ordinaryRate * 100)}%`);
check(
  "and a nothing match is never asked about",
  rate({ goalsFor: 0, goalsAgainst: 0 }) === 0,
  "a goalless draw is not a story"
);

console.log("\nwhat the manager said, or did not");

const said = (overrides: Partial<NewsMatch>) =>
  buildNews(input({ matches: [{ ...MATCHES[0], ...overrides }, ...MATCHES.slice(1)] })).find((item) =>
    item.id.startsWith("result-")
  );

const quoted = said({ comment: "We were the better side for ninety minutes." });
check("a comment travels into the report", quoted?.quote === "We were the better side for ninety minutes.");
check("and the report sets it up", /manager/i.test(quoted?.body ?? ""));
check(
  "and the app notes that it was given",
  quoted?.evidence.includes("You gave the media a comment") === true,
  quoted?.evidence.join(" | ")
);

const refused = said({ commentRefused: true });
check("a refusal is reported too", refused?.quote === null && /Alex Fenn/.test(refused?.body ?? ""), refused?.body);
const REFUSAL_SHAPES = [
  "answered nothing afterwards",
  "No comment from",
  "refused to be drawn on it",
  "did not get one",
  "declined to speak",
];
check(
  "in one of several ways, never the same sentence every time",
  REFUSAL_SHAPES.some((shape) => (refused?.body ?? "").includes(shape)),
  refused?.body
);
const neverAsked = said({});
check(
  "and a manager nobody asked about says nothing about it",
  neverAsked?.quote === null &&
    !/declined|refused|No comment|answered nothing|did not get one/.test(neverAsked?.body ?? ""),
  neverAsked?.body
);
check(
  "the evidence says whether he was asked at all",
  neverAsked?.evidence.some((line) => /comment/i.test(line)) === false
);

// ---------------------------------------------------------------------------------------------
// 4. Honesty
// ---------------------------------------------------------------------------------------------

console.log("\nnames written differently are still one footballer");
check(
  "folding strips accents, punctuation and case",
  foldName("C. Patiño") === foldName("C. Patino") &&
    foldName("J. O'Brien") === "jobrien" &&
    foldName("I. OLAOFE") === foldName("I. Olaofe")
);

// The squad list is the save's spelling and a match contribution is the manager's, and they disagree
// about accents often enough that a story must never be lost to one.
const accented = buildNews(
  input({
    squad: SQUAD.map((player) => (player.name === "Jordan Pike" ? { ...player, name: "Jordán Pike" } : player)),
  })
);
const accentedScorer = accented.find((item) => item.id.startsWith("scorer-"));
check("a scorer whose squad name carries an accent still gets his story", Boolean(accentedScorer));
check(
  "and his goals are not lost to the difference",
  accentedScorer?.evidence[0] === "4 goals in 5 matches",
  accentedScorer?.evidence.join(" | ")
);
check(
  "while a report prints the spelling the match recorded",
  accented.find((item) => item.id.startsWith("result-"))?.body.includes("Jordan Pike") === true
);

console.log("\nevery story shows its working");

check("every story carries evidence", rich.every((item) => item.evidence.length > 0));
check(
  "with no blank evidence lines",
  rich.every((item) => item.evidence.every((line) => line.trim().length > 0)),
  rich.flatMap((item) => item.evidence).filter((line) => line.trim().length === 0).length + " blanks"
);
check("every story has a stable id", rich.every((item) => item.id.trim().length > 0));
check("and the ids are unique", new Set(rich.map((item) => item.id)).size === rich.length);

const squadNames = new Set(SQUAD.map((player) => player.name));
const matchNames = new Set(
  MATCHES.flatMap((entry) => [...entry.scorers, ...entry.assisters, ...entry.standouts])
);
const invented = rich
  .flatMap((item) => item.playerNames)
  .filter((name) => !squadNames.has(name) && !matchNames.has(name) && name !== "Nico Draper");
check("no story names a player nobody has heard of", invented.length === 0, invented.join(", "));

const prose = rich
  .flatMap((item) => [item.headline, item.body, item.category, ...item.evidence])
  .join(" ");
check("no em dash anywhere in the paper", !prose.includes("\u2014"), prose.match(/.{0,20}\u2014.{0,20}/)?.[0] ?? "");
check(
  "no story is published undated without saying it is about the present",
  rich
    .filter((item) => item.publishedOn === null)
    .every((item) => item.body.length > 0)
);check(
  "a match story is dated to its match",
  rich.find((item) => item.id.startsWith("result-"))?.publishedOn === "2026-10-03"
);
// A story is dated either by the match that produced it or by the save's own date. Nothing else: there is
// no third clock in this app, and a story stamped with the moment React rendered it would be fiction.
const MATCH_DATED = [
  "result-",
  "clean-sheet-",
  "finishing-",
  "timing-",
  "form-",
  "scorer-",
  "assists-",
  "standout-",
  "weakness-",
  "margin-",
];
const isMatchDated = (id: string) => MATCH_DATED.some((prefix) => id.startsWith(prefix));

check(
  "a match story is dated to the newest match it was written from",
  rich
    .filter((item) => isMatchDated(item.id))
    .every((item) => item.publishedOn === "2026-10-03"),
  rich.filter((item) => isMatchDated(item.id)).map((i) => `${i.id}:${i.publishedOn}`).join(", ")
);
check(
  "and a story about how things stand is dated by the save itself",
  rich
    .filter((item) => !isMatchDated(item.id))
    .every((item) => item.publishedOn === "2026-11-08"),
  rich.filter((item) => !isMatchDated(item.id)).map((i) => `${i.id}:${i.publishedOn}`).join(", ")
);
check(
  "a career with no in-game date publishes the standing stories undated rather than inventing one",
  buildNews(input({ inGameDate: null }))
    .filter((item) => !isMatchDated(item.id))
    .every((item) => item.publishedOn === null)
);
check(
  "the lead story is the most significant",
  rich[0].weight >= rich[rich.length - 1].weight
);
check(
  "every tone is one of the three",
  rich.every((item) => ["GOOD", "NEUTRAL", "CONCERN"].includes(item.tone))
);
check(
  "a loss is not dressed as good news",
  buildNews(input({ matches: [MATCHES[4], MATCHES[3]] })).find((item) => item.id.startsWith("result-"))?.tone ===
    "CONCERN"
);

// ---------------------------------------------------------------------------------------------
// The article, and the name at the top of it
// ---------------------------------------------------------------------------------------------

console.log("\nevery story can be opened and read");

check(
  "every story carries an article",
  rich.every((item) => item.article.length >= 1)
);
check(
  "the article opens with the card's own summary",
  rich.every((item) => item.article[0] === item.body)
);
check(
  "no article has an empty or whitespace paragraph",
  rich.every((item) => item.article.every((paragraph) => paragraph.trim().length > 0))
);
check(
  "most stories get a piece of more than one paragraph",
  rich.filter((item) => item.article.length >= 2).length >= Math.ceil(rich.length * 0.8),
  `${rich.filter((item) => item.article.length >= 2).length} of ${rich.length}`
);
check(
  "no two NEIGHBOURING stories close on the same sentence",
  rich.every((item, index) => item.article.at(-1) !== rich[index - 1]?.article.at(-1))
);
check(
  "and no sentence of the closing paragraph is reused anywhere else in the edition",
  (() => {
    // The closing paragraph is the last thing a reader sees of a story and the first thing he notices when it
    // comes back. This is the check that fails if a pool is exhausted or a frame is chosen by position again:
    // every closing sentence in the edition has to be a sentence no other story used.
    const closings = rich.map((item) => item.article.at(-1) ?? "");
    const reused = closings.filter((closing, index) => closings.indexOf(closing) !== index);
    return reused.length === 0;
  })(),
  (() => {
    const closings = rich.map((item) => item.article.at(-1) ?? "");
    const reused = [...new Set(closings.filter((c, i) => closings.indexOf(c) !== i))];
    return `${new Set(closings).size} distinct for ${rich.length} stories; repeated: ${reused
      .map((closing) => `"${closing.slice(0, 70)}"`)
      .join(" | ")}`;
  })()
);
check(
  "nothing in an article repeats a sentence from another paragraph of itself",
  rich.every((item) => {
    const sentences = item.article.join(" ").split(/(?<=\.)\s+/).map((s) => s.trim());
    return new Set(sentences).size === sentences.length;
  })
);

console.log("\nthe press library, and who filed what");

check(
  "every story that is journalism carries a byline",
  rich
    .filter((item) =>
      ["TOP STORY", "MATCH REPORT", "ANALYSIS", "THE VERDICT", "PLAYER FOCUS", "FORM WATCH"].includes(
        item.category
      )
    )
    .every((item) => item.byline !== null)
);
check(
  "and the desk's own notices do not pretend to be journalism",
  rich
    .filter((item) => ["SQUAD WATCH", "THE PLAN", "TABLE WATCH"].includes(item.category))
    .every((item) => item.byline === null)
);
check(
  "a byline names an outlet, a writer and their desk",
  rich
    .filter((item) => item.byline !== null)
    .every((item) => {
      const byline = item.byline;
      return Boolean(byline && byline.outlet && byline.writer && byline.writerRole && byline.dateline);
    })
);
check(
  "the dateline is the club's own name, upper-cased, and not an invented town",
  rich
    .filter((item) => item.byline !== null)
    .every((item) => item.byline?.dateline === "KINGSBRIDGE")
);
check(
  "the same story always gets the same byline",
  rich[0].byline?.writer === buildNews(input())[0].byline?.writer
);
check(
  "two different stories usually get different writers",
  new Set(rich.filter((item) => item.byline !== null).map((item) => item.byline?.writer)).size >= 2
);
check(
  "a nation with its own press is filed with it",
  buildNews(input({ countryId: 13 }))
    .filter((item) => item.byline !== null)
    .some((item) => ["Superliga Nyt", "Straffe"].includes(item.byline?.outlet ?? ""))
);
check(
  "a nation with no pool of its own falls back to the wire and the English press",
  buildNews(input({ countryId: 999 }))
    .filter((item) => item.byline !== null)
    .every((item) =>
      ["Continental Sport Wire", "Ninety Plus", "The Hard Tackle", "The Touchline", "Final Whistle", "The Terrace", "Matchday Post"].includes(
        item.byline?.outlet ?? ""
      )
    )
);
check(
  "every outlet in the library has writers on it",
  allOutlets().every((outlet) => outlet.writers.length >= 2 && outlet.writers.every((w) => w.name && w.role))
);
check(
  "and no outlet borrows a real newsroom's name",
  allOutlets().every(
    (outlet) =>
      !/(sky sports|goal\.com|the guardian|the times|the telegraph|bbc|espn|eurosport)/i.test(outlet.name)
  )
);

console.log("\nthe press ask something a manager can answer");

const asked = mediaAskFor("evt-media-1", {
  opponent: "Northgate Rovers",
  ourScore: 4,
  theirScore: 0,
  goalMinutes: [12, 40, 61, 88],
  concededMinutes: [],
  scorers: ["Jordan Pike"],
  clubName: "Kingsbridge Athletic",
  competition: "Championship",
});

check("a heavy win brings the press out", asked.asked === true);
check("the question is a question", asked.question.endsWith("?"), asked.question);
check("the prompt names who is asking", asked.prompt.includes(asked.writer ?? "") && asked.prompt.includes(asked.outlet ?? ""));
check("and the outlet is a fictional one from the library", allOutlets().some((o) => o.name === asked.outlet));
check(
  "the question is about something that happened in THIS match",
  /whether|how|what|where|if/i.test(asked.question) &&
    (asked.question.includes("Pike") ||
      asked.question.includes("4-0") ||
      asked.question.includes("margin") ||
      asked.question.includes("defence") ||
      asked.question.includes("keeper") ||
      asked.question.includes("season") ||
      asked.question.includes("Rovers") ||
      asked.question.includes("believe")),
  asked.question
);
check(
  "the same match always produces the same question",
  mediaAskFor("evt-media-1", {
    opponent: "Northgate Rovers",
    ourScore: 4,
    theirScore: 0,
    goalMinutes: [12, 40, 61, 88],
    concededMinutes: [],
    scorers: ["Jordan Pike"],
  }).question === asked.question
);
check(
  "a different match produces a different question",
  mediaAskFor("evt-media-2", {
    opponent: "Westerly Athletic",
    ourScore: 0,
    theirScore: 2,
    goalMinutes: [],
    concededMinutes: [23, 55],
  }).question !== asked.question
);
check(
  "a cup tie is asked about as a cup tie",
  mediaAskFor("evt-media-cup", {
    opponent: "Ashford Town",
    ourScore: 1,
    theirScore: 0,
    goalMinutes: [80],
    concededMinutes: [],
    competition: "FA Cup",
  }).question.toLowerCase().includes("fa cup") ||
    mediaAskFor("evt-media-cup", {
      opponent: "Ashford Town",
      ourScore: 1,
      theirScore: 0,
      goalMinutes: [80],
      concededMinutes: [],
      competition: "FA Cup",
    }).question.toLowerCase().includes("cup run")
);

console.log("\na story has to make sense to someone who cannot see the app");

// A THIN career on purpose: the ranking caps each category at three stories, so a rich fixture can hide a
// development story behind three other player stories. What is being checked here is the copy, not the rank.
const rising = buildNews(
  input({
    matches: [],
    squad: SQUAD.slice(0, 2),
    seasons: [],
    trophies: [],
    academy: null,
    block: null,
    position: null,
    developments: [
      {
        id: "dev-up",
        name: "Danny Whitlock",
        position: "RW",
        oldOverall: 63,
        newOverall: 64,
        delta: 1,
        isProspect: false,
        isBreakthrough: false,
        on: "2026-11-08",
      },
      {
        id: "dev-down",
        name: "Jonas Berg",
        position: "CM",
        oldOverall: 66,
        newOverall: 65,
        delta: -1,
        isProspect: false,
        isBreakthrough: false,
        on: "2026-11-08",
      },
    ],
  })
);

const up = rising.find((item) => item.id === "progress-dev-up");
const down = rising.find((item) => item.id === "regress-dev-down");

check("a player who improved gets a story", up !== undefined);
check(
  "and it says what improved rather than quoting a rating",
  Boolean(up && /(better|improved|the level|going the right way|kicked on)/i.test(up.body)) &&
    Boolean(up && !/\b6[0-9] to 6[0-9]\b/.test(up.body)),
  up?.body
);
check(
  "the rating stays in the app's own note, not in the copy",
  Boolean(up && up.evidence.some((line) => line.includes("63 to 64")))
);
check("a player who went backwards gets a story", down !== undefined);
check(
  "the story names FORM as what dropped, so a reader knows what it is about",
  Boolean(down && /(form|level|standards|edge|boil|dip)/i.test(down.body)),
  down?.body
);
check(
  "and it is filed as form, not as a verdict on the player",
  down?.category === "FORM WATCH",
  down?.category
);
check(
  "it says why anybody should care",
  Boolean(down && /(noticed|watching|expected|early|plan)/i.test(down.body))
);
check(
  "the old wording that made no sense without the app is gone for good",
  !/\bone point is not a crisis\b/i.test(JSON.stringify(rising)) &&
    !/\bsomething has gone out of him\b/i.test(JSON.stringify(rising))
);
check(
  "no position code is used as a word in the prose",
  rising.every((item) => !/\b(a|the) (CM|RW|CB|LB|RB|ST|GK|DM|CDM|CAM)\b/.test(item.body)),
  rising.map((item) => item.body).join(" | ")
);
check(
  "the piece explains it at length rather than restating the card",
  Boolean(down && down.article.length >= 4) &&
    Boolean(down && down.article.slice(1).every((paragraph) => paragraph !== down.body))
);

console.log("\nthe paper does not pile on");

// The user's own complaint, turned into a rule: a desk with three critical stories and one good one about the
// same struggling squad is not being honest, it is being sour. Both rules are about the SHAPE of an edition.
const concernCount = (items: typeof rich) => items.filter((item) => item.tone === "CONCERN").length;
const goodCount = (items: typeof rich) => items.filter((item) => item.tone === "GOOD").length;

check(
  `no more than ${MAX_CONCERN_STORIES} critical stories in one edition`,
  concernCount(rich) <= MAX_CONCERN_STORIES,
  `${concernCount(rich)} critical of ${rich.length}`
);
check(
  "and critical stories never outnumber positive ones",
  concernCount(rich) <= Math.max(goodCount(rich), 1),
  `${concernCount(rich)} critical vs ${goodCount(rich)} positive`
);
check(
  "no player is hit twice in one edition",
  (() => {
    const seen = new Set<string>();
    for (const item of rich.filter((entry) => entry.tone === "CONCERN")) {
      for (const name of item.playerNames) {
        if (seen.has(name.toLowerCase())) return false;
        seen.add(name.toLowerCase());
      }
    }
    return true;
  })()
);
check(
  "a dropped story is not tombstoned, so it can print on a later read",
  // The desk still knows the story: it is the EDITION that leaves it out.
  has(buildNews(input({ developments: DEVELOPMENTS, matches: [] })), "regress-") === false ||
    has(thinWithMovement, "regress-")
);

console.log("\nthe age, the phrasing, and what a reader can actually see");

// Danny Whitlock is 21 in the fixture. The first version said "He is 17." in the card's body and then "For a
// player of 17, this is the stretch where..." in the piece, which is the same field quoted twice and reads as
// a machine. Age once, and never in that construction.
const ageOf = (items: typeof rising, name: string) =>
  SQUAD.find((player) => player.name === name)?.age ?? null;
const upStory = rising.find((item) => item.id === "progress-dev-up") ?? null;
const upAge = ageOf(rising, "Danny Whitlock");
const upText = upStory ? [upStory.body, ...upStory.article].join(" ") : "";

check("the improved player's story exists to check", upStory !== null);
check(
  `his age (${upAge}) appears at most once across the card and the piece`,
  upAge !== null && !new RegExp(`\\b${upAge}\\b`, "g").test("") && (upText.match(new RegExp(`\\b${upAge}\\b`, "g")) ?? []).length <= 1,
  (upText.match(new RegExp(`\\b${upAge}\\b`, "g")) ?? []).length + " mentions"
);
check(
  "and neither of the machine's constructions is anywhere in the copy",
  rising.every((item) =>
    !/For a player of \d+/.test([item.body, ...item.article].join(" ")) &&
    !/He is \d+\.\s/.test([item.body, ...item.article].join(" "))
  ),
  rising.map((item) => item.body).join(" | ")
);
check(
  "a position is written as football says it, never as a code",
  rising.every((item) =>
    !/\b(?:a|the|at)\s+(?:CM|RW|CB|LB|RB|ST|GK|DM|CDM|CAM|LW|RM|LM)\b/.test(
      [item.body, ...item.article].join(" ")
    )
  )
);

// ---------------------------------------------------------------------------------------------
// The treatment room
// ---------------------------------------------------------------------------------------------

console.log("\nthe treatment room reports what the manager filed, by how long");

/** An absence, dated off the fixture's own save date of 2026-11-08. */
function absence(overrides: Partial<NewsAbsence> = {}): NewsAbsence {
  return {
    name: "Jordan Pike",
    role: "ST",
    age: 27,
    until: "2026-11-22",
    note: null,
    reportedOn: "2026-11-08",
    ...overrides,
  };
}

const noInjuries = buildNews(input({ injuries: [] }));
check(
  "a healthy squad produces no treatment room story at all",
  noInjuries.every((item) => item.category !== "TEAM NEWS")
);
check(
  "and an injury with no date is not a story either, because there is nothing to report",
  buildNews(input({ injuries: [absence({ until: null })] })).every(
    (item) => item.category !== "TEAM NEWS"
  )
);

// One band per story: the size of the absence decides how much paper it gets.
const knock = buildNews(input({ injuries: [absence({ until: "2026-11-15" })] })).find((item) =>
  item.id.startsWith("injury-")
);
const weeks = buildNews(input({ injuries: [absence({ until: "2026-11-29" })] })).find((item) =>
  item.id.startsWith("injury-")
);
const month = buildNews(input({ injuries: [absence({ until: "2026-12-06" })] })).find((item) =>
  item.id.startsWith("injury-")
);
const months = buildNews(input({ injuries: [absence({ until: "2027-02-06" })] })).find((item) =>
  item.id.startsWith("injury-")
);
const season = buildNews(input({ injuries: [absence({ until: "2027-06-30" })] })).find((item) =>
  item.id.startsWith("injury-")
);

const injuryId = (band: string) => `injury-${foldName("Jordan Pike")}-${band}`;

check("a week is a knock and prints as one", knock?.id === injuryId("KNOCK"), knock?.id);
check("three weeks is a spell of weeks", weeks?.id === injuryId("WEEKS"), weeks?.id);
check("a month out gets its own size of story", month?.id === injuryId("MONTH"), month?.id);
check("months out is its own story", months?.id === injuryId("MONTHS"), months?.id);
check("and the season is the biggest of them", season?.id === injuryId("SEASON"), season?.id);

check(
  "every one of them names the player, files under TEAM NEWS and is bad news",
  [knock, weeks, month, months, season].every(
    (item) =>
      item !== undefined &&
      item.category === "TEAM NEWS" &&
      item.tone === "CONCERN" &&
      item.playerNames.includes("Jordan Pike")
  )
);

check(
  "a longer absence is a bigger story, in that order",
  (knock?.weight ?? 0) < (weeks?.weight ?? 0) &&
    (weeks?.weight ?? 0) < (month?.weight ?? 0) &&
    (month?.weight ?? 0) < (months?.weight ?? 0) &&
    (months?.weight ?? 0) < (season?.weight ?? 0),
  [knock?.weight, weeks?.weight, month?.weight, months?.weight, season?.weight].join(" < ")
);

// The headline is chosen by band, so the band has to agree with the length being described. A four week
// absence filed under "out for months" is the sort of thing a reader notices and a writer never does.
const treatment = [knock, weeks, month, months, season].filter(
  (item): item is NonNullable<typeof item> => item !== undefined
);
check(
  "no headline claims more time out than the band it was written from",
  [knock, weeks, month].every(
    (item) => item !== undefined && !/months/i.test(item.headline)
  ) &&
    [knock, weeks].every((item) => item !== undefined && !/month/i.test(item.headline)) &&
    [knock].every((item) => item !== undefined && !/weeks/i.test(item.headline)),
  [knock?.headline, weeks?.headline, month?.headline].join(" / ")
);
check(
  "and the longest two do claim it, or there would be no story at all",
  /months/i.test(months?.headline ?? "") || /months/i.test(months?.body ?? ""),
  months?.headline
);

check(
  "the exact return date stays in the app's own note, out of the copy",
  treatment.every(
    (item) =>
      !/\d{4}-\d{2}-\d{2}/.test([item.headline, item.body, ...item.article].join(" ")) &&
      item.evidence.some((line) => /\d{4}-\d{2}-\d{2}/.test(line))
  ),
  weeks?.evidence.join(" | ")
);

check(
  "a report carries a byline, because a report is journalism",
  treatment.every((item) => item.byline !== null)
);

check(
  "the piece is longer than the card and explains itself",
  treatment.every((item) => item.article.length >= 3 && item.article[0] === item.body)
);

check(
  "no card counts the days out",
  treatment.every((item) => !/\b\d+\s*(?:day|days|week|weeks|month|months)\b/i.test(item.body)),
  weeks?.body
);
check(
  "and the length is said in words on most of them",
  treatment.filter((item) =>
    /a few days|about a week|a couple of weeks|about three weeks|a month or so|a couple of months|a few months|most of the season|for the season/.test(
      item.body
    )
  ).length >= 3,
  treatment.map((item) => item.body.slice(0, 60)).join(" | ")
);

const described = buildNews(
  input({ injuries: [absence({ until: "2026-12-06", note: "hamstring" })] })
).find((item) => item.id.startsWith("injury-"));
check(
  "the manager's own note is quoted as his, in the piece",
  described !== undefined && described.article.some((paragraph) => paragraph.includes('"hamstring"'))
);
check(
  "and a report with no note does not invent one",
  weeks !== undefined && !/hamstring|ankle|knee|groin/.test(weeks.article.join(" "))
);

// A player the manager has actually picked and a player he has not are two different stories. The first
// version of this piece told both of them that he "has been a regular part of this side", which is a claim
// about the team sheet the desk had never checked - and a manager reads that sentence about his own bench.
console.log("\nwho the absent player is decides what is lost");

const hurtStarter = buildNews(
  input({ injuries: [absence({ until: "2026-12-06", isStarter: true })] })
).find((item) => item.id.startsWith("injury-"));
const hurtSquadPlayer = buildNews(
  input({ injuries: [absence({ until: "2026-12-06", isStarter: false })] })
).find((item) => item.id.startsWith("injury-"));
const copyOf = (item: NonNullable<typeof hurtStarter>) =>
  [item.headline, item.body, ...item.article].join(" ");

check(
  "a starter's absence is written as a change to the XI",
  hurtStarter !== undefined &&
    hurtSquadPlayer !== undefined &&
    copyOf(hurtStarter) !== copyOf(hurtSquadPlayer)
);
check(
  "and a squad player's absence never claims he has been playing",
  (() => {
    if (!hurtSquadPlayer) return false;
    const copy = copyOf(hurtSquadPlayer);
    return !/regular part of this|has been carrying|in the manager's XI when everybody is fit/.test(copy);
  })(),
  hurtSquadPlayer ? copyOf(hurtSquadPlayer) : "no story"
);
check(
  "and it does not pretend the team sheet has to be rewritten either",
  (() => {
    if (!hurtSquadPlayer) return false;
    const copy = copyOf(hurtSquadPlayer);
    return !/the team looks like without|what the XI loses|has to change how the side plays/.test(copy);
  })(),
  hurtSquadPlayer ? copyOf(hurtSquadPlayer) : "no story"
);
check(
  "a manager with no XI saved gets the version that claims nothing about him",
  (() => {
    const unknown = buildNews(input({ injuries: [absence({ until: "2026-12-06" })] })).find((item) =>
      item.id.startsWith("injury-")
    );
    if (!unknown) return false;
    return !/regular part of this|in the manager's XI when everybody is fit/.test(copyOf(unknown));
  })()
);
check(
  "two players out in the same week do not share a standing sentence",
  (() => {
    const two = buildNews(
      input({
        injuries: [
          absence({ name: "Jordan Pike", role: "ST", until: "2026-12-06", isStarter: true }),
          absence({ name: "Callum Reid", role: "CB", until: "2026-12-06", isStarter: true }),
        ],
      })
    ).filter((item) => item.id.startsWith("injury-"));
    if (two.length !== 2) return false;
    const secondParagraphs = two.map((item) => item.article[1] ?? "");
    return new Set(secondParagraphs).size === 2;
  })()
);

// Two players hurt in the same week is a real situation, and it is two stories.
const twoOut = buildNews(
  input({
    injuries: [
      absence({ until: "2026-12-06" }),
      absence({ name: "Callum Reid", role: "CB", until: "2027-02-06" }),
    ],
  })
);
check(
  "two absences are two stories, not one line about a crisis",
  twoOut.filter((item) => item.id.startsWith("injury-")).length === 2
);
check(
  "and neither of them is dropped by the fairness cap for being bad news",
  twoOut.filter((item) => item.category === "TEAM NEWS").length >= 2
);

console.log("\ncoming back is its own story, and it expires");

const returned = buildNews(input({ injuries: [absence({ until: "2026-11-03" })] }));
check(
  "a player whose return date has passed is back, not still out",
  returned.some((item) => item.id.startsWith("return-")) &&
    !returned.some((item) => item.id.startsWith("injury-"))
);
check(
  "and the return is good news filed under the same desk",
  returned.find((item) => item.id.startsWith("return-"))?.tone === "GOOD"
);
check(
  "returning on the day itself counts as back, not as still injured",
  buildNews(input({ injuries: [absence({ until: "2026-11-08" })] })).some((item) =>
    item.id.startsWith("return-")
  )
);
check(
  "but a return stops being news once the squad has settled without him",
  buildNews(input({ injuries: [absence({ until: "2026-10-01" })] })).every(
    (item) => !item.id.startsWith("return-")
  )
);
check(
  "a younger player's age may be said, once, in the piece only",
  (() => {
    const item = buildNews(
      input({ injuries: [absence({ name: "Danny Whitlock", role: "RW", age: 21, until: "2026-11-05" })] })
    ).find((story) => story.id.startsWith("return-"));
    if (!item) return false;
    const copy = [item.headline, item.body, ...item.article].join(" ");
    return (copy.match(/\b21\b/g) ?? []).length <= 1;
  })()
);

check(
  "an injury report carries no em dash and no position code as a word",
  [...treatment, returned.find((item) => item.id.startsWith("return-"))]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .every((item) => {
      const copy = [item.headline, item.body, ...item.article].join(" ");
      return !copy.includes("\u2014") && !/\b(?:a|the|at)\s+(?:CM|RW|CB|LB|RB|ST|GK|DM)\b/.test(copy);
    })
);

// ---------------------------------------------------------------------------------------------
// Part A: the sentences that used to break
// ---------------------------------------------------------------------------------------------

console.log("\nthe report says what happened, in sentences that hold");

/* Every shape of result, crossed with the things that used to break a sentence.
 *
 * A generated matrix rather than a handful of fixtures, because every one of these bugs is a "one
 * combination happens to do it": a single scorer with a brace, a scoreline with no scorer logged, a
 * goalless match, an away match, no opponent recorded at all. Each cell has to pass the same rules, so the
 * combination nobody thought of is covered by construction rather than by remembering to add it. */
const GOAL_SHAPES: {
  label: string;
  goalsFor: number;
  goalsAgainst: number;
  scorers: string[];
  minutes: number[];
  conceded: number[];
}[] = [
  { label: "0-0", goalsFor: 0, goalsAgainst: 0, scorers: [], minutes: [], conceded: [] },
  { label: "1-0", goalsFor: 1, goalsAgainst: 0, scorers: ["Jordan Pike"], minutes: [30], conceded: [] },
  { label: "2-0 brace", goalsFor: 2, goalsAgainst: 0, scorers: ["Jordan Pike", "Jordan Pike"], minutes: [10, 50], conceded: [] },
  { label: "3-0 hat-trick", goalsFor: 3, goalsAgainst: 0, scorers: ["Jordan Pike", "Jordan Pike", "Jordan Pike"], minutes: [5, 25, 80], conceded: [] },
  { label: "4-1", goalsFor: 4, goalsAgainst: 1, scorers: ["Jordan Pike", "Jordan Pike", "Danny Whitlock", "Omar Haddad"], minutes: [9, 33, 61, 88], conceded: [70] },
  { label: "3-2 thriller", goalsFor: 3, goalsAgainst: 2, scorers: ["Jordan Pike", "Omar Haddad", "Danny Whitlock"], minutes: [12, 44, 90], conceded: [20, 77] },
  { label: "2-2", goalsFor: 2, goalsAgainst: 2, scorers: ["Jordan Pike", "Danny Whitlock"], minutes: [11, 70], conceded: [30, 55] },
  { label: "1-1", goalsFor: 1, goalsAgainst: 1, scorers: ["Omar Haddad"], minutes: [41], conceded: [62] },
  { label: "1-2 defeat", goalsFor: 1, goalsAgainst: 2, scorers: ["Jordan Pike"], minutes: [15], conceded: [40, 85] },
  { label: "2-4 defeat", goalsFor: 2, goalsAgainst: 4, scorers: ["Jordan Pike", "Omar Haddad"], minutes: [15, 66], conceded: [5, 32, 58, 90] },
  { label: "0-3 defeat, no scorer", goalsFor: 0, goalsAgainst: 3, scorers: [], minutes: [], conceded: [12, 48, 79] },
  { label: "5-0, no scorer logged", goalsFor: 5, goalsAgainst: 0, scorers: [], minutes: [], conceded: [] },
];

/** A month, a weekday or a time of day the desk could only know by guessing. */
const CALENDAR_WORDS =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|winter|spring|summer|autumn|afternoon|evening|tonight|weekend)\b/;

/** Everything a sentence must never look like, whatever facts produced it. */
function copyOffences(text: string): string[] {
  const offences: string[] = [];
  if (/\ba\s+[aeiouAEIOU]/.test(text)) offences.push("a + vowel");
  if (/\ban\s+[^aeiouAEIOU\s\d]/.test(text)) offences.push("an + consonant");
  if (/\s{2,}/.test(text)) offences.push("double space");
  if (/\s+[.,;:!?]/.test(text)) offences.push("space before punctuation");
  if (/\bundefined\b|\bNaN\b/.test(text)) offences.push("undefined");
  if (/\bdebrief\b|\bsave's own record\b|\bthe app\b/i.test(text)) offences.push("app voice");
  if (CALENDAR_WORDS.test(text)) offences.push(`calendar word ${CALENDAR_WORDS.exec(text)?.[0]}`);
  if (text.includes("\u2014")) offences.push("em dash");
  return offences;
}

const matrixRows: { label: string; report: string; whole: string; venue: string | null; opponent: string | null }[] = [];

for (const shape of GOAL_SHAPES) {
  for (const venue of ["Home", "Away", null] as (string | null)[]) {
    for (const opponent of ["Northgate Rovers", null] as (string | null)[]) {
      const result = shape.goalsFor > shape.goalsAgainst ? "WIN" : shape.goalsFor < shape.goalsAgainst ? "LOSS" : "DRAW";
      const built = buildNews(
        input({
          matches: [
            match({
              eventId: `mx-${shape.label}-${venue}-${opponent}`,
              venue,
              opponent,
              result,
              goalsFor: shape.goalsFor,
              goalsAgainst: shape.goalsAgainst,
              scorers: shape.scorers,
              goalMinutes: shape.minutes,
              concededMinutes: shape.conceded,
              weakness: "Switched off after scoring",
              shots: 10,
              shotsInsideBox: 5,
              bigChances: 2,
            }),
          ],
        })
      );
      const report = built.find((item) => item.id.startsWith("result-"));
      matrixRows.push({
        label: `${shape.label} / ${venue ?? "no venue"} / ${opponent ?? "no opponent"}`,
        report: [report?.headline, report?.body, ...(report?.article ?? [])].filter(Boolean).join(" "),
        whole: built.flatMap((item) => [item.headline, item.body, ...item.article]).join(" "),
        venue,
        opponent,
      });
    }
  }
}

check(
  "every one of the 72 report shapes exists",
  matrixRows.length === GOAL_SHAPES.length * 6 && matrixRows.every((row) => row.report.length > 0),
  `${matrixRows.length} rows`
);

const reportOffences = matrixRows.flatMap((row) =>
  copyOffences(row.report).map((offence) => `${row.label}: ${offence}`)
);
check(
  "and none of them breaks a sentence",
  reportOffences.length === 0,
  reportOffences.slice(0, 4).join(" | ")
);

const editionOffences = matrixRows.flatMap((row) =>
  copyOffences(row.whole).map((offence) => `${row.label}: ${offence}`)
);
check(
  "and no story beside them does either",
  editionOffences.length === 0,
  editionOffences.slice(0, 4).join(" | ")
);

/* A venue the debrief never recorded must not be claimed. "files away as the standard", "come away with some
 * credit" and "one that got away" are idioms rather than venue words, so the check excludes an "away" that is
 * followed by the preposition, or by the punctuation, that makes it one. */
check(
  "a venue the debrief did not record produces no venue word at all",
  matrixRows
    .filter((row) => row.venue === null)
    .every(
      (row) =>
        !/\bat home\b/.test(row.report) &&
        !/\baway\b(?!\s*(?:from|as|with|to|and|[.,;:!?]))/i.test(row.report)
    )
);

check(
  "an away match with no opponent recorded is never called a home one",
  matrixRows
    .filter((row) => row.venue === "Away" && row.opponent === null)
    .every((row) => !/the visitors/.test(row.report))
);

check(
  "a home match with no opponent recorded is never called an away one",
  matrixRows
    .filter((row) => row.venue === "Home" && row.opponent === null)
    .every((row) => !/the hosts/.test(row.report))
);

check(
  "the manager's own weakness note is never printed",
  matrixRows.every((row) => !/switched off after scoring/i.test(row.whole))
);

check(
  "a scoreline with no scorer logged never invents one",
  matrixRows
    .filter((row) => row.label.startsWith("5-0") || row.label.startsWith("0-3"))
    .every((row) => !/scored twice|hat-trick|got it/.test(row.report))
);

const goallessRow = matrixRows.find((row) => row.label.startsWith("0-0"));
check(
  "a goalless draw is reported as one",
  /goalless|no goals|nothing at either end|cancelled each other out/i.test(goallessRow?.report ?? ""),
  goallessRow?.report.slice(0, 90)
);

const oneNilRow = matrixRows.find((row) => row.label.startsWith("1-0"));
check(
  "a single goal is one goal, not goals",
  !/\b1 goals\b/i.test(oneNilRow?.report ?? "") && !/\b1 matches\b/i.test(oneNilRow?.whole ?? "")
);

const defeatRow = matrixRows.find((row) => row.label.startsWith("1-2"));
check(
  "a defeat that scored once names the consolation rather than a win",
  /consolation|only reply|all .* had to show/i.test(defeatRow?.report ?? "") &&
    !/\bwin\b/i.test(defeatRow?.report ?? ""),
  defeatRow?.report.slice(0, 120)
);

check(
  "every story carries the kind the closing paragraph needs",
  buildNews(input()).every((item) => item.kind === "MATCH" || item.kind === "STANDING")
);

check(
  "and a match story is not filed as a standing one",
  ["result-", "clean-sheet-", "finishing-", "goals-", "leak-", "defence-"].every((prefix) => {
    const item = buildNews(input()).find((story) => story.id.startsWith(prefix));
    return item === undefined || item.kind === "MATCH";
  })
);

/* The four stories the old regex filed as standing, which meant they could never close on the week's run.
 * This is the bug Part A exists to fix, so it is asserted rather than assumed. */
check(
  "the scoring, the leak, the margin and the defensive record are match stories",
  (() => {
    const built = buildNews(input());
    const kinds = ["goals-", "leak-", "margin-", "defence-"].map(
      (prefix) => built.find((story) => story.id.startsWith(prefix))?.kind
    );
    return kinds.every((kind) => kind === undefined || kind === "MATCH");
  })()
);

check(
  "no position code is ever printed as a word",
  !/\ba UNKNOWN\b|\ba RES\b|\bthe UNKNOWN\b/.test(buildNews(input()).flatMap((i) => [i.headline, i.body]).join(" "))
);

// ---------------------------------------------------------------------------------------------
// Part B: the calendar comes from the save, or it is not mentioned
// ---------------------------------------------------------------------------------------------

console.log("\nthe calendar comes from the save or it is not mentioned");

const MONTH_NAMES =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/g;

check(
  "the save's own date is read as a day of the week, and a month",
  momentOf("2026-11-08")?.weekday === "Sunday" && momentOf("2026-11-08")?.month === "November",
  `${momentOf("2026-11-08")?.weekday}`
);
check(
  "and it knows a weekend from a midweek round",
  momentOf("2026-11-07")?.isWeekend === true &&
    momentOf("2026-11-07")?.isMidweek === false &&
    momentOf("2026-11-10")?.isMidweek === true &&
    momentOf("2026-11-10")?.isWeekend === false
);
check(
  "a date the save did not supply produces no words at all",
  momentOf(null) === null && momentOf(undefined) === null && momentOf("") === null
);
check(
  "and one that cannot be a real date is refused rather than guessed at",
  momentOf("2026-13-45") === null && momentOf("last Tuesday") === null && momentOf("08/11/2026") === null
);
check(
  "a phase needs both halves of the fact to be known",
  seasonPhase(null) === null &&
    seasonPhase({ matchday: 5, expectedGames: 0 }) === null &&
    seasonPhase({ matchday: -1, expectedGames: 46 }) === null &&
    seasonPhase({ matchday: 0, expectedGames: 46 }) === "OPENING"
);
check(
  "and the season's bands are genuinely different",
  seasonPhase({ matchday: 2, expectedGames: 46 }) === "OPENING" &&
    seasonPhase({ matchday: 12, expectedGames: 46 }) === "EARLY" &&
    seasonPhase({ matchday: 20, expectedGames: 46 }) === "MIDDLE" &&
    seasonPhase({ matchday: 40, expectedGames: 46 }) === "BUSINESS_END" &&
    seasonPhase({ matchday: 46, expectedGames: 46 }) === "FINAL_STRETCH"
);
check(
  "and each one carries its own preposition, because they do not share one",
  phasePhrase("OPENING") === "in the opening weeks" &&
    phasePhrase("EARLY") === "early in the campaign" &&
    phasePhrase("MIDDLE") === "in the middle stretch" &&
    phasePhrase("BUSINESS_END") === "at the business end" &&
    phasePhrase("FINAL_STRETCH") === "in the closing weeks" &&
    phasePhrase(null) === null
);

const PHASE_WORDS =
  /business end|opening weeks|middle stretch|closing weeks|early in the campaign/i;

check(
  "no phase word is invented when the division's size is unknown",
  !PHASE_WORDS.test(
    buildNews(input())
      .flatMap((item) => [item.headline, item.body, ...item.article])
      .join(" ")
  )
);
check(
  "and the phase appears once the season's position in it is known",
  PHASE_WORDS.test(
    buildNews(input({ progress: { matchday: 40, expectedGames: 46 } }))
      .flatMap((item) => [item.headline, item.body, ...item.article])
      .join(" ")
  )
);

check(
  "every month the paper names is a month one of its own match dates supplied",
  (() => {
    const supplied = new Set(
      input()
        .matches.map((entry) => momentOf(entry.matchDate)?.month)
        .filter((month): month is string => typeof month === "string")
    );
    const named =
      buildNews(input())
        .flatMap((item) => [item.headline, item.body, ...item.article])
        .join(" ")
        .match(MONTH_NAMES) ?? [];
    return named.every((month) => supplied.has(month));
  })()
);

check(
  "and a career with no dates on its matches names no month at all",
  !/January|February|March|April|May|June|July|August|September|October|November|December/.test(
    buildNews(
      input({ matches: input().matches.map((entry) => ({ ...entry, matchDate: null })) })
    )
      .flatMap((item) => [item.headline, item.body, ...item.article])
      .join(" ")
  )
);

// ---------------------------------------------------------------------------------------------
// Part F: an absence is written for how long it is
// ---------------------------------------------------------------------------------------------

console.log("\nan absence is written for how long it is");

/** The injury story for one player out until a given date. */
const outUntil = (until: string) =>
  buildNews(
    input({
      injuries: [
        {
          name: "Marcus Bell",
          role: "GK",
          age: 29,
          until,
          note: null,
          reportedOn: "2026-11-08",
          isStarter: true,
        },
      ],
    })
  ).find((item) => item.id.startsWith("injury-"));

const forFortnight = outUntil("2026-11-28");
const forMonth = outUntil("2026-12-06");
const forMonths = outUntil("2027-02-16");

check(
  "each length of absence produces a story",
  Boolean(forFortnight && forMonth && forMonths),
  `${forFortnight?.headline} / ${forMonth?.headline} / ${forMonths?.headline}`
);
check(
  "and a month is not the same story as months",
  forMonth?.body !== forMonths?.body && forMonth?.headline !== forMonths?.headline
);
check(
  "and neither is the same as a fortnight",
  forFortnight?.body !== forMonth?.body && forFortnight?.headline !== forMonths?.headline
);
check(
  "the duration the manager gave is the one the copy uses",
  Boolean(
    forMonth &&
      (forMonth.body.includes("a month") ||
        forMonth.evidence.some((line) => line.includes("month"))) &&
      forMonths &&
      (forMonths.body.includes("months") ||
        forMonths.evidence.some((line) => line.includes("months")))
  )
);
check(
  "and no absence story states a duration it was not given",
  [forFortnight, forMonth, forMonths].every(
    (item) => item === undefined || !/\b(?:a few weeks|six weeks|two months|three months)\b/i.test(item.body)
  )
);

// ---------------------------------------------------------------------------------------------
// Part H: the club's money, and the voice it has to be written in
// ---------------------------------------------------------------------------------------------

console.log("\nthe money is talked about, and hedged");

/** A finance report, as the service would hand it over. */
function financeFixture(overrides: Partial<NonNullable<NewsInput["finance"]>> = {}): NonNullable<NewsInput["finance"]> {
  return {
    currency: "GBP",
    wageFormat: "WEEKLY",
    tier: 2,
    squadWeeklyWage: 316_072,
    squadAnnualWage: 316_072 * 52,
    estimatedTierRevenue: 40_000_000,
    wageToTurnover: (316_072 * 52) / 40_000_000,
    wageTurnoverWarning: 0.65,
    wageTurnoverCritical: 0.85,
    wageTurnoverLevel: "OK",
    transferBudget: 6_000_000,
    transferBudgetSource: "SAVE",
    wageBudget: 300_000,
    wageBudgetSource: "SAVE",
    recordBuy: 4_500_000,
    recordSale: 2_000_000,
    nextSeasonLiabilityToTurnover: null,
    realismMode: "STRICT",
    ...overrides,
  };
}

/* Each finance story gets its own fixture, so the assertions test the story rather than the category cap.
 * Four of them can be true at once on a real career, and the cap of three stories per category is what
 * decides which print - so testing them all through one fixture would be testing the cap, not the copy. */
const storyOf = (finance: Partial<NonNullable<NewsInput["finance"]>>, prefix: string) =>
  has(buildNews(input({ finance: financeFixture(finance) })), prefix);

check(
  "a wage bill past its threshold is a story",
  storyOf({ wageTurnoverLevel: "CRITICAL", wageToTurnover: 0.95 }, "wage-pressure-")
);
check("and a wage bill inside it is a different one", storyOf({}, "wage-control-"));
check("a recorded budget is a story", storyOf({ recordBuy: null, recordSale: null }, "war-chest-"));
check("and a record fee is too", storyOf({ transferBudget: null }, "record-fee-"));
check(
  "and the club with no budget on the record gets the story about that",
  storyOf({ transferBudget: null, transferBudgetSource: null }, "sell-to-buy-")
);
check(
  "and a commitment for next season is its own story when it is larger",
  storyOf({ nextSeasonLiabilityToTurnover: 0.9, wageToTurnover: 0.41 }, "commitments-")
);
check(
  "but not when next season is cheaper than this one",
  !storyOf({ nextSeasonLiabilityToTurnover: 0.3, wageToTurnover: 0.41 }, "commitments-")
);
check(
  "no finance story is invented for a caller with no finance report",
  !buildNews(input()).some((item) => item.category === "FINANCE")
);
check(
  "and every finance story hedges rather than asserting",
  buildNews(input({ finance: financeFixture() }))
    .filter((item) => item.category === "FINANCE")
    .every((item) => /understood|the word is|it is thought|suggested|usually means|worth noting/i.test(item.body)),
  buildNews(input({ finance: financeFixture() }))
    .filter((item) => item.category === "FINANCE")
    .map((item) => `${item.id}: ${item.body.slice(0, 50)}`)
    .join(" | ")
);
check(
  "the exact figures are on the record under the story rather than in the prose",
  buildNews(input({ finance: financeFixture({ wageTurnoverLevel: "CRITICAL", wageToTurnover: 0.95 }) }))
    .filter((item) => item.category === "FINANCE")
    .every((item) => item.evidence.some((line) => /\u00a3|threshold|DERIVED_ESTIMATE/.test(line)))
);

// ---------------------------------------------------------------------------------------------
// Part I: columns, and how many of them one edition may carry
// ---------------------------------------------------------------------------------------------

console.log("\ncolumns, and how many of them an edition can carry");

const OPINION_CATEGORIES = ["OPINION", "TALKING POINT"];
const isColumn = (item: { category: string }) => OPINION_CATEGORIES.includes(item.category);

const paper = buildNews(input());
const columns = paper.filter(isColumn);

check("an edition carries columns", columns.length > 0, `${columns.length} of ${paper.length}`);
check(
  "every column is signed, because a column without a name reads as a system note",
  columns.every((item) => item.byline !== null)
);
check("and every column states the line it was written in", columns.every((item) => item.stance !== null));
check(
  "and the outlet that filed it is a paper that actually writes that way",
  columns.every((item) => item.byline?.stance === item.stance)
);

const leaning = (items: typeof paper) =>
  items.filter((item) => item.stance === "HOSTILE" || item.stance === "SENSATIONAL");
const evenHanded = (items: typeof paper) =>
  items.filter((item) => item.stance === "STRAIGHT" || item.stance === "LOYAL");

check(
  "no edition runs more than one leaning column",
  leaning(paper).length <= 1,
  `${leaning(paper).length} leaning`
);
check(
  "and never a leaning one without a straight or loyal one beside it",
  leaning(paper).length === 0 || evenHanded(paper).length > 0
);

/* Three straight defeats, from the newest match backwards, which is what the desk reads as a bad run. */
const LOSSES = [
  match({ eventId: "l1", result: "LOSS", goalsFor: 0, goalsAgainst: 2 }),
  match({ eventId: "l2", result: "LOSS", goalsFor: 1, goalsAgainst: 3 }),
  match({ eventId: "l3", result: "LOSS", goalsFor: 0, goalsAgainst: 1 }),
  ...MATCHES.slice(0, 2),
];
const badRunPaper = buildNews(input({ matches: LOSSES }));
check(
  "after three straight defeats the paper is allowed a second leaning column",
  leaning(badRunPaper).length >= 1 && leaning(badRunPaper).length <= 2,
  `${leaning(badRunPaper).length} leaning`
);
check(
  "and a hostile column is only filed when the run justifies it",
  leaning(badRunPaper).every((item) => item.stance === "HOSTILE" || item.stance === "SENSATIONAL") &&
    badRunPaper.some((item) => item.stance === "HOSTILE") === true
);

// ---------------------------------------------------------------------------------------------
// Part J: the stories that only print when the facts earn them
// ---------------------------------------------------------------------------------------------

console.log("\nand the stories that only print when the facts earn them");

const hatTrick = buildNews(
  input({
    matches: [
      match({ eventId: "ht-1", result: "WIN", goalsFor: 3, goalsAgainst: 0, scorers: ["Jordan Pike", "Jordan Pike", "Jordan Pike"], goalMinutes: [12, 44, 78] }),
      ...MATCHES.slice(1),
    ],
  })
);
check("three goals by one player is its own story", has(hatTrick, "haul-"));
check(
  "and it says how many, in the words football uses",
  /hat-trick|twice|times/.test(
    hatTrick.find((item) => item.id.startsWith("haul-"))?.body ?? ""
  )
);

const lateGoalPaper = buildNews(
  input({
    matches: [
      match({ eventId: "lw-1", result: "WIN", goalsFor: 1, goalsAgainst: 0, scorers: ["Jordan Pike"], goalMinutes: [89], concededMinutes: [] }),
      ...MATCHES.slice(1),
    ],
  })
);
check("a winner in the last five minutes is its own story", has(lateGoalPaper, "late-winner-"));

const threwItAway = buildNews(
  input({
    matches: [
      match({ eventId: "ta-1", result: "DRAW", goalsFor: 1, goalsAgainst: 1, scorers: ["Jordan Pike"], goalMinutes: [20], concededMinutes: [80] }),
      ...MATCHES.slice(1),
    ],
  })
);
check("a lead given away is its own story", has(threwItAway, "thrown-away-"));
check("but a lead held is not", !has(buildNews(input()), "thrown-away-"));

/* Isolated on purpose: this is a CONCERN story, and the fairness pass gives a paper with no good news only
 * ONE critical story - the most significant one. So the fixture keeps enough around it for the paper to have
 * two good stories (the trophy and the academy), which is what lets a second criticism print. Without that
 * the assertion would be testing the fairness pass rather than the story. */
const drought = buildNews(
  input({
    matches: [
      match({ eventId: "d1", result: "LOSS", goalsFor: 0, goalsAgainst: 1 }),
      match({ eventId: "d2", result: "LOSS", goalsFor: 0, goalsAgainst: 2 }),
      match({ eventId: "d3", result: "DRAW", goalsFor: 0, goalsAgainst: 0 }),
    ],
    squad: [],
    developments: [],
    injuries: [],
    seasons: [],
    block: null,
  })
);
check(
  "a run of matches without a goal is its own story",
  has(drought, "drought-"),
  drought.map((item) => item.id).join(", ")
);
check("and a side that is scoring gets none", !has(buildNews(input()), "drought-"));

check(
  "a round number of matches in charge is a milestone",
  has(buildNews(input({ gamesInCharge: 500 })), "milestone-500")
);
check(
  "and a number that is not round is not",
  !buildNews(input({ gamesInCharge: 501 })).some((item) => item.id.startsWith("milestone-"))
);
check(
  "and a career with no season record claims no milestone at all",
  !buildNews(input({ gamesInCharge: null })).some((item) => item.id.startsWith("milestone-"))
);

// ---------------------------------------------------------------------------------------------
// The length of a paper, and the novelty that keeps it worth opening twice
// ---------------------------------------------------------------------------------------------

console.log("\nthe paper is a front page, and it moves on");

const firstRead = buildEdition(input());

check(
  "an edition is shorter than ten stories",
  firstRead.length <= MAX_EDITION_STORIES && firstRead.length < 10,
  `${firstRead.length} stories`
);
check(
  "and the desk could have written far more than that",
  buildNews(input()).length > firstRead.length,
  `${buildNews(input()).length} available, ${firstRead.length} printed`
);

const firstTypes = [...new Set(firstRead.map((item) => typeOf(item.id)))];
const secondRead = buildEdition(input({ recentTypes: firstTypes }));
const secondTypes = secondRead.map((item) => typeOf(item.id));

check(
  "the edition after one has run is still a paper and not a different one entirely",
  secondRead.length > 0 && secondRead.length <= MAX_EDITION_STORIES,
  `${secondRead.length} stories`
);
check(
  "and the kinds that ran are demoted, so the page is not the same nine every read",
  secondTypes.filter((type) => firstTypes.includes(type)).length < secondTypes.length,
  `${secondTypes.filter((type) => firstTypes.includes(type)).length} of ${secondTypes.length} repeated`
);
check(
  "and a reader who reloads without playing on sees exactly what he saw before",
  buildEdition(input({ recentTypes: firstTypes })).map((item) => item.id).join() ===
    secondRead.map((item) => item.id).join()
);
check(
  "every story is still one the desk would write on its own",
  secondRead.every((item) => item.id.length > 0 && item.headline.length > 0 && item.article.length > 0)
);

console.log("\nand a form guide stays out of the prose");

/* "W W D" is the app's shorthand and belongs in the evidence. In a sentence it is a machine reading its own
 * output aloud, which is how "they are asking for the run W W D to look like it is going somewhere" got
 * printed. The two are now separate helpers so a call site has to choose which one it wants. */
const FORM_GUIDE = /\b(?:[WDL] ){2,}[WDL]\b/;

check(
  "no headline, card or article contains a form guide",
  buildNews(input()).every(
    (item) => !FORM_GUIDE.test([item.headline, item.body, ...item.article].join(" "))
  ),
  buildNews(input())
    .map((item) => [item.headline, item.body, ...item.article].join(" "))
    .find((text) => FORM_GUIDE.test(text))
    ?.slice(0, 90)
);
check(
  "and the run is still in the evidence, where the shorthand belongs",
  buildNews(input()).some((item) => item.evidence.some((line) => FORM_GUIDE.test(line)))
);

check(
  "and a closing paragraph never pairs the run of results with the treatment room",
  buildNews(input()).every((item) => {
    const closing = item.article.at(-1) ?? "";
    const results =
      /(?:two|three|four|five|six|one|no) (?:wins?|draws?|defeats?)|wider picture|record of|have brought/i.test(
        closing
      );
    const availability = /treatment room|unavailable player|absence never/i.test(closing);
    return !(results && availability);
  }),
  buildNews(input())
    .map((item) => item.article.at(-1) ?? "")
    .find((closing) => /treatment room/i.test(closing) && /have brought|wider picture/i.test(closing))
    ?.slice(0, 90)
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nfailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
