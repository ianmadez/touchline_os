/**
 * Turning a screenshot into something the OCR engine can read, and deciding where the table is.
 *
 * Everything here is a pure function over pixels, so the same code runs in the page and in the Firefox harness.
 * Nothing touches the DOM.
 *
 * WHY THE TABLE IS FOUND FROM ITS LINES. The modern Match Facts table draws a horizontal line between every row.
 * Those lines are the only thing on the screen that is both exactly horizontal, evenly spaced, and the same width
 * every time, which makes them a far stronger signal than anything derived from reading characters. Finding them
 * gives three things at once: the table's vertical extent, its horizontal extent, and the row boundaries the
 * labels are matched inside. On the phone photo of a TV, where a character's cap height is about nine pixels and
 * a glare band crosses the middle of the table, that is the difference between working and not.
 *
 * WHY THE IMAGE IS SCALED TO A ROW HEIGHT RATHER THAN A WIDTH. Tesseract's own documentation says a small image
 * should be upscaled before recognition, and the captures bear that out: a row is about 35 px in the clean
 * 1280x720 capture and about 24 px in the photo. Scaling to a fixed row height normalises both to the same glyph
 * size, which is what the engine cares about, and it does not care how wide the screen was.
 */

/**
 * One luminance byte per pixel.
 *
 * Pinned to `ArrayBuffer` rather than the default `ArrayBufferLike`, because `ImageData` and the canvas API
 * require it and a `SharedArrayBuffer` backed view cannot be handed to a canvas.
 */
export type LumaPlane = Uint8ClampedArray<ArrayBuffer>;

/** An image in memory, RGBA, row major. Matches `ImageData` so a canvas can be read into it directly. */
export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** A rectangle in image pixels. */
export interface TableRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What may be admitted, checked BEFORE the image is decoded.
 *
 * A decoded 4K screenshot is about 33 MB of pixels before any scaling, and the tab already holds an OPFS
 * database and a wasm SQLite engine, so the cap is enforced on the compressed size first. These are guards
 * against a mistake or a hostile file, not a claim about what a phone produces: an ordinary screenshot is a long
 * way under all of them.
 */
export const IMAGE_LIMITS = {
  maxBytes: 12 * 1024 * 1024,
  maxImages: 8,
  /** The types a plain file input offers here, all of which Firefox decodes natively. */
  types: ["image/png", "image/jpeg", "image/webp"] as const,
} as const;

export type Admission = { ok: true } | { ok: false; reason: string };

/**
 * Whether a file may be read, with a reason a manager can act on when it may not.
 *
 * A missing MIME type is only a refusal when the extension disagrees too, because some desktops hand the browser
 * an empty type for a perfectly ordinary PNG.
 */
export function admitImage(input: {
  name: string;
  type: string;
  size: number;
  existingCount: number;
}): Admission {
  const limitMb = Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024));
  if (input.existingCount >= IMAGE_LIMITS.maxImages) {
    return {
      ok: false,
      reason: `That is ${IMAGE_LIMITS.maxImages} screenshots already. Read them, then add more if you need to.`,
    };
  }
  if (input.size > IMAGE_LIMITS.maxBytes) {
    return {
      ok: false,
      reason: `That file is larger than ${limitMb} MB. Crop it to the Match Facts table and try again.`,
    };
  }
  if (input.size === 0) {
    return { ok: false, reason: "That file is empty." };
  }
  const byType = (IMAGE_LIMITS.types as readonly string[]).includes(input.type);
  const byName = /\.(png|jpe?g|webp)$/i.test(input.name);
  if (!byType && !byName) {
    return { ok: false, reason: "That file is not a PNG, JPEG or WebP image." };
  }
  return { ok: true };
}

/** Rec. 601 luma, which is what "grayscale" means for a screen full of small text. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * How far apart a pixel's channels have to be before it counts as a colour rather than as text.
 *
 * White, grey and black text has almost identical channels. The coloured furniture around it does not, and this is
 * what separates them: the leading side bar is a saturated blue or green block sitting FLUSH against the number it
 * belongs to, and the engine reads the two as one token. That is not a guess, it was measured on the clean
 * capture, where `158` came back as `lis`, `69` as `leg`, `12` as `[2` and `0` as `fe)`, all at confidences
 * between 0.04 and 0.70, while the same rows' right hand numbers two pixels inside their own edge read at 0.95.
 *
 * On the photo it earns its keep a second way: the panel is a saturated blue, so this turns the panel black and
 * leaves only the white text, while a photograph showing through the translucent panel is largely colourful and
 * largely goes too.
 */
