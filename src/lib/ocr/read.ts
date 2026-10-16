/**
 * One screenshot in, one set of believable figures out.
 *
 * This is the only function the debrief screen calls into. It owns the ORDER of the stages, because the order
 * carries meaning: the table is found before anything is scaled, the side is settled before any value is
 * believed, and the cross field rules run before the review pane sees anything.
 *
 * A failure here is a sentence, never a thrown error and never a guess. A `reason` of "no table was found" is a
 * real outcome that the manager resolves by looking at their own screenshot.
 */

import { boundRows, defaultProfile, type Columns, type StatGroup } from "./layouts";
import { cropColumns, detectTable, prepareTable, variantById, DEFAULT_VARIANT_ID, type PreprocessVariant, type RgbaImage, type TableRegion } from "./preprocess";
import { getOcrEngine, LABEL_WHITELIST, VALUE_WHITELIST, type OcrWord } from "./engine";
import {
  readRows,
  resolveSide,
  settledSide,
  validateReadings,
  type ScanObservation,
  type SideResolution,
  type ValidatedObservation,
} from "./extract";

/** How the columns are handed to the engine. */
export type ReadMode = "SINGLE_PASS" | "PER_COLUMN";

/**
 * The two read modes, swept by the harness.
 *
 * A single pass is one OCR call over the whole table with no character restriction. Per column is three calls,
 * each over one narrow strip with a whitelist suited to it, which is slower but removes the letter confusions
 * and the coloured side bar from the value columns entirely. Which one wins is a measurement, not an opinion.
 */
export const READ_MODES: readonly ReadMode[] = ["SINGLE_PASS", "PER_COLUMN"];

/** The page segmentation modes worth trying. 6 is "one block of text", 11 is "sparse text, any order". */
export const PSM_CANDIDATES = ["6", "11"] as const;

export interface ReadOptions {
  variantId?: string;
  mode?: ReadMode;
  psm?: string;
  /** Which image this is, counting from one, for the provenance chip. */
  imageIndex: number;
  /** The file name, for the "which image could not be read" line. */
  name: string;
  /** The venue the manager already chose, which is the strong side signal. */
  venue: "HOME" | "AWAY" | "NEUTRAL" | null;
  ourClub: string;
  opponent: string;
  /** Our goals from the scoreline, when the manager has entered one, for the cross-check. */
  goalsFor: number | null;
  onProgress?: (fraction: number, status: string) => void;
  signal?: AbortSignal;
}

export interface ReadSuccess {
  ok: true;
  imageIndex: number;
  name: string;
  profileId: string;
  groupId: string;
  /** How many of the group's known row labels were matched, and how many there are. */
  matchedLabels: number;
  totalLabels: number;
  side: SideResolution;
  observations: ValidatedObservation[];
  unread: ValidatedObservation["field"][];
  /** The row height the table was scaled to, for the harness report. */
  scale: number;
  /**
   * The rectangle the table was read from, in the ORIGINAL image's pixels.
   *
   * Returned so the review pane can map a word's box back onto the screenshot the manager is looking at: every
   * box in `observations` is in the prepared table's coordinates, which are cropped to this rectangle and scaled
   * by `scale`, and drawing them untranslated would put them in the wrong place on a large or a small screen.
   */
  region: TableRegion;
  /** How long the recognition took, in milliseconds. */
  elapsedMs: number;
}

export interface ReadFailure {
  ok: false;
  imageIndex: number;
  name: string;
  reason: string;
  elapsedMs: number;
}

export type ReadOutcome = ReadSuccess | ReadFailure;

/** The group the scanner reads. One profile ships, so this is the profile's one group. */
function activeGroup(): StatGroup {
  const group = defaultProfile().groups[0];
  if (group === undefined) throw new Error("The layout profile carries no stat group.");
  return group;
}

/**
 * One column of the table, ready to hand to the engine on its own.
 *
 * Cropping here rather than passing a rectangle to the engine keeps the coordinate arithmetic in one place and
 * makes no assumption about whether the engine reports boxes relative to the region or to the page.
 *
 * The whitelist is what earns the extra calls: the value columns cannot contain letters, so restricting them
 * removes both the letter confusions and any stray glyph the coloured side bar produced.
 */
function columnCrops(image: RgbaImage, columns: Columns): Array<{
  id: string;
  image: RgbaImage;
  offsetX: number;
  whitelist: string;
}> {
  return cropColumns(image, columns).map((crop) => ({
    ...crop,
    whitelist: crop.id === "label" ? LABEL_WHITELIST : VALUE_WHITELIST,
  }));
}

/** The header strip of the original image, scaled up, which is where the two club names are. */
function headerStrip(
  image: RgbaImage,
  band: { top: number; bottom: number },
  scale: number
): { image: RgbaImage; offsetY: number } {
  const y0 = Math.max(0, Math.floor(band.top * image.height));
  const y1 = Math.min(image.height, Math.ceil(band.bottom * image.height));
  const height = Math.max(1, y1 - y0);
  const outHeight = Math.max(1, Math.round(height * scale));
  const outWidth = Math.max(1, Math.round(image.width * scale));
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = y0 + Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * outWidth + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = 255;
    }
  }

  return { image: { data, width: outWidth, height: outHeight }, offsetY: y0 };
}

