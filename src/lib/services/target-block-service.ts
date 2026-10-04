/**
 * 5-match target blocks.
 *
 * A block is the manager's own five-match plan: what they wanted from each match, and what they got.
 * Every figure is USER provenance - a block is reported, never derived. That is the honest design
 * here rather than a shortcut: the save zeroes our division's results, and MATCH_DEBRIEF rows carry
 * no season, so nothing in the data could bind a block to a season's matches without inventing it.
 *
 * The block is judged in league points (0/1/3 per match), against a band the manager sets - the
 * requirement's example being 8-10 wanted, 11-12 a dream, 6 or fewer a concern. The band is the
 * manager's judgement, not a model output, so it is stored rather than computed.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { targetBlocks } from "../db/schema";

/** League points for one match: a loss, a draw, or a win. */
export type MatchPoints = 0 | 1 | 3;

export interface BlockMatch {
  matchday: number;
  opponent: string | null;
  /** Their league place when the manager wrote the block. Shown beside the opponent. */
  opponentPosition: number | null;
  /** The floor of the ask for this match: 3 for a win, 1 for a draw, 0 for a free hit. */
  targetPoints: MatchPoints;
  /**
   * The top of the ask. Equal to `targetPoints` for an exact target ("3 pts"); higher for a range
   * ("1-3 pts" is 1 to 3). The FLOOR is what the block total and the trajectory line compare
   * against, because that is the number the manager is actually holding themselves to.
   */
  targetMaxPoints: MatchPoints;
  /** Null until the match has been played and reported. */
  actualPoints: MatchPoints | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** What actually happened, in the manager's own words. */
  note: string | null;
}

export interface TargetBlock {
  id: string;
  careerId: string;
  seasonNumber: number;
  blockIndex: number;
  matches: BlockMatch[];
  targetMin: number;
  targetMax: number;
  dreamPoints: number;
  concernPoints: number;
  /** The club's situation BEFORE the block's first match. Null where the manager left it blank. */
  gamesPlayedBefore: number | null;
  pointsBefore: number | null;
  positionBefore: number | null;
  goalDifferenceBefore: number | null;
  /** Where the club stood when the block ended, as the manager read it off the table. */
  tablePosition: number | null;
  notes: string | null;
}

export type BlockVerdict = "IN_PROGRESS" | "DREAM" | "ON_TARGET" | "BELOW_TARGET" | "CONCERN";

export interface BlockSummary {
  matchesPlayed: number;
  matchesTotal: number;
  complete: boolean;
  points: number;
  /** The most the block could still yield from its remaining matches. */
  pointsIfRemainingWon: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  verdict: BlockVerdict;
  headline: string;
  /** Positive means still short of the target place. Null when either side is unknown. */
  gapToTargetPosition: number | null;
  targetPosition: number | null;
}

export const MATCHES_PER_BLOCK = 5;
const DEFAULT_TARGET_MIN = 8;
const DEFAULT_TARGET_MAX = 10;
const DEFAULT_DREAM = 12;
const DEFAULT_CONCERN = 6;

export interface SaveBlockInput {
  careerId: string;
  seasonNumber: number;
  blockIndex: number;
  matches?: Array<Partial<BlockMatch>>;
  targetMin?: number;
  targetMax?: number;
  dreamPoints?: number;
  concernPoints?: number;
  gamesPlayedBefore?: number | null;
  pointsBefore?: number | null;
  positionBefore?: number | null;
  goalDifferenceBefore?: number | null;
  tablePosition?: number | null;
  notes?: string | null;
}

function toMatchPoints(value: unknown): MatchPoints | null {
  if (value === 0 || value === 1 || value === 3) return value;
  return null;
}

function toTargetPoints(value: unknown): MatchPoints {
  // An unreported target defaults to expecting the win: the manager overrides it if they disagree.
  return toMatchPoints(value) ?? 3;
}

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Five entries, always - a block is a block, not however many rows happen to be stored. */
function normaliseMatches(raw: Array<Partial<BlockMatch>> | undefined): BlockMatch[] {
  const provided = Array.isArray(raw) ? raw : [];
  return Array.from({ length: MATCHES_PER_BLOCK }, (_, index) => {
    const entry = provided[index] ?? {};
    return {
      matchday: toOptionalInt(entry.matchday) ?? index + 1,
      opponent: typeof entry.opponent === "string" && entry.opponent.trim() ? entry.opponent.trim() : null,
      opponentPosition: toOptionalInt(entry.opponentPosition),
      targetPoints: toTargetPoints(entry.targetPoints),
      // A manager who typed only one target asked for an exact figure, so the ceiling mirrors it.
      targetMaxPoints: toTargetPoints(entry.targetMaxPoints ?? entry.targetPoints),
      actualPoints: toMatchPoints(entry.actualPoints),
      goalsFor: toOptionalInt(entry.goalsFor),
      goalsAgainst: toOptionalInt(entry.goalsAgainst),
      note: typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : null,
    };
  });
}