const SATURATION_CUT = 40;

/**
 * The image reduced to one luminance byte per pixel.
 *
 * With `suppressSaturated`, a pixel whose channels differ by more than the cut is written as background rather
 * than as its own brightness. `toLuma` is also what the table detector reads, and the detector deliberately does
 * NOT suppress: it is looking for horizontal lines in the picture as it is, and flattening the colours first would
 * change what it finds for reasons that have nothing to do with finding lines.
 */
export function toLuma(image: RgbaImage, suppressSaturated = false): LumaPlane {
  const out = new Uint8ClampedArray(image.width * image.height);
  const { data } = image;
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    if (suppressSaturated && Math.max(r, g, b) - Math.min(r, g, b) > SATURATION_CUT) {
      out[i] = 0;
      continue;
    }
    out[i] = luma(r, g, b);
  }
  return out;
}

/**
 * How strongly each row boundary shows at each `y`.
 *
 * The measured quantity is the mean absolute difference between the row at `y` and the row at `y - 1` across the
 * whole width. A drawn line changes every pixel it crosses, so the mean moves; photographic texture behind a
 * translucent panel changes pixels at random, so the mean barely moves.
 */
function rowEdgeStrength(gray: LumaPlane, width: number, height: number): Float64Array {
  const strength = new Float64Array(height);
  for (let y = 1; y < height; y += 1) {
    let total = 0;
    const base = y * width;
    const above = base - width;
    for (let x = 0; x < width; x += 1) {
      total += Math.abs(gray[base + x] - gray[above + x]);
    }
    strength[y] = total / width;
  }
  return strength;
}

/**
 * How much a pixel pair has to change to count as part of a drawn line, and how wide that line has to be.
 *
 * These replace a `mean + k * standard deviation` threshold, which was the first thing tried here and was the
 * wrong instrument. On a row that crosses a line, the distribution of column changes is bimodal, high across the
 * line and near zero either side, so a standard deviation derived threshold lands on the boundary between the two
 * modes and flips on tiny contrast differences. The photo of a TV, whose lines are dim, flipped one way and the
 * clean capture, whose lines are bright, found stripes of background instead.
 *
 * A drawn line is two directly measurable things instead: it changes each pixel it crosses by a visible amount,
 * and it runs for a good share of the width.
 */
const RULE_CONTRAST = 4;
const MIN_RULE_WIDTH_FRACTION = 0.15;
/**
 * How big a break a line may have in it before the run is considered two objects.
 *
 * The captures are why this exists at all. The clean capture's table is translucent and two players stand in
 * front of it, so a row line is interrupted by an arm or a bib for tens of pixels. Scoring by the longest
 * unbroken run rejected half the real rows and the rhythm fit then settled on every second line. At eight percent
 * of the width the interruptions are bridged, while the gap between the table and a flanking stat card, which is
 * far wider, is not.
 */
const MAX_RULE_GAP_FRACTION = 0.08;
/**
 * How much of its own length a line has to actually occupy.
 *
 * Measured INSIDE the run rather than across the whole image, which was the second thing tried and the second
 * thing to fail: the flanking stat cards put a few hits at the far left and far right of the same rows, so the
 * extent stretched to the full width and the density of a perfectly good line fell under half.
 *
 * A real line sits near 1 inside its own span. A row of scattered text, which is the thing this has to reject,
 * sits far below.
 */
const MIN_RULE_DENSITY = 0.6;

/** One detected horizontal line, before grouping. Exported for the harness's diagnostics. */
export interface RowEdge {
  y: number;
  left: number;
  right: number;
  /** The row's mean column change, which is how strongly the line shows. */
  strength: number;
}

/**
 * The horizontal extent of a drawn line at `y`, or null.
 *
 * The contrast bar is the row's own mean change times a fraction, so the same line on a bright panel and on a dim
 * photograph are both found. The absolute floor stops a flat row's noise from being read as a line.
 */
