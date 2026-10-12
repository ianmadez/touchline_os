/**
 * Which EA football games this parser can read, and what each one's datasheet describes.
 *
 * THE SAVE GENERATION IS ONE FAMILY, THE DATASHEET IS NOT. A career save written by FIFA 17 through
 * EA SPORTS FC is the same container with the same header layout and the same 16-byte field
 * descriptors; what changes between titles is the SCHEMA. Field `biWl` is `career_managerinfo.userid`
 * in one game and something else, or absent, in another, and only that game's own `fifa_ng_db-meta.xml`
 * can say which. So support for a title is support for a DATASHEET plus a way to tell which one a save
 * needs, not a different parser.
 *
 * WHERE THE DATASHEETS COME FROM. `fifa_ng_db-meta.xml` is EA's own t3db description of the database
 * and is shipped with each game; it is not published by EA in a documented form, so every one of these
 * files came from a community source. The FIFA 17-21 set is taken from
 * `sammygriffiths/fifa-career-save-parser`, whose package metadata declares `"license": "ISC"` and
 * whose description is "Parse PC career mode save files from FIFA 17 - 21". Provenance, and the
 * licensing position of every file in `public/parse-resources`, is recorded in the README beside them.
 *
 * WHAT A DATASHEET MISSING A TABLE ACTUALLY COSTS. This is not a technical footnote: the difference
 * between FIFA 18 and FIFA 17 is the difference between a transfer ledger built from the save and one
 * built from what the manager types in himself, so it belongs in the copy rather than in a log line.
 * `missing` carries that in the manager's words, and it is the single source for the parser's warnings,
 * the Settings screen and the compatibility table in the README.
 */
import type { GameVersion } from "./interface";

/** One thing a game's datasheet cannot describe, and what the manager loses because of it. */
export interface MissingCapability {
  /** The save table this game does not record. */
  table: string;
  /** The feature that reads it, named the way the screen names it. */
  feature: string;
  /** What the manager will actually notice. */
  consequence: string;
}

/**
 * How far a game's support has been taken.
 *
 * `real` means a save produced by that game has been read end to end and the values checked.
 * `synthetic` means the format and the schema have been exercised against a save built to that game's
 * layout, which proves the reader and the datasheet but NOT that the game writes what we expect.
 * `unproven` means neither. The distinction exists because "we support FIFA 18" is a claim about a
 * game, and only the first state is evidence for it.
 */
export type SupportLevel = "real" | "synthetic" | "unproven";

export interface GameMetaDescriptor {
  id: GameVersion;
  /** What the game is called on the box, and in the copy. */
  label: string;
  /** The datasheet's file name inside `public/parse-resources/`. */
  metaFile: string;
  /**
   * The folder this game writes its PC saves to, under Documents, or null when unknown.
   *
   * Used by the desktop scan and by the entry screen's copy. Deliberately absent for FIFA 16 and
   * earlier: those saves are not `fifa_ng_db` containers at all, so offering their folder would offer
   * a save the parser cannot read.
   */
  saveFolder: string | null;
  support: SupportLevel;
  missing: MissingCapability[];
}

/** The datasheet the FC-era games are read with. See the README beside it for its own provenance. */
const FC_META = "fifa_ng_db-meta.xml";

/**
 * Every game this build can read, NEWEST FIRST.
 *
 * The order is the tie-break when two datasheets explain a save equally well, and it is also the order
 * the compatibility table is written in. FC 26 leads because it is the datasheet the app has always
 * used and the one the reference career was read with: a save that resolves against it must keep
 * resolving against it, whatever else is added here.
 */
export const GAME_METAS: GameMetaDescriptor[] = [
  {
    id: "FC26",
    label: "EA SPORTS FC 26",
    metaFile: FC_META,
    saveFolder: "FC 26",
    support: "real",
    missing: [],
  },
  {
    id: "FC25",
    label: "EA SPORTS FC 25",
    metaFile: FC_META,
    saveFolder: "FC 25",
    support: "real",
    // FC 25 saves are read with the FC 26 datasheet, which is what this app has always done: the
    // career tables the desk reads are shared, and the differences sit in tables nothing here touches.
    missing: [],
  },
  {
    id: "FC27",
    label: "EA SPORTS FC 27",
    metaFile: FC_META,
    saveFolder: "FC 27",
    support: "real",
    // FC 27 packs its descriptors differently, which the parser handles by layout rather than by
    // datasheet, so the same meta reads it.
    missing: [],
  },
  {
    id: "FIFA21",
    label: "FIFA 21",
    metaFile: "fifa_ng_db-meta-fifa21.xml",
    saveFolder: "FIFA 21",
    support: "synthetic",
    missing: [],
  },
  {
    id: "FIFA20",
    label: "FIFA 20",
    metaFile: "fifa_ng_db-meta-fifa20.xml",
    saveFolder: "FIFA 20",
    support: "synthetic",
    missing: [],
  },
  {
    id: "FIFA19",
    label: "FIFA 19",
    metaFile: "fifa_ng_db-meta-fifa19.xml",
    saveFolder: "FIFA 19",
    support: "synthetic",
    missing: [],
  },
  {
    id: "FIFA18",
    label: "FIFA 18",
    metaFile: "fifa_ng_db-meta-fifa18.xml",
    saveFolder: "FIFA 18",
    support: "synthetic",
    missing: [],
  },
  {
    id: "FIFA17",
    label: "FIFA 17",
    metaFile: "fifa_ng_db-meta-fifa17.xml",
    saveFolder: "FIFA 17",
    support: "synthetic",
    missing: [
      {
        table: "career_presignedcontract",
        feature: "Transfer ledger",
        consequence:
          "FIFA 17 does not record agreed transfers, so the ledger can only show deals you enter yourself, and the value estimate has no comparable fees to work from.",
      },
    ],
  },
];

