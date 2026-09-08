import test from 'node:test';
import assert from 'node:assert/strict';

import {
  batchMangaBboxes,
  mergeMangaResults,
  parseGoogleVisionResponse
} from '../shared/ocr-responses.js';
import { MAX_MANGA_REGIONS, MAX_MANGA_TOTAL_REGION_PIXELS } from '../shared/text.js';

function detection(index, text = `t${index}`, size = 10) {
  return { text, bbox: [0, index * (size + 1), size, index * (size + 1) + size], confidence: 0.8, orientation: 'vertical' };
}

test('201 valid regions become two compliant batches that preserve region identity', () => {
  const detections = Array.from({ length: MAX_MANGA_REGIONS + 1 }, (_, index) => detection(index));
  const plan = batchMangaBboxes(detections);

  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0].bboxes.length, MAX_MANGA_REGIONS);
  assert.equal(plan.batches[1].bboxes.length, 1);
  assert.deepEqual(plan.batches[1].indices, [MAX_MANGA_REGIONS]);
  assert.deepEqual(plan.invalid, []);
  assert.deepEqual(plan.oversized, []);
  const total = plan.batches.reduce((sum, batch) => sum + batch.indices.length, 0);
  assert.equal(total, MAX_MANGA_REGIONS + 1, 'nothing was dropped');
});

test('exactly the limit stays one batch; area overflow starts a new batch', () => {
  const exact = batchMangaBboxes(Array.from({ length: MAX_MANGA_REGIONS }, (_, index) => detection(index)));
  assert.equal(exact.batches.length, 1);

  const big = { text: 'big', bbox: [0, 0, 5000, 5000] }; // 25 MP
  const plan = batchMangaBboxes([big, big, big]);
  assert.equal(plan.batches.length, 2, 'two 25 MP boxes fit in 50 MP; the third needs another request');
  assert.deepEqual(plan.batches[0].indices, [0, 1]);
  assert.deepEqual(plan.batches[1].indices, [2]);
});

test('invalid and single oversized regions are excluded from every batch and reported', () => {
  const plan = batchMangaBboxes([
    detection(0),
    { text: 'bad', bbox: [5, 5, 5, 9] },
    { text: 'huge', bbox: [0, 0, 8000, 8000] }, // 64 MP alone exceeds the aggregate limit
    { text: 'nobox' },
    detection(4)
  ]);
  assert.deepEqual(plan.batches.map((batch) => batch.indices), [[0, 4]]);
  assert.deepEqual(plan.invalid, [1, 3]);
  assert.deepEqual(plan.oversized, [2]);
  assert.ok(8000 * 8000 > MAX_MANGA_TOTAL_REGION_PIXELS);
});

test('empty detections produce no batches', () => {
  assert.deepEqual(batchMangaBboxes([]), { batches: [], invalid: [], oversized: [] });
  assert.deepEqual(batchMangaBboxes(undefined), { batches: [], invalid: [], oversized: [] });
});

test('merged results follow detection order across batches and keep PaddleOCR text where MangaOCR is empty', () => {
  const detections = [detection(0, 'paddle-0'), detection(1, 'paddle-1'), detection(2, 'paddle-2'), detection(3, 'paddle-3')];
  const batches = [
    { indices: [0, 1], bboxes: [detections[0].bbox, detections[1].bbox] },
    { indices: [2, 3], bboxes: [detections[2].bbox, detections[3].bbox] }
  ];
  const responses = [
    [{ text: 'manga-0', bbox: detections[0].bbox }, { text: '', bbox: detections[1].bbox }],
    [{ text: '  ', bbox: detections[2].bbox }, { text: 'manga-3', bbox: detections[3].bbox }]
  ];

  const merged = mergeMangaResults(detections, batches, responses);
  assert.deepEqual(
    merged.blocks.map((block) => [block.text, block.source]),
    [['manga-0', 'mangaocr'], ['paddle-1', 'paddleocr'], ['paddle-2', 'paddleocr'], ['manga-3', 'mangaocr']]
  );
  assert.equal(merged.recognized, 2);
  assert.equal(merged.fellBack, 2);
  assert.equal(merged.dropped, 0);
  assert.equal(merged.unexpectedBatches, 0);
  // Geometry, confidence and orientation come from the detector; MangaOCR
  // reports neither, and nothing is borrowed from a neighbouring region.
  assert.deepEqual(merged.blocks[0].bbox, detections[0].bbox);
  assert.equal(merged.blocks[0].confidence, 0.8);
  assert.equal(merged.blocks[0].orientation, 'vertical');
  assert.equal(merged.blocks[1].text, 'paddle-1');
});

