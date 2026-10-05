/**
 * Scouting search over the world pool.
 *
 * ## One ranking function, four presets
 *
 * The four strategies are NOT four ranking implementations. They are one weighted sum over four
 * normalised components, evaluated with different weights. That matters because four separate
 * ranking paths would drift: a fix to "best pick" ordering would land in one and not the others, and
 * nobody would notice until the tabs disagreed about the same player.
 *
 *   score = w_rating · rating + w_growth · growth + w_youth · youth + w_cost · cost
 *
 * The cost term is defined WITH or WITHOUT a budget, which matters more than it looks. It used to be
 * skipped entirely when no budget was set - and because a preset like VALUE rests half its identity on
 * cost, dropping that term left it ranking on ability alone and returning the exact same list as
 * BALANCED. A component that can silently disappear takes the preset's meaning with it, so cost is
 * always computed: headroom inside the budget when there is one, and cheapness against the pool's own
 * estimates when there is not.
 *
 * Every component is min/max normalised across the candidate set being ranked, so the weights are
 * comparable to each other and a change to one preset cannot silently rescale another.
 *
 * ## Budget
 *
 * The budget is the manager's stated transfer budget PLUS his stated wage budget, combined per
 * target, because a signing costs both. When a budget is set, candidates are filtered to those whose
 * band TOP fits inside it - deliberately the conservative end of the band, so a result is affordable
 * even on the pessimistic reading rather than only on the optimistic one.
 *
 * ## Names
 *
 * A text query EXCLUDES players whose name is not in the save. 7,058 of 21,166 rows have no name, and
 * returning them for a name search would present a nameless row as a match. They remain fully
 * searchable by every other filter and are labelled "name not in this save" wherever shown.
 */
