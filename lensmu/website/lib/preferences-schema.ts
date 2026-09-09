import { z } from "zod";

import {
  DEFAULT_SYNCED_PREFERENCES,
  LOCAL_ONLY_SETTING_KEYS,
  PREFERENCE_SCHEMA_VERSION,
  validateSyncedPreferences,
  type SyncedPreferences as CanonicalSyncedPreferences,
} from "../../extension/shared/preferences.js";

// Validation is owned by the same pure contract as extension storage. Zod
// adapts its issues to the HTTP route; it does not restate the preference keys.
export const syncedPreferencesSchema = z.unknown().transform((value, context): CanonicalSyncedPreferences => {
  const result = validateSyncedPreferences(value);
  if (!result.success) {
    for (const issue of result.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  return result.data as CanonicalSyncedPreferences;
});

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
