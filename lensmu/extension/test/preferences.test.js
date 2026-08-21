import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXTENSION_SETTINGS,
  LOCAL_ONLY_SETTING_KEYS,
  SETTING_KEYS,
  mergeWithDefaults,
  pickSyncedPreferences,
  splitSettingsForSync
} from '../shared/preferences.js';

test('mergeWithDefaults fills missing values and drops unknown keys', () => {
  const merged = mergeWithDefaults({ targetLanguage: 'fr', surpriseToken: 'secret' });

  assert.equal(merged.targetLanguage, 'fr');
  assert.equal(merged.ocrEngine, DEFAULT_EXTENSION_SETTINGS.ocrEngine);
  assert.deepEqual(Object.keys(merged), [...SETTING_KEYS]);
  assert.equal('surpriseToken' in merged, false);
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
