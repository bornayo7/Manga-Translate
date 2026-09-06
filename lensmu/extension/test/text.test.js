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
