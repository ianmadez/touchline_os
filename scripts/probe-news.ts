/**
 * Prints the news desk's output for the career in the database.
 *
 * Copy is the product here, so it has to be read rather than asserted: this runs the real service over the
 * real evidence and prints the paper as it would print on screen, with the numbers each story was written
 * from underneath it.
 *
 *   npx tsx scripts/probe-news.ts [careerId]
 */
import { db } from "../src/lib/db/client";
import { careers } from "../src/lib/db/schema";
import { desc } from "drizzle-orm";
import { NewsArchiveService } from "../src/lib/services/news-archive";

async function main() {
  const wanted = process.argv[2];
  const rows = await db.select().from(careers).orderBy(desc(careers.updatedAt)).limit(10);
  if (rows.length === 0) {
    console.log("no careers in the database");
    return;
  }

  const career = wanted ? rows.find((row) => row.id === wanted) : rows[0];
  const target = career ?? rows[0];
  console.log(`career ${target.id}`);
  console.log(`club ${target.clubName}, manager ${target.managerName}, season year ${target.currentSeason}`);
  console.log(`last played ${target.inGameDate ?? "unknown"}`);

  // Reading is what publishes, so this is the same call the screen makes.
  const paper = await new NewsArchiveService().read(target.id);
  if (!paper) {
    console.log("no paper");
    return;
  }

  console.log(
    `\n${paper.items.length} stories in the paper from ${paper.matchesConsidered} logged matches, ` +
      `${paper.editions} editions, ${paper.unseen} unread, cap ${paper.limit}\n`
  );
  for (const item of paper.items) {
    console.log(
      `[${item.category}] (${item.tone}, weight ${item.weight}, edition ${item.edition}${item.saved ? ", SAVED" : ""}${item.read ? "" : ", unread"})`
    );
    console.log(`  ${item.headline}`);
    console.log(`  ${item.body}`);
    if (item.quote) console.log(`  quote: "${item.quote}"`);
    // The long-form piece, printed in full: copy is the product, and the article is only readable here.
    if (item.article.length > 1) {
      console.log("  ---");
      item.article.forEach((paragraph, index) => {
        console.log(`  ${index + 1}. ${paragraph}`);
      });
      console.log("  ---");
    }
    if (item.byline) {
      console.log(
        `  filed by ${item.byline.writer} (${item.byline.writerRole}) for ${item.byline.outlet}, ${item.byline.dateline}`
      );
    } else {
      console.log("  filed by the desk: no outlet attached");
    }
    console.log(`  why this ran: ${item.evidence.join(" | ")}`);
    console.log(`  faces: ${item.playerNames.join(", ") || "none"}${item.publishedOn ? `  dated ${item.publishedOn}` : ""}`);
    console.log("");
  }

  if (paper.matchesConsidered === 0) {
    console.log("No matches are logged for this career, so the paper is built from squad and season facts only.");
    console.log("Log a debrief in the app and re-run to see match reporting.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
