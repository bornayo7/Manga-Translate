import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateOutputTokens,
  extractClaudeText,
  parseGeminiResponse,
  parseNumberedResponse,
  parseNumberedResponseStrict,
  requireResponseText,
  translateWithLLM
} from '../translate/llm-translate.js';
import { chatCompletion, installFetchMock } from './helpers/fetch-mock.js';

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

test('a missing number is reported, never filled from a neighbour', () => {
  const parsed = parseNumberedResponseStrict('[1] First bubble\n[3] Third bubble', 3);
  assert.deepEqual(parsed.translations, ['First bubble', '', 'Third bubble']);
  assert.deepEqual(parsed.missing, [2]);
  assert.equal(parsed.problems, true);
  assert.notEqual(parsed.translations[1], 'Third bubble');
});

test('duplicate and out-of-range numbers are rejected instead of absorbed', () => {
  const duplicated = parseNumberedResponseStrict('[1] a\n[2] b\n[2] c', 2);
  assert.deepEqual(duplicated.duplicates, [2]);
  assert.equal(duplicated.problems, true);
  assert.equal(duplicated.translations[1], 'b', 'the first occurrence is kept for the retry decision');

  const extra = parseNumberedResponseStrict('[1] a\r\n[2] b\r\n[9] extra', 2);
  assert.deepEqual(extra.outOfRange, [9]);
  assert.equal(extra.problems, true);
  assert.deepEqual(extra.translations, ['a', 'b']);
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
  const mismatch = parseNumberedResponseStrict('Hello\nWorld\nExtra', 2);
  assert.deepEqual(mismatch.translations, ['', '']);
  assert.deepEqual(mismatch.missing, [1, 2]);
  assert.equal(mismatch.mode, 'none');
});

test('parseNumberedResponse handles CRLF and empty input', () => {
  assert.deepEqual(parseNumberedResponse('[1] a\r\n[2] b', 2), ['a', 'b']);
  assert.deepEqual(parseNumberedResponse('', 2), ['', '']);
  assert.deepEqual(parseNumberedResponse(undefined, 1), ['']);
  assert.equal(parseNumberedResponseStrict('', 2).problems, true);
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

test('requireResponseText passes text through and names the reason for an empty reply', () => {
  assert.equal(requireResponseText('Claude', '[1] Hi', 'end_turn'), '[1] Hi');
  assert.throws(() => requireResponseText('Claude', '', 'max_tokens'), /output limit/);
  assert.throws(() => requireResponseText('OpenAI', '   ', 'length'), /output limit/);
  assert.throws(() => requireResponseText('OpenAI', undefined, 'content_filter'), /returned no text \(content_filter\)/);
  assert.throws(() => requireResponseText('The custom API', ''), /returned no text\./);
});

/*
 * End-to-end through translateWithLLM against a mocked OpenAI-compatible
 * endpoint (the "custom" provider: no API key, plain fetch), so the retry
 * and rejection paths are exercised in the production function.
 */
const TEXTS = ['一つ目', '二つ目', '三つ目'];

async function runCustom(handler) {
  const mock = installFetchMock(handler);
  try {
    return await translateWithLLM(TEXTS, 'ja', 'en', '', 'custom', 'local-model', 'http://localhost:11434/v1');
  } finally {
    mock.restore();
  }
}

test('a missing block is re-requested alone and slotted back by its original index', async () => {
  const mock = installFetchMock(({ call }) => {
    if (call === 1) {
      return chatCompletion('[1] First bubble\n[3] Third bubble', 'length');
    }
    return chatCompletion('[1] Second bubble');
  });

  try {
    const result = await translateWithLLM(TEXTS, 'ja', 'en', '', 'custom', 'local-model', 'http://localhost:11434/v1');
    assert.deepEqual(result.translations, ['First bubble', 'Second bubble', 'Third bubble']);
    assert.equal(result.retryCount, 1);
    assert.equal(mock.calls.length, 2);
    // The retry asked for block 2 only, renumbered [1].
    const retryPrompt = mock.calls[1].body.messages[1].content;
    assert.match(retryPrompt, /\[1\] 二つ目/);
    assert.doesNotMatch(retryPrompt, /三つ目/);
    assert.equal(mock.calls[0].init.headers.Authorization, undefined, 'no Authorization header without a key');
  } finally {
    mock.restore();
  }
});

test('truncated output that stays incomplete after the retry is an error, not a partial success', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runCustom(() => {
        calls += 1;
        // First answer stops after block 1; the retry for blocks 2 and 3
        // stops after its first block again. Block 3 never arrives.
        return chatCompletion(calls === 1 ? '[1] First bubble' : '[1] Second bubble', 'length');
      }),
    (error) => {
      assert.match(error.message, /incomplete numbered response for 3 text blocks/);
      assert.match(error.message, /missing block 3/);
      assert.match(error.message, /output limit/);
      return true;
    }
  );
  assert.equal(calls, 2, 'the retry is bounded to one attempt');
});

test('duplicate numbering is retried whole and rejected if it persists', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runCustom(() => {
        calls += 1;
        return chatCompletion('[1] a\n[2] b\n[2] c\n[3] d');
      }),
    /duplicate number 2/
  );
  assert.equal(calls, 2, 'exactly one retry');
});

test('a clean numbered response needs no retry', async () => {
  const mock = installFetchMock(() => chatCompletion('[1] One\n[2] Two\n[3] Three'));
  try {
    const result = await translateWithLLM(TEXTS, 'ja', 'en', '', 'custom', 'local-model', 'http://localhost:11434/v1');
    assert.deepEqual(result.translations, ['One', 'Two', 'Three']);
    assert.equal(result.retryCount, 0);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].body.max_tokens, estimateOutputTokens(TEXTS));
  } finally {
    mock.restore();
  }
});

test('an HTTP error surfaces the provider message and never retries', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runCustom(() => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: 'model not found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }),
    /Custom API error \(404\): model not found/
  );
  assert.equal(calls, 1);
});
