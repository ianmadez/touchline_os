/**
 * The OCR engine, behind one small interface.
 *
 * The rest of the scanner knows four things: prepare an engine, hand it an image, get words back, dispose it.
 * Only this file knows that tesseract.js exists, so swapping the engine later is a rewrite of this file and
 * nothing else.
 *
 * THREE THINGS THAT MATTER HERE.
 *
 * 1. NOTHING IS FETCHED FROM A CDN. Tesseract.js points its worker, its wasm core and its language data at
 *    jsdelivr and `tessdata.projectnaptha.com` by default. All three are overridden to this app's own origin,
 *    because an image of a manager's match must not produce a request to a third party, and because the feature
 *    has to work offline.
 *
 * 2. THE FILES ARE STATIC, NOT BUNDLED. `worker.min.js` and the six core builds are served from `public/ocr/`
 *    and the worker is created with `new Worker(workerPath)` rather than through a blob, so no bundler is ever
 *    asked to resolve a worker or a wasm module. That removes the whole class of `output: "export"` bundling
 *    problems rather than testing whether this particular bundler happens to cope.
 *
 * 3. THE LANGUAGE CACHE IS OFF. `cacheMethod: "none"` means the model is not written to IndexedDB and not read
 *    from it. It is a static file we ship, so the ordinary HTTP cache is the right cache and nothing needs
 *    saving in the manager's browser storage.
 *
 * LOADING IS DEFERRED. The `import` below is the chunk boundary: nothing imports this module except the one
 * function that is called when the manager actually scans something, so tesseract.js is absent from the initial
 * bundle.
 */

import type { RgbaImage } from "./preprocess";

/** One recognised word, with its box in the coordinates of the image that was handed over. */
export interface OcrWord {
  text: string;
  /** 0 to 1. Tesseract reports 0 to 100 and the conversion happens here, once. */
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrFrame {
  width: number;
  height: number;
  words: OcrWord[];
}

export interface OcrRequest {
  image: RgbaImage;
  /**
   * Which characters may be read. The value columns get a numeric set, which removes the letter confusion and
   * the coloured side bar in one step; the label column gets nothing restricted.
   */
  whitelist?: string;
  /** The page segmentation mode, as tesseract's own numeric string. */
  psm?: string;
  onProgress?: (fraction: number, status: string) => void;
  signal?: AbortSignal;
}

export interface OcrEngine {
  prepare(onProgress?: (fraction: number, status: string) => void): Promise<void>;
  recognise(request: OcrRequest): Promise<OcrFrame>;
  dispose(): void;
}

/** Where the self hosted runtime lives. A constant, because this code only ever runs in a page. */
export const OCR_BASE = "/ocr";

/** The whitelist for a value column. A percent sign, digits, one decimal point and a minus. */
export const VALUE_WHITELIST = "0123456789.-%";

/** The whitelist for a label column: letters, spaces and the punctuation the labels actually carry. */
export const LABEL_WHITELIST = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ()&%";

/**
 * Why the engine could not start.
 *
 * Typed so the panel can say one honest sentence rather than showing a stack trace. The message is deliberately
 * the same on every browser: the failure is a missing or unusable build, not something a manager can fix by
 * switching browser.
 */
export class OcrUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The screen reader could not start. This build was made without it, or this browser cannot run it.");
    this.name = "OcrUnavailableError";
    this.cause = cause;
  }
}

/** What a progress callback reports, and the words the panel may show for each stage. */
export const PROGRESS_LABELS: Record<string, string> = {
  "loading tesseract core": "Starting the engine",
  "initializing tesseract": "Starting the engine",
  "loading language traineddata": "Preparing the reader",
  "initializing api": "Preparing the reader",
  "recognizing text": "Reading the screen",
};

/** A stage name fit to show, or null for the chatter that has no user facing meaning. */
export function progressLabel(status: string): string | null {
  return PROGRESS_LABELS[status] ?? null;
}

/** The tesseract.js surface this module uses, so the dynamic import can stay untyped on both sides. */
interface TesseractWorker {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: HTMLCanvasElement,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>
  ): Promise<{ data: PageLike }>;
  terminate(): Promise<unknown>;
}

interface PageLike {
  blocks:
    | Array<{
        paragraphs: Array<{ lines: Array<{ words: Array<WordLike> }> }>;
      }>
    | null;
}

interface WordLike {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractModule {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>
  ): Promise<TesseractWorker>;
  OEM: { LSTM_ONLY: number };
}

/**
 * One engine per session.
 *
 * Held at module scope so switching panes, adding a second screenshot or scanning twice does not reload 4 MB of
 * wasm or re-read the language file. `dispose` is called when the manager leaves the screen.
 */
