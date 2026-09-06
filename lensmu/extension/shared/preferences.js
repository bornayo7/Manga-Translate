// Canonical shared preference definitions used by both the extension and the website.
// Keep this file free of secrets and free of browser-only or server-only APIs.

import { DEFAULT_LLM_MODELS } from './llm-models.js';

export const PREFERENCE_SCHEMA_VERSION = 2;

// chrome.storage.local key holding the merged settings object.
export const SETTINGS_STORAGE_KEY = 'vt_settings';

export const DEFAULT_EXTENSION_SETTINGS = {
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  translationProvider: 'libre',
  allowThirdPartyFallback: false,
  backendUrl: 'http://localhost:8000',
  googleCloudApiKey: '',
  customOcrUrl: '',
  customOcrApiKey: '',
  openaiApiKey: '',
  claudeApiKey: '',
  geminiApiKey: '',
  customApiKey: '',
  customBaseUrl: '',
  customModelName: '',
  llmModel: DEFAULT_LLM_MODELS.gemini,
  enableReadAloud: false,
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  elevenLabsModelId: 'eleven_flash_v2_5',
  elevenLabsOutputFormat: 'mp3_44100_128',
  elevenLabsStability: 0.5,
  elevenLabsSimilarityBoost: 0.75,
  elevenLabsStyle: 0,
  elevenLabsSpeed: 1,
  minImageWidth: 100,
  minImageHeight: 50,
  showConfidenceBorders: true,
  autoTranslate: true,
  maxConcurrentImages: 5,
  ocrEngine: 'tesseract',
  fontOverride: '',
  overlayFontFamily: 'sans',
  overlayMinFontSize: 10,
  overlayTextAlign: 'auto',
  darkMode: false,
  prefetchTranslations: false,
  overlayOpacity: 1.0
};

export const LOCAL_ONLY_SETTING_KEYS = [
  'backendUrl',
  'googleCloudApiKey',
  'customOcrUrl',
  'customOcrApiKey',
  'openaiApiKey',
  'claudeApiKey',
  'geminiApiKey',
  'customApiKey',
  'customBaseUrl',
  'customModelName',
  'elevenLabsApiKey'
];

export const SENSITIVE_SETTING_KEYS = Object.freeze([
  'googleCloudApiKey',
  'customOcrApiKey',
  'openaiApiKey',
  'claudeApiKey',
  'geminiApiKey',
  'customApiKey',
  'elevenLabsApiKey'
]);

export const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_EXTENSION_SETTINGS));
export const SYNCED_PREFERENCE_KEYS = Object.freeze(
  SETTING_KEYS.filter((key) => !LOCAL_ONLY_SETTING_KEYS.includes(key))
);

export const DEFAULT_SYNCED_PREFERENCES = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_EXTENSION_SETTINGS).filter(([key]) => !LOCAL_ONLY_SETTING_KEYS.includes(key))
  )
);

// Coerces a stored value into a numeric range. Settings arrive from
// chrome.storage and from the sync API, so a key can hold a string, null, or
// nothing at all; callers want a usable number either way.
export function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

// Settings arrive from chrome.storage, from an older schema, or from a sync
// payload, so a numeric key can hold "5", "" or null and a boolean can hold
// "true". Coerce each value to the type of its default; anything unusable
// becomes the default instead of leaking a NaN or a truthy string into the
// pipeline, where every consumer would otherwise have to re-validate it.
export function coerceSettingValue(key, value) {
  const fallback = DEFAULT_EXTENSION_SETTINGS[key];

  switch (typeof fallback) {
    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : fallback;
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
      }
      return fallback;
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value;
      }
      if (value === 'true' || value === 1 || value === '1') {
        return true;
      }
      if (value === 'false' || value === 0 || value === '0') {
        return false;
      }
      return fallback;
    }
    case 'string': {
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return fallback;
    }
    default:
      return value;
  }
}

export function mergeWithDefaults(partial = {}) {
  const source = partial && typeof partial === 'object' && !Array.isArray(partial)
    ? partial
    : {};

  return Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(source, key)
        ? coerceSettingValue(key, source[key])
        : DEFAULT_EXTENSION_SETTINGS[key]
    ])
  );
}

export function splitSettingsForSync(settings = {}) {
  const merged = mergeWithDefaults(settings);
  const synced = {};
  const localOnly = {};

  for (const key of SETTING_KEYS) {
    const value = merged[key];
    if (LOCAL_ONLY_SETTING_KEYS.includes(key)) {
      localOnly[key] = value;
    } else {
      synced[key] = value;
    }
  }

  return { synced, localOnly };
}

export function pickSyncedPreferences(settings = {}) {
  return splitSettingsForSync(settings).synced;
}

export function toContentScriptSettings(settings = {}) {
  const merged = mergeWithDefaults(settings);
  const safeSettings = Object.fromEntries(
    Object.entries(merged).filter(([key]) => !SENSITIVE_SETTING_KEYS.includes(key))
  );

  safeSettings.configuredCredentials = Object.freeze(
    Object.fromEntries(
      SENSITIVE_SETTING_KEYS.map((key) => [key, Boolean(merged[key])])
    )
  );

  return safeSettings;
}
