/**
 * Builds a synthetic career save in the FIFA 18 on-disk layout, using FIFA 18's own datasheet.
 *
 *   npx tsx scripts/make-fifa18-fixture.ts [--out data/saves/Career20180108121239]
 *
 * WHY A SYNTHETIC SAVE EXISTS AT ALL. FIFA 17 to 21 can be supported from their datasheets, and the
 * app has no save from any of them to prove it against. Without a file of that generation the whole
 * claim rests on reading six XML files, and the first real save a manager opened would be the first
 * test. This writes a file in that layout, with that datasheet, so the reader is exercised end to end:
 * the container scan, the header variant, the descriptor grid, the bit-packed records, the datasheet's
 * field names, and the sync that turns all of it into a career.
 *
 * IT IS NOT EVIDENCE ABOUT THE GAME. Nothing here proves EA's FIFA 18 writes what this writes; that is
 * exactly why the registry records this game as `synthetic` and the README says so. What it proves is
 * that the PARSER is correct for that layout and that datasheet, which is the half that can be tested
 * without owning the game.
 *
 * The layout rules below are not invented: every one of them is read off `decodeRows` in
 * `feasibility-parser.ts`, which is the code that has to read this file back.
 *   - the block declares its own size at +8, and the reader asserts it equals the block length;
 *   - the directory sits at +24 as `[4-char id][u32 offset]` pairs, and `tablesStart` follows it;
 *   - a table header holds recordSize at +4, rowCount at +18 and fieldCount at +24, with the
 *     descriptor array at +36;
 *   - a descriptor is 16 bytes: type, bit offset, 4-char field id, bit depth;
 *   - INT fields are packed back to back from bit 0 of the record, LSB first, in descriptor order;
 *   - STRING and FLOAT fields are read at an ABSOLUTE byte offset, so they are placed after the
 *     integers on byte boundaries and the reader's running carry is reset around them;
 *   - an INT's stored value is `value - rangelow`, and the reader adds rangelow back.
 */
import fs from "fs";
import path from "path";
import { parseDbMeta, FeasibilitySaveParser, listSaveTableIds } from "../src/lib/parser/feasibility-parser";
import { chooseGameVersion, type MetaIndex } from "../src/lib/parser/game-versions";

const META_FILE = path.join(process.cwd(), "public", "parse-resources", "fifa_ng_db-meta-fifa18.xml");
const INDEX_FILE = path.join(process.cwd(), "public", "parse-resources", "meta-index.json");
const DEFAULT_OUT = path.join(process.cwd(), "data", "saves", "Career20180108121239");

/** The descriptor type codes, as `parseDbMeta` records them and `decodeRows` switches on. */
const TYPE_STRING = 0;
const TYPE_INT = 3;
const TYPE_FLOAT = 4;

const DB_HEADER = Uint8Array.from([0x44, 0x42, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
const DIR_AT = 24;
const COUNT_AT = 16;
const DESCRIPTOR_BASE = 36;
const DESCRIPTOR_STRIDE = 16;

interface FixtureTable {
  /** The datasheet's table name, which is what the parser reports. */
  name: string;
  rows: Record<string, number | string>[];
}

/** EA writes a birthdate as days since 1582-10-14, the start of the Gregorian day count. */
function eaDays(iso: string): number {
  const epoch = Date.UTC(1582, 9, 14);
  const at = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((at - epoch) / 86_400_000);
}

/** A writer over one record, so a value can be placed at any bit offset without shifting the rest. */
class BitWriter {
  readonly bytes: Uint8Array;

  constructor(readonly size: number) {
    this.bytes = new Uint8Array(size);
  }

  /** Writes `depth` bits of `value` starting at absolute bit `bitOffset`, least significant first. */
  setBits(bitOffset: number, depth: number, value: number): void {
    // Plain arithmetic rather than BigInt: the TypeScript target here predates BigInt literals, and
    // every depth in this format is at most 31, so a value always stays inside the safe integer range.
    let remaining = Math.max(0, Math.trunc(value));
    for (let bit = 0; bit < depth; bit++) {
      if (remaining % 2 === 1) {
        const at = bitOffset + bit;
        this.bytes[at >> 3] |= 1 << (at & 7);
      }
      remaining = Math.floor(remaining / 2);
    }
  }

  setText(bitOffset: number, length: number, text: string): void {
    const encoded = new TextEncoder().encode(text);
    const at = bitOffset >> 3;
    const copy = Math.min(encoded.length, length - 1);
    this.bytes.set(encoded.subarray(0, copy), at);
    // The reader stops at the first zero byte, so a shorter string is terminated by the field itself.
  }
}

function writeU32(target: Uint8Array, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >>> 8) & 0xff;
  target[at + 2] = (value >>> 16) & 0xff;
  target[at + 3] = (value >>> 24) & 0xff;
}

function writeU16(target: Uint8Array, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >>> 8) & 0xff;
}