function edgeSpan(
  gray: LumaPlane,
  width: number,
  y: number,
  meanChange: number
): { left: number; right: number } | null {
  const base = y * width;
  const above = base - width;
  const threshold = Math.max(RULE_CONTRAST, meanChange * 0.4);
  const maxGap = Math.max(4, Math.round(width * MAX_RULE_GAP_FRACTION));
  const minWidth = width * MIN_RULE_WIDTH_FRACTION;

  let best: { left: number; right: number } | null = null;
  let bestSpan = -1;
  let runStart = -1;
  let lastHit = -1;
  let hits = 0;

  const consider = () => {
    if (runStart < 0) return;
    const span = lastHit - runStart;
    if (span >= minWidth && hits / (span + 1) >= MIN_RULE_DENSITY && span > bestSpan) {
      bestSpan = span;
      best = { left: runStart, right: lastHit };
    }
  };

  for (let x = 0; x <= width; x += 1) {
    const hit = x < width && Math.abs(gray[base + x] - gray[above + x]) >= threshold;
    if (hit) {
      if (runStart < 0) {
        runStart = x;
        hits = 0;
      }
      lastHit = x;
      hits += 1;
      continue;
    }
    if (runStart >= 0 && x - lastHit > maxGap) {
      consider();
      runStart = -1;
    }
  }
  consider();

  return best;
}

/**
 * Every distinct horizontal line in the image.
 *
 * Two collapses happen here, and both were forced by looking at the captures rather than by theory.
 *
 * A line is two or three pixels thick, so consecutive rows are ONE line and the row that shows it most strongly is
 * kept. That alone is not enough: on the photo, a line that has been smeared by the camera and the screen comes
 * back as two separate hits four pixels apart with a dead row between them, which would then read as two rows of
 * the table. So lines closer together than `MERGE_LINES_WITHIN` are merged too, which is safe because the
 * smallest real row on either capture is about 24 pixels.
 */
const MERGE_LINES_WITHIN = 8;

export function scanRowEdges(image: RgbaImage): RowEdge[] {
  const { width, height } = image;
  const gray = toLuma(image);
  const strength = rowEdgeStrength(gray, width, height);

  const hits: RowEdge[] = [];
  let run: RowEdge | null = null;

  const close = () => {
    if (run) hits.push(run);
    run = null;
  };

  for (let y = 1; y < height; y += 1) {
    const meanChange = strength[y];
    const span = meanChange >= RULE_CONTRAST ? edgeSpan(gray, width, y, meanChange) : null;
    if (span === null) {
      close();
      continue;
    }
    if (run === null) {
      run = { y, left: span.left, right: span.right, strength: meanChange };
    } else if (meanChange > run.strength) {
      run = { y, left: span.left, right: span.right, strength: meanChange };
    }
  }
  close();

  const merged: RowEdge[] = [];
  for (const hit of hits) {
    const previous = merged[merged.length - 1];
    if (previous && hit.y - previous.y <= MERGE_LINES_WITHIN) {
      if (hit.strength > previous.strength) merged[merged.length - 1] = hit;
      continue;
    }
    merged.push(hit);
  }
  return merged;
}

/**
 * The band of row heights a Match Facts row can plausibly have.
 *
 * The captures measure about 33 px on a 720p screenshot and about 24 px on a phone photo of a bigger screen. The
 * floor is what keeps a spurious fine pitch out: at twelve pixels the fit could match several real lines by
 * accident and then synthesise thirty four rows out of them, which is what it did before this floor existed.
 */
const MIN_ROW_HEIGHT = 18;
const MAX_ROW_HEIGHT = 90;
/** How far a line may sit from its place in the pitch. Generous, because a photo distorts spacing. */
const RHYTHM_TOLERANCE = 0.18;
const MIN_RULES = 6;
const MIN_GROUP_SPAN_FRACTION = 0.15;
/**
 * How far the region is widened past the lines that were found.
 *
 * A small margin, and it exists because a sheared first digit is unrecognisable. The measured extent is the extent
 * of the LINES, and the numbers and labels can sit a pixel or two outside them. Without the margin the region's
 * left edge cut the left value of every row in its first column: the clean capture read `158` as `lis`, `69` as
 * `leg`, `12` as `[2` and `0` as `fe)`, all at confidences between 0.04 and 0.70, while the right column two
 * pixels inside its own edge read perfectly at 0.95. The margin is three percent of the table's own width, which
 * is far larger than the clipping it fixes and far smaller than the gap to anything else on the screen.
 */
