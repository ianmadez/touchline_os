import { NextResponse } from "next/server";
import { ScoutingSearchService, type ScoutStrategy } from "@/lib/services/scouting-search-service";
import { FinanceService } from "@/lib/services/finance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRATEGIES: readonly ScoutStrategy[] = [
  "SUGGESTED",
  "BALANCED",
  "IMMEDIATE",
  "PROSPECT",
  "VALUE",
];

/**
 * The manager's transfer budget PLUS his wage budget, combined per target: a signing costs both.
 *
 * Read from the same finance report the Finances screen shows, so the two cannot disagree about how
 * much money there is. Returns null when neither is set, which leaves the Financial Fit dimension
 * unscored rather than silently treating everything as affordable.
 */
async function resolveBudget(careerId: string): Promise<number | null> {
  const report = await new FinanceService().getReport(careerId);
  if (report === null) return null;
  // NOT SET and SET TO ZERO are different answers and must never collapse into one. A manager who
  // deliberately recorded GBP 0 has told us something - he is planning, not shopping - and telling
  // him he "has not set a budget" throws his own input back at him.
  const configured = report.transferBudget !== null || report.wageBudget !== null;
  if (!configured) return null;
  return (report.transferBudget ?? 0) + (report.wageBudget ?? 0);
}

/**
 * Records the manager's own foot for a world player, then returns the refreshed dossier.
 *
 * A separate table from `world_players` on purpose: the pool is a SAVE fact rewritten on every sync,
 * so a USER value living on it would be lost or would stop tracking the save.
 */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      careerId?: string;
      eaPlayerId?: number;
      preferredFoot?: number | null;
    };
    if (!body.careerId || typeof body.eaPlayerId !== "number") {
      return NextResponse.json(
        { success: false, error: "careerId and eaPlayerId are required." },
        { status: 400 }
      );
    }

    const service = new ScoutingSearchService();
    const foot =
      body.preferredFoot === null || body.preferredFoot === undefined
        ? null
        : [1, 2].includes(body.preferredFoot)
          ? body.preferredFoot
          : null;
    await service.setFootOverride(body.careerId, body.eaPlayerId, foot);

    return NextResponse.json({
      success: true,
      dossier: await service.dossier(
        body.careerId,
        body.eaPlayerId,
        await resolveBudget(body.careerId)
      ),
    });
  } catch (error) {
    console.error("[api/scouting/search] foot override failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not save that foot." },
      { status: 500 }
    );
  }
}

/**
 * Scouting search over the world pool.
 *
 * `?playerId=` returns one player's dossier instead of a search page, because the dossier is read one
 * player at a time and shipping 34 face stats with every result row would be wasted payload.
 *
 * The budget defaults to the manager's transfer budget PLUS his wage budget, combined per target,
 * because a signing costs both. It is read from the same finance report the Finances screen shows, so
 * the two can never disagree about how much money there is.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const careerId = params.get("careerId");
    if (!careerId) {
      return NextResponse.json({ success: false, error: "careerId is required." }, { status: 400 });
    }

    const service = new ScoutingSearchService();

    const playerId = params.get("playerId");
    if (playerId !== null) {
      const dossier = await service.dossier(
        careerId,
        Number(playerId),
        await resolveBudget(careerId)
      );
      if (!dossier) {
        return NextResponse.json({ success: false, error: "No such player in this save." }, { status: 404 });
      }
      return NextResponse.json({ success: true, dossier });
    }

    const report = await new FinanceService().getReport(careerId);
    const derivedBudget =
      report === null
        ? null
        : (report.transferBudget ?? 0) + (report.wageBudget ?? 0) > 0
          ? (report.transferBudget ?? 0) + (report.wageBudget ?? 0)
          : null;

    const requestedBudget = params.get("budget");
    const budget =
      requestedBudget === null
        ? derivedBudget
        : requestedBudget.trim() === ""
          ? null
          : Math.max(0, Math.round(Number(requestedBudget))) || null;

    const strategyParam = params.get("strategy");
    const strategy = STRATEGIES.includes(strategyParam as ScoutStrategy)
      ? (strategyParam as ScoutStrategy)
      : "BALANCED";

    const number = (key: string): number | null => {
      const raw = params.get(key);
      if (raw === null || raw.trim() === "") return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    };

    const result = await service.search({
      careerId,
      budget,
      position: params.get("position") || null,
      strategy,
      query: params.get("query") ?? "",
      includeUnnamed: params.get("includeUnnamed") === "true",
      minRating: number("minRating"),
      maxAge: number("maxAge"),
      page: number("page") ?? 0,
      pageSize: number("pageSize") ?? 20,
    });

    return NextResponse.json({
      success: true,
      result,
      /** So the UI can say where the budget came from rather than presenting it as a bare figure. */
      budgetSource: {
        transferBudget: report?.transferBudget ?? null,
        wageBudget: report?.wageBudget ?? null,
        combined: derivedBudget,
        overridden: requestedBudget !== null,
      },
    });
  } catch (error) {
    console.error("[api/scouting/search] failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not run that search." },
      { status: 500 }
    );
  }
}