interface BuiltTable {
  shortName: string;
  tableName: string;
  bytes: Uint8Array;
  rows: number;
  fieldCount: number;
}

/**
 * Lays one table out: header, descriptor grid, records.
 *
 * The field subset written is the datasheet's DECLARED ORDER filtered to the fields the fixture sets,
 * because the order is what the reader's running integer carry depends on. Reordering these fields
 * would not fail: it would decode every integer after the first one from the wrong bit, which is the
 * exact failure this fixture exists to catch.
 */
function buildTable(spec: FixtureTable, meta: ReturnType<typeof parseDbMeta>): BuiltTable {
  const perTable = meta.fieldNamesByTable.get(spec.name);
  if (!perTable) throw new Error(`${spec.name} is not declared in the FIFA 18 datasheet`);
  const shortOf = new Map<string, string>();
  for (const [short, human] of perTable) shortOf.set(human, short);

  const wanted = new Set<string>();
  for (const row of spec.rows) for (const key of Object.keys(row)) wanted.add(key);

  interface Placed {
    short: string;
    field: string;
    type: number;
    depth: number;
    bitOffset: number;
    rangeLow: number;
    textLength: number;
  }

  const ints: Placed[] = [];
  const others: Placed[] = [];

  // Declared order, not the order the fixture happens to list the fields in.
  for (const [short, human] of perTable) {
    if (!wanted.has(human)) continue;
    const key = `${spec.name}\u0000${short}`;
    const type = meta.fieldType.get(key);
    if (type === undefined) continue;
    const declaredDepth = meta.fieldDepth.get(key) ?? 0;
    if (type === TYPE_INT) {
      ints.push({
        short,
        field: human,
        type,
        depth: declaredDepth > 0 && declaredDepth <= 31 ? declaredDepth : 16,
        bitOffset: 0,
        rangeLow: meta.fieldRange.get(spec.name + human) ?? 0,
        textLength: 0,
      });
    } else if (type === TYPE_FLOAT) {
      others.push({ short, field: human, type, depth: 32, bitOffset: 0, rangeLow: 0, textLength: 4 });
    } else {
      const declaredBytes = Math.ceil(declaredDepth / 8);
      others.push({
        short,
        field: human,
        type,
        depth: 0,
        bitOffset: 0,
        rangeLow: 0,
        textLength: Math.min(Math.max(declaredBytes || 8, 8), 48),
      });
    }
  }

  // Integers first, packed from bit 0. This is the order the reader consumes them in.
  let cursorBits = 0;
  for (const field of ints) {
    field.bitOffset = cursorBits;
    cursorBits += field.depth;
  }
  cursorBits = Math.ceil(cursorBits / 8) * 8;
  for (const field of others) {
    field.bitOffset = cursorBits;
    cursorBits += (field.type === TYPE_STRING ? field.textLength : 4) * 8;
  }

  const recordSize = Math.max(1, Math.ceil(cursorBits / 8));
  const fields = [...ints, ...others];
  const data = new Uint8Array(recordSize * spec.rows.length);
  /**
   * Values the datasheet's own declared range cannot hold.
   *
   * Collected rather than thrown one at a time: a fixture is written against a schema nobody here
   * chose, so the useful output is the whole list of what does not fit, not the first line of it.
   */
  const outOfRange: string[] = [];

  spec.rows.forEach((row, index) => {
    const record = new BitWriter(recordSize);
    for (const field of fields) {
      const value = row[field.field];
      if (value === undefined) continue;
      if (field.type === TYPE_INT) {
        const raw = Number(value) - field.rangeLow;
        if (!Number.isFinite(raw) || raw < 0 || raw >= 2 ** field.depth) {
          outOfRange.push(
            `${spec.name}.${field.field} = ${value} does not fit depth ${field.depth} ` +
              `(rangelow ${field.rangeLow})`
          );
          continue;
        }
        record.setBits(field.bitOffset, field.depth, raw);
      } else if (field.type === TYPE_STRING) {
        record.setText(field.bitOffset, field.textLength, String(value));
      } else {
        record.setBits(field.bitOffset, 32, Number(value));
      }
    }
    data.set(record.bytes, index * recordSize);
  });

  if (outOfRange.length > 0) {
    throw new Error(`${spec.name}:\n    ${outOfRange.join("\n    ")}`);
  }

  const headerBytes = DESCRIPTOR_BASE + fields.length * DESCRIPTOR_STRIDE;
  const bytes = new Uint8Array(headerBytes + data.length);
  writeU32(bytes, 4, recordSize);
  writeU16(bytes, 18, spec.rows.length);
  bytes[24] = fields.length;
  fields.forEach((field, index) => {
    const at = DESCRIPTOR_BASE + index * DESCRIPTOR_STRIDE;
    writeU32(bytes, at, field.type);
    writeU32(bytes, at + 4, field.bitOffset);
    bytes.set(new TextEncoder().encode(field.short.padEnd(4).slice(0, 4)), at + 8);
    writeU32(bytes, at + 12, field.type === TYPE_STRING ? field.textLength * 8 : field.depth);
  });
  bytes.set(data, headerBytes);

  return { shortName: shortOf.get(spec.rows[0] ? Object.keys(spec.rows[0])[0] : "") ?? "", tableName: spec.name, bytes, rows: spec.rows.length, fieldCount: fields.length };
}

