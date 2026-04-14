/*
 * ==========================================================================
 * VisionTranslate — Canvas Overlay Rendering Engine (overlay.js)
 * ==========================================================================
 *
 * This module handles the visual rendering of translated text on top of
 * images. It is the most visually complex part of the extension.
 *
 * HIGH-LEVEL APPROACH:
 * --------------------
 * For each image, we have:
 *   - A list of OCR results: bounding boxes where text was detected,
 *     along with the original text and a confidence score.
 *   - A list of translations: the translated text for each bounding box.
 *   - A <canvas> element positioned exactly on top of the original image.
 *
 * For each text block, we:
 *   1. Sample the background color around the bounding box edges to
 *      determine what color the original background is.
 *   2. Fill a rectangle over the original text with that sampled color,
 *      effectively "erasing" the original text visually.
 *   3. Auto-size a font to fit the translated text within the bounding box.
 *   4. Detect if the text should be rendered vertically (common for CJK
 *      languages like Chinese, Japanese, Korean when height > width * 1.5).
 *   5. Render the translated text centered in the bounding box.
 *   6. Optionally draw a confidence-colored border around the box.
 *
 * WHY CANVAS (not DOM overlays)?
 * ------------------------------
 * We use canvas instead of positioned DOM elements because:
 *   - Canvas can match the exact pixel coordinates from OCR.
 *   - No risk of page CSS interfering with text styling.
 *   - Better performance with many text blocks (one draw vs. many DOM nodes).
 *   - Easier to sample colors from the original image.
 *   - Smoother rendering for rotated or non-standard text layouts.
 *
 * COORDINATE SYSTEM:
 * ------------------
 * OCR bounding boxes use coordinates relative to the ORIGINAL image size
 * (naturalWidth x naturalHeight). But the canvas might be sized to the
 * DISPLAYED size (CSS width x height), which could be different.
 *
 * We handle this by computing a scale factor:
 *   scaleX = canvas CSS width / image natural width
 *   scaleY = canvas CSS height / image natural height
 *
 * All OCR coordinates are multiplied by these factors before drawing.
 * The DPR (device pixel ratio) scaling is already handled by the canvas
 * context in content.js (ctx.scale(dpr, dpr)), so we work in CSS pixels.
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Background Color Sampling Algorithm
 * --------------------------------------------------------------------------
 * To "erase" the original text, we need to know what color is behind it.
 * We sample pixels around the EDGES of the bounding box (not from inside,
 * because inside is where the text is and would give us the text color).
 *
 * Sampling strategy:
 *   1. Sample N points along each of the 4 edges of the bounding box,
 *      but slightly OUTSIDE the box (2px offset).
 *   2. Collect all sampled colors.
 *   3. Find the most common color (mode) — this handles cases where some
 *      edge pixels are part of other text or decorations.
 *   4. Fall back to the average color if no clear mode exists.
 *
 *        samples along top edge (offset upward by 2px)
 *   ─── · · · · · · · · · · ───
 *   │                           │ ← samples along right edge
 *   │    [original text here]   │
 *   │                           │ ← samples along left edge
 *   ─── · · · · · · · · · · ───
 *        samples along bottom edge (offset downward by 2px)
 *
 * @param {CanvasRenderingContext2D} ctx
 *        The canvas 2D context. IMPORTANT: This must be the context of a
 *        canvas that has the ORIGINAL IMAGE drawn on it (not the overlay
 *        canvas). We create a temporary canvas for this purpose.
 *
 * @param {number} x      — Left edge of bounding box (in canvas coords)
 * @param {number} y      — Top edge of bounding box (in canvas coords)
 * @param {number} width  — Width of bounding box (in canvas coords)
 * @param {number} height — Height of bounding box (in canvas coords)
 *
 * @returns {{r: number, g: number, b: number, a: number}}
 *          The estimated background color as RGBA values (0-255 each).
 */
function sampleBackgroundColor(ctx, x, y, width, height) {
  /*
   * Number of sample points along each edge. More points = more
   * accurate but slower. 10 is a good balance for most images.
   */
  const SAMPLES_PER_EDGE = 10;

  /*
   * How far outside the bounding box to sample (in pixels).
   * We go slightly outside because the box edges might clip text.
   */
  const OFFSET = 2;

  /*
   * Get the canvas dimensions for bounds checking. We must not
   * sample outside the canvas boundaries.
   */
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  /*
   * Collect all sampled colors. Each entry is an {r, g, b, a} object.
   */
  const samples = [];

  /*
   * Helper: Sample a single pixel and add it to our collection.
   * getImageData(x, y, 1, 1) returns a 1x1 pixel's RGBA data as
   * a Uint8ClampedArray of length 4: [red, green, blue, alpha].
   *
   * We clamp coordinates to canvas bounds to avoid errors.
   */
  function samplePixel(px, py) {
    /* Clamp to canvas bounds */
    const sx = Math.max(0, Math.min(Math.round(px), canvasWidth - 1));
    const sy = Math.max(0, Math.min(Math.round(py), canvasHeight - 1));

    try {
      const pixel = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2],
        a: pixel[3]
      });
    } catch (e) {
      /*
       * getImageData can throw SecurityError if the canvas is tainted
       * (contains cross-origin image data). In that case, we fall back
       * to a default color later.
       */
    }
  }

  /*
   * Sample along the TOP edge (y - OFFSET):
   * Spread SAMPLES_PER_EDGE points evenly across the width.
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y - OFFSET;
    samplePixel(px, py);
  }

  /*
   * Sample along the BOTTOM edge (y + height + OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y + height + OFFSET;
    samplePixel(px, py);
  }

  /*
   * Sample along the LEFT edge (x - OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x - OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  /*
   * Sample along the RIGHT edge (x + width + OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + width + OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  /*
   * If we couldn't sample any pixels (canvas tainted or empty box),
   * return white as a safe default.
   */
  if (samples.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  /*
   * Find the most common color using a frequency map.
   * We quantize colors to reduce the number of unique values:
   * round each channel to the nearest multiple of 8. This groups
   * very similar colors together (e.g., rgb(200,200,200) and
   * rgb(203,201,199) become the same bucket).
   *
   * Why quantize? Real images have slight color variations due to
   * compression artifacts, anti-aliasing, and gradients. Without
   * quantization, every pixel would be "unique" and there would be
   * no clear mode.
   */
  const QUANT = 8; /* Quantization step */
  const colorBuckets = new Map();

  for (const sample of samples) {
    const qr = Math.round(sample.r / QUANT) * QUANT;
    const qg = Math.round(sample.g / QUANT) * QUANT;
    const qb = Math.round(sample.b / QUANT) * QUANT;
    const key = `${qr},${qg},${qb}`;

    if (colorBuckets.has(key)) {
      const bucket = colorBuckets.get(key);
      bucket.count++;
      /* Accumulate actual (non-quantized) values for averaging within bucket */
      bucket.totalR += sample.r;
      bucket.totalG += sample.g;
      bucket.totalB += sample.b;
      bucket.totalA += sample.a;
    } else {
      colorBuckets.set(key, {
        count: 1,
        totalR: sample.r,
        totalG: sample.g,
        totalB: sample.b,
        totalA: sample.a
      });
    }
  }

  /*
   * Find the bucket with the highest count (the mode).
   * Then compute the average color within that bucket for accuracy.
   */
  let bestBucket = null;
  let bestCount = 0;

  for (const bucket of colorBuckets.values()) {
    if (bucket.count > bestCount) {
      bestCount = bucket.count;
      bestBucket = bucket;
    }
  }

  return {
    r: Math.round(bestBucket.totalR / bestBucket.count),
    g: Math.round(bestBucket.totalG / bestBucket.count),
    b: Math.round(bestBucket.totalB / bestBucket.count),
    a: Math.round(bestBucket.totalA / bestBucket.count)
  };
}

