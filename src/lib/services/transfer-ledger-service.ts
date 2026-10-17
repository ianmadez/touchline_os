/**
 * The transfer ledger: what came in, what went out, and what it left behind.
 *
 * TWO SOURCES, NEVER BLENDED. The save carries agreed fees from pre-signed contracts, which is a real fact
 * about a real deal. Anything else is typed in by the manager, and every row says which it is, because
 * "eight million" from the save and "eight million" from memory are not the same claim.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not estimate a fee the save does not have, and it does not follow
 * a player to a third club: the save names no club outside the manager's own division, and the game stores
 * no player valuation anywhere, so a chain of later moves would be invention dressed as history. What it
 * does is answer the two questions the manager actually asks: what did he cost us, and what did we make.
 *
 * PROFIT IS ONLY COMPUTED WHERE BOTH SIDES EXIST. A player who arrived before tracking has no purchase
 * price, and a written-off free has no sale price, so those rows carry no profit rather than a made-up one.
 */

import { and, eq, like, or } from "drizzle-orm";

import { db } from "../db/client";
import {
  careers,
  leagueTeams,
  players,
  transferCounterpartyNames,
  transferDeals,
  transferInputs,
  worldPlayers,
  type DealKind,
} from "../db/schema";
import { yyyymmddToDate } from "../parser/interface";

export type LedgerDirection = "IN" | "OUT";
export type LedgerProvenance = "SAVE" | "USER";

export interface LedgerEntry {
  id: string;
  direction: LedgerDirection;
  /** A transfer or a loan. The two are never mixed up in a total: see `wagesPaid`. */
  kind: DealKind;
  playerName: string;
  /** The club at the other end, or null when nothing on file can name it. */
  counterparty: string | null;
  /**
   * True when the club was named by the MANAGER rather than by the save.
   *
   * The save has no club table, so a deal with anybody outside the manager's own division comes back with an
   * id and nothing else. The ledger asks him to name it instead of printing an explanation of the gap.
   */
  counterpartyFromManager: boolean;
  /** The save's own club id when it gave one, so the screen can be honest about a missing name. */
  counterpartyTeamId: number | null;
  fee: number;
  /**
   * The two dates a saved deal carries, and they are different things.
   *
   * `signedDate` is when the deal was agreed; `completeDate` is when the player actually moves, which for a
   * pre-contract or a January transfer is a later window. Showing one of them without the other is how a
   * manager ends up reading a date that cannot be true: the move he made in his first season carries the date
   * it completes, and a signing that arrives in January carries the date it was agreed.
   */
  agreedOn: string | null;
  completedOn: string | null;
  /** True when the move completes after the save's own date, so it has not happened yet. */
  pending: boolean;
  season: number | null;
  provenance: LedgerProvenance;
  note: string | null;
  /** The player's wage on a loan, in whole units per week. Null on a transfer, and when not recorded. */
  salary: number | null;
  /** The share of that wage THIS club pays, 0 to 100. Null when no split was recorded. */
  wageSharePct: number | null;
  /**
   * What this club pays of the wage, in the wage's own units.
   *
   * Null on a transfer, and on a loan whose split was never recorded: an unrecorded split is not read as
   * "all of it", because that would put a cost in the totals the manager never confirmed.
   */
  wagesPaid: number | null;
  /** True when this row was typed in, so the screen can offer to remove it. */
  editable: boolean;
}

export interface PlayerLedgerLine {
  playerName: string;
  paid: number | null;
  received: number | null;
  /** Positive means a profit. Null when one side of the deal is not on file. */
  profit: number | null;
}

export interface SeasonBalance {
  season: number | null;
  spent: number;
  received: number;
  /** How much of `spent` is loan wages. Zero on a season with no loan on it. */
  wages: number;
  net: number;
  deals: number;
}

