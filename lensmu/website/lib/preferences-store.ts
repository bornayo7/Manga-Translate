import "server-only";

import { ManagementClient } from "auth0";

import { PREFERENCE_SCHEMA_VERSION } from "../../extension/shared/preferences.js";
import { getAuth0Domain } from "./auth0";
import {
  getDefaultSyncedPreferences,
  syncedPreferencesSchema,
  type SyncedPreferences,
} from "./preferences-schema";

const USER_METADATA_KEY = "vt_preferences";
const EMPTY_UPDATED_AT = new Date(0).toISOString();

type StoredPreferenceEnvelope = {
  schemaVersion: number;
  updatedAt: string;
  preferences: SyncedPreferences;
};

type PreferenceStoreResult = {
  hasStoredPreferences: boolean;
  envelope: StoredPreferenceEnvelope;
};

let managementClient: ManagementClient | null = null;

function getManagementClient() {
  if (managementClient) {
    return managementClient;
  }

  const domain = getAuth0Domain();
  const clientId =
    process.env.AUTH0_MANAGEMENT_CLIENT_ID || process.env.AUTH0_CLIENT_ID || "";
  const clientSecret =
    process.env.AUTH0_MANAGEMENT_CLIENT_SECRET || process.env.AUTH0_CLIENT_SECRET || "";

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "Missing Auth0 Management API credentials. Set AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET on the website server."
    );
  }

  managementClient = new ManagementClient({
    domain,
    clientId,
    clientSecret,
  });

  return managementClient;
}

function buildEmptyEnvelope(): StoredPreferenceEnvelope {
  return {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    updatedAt: EMPTY_UPDATED_AT,
    preferences: getDefaultSyncedPreferences(),
  };
}

function normalizeStoredEnvelope(input: unknown): PreferenceStoreResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      hasStoredPreferences: false,
      envelope: buildEmptyEnvelope(),
    };
  }

  const rawEnvelope = input as {
    schemaVersion?: number;
    updatedAt?: string;
    preferences?: unknown;
  };
  const parsedPreferences = syncedPreferencesSchema.safeParse(rawEnvelope.preferences);

  if (!parsedPreferences.success) {
    return {
      hasStoredPreferences: false,
      envelope: buildEmptyEnvelope(),
    };
  }

  const schemaVersion =
    Number.isInteger(rawEnvelope.schemaVersion) && rawEnvelope.schemaVersion
      ? rawEnvelope.schemaVersion
      : PREFERENCE_SCHEMA_VERSION;

  return {
    hasStoredPreferences: true,
    envelope: {
      schemaVersion,
      updatedAt:
        typeof rawEnvelope.updatedAt === "string" && rawEnvelope.updatedAt.trim()
          ? rawEnvelope.updatedAt
          : EMPTY_UPDATED_AT,
      preferences: parsedPreferences.data,
    },
  };
}

export async function getUserPreferenceEnvelope(
  userId: string
): Promise<PreferenceStoreResult> {
  const client = getManagementClient();
  const response = await client.users.get({ id: userId });
  const rawUserMetadata =
    response.data.user_metadata &&
    typeof response.data.user_metadata === "object" &&
    !Array.isArray(response.data.user_metadata)
      ? response.data.user_metadata
      : {};

  return normalizeStoredEnvelope(
    rawUserMetadata[USER_METADATA_KEY as keyof typeof rawUserMetadata]
  );
}

export async function saveUserPreferenceEnvelope(
  userId: string,
  preferences: SyncedPreferences
): Promise<StoredPreferenceEnvelope> {
  const client = getManagementClient();
  const envelope: StoredPreferenceEnvelope = {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    preferences,
  };

  await client.users.update(
    { id: userId },
    {
      user_metadata: {
        [USER_METADATA_KEY]: envelope,
      },
    }
  );

  return envelope;
}