function getImageDataRect(ctx, x, y, width, height) {
  const maxX = ctx.canvas.width;
  const maxY = ctx.canvas.height;
  const clampedX = clamp(Math.floor(x), 0, maxX);
  const clampedY = clamp(Math.floor(y), 0, maxY);
  const clampedRight = clamp(Math.ceil(x + width), clampedX, maxX);
  const clampedBottom = clamp(Math.ceil(y + height), clampedY, maxY);
  const clampedWidth = clampedRight - clampedX;
  const clampedHeight = clampedBottom - clampedY;

  if (clampedWidth < 1 || clampedHeight < 1) {
    return null;
  }

  try {
    return {
      x: clampedX,
      y: clampedY,
      width: clampedWidth,
      height: clampedHeight,
      imageData: ctx.getImageData(clampedX, clampedY, clampedWidth, clampedHeight)
    };
  } catch (_error) {
    return null;
  }
}

function colorDistance(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 +
    (a.g - b.g) ** 2 +
    (a.b - b.b) ** 2
  );
}

function sampleDominantRegionColor(ctx, x, y, width, height) {
  const inset = Math.max(2, Math.min(width, height) * 0.1);
  const primaryRegion =
    getImageDataRect(ctx, x + inset, y + inset, width - inset * 2, height - inset * 2) ||
    getImageDataRect(ctx, x, y, width, height);

  if (!primaryRegion) {
    return null;
  }

  const {
    imageData: { data, width: regionWidth, height: regionHeight }
  } = primaryRegion;
  const sampleStepX = Math.max(1, Math.floor(regionWidth / 24));
  const sampleStepY = Math.max(1, Math.floor(regionHeight / 24));
  const quantizationStep = 10;
  const buckets = new Map();

  for (let py = 0; py < regionHeight; py += sampleStepY) {
    for (let px = 0; px < regionWidth; px += sampleStepX) {
      const idx = (py * regionWidth + px) * 4;
      const alpha = data[idx + 3];

      if (alpha < 16) {
        continue;
      }

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const key = [
        Math.round(r / quantizationStep) * quantizationStep,
        Math.round(g / quantizationStep) * quantizationStep,
        Math.round(b / quantizationStep) * quantizationStep
      ].join(',');

      if (!buckets.has(key)) {
        buckets.set(key, {
          count: 0,
          totalR: 0,
          totalG: 0,
          totalB: 0,
          totalA: 0
        });
      }

      const bucket = buckets.get(key);
      bucket.count++;
      bucket.totalR += r;
      bucket.totalG += g;
      bucket.totalB += b;
      bucket.totalA += alpha;
    }
  }

  if (!buckets.size) {
    return null;
  }

  let bestBucket = null;

  for (const bucket of buckets.values()) {
    if (!bestBucket || bucket.count > bestBucket.count) {
      bestBucket = bucket;
    }
  }

  return {
    r: Math.round(bestBucket.totalR / bestBucket.count),
    g: Math.round(bestBucket.totalG / bestBucket.count),
    b: Math.round(bestBucket.totalB / bestBucket.count),
    a: Math.round(bestBucket.totalA / bestBucket.count)
  };
}

function measureRegionSimilarity(ctx, x, y, width, height, referenceColor) {
  const region = getImageDataRect(ctx, x, y, width, height);

  if (!region || !referenceColor) {
    return 0;
  }

  const {
    imageData: { data, width: regionWidth, height: regionHeight }
  } = region;
  const sampleStepX = Math.max(1, Math.floor(regionWidth / 12));
  const sampleStepY = Math.max(1, Math.floor(regionHeight / 12));
  let totalSamples = 0;
  let similarSamples = 0;

  for (let py = 0; py < regionHeight; py += sampleStepY) {
    for (let px = 0; px < regionWidth; px += sampleStepX) {
      const idx = (py * regionWidth + px) * 4;
      const alpha = data[idx + 3];

      if (alpha < 16) {
        continue;
      }

      totalSamples++;

      const distance = colorDistance(
        referenceColor,
        { r: data[idx], g: data[idx + 1], b: data[idx + 2] }
      );

      if (distance <= 44) {
        similarSamples++;
      }
    }
  }

  if (!totalSamples) {
    return 0;
  }

  return similarSamples / totalSamples;
}

function scanContainerBoundary(ctx, box, referenceColor, direction, displayWidth, displayHeight) {
  const step = 2;
  const isHorizontalScan = direction === 'left' || direction === 'right';
  const axisSize = isHorizontalScan ? box.width : box.height;
  const orthogonalSize = isHorizontalScan ? box.height : box.width;
  const maxExpansion = Math.round(
    Math.min(
      Math.max(axisSize * 1.35, 18),
      84,
      isHorizontalScan ? displayWidth : displayHeight
    )
  );
  const orthogonalInset = Math.min(
    Math.max(4, orthogonalSize * 0.14),
    Math.max(0, orthogonalSize / 2 - 2)
  );
  const stripSpan = Math.max(4, orthogonalSize - orthogonalInset * 2);
  let lastInteriorEdge =
    direction === 'left' || direction === 'top'
      ? (direction === 'left' ? box.x : box.y)
      : (direction === 'right' ? box.x + box.width : box.y + box.height);
  let misses = 0;

  for (let offset = step; offset <= maxExpansion; offset += step) {
    let stripX = box.x;
    let stripY = box.y;
    let stripWidth = box.width;
    let stripHeight = box.height;

    if (direction === 'left') {
      stripX = box.x - offset;
      stripY = box.y + orthogonalInset;
      stripWidth = step;
      stripHeight = stripSpan;
    } else if (direction === 'right') {
      stripX = box.x + box.width + offset - step;
      stripY = box.y + orthogonalInset;
      stripWidth = step;
      stripHeight = stripSpan;
    } else if (direction === 'top') {
      stripX = box.x + orthogonalInset;
      stripY = box.y - offset;
      stripWidth = stripSpan;
      stripHeight = step;
    } else {
      stripX = box.x + orthogonalInset;
      stripY = box.y + box.height + offset - step;
      stripWidth = stripSpan;
      stripHeight = step;
    }

    const similarity = measureRegionSimilarity(
      ctx,
      stripX,
      stripY,
      stripWidth,
      stripHeight,
      referenceColor
    );

    if (similarity >= 0.6) {
      if (direction === 'left') {
        lastInteriorEdge = stripX;
      } else if (direction === 'right') {
        lastInteriorEdge = stripX + stripWidth;
      } else if (direction === 'top') {
        lastInteriorEdge = stripY;
      } else {
        lastInteriorEdge = stripY + stripHeight;
      }
      misses = 0;
      continue;
    }

    misses++;

    if (misses >= 2) {
      return {
        edge: lastInteriorEdge,
        boundaryFound: true
      };
    }
  }

  return {
    edge: lastInteriorEdge,
    boundaryFound: false
  };
}