const REGION_MARGIN = 0.05;
/**
 * How much of the fitted grid has to have a line actually seen on it.
 *
 * Without this the fit is trivially won by the smallest pitch that fits anything, because a fine pitch can always
 * place more parameters under a fixed set of lines. Half is comfortable for a real table, where the only missing
 * lines are the ones hidden behind glare or flat background, and out of reach for an accidental one.
 */
const MIN_GRID_COVERAGE = 0.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export interface RowBands {
  /** The y of each row's vertical centre, top to bottom. */
  centres: number[];
  /** The distance between consecutive lines, which is one row plus one line. */
  rowHeight: number;
  region: TableRegion;
}

/**
 * The row grid a table's lines sit on.
 *
 * `lines` is the fitted arithmetic progression rather than the lines that were actually seen, which is the whole
 * point: a separator that is invisible against a flat patch of background, or hidden behind a glare band or a
 * player, is still a row boundary and has to be there or the rows either side of it are merged into one.
 */
export interface TableGrid {
  lines: number[];
  lineSpacing: number;
  left: number;
  right: number;
}

/**
 * Fits the grid, or null when the lines do not form one.
 *
 * WHY THE OBVIOUS ALGORITHM IS NOT THIS ONE. Walking the lines in order and stopping at the first irregular gap
 * was tried and failed on both captures for the same reason: a real screen supplies EXTRA lines and MISSES lines.
 * A background edge that happens to be wide adds one; a separator against flat dark background is invisible and
 * removes one, and the clean capture loses exactly one in every three that way. A walk therefore stops early on
 * one capture and concatenates two unrelated objects on the other.
 *
 * So every plausible pitch is proposed instead, from the distance between every pair of lines divided by every
 * short count of rows it could stand for, and each proposal collects every line sitting on it and ignores the
 * ones that do not. Extra lines are simply not collected and a missing line leaves a hole that the fitted
 * progression then fills in.
 */
function fitTableGrid(edges: RowEdge[]): TableGrid | null {
  let bestLines: RowEdge[] = [];
  let bestPitch = 0;
  let bestAnchorY = 0;

  for (let anchorIndex = 0; anchorIndex < edges.length; anchorIndex += 1) {
    const anchor = edges[anchorIndex];
    for (let otherIndex = anchorIndex + 1; otherIndex < edges.length; otherIndex += 1) {
      const delta = edges[otherIndex].y - anchor.y;
      // "This distance is k rows", for small k. Large k would fit anything.
      for (let k = 1; k <= 8; k += 1) {
        const pitch = delta / k;
        if (pitch < MIN_ROW_HEIGHT || pitch > MAX_ROW_HEIGHT) continue;
        const tolerance = Math.max(2, pitch * RHYTHM_TOLERANCE);
        const matched = edges.filter((edge) => {
          const steps = Math.round((edge.y - anchor.y) / pitch);
          return steps >= 0 && Math.abs(edge.y - (anchor.y + steps * pitch)) <= tolerance;
        });
        if (
          matched.length > bestLines.length ||
          // Equal counts favour the WIDER pitch, so a grid is never oversegmented into rows that are not there.
          (matched.length === bestLines.length && pitch > bestPitch)
        ) {
          bestLines = matched;
          bestPitch = pitch;
          bestAnchorY = anchor.y;
        }
      }
    }
  }

  if (bestLines.length < MIN_RULES) return null;

  /**
   * A least squares refit over the matched lines' integer row indices.
   *
   * The proposal's pitch came from one pair of lines and carries their noise. The refit uses every line that
   * agreed with it, so the progression is pulled to the middle of them instead of to the pair that suggested it.
   * On the clean capture this moves the estimate from 33.0 to 32.7, which over fifteen rows is a 4 pixel error at
   * the bottom of the table and enough to put a label in the wrong band.
   */
  const steps = bestLines.map((edge) => Math.round((edge.y - bestAnchorY) / bestPitch));
  const count = bestLines.length;

  /**
   * How much of the grid a line was actually seen on.
   *
   * A fine pitch can always place more parameters under a fixed set of lines, so without this the fit is won by
   * the smallest pitch that fits anything: at twelve pixels it matched several real lines by accident and then
   * synthesised thirty four rows out of them.
   */
  const spanSteps = Math.max(...steps) + 1;
  if (count / spanSteps < MIN_GRID_COVERAGE) return null;

  const meanStep = steps.reduce((total, step) => total + step, 0) / count;
  const meanY = bestLines.reduce((total, edge) => total + edge.y, 0) / count;

  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    covariance += (steps[index] - meanStep) * (bestLines[index].y - meanY);
    variance += (steps[index] - meanStep) ** 2;
  }
  if (variance === 0) return null;

  const pitch = covariance / variance;
  if (pitch < MIN_ROW_HEIGHT || pitch > MAX_ROW_HEIGHT) return null;
  const first = meanY - pitch * meanStep;

  const lastStep = Math.max(...steps);

  /**
   * The grid is extended one step above and one below.
   *
   * This is the fix for a failure that looked like a label problem and was a grid problem. The first line the
   * detector sees on the clean capture is the separator UNDER the Possession row, not the table's top border,
   * because the top border sits against the dark background and does not register. Without the extension the
   * first row of the table has no band at all and Possession is silently absent, which then shifts every
   * cross-check that depends on the possession pair.
   *
   * Extending is safe in the other direction too: if the first line IS the top border, the extra row lands on the
   * group tab bar above the table, whose text matches no row label and is therefore skipped.
   */
  const lines: number[] = [];
  for (let step = -1; step <= lastStep + 1; step += 1) lines.push(Math.round(first + step * pitch));

  return {
    lines,
    lineSpacing: pitch,
    left: median(bestLines.map((edge) => edge.left)),
    right: median(bestLines.map((edge) => edge.right)),
  };
}