let engine: TesseractEngine | null = null;
let preparing: Promise<void> | null = null;

class TesseractEngine implements OcrEngine {
  private worker: TesseractWorker | null = null;
  private ready = false;

  async prepare(onProgress?: (fraction: number, status: string) => void): Promise<void> {
    if (this.ready) return;

    // A browser without WebAssembly cannot run this at all, and saying so here is cheaper and clearer than
    // letting the worker fail to parse its core.
    if (typeof WebAssembly === "undefined") throw new OcrUnavailableError("WebAssembly is unavailable.");

    try {
      const tesseract = (await import("tesseract.js")) as unknown as TesseractModule;

      this.worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
        workerPath: `${OCR_BASE}/worker.min.js`,
        corePath: `${OCR_BASE}/core`,
        langPath: `${OCR_BASE}/lang`,
        // Off: the model is a static file, so the browser's own HTTP cache is the right one.
        cacheMethod: "none",
        // False keeps `new Worker(path)` rather than a blob URL, which is what a same origin worker wants.
        workerBlobURL: false,
        // The language file is served gzipped, which is what tesseract expects of a `langPath`.
        gzip: true,
        logger: (message: { progress?: number; status?: string }) => {
          if (onProgress && typeof message.progress === "number" && message.status) {
            onProgress(message.progress, message.status);
          }
        },
        errorHandler: (error: unknown) => {
          // Surfaced through the reject below rather than swallowed, because a worker that dies mid job has to
          // reach the panel as a failure and not as an empty read.
          console.error("[ocr] worker error:", error);
        },
      });

      this.ready = true;
    } catch (error) {
      this.worker = null;
      this.ready = false;
      throw new OcrUnavailableError(error);
    }
  }

  async recognise(request: OcrRequest): Promise<OcrFrame> {
    if (!this.worker || !this.ready) await this.prepare(request.onProgress);
    if (!this.worker) throw new OcrUnavailableError();

    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    /**
     * EVERY parameter is set on every call, including the ones being turned off.
     *
     * This is not tidiness, it is the fix for the most misleading bug in this file. Tesseract keeps its parameters
     * between jobs, and an earlier version only set the keys it had a value for. The club name pass sets a letters
     * only whitelist; the next read's table pass then inherited it, so every digit on the table was excluded and
     * the read came back empty. The symptom was that exactly ONE reading in a whole sweep produced any figures and
     * every reading after it produced none, which looks like a preprocessing variant being dramatically better
     * than its neighbours and is nothing of the sort.
     */
    const params: Record<string, string> = {
      tessedit_pageseg_mode: request.psm ?? "6",
      // An empty whitelist means "no restriction" and must be sent as an empty string to clear a previous one.
      tessedit_char_whitelist: request.whitelist ?? "",
      // Without this a value and its label can be joined into one token by the layout analyser.
      preserve_interword_spaces: "1",
    };
    await this.worker.setParameters(params);

    const canvas = imageToCanvas(request.image);
    const result = await this.worker.recognize(canvas, {}, { blocks: true });
    // The canvas is only needed for the duration of the call, and a 4K capture is tens of megabytes.
    canvas.width = 0;
    canvas.height = 0;

    return {
      width: request.image.width,
      height: request.image.height,
      words: flattenWords(result.data),
    };
  }

  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    if (worker) void worker.terminate().catch(() => undefined);
  }
}

/** Every word in the page, in reading order, with the confidence already divided down to 0 to 1. */
function flattenWords(page: PageLike): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text.trim();
          if (text === "") continue;
          words.push({
            text,
            // Tesseract reports 0 to 100; a confidence that sometimes meant one scale and sometimes the other
            // would make every threshold in the scanner meaningless.
            confidence: Math.max(0, Math.min(1, word.confidence / 100)),
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          });
        }
      }
    }
  }
  return words;
}

/** A canvas holding the image, which is what tesseract takes. */
function imageToCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new OcrUnavailableError("A 2D canvas could not be created.");
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

/**
 * The engine, prepared.
 *
 * Concurrent callers share one preparation, so a two image scan does not build two workers and two wasm
 * instances. A failed preparation clears the promise so a retry is possible rather than permanently poisoned.
 */
export async function getOcrEngine(
  onProgress?: (fraction: number, status: string) => void
): Promise<OcrEngine> {
  if (engine === null) engine = new TesseractEngine();
  if (preparing === null) {
    preparing = engine.prepare(onProgress).catch((error) => {
      preparing = null;
      throw error;
    });
  }
  await preparing;
  return engine;
}

/** Frees the worker and the wasm instance. Called when the manager leaves the debrief screen. */
export function disposeOcrEngine(): void {
  engine?.dispose();
  engine = null;
  preparing = null;
}