function insetBox(box, inset) {
  const safeInset = clamp(
    inset,
    0,
    Math.max(0, Math.min(box.width / 2 - 1, box.height / 2 - 1))
  );

  return {
    x: box.x + safeInset,
    y: box.y + safeInset,
    width: Math.max(1, box.width - safeInset * 2),
    height: Math.max(1, box.height - safeInset * 2)
  };
}

function insetBoxBySide(box, insets = {}) {
  const leftInset = Math.max(0, Number(insets.left) || 0);
  const rightInset = Math.max(0, Number(insets.right) || 0);
  const topInset = Math.max(0, Number(insets.top) || 0);
  const bottomInset = Math.max(0, Number(insets.bottom) || 0);
  const maxHorizontalInset = Math.max(0, box.width - 1);
  const maxVerticalInset = Math.max(0, box.height - 1);
  const horizontalScale =
    leftInset + rightInset > maxHorizontalInset && leftInset + rightInset > 0
      ? maxHorizontalInset / (leftInset + rightInset)
      : 1;
  const verticalScale =
    topInset + bottomInset > maxVerticalInset && topInset + bottomInset > 0
      ? maxVerticalInset / (topInset + bottomInset)
      : 1;
  const safeLeftInset = leftInset * horizontalScale;
  const safeRightInset = rightInset * horizontalScale;
  const safeTopInset = topInset * verticalScale;
  const safeBottomInset = bottomInset * verticalScale;

  return {
    x: box.x + safeLeftInset,
    y: box.y + safeTopInset,
    width: Math.max(1, box.width - safeLeftInset - safeRightInset),
    height: Math.max(1, box.height - safeTopInset - safeBottomInset)
  };
}

function expandBox(box, padding, maxWidth, maxHeight) {
  const safePadding = Math.max(0, padding);
  const left = clamp(box.x - safePadding, 0, maxWidth);
  const top = clamp(box.y - safePadding, 0, maxHeight);
  const right = clamp(box.x + box.width + safePadding, left + 1, maxWidth);
  const bottom = clamp(box.y + box.height + safePadding, top + 1, maxHeight);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function intersectBoxes(primaryBox, clipBox) {
  const left = Math.max(primaryBox.x, clipBox.x);
  const top = Math.max(primaryBox.y, clipBox.y);
  const right = Math.min(primaryBox.x + primaryBox.width, clipBox.x + clipBox.width);
  const bottom = Math.min(primaryBox.y + primaryBox.height, clipBox.y + clipBox.height);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function resolveContainerBoxes(ctx, box, displayWidth, displayHeight) {
  const initialFillColor =
    sampleDominantRegionColor(ctx, box.x, box.y, box.width, box.height) ||
    sampleBackgroundColor(ctx, box.x, box.y, box.width, box.height);
  const left = scanContainerBoundary(ctx, box, initialFillColor, 'left', displayWidth, displayHeight);
  const right = scanContainerBoundary(ctx, box, initialFillColor, 'right', displayWidth, displayHeight);
  const top = scanContainerBoundary(ctx, box, initialFillColor, 'top', displayWidth, displayHeight);
  const bottom = scanContainerBoundary(ctx, box, initialFillColor, 'bottom', displayWidth, displayHeight);
  const rawLeft = left.boundaryFound ? left.edge : box.x;
  const rawTop = top.boundaryFound ? top.edge : box.y;
  const rawRight = right.boundaryFound ? right.edge : box.x + box.width;
  const rawBottom = bottom.boundaryFound ? bottom.edge : box.y + box.height;
  const containerLeft = clamp(Math.min(rawLeft, rawRight - 1), 0, Math.max(0, displayWidth - 1));
  const containerTop = clamp(Math.min(rawTop, rawBottom - 1), 0, Math.max(0, displayHeight - 1));
  const containerRight = clamp(Math.max(rawRight, containerLeft + 1), containerLeft + 1, displayWidth);
  const containerBottom = clamp(Math.max(rawBottom, containerTop + 1), containerTop + 1, displayHeight);
  const containerBox = {
    x: containerLeft,
    y: containerTop,
    width: Math.max(1, containerRight - containerLeft),
    height: Math.max(1, containerBottom - containerTop)
  };
  const boundaryCount = [
    left.boundaryFound,
    right.boundaryFound,
    top.boundaryFound,
    bottom.boundaryFound
  ].filter(Boolean).length;
  const fillColor =
    sampleDominantRegionColor(
      ctx,
      containerBox.x,
      containerBox.y,
      containerBox.width,
      containerBox.height
    ) || initialFillColor;
  const cleanupBorderInset = boundaryCount
    ? Math.max(1.5, Math.min(containerBox.width, containerBox.height) * 0.012)
    : 0;
  const renderInset = boundaryCount
    ? Math.max(6, Math.min(containerBox.width, containerBox.height) * 0.08)
    : Math.max(4, Math.min(containerBox.width, containerBox.height) * 0.05);
  const cleanupClipBox = insetBoxBySide(containerBox, {
    left: left.boundaryFound ? cleanupBorderInset : 0,
    right: right.boundaryFound ? cleanupBorderInset : 0,
    top: top.boundaryFound ? cleanupBorderInset : 0,
    bottom: bottom.boundaryFound ? cleanupBorderInset : 0
  });
  const renderBox = insetBoxBySide(containerBox, {
    left: left.boundaryFound ? renderInset : Math.max(2, renderInset * 0.45),
    right: right.boundaryFound ? renderInset : Math.max(2, renderInset * 0.45),
    top: top.boundaryFound ? renderInset : Math.max(2, renderInset * 0.45),
    bottom: bottom.boundaryFound ? renderInset : Math.max(2, renderInset * 0.45)
  });

  return {
    containerBox,
    cleanupClipBox,
    renderBox,
    fillColor,
    boundaryCount
  };
}

/*
 * --------------------------------------------------------------------------
 * Contrast Color Helper
 * --------------------------------------------------------------------------
 * Given a background color, returns black or white — whichever provides
 * better contrast for readability.
 *
 * Uses the W3C relative luminance formula:
 *   L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R, G, B are linearized (gamma-corrected) values.
 *
 * If the luminance is above 0.5, the background is "light" and we
 * return black text. Otherwise, white text.
 *
 * @param {{r: number, g: number, b: number}} color — RGB color (0-255)
 * @returns {string} — "black" or "white"
 */
function getContrastColor(color) {
  /*
   * Linearize: convert from sRGB to linear RGB.
   * sRGB has a gamma curve; we need to undo it for accurate luminance.
   * For simplicity we use the common approximation: (value / 255)^2.2
   */
  const r = Math.pow(color.r / 255, 2.2);
  const g = Math.pow(color.g / 255, 2.2);
  const b = Math.pow(color.b / 255, 2.2);

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /* 0.179 is the threshold where 4.5:1 contrast ratio is achieved with both black and white */
  return luminance > 0.179 ? 'black' : 'white';
}

/*
 * --------------------------------------------------------------------------
 * Confidence Border Color
 * --------------------------------------------------------------------------
 * Returns a color representing the OCR confidence level:
 *   - Green  (>= 0.8): High confidence — the OCR is very sure about the text
 *   - Yellow (>= 0.5): Medium confidence — might have errors
 *   - Red    (< 0.5):  Low confidence — likely incorrect, user should verify
 *
 * @param {number} confidence — Value between 0 and 1
 * @returns {string} — CSS color string
 */
function getConfidenceBorderColor(confidence) {
  if (confidence >= 0.8) {
    return 'rgba(76, 175, 80, 0.7)';   /* Green — Material Design green */
  } else if (confidence >= 0.5) {
    return 'rgba(255, 193, 7, 0.7)';    /* Yellow/Amber */
  } else {
    return 'rgba(244, 67, 54, 0.7)';    /* Red */
  }
}

const DEBUG_RENDER_LOGS = true;
const DEBUG_DRAW_OVERLAYS = false;

export const OCR_BLOCK_TUNING = {
  paragraphMergeGapMultiplier: 1.35,
  paragraphMergeGapPx: 18,
  sameLineOverlapRatio: 0.55,
  sameLineGapMultiplier: 1.8,
  sameLineGapPx: 24,
  columnOverlapRatio: 0.2,
  edgeAlignmentToleranceMultiplier: 0.9,
  edgeAlignmentTolerancePx: 24,
  centerAlignmentToleranceRatio: 0.18,
  centerAlignmentTolerancePx: 24
};

export const TEXT_RENDER_TUNING = {
  maskPaddingPx: 1,
  maskPaddingRatio: 0.02,
  innerPaddingPx: 2,
  innerPaddingRatio: 0.04,
  minFontSize: 8,
  maxFontSize: 72,
  minLineHeight: 1.08,
  maxLineHeight: 1.3,
  titleCenterWordThreshold: 10
};

const OVERLAY_FONT_STACKS = {
  sans:
    '"Segoe UI", "Helvetica Neue", "Arial Nova", Arial, "Noto Sans", "Noto Sans CJK SC", sans-serif',
  serif:
    '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, "Times New Roman", serif',
  manga:
    '"Comic Neue", "Trebuchet MS", Verdana, "Noto Sans", "Noto Sans CJK SC", sans-serif',
  mono:
    '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, "Liberation Mono", monospace'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveOverlayFontFamily(settings = {}) {
  const fontPreference = settings.overlayFontFamily || settings.fontOverride || 'sans';
  return OVERLAY_FONT_STACKS[fontPreference] || fontPreference;
}

function resolveOverlayMinFontSize(settings = {}) {
  const parsed = Number(settings.overlayMinFontSize);
  if (!Number.isFinite(parsed)) {
    return TEXT_RENDER_TUNING.minFontSize;
  }
  return clamp(parsed, TEXT_RENDER_TUNING.minFontSize, 24);
}

function resolveOverlayAlignment(block, settings = {}) {
  const preferredAlignment = settings.overlayTextAlign;
  if (preferredAlignment === 'left' || preferredAlignment === 'center' || preferredAlignment === 'right') {
    return preferredAlignment;
  }
  return block.alignment || 'left';
}

function rangeOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function rangeOverlapRatio(startA, endA, startB, endB) {
  const minSpan = Math.max(1, Math.min(endA - startA, endB - startB));
  return rangeOverlap(startA, endA, startB, endB) / minSpan;
}

function rangeGap(startA, endA, startB, endB) {
  if (endA < startB) return startB - endA;
  if (endB < startA) return startA - endB;
  return 0;
}

function getBoxRight(box) {
  return box.x + box.width;
}

function getBoxBottom(box) {
  return box.y + box.height;
}

function unionBoxes(boxes) {
  if (!boxes.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => getBoxRight(box)));
  const maxY = Math.max(...boxes.map((box) => getBoxBottom(box)));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function detectCJK(text) {
  return /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);
}

function shouldInsertSpace(previousText, nextText) {
  if (!previousText || !nextText) return false;
  if (detectCJK(previousText) || detectCJK(nextText)) return false;
  if (/[-/]$/.test(previousText)) return false;
  if (/^[,.;:!?%)}\]]/.test(nextText)) return false;
  return true;
}

