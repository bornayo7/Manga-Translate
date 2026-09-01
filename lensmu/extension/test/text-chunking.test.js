import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkText } from '../shared/text-chunking.js';

test('chunkText hard-splits an unpunctuated string at the limit', () => {
  const chunks = chunkText('A'.repeat(1201), 500);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [500, 500, 201]);
  assert.equal(chunks.join(''), 'A'.repeat(1201));
});

test('chunkText keeps every mixed-language chunk within the limit', () => {
  const input = `こんにちは。${'word '.repeat(180)}終わり！`;
  const chunks = chunkText(input, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
});

test('chunkText rejects invalid limits', () => {
  assert.throws(() => chunkText('text', 0), RangeError);
});