/** Assembles the whole database block from a list of tables. */
function buildBlock(tables: BuiltTable[], meta: ReturnType<typeof parseDbMeta>): Uint8Array {
  const shortOf = new Map<string, string>();
  for (const [short, human] of meta.tableNames) shortOf.set(human, short);

  const directoryBytes = tables.length * 8;
  const tablesStart = DIR_AT + directoryBytes + 4;
  let total = tablesStart;
  for (const table of tables) total += table.bytes.length;

  const block = new Uint8Array(total);
  block.set(DB_HEADER, 0);
  writeU32(block, DB_HEADER.length, total);
  writeU32(block, COUNT_AT, tables.length);

  let at = tablesStart;
  tables.forEach((table, index) => {
    const short = shortOf.get(table.tableName);
    if (!short) throw new Error(`${table.tableName} has no shortname in the datasheet`);
    const entry = DIR_AT + index * 8;
    block.set(new TextEncoder().encode(short), entry);
    writeU32(block, entry + 4, at - tablesStart);
    block.set(table.bytes, at);
    at += table.bytes.length;
  });

  return block;
}

// ---------------------------------------------------------------------------------------------
// The career this fixture describes
// ---------------------------------------------------------------------------------------------
//
// Wigan Athletic under a plainly invented manager, with the same shape as the reference career: a
// past season that finished and one in progress, a small squad, two deals, and one dated event so the
// in-game date has a source. The club id is deliberately NOT the live career's 1917: this fixture is
// synced during verification, and a colliding id would overwrite the real career instead of creating
// an unambiguous new one.

const FIXTURE_CLUB = 7788;
const PRESTON = 1801;
const MONACO = 69;
const CHAMPIONSHIP = 14;
const LEAGUE_ONE = 60;