function getReadingOrderComparator(orientation) {
  if (orientation === 'vertical') {
    return (a, b) => {
      const xDiff = b.bbox.x - a.bbox.x;
      if (Math.abs(xDiff) > 4) return xDiff;
      return a.bbox.y - b.bbox.y;
    };
  }

  return (a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) > 4) return yDiff;
    return a.bbox.x - b.bbox.x;
  };
}

function clusterMembersByLine(members, orientation) {
  if (!members.length) return [];

  const comparator = getReadingOrderComparator(orientation);
  const sorted = [...members].sort(comparator);
  const groups = [];

  for (const member of sorted) {
    const box = member.bbox;
    let placed = false;

    for (const group of groups) {
      const groupBox = unionBoxes(group.map((item) => item.bbox));
      const sameLine =
        orientation === 'vertical'
          ? rangeOverlapRatio(groupBox.x, getBoxRight(groupBox), box.x, getBoxRight(box)) >= 0.45
          : rangeOverlapRatio(groupBox.y, getBoxBottom(groupBox), box.y, getBoxBottom(box)) >= 0.45;

      if (sameLine) {
        group.push(member);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push([member]);
    }
  }

  return groups.map((group) => [...group].sort(comparator));
}

function detectBlockAlignment(members, orientation, bbox) {
  if (orientation === 'vertical') {
    return 'center';
  }

  const lineGroups = clusterMembersByLine(members, orientation).map((group) =>
    unionBoxes(group.map((item) => item.bbox))
  );

  if (lineGroups.length <= 1) {
    const wordCount = members[0]?.text?.trim().split(/\s+/).filter(Boolean).length || 0;
    if (
      wordCount > 0 &&
      wordCount <= TEXT_RENDER_TUNING.titleCenterWordThreshold &&
      bbox.width > bbox.height * 2.4
    ) {
      return 'center';
    }
    return 'left';
  }

  const leftValues = lineGroups.map((lineBox) => lineBox.x);
  const rightValues = lineGroups.map((lineBox) => getBoxRight(lineBox));
  const centerValues = lineGroups.map((lineBox) => lineBox.x + lineBox.width / 2);
  const tolerance = Math.max(12, bbox.width * 0.12);

  const leftSpread = Math.max(...leftValues) - Math.min(...leftValues);
  const rightSpread = Math.max(...rightValues) - Math.min(...rightValues);
  const centerSpread = Math.max(...centerValues) - Math.min(...centerValues);

  if (centerSpread <= tolerance && leftSpread > tolerance * 0.8 && rightSpread > tolerance * 0.8) {
    return 'center';
  }

  if (leftSpread <= tolerance) {
    return 'left';
  }

  if (rightSpread <= tolerance) {
    return 'right';
  }

  return 'left';
}

function getAxisMetrics(box, orientation) {
  if (orientation === 'vertical') {
    return {
      flowStart: box.x,
      flowEnd: getBoxRight(box),
      flowSize: box.width,
      lineStart: box.y,
      lineEnd: getBoxBottom(box),
      lineSize: box.height
    };
  }

  return {
    flowStart: box.y,
    flowEnd: getBoxBottom(box),
    flowSize: box.height,
    lineStart: box.x,
    lineEnd: getBoxRight(box),
    lineSize: box.width
  };
}

function canMergeBlocks(a, b) {
  const aIsVertical = a.orientation === 'vertical';
  const bIsVertical = b.orientation === 'vertical';

  if (aIsVertical !== bIsVertical) {
    return false;
  }

  const orientation = aIsVertical ? 'vertical' : 'horizontal';
  const aAxis = getAxisMetrics(a.bbox, orientation);
  const bAxis = getAxisMetrics(b.bbox, orientation);
  const lineOverlapRatio = rangeOverlapRatio(
    aAxis.lineStart,
    aAxis.lineEnd,
    bAxis.lineStart,
    bAxis.lineEnd
  );
  const flowOverlapRatio = rangeOverlapRatio(
    aAxis.flowStart,
    aAxis.flowEnd,
    bAxis.flowStart,
    bAxis.flowEnd
  );
  const lineGap = rangeGap(aAxis.lineStart, aAxis.lineEnd, bAxis.lineStart, bAxis.lineEnd);
  const flowGap = rangeGap(aAxis.flowStart, aAxis.flowEnd, bAxis.flowStart, bAxis.flowEnd);
  const averageFlowSize = (aAxis.flowSize + bAxis.flowSize) / 2;
  const edgeTolerance = Math.max(
    OCR_BLOCK_TUNING.edgeAlignmentTolerancePx,
    averageFlowSize * OCR_BLOCK_TUNING.edgeAlignmentToleranceMultiplier
  );
  const centerTolerance = Math.max(
    OCR_BLOCK_TUNING.centerAlignmentTolerancePx,
    Math.min(aAxis.lineSize, bAxis.lineSize) * OCR_BLOCK_TUNING.centerAlignmentToleranceRatio
  );
  const sameLine =
    flowOverlapRatio >= OCR_BLOCK_TUNING.sameLineOverlapRatio &&
    lineGap <= Math.max(
      OCR_BLOCK_TUNING.sameLineGapPx,
      averageFlowSize * OCR_BLOCK_TUNING.sameLineGapMultiplier
    );

  if (sameLine) {
    return true;
  }

  const alignedAlongLine =
    lineOverlapRatio >= OCR_BLOCK_TUNING.columnOverlapRatio ||
    Math.abs(aAxis.lineStart - bAxis.lineStart) <= edgeTolerance ||
    Math.abs(aAxis.lineEnd - bAxis.lineEnd) <= edgeTolerance ||
    Math.abs((aAxis.lineStart + aAxis.lineEnd) / 2 - (bAxis.lineStart + bAxis.lineEnd) / 2) <= centerTolerance;

  return (
    alignedAlongLine &&
    flowGap <= Math.max(
      OCR_BLOCK_TUNING.paragraphMergeGapPx,
      averageFlowSize * OCR_BLOCK_TUNING.paragraphMergeGapMultiplier
    )
  );
}

function joinGroupText(members, orientation) {
  const sorted = [...members].sort(getReadingOrderComparator(orientation));
  let combined = '';
  let previous = '';

  for (const member of sorted) {
    const nextText = String(member.text || '').replace(/\s+/g, ' ').trim();
    if (!nextText) continue;

    if (!combined) {
      combined = nextText;
      previous = nextText;
      continue;
    }

    combined += shouldInsertSpace(previous, nextText) ? ` ${nextText}` : nextText;
    previous = nextText;
  }

  return combined.trim();
}

function normalizeRawBlock(rawBlock, index) {
  const bbox = rawBlock?.bbox || {};
  const width = Math.max(0, Number(bbox.width) || 0);
  const height = Math.max(0, Number(bbox.height) || 0);

  return {
    id: index,
    text: String(rawBlock?.text || '').trim(),
    confidence: Number(rawBlock?.confidence) || 0,
    orientation: rawBlock?.orientation === 'vertical' ? 'vertical' : 'horizontal',
    bbox: {
      x: Number(bbox.x) || 0,
      y: Number(bbox.y) || 0,
      width,
      height
    }
  };
}

export function groupTextBlocks(ocrResults = []) {
  const normalized = ocrResults
    .map(normalizeRawBlock)
    .filter((block) => block.text && block.bbox.width > 1 && block.bbox.height > 1);

  if (normalized.length <= 1) {
    return normalized.map((block, index) => ({
      ...block,
      id: `block-${index}`,
      rawIds: [block.id],
      rawBoxes: [block.bbox],
      alignment: detectBlockAlignment([block], block.orientation, block.bbox),
      members: [block]
    }));
  }

  const parent = normalized.map((_, index) => index);

  function find(index) {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }
    return parent[index];
  }

  function union(aIndex, bIndex) {
    const rootA = find(aIndex);
    const rootB = find(bIndex);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (canMergeBlocks(normalized[i], normalized[j])) {
        union(i, j);
      }
    }
  }

  const groups = new Map();

  normalized.forEach((block, index) => {
    const root = find(index);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(block);
  });

  const mergedBlocks = [...groups.values()]
    .map((members, index) => {
      const verticalCount = members.filter((member) => member.orientation === 'vertical').length;
      const orientation = verticalCount > members.length / 2 ? 'vertical' : 'horizontal';
      const bbox = unionBoxes(members.map((member) => member.bbox));
      const confidence =
        members.reduce((sum, member) => sum + member.confidence, 0) / Math.max(1, members.length);

      return {
        id: `block-${index}`,
        text: joinGroupText(members, orientation),
        confidence,
        orientation,
        bbox,
        alignment: detectBlockAlignment(members, orientation, bbox),
        rawIds: members.map((member) => member.id),
        rawBoxes: members.map((member) => member.bbox),
        members
      };
    })
    .filter((block) => block.text.length > 0)
    .sort(getReadingOrderComparator('horizontal'));

  if (DEBUG_RENDER_LOGS) {
    console.groupCollapsed(
      `[VisionTranslate Overlay] Grouped ${normalized.length} OCR boxes into ${mergedBlocks.length} text blocks`
    );
    console.table(
      normalized.map((block) => ({
        id: block.id,
        text: block.text,
        x: Math.round(block.bbox.x),
        y: Math.round(block.bbox.y),
        width: Math.round(block.bbox.width),
        height: Math.round(block.bbox.height),
        orientation: block.orientation
      }))
    );
    console.table(
      mergedBlocks.map((block) => ({
        id: block.id,
        text: block.text,
        x: Math.round(block.bbox.x),
        y: Math.round(block.bbox.y),
        width: Math.round(block.bbox.width),
        height: Math.round(block.bbox.height),
        alignment: block.alignment,
        rawCount: block.rawIds.length
      }))
    );
    console.groupEnd();
  }

  return mergedBlocks;
}

