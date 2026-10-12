/**
 * Node-side lookup resources for the parser: the meta XML, the player-name CSV and the nation table.
 *
 * The parser used to read these itself, which is what made it a Node-only module. They are resolved
 * here instead, in the order the parser used to try: an explicit path, then an environment override,
 * then the committed copy in `public/parse-resources/`. The resolved path is carried through as the
 * resource's reported source, so the report looks the same as it always did.
 *
 * All three files are committed, so a fresh clone resolves names, tables and nationalities with
 * nothing else installed. `public/parse-resources/README.md` records where they came from and the
 * licensing position.
 */
import fs from "fs";
import path from "path";
import {
  FeasibilitySaveParser,
  listSaveTableIds,
  parseNameTable,
  parseNationTable,
} from "../parser/feasibility-parser";
import {
  META_INDEX_FILE,
  gameMetaFor,
  identifyGame,
  type GameIdentification,
  type MetaIndex,
  type MetaSource,
} from "../parser/game-versions";
import type { GameVersion, ParseOptions } from "../parser/interface";

export interface ParseResourcePaths {
  /** Explicit override, as the spike script's `--meta` / `--name-table` flags pass. */
  metaPath?: string | null;
  nameTablePath?: string | null;
  nationTablePath?: string | null;
}

interface ResolvedResource {
  content: string;
  source: string;
}

function resolve(candidates: (string | null)[], accept: (content: string) => boolean) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (!fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, "utf8");
      if (!accept(content)) continue;
      return { content, source: candidate } satisfies ResolvedResource;
    } catch {
      continue;
    }
  }
  return null;
}

/** The committed folder both runtimes read from. The browser build fetches the same files by URL. */
const REFERENCE_DATA_DIR = path.join(process.cwd(), "public", "parse-resources");

/** Reads every resource, or returns nulls for whichever is unavailable. */
export function loadParseResources(paths: ParseResourcePaths = {}) {
  const meta = resolve(
    [
      paths.metaPath ?? null,
      process.env.FC_META_XML ?? null,
      path.join(REFERENCE_DATA_DIR, "fifa_ng_db-meta.xml"),
    ],
    () => true
  );

  const nameTable = resolve(
    [
      paths.nameTablePath ?? null,
      process.env.FC_NAME_TABLE ?? null,
      path.join(REFERENCE_DATA_DIR, "playernames_fc26.csv"),
    ],
    // A candidate that parses to nothing is skipped, which is what the parser used to do.
    (content) => parseNameTable(content).size > 0
  );

  const nationTable = resolve(
    [
      paths.nationTablePath ?? null,
      process.env.FC_NATION_TABLE ?? null,
      path.join(REFERENCE_DATA_DIR, "nations_fc26.csv"),
    ],
    // Same rule as the name table: a file that yields no mapping is treated as absent, so a corrupt
    // copy degrades to "nationality not named" rather than to a table of wrong names.
    (content) => parseNationTable(content).size > 0
  );

  return {
    metaXml: meta?.content ?? null,
    metaSource: meta?.source ?? null,
    nameTableCsv: nameTable?.content ?? null,
    nameTableSource: nameTable?.source ?? null,
    nationTableCsv: nationTable?.content ?? null,
    nationTableSource: nationTable?.source ?? null,
  };
}

/** Builds a parser with this machine's lookup resources already loaded. */
export function createSaveParser(
  options: Omit<
    ParseOptions,
    "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource" | "nationTableCsv" | "nationTableSource"
  > &
    ParseResourcePaths = {}
): FeasibilitySaveParser {
  const { metaPath, nameTablePath, nationTablePath, ...rest } = options;
  return new FeasibilitySaveParser({
    ...rest,
    ...loadParseResources({ metaPath, nameTablePath, nationTablePath }),
  });
}

// ---------------------------------------------------------------------------------------------
// Which game wrote a save
// ---------------------------------------------------------------------------------------------

/**
 * This machine's datasheets and their index, read from the committed reference folder.
 *
 * The index is tiny and the datasheets are not, which is why only the index is read up front and a
 * datasheet is read once the game has been identified. A build that read all six datasheets to work
 * out which one it needed would spend three megabytes of XML to answer a question ten kilobytes of
 * table ids can answer.
 */
export const nodeMetaSource: MetaSource = {
  index(): MetaIndex | null {
    const file = path.join(REFERENCE_DATA_DIR, META_INDEX_FILE);
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8")) as MetaIndex;
    } catch {
      return null;
    }
  },
  meta(id: GameVersion): string | null {
    const file = path.join(REFERENCE_DATA_DIR, gameMetaFor(id).metaFile);
    try {
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
};

/**
 * Builds the parser a save needs, by identifying which game wrote it first.
 *
 * THIS IS THE ENTRY POINT FOR READING A SAVE, rather than `createSaveParser`, because the datasheet
 * cannot be chosen until the save has been looked at, and the save is only available here. Every
 * caller that holds save bytes should use this: a caller that builds a parser without them gets the
 * default datasheet, which is right for the FC-era games and wrong for anything added since.
 */
export async function createSaveParserForSave(
  bytes: Uint8Array,
  options: Omit<
    ParseOptions,
    "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource" | "nationTableCsv" | "nationTableSource" | "gameVersion"
  > &
    ParseResourcePaths = {}
): Promise<{ parser: FeasibilitySaveParser; identification: GameIdentification }> {
  const resources = loadParseResources(options);
  const identification = await identifyGame(listSaveTableIds(bytes), nodeMetaSource);

  return {
    parser: new FeasibilitySaveParser({
      ...options,
      ...resources,
      metaXml: identification.metaXml ?? resources.metaXml,
      gameVersion: identification.descriptor.id,
    }),
    identification,
  };
}
