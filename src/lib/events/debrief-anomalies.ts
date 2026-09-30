import type { MatchContribution } from "./types";

export interface DebriefHistoryPayload {
  opponent?: string;
  scoreline?: string;
  result?: string;
  venue?: string;
  competition?: string;
  standoutPlayerNames?: string[];
  standoutPlayerIds?: string[];
  contributions?: MatchContribution[];
  weaknessIdentified?: string;
  managerReflection?: string;
  homeScore?: number;
  awayScore?: number;
  matchDate?: string | null;
  leagueSnapshot?: {
    opponentPosition?: number | null;
    opponentPoints?: number | null;
    ownPosition?: number | null;
    ownPoints?: number | null;
  };
  dynamicPrompts?: Array<{ id: string; question: string; answer: string }>;
}

export interface AnomalyPrompt {
  id: string;
  category: "DEFENSIVE_LEAK" | "ATTACKING_DROUGHT" | "PLAYER_SURGE" | "HEAVY_MARGIN" | "RECURRING_WEAKNESS";
  title: string;
  badgeText: string;
  tone: "rose" | "amber" | "emerald" | "sky";
  question: string;
  placeholder: string;
  /** Higher fires first when the overall prompt cap trims the list. */
  priority: number;
}

export interface CurrentMatchContext {
  ourScore: number;
  theirScore: number;
  opponent: string;
  contributions: MatchContribution[];
  standoutPlayerIds: string[];
  matchDate?: string | null;
}

/** Never ask more than this many follow-up questions in one debrief, however many things are true. */
const MAX_PROMPTS = 4;

// ---------------------------------------------------------------------------
// Deterministic variant selection.
//
// The same match must always render the same wording on re-render/refresh, but two different
// matches should read as two different reports, not the same template with numbers swapped in.
// A small hash of the match's own facts (never the wall clock, never Math.random) picks a stable
// index into each phrase pool. Multiple independent pools per category compound multiplicatively —
// a handful of fragments per slot produces dozens of readable combinations without maintaining a
// literal list of them.
// ---------------------------------------------------------------------------

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(pool: readonly T[], seed: string, salt: string): T {
  const index = stableHash(`${seed}::${salt}`) % pool.length;
  return pool[index];
}

// ---------------------------------------------------------------------------
// Phrase pools, one per category, split into independent slots that combine.
// ---------------------------------------------------------------------------

const DEFENSIVE_LEAD_INS = [
  "Defensive vulnerability spotted.",
  "The back line has been leaking goals.",
  "Something's not holding up defensively.",
  "The concession pattern is worth a hard look.",
] as const;

const DEFENSIVE_FRAMINGS = [
  "Is this a systemic failure in transition, individual mistakes, or squad fatigue?",
  "Is it a structural gap, a personnel problem, or bad luck compounding?",
  "Are opponents finding the same space repeatedly, or is this scattered across different causes?",
] as const;

const DEFENSIVE_PLACEHOLDERS = [
  "e.g. Left flank exposed when full-back overlaps, or missing CDM screening...",
  "e.g. Centre-backs pulled out of shape by movement, no cover behind the press...",
  "e.g. Recycled second balls in midfield leading straight to counters...",
] as const;

const DROUGHT_LEAD_INS = [
  "Chances have dried up recently.",
  "The final third has gone quiet.",
  "Goals are becoming hard to come by.",
] as const;

const DROUGHT_FRAMINGS = [
  "Are you lacking creative presence in midfield, or is conversion the main issue?",
  "Is service into the box the problem, or are chances there but not being taken?",
  "Is the system creating openings at all, or has the whole approach gone stale?",
] as const;

const DROUGHT_PLACEHOLDERS = [
  "e.g. Striker isolated without support, or need quicker ball movement...",
  "e.g. Wide players cutting inside too early, box staying empty on crosses...",
  "e.g. No one occupying the half-spaces, attacks going through one predictable route...",
] as const;

