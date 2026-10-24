# FC27 save decoding: findings

What was learned while making FC27 career saves readable, and what is still open. This folder is an
archive: nothing here is imported by the app, and the app does not depend on it.

Only findings that the surviving code still proves are stated as fact below. A few earlier conclusions
were reached from probe scripts that are no longer in this repo, and they are listed separately in
"Findings not retained here" rather than repeated as if they had been re-checked.

## The container

An FC27 career save is an `FBCHUNKS` envelope, not a bare run of `DB\0\x08` database blocks. The
envelope carries a magic, a version, size fields, a name and a save type, followed by `BNRY` chunk
records.

A byte scan of the whole file is wrong for two reasons:

1. The `DB` signature also appears inside payload and metadata regions, so a naive scan finds databases
   that are not databases.
2. The FC27 career block and squads block **overlap**: the career block's declared size covers the start
   of the squads block. Advancing by the declared size silently steps over the second database. The scan
   therefore steps past the signature itself.

Code: `src/lib/parser/feasibility-parser.ts` (`inspectDatabaseBlocks`), `scripts/extract-fc27-container.ts`.

## Block headers: two arrangements

A `fifa_ng_db` block header puts the table count and the directory at one of two places.

| Arrangement | Table count at | Directory at | Seen in |
|---|---|---|---|
| `count@+16 dir@+24` | +16 | +24 | FC25, FC26, the FC27 squads block |
| `count@+12 dir@+20` | +12 | +20 | The FC27 career block |

The FC27 career block omits the 4-byte field at +12, which shifts the count and the directory by four
bytes. Both arrangements are tried and the one whose directory actually parses wins. Nothing is assumed
from an offset alone.

## Directories: shaped, and addressable

In FC25 and FC26 a directory offset lands on a table header, so record size, row count and field count
are all read at a computed address. **In the FC27 career block it does not.** Its offsets point into
record data, because tables are packed with per-table descriptor strides.

A directory is still recognisable on its own: every id printable, every offset non-decreasing, every
offset inside the block. That shape test is what admits the career block at all. `addressable` records
whether any entry actually landed on a plausible header; `shaped` is the weaker test that keeps the
block.

## Field descriptors: three layouts and their widths

| Layout | Entry width | Array starts at | Id at | Depth at | Type stored |
|---|---|---|---|---|---|
| `classic16` | 16 bytes | header + 36 | +8 | +12 (u32) | yes, u32 at +0 |
| `compact9` | 9 bytes | header + 44 | +0 | +4 (u8) | no, from the datasheet |
| `fc27Long16` | 16 bytes | header + 24 | +0 | +4 (u32) | no, from the datasheet |

`fc27Long16` exists because FC27 career-side tables put the short name first and need a 32-bit depth:
string depths reach 640 bits, which does not fit the compact one-byte field.

Inside a single array, entry lengths of **9, 8, 16 and 12** bytes have all been observed
(`DESCRIPTOR_STEPS`). A header sits at most 64 bytes before the first descriptor
(`HEADER_SEARCH_BACK`).

## Finding a table rather than computing it

Because the directory cannot be trusted for the career block, a table is located by its descriptor run:

1. Scan the payload for runs of printable four-character field ids.
2. Attribute a run to a table by how many of its ids the datasheet declares for that table.
3. Take the header from the bytes immediately before the run, and accept it only when its field-count
   byte equals what the descriptor start produces and its record size and row count are physically
   possible.
4. Reject a candidate that fails. A rejected candidate is never decoded, so a wrong header cannot
   silently produce rows.

Step 2 deliberately does not require the datasheet's field count to equal the run length. The bundled
datasheet is older than the save: it declares 137 `players` fields where FC27 stores 110. Exact-count
matching would reject every array. The run length is authoritative for the field count, and the
datasheet is used only to decide which table a run belongs to.

Soft scoring then ranks candidates on lead-field proximity, capacity sanity, descriptor continuity and
a foreign-key oracle (`teamid` samples resolving against the decoded `teams` table).

## Variable-length compacted rows

The reference FC27 save contains a minority of compact entries that are **8 bytes rather than 9**. An
8-byte step is taken only when the 9-byte step would not put a printable id on the next boundary and the
8-byte step does put a datasheet-known id there. Every recovery is reported, never silent.

A compact descriptor whose encoded depth contradicts the datasheet decodes as an unknown type: a
disagreement yields a null value and a warning rather than a plausible-looking wrong number.

## When the datasheet does not fit

`readTableHeaders` reports `unknownTables`, the tables named in the save that the datasheet does not
describe. `scripts/probe-schema-drift.ts` prints those warnings and the drift counts, and its
`--cripple` mode is the positive test: it renames a known field in a **copy** of the datasheet, parses
with that copy, and shows the warning firing. The repo's reference datasheet is never modified.

`scripts/probe-b27-career-tables.ts` reports, per block, whether headers were located at all, which
target tables were named, and what record size and records start each resolved to. Existence and
resolution are separate outcomes and it prints them separately.

## Findings not retained here

The earlier working notes also recorded these. The probe scripts that produced them are not in this
repo any more, so they are **not** restated as fact and no offset from them is used:

- a one-byte header displacement and a "normalise" repair for it;
- rules for a vanilla (non-career) database, including a 40-byte header, the descriptor entry layout,
  and rows beginning five bytes before the formula.

To re-derive either, start from `diff-fc27-saves.ts`, which exists precisely to separate structure from
content by comparing two careers: the team-id oracle gives the true record size from club-id spacing,
the lead-field preamble differential scores a candidate header across two saves, and directory delta
math yields an implied record width that `teams` validates at 188 bytes.

Do not add an offset from memory to the parser. Every layout the parser uses is either proven by a
descriptor walk or reported with a warning.

## What is still unsolved

- **Record sizes for many FC27 tables.** The single-save parser cannot derive `recordSize` and
  `recordsStart` for most career-side tables from the directory alone, which is why localisation exists.
  Localisation finds a table; it does not guarantee every table is found.
- **A datasheet that matches FC27.** The bundled one predates it, so field counts differ and unknown
  tables can only be reported, not decoded.
- **The variable-length case is a heuristic.** 8-byte entries are recovered by a boundary test, not by a
  rule that explains when EA writes them.

## Tools that still exist

| Script | What it does |
|---|---|
| `scripts/extract-fc27-container.ts` | Unwraps `FBCHUNKS`, inventories chunks, validates every embedded database structurally, writes the payload stream |
| `scripts/diff-fc27-saves.ts` | Three independent probes over two saves: team-id stride, preamble differential, directory delta math |
| `scripts/probe-b27-career-tables.ts` | Per block: headers located, tables named, record size and start |
| `scripts/probe-schema-drift.ts` | Datasheet drift counts, with a crippled-copy positive test |
