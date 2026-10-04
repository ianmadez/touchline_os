/**
 * Node-side lookup resources for the parser: the meta XML and the player-name CSV.
 *
 * The parser used to read these itself, which is what made it a Node-only module. They are resolved
 * here instead, in the order the parser used to try: an explicit path, then an environment override,
 * then the committed copy in `public/parse-resources/`. The resolved path is carried through as the
 * resource's reported source, so the report looks the same as it always did.
 *
 * Both files are committed, so a fresh clone resolves names and tables with nothing else installed.
 * `public/parse-resources/README.md` records where they came from and the licensing position.
 */
import fs from "fs";
import path from "path";
import { FeasibilitySaveParser, parseNameTable } from "../parser/feasibility-parser";
import type { ParseOptions } from "../parser/interface";

export interface ParseResourcePaths {
  /** Explicit override, as the spike script's `--meta` / `--name-table` flags pass. */
  metaPath?: string | null;
  nameTablePath?: string | null;
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

/** Reads both resources, or returns nulls for whichever is unavailable. */
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

  return {
    metaXml: meta?.content ?? null,
    metaSource: meta?.source ?? null,
    nameTableCsv: nameTable?.content ?? null,
    nameTableSource: nameTable?.source ?? null,
  };
}

/** Builds a parser with this machine's lookup resources already loaded. */
export function createSaveParser(
  options: Omit<ParseOptions, "metaXml" | "metaSource" | "nameTableCsv" | "nameTableSource"> &
    ParseResourcePaths = {}
): FeasibilitySaveParser {
  const { metaPath, nameTablePath, ...rest } = options;
  return new FeasibilitySaveParser({
    ...rest,
    ...loadParseResources({ metaPath, nameTablePath }),
  });
}
