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

import { defaultProfile, readableScreens, screenRows, type Columns } from "./layouts";
import { cropColumns, detectTable, prepareTable, variantById, DEFAULT_VARIANT_ID, type PreprocessVariant, type RgbaImage, type TableRegion } from "./preprocess";
import { getOcrEngine, LABEL_WHITELIST, VALUE_WHITELIST, type OcrWord } from "./engine";
import {
  classifyScreen,
  normaliseNumber,
  readRows,
  readScreen,
  resolveSide,
  settledSide,
  type ScreenChoice,
  type ScreenReading,
  type SideResolution,
} from "./extract";
import { evaluateScreen, type FactGroupResult } from "./facts";

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
  /** Which screen this capture is, or null when it is not one the scanner reads. */
  screenId: string | null;
  /** How that screen is named, for the confirmation line. Null when nothing was classified. */
  screenLabel: string | null;
  /** Why that screen, or why none was found. The report and the pane both print it. */
  screenReason: string;
  side: SideResolution;
  /** What the screen said, for both clubs. Empty when no screen was classified. */
  reading: ScreenReading;
  /** The judged group: null when the screen was refused, with the line saying why. */
  result: FactGroupResult | null;
  /** The scoreline read from the header, or null when it could not be read. */
  scoreline: { us: number; them: number } | null;
  /** The row height the table was scaled to, for the harness report. */
  scale: number;
  /**
   * The rectangle the table was read from, in the ORIGINAL image's pixels.
   *
   * Returned so the review pane can map a word's box back onto the screenshot the manager is looking at: every
   * box in the reading is in the prepared table's coordinates, which are cropped to this rectangle and scaled
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

/** The scoreline in the header, as the two numbers either side of the separator. */
function readScoreline(
  headerWords: OcrWord[],
  imageWidth: number,
  ours: "LEFT" | "RIGHT" | null
): { us: number; them: number } | null {
  const middle = headerWords
    .filter((word) => {
      const centre = (word.x0 + word.x1) / 2;
      return centre > imageWidth * 0.3 && centre < imageWidth * 0.7 && /[0-9]/.test(word.text);
    })
    .sort((left, right) => left.x0 - right.x0);
  if (ours === null || middle.length < 2) return null;
  const left = normaliseNumber(middle[0].text);
  const right = normaliseNumber(middle[middle.length - 1].text);
  if (left === null || right === null) return null;
  return ours === "LEFT" ? { us: left, them: right } : { us: right, them: left };
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

  const blank: ScreenReading = { values: new Map(), unread: [] };

  /**
   * Which screen, decided before anything is matched to a row.
   *
   * The bands are read twice on purpose. The first pass is a match against every screen's rows at once, which is
   * only used to CLASSIFY the capture; the second reads it properly, against the rows of the screen that was
   * chosen and of the section each band sits in.
   */
  const probe = classifyScreen(readRows(words, bandCentres, bandHeight, prepared.image.width, profile.columns, profile.screens[0]), profile);
  const choice: ScreenChoice = probe.screen === null ? probe : probe;

  if (choice.screen === null) {
    return {
      ok: false,
      imageIndex: options.imageIndex,
      name: options.name,
      reason: `this capture is not a Match Facts screen the reader knows: ${choice.reason}`,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  const rows = readRows(
    words,
    bandCentres,
    bandHeight,
    prepared.image.width,
    profile.columns,
    choice.screen
  );

  if (!choice.screen.enabled) {
    return {
      ok: false,
      imageIndex: options.imageIndex,
      name: options.name,
      reason: `the ${choice.screen.label} screen is not read yet: ${choice.screen.disabledBecause ?? "no capture of it has been checked"}`,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  const settled = classifyScreen(rows, profile);
  const screen = settled.screen ?? choice.screen;
  const ours = settledSide(side);
  const reading = ours === null ? blank : readScreen(rows, screen, ours);
  const result = ours === null ? null : evaluateScreen(screen, reading.values);

  return {
    ok: true,
    imageIndex: options.imageIndex,
    name: options.name,
    profileId: profile.id,
    screenId: screen.id,
    screenLabel: screen.label,
    screenReason: settled.reason,
    side,
    reading,
    result,
    scoreline: readScoreline(headerWords, image.width, ours),
    scale: prepared.scale,
    region: prepared.region,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/** The stored keys of the screens the reader will read, so a caller can size its own lines without layouts. */
export function readableFieldKeys(): string[] {
  return readableScreens(defaultProfile()).flatMap((screen) =>
    screenRows(screen)
      .map((row) => row.key)
      .filter((key): key is Exclude<typeof key, null> => key !== null)
  ) as string[];
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
export type { SideResolution, ScreenReading };
