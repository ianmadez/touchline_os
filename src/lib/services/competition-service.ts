/**
 * What competitions this career can actually be in.
 *
 * The point of this module is that a debrief should say "Championship" and "FA Cup", not "League Match"
 * and "Domestic Cup". A generic label throws away something the app already knows: the save names the
 * manager's own division, and the country that division belongs to is what decides which cups exist.
 *
 * THREE SOURCES, and none of them is a guess:
 *
 *   1. The manager's own division comes from the save's competition catalogue, which is the only place a
 *      league is ever named.
 *   2. The domestic cups of his country come from the honour cabinet's authored reference table, which
 *      exists precisely because the save ships those competitions with an EMPTY name.
 *   3. The continental competitions come from the same table, filtered by what his division's tier is
 *      allowed to enter, so a League Two club is not offered the Champions League.
 *
 * When the save names nothing usable, the generic labels come back instead. That is not a degraded mode, it
 * is the honest answer for a career whose competition rows are unreadable, and it keeps the form usable.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { careers, leagues } from "../db/schema";
import { continentalFor, domesticCupsFor, isOpenToTier } from "../trophies/catalogue";

export type CompetitionKind = "LEAGUE" | "DOMESTIC_CUP" | "CONTINENTAL" | "OTHER";

export interface CompetitionOption {
  name: string;
  kind: CompetitionKind;
}

export interface CompetitionContext {
  countryId: number | null;
  countryName: string | null;
  /** The tier the save records for the manager's division. Null when it records none. */
  tier: number | null;
  /** The manager's division, as the save names it, with the save's own tier suffix removed. */
  leagueName: string | null;
  /** In the order a debrief is most likely to need them: his league, his cups, Europe, a friendly. */
  options: CompetitionOption[];
  /** True when the save gave us enough to name real competitions. */
  named: boolean;
}

/** The generic labels, kept for a career whose competitions the save cannot name. */
const GENERIC: CompetitionOption[] = [
  { name: "League Match", kind: "LEAGUE" },
  { name: "Domestic Cup", kind: "DOMESTIC_CUP" },
  { name: "European Cup", kind: "CONTINENTAL" },
];

const FRIENDLY: CompetitionOption = { name: "Friendly / Pre-season", kind: "OTHER" };

export class CompetitionService {
  async getContext(careerId: string): Promise<CompetitionContext | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const catalogue = await db.select().from(leagues).where(eq(leagues.careerId, careerId));
    const ours = catalogue.find((row) => row.leagueId === career.leagueId) ?? null;
    const countryId = ours?.countryId ?? null;
    const tier = ours?.level ?? null;
    const leagueName = ours?.name ? stripTierSuffix(ours.name) : null;

    const options: CompetitionOption[] = [];
    if (leagueName) options.push({ name: leagueName, kind: "LEAGUE" });

    for (const cup of domesticCupsFor(countryId)) {
      if (!isOpenToTier(cup, tier)) continue;
      options.push({ name: cup.name, kind: "DOMESTIC_CUP" });
    }
    for (const cup of continentalFor(countryId)) {
      if (!isOpenToTier(cup, tier)) continue;
      options.push({ name: cup.name, kind: "CONTINENTAL" });
    }

    const named = leagueName !== null && options.length > 1;
    const list = named ? options : [...GENERIC];
    // Deduped, because a nation whose cup shares a name with its league would otherwise offer it twice.
    const deduped = [...new Map(list.map((option) => [option.name, option])).values()];
    if (!deduped.some((option) => option.name === FRIENDLY.name)) deduped.push(FRIENDLY);

    return {
      countryId,
      countryName: ours?.countryName ?? null,
      tier,
      leagueName,
      options: deduped,
      named,
    };
  }
}

/**
 * The save's competition name without the tier suffix it stores: "England Championship (2)" reads as
 * "England Championship" in a debrief.
 */
function stripTierSuffix(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}
