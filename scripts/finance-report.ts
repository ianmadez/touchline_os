/**
 * Prints the finance model for a career. READ-ONLY - it writes nothing.
 *
 *   npx tsx scripts/finance-report.ts            # latest career
 *   npx tsx scripts/finance-report.ts <careerId>
 *
 * Exists so the model can be eyeballed against the save without a Finance screen: the point of the
 * first pass is that a ZERO budget reads as UNKNOWN, not as "nothing left", and that every derived
 * figure says so.
 */
import { FinanceService } from "../src/lib/services/finance-service";

const CAREER = process.argv[2] ?? "career_club_1917";

async function main(): Promise<void> {
  const report = await new FinanceService().getReport(CAREER);
  if (!report) {
    console.error(`career ${CAREER} not found`);
    process.exit(1);
  }

  const money = (value: number | null | undefined): string =>
    value === null || value === undefined ? "UNKNOWN" : value.toLocaleString("en-GB");
  const pct = (value: number | null): string =>
    value === null ? "UNKNOWN" : `${Math.round(value * 100)}%`;

  console.log(`Finance report - ${CAREER}`);
  console.log(`  currency / wage format : ${report.currency} / ${report.wageFormat}`);
  console.log(`  currency               : ${report.currency}`);
  console.log(`  tier                   : ${report.tier ?? "unknown"} (${report.tierLabel ?? "-"})`);
  console.log("");
  console.log("  SAVE facts (0 means the save wrote nothing - shown as UNKNOWN)");
  console.log(`    transfer budget      : ${money(report.transferBudget)}`);
  console.log(`    wage budget          : ${money(report.wageBudget)}`);
  console.log(`    total earnings       : ${money(report.totalEarnings)}`);
  console.log(`    record buy / sale    : ${money(report.recordBuy)} / ${money(report.recordSale)}`);
  console.log("");
  console.log("  DERIVED_ESTIMATE");
  console.log(`    squad weekly wage    : ${money(report.squadWeeklyWage)}`);
  console.log(`    squad annual wage    : ${money(report.squadAnnualWage)}`);
  console.log(`    tier revenue estimate: ${money(report.estimatedTierRevenue)}`);
  console.log(`    wage-to-turnover     : ${pct(report.wageToTurnover)}`);
  if (report.wageTurnoverAdvisory) {
    console.log(`    verdict [${report.wageTurnoverAdvisory.level}] ${report.wageTurnoverAdvisory.headline}`);
    console.log(`      ${report.wageTurnoverAdvisory.detail}`);
  }
  console.log("");
  console.log("  Contract liability (annual wage still committed)");
  for (const row of report.contractLiability) {
    console.log(
      `    ${row.seasonLabel}: ${money(row.committedAnnualWage)} across ${row.playersUnderContract} player(s)`
    );
  }
  console.log(`    next-season liability to turnover: ${pct(report.nextSeasonLiabilityToTurnover)}`);
  console.log("");
  console.log(`  net spend: ${report.netSpend.available ? money(report.netSpend.net) : `UNAVAILABLE - ${report.netSpend.reason}`}`);
  console.log("");
  console.log("  Not supported by the save:");
  for (const line of report.unavailable) console.log(`    - ${line}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
