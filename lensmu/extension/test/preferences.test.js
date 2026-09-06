import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXTENSION_SETTINGS,
  LOCAL_ONLY_SETTING_KEYS,
  SETTING_KEYS,
  SENSITIVE_SETTING_KEYS,
  mergeWithDefaults,
  pickSyncedPreferences,
  splitSettingsForSync,
  toContentScriptSettings
} from '../shared/preferences.js';

test('mergeWithDefaults fills missing values and drops unknown keys', () => {
  const merged = mergeWithDefaults({ targetLanguage: 'fr', surpriseToken: 'secret' });

  assert.equal(merged.targetLanguage, 'fr');
  assert.equal(merged.ocrEngine, DEFAULT_EXTENSION_SETTINGS.ocrEngine);
  assert.deepEqual(Object.keys(merged), [...SETTING_KEYS]);
  assert.equal('surpriseToken' in merged, false);
});

test('mergeWithDefaults coerces stored values to the type of their default', () => {
  const merged = mergeWithDefaults({
    minImageWidth: '250',
    minImageHeight: '',
    maxConcurrentImages: null,
    overlayOpacity: 'not a number',
    elevenLabsSpeed: NaN,
    autoTranslate: 'false',
    darkMode: 1,
    prefetchTranslations: 'yes',
    targetLanguage: 42,
    backendUrl: null,
    llmModel: ['gpt-4o-mini']
  });

  assert.equal(merged.minImageWidth, 250);
  assert.equal(merged.minImageHeight, DEFAULT_EXTENSION_SETTINGS.minImageHeight);
  assert.equal(merged.maxConcurrentImages, DEFAULT_EXTENSION_SETTINGS.maxConcurrentImages);
  assert.equal(merged.overlayOpacity, DEFAULT_EXTENSION_SETTINGS.overlayOpacity);
  assert.equal(merged.elevenLabsSpeed, DEFAULT_EXTENSION_SETTINGS.elevenLabsSpeed);
  assert.equal(merged.autoTranslate, false);
  assert.equal(merged.darkMode, true);
  assert.equal(merged.prefetchTranslations, DEFAULT_EXTENSION_SETTINGS.prefetchTranslations);
  assert.equal(merged.targetLanguage, '42');
  assert.equal(merged.backendUrl, DEFAULT_EXTENSION_SETTINGS.backendUrl);
  assert.equal(merged.llmModel, DEFAULT_EXTENSION_SETTINGS.llmModel);
});

test('content-script settings never contain credential values', () => {
  const input = Object.fromEntries(
    SENSITIVE_SETTING_KEYS.map((key) => [key, `private-${key}`])
  );
  const safeSettings = toContentScriptSettings(input);

  for (const key of SENSITIVE_SETTING_KEYS) {
    assert.equal(key in safeSettings, false);
    assert.equal(safeSettings.configuredCredentials[key], true);
  }
  assert.equal(safeSettings.translationProvider, DEFAULT_EXTENSION_SETTINGS.translationProvider);
});

test('public-provider fallback is disabled by default', () => {
  assert.equal(DEFAULT_EXTENSION_SETTINGS.allowThirdPartyFallback, false);
});

test('splitSettingsForSync keeps every local-only value out of synced data', () => {
  const input = Object.fromEntries(
    LOCAL_ONLY_SETTING_KEYS.map((key) => [key, `private-${key}`])
  );
  const { synced, localOnly } = splitSettingsForSync(input);

  for (const key of LOCAL_ONLY_SETTING_KEYS) {
    assert.equal(key in synced, false);
    assert.equal(localOnly[key], `private-${key}`);
  }
});

test('pickSyncedPreferences is a strict allowlist', () => {
  const synced = pickSyncedPreferences({
    targetLanguage: 'de',
    authToken: 'must-not-sync',
    openaiApiKey: 'must-not-sync'
  });

  assert.equal(synced.targetLanguage, 'de');
  assert.equal('authToken' in synced, false);
  assert.equal('openaiApiKey' in synced, false);
});
