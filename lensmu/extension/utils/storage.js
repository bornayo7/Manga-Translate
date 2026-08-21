// Chrome storage helpers for extension settings and API keys.

import { DEFAULT_EXTENSION_SETTINGS, mergeWithDefaults } from '../shared/preferences.js';

const SETTINGS_KEY = 'vt_settings';
const API_KEYS_KEY = 'vt_api_keys';
const LEGACY_SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_EXTENSION_SETTINGS));

function getLegacySettings(storageSnapshot = {}) {
  return Object.fromEntries(
    LEGACY_SETTING_KEYS.filter((key) => key in storageSnapshot).map((key) => [key, storageSnapshot[key]])
  );
}

async function migrateLegacySettings(storageSnapshot = {}) {
  const legacySettings = getLegacySettings(storageSnapshot);

  if (Object.keys(legacySettings).length === 0) {
    return null;
  }

  const migratedSettings = mergeWithDefaults(legacySettings);

  await chrome.storage.local.set({ [SETTINGS_KEY]: migratedSettings });
  await chrome.storage.local.remove(LEGACY_SETTING_KEYS);

  console.log(
    '[VisionTranslate] Migrated legacy settings into vt_settings:',
    redactSecretsForLog(migratedSettings)
  );

  return migratedSettings;
}

function redactSecretsForLog(settings = {}) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      if (/api.?key|token|secret/i.test(key)) {
        return [key, value ? '[redacted]' : ''];
      }

      return [key, value];
    })
  );
}

// Reads settings, merging stored values over defaults.
export async function getSettings() {
  try {
    const result = await chrome.storage.local.get([SETTINGS_KEY, ...LEGACY_SETTING_KEYS]);

    if (result[SETTINGS_KEY] && typeof result[SETTINGS_KEY] === 'object' && !Array.isArray(result[SETTINGS_KEY])) {
      return mergeWithDefaults(result[SETTINGS_KEY]);
    }

    const migratedSettings = await migrateLegacySettings(result);

    if (migratedSettings) {
      return migratedSettings;
    }

    return mergeWithDefaults();
  } catch (error) {
    console.error('[VisionTranslate] Error reading settings:', error);
    return mergeWithDefaults();
  }
}

// Merges partial settings update into stored settings.
export async function saveSettings(settings) {
  try {
    const current = await getSettings();
    const merged = mergeWithDefaults({ ...current, ...(settings || {}) });
    await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    await chrome.storage.local.remove(LEGACY_SETTING_KEYS);
    console.log('[VisionTranslate] Settings saved:', redactSecretsForLog(merged));
    return merged;
  } catch (error) {
    console.error('[VisionTranslate] Error saving settings:', error);
    throw error;
  }
}

export async function getApiKeys() {
  try {
    const result = await chrome.storage.local.get(API_KEYS_KEY);
    return result[API_KEYS_KEY] || { google: '', deepl: '', azure: '' };
  } catch (error) {
    console.error('[VisionTranslate] Error reading API keys:', error);
    return { google: '', deepl: '', azure: '' };
  }
}

export async function saveApiKey(provider, key) {
  try {
    const current = await getApiKeys();
    current[provider] = key;
    await chrome.storage.local.set({ [API_KEYS_KEY]: current });
    console.log(`[VisionTranslate] API key saved for provider: ${provider}`);
  } catch (error) {
    console.error('[VisionTranslate] Error saving API key:', error);
    throw error;
  }
}

export async function removeApiKey(provider) {
  await saveApiKey(provider, '');
}

// Per-domain disable list. Extension is ON by default; disabling a site adds it here.
const DISABLED_DOMAINS_KEY = 'vt_disabled_domains';

export async function getDisabledDomains() {
  try {
    const result = await chrome.storage.local.get(DISABLED_DOMAINS_KEY);
    return result[DISABLED_DOMAINS_KEY] || [];
  } catch (error) {
    console.error('[VisionTranslate] Error reading disabled domains:', error);
    return [];
  }
}

export async function addDisabledDomain(hostname) {
  const domains = await getDisabledDomains();
  if (!domains.includes(hostname)) {
    domains.push(hostname);
    await chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: domains });
  }
}

export async function removeDisabledDomain(hostname) {
  const domains = await getDisabledDomains();
  const filtered = domains.filter(d => d !== hostname);
  await chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: filtered });
}

export async function clearAllData() {
  try {
    await chrome.storage.local.clear();
    console.log('[VisionTranslate] All storage data cleared');
  } catch (error) {
    console.error('[VisionTranslate] Error clearing storage:', error);
    throw error;
  }
}

// Subscribe to settings changes across all extension contexts. Returns unsubscribe fn.
export function onSettingsChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes[SETTINGS_KEY]) return;

    const { oldValue, newValue } = changes[SETTINGS_KEY];
    const oldSettings = mergeWithDefaults(oldValue || {});
    const newSettings = mergeWithDefaults(newValue || {});

    callback(newSettings, oldSettings);
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