export interface TransferLedger {
  careerId: string;
  clubName: string;
  clubId: number | null;
  entries: LedgerEntry[];
  /** Money out, then money in, then the difference. Career-wide, and `spent` includes loan wages. */
  totals: { spent: number; received: number; net: number };
  /**
   * The same three figures with wages taken out: fees alone.
   *
   * Two different questions get asked of this ledger. The screen asks what the club has paid out, which has to
   * include a loan's wage or it would call a season of loans free. The transfer-budget check asks what it has
   * spent on TRANSFERS, which is a figure a wage must never be folded into - a loan's wages would eat a budget
   * they were never part of.
   */
  feeTotals: { spent: number; received: number; net: number };
  /** How much of `totals.spent` is wages rather than a fee, so the figure is never a mystery. */
  loanWages: number;
  /** Loans on file whose wage is not in the totals because no split was recorded. */
  loansWithoutSplit: number;
  seasons: SeasonBalance[];
  /** Per player, where both a purchase and a sale are on file. Loans are never counted as a purchase. */
  profitLines: PlayerLedgerLine[];
  /** How many players left without a fee on file, so a missing profit can be explained. */
  unvaluedExits: number;
  /** True when there is nothing at all on file yet. */
  empty: boolean;
}

export interface TransferInputRequest {
  careerId: string;
  direction: LedgerDirection;
  playerName: string;
  counterparty?: string | null;
  fee: number;
  /** A transfer, unless a loan is being recorded. */
  kind?: DealKind;
  /** The player's wage on a loan, in whole units per week. */
  salary?: number | null;
  /** The share of that wage this club pays, 0 to 100. Null when the manager left it blank. */
  wageSharePct?: number | null;
  /** The day the deal was agreed, as the manager records it. */
  agreedOn?: string | null;
  /** The day the player actually moves, when that is a different day. */
  completedOn?: string | null;
  season?: number | null;
  note?: string | null;
}

/** A player the ledger can name a deal against. */
export interface LedgerPlayerMatch {
  /** The save's own id for him, so a later change of name cannot break the link. */
  eaPlayerId: number;
  name: string;
  clubName: string | null;
  primaryPosition: string;
  /** True when he is already on the manager's books, which is the usual case for a sale. */
  ours: boolean;
}

