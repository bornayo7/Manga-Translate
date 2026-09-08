import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMBIGUOUS_SCRIPT_CONFIDENCE,
  TARGET_LANGUAGE_SKIP_THRESHOLD,
  detectSourceLanguage,
  getScriptLanguageEvidence,
  getTargetLanguageConfidence,
  normalizeLanguageCode
} from '../shared/language-detection.js';

test('normalizeLanguageCode folds aliases and regional Chinese variants', () => {
  assert.equal(normalizeLanguageCode('Japanese'), 'ja');
  assert.equal(normalizeLanguageCode('zh-CN'), 'zh');
  assert.equal(normalizeLanguageCode('zh_TW'), 'zh');
  assert.equal(normalizeLanguageCode('en-US'), 'en');
  assert.equal(normalizeLanguageCode(''), 'auto');
  assert.equal(normalizeLanguageCode('Autodetect'), 'auto');
});

test('Han characters alone are ambiguous between Japanese and Chinese', () => {
  const ja = getScriptLanguageEvidence('这是中文。', 'ja');
  const zh = getScriptLanguageEvidence('这是中文。', 'zh');
  assert.deepEqual(ja, { confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, ambiguous: true });
  assert.deepEqual(zh, { confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, ambiguous: true });
  assert.ok(AMBIGUOUS_SCRIPT_CONFIDENCE < TARGET_LANGUAGE_SKIP_THRESHOLD);
});

test('kana establishes Japanese and rules Chinese out', () => {
  assert.equal(getScriptLanguageEvidence('漢字が多い日本語', 'ja').confidence >= TARGET_LANGUAGE_SKIP_THRESHOLD, true);
  assert.deepEqual(getScriptLanguageEvidence('漢字が多い日本語', 'zh'), { confidence: 0, ambiguous: false });
});

test('exclusive scripts identify their language', () => {
  assert.equal(getScriptLanguageEvidence('안녕하세요', 'ko').confidence, 1);
  assert.equal(getScriptLanguageEvidence('สวัสดี', 'th').confidence, 1);
  assert.equal(getScriptLanguageEvidence('مرحبا', 'ar').confidence, 1);
  assert.equal(getScriptLanguageEvidence('नमस्ते', 'hi').confidence, 1);
  assert.equal(getScriptLanguageEvidence('Hello', 'ko').confidence, 0);
});

test('getTargetLanguageConfidence returns a decisive score only for clear stop-word evidence', () => {
  const english = getTargetLanguageConfidence('This is the text that we have been looking for', 'en');
  assert.ok(english.confidence >= TARGET_LANGUAGE_SKIP_THRESHOLD);
  const french = getTargetLanguageConfidence('This is the text that we have been looking for', 'fr');
  assert.equal(french.confidence, 0);
  assert.equal(getTargetLanguageConfidence('Ausfahrt', 'de').confidence, 0, 'one word is not evidence');
});

test('detectSourceLanguage names a language only when the evidence is decisive', () => {
  assert.equal(detectSourceLanguage('これは日本語です').language, 'ja');
  assert.equal(detectSourceLanguage('안녕하세요').language, 'ko');
  assert.equal(detectSourceLanguage('Привет, как дела?').language, 'ru');
  assert.equal(detectSourceLanguage('The quick brown fox jumps over the lazy dog and the cat').language, 'en');
  assert.equal(detectSourceLanguage('El hombre estaba en la casa con su perro y el sol').language, 'es');

  assert.deepEqual(detectSourceLanguage('这是中文。'), { language: null, confidence: AMBIGUOUS_SCRIPT_CONFIDENCE, reason: 'han-only-ambiguous' });
  assert.equal(detectSourceLanguage('Ausfahrt').language, null);
  assert.equal(detectSourceLanguage('!!!').reason, 'empty-or-non-text');
});
