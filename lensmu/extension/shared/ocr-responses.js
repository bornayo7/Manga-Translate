// OCR response contracts shared by the service worker and the website demo:
//
//   - batchMangaBboxes(): splits PaddleOCR detections into /ocr/manga
//     requests that each respect the backend's validator (count, coordinate
//     range, aggregate area) instead of truncating the page at the limit.
//   - mergeMangaResults(): joins MangaOCR answers back onto the detections
//     they came from by index, keeping PaddleOCR's own text for any region
//     MangaOCR did not recognise, so a partial failure never drops text.
//   - parseGoogleVisionResponse(): validates a Cloud Vision annotate reply,
//     which can carry a per-image error inside an HTTP 200.
//
// Pure functions, no network. Keep this file importable from Node tests.

import {
  MAX_MANGA_COORDINATE,
  MAX_MANGA_REGIONS,
  MAX_MANGA_TOTAL_REGION_PIXELS
} from './text.js';

// Mirrors MangaOCRRequest.validate_bboxes in backend/server.py: integers in
// [0, MAX_MANGA_COORDINATE] with x2 > x1 and y2 > y1.
export function normalizeMangaBbox(detection) {
  const bbox = Array.isArray(detection?.bbox) ? detection.bbox : null;
  if (!bbox || bbox.length !== 4) {
    return null;
  }

  const [x1, y1, x2, y2] = bbox.map((value) => Math.round(Number(value)));
  const inRange = [x1, y1, x2, y2].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= MAX_MANGA_COORDINATE
  );
  if (!inRange || x2 <= x1 || y2 <= y1) {
    return null;
  }

  return [x1, y1, x2, y2];
}

/*
 * Groups detections into request-sized batches. Region identity is the
 * detection index; every batch records which indices it carries so the
 * answers can be merged back regardless of how many requests were needed.
 *
 * Returns { batches: [{ indices, bboxes }], invalid: number[], oversized: number[] }
 *   invalid   — detections with no usable bbox (never sent)
 *   oversized — a single valid box whose own area exceeds the aggregate
 *               limit; it cannot be sent in any batch and keeps its
 *               PaddleOCR text instead
 */
export function batchMangaBboxes(detections = []) {
  const batches = [];
  const invalid = [];
  const oversized = [];
  let current = null;
  let currentArea = 0;

  const startBatch = () => {
    current = { indices: [], bboxes: [] };
    currentArea = 0;
    batches.push(current);
  };

  (Array.isArray(detections) ? detections : []).forEach((detection, index) => {
    const bbox = normalizeMangaBbox(detection);
    if (!bbox) {
      invalid.push(index);
      return;
    }

    const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (area > MAX_MANGA_TOTAL_REGION_PIXELS) {
      oversized.push(index);
      return;
    }

    if (
      !current ||
      current.bboxes.length >= MAX_MANGA_REGIONS ||
      currentArea + area > MAX_MANGA_TOTAL_REGION_PIXELS
    ) {
      startBatch();
    }

    current.indices.push(index);
    current.bboxes.push(bbox);
    currentArea += area;
  });

  return { batches, invalid, oversized };
}

function detectionText(detection) {
  return typeof detection?.text === 'string' ? detection.text.trim() : String(detection?.text ?? '').trim();
}

// TypeScript annotations and HTTP 200 cannot establish a provider contract.
// Preserve region positions/order and explicit partial errors at this boundary.
export function decodeBackendOcrResponse(data, { engine = 'paddle', expectedCount } = {}) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.detections)) {
    throw new Error(`${engine} OCR returned an invalid detection response.`);
  }
  if ((expectedCount !== undefined && data.detections.length !== expectedCount) ||
      (data.count !== undefined && data.count !== data.detections.length)) {
    throw new Error(`${engine} OCR returned a mismatched region count.`);
  }
  const detections = data.detections.map((item, index) => {
    const box = item?.bbox;
    const outside = item?.status === 'outside_image' && item.text === '';
    if (!item || typeof item.text !== 'string' || !Array.isArray(box) || box.length !== 4 ||
        box.some(value => typeof value !== 'number' || !Number.isFinite(value)) ||
        box[0] < 0 || box[1] < 0 || box[2] < box[0] || box[3] < box[1] ||
        (!outside && (box[2] === box[0] || box[3] === box[1])) ||
        (item.confidence !== undefined && (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)))) {
      throw new Error(`${engine} OCR returned an invalid region at position ${index + 1}.`);
    }
    if (item.error !== undefined && item.error !== null && typeof item.error !== 'string') {
      throw new Error(`${engine} OCR returned an invalid region error.`);
    }
    if (item.status !== undefined && !['recognized', 'empty', 'failed', 'outside_image'].includes(item.status)) {
      throw new Error(`${engine} OCR returned an invalid region status.`);
    }
    const failed = item.status === 'failed' || Boolean(item.error);
    return { ...item, bbox: box.slice(),
      text: failed || outside || item.status === 'empty' ? '' : item.text,
      ...(failed ? { error: item.error || 'Recognition failed.' } : {}) };
  });
  if (detections.length && detections.every(item => item.error)) {
    throw new Error(`${engine} OCR failed to recognize every requested region.`);
  }
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter(item => typeof item === 'string') : [];
  const failed = detections.filter(item => item.error).length;
  if (failed) warnings.push(`${engine} OCR failed on ${failed} region${failed === 1 ? '' : 's'}; fallback recognition is identified separately.`);
  const outside = detections.filter(item => item.status === 'outside_image').length;
  if (outside) warnings.push(`${engine} OCR skipped ${outside} region${outside === 1 ? '' : 's'} outside the image.`);
  return { detections, warnings };
}