test('an all-empty MangaOCR answer keeps every PaddleOCR text instead of vanishing', () => {
  const detections = [detection(0, 'a'), detection(1, 'b')];
  const plan = batchMangaBboxes(detections);
  const merged = mergeMangaResults(detections, plan.batches, [[{ text: '' }, { text: '' }]]);
  assert.deepEqual(merged.blocks.map((block) => block.text), ['a', 'b']);
  assert.equal(merged.fellBack, 2);
});

test('a missing or wrongly sized batch response falls back for that batch only and is counted', () => {
  const detections = [detection(0, 'a'), detection(1, 'b'), detection(2, 'c')];
  const batches = [{ indices: [0, 1], bboxes: [] }, { indices: [2], bboxes: [] }];

  const missing = mergeMangaResults(detections, batches, [null, [{ text: 'C!' }]]);
  assert.deepEqual(missing.blocks.map((block) => [block.text, block.source]), [['a', 'paddleocr'], ['b', 'paddleocr'], ['C!', 'mangaocr']]);
  assert.equal(missing.unexpectedBatches, 1);

  const wrongLength = mergeMangaResults(detections, batches, [[{ text: 'A!' }], [{ text: 'C!' }]]);
  assert.equal(wrongLength.blocks[0].text, 'a', 'a short answer is not aligned by guesswork');
  assert.equal(wrongLength.unexpectedBatches, 1);
});

test('a region with no text from either engine is dropped and counted, not invented', () => {
  const detections = [detection(0, ''), detection(1, 'b')];
  const merged = mergeMangaResults(detections, [{ indices: [0, 1], bboxes: [] }], [[{ text: '' }, { text: 'B!' }]]);
  assert.deepEqual(merged.blocks.map((block) => block.text), ['B!']);
  assert.equal(merged.dropped, 1);
});

test('an image-level Google Vision error inside an HTTP 200 is a failure', () => {
  assert.throws(
    () => parseGoogleVisionResponse({ responses: [{ error: { code: 3, message: 'Bad image data.' } }] }),
    /Google Cloud Vision could not process the image \(3\): Bad image data\./
  );
});

test('valid empty Vision detection is a distinct no-text outcome', () => {
  assert.deepEqual(parseGoogleVisionResponse({ responses: [{}] }), { blocks: [], sourceLang: 'auto', noText: true });
  assert.deepEqual(parseGoogleVisionResponse({ responses: [{ textAnnotations: [] }] }), { blocks: [], sourceLang: 'auto', noText: true });
});

test('invalid or missing Vision response arrays cannot masquerade as success', () => {
  assert.throws(() => parseGoogleVisionResponse({}), /no image results/);
  assert.throws(() => parseGoogleVisionResponse({ responses: [] }), /no image results/);
  assert.throws(() => parseGoogleVisionResponse({ responses: 'nope' }), /no image results/);
  assert.throws(() => parseGoogleVisionResponse({ responses: [null] }), /unexpected image result/);
});

test('a normal Vision answer maps words to boxes and reads the locale', () => {
  const result = parseGoogleVisionResponse({
    responses: [{
      textAnnotations: [
        { locale: 'ja', description: 'こんにちは 世界', boundingPoly: { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }] } },
        { description: 'こんにちは', boundingPoly: { vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 20 }, { x: 0, y: 20 }] } },
        { description: '世界', boundingPoly: { vertices: [{ x: 60 }, { x: 100 }, { x: 100, y: 20 }, { x: 60, y: 20 }] } }
      ]
    }]
  });
  assert.equal(result.sourceLang, 'ja');
  assert.equal(result.noText, false);
  assert.deepEqual(result.blocks.map((block) => block.text), ['こんにちは', '世界']);
  assert.deepEqual(result.blocks[1].bbox, { x: 60, y: 0, width: 40, height: 20 });
});