/** The datasheet a save is read with when nothing identifies it better. */
export const DEFAULT_GAME_META = GAME_METAS[0];

export function gameMetaFor(id: GameVersion): GameMetaDescriptor {
  return GAME_METAS.find((meta) => meta.id === id) ?? DEFAULT_GAME_META;
}

// ---------------------------------------------------------------------------------------------
// Identifying which game wrote a save
// ---------------------------------------------------------------------------------------------

/**
 * The measured half of the registry: for each game, the table ids its datasheet declares.
 *
 * Generated by `npm run meta:index` from the datasheets themselves rather than written by hand, so it
 * cannot drift from them. It is what makes identification cheap: the save's own directory gives a list
 * of table ids with no datasheet at all, and comparing that list against these sets needs a few
 * kilobytes of JSON rather than six XML files.
 */
export interface MetaIndexEntry {
  id: GameVersion;
  tableIds: string[];
}

export interface MetaIndex {
  versions: MetaIndexEntry[];
}

/** The index file, inside `public/parse-resources/`. */
export const META_INDEX_FILE = "meta-index.json";

/**
 * Below this share of a save's own tables being explained, a datasheet is not accepted.
 *
 * A wrong datasheet does not fail loudly: it names tables confidently and decodes their fields from
 * the wrong bit offsets, which produces plausible numbers that are not in the save. Refusing to pick
 * is the honest outcome, and the caller then falls back to the default datasheet and says so.
 */
export const MIN_VERSION_MATCH = 0.6;

export interface VersionChoice {
  descriptor: GameMetaDescriptor;
  /** Share of the save's own table ids that this datasheet declares. */
  score: number;
  matched: number;
  total: number;
  /** False when even the best candidate was below `MIN_VERSION_MATCH`. */
  confident: boolean;
  /** Every candidate's score, best first, so a misidentification can be diagnosed. */
  ranking: { id: GameVersion; score: number; matched: number }[];
}

/**
 * Picks the datasheet that explains most of a save's own table directory.
 *
 * Scored in ONE direction on purpose: how much of the SAVE this datasheet accounts for. Scoring by
 * "how much of the datasheet is used" would favour the smallest datasheet, and a save always uses a
 * fraction of any datasheet, so the two are not interchangeable.
 *
 * A tie goes to the newer game, which is what `GAME_METAS` order is for. `FC25`, `FC26` and `FC27`
 * deliberately share one datasheet, so they cannot tie with each other in a way that matters: whichever
 * wins, the same meta is loaded, and the reported id is then settled by the save's own layout.
 */
export function chooseGameVersion(
  tableIds: readonly string[],
  index: MetaIndex,
  descriptors: GameMetaDescriptor[] = GAME_METAS
): VersionChoice | null {
  const present = new Set(tableIds);
  if (present.size === 0) return null;

  const ranking = index.versions
    .map((entry) => {
      const known = new Set(entry.tableIds);
      let matched = 0;
      for (const id of present) if (known.has(id)) matched += 1;
      return { id: entry.id, score: matched / present.size, matched };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return orderOf(left.id, descriptors) - orderOf(right.id, descriptors);
    });

  const best = ranking[0];
  if (!best) return null;

  return {
    descriptor: gameMetaFor(best.id),
    score: best.score,
    matched: best.matched,
    total: present.size,
    confident: best.score >= MIN_VERSION_MATCH,
    ranking,
  };
}

function orderOf(id: GameVersion, descriptors: GameMetaDescriptor[]): number {
  const at = descriptors.findIndex((meta) => meta.id === id);
  return at < 0 ? descriptors.length : at;
}

