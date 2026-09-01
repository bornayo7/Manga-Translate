import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProviderModel,
  shouldTranslateTextBlock
} from '../translate/translate-manager.js';

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

test('provider model resolution never sends a Gemini model to OpenAI or Claude', () => {
  assert.equal(resolveProviderModel('openai', 'gemini-2.0-flash'), 'gpt-4o-mini');
  assert.equal(
    resolveProviderModel('claude', 'gemini-2.0-flash'),
    'claude-sonnet-4-20250514'
  );
  assert.equal(resolveProviderModel('gemini', 'gemini-2.5-flash'), 'gemini-2.5-flash');
});