/**
 * Finds the table, or null when there is not one.
 *
 * Returns null rather than a guess, because a guess here produces plausible but wrong row boundaries and the
 * numbers read out of them would look like real figures. The caller says it could not find the table, which is
 * the honest outcome.
 */
export function detectTable(image: RgbaImage): RowBands | null {
  const { width, height } = image;
  const grid = fitTableGrid(scanRowEdges(image));
  if (grid === null) return null;

  const top = grid.lines[0];
  const bottom = grid.lines[grid.lines.length - 1];
  if (bottom - top < height * MIN_GROUP_SPAN_FRACTION) return null;

  const left = Math.max(0, Math.round(grid.left - (grid.right - grid.left) * REGION_MARGIN));
  const right = Math.min(width, Math.round(grid.right + (grid.right - grid.left) * REGION_MARGIN));
  if (right - left < width * MIN_RULE_WIDTH_FRACTION) return null;

  /**
   * The region is exactly the grid's extent, because the lines ARE the row boundaries: the outermost rows are the
   * ones between the first two lines and the last two, so the region needs no extra margin. The lines already
   * carry the extension above and below.
   */
  const regionTop = Math.max(0, top);
  const regionBottom = Math.min(height, bottom);

  const centres: number[] = [];
  for (let index = 0; index < grid.lines.length - 1; index += 1) {
    centres.push(Math.round((grid.lines[index] + grid.lines[index + 1]) / 2));
  }

  return {
    centres,
    rowHeight: grid.lineSpacing,
    region: { left, top: regionTop, width: right - left, height: regionBottom - regionTop },
  };
}

/**
 * A preprocessing variant. These are data so the harness can sweep them and the winner can be named by
 * measurement rather than by assumption.
 */
export interface PreprocessVariant {
  id: string;
  /**
   * Write saturated pixels as background before anything else happens, which removes the coloured side bars and a
   * good deal of the photograph behind the translucent panel.
   */
  suppressColour: boolean;
  /**
   * Stretch the luminance across the full range, using percentiles rather than the extremes.
   *
   * Percentiles because the extremes belong to the wrong things: a white player's bib or a black background
   * occupies the ends of the histogram, and stretching to THOSE compresses the text and the panel into a narrow
   * middle band.
   */
  normalise: boolean;
  /**
   * Keep only this brightest fraction of pixels, as white on black, or null to leave the grayscale alone.
   *
   * A QUANTILE rather than a fraction of the range. The panels are translucent, so a stadium, two players in
   * yellow bibs and a crowd all show through, and a cut placed at a fixed fraction of the range moves with
   * whatever the brightest object behind the panel happens to be. Asking for "the brightest twelve percent of
   * pixels" picks out the text on every row regardless of the background.
   */
  keepBrightest: number | null;
  /** The row height the table is scaled to. */
  targetRowHeight: number;
}

