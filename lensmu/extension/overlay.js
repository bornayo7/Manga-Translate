// Draw fitted translations over source image regions.
export { groupTextBlocks, buildSpeechText, OCR_BLOCK_TUNING } from './render/text-regions.js';
import { resolveImagePlacement } from './render/image-placement.js';
import {
  createTextDisplayPlan,
  normalizeTranslationText
} from './shared/text-layout.js';

function sampleBackgroundColor(ctx, x, y, width, height) {

  const SAMPLES_PER_EDGE = 10;

  const OFFSET = 2;

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  const samples = [];

  function samplePixel(px, py) {

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

    }
  }

  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y - OFFSET;
    samplePixel(px, py);
  }

  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y + height + OFFSET;
    samplePixel(px, py);
  }

  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x - OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + width + OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  if (samples.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  const QUANT = 8;
  const colorBuckets = new Map();

  for (const sample of samples) {
    const qr = Math.round(sample.r / QUANT) * QUANT;
    const qg = Math.round(sample.g / QUANT) * QUANT;
    const qb = Math.round(sample.b / QUANT) * QUANT;
    const key = `${qr},${qg},${qb}`;

    if (colorBuckets.has(key)) {
      const bucket = colorBuckets.get(key);
      bucket.count++;

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

function getContrastColor(color) {

  const r = Math.pow(color.r / 255, 2.2);
  const g = Math.pow(color.g / 255, 2.2);
  const b = Math.pow(color.b / 255, 2.2);

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.179 ? 'black' : 'white';
}


export const TEXT_RENDER_TUNING = {
  maskPaddingPx: 1,
  maskPaddingRatio: 0.02,
  innerPaddingPx: 2,
  innerPaddingRatio: 0.04,
  minFontSize: 8,
  maxFontSize: 72,
  minLineHeight: 1.08,
  maxLineHeight: 1.3,
  titleCenterWordThreshold: 10,

  verticalColumnWidthRatio: 1.2,
  verticalCharHeightRatio: 1.1
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

function autoSizeFont(ctx, text, maxWidth, maxHeight, fontFamily, isVertical, minFontSizeOverride, alignment) {
  return createTextDisplayPlan({
    alignment,
    measureText: (value, size) => {
      ctx.font = `${size}px ${fontFamily}`;
      return ctx.measureText(value).width;
    },
    text,
    maxWidth,
    maxHeight,
    minFontSize: Math.max(TEXT_RENDER_TUNING.minFontSize, minFontSizeOverride || TEXT_RENDER_TUNING.minFontSize),
    maxFontSize: TEXT_RENDER_TUNING.maxFontSize,
    isVertical,
    tuning: TEXT_RENDER_TUNING
  });
}

function shouldRenderVertical(text, boxWidth, boxHeight) {

  const isTallBox = boxHeight > boxWidth * 1.5;

  const cjkRegex = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
  const cjkMatches = text.match(cjkRegex);
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
  const hasCJK = cjkRatio >= 0.3;

  return isTallBox && hasCJK;
}

export function renderTranslation(canvas, originalImage, ocrResults, translations, settings = {}) {
  const ctx = canvas.getContext('2d');

  const naturalWidth = originalImage.naturalWidth || originalImage.width;
  const naturalHeight = originalImage.naturalHeight || originalImage.height;

  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  const placement = resolveImagePlacement({ width: displayWidth, height: displayHeight,
    naturalWidth, naturalHeight, ...settings.imagePlacement });
  if (!placement) return { rendered: 0, skipped: ocrResults.length, unfit: 0, outcomes: ocrResults.map((_, index) => ({ index, status: 'skipped', reason: 'unsupported-placement' })) };
  const { scaleX, scaleY } = placement;

  const samplingCanvas = (canvas.ownerDocument || document).createElement('canvas');

  const samplingCtx = samplingCanvas.getContext('2d', {
    willReadFrequently: true
  });
  samplingCanvas.width = displayWidth;
  samplingCanvas.height = displayHeight;
  samplingCtx.drawImage(originalImage, placement.x, placement.y, placement.width, placement.height);

  const fontFamily = resolveOverlayFontFamily(settings);
  const minimumFontSize = resolveOverlayMinFontSize(settings);
  const showConfidenceBorders = settings.showConfidenceBorders !== false;

  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const report = { rendered: 0, skipped: 0, unfit: 0, unfitIndices: [], outcomes: [] };
  const skip = (index, reason) => {
    report.skipped += 1;
    report.outcomes.push({ index, status: 'skipped', reason });
  };

  for (let i = 0; i < ocrResults.length; i++) {
    const ocr = ocrResults[i];
    const translatedText = normalizeTranslationText(translations[i]);

    if (!translatedText) {
      skip(i, 'no-translation');
      continue;
    }

    const box = {
      x: placement.x + ocr.bbox.x * scaleX,
      y: placement.y + ocr.bbox.y * scaleY,
      width: ocr.bbox.width * scaleX,
      height: ocr.bbox.height * scaleY
    };

    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.x < 0 || box.y < 0 || box.x + box.width > displayWidth || box.y + box.height > displayHeight) {
      skip(i, 'out-of-bounds');
      continue;
    }
    if (box.width < 10 || box.height < 8) {
      skip(i, 'too-small');
      continue;
    }

    const container = resolveContainerBoxes(
      samplingCtx,
      box,
      displayWidth,
      displayHeight
    );
    const cleanupClipBox = intersectBoxes(container.cleanupClipBox, placement.visible);
    const renderBox = intersectBoxes(container.renderBox, placement.visible);
    const { fillColor } = container;
    if (!cleanupClipBox || !renderBox) { skip(i, 'out-of-bounds'); continue; }

    const maskPadding = Math.max(
      TEXT_RENDER_TUNING.maskPaddingPx,
      Math.min(box.width, box.height) * (TEXT_RENDER_TUNING.maskPaddingRatio + 0.02)
    );
    const expandedTextBox = expandBox(box, maskPadding, displayWidth, displayHeight);
    const cleanupBox = intersectBoxes(expandedTextBox, cleanupClipBox) || cleanupClipBox;

    const cornerRadius = Math.min(10, cleanupBox.width * 0.08, cleanupBox.height * 0.08);

    const innerPadding = Math.max(
      TEXT_RENDER_TUNING.innerPaddingPx,
      Math.min(renderBox.width, renderBox.height) * TEXT_RENDER_TUNING.innerPaddingRatio
    );
    const innerWidth = renderBox.width - innerPadding * 2;
    const innerHeight = renderBox.height - innerPadding * 2;

    if (innerWidth < 5 || innerHeight < 5) {
      skip(i, 'too-small');
      continue;
    }

    const isVertical =
      ocr.orientation === 'vertical' && shouldRenderVertical(translatedText, innerWidth, innerHeight);
    const textAlignment = resolveOverlayAlignment(ocr, settings);
    const layout = autoSizeFont(
      ctx, translatedText, innerWidth, innerHeight, fontFamily, isVertical, minimumFontSize, textAlignment
    );

    if (!layout.fits) {
      report.unfit += 1;
      report.unfitIndices.push(i);
      report.outcomes.push({ index: i, status: 'unfit', reason: 'no-fit' });
      console.warn(
        `[VisionTranslate Overlay] Block ${ocr.id ?? i} left untouched: the translation does not fit at the minimum font size.`
      );
      continue;
    }

    const { fontSize, placements } = layout;

    ctx.fillStyle = `rgb(${fillColor.r}, ${fillColor.g}, ${fillColor.b})`;
    ctx.beginPath();
    ctx.roundRect(cleanupBox.x, cleanupBox.y, cleanupBox.width, cleanupBox.height, cornerRadius);
    ctx.fill();
    report.rendered += 1;
    report.outcomes.push({ index: i, status: 'rendered', reason: '' });

    const textColor = getContrastColor(fillColor);
    const outlineColor = textColor === 'black' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';

    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, fontSize * 0.1);

    ctx.textAlign = 'left';
    for (const placement of placements) {
      const x = renderBox.x + innerPadding + placement.x;
      const y = renderBox.y + innerPadding + placement.y;
      ctx.strokeStyle = outlineColor;
      ctx.strokeText(placement.text, x, y);
      ctx.fillStyle = textColor;
      ctx.fillText(placement.text, x, y);
    }

    if (showConfidenceBorders && ocr.confidence !== undefined && ocr.confidence < 0.7) {
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(renderBox.x, renderBox.y + renderBox.height);
      ctx.lineTo(renderBox.x + renderBox.width, renderBox.y + renderBox.height);
      ctx.stroke();
    }


  }

  console.log(
    `[VisionTranslate Overlay] Rendered ${report.rendered} of ${ocrResults.length} merged text blocks` +
      (report.unfit ? ` (${report.unfit} did not fit)` : '')
  );

  return report;
}
