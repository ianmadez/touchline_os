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
import { FeasibilitySaveParser } from "../parser/feasibility-parser";
import type { ParseOptions } from "../parser/interface";

const META_XML_URL = "/parse-resources/fifa_ng_db-meta.xml";
const NAME_TABLE_CSV_URL = "/parse-resources/playernames_fc26.csv";
const NATION_TABLE_CSV_URL = "/parse-resources/nations_fc26.csv";

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
const [metaXml, nameTableCsv, nationTableCsv] = inBrowser
  ? await Promise.all([
      fetchText(META_XML_URL),
      fetchText(NAME_TABLE_CSV_URL),
      fetchText(NATION_TABLE_CSV_URL),
    ])
  : [null, null, null];

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

/** Builds a parser with the app's lookup resources already loaded. */
export function createSaveParser(
  options: Omit<
    ParseOptions,
    "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource" | "nationTableCsv" | "nationTableSource"
  > = {}
): FeasibilitySaveParser {
  return new FeasibilitySaveParser({ ...options, ...loadParseResources() });
}
