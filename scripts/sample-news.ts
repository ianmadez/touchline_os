/**
 * Prints the paper, in full, for a handful of made-up careers.
 *
 * The checks in `test-news.ts` count things; this is for READING. Copy is what the news desk ships, and the
 * only way to tell whether a paragraph reads like a newspaper or like a template is to read it next to the
 * others in its edition. Every story the desk can write for each career is printed (the edition cap is
 * lifted), with its byline, its whole article and its closing line marked.
 *
 *   npm run news:sample              every career
 *   npm run news:sample -- crisis    one of them by name
 */
import { buildNews, type NewsInput, type NewsMatch, type NewsPlayer } from "../src/lib/news/news-engine";

const SQUAD: NewsPlayer[] = (
  [
    ["Marcus Bell", "GK", 29, 68, 69, 2028, true],
    ["Theo Nkemdirim", "RB", 24, 66, 71, 2027],
    ["Callum Reid", "CB", 27, 67, 68, 2027],
    ["Ivan Petrov", "CB", 25, 65, 70, 2028],
    ["Luca Amato", "LB", 23, 64, 72, 2028],
    ["Sam Okafor", "CDM", 26, 66, 67, 2028],
    ["Rafael Sousa", "CM", 22, 65, 74, 2027],
    ["Jonas Berg", "CM", 28, 66, 66, 2028],
    ["Danny Whitlock", "RW", 21, 63, 76, 2029],
    ["Omar Haddad", "LW", 25, 66, 69, 2028],
    ["Jordan Pike", "ST", 27, 68, 68, 2028],
    ["Kofi Mensah", "ST", 19, 60, 78, 2029],
    ["Ben Hart", "GK", 33, 61, 61, 2027, true],
  ] as const
).map(([name, role, age, overall, potential, contractValidUntil, keeper]) => ({
  name,
  role,
  age,
  overall,
  potential,
  contractValidUntil,
  isKeeper: Boolean(keeper),
}));

let counter = 0;
function match(overrides: Partial<NewsMatch>): NewsMatch {
  counter += 1;
  return {
    eventId: `m${counter}`,
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
    expectedGoalsReported: null,
    comment: null,
    commentRefused: false,
    ...overrides,
  };
}

function career(overrides: Partial<NewsInput>): NewsInput {
  return {
    clubName: "Kingsbridge Athletic",
    managerName: "Alex Fenn",
    leagueName: "Championship",
    countryId: 14,
    seasonNumber: 3,
    inGameYear: 2026,
    inGameDate: "2026-11-08",
    matches: [],
    squad: SQUAD,
    developments: [],
    seasons: [
      { season: 3, tablePosition: 0, complete: false },
      { season: 2, tablePosition: 6, complete: true },
      { season: 1, tablePosition: 2, complete: true },
    ],
    position: null,
    trophies: [{ name: "League One", season: 2 }],
    academy: { name: "Nico Draper", age: 16, potential: 88, goals: 6, appearances: 9 },
    block: { gamesPlayed: 5, points: 10 },
    progress: { matchday: 15, expectedGames: 46 },
    gamesInCharge: 110,
    ...overrides,
  };
}

