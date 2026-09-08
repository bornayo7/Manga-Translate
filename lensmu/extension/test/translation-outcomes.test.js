import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTranslationEntries,
  classifyTranslations,
  languagesClearlyDiffer
} from '../shared/translation-outcomes.js';

const blocks = (...texts) => texts.map((text) => ({ text }));

test('languagesClearlyDiffer needs two known, different languages', () => {
  assert.equal(languagesClearlyDiffer('ja', 'en'), true);
  assert.equal(languagesClearlyDiffer('en', 'en'), false);
  assert.equal(languagesClearlyDiffer('auto', 'en'), false, '"auto" is not a language');
  assert.equal(languagesClearlyDiffer('', 'en'), false);
  assert.equal(languagesClearlyDiffer('EN ', 'en'), false, 'compared after normalisation');
});

test('a block the manager skipped stays skipped even with no text back', () => {
  const entries = buildTranslationEntries(
    blocks('Already English'),
    [''],
    [{ status: 'skipped', reason: 'already-target-language' }]
  );
  assert.equal(entries[0].status, 'skipped');
  assert.equal(entries[0].reason, 'already-target-language');
});

test('a requested block with nothing back is a failure, not a skip', () => {
  const entries = buildTranslationEntries(blocks('こんにちは'), [''], [{ status: 'translated', reason: '' }]);
  assert.equal(entries[0].status, 'failed');
  assert.equal(entries[0].reason, 'empty-provider-output');
});

test('a worker that reports no outcomes is judged by content alone', () => {
  const entries = buildTranslationEntries(blocks('こんにちは', 'さようなら'), ['Hello', ''], null);
  assert.deepEqual(entries.map((entry) => entry.status), ['translated', 'failed']);
});

test('outcomes of the wrong length are ignored rather than misaligned', () => {
  const entries = buildTranslationEntries(blocks('a', 'b'), ['A', 'B'], [{ status: 'skipped', reason: 'x' }]);
  assert.deepEqual(entries.map((entry) => entry.status), ['translated', 'translated']);
});

test('every block skipped is a neutral verdict, not a failure', () => {
  const { verdict, skipped } = classifyTranslations({
    blocks: blocks('Already English', 'More English'),
    translations: ['', ''],
    reportedOutcomes: [
      { status: 'skipped', reason: 'already-target-language' },
      { status: 'skipped', reason: 'already-target-language' }
    ],
    sourceLanguage: 'auto',
    targetLanguage: 'en'
  });
  assert.deepEqual(verdict, { status: 'skipped', reason: 'already-target-language' });
  assert.equal(skipped.length, 2);
});

test('nothing usable from a provider that was asked is a failure', () => {
  const { verdict } = classifyTranslations({
    blocks: blocks('こんにちは'),
    translations: [''],
    sourceLanguage: 'ja',
    targetLanguage: 'en'
  });
  assert.deepEqual(verdict, { status: 'failed', reason: 'empty-provider-output' });
});

test('an echoed translation between clearly different languages is a failure', () => {
  const { verdict } = classifyTranslations({
    blocks: blocks('こんにちは'),
    translations: ['こんにちは'],
    sourceLanguage: 'ja',
    targetLanguage: 'en'
  });
  assert.deepEqual(verdict, { status: 'failed', reason: 'identical-output' });
});

test('identical output is allowed when the languages are not known to differ', () => {
  const { verdict } = classifyTranslations({
    blocks: blocks('Tokyo'),
    translations: ['Tokyo'],
    sourceLanguage: 'auto',
    targetLanguage: 'en'
  });
  assert.equal(verdict, null, 'auto source cannot establish a difference');
});

test('a mix of translated and skipped blocks renders, keeping block order', () => {
  const result = classifyTranslations({
    blocks: blocks('こんにちは', 'Already English'),
    translations: ['Hello', ''],
    reportedOutcomes: [
      { status: 'translated', reason: '' },
      { status: 'skipped', reason: 'already-target-language' }
    ],
    sourceLanguage: 'ja',
    targetLanguage: 'en'
  });
  assert.equal(result.verdict, null);
  assert.equal(result.translated.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.entries.map((entry) => entry.index), [0, 1]);
  assert.equal(result.entries[0].translation, 'Hello');
});

test('one failed block among translated ones still renders the rest', () => {
  const result = classifyTranslations({
    blocks: blocks('こんにちは', 'さようなら'),
    translations: ['Hello', ''],
    sourceLanguage: 'ja',
    targetLanguage: 'en'
  });
  assert.equal(result.verdict, null);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].index, 1);
});
