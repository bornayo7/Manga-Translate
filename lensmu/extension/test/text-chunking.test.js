import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkText, chunkTextByBytes, utf8ByteLength } from '../shared/text-chunking.js';

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
  assert.throws(() => chunkTextByBytes('text', 0), RangeError);
});

test('utf8ByteLength counts bytes, not code units', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('é'), 2);
  assert.equal(utf8ByteLength('日本語'), 9);
  assert.equal(utf8ByteLength('😀'), 4);
});

// Recombine chunks the way the callers do (join with a space) and compare
// with whitespace removed on both sides: the chunker only ever changes
// whitespace between pieces, so every other character must survive in order.
function recombined(chunks) {
  return chunks.join(' ');
}
function normalised(text) {
  return text.replace(/\s+/g, '');
}

const CASES = [
  ['ASCII', 'The quick brown fox jumps over the lazy dog. '.repeat(40)],
  ['Japanese', 'これは長い日本語の文章です。'.repeat(60)],
  ['Chinese', '这是一个很长的中文句子，用来测试分块。'.repeat(50)],
  ['accented', 'Crème brûlée à la façon française, très délicieuse. '.repeat(30)],
  ['combining marks', 'éàîõü '.repeat(120)],
  ['emoji', '😀👍🏽🇯🇵 family 👨‍👩‍👧‍👦 '.repeat(60)]
];

for (const [label, input] of CASES) {
  test(`chunkTextByBytes keeps every ${label} chunk within 500 UTF-8 bytes and loses nothing`, () => {
    const chunks = chunkTextByBytes(input, 500);
    assert.ok(chunks.length > 1, 'input is large enough to need splitting');
    for (const chunk of chunks) {
      assert.ok(utf8ByteLength(chunk) <= 500, `chunk of ${utf8ByteLength(chunk)} bytes exceeds the limit`);
    }
    assert.equal(normalised(recombined(chunks)), normalised(input));
  });
}

test('a 200-character CJK string is over the 500-byte limit and is split, unlike the character check', () => {
  const cjk = '漢'.repeat(200);
  assert.equal(cjk.length, 200);
  assert.equal(utf8ByteLength(cjk), 600);
  assert.deepEqual(chunkText(cjk, 500), [cjk], 'the character-based helper keeps it whole');
  const chunks = chunkTextByBytes(cjk, 500);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => utf8ByteLength(chunk) <= 500));
  assert.equal(chunks.join(''), cjk);
});

test('chunkTextByBytes at the exact boundary and one byte over', () => {
  const exact = 'x'.repeat(498) + 'é'; // 498 + 2 = 500 bytes
  assert.equal(utf8ByteLength(exact), 500);
  assert.deepEqual(chunkTextByBytes(exact, 500), [exact]);

  const over = exact + 'z'; // 501 bytes
  const chunks = chunkTextByBytes(over, 500);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => utf8ByteLength(chunk) <= 500));
  assert.equal(chunks.join(''), over);
});

test('chunkTextByBytes never splits a surrogate pair or a combining sequence', () => {
  const pairs = '😀'.repeat(300); // 1200 bytes, 4 bytes each
  const chunks = chunkTextByBytes(pairs, 10);
  for (const chunk of chunks) {
    assert.ok(utf8ByteLength(chunk) <= 10);
    assert.doesNotMatch(chunk, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, 'lone high surrogate');
    assert.doesNotMatch(chunk, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'lone low surrogate');
  }
  assert.equal(chunks.join(''), pairs);

  const combining = 'é'.repeat(100); // 3 bytes per cluster
  const clusters = chunkTextByBytes(combining, 7);
  for (const chunk of clusters) {
    assert.ok(utf8ByteLength(chunk) <= 7);
    assert.doesNotMatch(chunk, /^́/, 'a chunk must not start with a combining mark');
  }
  assert.equal(clusters.join(''), combining);
});

test('chunkTextByBytes preserves sentence punctuation and order', () => {
  const input = '第一文。第二文！第三文？' + 'Fourth sentence. ' + '第五文。';
  const chunks = chunkTextByBytes(input, 16);
  assert.equal(normalised(recombined(chunks)), normalised(input));
  assert.equal(chunks[0].endsWith('。') || chunks[0].endsWith('！') || chunks[0].endsWith('？'), true);
});
