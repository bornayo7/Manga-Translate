import test from 'node:test';
import assert from 'node:assert/strict';

import { parseNumberedResponse } from '../translate/llm-translate.js';

test('parseNumberedResponse keeps an empty middle entry empty', () => {
  assert.deepEqual(parseNumberedResponse('[1] Hello\n[2] \n[3] World', 3), ['Hello', '', 'World']);
});

test('parseNumberedResponse accepts markers with no space after the bracket', () => {
  assert.deepEqual(parseNumberedResponse('[1]Hello\n[2]World', 2), ['Hello', 'World']);
});

test('parseNumberedResponse keeps multi-line translations together', () => {
  assert.deepEqual(parseNumberedResponse('[1] Hello\nthere\n[2] World', 2), ['Hello\nthere', 'World']);
});

test('parseNumberedResponse ignores a preamble and accepts dot, paren and bold markers', () => {
  assert.deepEqual(
    parseNumberedResponse('Sure! Here are the translations:\n\n1. Hello\n2) World\n**[3]** Again', 3),
    ['Hello', 'World', 'Again']
  );
});

test('parseNumberedResponse leaves a skipped entry empty instead of shifting the rest', () => {
  assert.deepEqual(parseNumberedResponse('[1] a\n[3] c', 3), ['a', '', 'c']);
});

test('parseNumberedResponse treats numbers inside a translation as content', () => {
  assert.deepEqual(
    parseNumberedResponse('[1] Dates:\n2024. A year\n[2] Meet at\n1:30 PM\n[3] ok', 3),
    ['Dates:\n2024. A year', 'Meet at\n1:30 PM', 'ok']
  );
});

test('parseNumberedResponse falls back to bare lines only when no marker exists', () => {
  assert.deepEqual(parseNumberedResponse('Just one translation', 1), ['Just one translation']);
  assert.deepEqual(parseNumberedResponse('Hello\n\nWorld\n', 2), ['Hello', 'World']);
  assert.deepEqual(parseNumberedResponse('Hello\nWorld\nExtra', 2), ['', '']);
});

test('parseNumberedResponse handles CRLF, out-of-range markers and empty input', () => {
  assert.deepEqual(parseNumberedResponse('[1] a\r\n[2] b\r\n[9] ignored', 2), ['a', 'b\n[9] ignored']);
  assert.deepEqual(parseNumberedResponse('', 2), ['', '']);
  assert.deepEqual(parseNumberedResponse(undefined, 1), ['']);
});

import { extractClaudeText } from '../translate/llm-translate.js';

test('extractClaudeText skips thinking blocks and joins every text block', () => {
  const data = {
    content: [
      { type: 'thinking', thinking: 'The first bubble is a greeting.' },
      { type: 'text', text: '[1] Hello' },
      { type: 'text', text: '[2] Goodbye' }
    ]
  };

  assert.equal(extractClaudeText(data), '[1] Hello\n[2] Goodbye');
  assert.equal(extractClaudeText({ content: [{ type: 'thinking', thinking: '...' }] }), '');
  assert.equal(extractClaudeText({}), '');
});

import { estimateOutputTokens } from '../translate/llm-translate.js';

test('estimateOutputTokens grows with the request and stays inside provider limits', () => {
  assert.equal(estimateOutputTokens([]), 1024);
  assert.equal(estimateOutputTokens(['こんにちは']), 1024);

  const denseBubbles = Array.from({ length: 60 }, () => 'それは本当に大変なことだったんだよね');
  const dense = estimateOutputTokens(denseBubbles);
  assert.ok(dense > 2000, `dense page budget ${dense} should exceed the old fixed 2000`);
  assert.ok(dense <= 8192);

  const huge = estimateOutputTokens(Array.from({ length: 500 }, () => 'x'.repeat(200)));
  assert.equal(huge, 8192);
});