export class TransferLedgerService {
  async getLedger(careerId: string): Promise<TransferLedger | null> {
    const career = await db.select().from(careers).where(eq(careers.id, careerId)).get();
    if (!career) return null;

    const clubId = career.clubId;
    const squad = await db.select().from(players).where(eq(players.careerId, careerId));
    const pool = await db.select().from(worldPlayers).where(eq(worldPlayers.careerId, careerId));
    const division = await db.select().from(leagueTeams).where(eq(leagueTeams.careerId, careerId));

    const nameByEaId = new Map<number, string>();
    for (const player of pool) nameByEaId.set(player.eaPlayerId, player.name);
    // The squad wins over the world pool: a player on the books is the one the manager knows by name.
    for (const player of squad) nameByEaId.set(player.eaPlayerId, player.name);

    const clubNameById = new Map<number, string>();
    for (const club of division) clubNameById.set(club.teamId, club.name);
    // The world pool is the second and much wider source of club names: every player in the save carries the
    // club he plays for, so a deal with a club outside our division can still be named properly. Monaco is
    // resolved this way, which is what turns "club 69" into AS Monaco without asking the manager anything.
    // Our own division wins where both know a club, because that is the list the game itself renders.
    for (const player of pool) {
      if (player.clubId === null || player.clubName === null) continue;
      if (!clubNameById.has(player.clubId)) clubNameById.set(player.clubId, player.clubName);
    }

    // Names the manager has supplied for clubs the save cannot name, keyed on the deal's own id.
    const supplied = await db
      .select()
      .from(transferCounterpartyNames)
      .where(eq(transferCounterpartyNames.careerId, careerId));
    const nameByDealId = new Map<string, string>();
    for (const row of supplied) nameByDealId.set(row.dealId, row.name);

    /** What the save's own clock says, so a move that has not completed can be marked as such. */
    const today = career.inGameDate ?? null;

    const entries: LedgerEntry[] = [];

    // The save's own half: deals where our club is one end of the move.
    const deals = await db
      .select()
      .from(transferDeals)
      .where(
        and(
          eq(transferDeals.careerId, careerId),
          clubId === null
            ? undefined
            : or(eq(transferDeals.buyingTeamId, clubId), eq(transferDeals.sellingTeamId, clubId))
        )
      );

    for (const deal of deals) {
      const buying = deal.buyingTeamId === clubId;
      const counterpartyTeamId = buying ? deal.sellingTeamId : deal.buyingTeamId;
      const agreedOn = dayFromSavedDate(deal.signedDate);
      const completedOn = dayFromSavedDate(deal.completeDate);
      const named = clubNameById.get(counterpartyTeamId ?? -1) ?? null;
      const fromManager = named === null ? nameByDealId.get(deal.id) ?? null : null;
      entries.push({
        id: deal.id,
        direction: buying ? "IN" : "OUT",
        // The save records a permanent move: whether it followed a loan is said in the note, not in `kind`,
        // because the fee on this row IS a fee and nothing about it is a wage.
        kind: "TRANSFER",
        playerName: nameByEaId.get(deal.playerId) ?? `Player ${deal.playerId}`,
        counterparty: named ?? fromManager,
        counterpartyFromManager: named === null && fromManager !== null,
        counterpartyTeamId,
        fee: deal.offeredFee,
        agreedOn,
        completedOn,
        pending: completedOn !== null && today !== null && completedOn > today,
        // Grouped by the season the move belongs to rather than the day the paperwork was signed: a deal
        // agreed in November and completed on 1 January is a January signing.
        season: seasonFromDay(completedOn ?? agreedOn),
        provenance: "SAVE",
        note: deal.isLoanBuy
          ? buying
            ? "Arrived by making a loan permanent, so the fee is not a clean price."
            : "The buyer made the loan permanent, so the fee is not a clean price."
          : deal.isExchangePlayer
            ? "Part of a swap, so the fee is not a clean price."
            : null,
        salary: null,
        wageSharePct: null,
        wagesPaid: null,
        editable: false,
      });
    }

    // The manager's own half.
    const typed = await db.select().from(transferInputs).where(eq(transferInputs.careerId, careerId));
    for (const row of typed) {
      const kind: DealKind = row.kind === "LOAN" ? "LOAN" : "TRANSFER";
      entries.push({
        id: row.id,
        direction: row.direction === "OUT" ? "OUT" : "IN",
        kind,
        playerName: row.playerName,
        counterparty: row.counterparty,
        counterpartyFromManager: true,
        counterpartyTeamId: null,
        fee: row.fee,
        agreedOn: row.movedOn,
        completedOn: null,
        pending: false,
        season: row.season ?? seasonFromDay(row.movedOn),
        provenance: "USER",
        note: row.note,
        salary: kind === "LOAN" ? row.salary ?? null : null,
        wageSharePct: kind === "LOAN" ? row.wageSharePct ?? null : null,
        wagesPaid: loanWagesPaid(kind, row.salary ?? null, row.wageSharePct ?? null),
        editable: true,
      });
    }

    entries.sort((left, right) => {
      // Newest move first, and the completion date is the move: a deal agreed in November that completes in
      // January belongs with January.
      const leftKey = left.completedOn ?? left.agreedOn ?? "";
      const rightKey = right.completedOn ?? right.agreedOn ?? "";
      if (leftKey === rightKey) return left.playerName.localeCompare(right.playerName);
      // Undated deals go last rather than being hidden.
      if (leftKey === "") return 1;
      if (rightKey === "") return -1;
      return rightKey.localeCompare(leftKey);
    });

    const spent = entries.filter((entry) => entry.direction === "IN").reduce((total, entry) => total + entry.fee, 0);
    const received = entries.filter((entry) => entry.direction === "OUT").reduce((total, entry) => total + entry.fee, 0);

    /**
     * Loan wages, and why they count as spend in BOTH directions.
     *
     * A share of a wage is money leaving the club whichever way the player moves: on the way in we pay part of
     * his wage to have him here, and on the way out we pay whatever part the borrowing club did not take on.
     * `loanWages` is reported separately so the manager can always see how much of the spend is wages and how
     * much is a fee.
     */
    const loanWages = entries.reduce((total, entry) => total + (entry.wagesPaid ?? 0), 0);
    const loansWithoutSplit = entries.filter(
      (entry) => entry.kind === "LOAN" && entry.wagesPaid === null
    ).length;
    const totalSpent = spent + loanWages;

    const bySeason = new Map<number | null, SeasonBalance>();
    for (const entry of entries) {
      const balance = bySeason.get(entry.season) ?? {
        season: entry.season,
        spent: 0,
        received: 0,
        wages: 0,
        net: 0,
        deals: 0,
      };
      if (entry.direction === "IN") balance.spent += entry.fee;
      else balance.received += entry.fee;
      // Wages sit inside `spent` so a season row adds up the same way the totals above it do.
      balance.wages += entry.wagesPaid ?? 0;
      balance.spent += entry.wagesPaid ?? 0;
      balance.net = balance.spent - balance.received;
      balance.deals += 1;
      bySeason.set(entry.season, balance);
    }
    const seasons = [...bySeason.values()].sort((left, right) => (right.season ?? 0) - (left.season ?? 0));

    const byPlayer = new Map<string, { paid: number | null; received: number | null }>();
    for (const entry of entries) {
      // A loan is not a purchase, so it never pairs with a sale to print a profit: a loan fee on the way in
      // and a fee on the way out would read as a 30 million pound gain on a player who was only borrowed.
      if (entry.kind === "LOAN") continue;
      const key = entry.playerName.toLowerCase();
      const line = byPlayer.get(key) ?? { paid: null, received: null };
      if (entry.direction === "IN") line.paid = (line.paid ?? 0) + entry.fee;
      else line.received = (line.received ?? 0) + entry.fee;
      byPlayer.set(key, line);
    }
    const profitLines: PlayerLedgerLine[] = [...byPlayer.entries()]
      .map(([key, line]) => ({
        playerName: entries.find((entry) => entry.playerName.toLowerCase() === key)?.playerName ?? key,
        paid: line.paid,
        received: line.received,
        profit: line.paid !== null && line.received !== null ? line.received - line.paid : null,
      }))
      .sort((left, right) => (right.profit ?? -Infinity) - (left.profit ?? -Infinity));

    return {
      careerId,
      clubName: career.clubName,
      clubId,
      entries,
      totals: { spent: totalSpent, received, net: totalSpent - received },
      feeTotals: { spent, received, net: spent - received },
      loanWages,
      loansWithoutSplit,
      seasons,
      profitLines,
      unvaluedExits: entries.filter((entry) => entry.direction === "OUT").length,
      empty: entries.length === 0,
    };
  }

