import test from 'node:test';
import assert from 'node:assert/strict';

import { describeHttpFailure } from '../shared/text.js';

test('describeHttpFailure prefers the FastAPI detail string', () => {
  assert.equal(
    describeHttpFailure(501, 'Not Implemented', { detail: 'PaddleOCR is not installed. See requirements-ocr.txt.' }),
    'PaddleOCR is not installed. See requirements-ocr.txt.'
  );
});

test('describeHttpFailure flattens a pydantic field error', () => {
  const body = {
    detail: [{ loc: ['body', 'bboxes', 0], msg: 'bbox 0 must satisfy x2 > x1 and y2 > y1', type: 'value_error' }]
  };

  assert.equal(describeHttpFailure(422, 'Unprocessable Entity', body), 'bboxes.0: bbox 0 must satisfy x2 > x1 and y2 > y1');
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
