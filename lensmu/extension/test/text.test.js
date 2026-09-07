import test from 'node:test';
import assert from 'node:assert/strict';

import { describeHttpFailure } from '../shared/text.js';

test('describeHttpFailure prefers the FastAPI detail string', () => {
  assert.equal(
    describeHttpFailure(501, 'Not Implemented', { detail: 'PaddleOCR is not installed. See requirements-ocr.txt.' }),
    'PaddleOCR is not installed. See requirements-ocr.txt.'
  );
});

test('describeHttpFailure flattens a pydantic field error and drops its prefix', () => {
  // Exactly what FastAPI emits for MangaOCRRequest.validate_bboxes.
  const validatorError = {
    detail: [{
      type: 'value_error',
      loc: ['body', 'bboxes'],
      msg: 'Value error, bbox 0 must satisfy x2 > x1 and y2 > y1',
      input: [[0, 10, 10, 5]]
    }]
  };
  assert.equal(
    describeHttpFailure(422, 'Unprocessable Entity', validatorError),
    'bboxes: bbox 0 must satisfy x2 > x1 and y2 > y1'
  );

  // And what it emits when StrictInt rejects a coordinate.
  const typeError = {
    detail: [{ type: 'int_type', loc: ['body', 'bboxes', 0, 2], msg: 'Input should be a valid integer', input: 10.5 }]
  };
  assert.equal(
    describeHttpFailure(422, 'Unprocessable Entity', typeError),
    'bboxes.0.2: Input should be a valid integer'
  );
});

test('describeHttpFailure accepts a plain list of messages', () => {
  assert.equal(
    describeHttpFailure(500, 'Internal Server Error', { error: ['Model not found', 'Retry with a different model'] }),
    'Model not found'
  );
});

test('describeHttpFailure accepts error and message fields from other services', () => {
  assert.equal(describeHttpFailure(401, '', { error: 'bad key' }), 'bad key');
  assert.equal(describeHttpFailure(401, '', { message: 'expired' }), 'expired');
});

test('describeHttpFailure falls back to the status for HTML or empty bodies', () => {
  assert.equal(describeHttpFailure(502, 'Bad Gateway', '<html><body>nginx</body></html>'), 'HTTP 502 Bad Gateway');
  assert.equal(describeHttpFailure(500, 'Internal Server Error', null), 'HTTP 500 Internal Server Error');
  assert.equal(describeHttpFailure(500, '', {}), 'HTTP 500');
  assert.equal(describeHttpFailure(404, 'Not Found', 'no such route'), 'no such route');
});

import { MAX_MANGA_REGIONS, selectMangaBboxes } from '../shared/text.js';

test('selectMangaBboxes drops boxes the backend validator would reject', () => {
  const boxes = selectMangaBboxes([
    { bbox: [10, 20, 30, 40] },
    { bbox: [5, 5, 5, 9] },
    { bbox: [-1, 0, 10, 10] },
    { bbox: [0, 0, 100001, 10] },
    { bbox: [1, 2, 3] },
    { bbox: '1,2,3,4' },
    { bbox: [1.4, 2.6, 9.5, 8.2] },
    {}
  ]);

  assert.deepEqual(boxes, [[10, 20, 30, 40], [1, 3, 10, 8]]);
});

test('selectMangaBboxes keeps the first boxes when the count limit is hit', () => {
  const detections = Array.from({ length: MAX_MANGA_REGIONS + 5 }, (_, index) => ({
    bbox: [0, index * 10, 10, index * 10 + 5]
  }));

  const boxes = selectMangaBboxes(detections);
  assert.equal(boxes.length, MAX_MANGA_REGIONS);
  assert.deepEqual(boxes[0], [0, 0, 10, 5]);
});

test('selectMangaBboxes stops before the summed area exceeds the limit', () => {
  const boxes = selectMangaBboxes([
    { bbox: [0, 0, 5000, 5000] },
    { bbox: [0, 0, 5000, 5000] },
    { bbox: [0, 0, 10, 10] }
  ]);

  assert.deepEqual(boxes, [[0, 0, 5000, 5000], [0, 0, 5000, 5000]]);
});

import { toContentScriptBlocks } from '../shared/text.js';

test('toContentScriptBlocks converts corner boxes and applies engine defaults', () => {
  const blocks = toContentScriptBlocks(
    [
      { text: 'こんにちは', bbox: [10.4, 20, 30.6, 80] },
      { text: '   ', bbox: [0, 0, 10, 10] },
      { text: 'sure', bbox: [5, 5, 50, 15], confidence: 0.42, orientation: 'horizontal' },
      { text: 42, bbox: 'nope', confidence: 'high', orientation: 'diagonal' }
    ],
    { defaultConfidence: 0.9, defaultOrientation: 'vertical' }
  );

  assert.deepEqual(blocks, [
    { text: 'こんにちは', confidence: 0.9, bbox: { x: 10, y: 20, width: 21, height: 60 }, orientation: 'vertical' },
    { text: 'sure', confidence: 0.42, bbox: { x: 5, y: 5, width: 45, height: 10 }, orientation: 'horizontal' },
    { text: '42', confidence: 0.9, bbox: { x: 0, y: 0, width: 0, height: 0 }, orientation: 'vertical' }
  ]);
});

test('toContentScriptBlocks tolerates a missing detections list', () => {
  assert.deepEqual(toContentScriptBlocks(undefined), []);
  assert.deepEqual(toContentScriptBlocks(null), []);
});

import { trimTrailingSlashes } from '../shared/text.js';

test('trimTrailingSlashes strips the slashes a pasted base URL usually carries', () => {
  assert.equal(trimTrailingSlashes('http://localhost:8000/'), 'http://localhost:8000');
  assert.equal(trimTrailingSlashes('  http://localhost:11434/v1// '), 'http://localhost:11434/v1');
  assert.equal(trimTrailingSlashes('http://localhost:8000'), 'http://localhost:8000');
  assert.equal(trimTrailingSlashes(''), '');
  assert.equal(trimTrailingSlashes(undefined), '');
});

test('describeHttpFailure skips an empty detail in favour of a populated sibling field', () => {
  assert.equal(describeHttpFailure(500, 'Internal Server Error', { detail: '', error: 'Model not found' }), 'Model not found');
  assert.equal(describeHttpFailure(500, 'Internal Server Error', { detail: [], message: 'nope' }), 'nope');
});