const COMMANDING_LEAD_INS = [
  "You dominated this match.",
  "That was a statement performance.",
  "Complete control from start to finish.",
] as const;

const COMMANDING_FRAMINGS = [
  "What specific tactical instruction proved most effective?",
  "What was the single biggest reason it worked so cleanly?",
  "Is this repeatable against a similar opponent, or was it circumstantial?",
] as const;

const HEAVY_DEFEAT_LEAD_INS = [
  "A heavy loss.",
  "That result needs addressing directly.",
  "A performance like that can't be ignored.",
] as const;

const HEAVY_DEFEAT_FRAMINGS = [
  "What immediate structural or personnel changes are needed for the next fixture?",
  "Was this a tactical mismatch, an off day, or something deeper in the squad?",
  "Does this change your plan for the next match, or was it a one-off?",
] as const;

const SURGE_FRAMINGS = [
  "Are you adjusting the system to maximize their output, or keeping their role standard?",
  "Is the team starting to build around them, or is this still incidental to the plan?",
  "Worth reshaping the tactics to feed them more, or is the current setup already doing that?",
] as const;

const SURGE_PLACEHOLDERS = [
  "e.g. Giving him freedom to drift inside, building attacks through his flank...",
  "e.g. Making him the first outlet on the counter, playing off his movement...",
  "e.g. No change yet, but it's becoming hard to justify leaving him out wide...",
] as const;

function tag(seed: string, salt: string): string {
  return pick(["Tactical Memory", "Following Up", "Still Watching This"], seed, salt);
}

