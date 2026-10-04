/**
 * Byte helpers shared by the parser.
 *
 * The parser used to read through `Buffer`, whose `readUInt*LE` methods are the only thing the
 * decode path actually needed. These are the same little-endian reads expressed over `Uint8Array`,
 * plus the three Buffer string/index behaviours the parser relied on
 * (`toString("latin1")`, `toString("hex")` and `Buffer.indexOf(Buffer)`), which plain
 * `Uint8Array` does not have.
 *
 * The reads use explicit byte math rather than a `DataView` because several of them run once per
 * byte across a multi-megabyte blob, where allocating or looking up a view per call is measurable.
 * `ByteReader` in the parser does hold a single `DataView` for its per-field reads.
 */

/** Latin-1 bytes for a string - the equivalent of `Buffer.from(text, "latin1")`. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const LATIN1_CHUNK = 8192;

/**
 * The equivalent of `buffer.toString("latin1")`.
 *
 * Deliberately NOT `new TextDecoder("latin1")`: the WHATWG encoding standard aliases that (and
 * "iso-8859-1") to windows-1252, which decodes 0x80-0x9f to different characters than Node's
 * latin1. Player names go through this path, so the two must agree exactly.
 */
export function latin1Text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += LATIN1_CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + LATIN1_CHUNK));
  }
  return out;
}

const HEX = "0123456789abcdef";

/** The equivalent of `buffer.toString("hex")`. */
export function hexText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return out;
}

/** The equivalent of `buffer.readUInt32LE(at)`. */
export function readUInt32LE(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/** The equivalent of `buffer.readUInt16LE(at)`. */
export function readUInt16LE(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

/**
 * The equivalent of `buffer.indexOf(needle)`, which `Uint8Array.indexOf` cannot do: it only accepts
 * a byte value, not a byte sequence.
 */
export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  fromIndex = 0
): number {
  const start = Math.max(0, fromIndex);
  const last = haystack.length - needle.length;
  if (needle.length === 0) return start <= haystack.length ? start : -1;

  const first = needle[0];
  for (let i = start; i <= last; i++) {
    if (haystack[i] !== first) continue;
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

const utf8Encoder = new TextEncoder();

/** UTF-8 bytes for a string - the default `hash.update(string)` encoding. */
export function utf8Bytes(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}
