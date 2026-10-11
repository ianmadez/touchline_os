/**
 * Print the transfer ledger and the league-rules check for the live career.
 *
 * A read-only diagnostic, in the same spirit as `scripts/finance-report.ts`: it exists so the two new
 * money surfaces can be seen as data before they are seen as pixels, and so the honesty of each line can
 * be judged from the terminal rather than from a screenshot.
 */
import { TransferLedgerService } from "../src/lib/services/transfer-ledger-service";
import { FinanceRulesService } from "../src/lib/services/finance-rules-service";
import { db } from "../src/lib/db/client";
import { careers } from "../src/lib/db/schema";

async function main(): Promise<void> {
  const career = await db.select().from(careers).get();
  if (!career) {
    console.log("No career in the database.");
    return;
  }

  console.log(`Career: ${career.clubName} (${career.id}), season ${career.currentSeason}`);

  const ledger = await new TransferLedgerService().getLedger(career.id);
  if (!ledger) {
    console.log("Ledger unavailable.");
  } else {
    console.log(`\n=== TRANSFER LEDGER (${ledger.entries.length} lines) ===`);
    console.log(
      `spent ${ledger.totals.spent} | received ${ledger.totals.received} | net ${ledger.totals.net}`
    );
    for (const entry of ledger.entries) {
      console.log(
        `  ${entry.direction} ${entry.playerName} | ${
          entry.counterparty ?? (entry.counterpartyTeamId !== null ? `club ${entry.counterpartyTeamId} (unnamed)` : "unnamed")
        }${entry.counterpartyFromManager ? " (named by you)" : ""} | ${entry.fee} | agreed ${
          entry.agreedOn ?? "-"
        } | completed ${entry.completedOn ?? "-"}${entry.pending ? " (pending)" : ""} | ${entry.provenance}`
      );
    }
    console.log(`seasons: ${ledger.seasons.map((s) => `${s.season ?? "none"}:${s.net}`).join(", ") || "none"}`);
    console.log(
      `profit lines: ${
        ledger.profitLines
          .filter((line) => line.profit !== null)
          .map((line) => `${line.playerName} ${line.profit}`)
          .join(", ") || "none (needs both a purchase and a sale)"
      }`
    );
  }

  const rules = await new FinanceRulesService().getReport(career.id);
  if (!rules) {
    console.log("Rules unavailable.");
  } else {
    console.log(`\n=== LEAGUE RULES (${rules.divisionName ?? "division unknown"}) ===`);
    console.log(`coverage ${rules.coverage ?? "none"} | mode ${rules.realismMode} | enforced ${rules.enforced}`);
    console.log(
      `figures: squad ${rules.figures.squadSize} | weekly ${rules.figures.squadWeeklyWage} | annual ${rules.figures.squadAnnualWage} | netSpend ${rules.figures.netSpend ?? "n/a"}`
    );
    for (const verdict of rules.verdicts) {
      console.log(
        `  [${verdict.status}] ${verdict.label} (${verdict.basis}) limit ${verdict.limit ?? "none"} observed ${
          verdict.observed ?? "none"
        } source ${verdict.observedSource ?? "none"}`
      );
      console.log(`      ${verdict.detail}`);
    }
    console.log("notes:");
    for (const note of rules.notes) console.log(`  - ${note}`);
  }
}

void main();
