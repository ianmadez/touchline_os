/**
 * The app's compatibility vocabulary, in one place.
 *
 * WHY THIS MODULE EXISTS. How many games the app reads is a FACT ABOUT THE PARSER, held in
 * `GAME_METAS`, and it was previously re-typed by hand in a footer tooltip, a FAQ answer, a legal
 * notice, the onboarding wizard (three times) and a Settings description. Six copies of one fact is
 * six chances for the app to claim something the parser cannot do, and the claim that matters most is
 * the one a manager acts on before buying or before trusting a save. Everything a screen says about
 * which games are supported is derived from the registry here, so adding a game cannot leave a screen
 * behind.
 *
 * THE THREE LEVELS ARE NOT INTERCHANGEABLE, and the wording keeps them apart. `real` is a claim about
 * the GAME, backed by a save it wrote. `synthetic` is a claim about the READER, backed by a save built
 * to that game's layout and read through that game's datasheet. Saying "supported" for both would be
 * the same class of overstatement as the "browsers drop the User-Agent header" note that cost a week.
 */
import { GAME_METAS, type SupportLevel } from "../parser/game-versions";

/** The games, newest first, as a list a sentence can be built from. */
export function supportedGameLabels(): string[] {
  return GAME_METAS.map((meta) => meta.label);
}

/**
 * A short label for the whole supported range, for a heading or a badge.
 *
 * Written out rather than computed from first and last, because the range is NOT contiguous: FIFA 17
 * to 21 are supported and FIFA 22 to 24 are not, so "FIFA 17 to FC 27" would claim four titles that
 * have no datasheet here.
 */
export const SUPPORTED_RANGE = "FIFA 17 to FIFA 21, and EA SPORTS FC 25 to FC 27";

/** The one-line claim, for a footer tooltip or a badge. */
export const SUPPORT_LINE = `TouchlineOS reads career saves from ${SUPPORTED_RANGE}.`;

/**
 * The game folders the desktop build scans, as prose, for the FAQ answer that names them.
 *
 * Derived from the registry so a game cannot be added to the parser and left out of the explanation of
 * where its saves live. Titles with no known folder are skipped rather than listed as "unknown".
 */
export const folderList = (() => {
  const names = GAME_METAS.map((meta) => meta.saveFolder).filter((name): name is string => Boolean(name));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
})();

/** How each level is described to a manager. */
const LEVEL_WORDS: Record<SupportLevel, string> = {
  real: "read from a career the game wrote",
  synthetic: "tested against a save built to that game's layout",
  unproven: "not yet tested",
};

/** The games whose support rests on a real save, and the ones that do not. */
export function gamesAtLevel(level: SupportLevel): string[] {
  return GAME_METAS.filter((meta) => meta.support === level).map((meta) => meta.label);
}

/**
 * The honest paragraph: what has been tested against a real save, and what has not.
 *
 * Deliberately not a list of every game with a tick beside it. A manager reading this is deciding
 * whether to point the app at his own career, and the only question that matters is whether anybody
 * has done that with this game before.
 */
export function supportDetail(): string {
  const verified = gamesAtLevel("real");
  const synthetic = gamesAtLevel("synthetic");
  const parts: string[] = [];
  if (verified.length > 0) {
    parts.push(`${verified.join(", ")} have been read from careers the games themselves wrote.`);
  }
  if (synthetic.length > 0) {
    parts.push(
      `${synthetic.join(", ")} are read with each game's own database description, and have so far ` +
        `been tested against saves built to those games' layouts rather than against a save the game ` +
        `produced.`
    );
  }
  return parts.join(" ");
}

/** What one game's support is, in the words used on the Settings screen and in the README. */
export function describeSupport(level: SupportLevel): string {
  return LEVEL_WORDS[level];
}