/** A word mapped back into the prepared table's coordinates after being read from a column crop. */
function shiftWord(word: OcrWord, offsetX: number): OcrWord {
  return { ...word, x0: word.x0 + offsetX, x1: word.x1 + offsetX };
}

/**
 * Reads one screenshot.
 *
 * The engine is prepared once per session and reused, so a five image scan builds one worker rather than five.
 */
export async function readMatchFacts(image: RgbaImage, options: ReadOptions): Promise<ReadOutcome> {
  const started = performance.now();
  const variant: PreprocessVariant = variantById(options.variantId ?? DEFAULT_VARIANT_ID);
  const mode: ReadMode = options.mode ?? "SINGLE_PASS";
  const psm = options.psm ?? "6";
  const profile = defaultProfile();
  const group = activeGroup();

  const bands = detectTable(image);
  if (!bands) {
    return {
      ok: false,
      imageIndex: options.imageIndex,
      name: options.name,
      reason: "no Match Facts table was found in this image",
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  const prepared = prepareTable(image, bands, variant);
  const engine = await getOcrEngine(options.onProgress);

  // The row bands, moved from the original image into the prepared table's coordinates.
  const bandCentres = bands.centres.map((centre) => (centre - bands.region.top) * prepared.scale);
  const bandHeight = bands.rowHeight * prepared.scale;

  let words: OcrWord[];
  if (mode === "PER_COLUMN") {
    const columnWords: OcrWord[] = [];
    for (const column of columnCrops(prepared.image, profile.columns)) {
      const frame = await engine.recognise({
        image: column.image,
        whitelist: column.whitelist,
        psm,
        onProgress: options.onProgress,
        signal: options.signal,
      });
      for (const word of frame.words) columnWords.push(shiftWord(word, column.offsetX));
    }
    words = columnWords;
  } else {
    const frame = await engine.recognise({
      image: prepared.image,
      psm,
      onProgress: options.onProgress,
      signal: options.signal,
    });
    words = frame.words;
  }

  const rows = readRows(words, bandCentres, bandHeight, prepared.image.width, profile.columns, group);
  const matchedLabels = new Set(
    rows.filter((row) => row.row !== null).map((row) => row.row!.aliases[0])
  ).size;

  /**
   * The club names, read on their own so the side can be cross-checked.
   *
   * A failure here is not a failure of the read: the venue alone still settles the side, so this pass is allowed
   * to come back empty.
   */
  let headerWords: OcrWord[] = [];
  if (profile.clubNames !== "UNREADABLE") {
    try {
      const strip = headerStrip(image, profile.headerBand, 3);
      const frame = await engine.recognise({
        image: strip.image,
        whitelist: LABEL_WHITELIST,
        psm: "7",
        signal: options.signal,
      });
      // Scaled back down so the x comparison is against the original image's width.
      headerWords = frame.words.map((word) => ({
        ...word,
        x0: word.x0 / 3,
        x1: word.x1 / 3,
        y0: word.y0 / 3 + strip.offsetY,
        y1: word.y1 / 3 + strip.offsetY,
      }));
    } catch {
      headerWords = [];
    }
  }

  const side = resolveSide({
    venue: options.venue,
    ourClub: options.ourClub,
    opponent: options.opponent,
    headerWords,
    imageWidth: image.width,
    clubNames: profile.clubNames,
  });

  const ours = settledSide(side);
  const { observations, unread } = validateReadings({
    columns: profile.columns,
    width: prepared.image.width,
    rows,
    ours,
    goalsFor: options.goalsFor,
    group,
  });

  return {
    ok: true,
    imageIndex: options.imageIndex,
    name: options.name,
    profileId: profile.id,
    groupId: group.id,
    matchedLabels,
    totalLabels: group.labels.length,
    side,
    observations,
    unread,
    scale: prepared.scale,
    region: prepared.region,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/** The bound fields of the active group, so a caller can size its "not read" line without importing layouts. */
export function boundFieldKeys(): string[] {
  return boundRows(activeGroup()).map((row) => row.field as string);
}

/** An image decoded to pixels, with its own size, which the review pane needs to place the highlight. */
export interface DecodedImage {
  image: RgbaImage;
  width: number;
  height: number;
}

/**
 * A chosen file as pixels.
 *
 * `createImageBitmap` rather than an `<img>` and a canvas, because it decodes off the main thread and Firefox
 * has supported it since well before the versions this app targets. The bitmap is closed in a `finally` so a
 * failed read of a large screenshot cannot leave thirty megabytes of pixels pinned for the life of the tab,
 * which matters on a screen that is already holding the wasm SQLite engine.
 *
 * Throws rather than returning a result: the caller has already admitted the file, so a failure here is a
 * broken file or a browser without the API, and both are the same sentence to the manager.
 */
export async function decodeImageFile(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot open images for the reader.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("That file could not be opened as an image.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      image: { data: pixels.data, width: bitmap.width, height: bitmap.height },
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
export type { ScanObservation, ValidatedObservation, SideResolution };
