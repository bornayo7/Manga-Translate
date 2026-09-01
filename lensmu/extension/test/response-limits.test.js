import test from 'node:test';
import assert from 'node:assert/strict';

import { readResponseBytesWithLimit } from '../shared/response-limits.js';

test('readResponseBytesWithLimit combines a bounded streamed response', async () => {
  const response = new Response(
    new Blob([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
    { headers: { 'content-length': '4' } }
  );

  const bytes = await readResponseBytesWithLimit(response, 4);
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test('readResponseBytesWithLimit rejects an oversized declared response', async () => {
  const response = new Response(new Uint8Array([1]), {
    headers: { 'content-length': '100' }
  });

  await assert.rejects(() => readResponseBytesWithLimit(response, 10), /exceeds/);
});

test('readResponseBytesWithLimit stops an oversized streamed response', async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4, 5]));

  await assert.rejects(() => readResponseBytesWithLimit(response, 4), /exceeds/);
});