  /** Adds one handwritten deal. Returns the rebuilt ledger so the screen never has to predict the totals. */
  async addEntry(request: TransferInputRequest): Promise<TransferLedger | null> {
    const id = `tx_${request.careerId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const kind: DealKind = request.kind === "LOAN" ? "LOAN" : "TRANSFER";
    const salary =
      kind === "LOAN" && typeof request.salary === "number" && Number.isFinite(request.salary)
        ? Math.max(0, Math.round(request.salary))
        : null;
    const wageSharePct =
      kind === "LOAN" && typeof request.wageSharePct === "number" && Number.isFinite(request.wageSharePct)
        ? Math.min(100, Math.max(0, Math.round(request.wageSharePct)))
        : null;
    await db.insert(transferInputs).values({
      id,
      careerId: request.careerId,
      direction: request.direction,
      kind,
      playerName: request.playerName.trim(),
      counterparty: request.counterparty?.trim() ?? null,
      fee: Math.max(0, Math.round(request.fee)),
      salary,
      wageSharePct,
      // A typed deal has one date unless the manager gives two: most moves he records are one event, and
      // asking a second time for a date the save itself would carry on a recorded deal would be noise.
      movedOn: request.completedOn ?? request.agreedOn ?? null,
      season: request.season ?? seasonFromDay(request.completedOn ?? request.agreedOn ?? null),
      note: request.note?.trim() ?? null,
    });
    return this.getLedger(request.careerId);
  }

  /**
   * Players a deal can be named against.
   *
   * The form used to ask for a name typed from memory, and a name typed from memory is how a player ends up on
   * the ledger under a spelling that appears nowhere else in the app. The save knows every professional it
   * contains, so the search offers exactly those: the manager's own squad first, because the player leaving is
   * usually one of his, then the rest of the world pool. Matching is on the name, inside whatever the save
   * resolved it to.
   */
  async searchPlayers(careerId: string, query: string, limit = 8): Promise<LedgerPlayerMatch[]> {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    const pattern = `%${trimmed}%`;

    const [squad, pool] = await Promise.all([
      db
        .select()
        .from(players)
        .where(and(eq(players.careerId, careerId), like(players.name, pattern))),
      db
        .select()
        .from(worldPlayers)
        .where(and(eq(worldPlayers.careerId, careerId), like(worldPlayers.name, pattern))),
    ]);

    const matches = new Map<number, LedgerPlayerMatch>();
    // The pool first and the squad second, so ours overwrite theirs rather than the other way round.
    for (const player of pool) {
      matches.set(player.eaPlayerId, {
        eaPlayerId: player.eaPlayerId,
        name: player.name,
        clubName: player.clubName,
        primaryPosition: player.primaryPosition,
        ours: false,
      });
    }
    for (const player of squad) {
      matches.set(player.eaPlayerId, {
        eaPlayerId: player.eaPlayerId,
        name: player.name,
        clubName: null,
        primaryPosition: player.primaryPosition,
        ours: true,
      });
    }

    return [...matches.values()]
      .sort((left, right) => {
        if (left.ours !== right.ours) return left.ours ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, limit);
  }

  /** Removes one handwritten deal. A save row is never deletable, which is why this keys on the typed table. */
  async removeEntry(careerId: string, id: string): Promise<TransferLedger | null> {
    await db
      .delete(transferInputs)
      .where(and(eq(transferInputs.careerId, careerId), eq(transferInputs.id, id)));
    return this.getLedger(careerId);
  }

  /**
   * Names a club the save cannot name.
   *
   * The honest alternative to this was a sentence explaining that the file holds no club outside the manager's
   * own division, which is true and useless: he knows who he sold the player to. Naming it once is the whole
   * interaction, and the row is badged as his so the ledger never implies the file said it. An empty name
   * clears it, which puts the row back to the save's own answer.
   */
  async nameCounterparty(
    careerId: string,
    dealId: string,
    name: string
  ): Promise<TransferLedger | null> {
    const clean = name.trim();
    if (clean === "") {
      await db
        .delete(transferCounterpartyNames)
        .where(
          and(
            eq(transferCounterpartyNames.careerId, careerId),
            eq(transferCounterpartyNames.dealId, dealId)
          )
        );
      return this.getLedger(careerId);
    }

    await db
      .insert(transferCounterpartyNames)
      .values({
        id: `cp_${careerId}_${dealId}`,
        careerId,
        dealId,
        name: clean,
        provenance: "USER",
      })
      .onConflictDoUpdate({
        target: [transferCounterpartyNames.careerId, transferCounterpartyNames.dealId],
        set: { name: clean },
      });

    return this.getLedger(careerId);
  }
}

/**
 * What this club pays of a loan's wage, or null when that cannot be known.
 *
 * A wage with no recorded split is deliberately NOT counted. Reading a blank split as "we pay all of it" would
 * put a figure in the totals that the manager never gave, and a ledger that guesses is worse than one that
 * reports the gap.
 */
function loanWagesPaid(kind: DealKind, salary: number | null, sharePct: number | null): number | null {
  if (kind !== "LOAN" || salary === null || sharePct === null) return null;
  return Math.round((salary * sharePct) / 100);
}

/**
 * The season year a saved deal belongs to, read off the day it was signed.
 *
 * The save records no season on a deal, so this is the app's reading rather than a stored fact: a move on or
 * after 1 July belongs to that year's season, anything earlier to the year before, which is how a European
 * season is spoken about. It exists so the season-by-season sheet has something to group on, and it is only
 * ever applied to dates the save actually carries.
 */
function seasonFromDay(day: string | null): number | null {
  if (day === null) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return month >= 7 ? year : year - 1;
}

/**
 * A saved deal date as an ISO day.
 *
 * The save writes these as YYYYMMDD (20260906 for 6 September 2026), which is the convention the parser
 * documents for this column - not the days-since-1582 form the birthdate column uses. A value the game never
 * wrote comes back as null rather than as a date in the year 1582.
 */
function dayFromSavedDate(saved: number | null): string | null {
  if (saved === null || saved <= 0) return null;
  const date = yyyymmddToDate(saved);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}