const TABLES: FixtureTable[] = [
  {
    name: "leagues",
    rows: [
      { leagueid: CHAMPIONSHIP, leaguename: "England Championship (2)", level: 2, countryid: 14 },
      { leagueid: LEAGUE_ONE, leaguename: "England League One (3)", level: 3, countryid: 14 },
    ],
  },
  {
    name: "teams",
    rows: [
      { teamid: FIXTURE_CLUB, teamname: "Fixture Athletic" },
      { teamid: PRESTON, teamname: "Preston North End" },
      { teamid: MONACO, teamname: "AS Monaco" },
    ],
  },
  {
    name: "leagueteamlinks",
    rows: [
      { teamid: FIXTURE_CLUB, leagueid: CHAMPIONSHIP },
      { teamid: PRESTON, leagueid: CHAMPIONSHIP },
    ],
  },
  {
    name: "career_users",
    rows: [
      {
        firstname: "Fixture",
        surname: "Manager",
        seasoncount: 3,
        leagueid: CHAMPIONSHIP,
        clubteamid: FIXTURE_CLUB,
      },
    ],
  },
  {
    name: "career_managerinfo",
    rows: [{ clubteamid: FIXTURE_CLUB, managerid: 9001, firstname: "Fixture", surname: "Manager" }],
  },
  {
    // Two tables that exist in this datasheet and NOT in the FC-era one, which is what a real FIFA 18
    // career save looks like as well: 27 of the 146 ids this datasheet declares are absent from the
    // FC 26 datasheet, and several of them are career tables (career_trophies, career_transferoffer,
    // career_loanbuy, career_boardoutcomes, career_news, career_blacklist). Including them is not
    // decoration. A save carrying ONLY tables both datasheets know cannot be told apart by table set
    // at all, and identification would fall through to the newer one and read every field from the
    // wrong offsets.
    name: "career_trophies",
    rows: [
      { season: 1, flags: 1, userid: 1 },
      { season: 2, flags: 1, userid: 1 },
    ],
  },
  {
    name: "career_transferoffer",
    rows: [
      {
        offerid: 1,
        playerid: 9003,
        teamid: MONACO,
        offerteamid: FIXTURE_CLUB,
        offeredfee: 2_050_000,
        offeredwage: 18_000,
        date: 20261105,
        result: 1,
        stage: 3,
        isloan: 0,
      },
    ],
  },
  {
    name: "career_managerhistory",
    rows: [
      {
        season: 1,
        leagueid: LEAGUE_ONE,
        games_played: 46,
        wins: 24,
        draws: 10,
        losses: 12,
        points: 82,
        goals_for: 70,
        goals_against: 48,
        tableposition: 1,
        leaguetrophies: 1,
        leagueobjective: 4,
        bigbuyamount: 750_000,
        bigbuyplayername: "Square One",
        bigsellamount: 1_200_000,
        bigsellplayername: "First Sale",
      },
      {
        season: 2,
        leagueid: CHAMPIONSHIP,
        games_played: 46,
        wins: 19,
        draws: 12,
        losses: 15,
        points: 69,
        goals_for: 63,
        goals_against: 55,
        tableposition: 9,
        leaguetrophies: 0,
        leagueobjective: 7,
        bigbuyamount: 1_500_000,
        bigbuyplayername: "Second Buy",
        bigsellamount: 2_000_000,
        bigsellplayername: "Second Sale",
      },
      {
        // In progress: a table position of 0 mid-season is the save's own "not finished" signal.
        season: 3,
        leagueid: CHAMPIONSHIP,
        games_played: 17,
        wins: 8,
        draws: 4,
        losses: 5,
        points: 28,
        goals_for: 26,
        goals_against: 21,
        tableposition: 0,
        leaguetrophies: 0,
        bigbuyamount: 500_000,
        bigbuyplayername: "Third Buy",
        bigsellamount: 2_050_000,
        bigsellplayername: "M. Efekele",
      },
    ],
  },
  {
    // REAL EA player ids, taken from the reference name table, because a name is resolved BY id
    // through that table and a synthetic id would come back as `#9003`. Using real ones is what makes
    // this fixture prove the whole chain for a FIFA 18 save: players row, name table lookup, squad
    // row. The names below are what `playernames_fc26.csv` holds for these ids.
    name: "players",
    rows: [
      {
        playerid: 19541,
        firstname: "Glenn",
        surname: "Morris",
        commonname: "G. Morris",
        overallrating: 71,
        potential: 74,
        preferredposition1: 0,
        birthdate: eaDays("1996-03-14"),
        // 1 is right and 2 is left: the datasheet declares this field with `rangelow="1"`, so a
        // zero here is not "no preference", it is outside the field's own range.
        preferredfoot: 1,
        weakfootabilitytypecode: 3,
        skillmoves: 1,
        height: 188,
        weight: 82,
        internationalrep: 1,
        nationality: 14,
      },
      {
        playerid: 52679,
        firstname: "Joseph",
        surname: "Murphy",
        commonname: "J. Murphy",
        overallrating: 69,
        potential: 73,
        preferredposition1: 5,
        birthdate: eaDays("1998-07-02"),
        preferredfoot: 2,
        weakfootabilitytypecode: 2,
        skillmoves: 1,
        height: 185,
        weight: 80,
        internationalrep: 1,
        nationality: 14,
      },
      {
        playerid: 69957,
        firstname: "Juan Manuel",
        surname: "Elordi",
        commonname: "J. Elordi",
        overallrating: 74,
        potential: 80,
        preferredposition1: 25,
        birthdate: eaDays("1999-11-21"),
        preferredfoot: 2,
        weakfootabilitytypecode: 4,
        skillmoves: 3,
        height: 180,
        weight: 76,
        internationalrep: 2,
        nationality: 18,
      },
    ],
  },
  {
    name: "teamplayerlinks",
    rows: [
      { playerid: 19541, teamid: FIXTURE_CLUB, jerseynumber: 1, form: 4, injury: 0 },
      { playerid: 52679, teamid: FIXTURE_CLUB, jerseynumber: 5, form: 3, injury: 0 },
      { playerid: 69957, teamid: FIXTURE_CLUB, jerseynumber: 9, form: 5, injury: 0 },
    ],
  },
  {
    name: "career_playercontract",
    // The FIFA 18 name for the field that dates a contract. FC-era saves call it
    // `last_status_change_date`; this datasheet calls it `contract_status_change_date` and gives it a
    // different id, which is why the parser accepts both. `contractvaliduntil` does NOT exist in this
    // datasheet at all, so a contract's end date cannot come from here in FIFA 18.
    rows: [
      { playerid: 19541, wage: 12_000, contract_status_change_date: 20261108 },
      { playerid: 52679, wage: 9_500, contract_status_change_date: 20261108 },
      { playerid: 69957, wage: 18_000, contract_status_change_date: 20261108 },
    ],
  },
  {
    // The deal-direction case, in FIFA 18 form: `teamid` is the club the player is REGISTERED to (the
    // seller) and `offerteamid` is the club that made the offer (the buyer). An incoming signing, so
    // the ledger should read "from AS Monaco" and the figure is a fee WE paid.
    //
    // `signeddate` is 0 and not a date, and that is the FIFA 18 datasheet's own doing: the field with
    // id `KhTp` is declared `depth="8" rangehigh="255"` there, where the FC 26 datasheet declares the
    // same id as a 19-bit `20601231`-ranged date. A fixture has to be consistent with the datasheet it
    // claims, so this file cannot carry a real agreed date, and the ledger's date for this deal will be
    // absent. Worth knowing for a real FIFA 18 save too: whether EA changed the field or the community
    // datasheet mis-declares it is not settled here, and either way the honest answer is that this
    // build does not read an agreed date out of that game.
    name: "career_presignedcontract",
    rows: [
      {
        playerid: 69957,
        teamid: MONACO,
        offerteamid: FIXTURE_CLUB,
        offeredfee: 2_050_000,
        offeredwage: 18_000,
        signeddate: 0,
        completedate: 20270101,
        isloanbuy: 0,
        isexchangedplayer: 0,
      },
    ],
  },
  {
    name: "persistent_events",
    // `eventid` is a 6-bit enum with a declared range of 0-50, in the FC 26 datasheet as well as this
    // one: the event log is a small closed list of event KINDS, not a per-row sequence. A large id
    // here is out of the field's range, not merely unusual.
    rows: [{ eventid: 3, eventdate: 20261108, team1id: FIXTURE_CLUB, team2id: PRESTON, player1id: 69957 }],
  },
  {
    name: "career_playermatchratinghistory",
    rows: [
      { playerid: 19541, rating: 7, date: 20261101 },
      { playerid: 52679, rating: 6, date: 20261101 },
      { playerid: 69957, rating: 9, date: 20261101 },
    ],
  },
];