import { and, asc, eq, like, lte, gte, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { worldPlayerOverrides, worldPlayers } from "../db/schema";
import { describeValueBand, type ValueBandView, type ValueConfidence } from "./world-value-model";
import { WorldValueModelService } from "./world-value-model";
import {
  buildSquadContext,
  evaluateFit,
  type FitCandidate,
  type FitKey,
  type PlayerFit,
  type SquadContext,
} from "./fit-service";
import { realismModeOf } from "../realism";
import {
  normalisePlaystyle,
  PLAYSTYLE_DEFINITIONS,
  playstyleScoutingNote,
} from "../playstyles";
import { SettingsService } from "./settings-service";
import { SquadService } from "./squad-service";
import { TacticsService } from "./tactics-service";

export type ScoutStrategy = "SUGGESTED" | "BALANCED" | "IMMEDIATE" | "PROSPECT" | "VALUE";

export interface StrategyWeights {
  label: string;
  summary: string;
  /** What the preset actually optimises for, stated so the UI never has to paraphrase it. */
  optimisesFor: string;
  rating: number;
  potential: number;
  youth: number;
  affordability: number;
}

/**
 * The four presets.
 *
 * `IMMEDIATE` deliberately uses a MILD youth weight rather than a hard age filter. A hard "prime
 * years only" cut would exclude a 33-year-old who is still the best player available inside the
 * budget - which is exactly what happened in the reference implementation this is modelled on, whose
 * own top Immediate result was 33. A weight lets youth pull ties without deciding the answer.
 */
export const STRATEGY_WEIGHTS: Record<ScoutStrategy, StrategyWeights> = {
  BALANCED: {
    label: "Balanced",
    summary: "Best all-round pick",
    optimisesFor: "Current ability first, with a look at what he could become.",
    rating: 0.45,
    potential: 0.2,
    youth: 0.15,
    affordability: 0.2,
  },
  IMMEDIATE: {
    label: "Immediate",
    summary: "Ready to play now",
    optimisesFor: "Current ability above all, with a light pull toward younger players.",
    rating: 0.65,
    potential: 0.05,
    youth: 0.1,
    affordability: 0.2,
  },
  PROSPECT: {
    label: "Prospect",
    summary: "Future growth",
    optimisesFor: "The best a player could become, and how long he has to get there.",
    rating: 0.1,
    potential: 0.45,
    youth: 0.35,
    affordability: 0.1,
  },
  VALUE: {
    label: "Value",
    summary: "Most ability per pound",
    optimisesFor:
      "What he does right now against what he costs. Potential and age are deliberately near-ignored, because ability per pound is a question about the present - PROSPECT is where a teenager wins.",
    rating: 0.5,
    potential: 0.05,
    youth: 0,
    affordability: 0.45,
  },
  SUGGESTED: {
    label: "Suggested",
    summary: "Fills your real gaps",
    optimisesFor:
      "Ordered by FIT rather than by this score: it targets the positions your formation is short in, from players who would plausibly join a club at your level. Implausible targets are removed rather than ranked low, so the weights below are all zero - this preset does not use them.",
    rating: 0,
    potential: 0,
    youth: 0,
    affordability: 0,
  },
};

/**
 * Grouped so a manager can ask for "a defender" without picking a side.
 *
 * Kept complete, including roles no save in front of us currently uses (RWB, LWB, SW, CF). This is a
 * matching rule rather than a menu: if a save ever does assign one of them, "All defenders" must find
 * him. The filter menu that offers these groups is deliberately narrower - see `scout-search.tsx`.
 */
const POSITION_GROUPS: Record<string, readonly string[]> = {
  GK: ["GK"],
  DEF: ["LB", "CB", "RB", "LWB", "RWB", "SW"],
  MID: ["CDM", "CM", "LM", "RM", "CAM"],
  ATT: ["LW", "RW", "CF", "ST"],
};

/** Ranking is cheap but not free; this bounds the work a single request can ask for. */
/**
 * A safety valve against a pathological pool, NOT a page size.
 *
 * This used to be 4,000 and the query had no ORDER BY beside it. `LIMIT` without `ORDER BY` asks SQL for
 * an arbitrary subset, so every ranking was computed inside an arbitrary fifth of the pool: VALUE could
 * not see the bargains it exists to find, and the same search was not guaranteed to return the same
 * answer twice. Ranking is pure arithmetic over rows already fetched, so the honest fix is to rank the
 * whole pool - 18,926 players on the reference save - and keep the cap only to stop a pool far larger
 * than any real save.
 */
const MAX_CANDIDATES = 25_000;

/**
 * The Realism score below which a target is dropped from the Suggested list entirely.
 *
 * Dropped, not ranked low: the value of a suggestion is that you can act on it, and a list whose best
 * entry is a player who would never join is worse than a shorter list.
 */
const SUGGESTED_MIN_REALISM = 30;

export type Affordability = "WITHIN" | "STRETCH" | "OVER" | "UNKNOWN";

export interface ScoutSearchQuery {
  careerId: string;
  /** Transfer budget + wage budget combined per target. Null means no budget filter at all. */
  budget: number | null;
  /** An exact role ("CM") or a group ("MID"). Null for every position. */
  position: string | null;
  strategy: ScoutStrategy;
  query: string;
  /**
   * Include players whose name is not stored in the save.
   *
   * OFF by default, and that default is the product decision: a name search cannot find them at all,
   * and a results table where rows read "name not in this save" looks broken rather than useful. They
   * remain a legitimate thing to want - a 93-rated 20-year-old with no name is still a real player -
   * so they are one explicit toggle away rather than gone.
   */
  includeUnnamed: boolean;
  minRating: number | null;
  maxAge: number | null;
  page: number;
  pageSize: number;
}

export interface ScoutSearchRow {
  eaPlayerId: number;
  name: string;
  nameResolved: boolean;
  clubName: string | null;
  primaryPosition: string;
  overallRating: number | null;
  potentialRating: number | null;
  age: number | null;
  weakFoot: number | null;
  skillMoves: number | null;
  preferredFoot: number | null;
  value: ValueBandView;
  affordability: Affordability;
  /**
   * The four fit dimensions for THIS squad and THIS system.
   *
   * Deliberately separate from `score`: ranking answers "who is best", fit answers "why him". The
   * two disagree often enough that folding them together would hide the more useful answer.
   */
  fits: PlayerFit;
  score: number;
  rank: number;
}

export interface ScoutDossier {
  eaPlayerId: number;
  name: string;
  /** False means only the NAME is missing in the save; every other field below is intact. */
  nameResolved: boolean;
  clubName: string | null;
  primaryPosition: string;
  overallRating: number | null;
  potentialRating: number | null;
  age: number | null;
  heightCm: number | null;
  weakFoot: number | null;
  skillMoves: number | null;
  preferredFoot: number | null;
  /** The manager's own answer, when he has given one. Null means he has not overridden it. */
  preferredFootOverride: number | null;
  internationalRep: number | null;
  value: ValueBandView | null;
  /**
   * The four fit dimensions, so the panel explains WHY him rather than only listing him.
   *
   * Ranking and fit are separate answers on purpose: the top-ranked player in the pool is rarely the
   * right signing for a squad with one centre-mid and no money.
   */
  fits: PlayerFit;
  /** The six face-stat groups, exactly as the game groups them. */
  attributes: Record<string, unknown>;
}

export interface ScoutSearchResult {
  rows: ScoutSearchRow[];
  total: number;
  /** True when `total` is the ranking cap rather than the real number of matches. */
  capped: boolean;
  page: number;
  pageSize: number;
  strategy: ScoutStrategy;
  weights: StrategyWeights;
  budget: number | null;
  confidence: ValueConfidence;
  /** Plain sentences about what the search did and did not constrain. */
  notes: string[];
}

interface Candidate {
  eaPlayerId: number;
  name: string;
  nameResolved: boolean;
  clubName: string | null;
  primaryPosition: string;
  overallRating: number | null;
  potentialRating: number | null;
  age: number | null;
  weakFoot: number | null;
  skillMoves: number | null;
  preferredFoot: number | null;
  /** Carried for the Realism dimension: an established international does not drop a division. */
  internationalRep: number | null;
  valueLow: number | null;
  valueMid: number | null;
  valueHigh: number | null;
  valueConfidence: string | null;
  valueBasis: string;
}

function classify(valueLow: number | null, valueMid: number | null, valueHigh: number | null, budget: number | null): Affordability {
  if (budget === null || valueHigh === null || valueMid === null) return "UNKNOWN";
  if (valueHigh <= budget) return "WITHIN";
  // A band that straddles the budget is a judgement call, not a hard no - so it is its own answer
  // rather than being rounded into either neighbour.
  if (valueLow !== null && valueLow <= budget) return "STRETCH";
  return "OVER";
}

function normaliser(values: number[]): (value: number) => number {
  const present = values.filter((value) => Number.isFinite(value));
  if (present.length === 0) return () => 0;
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (max - min < 1e-9) return () => 0.5;
  return (value: number) => (Number.isFinite(value) ? (value - min) / (max - min) : 0);
}

export class ScoutingSearchService {
  private values = new WorldValueModelService();

  /**
   * The squad-side half of the fit: who you have, and what the active formation asks for.
   *
   * Rebuilt on every search rather than cached. It is two small reads, against the alternative of a
   * fit that quietly describes the formation you had ten minutes ago - the manager can change shape
   * between two searches, and a stale answer is worse than a slower one.
   */
  private async squadContext(careerId: string): Promise<SquadContext> {
    const [squad, formation, settings] = await Promise.all([
      new SquadService().getCurrentSquad(careerId),
      new TacticsService().getTacticalSystem(careerId),
      new SettingsService().getSettings(),
    ]);
    return buildSquadContext(
      squad.map((player) => ({
        primaryPosition: player.primaryPosition,
        overallRating: player.overallRating,
        potentialRating: player.potentialRating ?? null,
        age: player.age,
        assignedRole: player.userProfile?.assignedRole ?? null,
      })),
      formation?.slots ?? null,
      // The Realism dimension's tolerance comes from here. Read every search rather than cached, so
      // changing the level in Settings moves the bar immediately instead of on the next restart.
      realismModeOf(settings.realismLevel),
      // The playstyle rides on the same context, so the fit panel can stand its reputation veto down
      // for a playstyle whose whole point is signing famous players.
      normalisePlaystyle(settings.playstyle)
    );
  }

  async search(input: ScoutSearchQuery): Promise<ScoutSearchResult> {
    const page = Math.max(0, Math.trunc(input.page));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize)));
    const weights = STRATEGY_WEIGHTS[input.strategy] ?? STRATEGY_WEIGHTS.BALANCED;
    const notes: string[] = [];

    // ---- Which players are in play ------------------------------------------------------------
    const filters: SQL[] = [eq(worldPlayers.careerId, input.careerId)];
    if (input.minRating !== null) filters.push(gte(worldPlayers.overallRating, input.minRating));
    if (input.maxAge !== null) filters.push(lte(worldPlayers.age, input.maxAge));

    if (input.position) {
      const group = POSITION_GROUPS[input.position];
      if (group) {
        filters.push(
          sql`${worldPlayers.primaryPosition} IN (${sql.join(
            group.map((role) => sql`${role}`),
            sql`, `
          )})`
        );
      } else {
        filters.push(eq(worldPlayers.primaryPosition, input.position));
      }
    }

    const trimmed = input.query.trim();
    if (trimmed) {
      filters.push(like(worldPlayers.name, `%${trimmed}%`));
      // Enforced in SQL rather than filtered afterwards, so the count is honest. A text query can
      // never match an unnamed player, so this applies whether or not unnamed rows are enabled.
      filters.push(eq(worldPlayers.nameResolved, true));
      notes.push(
        "Matching names only. Players whose name is not stored in the save cannot match a name search - every other filter still finds them."
      );
    } else if (input.includeUnnamed) {
      notes.push(
        "Including players whose name is not stored in the save. Only the name is missing for them - rating, club, age and the full dossier are intact."
      );
    } else {
      filters.push(eq(worldPlayers.nameResolved, true));
      notes.push(
        "Players whose name is not stored in the save are excluded. Turn on \"Show unnamed players\" to include them."
      );
    }

    if (input.budget !== null && input.budget > 0) {
      // Filtered on the band MIDPOINT, not its top. With an honest band this wide, requiring the
      // pessimistic end to fit inside the budget would exclude almost every player in the save and
      // make the filter useless. The band around each result then shows how much to trust the figure
      // the filter ranked on.
      filters.push(lte(worldPlayers.valueMid, input.budget));
      notes.push(
        `Affordable on the band MIDPOINT at ${input.budget.toLocaleString()}. The band around each result shows how much to trust that - these are estimates, not asking prices.`
      );
    } else {
      notes.push(
        input.budget === 0
          ? "Your transfer budget is 0, so nothing is filtered by price and every result reads as Over. The ranking still works - this is a planning list rather than a shopping list."
          : "No budget set, so nothing is filtered by price. Cost is still ranked - Value measures each player against what the rest of the pool is estimated to be worth."
      );
    }

    const candidates = await db
      .select({
        eaPlayerId: worldPlayers.eaPlayerId,
        name: worldPlayers.name,
        nameResolved: worldPlayers.nameResolved,
        clubName: worldPlayers.clubName,
        primaryPosition: worldPlayers.primaryPosition,
        overallRating: worldPlayers.overallRating,
        potentialRating: worldPlayers.potentialRating,
        age: worldPlayers.age,
        weakFoot: worldPlayers.weakFoot,
        skillMoves: worldPlayers.skillMoves,
        preferredFoot: worldPlayers.preferredFoot,
        internationalRep: worldPlayers.internationalRep,
        valueLow: worldPlayers.valueLow,
        valueMid: worldPlayers.valueMid,
        valueHigh: worldPlayers.valueHigh,
        valueConfidence: worldPlayers.valueConfidence,
      })
      .from(worldPlayers)
      .where(and(...filters))
      .orderBy(asc(worldPlayers.eaPlayerId))
      .limit(MAX_CANDIDATES);

    const model = await this.values.model(input.careerId);

    // Bands are recomputed here rather than trusted from the row, so a re-fit of the model is
    // reflected immediately instead of only after the next sync rewrites the pool.
    const scored: Candidate[] = candidates.map((row) => {
      const band =
        row.valueLow !== null && row.valueMid !== null && row.valueHigh !== null
          ? {
              low: row.valueLow,
              mid: row.valueMid,
              high: row.valueHigh,
              confidence: (row.valueConfidence as ValueConfidence) ?? "LOW",
              basis: "Stored band.",
            }
          : this.values.evaluate(model, {
              overallRating: row.overallRating,
              potentialRating: row.potentialRating,
              age: row.age,
            });
      return {
        ...row,
        valueLow: band?.low ?? null,
        valueMid: band?.mid ?? null,
        valueHigh: band?.high ?? null,
        valueConfidence: band?.confidence ?? null,
        valueBasis: band?.basis ?? "No rating in the save for this player, so no band can be formed.",
      };
    });

    // ---- One ranking function, four presets ---------------------------------------------------
    //
    // The second component is POTENTIAL LEVEL, not the gap between potential and current ability.
    // Scoring the gap looks equivalent and is not: it rewards being bad now, because a 53-rated
    // 15-year-old with 95 potential has a 42-point gap and a 94-rated 26-year-old has none. Measured
    // in the browser, that put a youth-squad teenager top of BALANCED. Scoring the LEVEL instead means
    // a prospect has to actually be good, and PROSPECT - which weights potential and youth hardest -
    // is what surfaces the teenager.
    const rate = normaliser(scored.map((row) => row.overallRating ?? 0));
    const potentialLevel = normaliser(
      scored.map((row) => row.potentialRating ?? row.overallRating ?? 0)
    );
    const young = normaliser(scored.map((row) => -(row.age ?? 40)));
    // What a player costs, expressed so that LESS is always better. With a budget this is the headroom
    // left inside it (negative once he is over). Without one, it is his own estimated value on a log
    // scale - log because the candidate set spans three orders of magnitude, and a linear
    // cheaper-is-better term would let a £200k youth player outrank everyone no matter the weight.
    const costOf = (row: { valueMid: number | null }): number => {
      if (row.valueMid === null || row.valueMid <= 0) return 0;
      return input.budget !== null
        ? (input.budget - row.valueMid) / Math.max(input.budget, 1)
        : -Math.log10(row.valueMid);
    };
    const cost = normaliser(scored.map(costOf));

    const ranked = scored
      .map((row) => ({
        row,
        score:
          (row.overallRating === null ? 0 : weights.rating * rate(row.overallRating)) +
          weights.potential * potentialLevel(row.potentialRating ?? row.overallRating ?? 0) +
          weights.youth * young(-(row.age ?? 40)) +
          weights.affordability * cost(costOf(row)),
      }))
      // Deterministic: score, then rating, then cheaper, then id. A stable order means the same
      // search returns the same page twice, which the UI relies on for hover and scroll.
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.row.overallRating ?? 0) - (a.row.overallRating ?? 0) ||
          (a.row.valueMid ?? Infinity) - (b.row.valueMid ?? Infinity) ||
          a.row.eaPlayerId - b.row.eaPlayerId
      );

    // The squad-side half of the fit, loaded once and reused for every row below.
    const context = await this.squadContext(input.careerId);

    const candidateOf = (row: (typeof scored)[number]): FitCandidate => ({
      primaryPosition: row.primaryPosition,
      overallRating: row.overallRating,
      potentialRating: row.potentialRating,
      age: row.age,
      valueMid: row.valueMid,
      valueHigh: row.valueHigh,
      clubName: row.clubName,
      internationalRep: row.internationalRep,
    });

    // One evaluation per candidate, reused by the ordering below AND by the rows themselves.
    // Recomputing inside the row mapper would double the work for byte-identical answers.
    const fits = new Map<number, PlayerFit>();
    for (const entry of ranked) {
      fits.set(
        entry.row.eaPlayerId,
        evaluateFit(context, candidateOf(entry.row), input.budget, "£")
      );
    }

    const dimensionOf = (row: { eaPlayerId: number }, key: FitKey): number =>
      fits.get(row.eaPlayerId)?.dimensions.find((dimension) => dimension.key === key)?.score ?? 0;

    // ---- The manager's own playstyle -----------------------------------------------------------
    //
    // A playstyle is a rule the manager set himself, so it REMOVES rather than ranks - the same
    // reasoning as the realism splice below. It is applied to every strategy rather than only to
    // SUGGESTED, because a youth-only manager wants no 28-year-olds in any list he opens, including
    // the ones he filtered himself.
    //
    // Players with no age in the save are kept. Removing them would enforce the manager's rule with
    // data we do not have, and silently dropping a target for being unreadable is how a search starts
    // lying about what exists.
    const playstyle = normalisePlaystyle((await new SettingsService().getSettings()).playstyle);
    const playstyleCriteria = PLAYSTYLE_DEFINITIONS[playstyle].criteria;
    if (playstyleCriteria.minAge !== null || playstyleCriteria.maxAge !== null) {
      const before = ranked.length;
      for (let index = ranked.length - 1; index >= 0; index -= 1) {
        const age = ranked[index].row.age;
        if (age === null || age === undefined) continue;
        const tooYoung = playstyleCriteria.minAge !== null && age < playstyleCriteria.minAge;
        const tooOld = playstyleCriteria.maxAge !== null && age > playstyleCriteria.maxAge;
        if (tooYoung || tooOld) ranked.splice(index, 1);
      }
      const removed = before - ranked.length;
      if (removed > 0) {
        notes.push(
          `${PLAYSTYLE_DEFINITIONS[playstyle].fullLabel} left out ${removed} ${
            removed === 1 ? "target" : "targets"
          } that fall outside the age rule you set.`
        );
      }
    }
    const playstyleNote = playstyleScoutingNote(playstyle);
    if (playstyleNote) notes.push(playstyleNote);

    if (input.strategy === "SUGGESTED") {
      // Implausible targets are REMOVED rather than ranked low. The whole value of a suggestion is
      // that it can be acted on, and a list topped by a player who would never join is worse than a
      // shorter list.
      for (let index = ranked.length - 1; index >= 0; index -= 1) {
        if (dimensionOf(ranked[index].row, "REALISM") < SUGGESTED_MIN_REALISM) ranked.splice(index, 1);
      }
      ranked.sort(
        (a, b) =>
          dimensionOf(b.row, "TACTICAL") - dimensionOf(a.row, "TACTICAL") ||
          dimensionOf(b.row, "REALISM") - dimensionOf(a.row, "REALISM") ||
          (b.row.potentialRating ?? 0) - (a.row.potentialRating ?? 0) ||
          (b.row.overallRating ?? 0) - (a.row.overallRating ?? 0) ||
          a.row.eaPlayerId - b.row.eaPlayerId
      );
      const gapSummary = context.gaps
        .map((gap) => `${gap.role} (${gap.have} of ${gap.want})`)
        .join(", ");
      notes.push(
        gapSummary
          ? `Ordered to fill your real gaps: ${gapSummary}. Anyone who would not plausibly join a club at your level has been left out entirely rather than ranked low.`
          : "Your formation reports no positional gaps, so this is ordered by fit and potential among players who would plausibly join you."
      );
    }

    const total = ranked.length;
    const slice = ranked.slice(page * pageSize, page * pageSize + pageSize);

    const rows: ScoutSearchRow[] = slice.map((entry, index) => {
      const value = describeValueBand(
        {
          low: entry.row.valueLow ?? 0,
          mid: entry.row.valueMid ?? 0,
          high: entry.row.valueHigh ?? 0,
          confidence: (entry.row.valueConfidence as ValueConfidence) ?? "LOW",
          basis: entry.row.valueBasis,
        },
        "£"
      );
      return {
        eaPlayerId: entry.row.eaPlayerId,
        name: entry.row.name,
        nameResolved: entry.row.nameResolved,
        clubName: entry.row.clubName,
        primaryPosition: entry.row.primaryPosition,
        overallRating: entry.row.overallRating,
        potentialRating: entry.row.potentialRating,
        age: entry.row.age,
        weakFoot: entry.row.weakFoot,
        skillMoves: entry.row.skillMoves,
        preferredFoot: entry.row.preferredFoot,
        value,
        affordability: classify(
          entry.row.valueLow,
          entry.row.valueMid,
          entry.row.valueHigh,
          input.budget
        ),
        score: Math.round(entry.score * 1000) / 1000,
        rank: page * pageSize + index + 1,
        // Reused from the map built before the ordering, so the bar shown is the one ranked on.
        fits:
          fits.get(entry.row.eaPlayerId) ??
          evaluateFit(context, candidateOf(entry.row), input.budget, "£"),
      };
    });

    if (total === MAX_CANDIDATES) {
      notes.push(
        `Ranked the first ${MAX_CANDIDATES.toLocaleString()} matching players. Narrow the filters for a complete ordering.`
      );
    }

    return {
      rows,
      total,
      /** `total` is a cap, not a count, once the candidate list fills up - the UI must say so. */
      capped: scored.length === MAX_CANDIDATES,
      page,
      pageSize,
      strategy: input.strategy,
      weights,
      budget: input.budget,
      confidence: rows[0]?.value.confidence ?? "LOW",
      notes,
    };
  }

  /**
   * Everything the dossier panel shows for one player.
   *
   * Read on demand rather than shipped with every result row: 34 face stats across a 20-row page is
   * a lot of payload for numbers that are only looked at one player at a time.
   */
  async dossier(
    careerId: string,
    eaPlayerId: number,
    /** Used only for the Financial Fit dimension; null leaves that one dimension unscored. */
    budget: number | null = null
  ): Promise<ScoutDossier | null> {
    const row = await db
      .select()
      .from(worldPlayers)
      .where(and(eq(worldPlayers.careerId, careerId), eq(worldPlayers.eaPlayerId, eaPlayerId)))
      .get();
    if (!row) return null;

    const model = await this.values.model(careerId);
    const evaluated = this.values.evaluate(model, {
      overallRating: row.overallRating,
      potentialRating: row.potentialRating,
      age: row.age,
    });

    const override = await db
      .select()
      .from(worldPlayerOverrides)
      .where(
        and(
          eq(worldPlayerOverrides.careerId, careerId),
          eq(worldPlayerOverrides.eaPlayerId, eaPlayerId)
        )
      )
      .get();

    let attributes: Record<string, unknown> = {};
    try {
      attributes = JSON.parse(row.attributesJson) as Record<string, unknown>;
    } catch {
      /* an unreadable attribute blob costs the dossier, not the player */
    }

    const fits = evaluateFit(
      await this.squadContext(careerId),
      {
        primaryPosition: row.primaryPosition,
        overallRating: row.overallRating,
        potentialRating: row.potentialRating,
        age: row.age,
        valueMid: row.valueMid,
        valueHigh: row.valueHigh,
        clubName: row.clubName,
        internationalRep: row.internationalRep,
      },
      budget,
      "£"
    );

    return {
      eaPlayerId: row.eaPlayerId,
      name: row.name,
      /** False means only the NAME is absent - every datum below is intact. */
      nameResolved: row.nameResolved,
      clubName: row.clubName,
      primaryPosition: row.primaryPosition,
      overallRating: row.overallRating,
      potentialRating: row.potentialRating,
      age: row.age,
      heightCm: row.heightCm,
      weakFoot: row.weakFoot,
      skillMoves: row.skillMoves,
      preferredFoot: row.preferredFoot,
      preferredFootOverride: override?.preferredFoot ?? null,
      internationalRep: row.internationalRep,
      value:
        row.valueLow !== null && row.valueMid !== null && row.valueHigh !== null
          ? describeValueBand(
              {
                low: row.valueLow,
                mid: row.valueMid,
                high: row.valueHigh,
                confidence: (row.valueConfidence as ValueConfidence) ?? "LOW",
                basis: "Computed when this save was synced.",
              },
              "£"
            )
          : evaluated
            ? describeValueBand(evaluated, "£")
            : null,
      attributes,
      /** Same four dimensions the search rows carry, so the panel explains itself the same way. */
      fits,
    };
  }

  /**
   * Records the manager's own foot for a world player.
   *
   * USER provenance, and kept apart from the save's value on purpose: the two are shown side by side
   * in the dossier rather than one silently replacing the other.
   */
  async setFootOverride(
    careerId: string,
    eaPlayerId: number,
    preferredFoot: number | null
  ): Promise<void> {
    const existing = await db
      .select()
      .from(worldPlayerOverrides)
      .where(
        and(
          eq(worldPlayerOverrides.careerId, careerId),
          eq(worldPlayerOverrides.eaPlayerId, eaPlayerId)
        )
      )
      .get();

    const values = { preferredFoot, updatedAt: new Date().toISOString() };
    if (existing) {
      await db.update(worldPlayerOverrides).set(values).where(eq(worldPlayerOverrides.id, existing.id));
      return;
    }
    await db.insert(worldPlayerOverrides).values({
      id: crypto.randomUUID(),
      careerId,
      eaPlayerId,
      provenance: "USER",
      ...values,
    });
  }
}
