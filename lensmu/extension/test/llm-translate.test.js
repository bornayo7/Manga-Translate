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

test('parseNumberedResponse ignores a preamble and accepts dot and paren markers', () => {
  assert.deepEqual(
    parseNumberedResponse('Sure! Here are the translations:\n\n1. Hello\n2) World\n3. Again', 3),
    ['Hello', 'World', 'Again']
  );
});

test('parseNumberedResponse accepts markdown-bold bracket markers', () => {
  assert.deepEqual(parseNumberedResponse('**[1]** Hello\n**[2]** World', 2), ['Hello', 'World']);
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

import { parseGeminiResponse } from '../translate/llm-translate.js';

test('parseGeminiResponse joins text parts on their own lines and skips thinking parts', () => {
  const data = {
    candidates: [{
      content: { parts: [{ text: 'reasoning...', thought: true }, { text: '[1] Hello' }, { text: '[2] Bye' }] },
      finishReason: 'STOP'
    }]
  };

  assert.equal(parseGeminiResponse(data), '[1] Hello\n[2] Bye');
  assert.deepEqual(parseNumberedResponse(parseGeminiResponse(data), 2), ['Hello', 'Bye']);
});

test('parseGeminiResponse names the reason when Gemini refuses or stops early', () => {
  assert.throws(
    () => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
    /refused the request \(SAFETY\)/
  );
  assert.throws(
    () => parseGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
    /stopped without a translation \(SAFETY\)/
  );
  assert.throws(
    () => parseGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
    /output limit/
  );
  assert.throws(() => parseGeminiResponse({}), /no candidates/);
});

test('parseNumberedResponse keeps a numbered list inside a bracketed entry as content', () => {
  assert.deepEqual(
    parseNumberedResponse('[1] Rules:\n1. No shouting\n2. No running\n[2] Fine, got it.', 2),
    ['Rules:\n1. No shouting\n2. No running', 'Fine, got it.']
  );
});

test('parseNumberedResponse does not read a decimal or an unspaced number as a marker', () => {
  assert.deepEqual(
    parseNumberedResponse('1. The price is\n3.50 dollars each\n2. Deal', 2),
    ['The price is\n3.50 dollars each', 'Deal']
  );
  assert.deepEqual(parseNumberedResponse('[1] Chapter\n2.Return\n[2] End', 2), ['Chapter\n2.Return', 'End']);
  assert.deepEqual(parseNumberedResponse('**1.** Hello\n**2.** World', 2), ['Hello', 'World']);
});
