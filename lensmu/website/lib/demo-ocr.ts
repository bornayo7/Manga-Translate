import { batchMangaBboxes, decodeBackendOcrResponse, mergeMangaResults, type BackendDetection } from '../../extension/shared/ocr-responses.js';
import { fetchWithTimeout } from '../../extension/shared/fetch-with-timeout.js';
import { describeHttpFailure, trimTrailingSlashes } from '../../extension/shared/text.js';
import type { OcrBlock, OcrEngine } from './translator-types';

async function recognize(url: string, body: unknown, engine: 'paddle' | 'manga', signal?: AbortSignal, expectedCount?: number) {
  signal?.throwIfAborted();
  const response = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }, { timeoutMs: 60000, maxResponseBytes: 8 * 1024 * 1024 });
  if (!response.ok) throw new Error(`OCR failed: ${describeHttpFailure(response.status, response.statusText, response.json ?? response.text)}.`);
  return decodeBackendOcrResponse(response.json, { engine, expectedCount });
}

function toBlocks(detections: BackendDetection[]): OcrBlock[] {
  return detections.filter((region) => region.text.trim()).map((region) => ({
    text: region.text.trim(), confidence: region.confidence ?? 0,
    bbox: [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]],
    orientation: region.orientation === 'vertical' ? 'vertical' : 'horizontal', source: 'paddleocr',
  }));
}

export async function recognizeImage(imageBase64: string, engine: OcrEngine, backendUrl: string, sourceLang: string, signal?: AbortSignal) {
  if (engine === 'mangaocr' && sourceLang !== 'ja') throw new Error('MangaOCR reads Japanese only. Choose Japanese or switch to PaddleOCR.');
  const base = trimTrailingSlashes(backendUrl);
  const paddle = await recognize(`${base}/ocr/paddle`, { image: imageBase64, lang: sourceLang }, 'paddle', signal);
  if (engine === 'paddleocr' || !paddle.detections.length) return { blocks: toBlocks(paddle.detections), warnings: paddle.warnings };
  const plan = batchMangaBboxes(paddle.detections);
  const responses: Array<BackendDetection[] | null> = [];
  const warnings = [...paddle.warnings];
  let firstFailure: unknown;
  for (const batch of plan.batches) {
    signal?.throwIfAborted();
    try {
      const answer = await recognize(`${base}/ocr/manga`, { image: imageBase64, bboxes: batch.bboxes }, 'manga', signal, batch.indices.length);
      responses.push(answer.detections);
      warnings.push(...answer.warnings);
    } catch (error) {
      signal?.throwIfAborted();
      firstFailure ??= error;
      responses.push(null);
    }
  }
  if (firstFailure && responses.every((response) => response === null)) throw firstFailure;
  const merged = mergeMangaResults(paddle.detections, plan.batches, responses);
  if (merged.fellBack) warnings.push(`MangaOCR could not read ${merged.fellBack} regions; PaddleOCR text was used for those regions.`);
  if (merged.dropped) warnings.push(`${merged.dropped} regions contained no readable text.`);
  const blocks: OcrBlock[] = merged.blocks.map((block) => ({ ...block, bbox: [block.bbox[0], block.bbox[1], block.bbox[2], block.bbox[3]] }));
  return { blocks, warnings };
}
