import { z } from "zod";

import {
  DEFAULT_SYNCED_PREFERENCES,
  LOCAL_ONLY_SETTING_KEYS,
  PREFERENCE_SCHEMA_VERSION,
} from "../../extension/shared/preferences.js";

const boundedString = (max: number) => z.string().trim().max(max);

export const syncedPreferencesSchema = z
  .object({
    sourceLanguage: boundedString(32),
    targetLanguage: boundedString(32),
    translationProvider: boundedString(32),
    allowThirdPartyFallback: z.boolean(),
    llmModel: boundedString(128),
    minImageWidth: z.number().int().min(1).max(4096),
    minImageHeight: z.number().int().min(1).max(4096),
    showConfidenceBorders: z.boolean(),
    autoTranslate: z.boolean(),
    maxConcurrentImages: z.number().int().min(1).max(12),
    ocrEngine: boundedString(32),
    fontOverride: boundedString(120),
    overlayFontFamily: boundedString(32),
    overlayMinFontSize: z.number().int().min(6).max(72),
    overlayTextAlign: boundedString(32),
    darkMode: z.boolean(),
    prefetchTranslations: z.boolean(),
    overlayOpacity: z.number().min(0).max(1),
    enableReadAloud: z.boolean(),
    elevenLabsVoiceId: boundedString(128),
    elevenLabsModelId: boundedString(64),
    elevenLabsOutputFormat: boundedString(64),
    elevenLabsStability: z.number().min(0).max(1),
    elevenLabsSimilarityBoost: z.number().min(0).max(1),
    elevenLabsStyle: z.number().min(0).max(1),
    elevenLabsSpeed: z.number().min(0.7).max(1.2),
  })
  .strict();

export const preferenceEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(PREFERENCE_SCHEMA_VERSION),
    updatedAt: z.string().datetime().optional(),
    preferences: syncedPreferencesSchema,
  })
  .strict();

export type SyncedPreferences = z.infer<typeof syncedPreferencesSchema>;
export type PreferenceEnvelope = z.infer<typeof preferenceEnvelopeSchema>;

const sensitivePreferenceKeySet: ReadonlySet<string> = new Set(LOCAL_ONLY_SETTING_KEYS);

export function getDefaultSyncedPreferences(): SyncedPreferences {
  return syncedPreferencesSchema.parse(DEFAULT_SYNCED_PREFERENCES);
}

export function parsePreferenceEnvelope(input: unknown): PreferenceEnvelope {
  return preferenceEnvelopeSchema.parse(input);
}

export function findSensitiveKeys(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const rawPreferences =
    "preferences" in input &&
    input.preferences &&
    typeof input.preferences === "object" &&
    !Array.isArray(input.preferences)
      ? input.preferences
      : null;

  if (!rawPreferences) {
    return [];
  }

  return Object.keys(rawPreferences).filter((key) =>
    sensitivePreferenceKeySet.has(key)
  );
}

export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
}
