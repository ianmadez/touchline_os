/**
 * Lookup resources for the browser build: the meta XML, the player-name CSV and the nation table.
 *
 * The parser needs all three: two to turn numeric field ids into table and column names and a player
 * id into a name, and one to turn a nationality code into a country. A page cannot read them off
 * disk, so they are fetched from `/parse-resources/…` - the same files, committed there and served as
 * part of the static build. `public/parse-resources/README.md` records where they came from and the
 * licensing position.
 *
 * This module is a build-time switch point, substituted for `./parse-resources` by the browser
 * target.
 */
import { FeasibilitySaveParser, listSaveTableIds } from "../parser/feasibility-parser";
import {
  DEFAULT_GAME_META,
  META_INDEX_FILE,
  gameMetaFor,
  identifyGame,
  type GameIdentification,
  type MetaIndex,
  type MetaSource,
} from "../parser/game-versions";
import type { GameVersion, ParseOptions } from "../parser/interface";

const META_XML_URL = "/parse-resources/fifa_ng_db-meta.xml";
const NAME_TABLE_CSV_URL = "/parse-resources/playernames_fc26.csv";
const NATION_TABLE_CSV_URL = "/parse-resources/nations_fc26.csv";
const META_INDEX_URL = `/parse-resources/${META_INDEX_FILE}`;

const inBrowser = typeof window !== "undefined";

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

// Resolved once, at module load, so `createSaveParser()` can stay a synchronous call - which is what
// its callers assume, including the sync service's field initialiser.
//
// Only the DEFAULT datasheet is fetched here. A page that opens an FC-era save, which is nearly every
// page, must not pay for five datasheets it will not read; the others are fetched by URL the moment a
// save identifies as one of them, and cached for the rest of the session.
const [metaXml, nameTableCsv, nationTableCsv, metaIndex] = inBrowser
  ? await Promise.all([
      fetchText(META_XML_URL),
      fetchText(NAME_TABLE_CSV_URL),
      fetchText(NATION_TABLE_CSV_URL),
      fetchText(META_INDEX_URL),
    ])
  : [null, null, null, null];

/** Datasheets fetched on demand, keyed by game, so identifying one save never fetches it twice. */
const metaCache = new Map<GameVersion, Promise<string | null>>();

function metaUrlFor(id: GameVersion): string {
  return `/parse-resources/${id === DEFAULT_GAME_META.id ? "fifa_ng_db-meta.xml" : gameMetaFor(id).metaFile}`;
}

export function loadParseResources() {
  return {
    metaXml,
    metaSource: metaXml ? META_XML_URL : null,
    nameTableCsv,
    nameTableSource: nameTableCsv ? NAME_TABLE_CSV_URL : null,
    nationTableCsv,
    nationTableSource: nationTableCsv ? NATION_TABLE_CSV_URL : null,
  };
}

/**
 * This page's datasheets and their index.
 *
 * The index came with the page's first fetch, so identification costs nothing beyond the bytes it
 * needs, and a datasheet other than the default is fetched once and kept.
 */
export const browserMetaSource: MetaSource = {
  index(): MetaIndex | null {
    if (!metaIndex) return null;
    try {
      return JSON.parse(metaIndex) as MetaIndex;
    } catch {
      return null;
    }
  },
  meta(id: GameVersion): Promise<string | null> {
    const cached = metaCache.get(id);
    if (cached) return cached;
    const request = id === DEFAULT_GAME_META.id ? Promise.resolve(metaXml) : fetchText(metaUrlFor(id));
    metaCache.set(id, request);
    return request;
  },
};

/** Builds a parser with the app's lookup resources already loaded. */
export function createSaveParser(
  options: Omit<
    ParseOptions,
    "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource" | "nationTableCsv" | "nationTableSource"
  > = {}
): FeasibilitySaveParser {
  return new FeasibilitySaveParser({ ...options, ...loadParseResources() });
}

/**
 * Builds the parser a save needs, by identifying which game wrote it first.
 *
 * The datasheet a save is read with cannot be chosen until the save has been looked at, so this takes
 * the bytes rather than pretending the choice can be made up front. See the desktop twin for the
 * longer note; both ports go through the same `identifyGame`, which is what stops a save from being
 * read as one game on the desktop and another in the browser.
 */
export async function createSaveParserForSave(
  bytes: Uint8Array,
  options: Omit<
    ParseOptions,
    "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource" | "nationTableCsv" | "nationTableSource" | "gameVersion"
  > = {}
): Promise<{ parser: FeasibilitySaveParser; identification: GameIdentification }> {
  const resources = loadParseResources();
  const identification = await identifyGame(listSaveTableIds(bytes), browserMetaSource);

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
