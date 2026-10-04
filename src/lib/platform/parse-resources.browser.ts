/**
 * Lookup resources for the browser build: the meta XML and the player-name CSV.
 *
 * The parser needs both to turn numeric field ids into table and column names and to resolve a
 * player's name from the save's name table. A page cannot read them off disk, so they are fetched from
 * `/parse-resources/…` - the same two files, committed there and served as part of the static build.
 * `public/parse-resources/README.md` records where they came from and the licensing position.
 *
 * This module is a build-time switch point, substituted for `./parse-resources` by the browser
 * target.
 */
import { FeasibilitySaveParser } from "../parser/feasibility-parser";
import type { ParseOptions } from "../parser/interface";

const META_XML_URL = "/parse-resources/fifa_ng_db-meta.xml";
const NAME_TABLE_CSV_URL = "/parse-resources/playernames_fc26.csv";

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
const [metaXml, nameTableCsv] = inBrowser
  ? await Promise.all([fetchText(META_XML_URL), fetchText(NAME_TABLE_CSV_URL)])
  : [null, null];

export function loadParseResources() {
  return {
    metaXml,
    metaSource: metaXml ? META_XML_URL : null,
    nameTableCsv,
    nameTableSource: nameTableCsv ? NAME_TABLE_CSV_URL : null,
  };
}

/** Builds a parser with the app's lookup resources already loaded. */
export function createSaveParser(
  options: Omit<ParseOptions, "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource"> = {}
): FeasibilitySaveParser {
  return new FeasibilitySaveParser({ ...options, ...loadParseResources() });
}
