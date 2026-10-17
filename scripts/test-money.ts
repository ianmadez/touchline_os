/**
 * Checks for the transfer ledger and the league-rules check.
 *
 * These are the two money surfaces where a wrong answer would look like a fact: a ledger that quietly
 * averaged an entered fee with a saved one, a rules check that scored a rule it had no input for, or a
 * zero budget treated as a plan. So the checks below are mostly about DISCIPLINE rather than arithmetic:
 *
 *   - a deal the save carries and a deal the manager typed never merge into one provenance,
 *   - a deal between two other clubs never appears,
 *   - a profit is computed only where both a purchase and a sale are on file,
 *   - a rule with no input is listed, never scored,
 *   - a stored zero budget reads as not stated,
 *   - and a rule set for a tier does not leak a neighbouring tier's regulation.
 *
 * It runs against a THROWAWAY database in the OS temp folder, built from the real schema, so it cannot touch
 * a manager's career. `DATABASE_URL` has to be set before the database client is imported, which is why the
 * imports below are dynamic.
 *
 *   npm run money:test
 */
import fs from "fs";
import os from "os";
import path from "path";

const tempPath = path.join(os.tmpdir(), `touchline-money-${Date.now()}.db`);
process.env.DATABASE_URL = tempPath;

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

async function main() {
  const Database = (await import("better-sqlite3")).default;
  const { SCHEMA_DDL, SCHEMA_MIGRATIONS } = await import("../src/lib/db/schema-sql");

  const sqlite = new Database(tempPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(SCHEMA_DDL);
  for (const statement of SCHEMA_MIGRATIONS) {
    try {
      sqlite.exec(statement);
    } catch {
      /* column already exists */
    }
  }
  sqlite.close();

  const { db } = await import("../src/lib/db/client");
  const { appSettings, careers, careerFinanceInputs, leagueTeams, leagues, players, transferDeals, worldPlayers } =
    await import("../src/lib/db/schema");
  const { TransferLedgerService } = await import("../src/lib/services/transfer-ledger-service");
  const { FinanceRulesService } = await import("../src/lib/services/finance-rules-service");
  const { rulesForLeague } = await import("../src/lib/finance/league-rules");

  const careerId = "career_test_money";
  const clubId = 1917;

  await db.insert(careers).values({
    id: careerId,
    managerName: "Test Manager",
    clubName: "Test Athletic",
    clubId,
    leagueId: 14,
    currentSeason: 2026,
    inGameDate: "2026-11-08",
  });

  // The division, so one counterparty can be NAMED and one deliberately cannot.
  await db.insert(leagues).values({
    careerId,
    leagueId: 14,
    name: "England Championship (2)",
    level: 2,
    countryId: 14,
    countryName: "England",
  });
  await db.insert(leagueTeams).values([
    { id: `${careerId}_1801`, careerId, teamId: 1801, name: "Preston North End", leagueId: 14, isOwnClub: false },
    { id: `${careerId}_${clubId}`, careerId, teamId: clubId, name: "Test Athletic", leagueId: 14, isOwnClub: true },
  ]);

  // A squad of 24 with wages, which is what the percentage and squad-size rules measure.
  await db.insert(players).values(
    Array.from({ length: 24 }, (_, index) => ({
      id: `${careerId}_p${index}`,
      careerId,
      eaPlayerId: 700000 + index,
      name: `Squad Player ${index}`,
      primaryPosition: index === 0 ? "GK" : "CM",
      overallRating: 66,
      potentialRating: 68,
      age: 24,
      contractValidUntil: 2027,
      jersey: index + 1,
      wage: 1000,
    }))
  );

  // Two names in the world pool, so a saved deal resolves to a player rather than to an id.
  await db.insert(worldPlayers).values([
    {
      id: `${careerId}_9001`,
      careerId,
      eaPlayerId: 9001,
      name: "Arrived Player",
      attributesJson: "{}",
    },
    {
      id: `${careerId}_9002`,
      careerId,
      eaPlayerId: 9002,
      name: "Sold Player",
      attributesJson: "{}",
    },
  ]);

  await db.insert(transferDeals).values([
    {
      // The save's own half: we buy, and the seller is in our division so it can be NAMED. The two dates
      // differ, which is the normal shape of a real deal: agreed in November, completed in the next window.
      id: `${careerId}_9001_20261118`,
      careerId,
      playerId: 9001,
      offeredFee: 780_000,
      signedDate: 20261118,
      completeDate: 20270101,
      buyingTeamId: clubId,
      sellingTeamId: 1801,
      provenance: "SAVE",
    },
    {
      // We sell, and the buyer is NOT in our division, so only its id can be shown.
      id: `${careerId}_9002_20261105`,
      careerId,
      playerId: 9002,
      offeredFee: 2_050_000,
      signedDate: 20261105,
      buyingTeamId: 69,
      sellingTeamId: clubId,
      provenance: "SAVE",
    },
    {
      // Between two other clubs: must never appear in our ledger. Dated in January, which is also how the
      // previous-season grouping is exercised.
      id: `${careerId}_9003_20270114`,
      careerId,
      playerId: 9003,
      offeredFee: 5_000_000,
      signedDate: 20270114,
      buyingTeamId: 66,
      sellingTeamId: 217,
      provenance: "SAVE",
    },
    {
      // A loan made permanent: a real row, but the fee is not a clean price, so it says so.
      id: `${careerId}_9004_20260201`,
      careerId,
      playerId: 9004,
      offeredFee: 120_000,
      signedDate: 20260201,
      buyingTeamId: clubId,
      sellingTeamId: 1801,
      isLoanBuy: true,
      provenance: "SAVE",
    },
    {
      // A player the world pool does not name. The name must degrade to a labelled placeholder rather than
      // to a blank row in a money table.
      id: `${careerId}_424242_20260801`,
      careerId,
      playerId: 424242,
      offeredFee: 5_000,
      signedDate: 20260801,
      buyingTeamId: clubId,
      sellingTeamId: 1801,
      provenance: "SAVE",
    },
  ]);

  const ledgerService = new TransferLedgerService();

  console.log("\nthe ledger: what the save carries");
  let ledger = await ledgerService.getLedger(careerId);
  if (!ledger) throw new Error("ledger unavailable");

  check("a deal between two other clubs is excluded", ledger.entries.length === 4, `${ledger.entries.length} lines`);
  check(
    "our purchase is IN, and its seller is named from our division",
    ledger.entries.some(
      (entry) =>
        entry.playerName === "Arrived Player" &&
        entry.direction === "IN" &&
        entry.counterparty === "Preston North End" &&
        entry.provenance === "SAVE"
    )
  );
  const sale = ledger.entries.find((entry) => entry.direction === "OUT");
  check("our sale is OUT", sale !== undefined);
  check(
    "a club the save cannot name keeps its id instead of a guess",
    sale?.counterparty === null && sale?.counterpartyTeamId === 69,
    `${sale?.counterparty} / ${sale?.counterpartyTeamId}`
  );
  check("a saved deal is never deletable", ledger.entries.every((entry) => !entry.editable));
  check("a loan made permanent is flagged as not a clean price", Boolean(sale && ledger.entries.some((e) => e.note?.includes("loan"))));
  check(
    "the saved date is read as YYYYMMDD",
    ledger.entries.some((entry) => entry.agreedOn === "2026-11-18"),
    ledger.entries.map((e) => e.agreedOn).join(", ")
  );
  check(
    "a deal's completion date is kept apart from the date it was agreed",
    ledger.entries.some((entry) => entry.agreedOn === "2026-11-18" && entry.completedOn === "2027-01-01"),
    String(ledger.entries.find((entry) => entry.agreedOn === "2026-11-18")?.completedOn)
  );
  check(
    "a move that completes after the save's own date is marked as not yet completed",
    ledger.entries.find((entry) => entry.agreedOn === "2026-11-18")?.pending === true
  );
  check(
    "a November move groups under that year's season",
    ledger.entries.find((entry) => entry.agreedOn === "2026-11-18")?.season === 2026
  );
  check(
    "a January move groups under the PREVIOUS season year",
    ledger.entries.find((entry) => entry.agreedOn === "2026-02-01")?.season === 2025,
    String(ledger.entries.find((entry) => entry.agreedOn === "2026-02-01")?.season)
  );
  check(
    "an unknown player id falls back to a labelled placeholder rather than a blank",
    ledger.entries.some((entry) => entry.playerName === "Player 424242")
  );
  check(
    "a saved deal's counterparty is NOT flagged as the manager's own",
    ledger.entries.filter((entry) => entry.provenance === "SAVE").every((entry) => !entry.counterpartyFromManager)
  );

  console.log("\nthe ledger: the club the save cannot name");
  const unnamedDealId = sale?.id ?? "";
  ledger = await ledgerService.nameCounterparty(careerId, unnamedDealId, "Real Zaragoza");
  const named = ledger?.entries.find((entry) => entry.id === unnamedDealId);
  check("the manager can name a club the save cannot", named?.counterparty === "Real Zaragoza");
  check("and the row says the name came from him", named?.counterpartyFromManager === true);
  check("the save's own id is still carried, so nothing is lost", named?.counterpartyTeamId === 69);

  ledger = await ledgerService.nameCounterparty(careerId, unnamedDealId, "Something Else FC");
  check(
    "naming the same deal twice replaces the name rather than adding a row",
    ledger?.entries.find((entry) => entry.id === unnamedDealId)?.counterparty === "Something Else FC"
  );

  ledger = await ledgerService.nameCounterparty(careerId, unnamedDealId, "");
  check(
    "an empty name clears it, putting the row back to the save's own answer",
    ledger?.entries.find((entry) => entry.id === unnamedDealId)?.counterparty === null &&
      ledger?.entries.find((entry) => entry.id === unnamedDealId)?.counterpartyFromManager === false
  );

  console.log("\nthe ledger: what the manager adds");
  ledger = await ledgerService.addEntry({
    careerId,
    direction: "IN",
    playerName: "Typed Arrival",
    counterparty: "Somewhere FC",
    fee: 300_000,
    agreedOn: "2026-08-01",
    season: 2026,
    note: null,
  });
  if (!ledger) throw new Error("add returned nothing");

  const typed = ledger.entries.find((entry) => entry.playerName === "Typed Arrival");
  check("a typed deal is recorded", typed !== undefined);
  check("a typed deal carries USER provenance and is editable", typed?.provenance === "USER" && typed?.editable === true);
  check(
    "the typed deal is not merged with a saved deal of the same direction",
    ledger.entries.filter((entry) => entry.direction === "IN").length === 4
  );

  ledger = await ledgerService.addEntry({
    careerId,
    direction: "OUT",
    playerName: "Typed Arrival",
    counterparty: "Buyers FC",
    fee: 450_000,
    season: 2026,
    note: null,
  });
  if (!ledger) throw new Error("second add returned nothing");

  const profit = ledger.profitLines.find((line) => line.playerName === "Typed Arrival");
  check("a player with both sides on file gets a profit", profit?.profit === 150_000, String(profit?.profit));
  check(
    "a player with only a sale on file gets NO profit rather than a made-up one",
    ledger.profitLines.find((line) => line.playerName === "Sold Player")?.profit === null
  );
  check(
    "totals are spent, received and the difference",
    ledger.totals.spent === 780_000 + 120_000 + 5_000 + 300_000 &&
      ledger.totals.received === 2_050_000 + 450_000 &&
      ledger.totals.net === ledger.totals.spent - ledger.totals.received,
    `${ledger.totals.spent} / ${ledger.totals.received} / ${ledger.totals.net}`
  );
  check(
    "undated deals sort last rather than being dropped",
    ledger.entries[ledger.entries.length - 1].agreedOn === null
  );

  const typedId = typed?.id ?? "";
  ledger = await ledgerService.removeEntry(careerId, typedId);
  check("removing a typed deal removes it", !ledger?.entries.some((entry) => entry.id === typedId));
  check(
    "the ledger is rebuilt after a removal, not patched",
    ledger?.totals.spent === 120_000 + 780_000 + 5_000,
    `${ledger?.totals.spent}`
  );

  const before = ledger?.entries.length ?? 0;
  ledger = await ledgerService.removeEntry(careerId, `${careerId}_9001_20261118`);
  check(
    "a saved deal cannot be removed through the typed table",
    ledger?.entries.length === before && ledger.entries.some((entry) => entry.playerName === "Arrived Player")
  );

  console.log("\nthe ledger: a loan, which is money as a wage rather than as a fee");
  // The state every figure below is measured from, with no loan on the ledger yet.
  const feesOnlySpent = ledger?.totals.spent ?? 0;
  const feesOnlyReceived = ledger?.totals.received ?? 0;

  ledger = await ledgerService.addEntry({
    careerId,
    direction: "IN",
    playerName: "Loaned In",
    counterparty: "Parent Club FC",
    fee: 0,
    kind: "LOAN",
    salary: 20_000,
    wageSharePct: 60,
    agreedOn: "2026-08-20",
    season: 2026,
    note: null,
  });
  if (!ledger) throw new Error("loan add returned nothing");

  const loanIn = ledger.entries.find((entry) => entry.playerName === "Loaned In");
  check("a loan is recorded as a loan rather than as a transfer", loanIn?.kind === "LOAN");
  check(
    "and it carries his wage and the share of it this club pays",
    loanIn?.salary === 20_000 && loanIn?.wageSharePct === 60,
    `${loanIn?.salary} / ${loanIn?.wageSharePct}`
  );
  check("sixty percent of his wage is what leaves the club", loanIn?.wagesPaid === 12_000, String(loanIn?.wagesPaid));
  check(
    "the wage share lands inside the spend, beside the fees",
    ledger.totals.spent === feesOnlySpent + 12_000 && ledger.loanWages === 12_000,
    `${ledger.totals.spent} / ${ledger.loanWages}`
  );
  check(
    "the fee view is left alone, so a transfer budget is never measured against a wage",
    ledger.feeTotals.spent === feesOnlySpent && ledger.feeTotals.received === feesOnlyReceived
  );

  ledger = await ledgerService.addEntry({
    careerId,
    direction: "OUT",
    playerName: "Loaned Out",
    counterparty: "Borrowers FC",
    fee: 0,
    kind: "LOAN",
    salary: 15_000,
    wageSharePct: null,
    season: 2026,
    note: null,
  });
  const loanOut = ledger?.entries.find((entry) => entry.playerName === "Loaned Out");
  check(
    "a blank split stays blank rather than being read as all of it",
    loanOut?.wageSharePct === null && loanOut?.wagesPaid === null
  );
  check(
    "and that wage is reported as uncounted rather than counted as free",
    ledger?.loansWithoutSplit === 1 && ledger?.loanWages === 12_000,
    `${ledger?.loansWithoutSplit} / ${ledger?.loanWages}`
  );

  const loanSale = await ledgerService.addEntry({
    careerId,
    direction: "OUT",
    playerName: "Loaned In",
    counterparty: "Buyers FC",
    fee: 3_000_000,
    season: 2026,
    note: null,
  });
  check(
    "a player who arrived on loan and later left for a fee is given no profit",
    loanSale?.profitLines.find((line) => line.playerName === "Loaned In")?.profit === null,
    String(loanSale?.profitLines.find((line) => line.playerName === "Loaned In")?.profit)
  );

  console.log("\nthe ledger: what a loan has to be told, and who a deal is about");
  const { addTransferEntry, searchLedgerPlayers } = await import("../src/lib/operations/transfer-ledger");
  const loanBody = (extra: Record<string, unknown>): string =>
    JSON.stringify({ careerId, direction: "IN", playerName: "Checked Loan", fee: 0, kind: "LOAN", ...extra });

  let outcome = await addTransferEntry(loanBody({ wageSharePct: 50 }));
  check("a loan with no wage on it is refused", outcome.status === 400, JSON.stringify(outcome.body));
  outcome = await addTransferEntry(loanBody({ salary: 10_000, wageSharePct: 140 }));
  check("a split above 100 is refused", outcome.status === 400, JSON.stringify(outcome.body));
  outcome = await addTransferEntry(loanBody({ salary: 10_000, wageSharePct: "" }));
  check(
    "a blank split is accepted, because he may not have agreed one",
    outcome.status === 200,
    JSON.stringify(outcome.body)
  );
  const checkedLoanId = (
    (outcome.body as { ledger?: { entries: Array<{ id: string; playerName: string }> } }).ledger?.entries ?? []
  ).find((entry) => entry.playerName === "Checked Loan")?.id;

  const search = await searchLedgerPlayers(careerId, "Squad Player 1");
  const squadMatches = (search.body as { players?: Array<{ name: string; ours: boolean }> }).players ?? [];
  check(
    "the deal form searches the manager's own squad",
    squadMatches.some((player) => player.ours && player.name === "Squad Player 1"),
    JSON.stringify(squadMatches)
  );
  const poolSearch = await searchLedgerPlayers(careerId, "Arrived");
  const poolMatches = (poolSearch.body as { players?: Array<{ name: string; ours: boolean }> }).players ?? [];
  check(
    "and the rest of the save's players, flagged as not ours",
    poolMatches.some((player) => !player.ours && player.name === "Arrived Player"),
    JSON.stringify(poolMatches)
  );
  const emptySearch = await searchLedgerPlayers(careerId, "   ");
  check(
    "an empty search answers with nothing rather than with a suggestion",
    ((emptySearch.body as { players?: unknown[] }).players ?? []).length === 0
  );

  // Back to the state the rules checks below read their net spend from: a loan is on file in the tests above,
  // and the ledger's own figures return to what they were once it is removed.
  if (checkedLoanId) ledger = await ledgerService.removeEntry(careerId, checkedLoanId);
  const loanSaleId = loanSale?.entries.find((entry) => entry.playerName === "Loaned In" && entry.direction === "OUT")?.id;
  if (loanSaleId) ledger = await ledgerService.removeEntry(careerId, loanSaleId);
  for (const name of ["Loaned In", "Loaned Out"]) {
    const id = ledger?.entries.find((entry) => entry.playerName === name)?.id;
    if (id) ledger = await ledgerService.removeEntry(careerId, id);
  }
  check(
    "removing the loans puts the ledger back to its fees",
    ledger?.totals.spent === feesOnlySpent &&
      ledger?.totals.received === feesOnlyReceived &&
      ledger?.loanWages === 0 &&
      ledger?.loansWithoutSplit === 0,
    `${ledger?.totals.spent} / ${ledger?.totals.received}`
  );

  console.log("\nthe rules: which ones apply to a tier");
  const championship = rulesForLeague(14, 2);
  check("England tier 2 resolves to the England set", championship?.league === "England");
  check("England tier 2 is covered by the reference data", championship?.tierCovered === true);
  const championshipIds = championship?.rules.map((rule) => rule.id) ?? [];
  check(
    "the Championship price rule applies",
    championshipIds.includes("eng-championship-psr"),
    championshipIds.join(", ")
  );
  check(
    "the Premier League rule does NOT leak into tier 2",
    !championshipIds.includes("eng-psr"),
    championshipIds.join(", ")
  );
  check(
    "the lower-division salary protocol does NOT leak into tier 2",
    !championshipIds.includes("eng-efl-scmp")
  );
  check(
    "the UEFA rules do NOT leak into tier 2",
    !championshipIds.includes("uefa-squad-cost") && !championshipIds.includes("uefa-squad-size")
  );
  const premierLeague = rulesForLeague(14, 1);
  check(
    "England tier 1 gets the top-flight and European rules",
    ["eng-psr", "uefa-squad-cost", "uefa-squad-size"].every((id) =>
      (premierLeague?.rules.map((rule) => rule.id) ?? []).includes(id)
    )
  );
  check("an unlisted country has no rule set", rulesForLeague(999, 1) === null);
  check("an unknown country id has no rule set", rulesForLeague(null, 1) === null);

  console.log("\nthe rules: what is checked and what is only listed");
  const rulesService = new FinanceRulesService();
  let rules = await rulesService.getReport(careerId);
  if (!rules) throw new Error("rules unavailable");

  check("the division is read from the save", rules.divisionName === "England Championship (2)");
  check("the reference coverage is named", rules.coverage === "England");
  check("strict realism is read from settings (absent settings relax, never tighten)", rules.enforced === false);
  check("squad size and wage bill are the save's own", rules.figures.squadSize === 24 && rules.figures.squadWeeklyWage === 24_000);
  check(
    "the ledger's net spend feeds the rules check",
    rules.figures.netSpend === 780_000 + 120_000 + 5_000 - (2_050_000 + 450_000),
    String(rules.figures.netSpend)
  );  const psr = rules.verdicts.find((verdict) => verdict.ruleId === "eng-championship-psr");
  check("a rule whose input is absent is listed, never scored", psr?.status === "REFERENCE_ONLY");
  check("the reference row carries no observed figure", psr?.observed === null);
  check(
    "a zero budget reads as NOT STATED rather than as a plan",
    rules.verdicts.find((verdict) => verdict.ruleId === "app-transfer-budget")?.limit === null
  );
  check(
    "the two app-owned checks are always present",
    rules.verdicts.some((verdict) => verdict.ruleId === "app-transfer-budget") &&
      rules.verdicts.some((verdict) => verdict.ruleId === "app-wage-budget")
  );
  check(
    "an unset budget reports no data rather than a verdict",
    rules.verdicts
      .filter((verdict) => verdict.ruleId.startsWith("app-"))
      .every((verdict) => verdict.status === "NO_DATA")
  );
  check(
    "the notes say the rules are authored and that homegrown quotas are left out",
    rules.notes.some((note) => note.includes("authored reference data")) &&
      rules.notes.some((note) => note.includes("Homegrown"))
  );

  // Strict realism, and the two budgets, which is what turns the panel from context into checks.
  await db.insert(appSettings).values({ id: "default", realismLevel: "STRICT_REALISM" });
  await db.insert(careerFinanceInputs).values({
    id: "inputs-1",
    careerId,
    transferBudget: 500_000,
    wageBudget: 20_000,
    provenance: "USER",
  });

  rules = await rulesService.getReport(careerId);
  if (!rules) throw new Error("rules unavailable after settings");

  check("strict realism turns the checks on", rules.enforced === true && rules.realismMode === "STRICT");
  const transferCheck = rules.verdicts.find((verdict) => verdict.ruleId === "app-transfer-budget");
  check(
    "a stated transfer budget is measured against the ledger",
    transferCheck?.limit === 500_000 && transferCheck?.observed === -1_595_000,
    `${transferCheck?.limit} / ${transferCheck?.observed}`
  );
  check("net money in is inside a positive budget", transferCheck?.status === "OK");
  check("the observed figure says whose it is", transferCheck?.observedSource === "USER");

  const wageCheck = rules.verdicts.find((verdict) => verdict.ruleId === "app-wage-budget");
  const wageBudgetAnnual = 20_000 * 52;
  check(
    "a wage bill past the stated budget is OVER, measured in annual terms",
    wageCheck?.status === "OVER",
    JSON.stringify(wageCheck)
  );
  check("the bill is the save's, and the budget is the manager's", wageCheck?.observedSource === "SAVE");
  check(
    "the annual wage bill is the weekly one times 52",
    rules.figures.squadAnnualWage === rules.figures.squadWeeklyWage * 52 && wageBudgetAnnual > 0
  );

  console.log("\nthe rules: a percentage rule against the tier estimate");
  // Italy tier 1 has the UEFA squad cost ratio, which is a percentage against a DERIVED denominator. It is
  // the one shape where the observed figure is the app's own arithmetic, so it is checked explicitly.
  await db
    .update(careers)
    .set({ leagueId: 99 })
    .where((await import("drizzle-orm")).eq(careers.id, careerId));
  await db.insert(leagues).values({
    careerId,
    leagueId: 99,
    name: "Italy Serie A (1)",
    level: 1,
    countryId: 27,
    countryName: "Italy",
  });

  rules = await rulesService.getReport(careerId);
  const squadCost = rules?.verdicts.find((verdict) => verdict.ruleId === "uefa-squad-cost");
  check("a percentage rule reports a percentage", typeof squadCost?.observed === "number", String(squadCost?.observed));
  check(
    "a percentage over an ESTIMATED denominator says so on the row",
    squadCost?.observedSource === "DERIVED_ESTIMATE"
  );
  check(
    "the estimate is named in the same sentence as the verdict",
    Boolean(squadCost?.detail.includes("estimate")),
    squadCost?.detail
  );
  const squadSize = rules?.verdicts.find((verdict) => verdict.ruleId === "uefa-squad-size");
  check("a squad inside the limit reads as inside", squadSize?.status === "OK");
  check("the observed count is the save's own squad size", squadSize?.observedSource === "SAVE");

  await db.insert(players).values([
    {
      id: `${careerId}_p24`,
      careerId,
      eaPlayerId: 700024,
      name: "One Too Many",
      primaryPosition: "ST",
      overallRating: 64,
      potentialRating: 68,
      age: 22,
      wage: 1000,
      jersey: 25,
    },
    {
      id: `${careerId}_p25`,
      careerId,
      eaPlayerId: 700025,
      name: "Two Too Many",
      primaryPosition: "ST",
      overallRating: 64,
      potentialRating: 68,
      age: 22,
      wage: 1000,
      jersey: 26,
    },
  ]);

  rules = await rulesService.getReport(careerId);
  check(
    "a squad past the limit reads as OVER",
    rules?.verdicts.find((verdict) => verdict.ruleId === "uefa-squad-size")?.status === "OVER"
  );

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("failures:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  // A throwaway database, so there is nothing to restore - but the file still has to go. The handle is closed
  // first, because a live connection keeps the file on Windows.
  try {
    const client = (db as unknown as { $client?: { close?: () => void } }).$client;
    client?.close?.();
  } catch {
    /* nothing to close */
  }
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(tempPath + suffix)) fs.unlinkSync(tempPath + suffix);
    }
  } catch {
    console.log(`could not remove ${tempPath}`);
  }

  if (failures.length > 0) process.exitCode = 1;
}

void main();