export function evaluateMatchAnomalies(
  pastDebriefsPayloads: DebriefHistoryPayload[],
  current: CurrentMatchContext,
  playerNamesById: Record<string, string>
): AnomalyPrompt[] {
  const anomalies: AnomalyPrompt[] = [];
  const seed = `${current.opponent}:${current.ourScore}-${current.theirScore}:${current.matchDate ?? ""}`;

  // Sort explicitly rather than trusting caller order — a payload list passed chronologically
  // instead of newest-first would otherwise silently reason about the wrong two matches.
  const sortedHistory = [...pastDebriefsPayloads].sort((a, b) => {
    const aTime = a.matchDate ? new Date(a.matchDate).getTime() : 0;
    const bTime = b.matchDate ? new Date(b.matchDate).getTime() : 0;
    return bTime - aTime; // newest first
  });
  const recentHistory = sortedHistory.slice(0, 2);

  const totalConceded = current.theirScore + recentHistory.reduce((sum, d) => sum + (d.awayScore ?? 0), 0);
  const totalScored = current.ourScore + recentHistory.reduce((sum, d) => sum + (d.homeScore ?? 0), 0);
  const matchesCount = recentHistory.length + 1;

  // 1. Defensive leak
  if (totalConceded >= 6 || current.theirScore >= 3) {
    anomalies.push({
      id: "defensive_leak",
      category: "DEFENSIVE_LEAK",
      title: "Defensive Leakage Detected",
      badgeText: `${totalConceded} goals conceded in last ${matchesCount} matches`,
      tone: "rose",
      question: `${pick(DEFENSIVE_LEAD_INS, seed, "leak_lead")} ${pick(DEFENSIVE_FRAMINGS, seed, "leak_frame")}`,
      placeholder: pick(DEFENSIVE_PLACEHOLDERS, seed, "leak_ph"),
      priority: 90,
    });
  }

  // 2. Attacking drought
  if (totalScored <= 1 && matchesCount >= 2) {
    anomalies.push({
      id: "attacking_drought",
      category: "ATTACKING_DROUGHT",
      title: "Goal Drought Trend",
      badgeText: `Only ${totalScored} goal${totalScored === 1 ? "" : "s"} scored in last ${matchesCount} matches`,
      tone: "amber",
      question: `${pick(DROUGHT_LEAD_INS, seed, "drought_lead")} ${pick(DROUGHT_FRAMINGS, seed, "drought_frame")}`,
      placeholder: pick(DROUGHT_PLACEHOLDERS, seed, "drought_ph"),
      priority: 70,
    });
  }

  // 3. Heavy margin, either direction
  const margin = current.ourScore - current.theirScore;
  if (margin >= 3) {
    anomalies.push({
      id: "commanding_win",
      category: "HEAVY_MARGIN",
      title: "Commanding Victory (+3 Goal Margin)",
      badgeText: "Dominant Performance",
      tone: "emerald",
      question: `${pick(COMMANDING_LEAD_INS, seed, "win_lead")} ${pick(COMMANDING_FRAMINGS, seed, "win_frame")}`,
      placeholder: "e.g. High press forced turnover, or overloaded wide areas effectively...",
      priority: 40,
    });
  } else if (margin <= -3) {
    anomalies.push({
      id: "heavy_defeat",
      category: "HEAVY_MARGIN",
      title: "Heavy Defeat (-3 Goal Margin)",
      badgeText: "Crisis Point",
      tone: "rose",
      question: `${pick(HEAVY_DEFEAT_LEAD_INS, seed, "loss_lead")} ${pick(HEAVY_DEFEAT_FRAMINGS, seed, "loss_frame")}`,
      placeholder: "e.g. Switch to a double pivot, drop underperforming center back...",
      priority: 95,
    });
  }

  // 4. In-form player surge
  const currentGoalScorers = current.contributions.filter((c) => c.goals > 0);
  for (const scorer of currentGoalScorers) {
    const scoredInPrevious = recentHistory.some((d) =>
      (d.contributions ?? []).some(
        (c) => (c.playerId === scorer.playerId || c.playerName === scorer.playerName) && c.goals > 0
      )
    );

    if (scoredInPrevious || scorer.goals >= 2) {
      const pName = scorer.playerName || playerNamesById[scorer.playerId] || "Your striker";
      anomalies.push({
        id: `player_surge_${scorer.playerId}`,
        category: "PLAYER_SURGE",
        title: `${pName} In Hot Form`,
        badgeText: `${scorer.goals} goal${scorer.goals > 1 ? "s" : ""} today`,
        tone: "sky",
        question: `${pName} is carrying real momentum. ${pick(SURGE_FRAMINGS, seed, `surge_${scorer.playerId}`)}`,
        placeholder: pick(SURGE_PLACEHOLDERS, seed, `surge_ph_${scorer.playerId}`),
        priority: 55,
      });
      break;
    }
  }

  // 5. Recurring weakness follow-up — excludes a weakness that was already followed up on in the
  // immediately preceding debrief, so the same note isn't asked about twice back to back.
  const alreadyFollowedUp =
    sortedHistory[0]?.dynamicPrompts?.some((p) => p.id === "recurring_weakness") ?? false;
  const pastWeakness = recentHistory.find(
    (d) => d.weaknessIdentified && d.weaknessIdentified.trim().length > 0
  )?.weaknessIdentified;

  if (pastWeakness && !alreadyFollowedUp) {
    anomalies.push({
      id: "recurring_weakness",
      category: "RECURRING_WEAKNESS",
      title: "Previous Weakness Follow-Up",
      badgeText: tag(seed, "weakness_tag"),
      tone: "amber",
      question: `You previously noted: "${pastWeakness}". Did you see progress on this today or repeat mistakes?`,
      placeholder: "e.g. Fixed wide coverage, but set-piece defending was still suspect...",
      priority: 30,
    });
  }

  // Every trigger above is independently true and independently real — but a debrief asking five
  // things at once stops being a debrief. Keep the highest-priority MAX_PROMPTS, drop the rest.
  return anomalies.sort((a, b) => b.priority - a.priority).slice(0, MAX_PROMPTS);
}