const CAREERS: Record<string, NewsInput> = {
  hotRun: career({
    matches: [
      match({ opponent: "Northgate Rovers", goalsFor: 4, scorers: ["Jordan Pike", "Jordan Pike", "Jordan Pike", "Danny Whitlock"], assisters: ["Danny Whitlock", "Rafael Sousa"], standouts: ["Jordan Pike", "Marcus Bell"], goalMinutes: [12, 20, 63, 71], shots: 8, shotsInsideBox: 5, expectedGoalsReported: 1.4, comment: "The lads were brilliant, Jordan was unplayable.", press: { question: "Whether Jordan Pike has become undroppable?", outlet: "The Touchline", writer: "Owen Fairhurst" } }),
      match({ matchDate: "2026-09-26", opponent: "Harborough United", venue: "Away", goalsFor: 2, goalsAgainst: 1, scorers: ["Jordan Pike", "Kofi Mensah"], assisters: ["Danny Whitlock"], goalMinutes: [78, 90], concededMinutes: [30], shots: 14, expectedGoalsReported: 2.1 }),
      match({ matchDate: "2026-09-19", opponent: "Claymoor City", goalsFor: 3, goalsAgainst: 1, scorers: ["Jordan Pike", "Omar Haddad", "Theo Nkemdirim"], goalMinutes: [5, 15, 80], concededMinutes: [88], commentRefused: true }),
      match({ matchDate: "2026-09-12", opponent: "Ashford Town", result: "DRAW", goalsFor: 1, goalsAgainst: 1, scorers: ["Omar Haddad"], goalMinutes: [41], concededMinutes: [62] }),
      match({ matchDate: "2026-09-05", opponent: "Westerly Athletic", goalsFor: 1, scorers: ["Jordan Pike"], goalMinutes: [90] }),
    ],
    position: { value: 4, basis: "save", disputed: false },
  }),
  crisis: career({
    block: { gamesPlayed: 5, points: 1 },
    matches: [
      match({ opponent: "Millbrook FC", result: "LOSS", goalsFor: 0, goalsAgainst: 4, concededMinutes: [3, 22, 58, 77], weakness: "Beaten in behind", shots: 5, expectedGoalsReported: 0.3, standouts: ["Ben Hart"], comment: "Unacceptable. I take responsibility.", press: { question: "Whether anyone in that dressing room can say they played well?", outlet: "The Hard Tackle", writer: "Rita Vance" } }),
      match({ matchDate: "2026-09-26", opponent: "Dunmore", venue: "Away", result: "LOSS", goalsFor: 2, goalsAgainst: 3, scorers: ["Kofi Mensah", "Jordan Pike"], goalMinutes: [10, 34], concededMinutes: [37, 81, 90], weakness: "Switched off after scoring" }),
      match({ matchDate: "2026-09-19", opponent: "Calder Vale", result: "DRAW", goalsFor: 1, goalsAgainst: 1, scorers: ["Omar Haddad"], goalMinutes: [40], concededMinutes: [42], shots: 18, expectedGoalsReported: 2.6 }),
      match({ matchDate: "2026-09-12", opponent: "Ashford Town", result: "LOSS", goalsFor: 1, goalsAgainst: 2, scorers: ["Omar Haddad"], goalMinutes: [41], concededMinutes: [62, 89] }),
      match({ matchDate: "2026-09-05", opponent: "Westerly Athletic", result: "LOSS", goalsFor: 0, goalsAgainst: 1, concededMinutes: [90] }),
    ],
    injuries: [
      { name: "Jordan Pike", role: "ST", age: 27, until: "2026-12-20", note: "hamstring", reportedOn: "2026-11-01", isStarter: true },
      { name: "Callum Reid", role: "CB", age: 27, until: "2026-11-20", note: null, reportedOn: "2026-11-02", isStarter: true },
    ],
    developments: [
      { id: "d1", name: "Kofi Mensah", position: "ST", oldOverall: 60, newOverall: 64, delta: 4, isProspect: true, isBreakthrough: true, on: null },
      { id: "d2", name: "Jonas Berg", position: "CM", oldOverall: 66, newOverall: 64, delta: -2, isProspect: false, isBreakthrough: false, on: null },
    ],
    finance: {
      currency: "GBP",
      wageFormat: "WEEKLY",
      tier: 2,
      squadWeeklyWage: 310000,
      squadAnnualWage: 16120000,
      estimatedTierRevenue: 20000000,
      wageToTurnover: 0.81,
      wageTurnoverWarning: 0.7,
      wageTurnoverCritical: 0.9,
      wageTurnoverLevel: "WARNING",
      transferBudget: 2000000,
      transferBudgetSource: "SAVE",
      wageBudget: null,
      wageBudgetSource: null,
      recordBuy: 5500000,
      recordSale: 13000000,
      nextSeasonLiabilityToTurnover: 0.6,
      realismMode: "STRICT",
    },
  }),
  cupNight: career({
    matches: [
      match({ opponent: "Arsenal", competition: "FA Cup", venue: "Away", goalsFor: 2, goalsAgainst: 1, scorers: ["Kofi Mensah", "Kofi Mensah"], goalMinutes: [55, 88], concededMinutes: [8], standouts: ["Ben Hart", "Sam Okafor"], shots: 4, expectedGoalsReported: 0.5, comment: "We'll enjoy this tonight." }),
      match({ matchDate: "2026-09-26", opponent: "Harborough United", result: "DRAW", goalsFor: 3, goalsAgainst: 3, scorers: ["Jordan Pike", "Jordan Pike", "Luca Amato"], goalMinutes: [5, 50, 90], concededMinutes: [20, 30, 70] }),
      match({ matchDate: "2026-09-19", opponent: "Claymoor City", result: "LOSS", goalsFor: 0, goalsAgainst: 1, concededMinutes: [66] }),
    ],
  }),
  january: career({
    inGameDate: "2027-01-08",
    inGameYear: 2026,
    matches: [
      match({ matchDate: "2027-01-02", opponent: "Northgate Rovers", goalsFor: 1, goalsAgainst: 0, scorers: ["Omar Haddad"], goalMinutes: [77], standouts: ["Callum Reid"] }),
      match({ matchDate: "2026-12-29", opponent: "Harborough United", venue: "Away", result: "DRAW", goalsFor: 1, goalsAgainst: 1, scorers: ["Jordan Pike"], goalMinutes: [12], concededMinutes: [70] }),
      match({ matchDate: "2026-12-26", opponent: "Claymoor City", goalsFor: 3, goalsAgainst: 0, scorers: ["Jordan Pike", "Danny Whitlock", "Kofi Mensah"], goalMinutes: [5, 44, 80] }),
      match({ matchDate: "2026-12-20", opponent: "Ashford Town", venue: "Away", result: "LOSS", goalsFor: 0, goalsAgainst: 2, concededMinutes: [12, 60] }),
    ],
    injuries: [{ name: "Ivan Petrov", role: "CB", age: 25, until: "2027-04-01", note: "knee ligaments", reportedOn: "2027-01-03", isStarter: false }],
  }),
  newCareer: career({
    seasonNumber: 1,
    seasons: [{ season: 1, tablePosition: 0, complete: false }],
    trophies: [],
    block: null,
    progress: null,
    gamesInCharge: null,
  }),
};

const only = process.argv[2];
for (const [name, input] of Object.entries(CAREERS)) {
  if (only && only !== name) continue;
  const edition = buildNews(input, { maxStories: 99 });
  console.log(`\n\n================ ${name} (${edition.length} stories) ================`);
  for (const item of edition) {
    const by = item.byline ? `${item.byline.outlet}, ${item.byline.writer}` : "desk";
    console.log(`\n--- ${item.category} | ${item.tone} | ${by}${item.stance ? ` | ${item.stance}` : ""}  [${item.id}]`);
    console.log(`# ${item.headline}`);
    item.article.forEach((paragraph, index) => {
      const marker = item.closing && index === item.article.length - 1 ? "  (closing) " : "  ";
      console.log(`${marker}${paragraph}`);
    });
    if (item.quote) console.log(`  QUOTE: "${item.quote}"`);
  }
}