// ---------------------------------------------------------------------------------------------

const outAt = (() => {
  const flag = process.argv.indexOf("--out");
  return flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1] : DEFAULT_OUT;
})();

const meta = parseDbMeta(fs.readFileSync(META_FILE, "utf8"));
const built = TABLES.map((table) => buildTable(table, meta));
const block = buildBlock(built, meta);

fs.mkdirSync(path.dirname(outAt), { recursive: true });
fs.writeFileSync(outAt, block);

console.log(`wrote ${outAt} (${(block.length / 1024).toFixed(1)} KB, FIFA 18 layout)`);
for (const table of built) {
  console.log(`  ${table.tableName.padEnd(32)} ${String(table.rows).padStart(3)} rows, ${table.fieldCount} fields`);
}

// ---- Self-check: identify it, read it back, and compare every value -------------------------
// Wrapped rather than top-level await: this script is built as CommonJS.
void (async () => {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as MetaIndex;
  const bytes = new Uint8Array(fs.readFileSync(outAt));

  const choice = chooseGameVersion(listSaveTableIds(bytes), index);
  if (!choice) throw new Error("the fixture could not be identified at all");
  console.log(
    `\nidentified as ${choice.descriptor.label} (${choice.matched}/${choice.total} tables, ` +
      `confident ${choice.confident})`
  );
  if (choice.descriptor.id !== "FIFA18") {
    throw new Error(`the fixture identified as ${choice.descriptor.id}, not FIFA18`);
  }

  const parser = new FeasibilitySaveParser({
    metaXml: fs.readFileSync(META_FILE, "utf8"),
    // The same reference data the app uses, so the fixture exercises the real name and nation lookups.
    nameTableCsv: fs.readFileSync(
      path.join(process.cwd(), "public", "parse-resources", "playernames_fc26.csv"),
      "utf8"
    ),
    nationTableCsv: fs.readFileSync(
      path.join(process.cwd(), "public", "parse-resources", "nations_fc26.csv"),
      "utf8"
    ),
    gameVersion: "FIFA18",
    rowLimit: 500,
  });
  const parsed = await parser.parse(
    {
      id: "fixture",
      filePath: outAt,
      fileName: path.basename(outAt),
      lastModified: new Date(),
      fileSizeBytes: bytes.length,
    },
    bytes
  );

  console.log(`gameVersion reported: ${parsed.saveMetadata.gameVersion}`);
  let failures = 0;
  const expect = (label: string, actual: unknown, wanted: unknown) => {
    const ok = actual === wanted;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}` +
        (ok ? "" : ` (wanted ${JSON.stringify(wanted)})`)
    );
  };

  expect("manager name", parsed.saveMetadata.managerName, "Fixture Manager");
  expect("club name", parsed.saveMetadata.clubName, "Fixture Athletic");
  expect("in-game date", parsed.saveMetadata.currentDate, "2026-11-08");
  expect("season year", parsed.saveMetadata.seasonYear, 2026);

  const history = parsed.seasonHistory;
  expect("season rows", history.length, 3);
  expect("season 1 points", history[0]?.points, 82);
  expect("season 2 table position", history[1]?.tablePosition, 9);
  expect("season 3 league id", history[2]?.leagueId, CHAMPIONSHIP);
  expect(
    "championship name",
    parsed.leagueDirectory.find((league) => league.leagueId === CHAMPIONSHIP)?.name,
    "England Championship (2)"
  );

  const squad = parsed.squadSample;
  expect("squad size", squad.length, 3);
  const striker = squad.find((player) => player.playerId === 69957);
  expect("striker overall", striker?.overall, 74);
  // Resolved through the reference name table by EA id, which is the only way a name can be known:
  // the save itself carries no name for a player, and the fixture's ids are real ones.
  expect("striker name", striker?.name, "J. Elordi");
  expect("striker name source", striker?.nameSource, "imported-name-table");

  const deals = parsed.presignedDeals;
  expect("presigned deals", deals.length, 1);
  expect("deal selling team (the club he is registered to)", deals[0]?.sellingTeamId, MONACO);
  expect("deal buying team (the club that offered)", deals[0]?.buyingTeamId, FIXTURE_CLUB);
  expect("deal fee", deals[0]?.offeredFee, 2_050_000);

  // The in-game date comes from a small list of dated tables, and a fixture is the only place where
  // the winning source can be named, so report it when the date is wrong.
  if (parsed.saveMetadata.currentDate !== "2026-11-08") {
    for (const fact of parsed.facts.filter((entry) => /date/i.test(entry.label))) {
      console.log(`    date fact: ${fact.label} = ${JSON.stringify(fact.value)} from ${fact.source}`);
    }
    console.log(
      `    raw: ${JSON.stringify({
        persistent_events: parsed.extractedTables["persistent_events"],
        ratings: parsed.extractedTables["career_playermatchratinghistory"],
      }).slice(0, 400)}`
    );
  }

  console.log(
    failures === 0
      ? "\nfixture round-trip: every value matched"
      : `\nfixture round-trip: ${failures} value(s) did not match`
  );
  process.exit(failures === 0 ? 0 : 1);
})();
