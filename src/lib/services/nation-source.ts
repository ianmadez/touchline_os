/**
 * Nation flags, and where they come from.
 *
 * The save stores a player's nationality as a bare integer and holds no image of any kind, so a flag
 * can only be fetched. The CDN that already serves player faces serves these too, under the SAME
 * numeric id:
 *
 *   https://cdn.futwiz.com/assets/img/fc26/flags/14.png   ->  England, 104x62, 456 bytes
 *   https://cdn.futwiz.com/assets/img/fc26/flags/9999.png ->  404
 *
 * So the key is the save's own code and no mapping table is needed, which is why this file exists
 * rather than a lookup: there is nothing to look up.
 *
 * The two guards below are NOT the ones `face-source.ts` uses. Faces need a >= 500 byte floor because
 * the CDN has been seen to answer with a small error-page image and a 200; flags are smaller than
 * that floor in their entirety (a real England flag is 456 bytes), so the only honest test is whether
 * the bytes are actually a PNG. The magic number is checked for exactly that reason.
 *
 * Fetched at render time rather than cached on disk at sync time, unlike faces. The trade is
 * deliberate: a face is 8-10 KB and belongs to one player, while a flag is 0.3-2 KB, is shared by
 * every player of that nation, and there are rarely more than a dozen nations in one squad. A session
 * memory cache (in `NationFlag`) therefore costs one request per nation and covers every player, which
 * is not worth a second OPFS store and a second `public/` folder to avoid.
 */

export const FLAG_CDN_BASE = "https://cdn.futwiz.com/assets/img/fc26/flags";

const FETCH_TIMEOUT_MS = 8_000;

/** The eight bytes every PNG starts with. A real flag is 353-2,092 bytes, so size proves nothing. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** False for codes that cannot name a nation, so no request is worth making. */
export function isUsableNationId(nationId: number | null | undefined): nationId is number {
  return typeof nationId === "number" && Number.isInteger(nationId) && nationId > 0;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Asks the CDN for one nation's flag.
 *
 * Null covers every way this can fail - no such nation, a network failure, a body that is not a
 * picture - because the caller does the same thing in all of them: show the country name on its own.
 * The name is always displayed beside the flag, so a missing flag loses decoration and no information.
 */
export async function fetchFlag(nationId: number): Promise<Uint8Array | null> {
  if (!isUsableNationId(nationId)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${FLAG_CDN_BASE}/${nationId}.png`, {
      signal: controller.signal,
      // A browser silently drops this (User-Agent is a forbidden header there); Node sends it. One
      // header list serves both, the same way `fetchSprite` does it.
      headers: { "User-Agent": "TouchlineOS/0.1 (local companion)" },
    });
    if (!response.ok) {
      // A refused flag and a nation with no flag look the same on screen, and only one of them is worth
      // acting on, so the status is named rather than swallowed. Throttled to once per nation: a squad
      // renders the same flag once per player, which would otherwise be a wall of identical lines.
      warnFlagOnce(nationId, `[flag] ${nationId} came back ${response.status}`);
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isPng(bytes)) {
      warnFlagOnce(nationId, `[flag] ${nationId} came back as bytes that are not a PNG`);
      return null;
    }
    return bytes;
  } catch (error) {
    // A timeout or an offline machine is not evidence that the nation has no flag, and the caller
    // treats it as "nothing to draw" either way, so no distinction is worth propagating. It is still
    // worth a line: a blocked CDN is otherwise invisible.
    warnFlagOnce(nationId, `[flag] ${nationId} could not be fetched: ${(error as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One report per nation, so a squad of one nationality does not repeat itself twenty times. */
const warnedFlags = new Set<number>();
function warnFlagOnce(nationId: number, message: string): void {
  if (warnedFlags.has(nationId)) return;
  warnedFlags.add(nationId);
  console.warn(message);
}