/**
 * The sweep.
 *
 * No variant inverts. The clean capture is dark text on a light panel while its flanking stat cards are the
 * opposite, and the photo is light text on dark, so any single global inversion breaks one of the two. That is a
 * measured fact from the captures, not a preference.
 *
 * The targets run above the measured row height for a small reason as well: a decimal point. At the clean
 * capture's native 33 pixel rows a full stop is one or two pixels tall.
 */
export const PREPROCESS_VARIANTS: readonly PreprocessVariant[] = [
  { id: "plain-40", suppressColour: false, normalise: false, keepBrightest: null, targetRowHeight: 40 },
  { id: "plain-64", suppressColour: false, normalise: false, keepBrightest: null, targetRowHeight: 64 },
  { id: "colour-40", suppressColour: true, normalise: false, keepBrightest: null, targetRowHeight: 40 },
  { id: "colour-64", suppressColour: true, normalise: false, keepBrightest: null, targetRowHeight: 64 },
  { id: "colour-40-b12", suppressColour: true, normalise: false, keepBrightest: 0.12, targetRowHeight: 40 },
  { id: "colour-64-b12", suppressColour: true, normalise: false, keepBrightest: 0.12, targetRowHeight: 64 },
  { id: "colour-40-b18", suppressColour: true, normalise: false, keepBrightest: 0.18, targetRowHeight: 40 },
  { id: "colour-normalise-40", suppressColour: true, normalise: true, keepBrightest: null, targetRowHeight: 40 },
  { id: "colour-normalise-64", suppressColour: true, normalise: true, keepBrightest: null, targetRowHeight: 64 },
  { id: "colour-normalise-40-b12", suppressColour: true, normalise: true, keepBrightest: 0.12, targetRowHeight: 40 },
];

export const DEFAULT_VARIANT_ID = "colour-64";

export function variantById(id: string): PreprocessVariant {
  return PREPROCESS_VARIANTS.find((variant) => variant.id === id) ?? PREPROCESS_VARIANTS[0];
}

/**
 * The table, scaled and adjusted, ready for the engine.
 *
 * The scale is derived from the measured row height, so both captures end up with the same glyph size whatever
 * the screen they came from, and it is allowed to grow as well as shrink, because both captures need growing.
 */
export function prepareTable(
  image: RgbaImage,
  bands: RowBands,
  variant: PreprocessVariant
): { image: RgbaImage; scale: number; region: TableRegion } {
  const { region, rowHeight } = bands;
  const scale = rowHeight > 0 ? variant.targetRowHeight / rowHeight : 1;
  const outWidth = Math.max(1, Math.round(region.width * scale));
  const outHeight = Math.max(1, Math.round(region.height * scale));

  const gray = toLuma(image, variant.suppressColour);
  const source = crop(gray, image.width, image.height, region);
  const scaled = scaleLuma(source, region.width, region.height, outWidth, outHeight);
  applyContrast(scaled, variant);

  return { image: lumaToRgba(scaled, outWidth, outHeight), scale, region };
}

function crop(gray: LumaPlane, width: number, height: number, region: TableRegion): LumaPlane {
  const out = new Uint8ClampedArray(region.width * region.height);
  for (let y = 0; y < region.height; y += 1) {
    const sourceY = Math.min(height - 1, region.top + y);
    const from = sourceY * width + region.left;
    out.set(gray.subarray(from, from + region.width), y * region.width);
  }
  return out;
}

/**
 * Bilinear scaling on one channel.
 *
 * Interpolating rather than nearest neighbour matters here because the step is an upscale of small text: a
 * nearest neighbour upscale reproduces the stair steps of a nine pixel glyph instead of smoothing them, and the
 * engine reads the stairs.
 */
