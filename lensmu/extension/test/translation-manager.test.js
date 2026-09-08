import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldTranslateTextBlock, translateTexts } from '../translate/translate-manager.js';
import { resolveProviderModel } from '../shared/llm-models.js';
import { chatCompletion, installFetchMock } from './helpers/fetch-mock.js';

test('short Latin text is translated when auto source differs from target', () => {
  const decision = shouldTranslateTextBlock('Hello', 'es', 'auto');

  assert.equal(decision.translate, true);
  assert.equal(decision.reason, 'needs-translation');
});

test('punctuation-only OCR is skipped', () => {
  const decision = shouldTranslateTextBlock('?!...', 'es', 'auto');

  assert.equal(decision.translate, false);
  assert.equal(decision.reason, 'empty-or-non-text');
});

test('an explicit source matching the target is skipped', () => {
  const decision = shouldTranslateTextBlock('Bonjour', 'fr', 'fr');

  assert.equal(decision.translate, false);
  assert.equal(decision.reason, 'source-matches-target-language');
});

test('explicit Chinese → Japanese reaches the provider despite the shared Han script', () => {
  const decision = shouldTranslateTextBlock('这是中文。', 'ja', 'zh');

  assert.equal(decision.translate, true);
  assert.equal(decision.reason, 'source-language-differs-from-target');
});

test('explicit kanji-heavy Japanese → Chinese reaches the provider', () => {
  const decision = shouldTranslateTextBlock('東京駅前商店街', 'zh', 'ja');

  assert.equal(decision.translate, true);
  assert.equal(decision.reason, 'source-language-differs-from-target');
});

test('with auto source, kana establishes Japanese and Han-only text stays ambiguous', () => {
  assert.equal(shouldTranslateTextBlock('これは日本語の文章です', 'ja', 'auto').translate, false);
  assert.equal(shouldTranslateTextBlock('これは日本語の文章です', 'ja', 'auto').reason, 'already-target-language');

  const kanjiOnly = shouldTranslateTextBlock('東京', 'ja', 'auto');
  assert.equal(kanjiOnly.translate, true);
  assert.equal(kanjiOnly.reason, 'ambiguous-script');

  const chinese = shouldTranslateTextBlock('这是中文。', 'zh', 'auto');
  assert.equal(chinese.translate, true, 'Han alone must not establish Chinese either');
  assert.equal(chinese.reason, 'ambiguous-script');
});

test('kana rules Chinese out even when kanji dominate', () => {
  const decision = shouldTranslateTextBlock('漢字が多い日本語', 'zh', 'auto');

  assert.equal(decision.translate, true);
  assert.equal(decision.reason, 'needs-translation');
  assert.equal(decision.targetConfidence, 0);
});

test('mixed-script and exclusive-script blocks behave conservatively', () => {
  assert.equal(shouldTranslateTextBlock('안녕하세요 Hello', 'ko', 'auto').translate, false);
  assert.equal(shouldTranslateTextBlock('Привет 東京', 'ru', 'auto').translate, false);
  assert.equal(shouldTranslateTextBlock('Wow!!', 'ja', 'auto').translate, true);
  assert.equal(shouldTranslateTextBlock('12345', 'ja', 'auto').translate, false);
});

test('provider model resolution never sends a Gemini model to OpenAI or Claude', () => {
  assert.equal(resolveProviderModel('openai', 'gemini-2.5-flash'), 'gpt-4o-mini');
  assert.equal(resolveProviderModel('claude', 'gemini-2.5-flash'), 'claude-sonnet-5');
  assert.equal(resolveProviderModel('gemini', 'gemini-2.5-flash'), 'gemini-2.5-flash');
});

const CUSTOM_SETTINGS = {
  translationProvider: 'custom',
  customBaseUrl: 'http://localhost:11434/v1/',
  customModelName: 'llama3',
  customApiKey: ''
};

