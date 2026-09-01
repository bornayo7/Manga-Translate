// Canonical shared preference definitions used by both the extension and the website.
// Keep this file free of secrets and free of browser-only or server-only APIs.

export const PREFERENCE_SCHEMA_VERSION = 2;

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
  llmModel: 'gemini-2.0-flash',
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

export function mergeWithDefaults(partial = {}) {
  const source = partial && typeof partial === 'object' && !Array.isArray(partial)
    ? partial
    : {};

  return Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(source, key)
        ? source[key]
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
