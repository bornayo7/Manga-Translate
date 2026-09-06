import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureTranslatedText } from '../translate/libre-translate.js';

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