function paddleBlock(detection, source) {
  const bbox = Array.isArray(detection?.bbox) ? detection.bbox.map((value) => Math.round(Number(value) || 0)) : [0, 0, 0, 0];
  const confidence = Number(detection?.confidence);
  return {
    text: detectionText(detection),
    bbox,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    orientation: detection?.orientation === 'vertical' ? 'vertical' : 'horizontal',
    source
  };
}

/*
 * Merges MangaOCR answers onto the PaddleOCR detections by index.
 *
 * `batchResponses[b]` is the `detections` array the backend returned for
 * `batches[b]` (its documented contract: same length and order as the
 * request's bboxes, an empty `text` for a region that failed), or
 * null/undefined when that request failed. A response whose length does
 * not match the request is treated as unusable for the whole batch rather
 * than aligned by guesswork.
 *
 * For each detection, in the original order:
 *   - MangaOCR text present → that text, PaddleOCR's own geometry,
 *     confidence and orientation (MangaOCR reports neither), source "mangaocr"
 *   - otherwise PaddleOCR's text if it has any, source "paddleocr"
 *   - otherwise the region is dropped (nothing readable from either engine)
 *
 * Returns { blocks, recognized, fellBack, dropped, unexpectedBatches }.
 */
export function mergeMangaResults(detections = [], batches = [], batchResponses = []) {
  const mangaTextByIndex = new Map();
  let unexpectedBatches = 0;

  batches.forEach((batch, batchIndex) => {
    const response = batchResponses[batchIndex];
    if (!Array.isArray(response) || response.length !== batch.indices.length) {
      unexpectedBatches += 1;
      return;
    }
    batch.indices.forEach((detectionIndex, position) => {
      mangaTextByIndex.set(detectionIndex, detectionText(response[position]));
    });
  });

  const blocks = [];
  let recognized = 0;
  let fellBack = 0;
  let dropped = 0;

  (Array.isArray(detections) ? detections : []).forEach((detection, index) => {
    const mangaText = mangaTextByIndex.get(index) || '';
    if (mangaText) {
      blocks.push({ ...paddleBlock(detection, 'mangaocr'), text: mangaText });
      recognized += 1;
      return;
    }

    const fallback = paddleBlock(detection, 'paddleocr');
    if (fallback.text) {
      blocks.push(fallback);
      fellBack += 1;
      return;
    }

    dropped += 1;
  });

  return { blocks, recognized, fellBack, dropped, unexpectedBatches };
}

/*
 * Cloud Vision images:annotate contract (one request → responses[0]):
 *   - responses[0].error         → the image failed; HTTP status is still 200
 *   - responses[0].textAnnotations absent or empty → no text found
 *   - textAnnotations[0]         → the whole-image text; [1..] are the words
 * Anything that is not an array with one element is not a Vision answer.
 */
export function parseGoogleVisionResponse(data) {
  const responses = data?.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error('Google Cloud Vision returned an unexpected response with no image results.');
  }

  const first = responses[0];
  if (!first || typeof first !== 'object') {
    throw new Error('Google Cloud Vision returned an unexpected image result.');
  }

  if (first.error) {
    const code = first.error.code !== undefined ? ` (${first.error.code})` : '';
    const message = first.error.message || 'unspecified error';
    throw new Error(`Google Cloud Vision could not process the image${code}: ${message}`);
  }

  const annotations = Array.isArray(first.textAnnotations) ? first.textAnnotations : [];
  if (annotations.length === 0) {
    return { blocks: [], sourceLang: 'auto', noText: true };
  }

  const blocks = annotations.slice(1).map((annotation) => {
    const vertices = Array.isArray(annotation?.boundingPoly?.vertices) ? annotation.boundingPoly.vertices : [];
    const xs = vertices.map((vertex) => Number(vertex?.x) || 0);
    const ys = vertices.map((vertex) => Number(vertex?.y) || 0);
    const minX = xs.length ? Math.min(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    return {
      text: String(annotation?.description ?? ''),
      confidence: 0.9,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    };
  }).filter((block) => block.text.trim().length > 0);

  return {
    blocks,
    sourceLang: typeof annotations[0]?.locale === 'string' && annotations[0].locale ? annotations[0].locale : 'auto',
    noText: blocks.length === 0
  };
}
