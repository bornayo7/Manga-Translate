import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MYMEMORY_BYTE_LIMIT,
  assertMyMemoryStatus,
  buildMyMemoryLangPair,
  ensureTranslatedText,
  exceedsMyMemoryLimit,
  resolveMyMemorySourceLanguage
} from '../shared/mymemory.js';

test('ensureTranslatedText returns a clean translation untouched', () => {
  assert.equal(ensureTranslatedText('  Hello there ', 'こんにちは', 'MyMemory'), 'Hello there');
});

test('ensureTranslatedText keeps a translation that merely carries an appended warning', () => {
  const warned = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    assert.equal(
      ensureTranslatedText('Hello MYMEMORY WARNING: YOU ARE CLOSE TO YOUR DAILY LIMIT', 'こんにちは', 'MyMemory'),
      'Hello'
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /You are close to your daily limit/);
});

test('ensureTranslatedText reports an exhausted quota instead of an empty payload', () => {
  assert.throws(
    () =>
      ensureTranslatedText(
        'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 16 HOURS',
        'こんにちは',
        'MyMemory'
      ),
    /MyMemory quota: You used all available free translations for today\. next available in 16 hours/
  );
});

test('ensureTranslatedText still rejects a genuinely empty payload', () => {
  assert.throws(() => ensureTranslatedText('', 'text', 'MyMemory'), /empty translatedText payload/);
});

test('malformed success cannot turn JSON objects or numbers into translated text', () => {
  for (const value of [null, undefined, 123, true, [], { unexpected: 'shape' }]) {
    assert.throws(() => ensureTranslatedText(value, 'こんにちは'), /invalid translatedText/);
  }
  for (const value of [null, [], { responseStatus: 'not-a-status' }, { responseStatus: {} }, { responseStatus: null }]) {
    assert.throws(() => assertMyMemoryStatus(value), /invalid response/);
  }
});

test('assertMyMemoryStatus reads the real outcome out of a 200 body', () => {
  assert.doesNotThrow(() => assertMyMemoryStatus({ responseStatus: 200, responseData: { translatedText: 'Hi' } }));
  assert.doesNotThrow(() => assertMyMemoryStatus({ responseStatus: '200' }));
  assert.throws(() => assertMyMemoryStatus({ responseStatus: '403', responseDetails: 'LIMIT' }), /MyMemory error \(403\): LIMIT/);
  assert.throws(() => assertMyMemoryStatus({ responseStatus: 429 }), /MyMemory error \(429\)/);
  assert.throws(
    () => assertMyMemoryStatus({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: '' } }),
    /daily quota reached/
  );
  assert.doesNotThrow(() =>
    assertMyMemoryStatus({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'still here' } })
  );
});

test('the request size limit is measured in UTF-8 bytes', () => {
  assert.equal(MYMEMORY_BYTE_LIMIT, 500);
  assert.equal(exceedsMyMemoryLimit('x'.repeat(500)), false);
  assert.equal(exceedsMyMemoryLimit('x'.repeat(501)), true);
  assert.equal(exceedsMyMemoryLimit('漢'.repeat(166)), false, '498 bytes');
  assert.equal(exceedsMyMemoryLimit('漢'.repeat(167)), true, '501 bytes');
  assert.equal(exceedsMyMemoryLimit('漢'.repeat(200)), true, '200 characters is already 600 bytes');
});

test('an explicit source language is sent as-is and never re-detected', () => {
  assert.deepEqual(resolveMyMemorySourceLanguage('ja', 'Hello there'), { language: 'ja', detected: false, reason: 'explicit' });
  assert.equal(resolveMyMemorySourceLanguage('zh-CN', '这是中文').language, 'zh');
  assert.equal(buildMyMemoryLangPair('ja', 'en'), 'ja|en');
});

test('"auto" is resolved from the script when the evidence is decisive', () => {
  assert.equal(resolveMyMemorySourceLanguage('auto', 'これは日本語です').language, 'ja');
  assert.equal(resolveMyMemorySourceLanguage('auto', '안녕하세요').language, 'ko');
  assert.equal(resolveMyMemorySourceLanguage('auto', 'Как дела?').language, 'ru');
  assert.equal(resolveMyMemorySourceLanguage('', 'The cat sat on the mat and the dog was there too').language, 'en');
});

test('"auto" is refused, with guidance, when the text cannot be told apart', () => {
  assert.throws(
    () => resolveMyMemorySourceLanguage('auto', '東京'),
    /needs an explicit source language.*Han characters/
  );
  assert.throws(
    () => resolveMyMemorySourceLanguage('auto', 'Ausfahrt'),
    /needs an explicit source language/
  );
});