function toBlock(row: typeof targetBlocks.$inferSelect): TargetBlock {
  let parsed: Array<Partial<BlockMatch>> = [];
  try {
    const raw: unknown = JSON.parse(row.matchesJson);
    if (Array.isArray(raw)) parsed = raw as Array<Partial<BlockMatch>>;
  } catch {
    /* an unreadable payload costs the detail, not the block */
  }
  return {
    id: row.id,
    careerId: row.careerId,
    seasonNumber: row.seasonNumber,
    blockIndex: row.blockIndex,
    matches: normaliseMatches(parsed),
    targetMin: row.targetMin,
    targetMax: row.targetMax,
    dreamPoints: row.dreamPoints,
    concernPoints: row.concernPoints,
    gamesPlayedBefore: row.gamesPlayedBefore,
    pointsBefore: row.pointsBefore,
    positionBefore: row.positionBefore,
    goalDifferenceBefore: row.goalDifferenceBefore,
    tablePosition: row.tablePosition,
    notes: row.notes,
  };
}

export class TargetBlockService {
  async listBlocks(careerId: string, seasonNumber?: number): Promise<TargetBlock[]> {
    const rows = await db
      .select()
      .from(targetBlocks)
      .where(eq(targetBlocks.careerId, careerId))
      .orderBy(asc(targetBlocks.seasonNumber), asc(targetBlocks.blockIndex));
    const filtered =
      seasonNumber === undefined ? rows : rows.filter((row) => row.seasonNumber === seasonNumber);
    return filtered.map(toBlock);
  }

  /** Creates or updates one block, keyed by (career, season, block index). */
  async saveBlock(input: SaveBlockInput): Promise<TargetBlock> {
    const matches = normaliseMatches(input.matches);
    const values = {
      matchesJson: JSON.stringify(matches),
      targetMin: toOptionalInt(input.targetMin) ?? DEFAULT_TARGET_MIN,
      targetMax: toOptionalInt(input.targetMax) ?? DEFAULT_TARGET_MAX,
      dreamPoints: toOptionalInt(input.dreamPoints) ?? DEFAULT_DREAM,
      concernPoints: toOptionalInt(input.concernPoints) ?? DEFAULT_CONCERN,
      gamesPlayedBefore: toOptionalInt(input.gamesPlayedBefore),
      pointsBefore: toOptionalInt(input.pointsBefore),
      positionBefore: toOptionalInt(input.positionBefore),
      goalDifferenceBefore: toOptionalInt(input.goalDifferenceBefore),
      tablePosition: input.tablePosition ?? null,
      notes: input.notes ?? null,
      updatedAt: new Date().toISOString(),
    };

    const existing = await db
      .select()
      .from(targetBlocks)
      .where(
        and(
          eq(targetBlocks.careerId, input.careerId),
          eq(targetBlocks.seasonNumber, input.seasonNumber),
          eq(targetBlocks.blockIndex, input.blockIndex)
        )
      )
      .get();

    if (existing) {
      await db.update(targetBlocks).set(values).where(eq(targetBlocks.id, existing.id));
      return toBlock({ ...existing, ...values });
    }

    const id = crypto.randomUUID();
    await db.insert(targetBlocks).values({
      id,
      careerId: input.careerId,
      seasonNumber: input.seasonNumber,
      blockIndex: input.blockIndex,
      provenance: "USER",
      ...values,
    });
    const inserted = await db.select().from(targetBlocks).where(eq(targetBlocks.id, id)).get();
    return toBlock(inserted!);
  }

  async deleteBlock(careerId: string, id: string): Promise<void> {
    await db
      .delete(targetBlocks)
      .where(and(eq(targetBlocks.careerId, careerId), eq(targetBlocks.id, id)));
  }

  /**
   * The block's report card.
   *
   * `targetPosition` is the manager's own objective (USER), so the gap is a comparison of two USER
   * figures rather than of a save fact against an estimate.
   */
  summarise(block: TargetBlock, targetPosition: number | null): BlockSummary {
    const played = block.matches.filter((match) => match.actualPoints !== null);
    const points = played.reduce((sum, match) => sum + (match.actualPoints ?? 0), 0);
    const wins = played.filter((match) => match.actualPoints === 3).length;
    const draws = played.filter((match) => match.actualPoints === 1).length;
    const losses = played.filter((match) => match.actualPoints === 0).length;
    const goalsFor = played.reduce((sum, match) => sum + (match.goalsFor ?? 0), 0);
    const goalsAgainst = played.reduce((sum, match) => sum + (match.goalsAgainst ?? 0), 0);
    const complete = played.length === block.matches.length;

    let verdict: BlockVerdict;
    let headline: string;
    if (played.length === 0) {
      verdict = "IN_PROGRESS";
      headline = `Block ${block.blockIndex}: nothing reported yet`;
    } else if (points >= block.dreamPoints) {
      verdict = "DREAM";
      headline = `Block ${block.blockIndex}: ${points} pts - a dream block`;
    } else if (points >= block.targetMin) {
      verdict = "ON_TARGET";
      headline = `Block ${block.blockIndex}: ${points} pts - on target`;
    } else if (points <= block.concernPoints) {
      verdict = "CONCERN";
      headline = `Block ${block.blockIndex}: ${points} pts - a concern`;
    } else {
      verdict = "BELOW_TARGET";
      headline = `Block ${block.blockIndex}: ${points} pts - short of the ${block.targetMin} wanted`;
    }

    return {
      matchesPlayed: played.length,
      matchesTotal: block.matches.length,
      complete,
      points,
      pointsIfRemainingWon: points + (block.matches.length - played.length) * 3,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      verdict,
      headline,
      gapToTargetPosition:
        block.tablePosition !== null && targetPosition !== null
          ? block.tablePosition - targetPosition
          : null,
      targetPosition,
    };
  }
}