/**
 * Where a runtime gets the index and the datasheets from.
 *
 * The two ports differ only here: the desktop build reads these off disk and the browser build fetches
 * them from the static export. Everything below is shared, so a save is identified the same way in
 * both, which is the point: an identification that only worked in one port would be worse than none.
 */
export interface MetaSource {
  index(): Promise<MetaIndex | null> | MetaIndex | null;
  /** The datasheet's XML for one game, or null when this build cannot supply it. */
  meta(id: GameVersion): Promise<string | null> | string | null;
}

export interface GameIdentification {
  descriptor: GameMetaDescriptor;
  /** The datasheet to parse with, or null when even the fallback could not be loaded. */
  metaXml: string | null;
  /** Null when the save declared no table ids at all. */
  choice: VersionChoice | null;
  /**
   * Anything the manager should be told, in his words.
   *
   * Only problems appear here. A clean identification is not a warning: the report already carries
   * `gameVersion` and `metaSource`, and a log line saying "identified FIFA 18 correctly" is the kind
   * of noise that trains people to ignore the one that matters.
   */
  warnings: string[];
}

/** How many runners-up to name when identification is unsure. */
const RANKING_IN_WARNING = 3;

/**
 * Decides which datasheet a save should be read with, and loads it.
 *
 * The BEST candidate always wins, even when nothing is confident. Falling back to the default
 * datasheet on a low score would be the old behaviour dressed up: a save from a game this build does
 * not know is still read better by the closest datasheet it *does* know than by a fixed one, and the
 * only thing a threshold is good for is saying so out loud.
 */
export async function identifyGame(
  tableIds: readonly string[],
  source: MetaSource
): Promise<GameIdentification> {
  const warnings: string[] = [];
  const index = await source.index();

  if (!index || index.versions.length === 0) {
    const metaXml = await source.meta(DEFAULT_GAME_META.id);
    warnings.push(
      `Could not read the datasheet index, so this save was read with the ${DEFAULT_GAME_META.label} ` +
        `datasheet. Table and field names may be wrong if it came from another game.`
    );
    return { descriptor: DEFAULT_GAME_META, metaXml, choice: null, warnings };
  }

  const choice = chooseGameVersion(tableIds, index);
  if (!choice) {
    const metaXml = await source.meta(DEFAULT_GAME_META.id);
    warnings.push(
      "This save declares no table directory, so there is nothing to identify which game wrote it. " +
        `It was read with the ${DEFAULT_GAME_META.label} datasheet.`
    );
    return { descriptor: DEFAULT_GAME_META, metaXml, choice: null, warnings };
  }

  const metaXml = await source.meta(choice.descriptor.id);
  if (!metaXml) {
    const fallback = await source.meta(DEFAULT_GAME_META.id);
    warnings.push(
      `This save identifies as ${choice.descriptor.label} (${choice.matched} of ${choice.total} tables ` +
        `matched) but its datasheet could not be loaded, so it was read with the ` +
        `${DEFAULT_GAME_META.label} datasheet instead.`
    );
    return { descriptor: DEFAULT_GAME_META, metaXml: fallback, choice, warnings };
  }

  if (!choice.confident) {
    const runnersUp = choice.ranking
      .slice(0, RANKING_IN_WARNING)
      .map((entry) => `${gameMetaFor(entry.id).label} (${entry.matched} of ${choice.total})`)
      .join(", ");
    warnings.push(
      `This save does not clearly belong to any game this build knows: the best match, ` +
        `${choice.descriptor.label}, explains only ${choice.matched} of its ${choice.total} tables. ` +
        `It was read with that datasheet, and these are the candidates it was chosen from: ${runnersUp}. ` +
        `Values may be wrong.`
    );
  }

  for (const capability of missingCapabilities(choice.descriptor, index)) {
    warnings.push(
      `${choice.descriptor.label} does not record ${capability.table}, so ${capability.feature} is ` +
        `unavailable: ${capability.consequence}`
    );
  }

  return { descriptor: choice.descriptor, metaXml, choice, warnings };
}

/**
 * The datasheets that cannot describe this save, in the manager's words.
 *
 * Read off the index rather than from the save: "FIFA 17 has no transfer deals" is a fact about the
 * game, and it should be said once, whether or not the manager happens to have signed anybody yet.
 */
export function missingCapabilities(
  descriptor: GameMetaDescriptor,
  index: MetaIndex | null
): MissingCapability[] {
  if (!descriptor.missing.length) return [];
  const entry = index?.versions.find((version) => version.id === descriptor.id);
  // With no index to check against, the authored list stands: it is a statement about the game, and
  // the index only confirms it against the datasheet.
  if (!entry) return descriptor.missing;
  return descriptor.missing.filter((capability) => !entry.tableIds.includes(capability.table));
}