function scaleLuma(
  source: LumaPlane,
  sourceWidth: number,
  sourceHeight: number,
  outWidth: number,
  outHeight: number
): LumaPlane {
  const out = new Uint8ClampedArray(outWidth * outHeight);
  const xRatio = sourceWidth / outWidth;
  const yRatio = sourceHeight / outHeight;

  for (let y = 0; y < outHeight; y += 1) {
    const sy = Math.min(sourceHeight - 1, y * yRatio);
    const y0 = Math.floor(sy);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < outWidth; x += 1) {
      const sx = Math.min(sourceWidth - 1, x * xRatio);
      const x0 = Math.floor(sx);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const wx = sx - x0;
      const top = source[y0 * sourceWidth + x0] * (1 - wx) + source[y0 * sourceWidth + x1] * wx;
      const bottom = source[y1 * sourceWidth + x0] * (1 - wx) + source[y1 * sourceWidth + x1] * wx;
      out[y * outWidth + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

/** The luminance values at two percentiles, which is a range the background cannot drag around. */
function percentileBounds(pixels: LumaPlane): { low: number; high: number } {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 1) histogram[pixels[i]] += 1;
  const lowTarget = pixels.length * 0.02;
  const highTarget = pixels.length * 0.98;
  let accumulated = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value];
    if (accumulated >= lowTarget) {
      low = value;
      break;
    }
  }
  accumulated = 0;
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value];
    if (accumulated >= highTarget) {
      high = value;
      break;
    }
  }
  return { low, high };
}

/** The luminance at or above which the brightest `keep` fraction of pixels sits. */
function quantileCut(pixels: LumaPlane, keep: number): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 1) histogram[pixels[i]] += 1;
  const target = pixels.length * keep;
  let accumulated = 0;
  for (let value = 255; value >= 0; value -= 1) {
    accumulated += histogram[value];
    if (accumulated >= target) return value;
  }
  return 0;
}

/**
 * A range stretch, and optionally a quantile binarisation.
 *
 * The stretch rescues a dim photograph of a screen by filling the range with what the table actually uses. The
 * binarisation throws away the photograph behind the translucent panel, which no amount of contrast tuning can
 * separate from white text.
 */
function applyContrast(pixels: LumaPlane, variant: PreprocessVariant): void {
  if (variant.normalise) {
    const { low, high } = percentileBounds(pixels);
    const span = high - low;
    if (span > 8) {
      for (let i = 0; i < pixels.length; i += 1) {
        pixels[i] = ((pixels[i] - low) / span) * 255;
      }
    }
  }

  if (variant.keepBrightest !== null) {
    // Computed after the stretch, so the quantile is taken over the range the engine will actually see.
    const cut = quantileCut(pixels, variant.keepBrightest);
    for (let i = 0; i < pixels.length; i += 1) {
      pixels[i] = pixels[i] >= cut ? 255 : 0;
    }
  }
}

/** One luminance plane back to RGBA, so the engine receives an ordinary image. */
function lumaToRgba(gray: LumaPlane, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    data[p] = gray[i];
    data[p + 1] = gray[i];
    data[p + 2] = gray[i];
    data[p + 3] = 255;
  }
  return { data, width, height };
}

/**
 * The whole preprocessing step, from a decoded image to the table the engine will read.
 *
 * Returns null when no table could be found, which the caller reports rather than papering over.
 */
export function preprocess(
  image: RgbaImage,
  variant: PreprocessVariant
): { image: RgbaImage; scale: number; region: TableRegion; bands: RowBands } | null {
  const bands = detectTable(image);
  if (!bands) return null;
  const prepared = prepareTable(image, bands, variant);
  return { ...prepared, bands };
}

/** A vertical slice of an image, used to hand one column to the engine on its own. */
export function cropColumns<K extends string>(
  image: RgbaImage,
  columns: Record<K, readonly [number, number]>
): Array<{ id: K; image: RgbaImage; offsetX: number }> {
  return (Object.entries(columns) as Array<[K, readonly [number, number]]>).map(([id, [from, to]]) => {
    const x0 = Math.max(0, Math.floor(from * image.width));
    const x1 = Math.min(image.width, Math.ceil(to * image.width));
    const width = Math.max(1, x1 - x0);
    const data = new Uint8ClampedArray(width * image.height * 4);
    for (let y = 0; y < image.height; y += 1) {
      const sourceStart = (y * image.width + x0) * 4;
      data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
    }
    return { id, image: { data, width, height: image.height }, offsetX: x0 };
  });
}
