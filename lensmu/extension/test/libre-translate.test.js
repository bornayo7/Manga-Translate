import test from 'node:test';
import assert from 'node:assert/strict';

import { translateWithMyMemory } from '../translate/libre-translate.js';
import { utf8ByteLength } from '../shared/text-chunking.js';
import { installFetchMock } from './helpers/fetch-mock.js';

function myMemoryReply(translatedText) {
  return { responseStatus: 200, responseData: { translatedText, match: 1 } };
}

function requestedText(call) {
  return new URL(call.url).searchParams.get('q');
}

test('every outgoing MyMemory request stays within 500 UTF-8 bytes and text is recombined in order', async () => {
  const mock = installFetchMock(({ url }) => myMemoryReply(`T(${new URL(url).searchParams.get('q').length})`));
  try {
    const long = '這是一個很長的中文句子，用來測試按位元組分塊。'.repeat(12); // well over 500 bytes, 288 chars
    const result = await translateWithMyMemory([long, '你好'], 'zh', 'en');
    assert.ok(mock.calls.length > 2, 'the long text needed several requests');
    for (const call of mock.calls) {
      assert.ok(utf8ByteLength(requestedText(call)) <= 500, 'a request exceeded 500 bytes');
    }
    assert.equal(mock.calls.slice(0, -1).map(requestedText).join(''), long.replace(/\s+/g, ''));
    assert.equal(result.translations.length, 2);
    assert.match(result.translations[0], /^T\(\d+\)( T\(\d+\))+$/);
  } finally {
    mock.restore();
  }
});

test('the source language is explicit in every langpair; "auto" is resolved from the text', async () => {
  const mock = installFetchMock(() => myMemoryReply('Hello'));
  try {
    await translateWithMyMemory(['これは日本語です'], 'auto', 'en');
    assert.equal(new URL(mock.calls[0].url).searchParams.get('langpair'), 'ja|en');

    await translateWithMyMemory(['Hello there'], 'ja', 'en');
    assert.equal(new URL(mock.calls[1].url).searchParams.get('langpair'), 'ja|en', 'an explicit choice is never overridden');

    assert.equal(mock.calls.every((call) => !/autodetect/i.test(call.url)), true, 'no undocumented autodetect value is ever sent');
  } finally {
    mock.restore();
  }
});

test('an undecidable block is reported empty while decidable blocks still translate; all-undecidable fails whole', async () => {
  const mock = installFetchMock(() => myMemoryReply('Hello'));
  try {
    const result = await translateWithMyMemory(['東京', 'これは日本語です'], 'auto', 'en');
    assert.deepEqual(result.translations, ['', 'Hello']);
    assert.deepEqual(result.unresolvedIndices, [0]);
    assert.equal(mock.calls.length, 1);

    await assert.rejects(
      () => translateWithMyMemory(['東京'], 'auto', 'en'),
      /needs an explicit source language/
    );
  } finally {
    mock.restore();
  }
});

test('concurrent callers are paced globally to at most one request per 100 ms', async () => {
  const stamps = [];
  const mock = installFetchMock(() => {
    stamps.push(Date.now());
    return myMemoryReply('x');
  });
  try {
    await Promise.all([
      translateWithMyMemory(['これは日本語です', 'それも日本語です'], 'auto', 'en'),
      translateWithMyMemory(['안녕하세요', '감사합니다'], 'auto', 'en'),
      translateWithMyMemory(['Привет'], 'ru', 'en')
    ]);
    assert.equal(stamps.length, 5);
    for (let index = 1; index < stamps.length; index++) {
      assert.ok(stamps[index] - stamps[index - 1] >= 90, `requests ${index - 1} and ${index} were only ${stamps[index] - stamps[index - 1]} ms apart`);
    }
  } finally {
    mock.restore();
  }
});

test('a cancelled signal stops the request chain without being reported as a MyMemory failure', async () => {
  const controller = new AbortController();
  const mock = installFetchMock(() => myMemoryReply('x'));
  try {
    controller.abort();
    await assert.rejects(
      () => translateWithMyMemory(['これは日本語です'], 'auto', 'en', { signal: controller.signal }),
      (error) => error.name === 'AbortError'
    );
  } finally {
    mock.restore();
  }
});
