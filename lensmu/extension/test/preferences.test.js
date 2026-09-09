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

test('mergeWithDefaults clamps numeric settings and normalises base URLs from any writer', () => {
  const merged = mergeWithDefaults({
    minImageWidth: 0,
    minImageHeight: '1',
    maxConcurrentImages: 99,
    overlayOpacity: 5,
    elevenLabsSpeed: 0.1,
    overlayMinFontSize: 12,
    backendUrl: ' http://localhost:8000/ ',
    customBaseUrl: 'http://localhost:11434/v1//',
    customOcrUrl: 'http://localhost:3000/ocr/'
  });

  assert.equal(merged.minImageWidth, 32);
  assert.equal(merged.minImageHeight, 32);
  assert.equal(merged.maxConcurrentImages, 12);
  assert.equal(merged.overlayOpacity, 1);
  assert.equal(merged.elevenLabsSpeed, 0.7);
  assert.equal(merged.overlayMinFontSize, 12);
  assert.equal(merged.backendUrl, 'http://localhost:8000');
  assert.equal(merged.customBaseUrl, 'http://localhost:11434/v1');
  assert.equal(merged.customOcrUrl, 'http://localhost:3000/ocr/', 'a full endpoint URL is left alone');
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

test('strict synced validation uses canonical types, ranges and local-only policy', async () => {
  const { validateSyncedPreferences, DEFAULT_SYNCED_PREFERENCES } = await import('../shared/preferences.js');
  assert.equal(validateSyncedPreferences(DEFAULT_SYNCED_PREFERENCES).success, true);
  for (const patch of [{ openaiApiKey: 'dummy' }, { maxConcurrentImages: 1.5 }, { overlayOpacity: 2 }, { darkMode: 'true' }, { overlayFontFamily: 'unknown' }]) {
    assert.equal(validateSyncedPreferences({ ...DEFAULT_SYNCED_PREFERENCES, ...patch }).success, false);
  }
  assert.deepEqual(validateSyncedPreferences({ darkMode: true }, { partial: true }), { success: true, data: { darkMode: true } });
  assert.equal(validateSyncedPreferences({}).success, false);
});

test('opaque preparation revision survives credential stripping without secret values', () => {
  const result = toContentScriptSettings({ openaiApiKey: 'dummy', settingsRevision: 'r2', preparationRevision: 'p1' });
  assert.equal(result.openaiApiKey, undefined);
  assert.equal(result.settingsRevision, 'r2');
  assert.equal(result.preparationRevision, 'p1');
});