test('translateTexts reports all-skipped input as skipped outcomes, not as a failure', async () => {
  const mock = installFetchMock(() => {
    throw new Error('provider must not be called');
  });
  try {
    const result = await translateTexts(['これは日本語です', '?!', ''], 'auto', 'ja', CUSTOM_SETTINGS);
    assert.equal(result.provider, 'none');
    assert.deepEqual(result.translations, ['', '', '']);
    assert.deepEqual(
      result.outcomes.map((outcome) => outcome.status),
      ['skipped', 'skipped', 'skipped']
    );
    assert.equal(result.outcomes[0].reason, 'already-target-language');
    assert.equal(result.outcomes[1].reason, 'empty-or-non-text');
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('translateTexts keeps block correspondence for mixed translated and skipped blocks', async () => {
  const mock = installFetchMock(() => chatCompletion('[1] Hello\n[2] Goodbye'));
  try {
    const result = await translateTexts(
      ['こんにちは', 'This is the text that we have been looking for', 'さようなら', '...'],
      'auto',
      'en',
      CUSTOM_SETTINGS
    );
    assert.deepEqual(result.translations, ['Hello', '', 'Goodbye', '']);
    assert.deepEqual(
      result.outcomes.map((outcome) => outcome.status),
      ['translated', 'skipped', 'translated', 'skipped']
    );
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0].body.messages[1].content, /\[1\] こんにちは\n\[2\] さようなら/);
    assert.equal(result.diagnostics.modelMigration, null);
  } finally {
    mock.restore();
  }
});

test('translateTexts marks a present-but-empty provider entry as a failed block, and all-empty as an error', async () => {
  const mixed = installFetchMock(() => chatCompletion('[1] Hello\n[2] '));
  try {
    const result = await translateTexts(['こんにちは', 'さようなら'], 'ja', 'en', CUSTOM_SETTINGS);
    assert.deepEqual(result.translations, ['Hello', '']);
    assert.deepEqual(result.outcomes[1], { status: 'failed', reason: 'empty-provider-output' });
    assert.deepEqual(result.diagnostics.failedIndices, [1]);
  } finally {
    mixed.restore();
  }

  const allEmpty = installFetchMock(() => chatCompletion('[1] \n[2] '));
  try {
    await assert.rejects(
      () => translateTexts(['こんにちは', 'さようなら'], 'ja', 'en', CUSTOM_SETTINGS),
      /returned no translated text for any of the 2 requested blocks/
    );
  } finally {
    allEmpty.restore();
  }
});

test('translateTexts records a retired-model migration in the diagnostics', async () => {
  const mock = installFetchMock(() => chatCompletion('[1] Hi'));
  try {
    const result = await translateTexts(['こんにちは'], 'ja', 'en', {
      translationProvider: 'openai',
      openaiApiKey: 'sk-test',
      llmModel: 'gpt-3.5-turbo'
    });
    assert.deepEqual(result.diagnostics.modelMigration, { from: 'gpt-3.5-turbo', to: 'gpt-5.6-terra', reason: 'retired' });
    assert.equal(mock.calls[0].body.model, 'gpt-5.6-terra');
    assert.equal('temperature' in mock.calls[0].body, false, 'reasoning replacement gets no temperature');
    assert.equal(mock.calls[0].body.max_completion_tokens > 0, true);
  } finally {
    mock.restore();
  }
});

test('translateTexts never falls back to MyMemory unless the user opted in', async () => {
  const mock = installFetchMock(({ url }) => {
    if (url.includes('mymemory')) {
      throw new Error('MyMemory must not be contacted');
    }
    return new Response('{"error":{"message":"boom"}}', { status: 500, headers: { 'content-type': 'application/json' } });
  });
  try {
    await assert.rejects(
      () => translateTexts(['こんにちは'], 'ja', 'en', CUSTOM_SETTINGS),
      /Custom API error \(500\): boom/
    );
    assert.equal(mock.calls.every((call) => !call.url.includes('mymemory')), true);
  } finally {
    mock.restore();
  }
});
