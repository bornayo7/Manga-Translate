export type ExtensionSettings = {
  targetLanguage: string;
  sourceLanguage: string;
  translationProvider: string;
  backendUrl: string;
  googleCloudApiKey: string;
  customOcrUrl: string;
  customOcrApiKey: string;
  openaiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  customApiKey: string;
  customBaseUrl: string;
  customModelName: string;
  llmModel: string;
  enableReadAloud: boolean;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  elevenLabsOutputFormat: string;
  elevenLabsStability: number;
  elevenLabsSimilarityBoost: number;
  elevenLabsStyle: number;
  elevenLabsSpeed: number;
  minImageWidth: number;
  minImageHeight: number;
  showConfidenceBorders: boolean;
  autoTranslate: boolean;
  maxConcurrentImages: number;
  ocrEngine: string;
  fontOverride: string;
  overlayFontFamily: string;
  overlayMinFontSize: number;
  overlayTextAlign: string;
  darkMode: boolean;
  contextSharingEnabled: boolean;
  prefetchTranslations: boolean;
  translateOnClickOnly: boolean;
  overlayOpacity: number;
};

export type LocalOnlySettingKey =
  | 'backendUrl'
  | 'googleCloudApiKey'
  | 'customOcrUrl'
  | 'customOcrApiKey'
  | 'openaiApiKey'
  | 'claudeApiKey'
  | 'geminiApiKey'
  | 'customApiKey'
  | 'customBaseUrl'
  | 'customModelName'
  | 'elevenLabsApiKey';

export type SyncedPreferences = Omit<ExtensionSettings, LocalOnlySettingKey>;

export const PREFERENCE_SCHEMA_VERSION: 1;
export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings;
export const LOCAL_ONLY_SETTING_KEYS: readonly LocalOnlySettingKey[];
export const DEFAULT_SYNCED_PREFERENCES: Readonly<SyncedPreferences>;

export function mergeWithDefaults(
  partial?: Partial<ExtensionSettings>
): ExtensionSettings;

export function splitSettingsForSync(
  settings?: Partial<ExtensionSettings>
): {
  synced: SyncedPreferences;
  localOnly: Pick<ExtensionSettings, LocalOnlySettingKey>;
};

export function pickSyncedPreferences(
  settings?: Partial<ExtensionSettings>
): SyncedPreferences;