function normalizeTranslationText(text) {
  return String(text || '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function endsWithSpeechPause(text) {
  return /[.!?;:…。！？]$/.test(String(text || '').trim());
}

export function buildSpeechText(ocrResults = [], translations = []) {
  const segments = ocrResults
    .map((block, index) => ({
      ...(block || {}),
      translatedText: normalizeTranslationText(translations[index])
    }))
    .filter((block) => block.translatedText.length > 0)
    .sort(getReadingOrderComparator('horizontal'));

  let speechText = '';

  for (const segment of segments) {
    if (!speechText) {
      speechText = segment.translatedText;
      continue;
    }

    speechText += endsWithSpeechPause(speechText)
      ? ` ${segment.translatedText}`
      : `. ${segment.translatedText}`;
  }

  return speechText.trim();
}

function splitOversizedToken(ctx, token, maxWidth) {
  const pieces = [];
  let current = '';

  for (const char of Array.from(token)) {
    const next = current + char;
    if (!current || ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    pieces.push(current);
    current = char;
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

function tokenizeForWrap(text) {
  const normalized = normalizeTranslationText(text);

  if (!normalized) {
    return { tokens: [], separator: ' ' };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return { tokens: words, separator: ' ' };
  }

  if (detectCJK(normalized) || normalized.length > 20) {
    return { tokens: Array.from(normalized), separator: '' };
  }

  return { tokens: [normalized], separator: '' };
}

function wrapText(ctx, text, maxWidth) {
  const { tokens, separator } = tokenizeForWrap(text);

  if (!tokens.length) {
    return [''];
  }

  const lines = [];
  let currentLine = '';

  for (const token of tokens) {
    const candidate = currentLine ? `${currentLine}${separator}${token}` : token;

    if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (ctx.measureText(token).width > maxWidth) {
      const tokenPieces = splitOversizedToken(ctx, token, maxWidth);

      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      for (const piece of tokenPieces) {
        if (ctx.measureText(piece).width <= maxWidth) {
          if (!currentLine) {
            currentLine = piece;
          } else if (ctx.measureText(`${currentLine}${separator}${piece}`).width <= maxWidth) {
            currentLine = `${currentLine}${separator}${piece}`;
          } else {
            lines.push(currentLine);
            currentLine = piece;
          }
        }
      }

      continue;
    }

    lines.push(currentLine);
    currentLine = token;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [''];
}

/*
 * --------------------------------------------------------------------------
 * Auto-Size Font to Fit Bounding Box
 * --------------------------------------------------------------------------
 * Binary search for the largest font size that makes the translated text
 * fit within the given bounding box dimensions.
 *
 * HOW IT WORKS:
 *   1. Start with a range of possible font sizes (minSize to maxSize).
 *   2. Try the midpoint font size.
 *   3. Measure the text with that font size using ctx.measureText().
 *   4. If it fits, try a larger size. If not, try a smaller size.
 *   5. Repeat until we converge on the best size.
 *
 * For multi-line text, we split into lines that fit the width, then
 * check if all lines fit the height.
 *
 * @param {CanvasRenderingContext2D} ctx — Canvas context for measuring
 * @param {string} text — The text to fit
 * @param {number} maxWidth — Maximum width in pixels
 * @param {number} maxHeight — Maximum height in pixels
 * @param {string} fontFamily — Font family to use
 * @param {boolean} isVertical — Whether to render text vertically
 * @returns {{fontSize: number, lines: string[], lineHeight: number}}
 *          The best font size and layout metrics for the text block.
 */
function autoSizeFont(ctx, text, maxWidth, maxHeight, fontFamily, isVertical, minFontSizeOverride) {
  const minFontSize = Math.max(TEXT_RENDER_TUNING.minFontSize, minFontSizeOverride || TEXT_RENDER_TUNING.minFontSize);
  const maxFontSize = Math.min(
    TEXT_RENDER_TUNING.maxFontSize,
    isVertical ? maxWidth : Math.max(maxWidth, maxHeight)
  );

  if (maxWidth <= 1 || maxHeight <= 1) {
    return {
      fontSize: minFontSize,
      lines: [normalizeTranslationText(text)],
      lineHeight: minFontSize * TEXT_RENDER_TUNING.minLineHeight
    };
  }

  function tryFontSize(size) {
    ctx.font = `${size}px ${fontFamily}`;

    if (isVertical) {
      const normalizedText = normalizeTranslationText(text);
      const charsPerColumn = Math.max(1, Math.floor(maxHeight / (size * 1.1)));
      const columns = [];

      for (let i = 0; i < normalizedText.length; i += charsPerColumn) {
        columns.push(normalizedText.slice(i, i + charsPerColumn));
      }

      const columnWidth = size * 1.15;
      const totalWidth = columns.length * columnWidth;

      if (totalWidth > maxWidth) {
        return null;
      }

      return {
        lines: columns,
        lineHeight: size * 1.1
      };
    }

    const lines = wrapText(ctx, text, maxWidth);
    const desiredMultiplier = maxHeight / Math.max(1, lines.length * size);
    const lineHeightMultiplier = clamp(
      desiredMultiplier,
      TEXT_RENDER_TUNING.minLineHeight,
      TEXT_RENDER_TUNING.maxLineHeight
    );
    const lineHeight = size * lineHeightMultiplier;

    if (lines.length * lineHeight > maxHeight) {
      return null;
    }

    return {
      lines,
      lineHeight
    };
  }

  let low = minFontSize;
  let high = Math.max(minFontSize, maxFontSize);
  let bestLayout = {
    fontSize: minFontSize,
    lines: [normalizeTranslationText(text)],
    lineHeight: minFontSize * TEXT_RENDER_TUNING.minLineHeight
  };

  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const layout = tryFontSize(mid);

    if (layout) {
      bestLayout = {
        fontSize: mid,
        lines: layout.lines,
        lineHeight: layout.lineHeight
      };
      low = mid;
    } else {
      high = mid;
    }
  }

  return bestLayout;
}

/*
 * --------------------------------------------------------------------------
 * Helper: Truncate text with ellipsis to fit a given width
 * --------------------------------------------------------------------------
 * Removes characters from the end of the text and adds "..." until the
 * text fits within maxWidth.
 *
 * @param {CanvasRenderingContext2D} ctx — Canvas context with font already set
 * @param {string} text — Text to truncate
 * @param {number} maxWidth — Maximum width in pixels
 * @returns {string} — Truncated text with "..." appended
 */
function truncateWithEllipsis(ctx, text, maxWidth) {
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  /*
   * Remove one character at a time from the end until the text
   * plus ellipsis fits. This is O(n) in the worst case, but text
   * strings from OCR are typically short.
   */
  let truncated = text;
  while (truncated.length > 0) {
    truncated = truncated.slice(0, -1);
    if (ctx.measureText(truncated + ellipsis).width <= maxWidth) {
      return truncated + ellipsis;
    }
  }

  return ellipsis;
}

/*
 * --------------------------------------------------------------------------
 * Detect if Text Should Be Vertical
 * --------------------------------------------------------------------------
 * CJK (Chinese, Japanese, Korean) text is traditionally written vertically,
 * with columns going from right to left. We detect vertical text by:
 *
 *   1. Checking if the bounding box is tall and narrow (height > width * 1.5).
 *      This is a strong indicator that the OCR detected a vertical column.
 *   2. Checking if the text contains CJK characters.
 *
 * Both conditions must be true to render vertically.
 *
 * @param {string} text — The text content
 * @param {number} boxWidth — Bounding box width
 * @param {number} boxHeight — Bounding box height
 * @returns {boolean}
 */
function shouldRenderVertical(text, boxWidth, boxHeight) {
  /* Condition 1: Box is significantly taller than wide */
  const isTallBox = boxHeight > boxWidth * 1.5;

  /*
   * Condition 2: Text contains CJK characters.
   * Unicode ranges for CJK:
   *   \u4E00-\u9FFF  — CJK Unified Ideographs (Chinese characters)
   *   \u3040-\u309F  — Hiragana (Japanese)
   *   \u30A0-\u30FF  — Katakana (Japanese)
   *   \uAC00-\uD7AF  — Hangul Syllables (Korean)
   *
   * We check if at least 30% of characters are CJK, since text might
   * contain mixed content (numbers, punctuation, Latin characters).
   */
  const cjkRegex = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
  const cjkMatches = text.match(cjkRegex);
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
  const hasCJK = cjkRatio >= 0.3;

  return isTallBox && hasCJK;
}

/*
 * ==========================================================================
 * MAIN EXPORT: renderTranslation()
 * ==========================================================================
 * Renders translated text on the overlay canvas.
 *
 * @param {HTMLCanvasElement} canvas
 *        The overlay canvas positioned on top of the original image.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} originalImage
 *        The original image element. Used for:
 *        - Determining the scale factor between OCR coords and canvas coords.
 *        - Sampling background colors from the original image pixels.
 *
 * @param {Array<{text: string, confidence: number, bbox: {x, y, width, height}}>} ocrResults
 *        OCR results. Each entry has:
 *        - text: The detected text string
 *        - confidence: How confident the OCR is (0.0 to 1.0)
 *        - bbox: Bounding box in ORIGINAL image pixel coordinates
 *          - x: Left edge
 *          - y: Top edge
 *          - width: Box width
 *          - height: Box height
 *
 * @param {string[]} translations
 *        Array of translated strings, in the same order as ocrResults.
 *        translations[i] is the translation of ocrResults[i].text.
 */
export function renderTranslation(canvas, originalImage, ocrResults, translations, settings = {}) {
  const ctx = canvas.getContext('2d');

  /*
   * Calculate scale factors. OCR bounding boxes are in the image's
   * natural coordinate space. The canvas CSS dimensions match the
   * displayed image size, which might be different.
   *
   * Example:
   *   Image natural size: 1000x800
   *   Canvas CSS size: 500x400 (image scaled to 50%)
   *   scaleX = 500 / 1000 = 0.5
   *   An OCR box at x=200 maps to canvas x=100
   *
   * NOTE: The canvas context has already been scaled by DPR
   * (devicePixelRatio) in content.js, so we work in CSS pixel space.
   */
  const naturalWidth = originalImage.naturalWidth || originalImage.width;
  const naturalHeight = originalImage.naturalHeight || originalImage.height;

  /*
   * canvas.style.width gives us the CSS display width (e.g., "500px").
   * We parse it to get the number.
   */
  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  const scaleX = displayWidth / naturalWidth;
  const scaleY = displayHeight / naturalHeight;

  /*
   * Create a temporary canvas with the ORIGINAL IMAGE drawn on it.
   * We need this to sample background colors from the original image
   * pixels. We can't sample from the overlay canvas because it starts
   * empty/transparent.
   */
  const samplingCanvas = document.createElement('canvas');
  /*
   * This canvas is read from repeatedly via getImageData() when sampling
   * background colors, so request the readback-optimized 2D context.
   */
  const samplingCtx = samplingCanvas.getContext('2d', {
    willReadFrequently: true
  });
  samplingCanvas.width = displayWidth;
  samplingCanvas.height = displayHeight;
  samplingCtx.drawImage(originalImage, 0, 0, displayWidth, displayHeight);

  /*
   * Font family to use for rendered text. We use a system font stack
   * that covers most languages well. For CJK text, browsers will
   * automatically fall back to appropriate fonts (like Noto Sans CJK
   * or system CJK fonts).
   */
  const fontFamily = resolveOverlayFontFamily(settings);
  const minimumFontSize = resolveOverlayMinFontSize(settings);
  const showConfidenceBorders = settings.showConfidenceBorders !== false;

  /*
   * Clear the overlay canvas before drawing. This removes any previous
   * rendering (important if we're re-rendering after a language change).
   */
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  /*
   * Process each text block (OCR result + its translation).
   */
  for (let i = 0; i < ocrResults.length; i++) {
    const ocr = ocrResults[i];
    const translatedText = normalizeTranslationText(translations[i]);

    /* Skip if no translation is available for this block */
    if (!translatedText) continue;

    /*
     * Scale the bounding box from image coordinates to canvas coordinates.
     */
    const box = {
      x: ocr.bbox.x * scaleX,
      y: ocr.bbox.y * scaleY,
      width: ocr.bbox.width * scaleX,
      height: ocr.bbox.height * scaleY
    };

    /* Skip boxes that are too small to render text in */
    if (box.width < 10 || box.height < 8) continue;

    /*
     * STEP 1: Expand the OCR box toward the original speech bubble or
     * label container so the translated text can fit inside that shape
     * without painting over its outline.
     */
    const { containerBox, cleanupClipBox, renderBox, fillColor, boundaryCount } = resolveContainerBoxes(
      samplingCtx,
      box,
      displayWidth,
      displayHeight
    );

    const maskPadding = Math.max(
      TEXT_RENDER_TUNING.maskPaddingPx,
      Math.min(box.width, box.height) * (TEXT_RENDER_TUNING.maskPaddingRatio + 0.02)
    );
    const expandedTextBox = expandBox(box, maskPadding, displayWidth, displayHeight);
    const cleanupBox = intersectBoxes(expandedTextBox, cleanupClipBox) || cleanupClipBox;

    /*
     * STEP 2: Fill only the container interior, leaving the original
     * bubble or box border visible around the translated text.
     *
     * The cleanup box follows the OCR region plus padding, but it is
     * clipped to a thin inset just inside the detected border.
     */
    const cornerRadius = Math.min(10, cleanupBox.width * 0.08, cleanupBox.height * 0.08);

    ctx.fillStyle = `rgb(${fillColor.r}, ${fillColor.g}, ${fillColor.b})`;
    ctx.beginPath();
    ctx.roundRect(cleanupBox.x, cleanupBox.y, cleanupBox.width, cleanupBox.height, cornerRadius);
    ctx.fill();

    /*
     * STEP 3: Determine text rendering direction and auto-size the font.
     * Apply internal padding so text doesn't touch the edges.
     */
    const innerPadding = Math.max(
      TEXT_RENDER_TUNING.innerPaddingPx,
      Math.min(renderBox.width, renderBox.height) * TEXT_RENDER_TUNING.innerPaddingRatio
    );
    const innerWidth = renderBox.width - innerPadding * 2;
    const innerHeight = renderBox.height - innerPadding * 2;

    if (innerWidth < 5 || innerHeight < 5) continue;

    const isVertical =
      ocr.orientation === 'vertical' && shouldRenderVertical(translatedText, innerWidth, innerHeight);
    const textAlignment = resolveOverlayAlignment(ocr, settings);
    const { fontSize, lines, lineHeight } = autoSizeFont(
      ctx, translatedText, innerWidth, innerHeight, fontFamily, isVertical, minimumFontSize
    );

    /*
     * STEP 4: Determine text color for maximum contrast against the
     * sampled background.
     */
    const textColor = getContrastColor(fillColor);
    const outlineColor = textColor === 'black' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';

    /*
     * STEP 5: Render the translated text with a subtle outline for
     * readability over complex backgrounds.
     */
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, fontSize * 0.1);

    if (isVertical) {
      /*
       * VERTICAL TEXT RENDERING:
       * Each "line" is a column of characters. Columns go right-to-left.
       */
      const columnWidth = fontSize * 1.2;
      const charHeight = fontSize * 1.1;

      for (let colIdx = 0; colIdx < lines.length; colIdx++) {
        const column = lines[colIdx];
        const colX = renderBox.x + innerPadding + innerWidth - (colIdx + 1) * columnWidth;
        const totalColumnHeight = column.length * charHeight;
        const startY = renderBox.y + innerPadding + Math.max(0, (innerHeight - totalColumnHeight) / 2);

        for (let charIdx = 0; charIdx < column.length; charIdx++) {
          const char = column[charIdx];
          const charY = startY + charIdx * charHeight;
          const charMetrics = ctx.measureText(char);
          const charX = colX + (columnWidth - charMetrics.width) / 2;

          /* Draw text outline for readability */
          ctx.strokeStyle = outlineColor;
          ctx.strokeText(char, charX, charY);

          /* Draw the actual text */
          ctx.fillStyle = textColor;
          ctx.fillText(char, charX, charY);
        }
      }
    } else {
      /*
       * HORIZONTAL TEXT RENDERING:
       * Standard left-to-right, top-to-bottom, reflowed inside the merged block.
       */
      const totalTextHeight = lines.length * lineHeight;
      const shouldCenterVertically = textAlignment === 'center' && lines.length <= 2;
      const startY = shouldCenterVertically
        ? renderBox.y + innerPadding + Math.max(0, (innerHeight - totalTextHeight) / 2)
        : renderBox.y + innerPadding;

      if (textAlignment === 'center') {
        ctx.textAlign = 'center';
      } else if (textAlignment === 'right') {
        ctx.textAlign = 'right';
      } else {
        ctx.textAlign = 'left';
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lineX =
          textAlignment === 'center'
            ? renderBox.x + innerPadding + innerWidth / 2
            : textAlignment === 'right'
              ? renderBox.x + innerPadding + innerWidth
              : renderBox.x + innerPadding;
        const lineY = startY + lineIdx * lineHeight;

        /* Draw text outline for readability */
        ctx.strokeStyle = outlineColor;
        ctx.strokeText(line, lineX, lineY);

        /* Draw the actual text */
        ctx.fillStyle = textColor;
        ctx.fillText(line, lineX, lineY);
      }

      ctx.textAlign = 'start';
    }

    /*
     * STEP 6: Subtle confidence indicator.
     * Only show a thin bottom border (not a full rectangle) to keep
     * the overlay clean while still signaling confidence.
     */
    if (showConfidenceBorders && ocr.confidence !== undefined && ocr.confidence < 0.7) {
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(renderBox.x, renderBox.y + renderBox.height);
      ctx.lineTo(renderBox.x + renderBox.width, renderBox.y + renderBox.height);
      ctx.stroke();
    }

    if (DEBUG_RENDER_LOGS) {
      console.log('[VisionTranslate Overlay] Render block', {
        id: ocr.id || i,
        rawCount: ocr.rawIds?.length || 1,
        originalBox: box,
        containerBox,
        cleanupClipBox,
        cleanupBox,
        renderBox,
        detectedBoundaries: boundaryCount,
        alignment: textAlignment,
        fontSize: Number(fontSize.toFixed(2)),
        lineHeight: Number(lineHeight.toFixed(2)),
        lineCount: lines.length
      });
    }

    if (DEBUG_DRAW_OVERLAYS) {
      ctx.save();
      ctx.strokeStyle = 'rgba(41, 121, 255, 0.7)';
      ctx.lineWidth = 1;
      for (const rawBox of ocr.rawBoxes || []) {
        ctx.strokeRect(rawBox.x * scaleX, rawBox.y * scaleY, rawBox.width * scaleX, rawBox.height * scaleY);
      }
      ctx.strokeStyle = 'rgba(255, 87, 34, 0.9)';
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = 'rgba(0, 150, 136, 0.9)';
      ctx.strokeRect(containerBox.x, containerBox.y, containerBox.width, containerBox.height);
      ctx.strokeStyle = 'rgba(156, 39, 176, 0.9)';
      ctx.strokeRect(cleanupClipBox.x, cleanupClipBox.y, cleanupClipBox.width, cleanupClipBox.height);
      ctx.strokeStyle = 'rgba(233, 30, 99, 0.9)';
      ctx.strokeRect(cleanupBox.x, cleanupBox.y, cleanupBox.width, cleanupBox.height);
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
      ctx.strokeRect(renderBox.x, renderBox.y, renderBox.width, renderBox.height);
      ctx.restore();
    }
  }

  console.log(`[VisionTranslate Overlay] Rendered ${ocrResults.length} merged text blocks`);
}

/*
 * ==========================================================================
 * EXPORT: restoreOriginal()
 * ==========================================================================
 * Restores the overlay canvas to show the original image (clears all
 * translated text). The original image underneath is always intact — we
 * just need to make the canvas transparent again.
 *
 * @param {HTMLCanvasElement} canvas — The overlay canvas
 */
export function restoreOriginal(canvas) {
  const ctx = canvas.getContext('2d');
  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  /* Clear the entire canvas to fully transparent */
  ctx.clearRect(0, 0, displayWidth, displayHeight);
}

/*
 * ==========================================================================
 * EXPORT: setupHoverDetection()
 * ==========================================================================
 * Sets up mouse hover detection on the overlay canvas. When the user
 * hovers over a translated text block, a tooltip shows the original text.
 *
 * HOW IT WORKS:
 *   1. Listen for mousemove events on the canvas.
 *   2. For each mouse position, check if it falls within any text
 *      block's bounding box.
 *   3. If yes, show a tooltip with the original text near the cursor.
 *   4. If no, hide the tooltip.
 *
 * We create a single tooltip element (shared across all blocks) and
 * reposition it as the mouse moves.
 *
 * @param {HTMLCanvasElement} canvas — The overlay canvas
 * @param {Array} ocrResults — OCR results with bounding boxes
 * @param {string[]} translations — Translated text array
 */
export function setupHoverDetection(canvas, ocrResults, translations) {
  // Tooltip logic removed as per user request.
}
