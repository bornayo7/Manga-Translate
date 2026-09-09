import { fetchWithTimeout } from "../shared/fetch-with-timeout.js";
import { DEFAULT_EXTENSION_SETTINGS, clampNumber } from "../shared/preferences.js";

/*
 * Persistent audio cache in chrome.storage.local.
 *
 *   vt_elevenlabs_audio_cache  { [cacheKey]: { audioDataUrl, contentType, byteLength, createdAt, lastAccessedAt } }
 *   vt_elevenlabs_audio_index  { [imageFingerprint]: { translationHash, cacheKeys } }
 *
 * The index ties cached clips to the image and translation they voice so a
 * re-translated image drops its stale audio. It only ever holds
 * fingerprints that actually have cached clips: syncReadAloudTranslation()
 * never creates a record, and pruning removes records left without keys,
 * so the index is bounded by the audio entry limit rather than by the
 * number of images ever translated.
 *
 * Concurrency: every read-modify-write of the two keys goes through
 * mutateCacheState(), one serialised chain that reads fresh storage, applies
 * a synchronous change, prunes and writes. No network request ever runs
 * inside it, so a slow provider cannot block invalidation, and a
 * generation that finishes after its translation was replaced is
 * discarded instead of resurrecting the old clip.
 */
const AUDIO_CACHE_STORAGE_KEY = "vt_elevenlabs_audio_cache";
const AUDIO_INDEX_STORAGE_KEY = "vt_elevenlabs_audio_index";
const MAX_CACHE_ENTRIES = 12;
const MAX_CACHE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TRACKED_TRANSLATIONS = 500;

const DEFAULT_ELEVENLABS_SETTINGS = {
  elevenLabsApiKey: DEFAULT_EXTENSION_SETTINGS.elevenLabsApiKey,
  elevenLabsVoiceId: DEFAULT_EXTENSION_SETTINGS.elevenLabsVoiceId,
  elevenLabsModelId: DEFAULT_EXTENSION_SETTINGS.elevenLabsModelId,
  elevenLabsOutputFormat: DEFAULT_EXTENSION_SETTINGS.elevenLabsOutputFormat,
  elevenLabsStability: DEFAULT_EXTENSION_SETTINGS.elevenLabsStability,
  elevenLabsSimilarityBoost: DEFAULT_EXTENSION_SETTINGS.elevenLabsSimilarityBoost,
  elevenLabsStyle: DEFAULT_EXTENSION_SETTINGS.elevenLabsStyle,
  elevenLabsSpeed: DEFAULT_EXTENSION_SETTINGS.elevenLabsSpeed,
};

function normalizeElevenLabsSettings(settings = {}) {
  const merged = {
    ...DEFAULT_ELEVENLABS_SETTINGS,
    ...(settings && typeof settings === "object" ? settings : {}),
  };

  return {
    apiKey: String(merged.elevenLabsApiKey || "").trim(),
    voiceId: String(merged.elevenLabsVoiceId || "").trim(),
    modelId: String(merged.elevenLabsModelId || "").trim() || DEFAULT_ELEVENLABS_SETTINGS.elevenLabsModelId,
    outputFormat:
      String(merged.elevenLabsOutputFormat || "").trim() ||
      DEFAULT_ELEVENLABS_SETTINGS.elevenLabsOutputFormat,
    stability: clampNumber(
      merged.elevenLabsStability,
      0,
      1,
      DEFAULT_ELEVENLABS_SETTINGS.elevenLabsStability
    ),
    similarityBoost: clampNumber(
      merged.elevenLabsSimilarityBoost,
      0,
      1,
      DEFAULT_ELEVENLABS_SETTINGS.elevenLabsSimilarityBoost
    ),
    style: clampNumber(
      merged.elevenLabsStyle,
      0,
      1,
      DEFAULT_ELEVENLABS_SETTINGS.elevenLabsStyle
    ),
    speed: clampNumber(
      merged.elevenLabsSpeed,
      0.7,
      1.2,
      DEFAULT_ELEVENLABS_SETTINGS.elevenLabsSpeed
    ),
  };
}

function ensureConfigured(settings, { requireVoiceId = true } = {}) {
  if (!settings.apiKey) {
    throw new Error("ElevenLabs API key is required.");
  }

  if (requireVoiceId && !settings.voiceId) {
    throw new Error("ElevenLabs voice ID is required.");
  }
}

function normalizeLanguageCode(language) {
  return String(language || "auto").trim().toLowerCase();
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function estimateByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 8192;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function inferContentType(contentTypeHeader, outputFormat) {
  if (contentTypeHeader) {
    return contentTypeHeader.split(";")[0].trim();
  }

  if (String(outputFormat).startsWith("wav")) {
    return "audio/wav";
  }

  if (String(outputFormat).startsWith("pcm")) {
    return "audio/L16";
  }

  return "audio/mpeg";
}

/* ---- Cache state: one serialised read-modify-write chain ---------------- */

let cacheMutationChain = Promise.resolve();

// Latest translation hash the content script reported per image
// fingerprint, kept in memory for the lifetime of this worker. A generation
// that started before the hash changed must not store its clip. Bounded so
// a long session cannot grow it without limit.
const latestTranslationHashes = new Map();

function rememberLatestTranslation(imageFingerprint, translationHash) {
  if (!imageFingerprint || !translationHash) {
    return;
  }
  latestTranslationHashes.delete(imageFingerprint);
  latestTranslationHashes.set(imageFingerprint, translationHash);
  while (latestTranslationHashes.size > MAX_TRACKED_TRANSLATIONS) {
    latestTranslationHashes.delete(latestTranslationHashes.keys().next().value);
  }
}

function isTranslationSuperseded(imageFingerprint, translationHash) {
  if (!imageFingerprint || !translationHash) {
    return false;
  }
  const latest = latestTranslationHashes.get(imageFingerprint);
  return Boolean(latest) && latest !== translationHash;
}

async function readCacheState() {
  const result = await chrome.storage.local.get([
    AUDIO_CACHE_STORAGE_KEY,
    AUDIO_INDEX_STORAGE_KEY,
  ]);

  return {
    cache: result[AUDIO_CACHE_STORAGE_KEY] || {},
    index: result[AUDIO_INDEX_STORAGE_KEY] || {},
  };
}

async function writeCacheState(cache, index) {
  await chrome.storage.local.set({
    [AUDIO_CACHE_STORAGE_KEY]: cache,
    [AUDIO_INDEX_STORAGE_KEY]: index,
  });
}

/*
 * Applies `mutate(cache, index)` to a fresh read of storage, then prunes
 * and writes, serialised with every other mutation. `mutate` must be
 * synchronous and network-free; it may return { skipWrite: true, ... } to
 * leave storage untouched. Resolves to whatever `mutate` returned.
 */
function mutateCacheState(mutate) {
  const run = cacheMutationChain.then(async () => {
    const { cache, index } = await readCacheState();
    const outcome = mutate(cache, index) || {};
    if (outcome.skipWrite) {
      return outcome;
    }
    pruneCache(cache, index);
    pruneIndex(cache, index);
    await writeCacheState(cache, index);
    return outcome;
  });
  cacheMutationChain = run.catch(() => undefined);
  return run;
}

function removeCacheKeys(cache, cacheKeys = []) {
  let invalidatedCount = 0;

  for (const cacheKey of cacheKeys) {
    if (cache[cacheKey]) {
      delete cache[cacheKey];
      invalidatedCount += 1;
    }
  }

  return invalidatedCount;
}

function pruneCache(cache, index) {
  const sortedEntries = Object.entries(cache).sort(([, leftEntry], [, rightEntry]) => {
    const leftTime = leftEntry.lastAccessedAt || leftEntry.createdAt || 0;
    const rightTime = rightEntry.lastAccessedAt || rightEntry.createdAt || 0;
    return leftTime - rightTime;
  });

  let totalBytes = sortedEntries.reduce(
    (sum, [, entry]) => sum + Number(entry.byteLength || 0),
    0
  );

  while (
    sortedEntries.length > MAX_CACHE_ENTRIES ||
    totalBytes > MAX_CACHE_BYTES
  ) {
    const [cacheKey, entry] = sortedEntries.shift();
    totalBytes -= Number(entry.byteLength || 0);
    delete cache[cacheKey];
  }

  void index;
}

// Drops index references to clips that no longer exist and records that
// reference nothing, so the index never outgrows the audio it describes.
function pruneIndex(cache, index) {
  for (const imageFingerprint of Object.keys(index)) {
    const indexEntry = index[imageFingerprint];
    const liveKeys = (indexEntry?.cacheKeys || []).filter((cacheKey) => Boolean(cache[cacheKey]));

    if (!liveKeys.length) {
      delete index[imageFingerprint];
      continue;
    }

    index[imageFingerprint] = {
      translationHash: indexEntry?.translationHash || "",
      cacheKeys: liveKeys,
    };
  }
}

// Invalidates clips recorded for an image whose translation changed. Never
// creates a record for an image that has no clips.
function invalidateStaleAudio(cache, index, imageFingerprint, translationHash) {
  const existingEntry = index[imageFingerprint];
  if (!existingEntry || existingEntry.translationHash === translationHash) {
    return 0;
  }

  const invalidatedCount = removeCacheKeys(cache, existingEntry.cacheKeys);
  delete index[imageFingerprint];
  return invalidatedCount;
}

function registerCacheKey(index, imageFingerprint, translationHash, cacheKey) {
  if (!imageFingerprint || !translationHash || !cacheKey) {
    return;
  }

  const existingEntry =
    index[imageFingerprint] && index[imageFingerprint].translationHash === translationHash
      ? index[imageFingerprint]
      : { translationHash, cacheKeys: [] };

  const nextCacheKeys = new Set(existingEntry.cacheKeys || []);
  nextCacheKeys.add(cacheKey);

  index[imageFingerprint] = {
    translationHash,
    cacheKeys: [...nextCacheKeys],
  };
}

function parseErrorResponse(response) {
  const jsonBody = response.json;
  return (
    jsonBody?.detail?.message ||
    jsonBody?.detail ||
    jsonBody?.message ||
    response.text ||
    `HTTP ${response.status}`
  );
}

function buildCacheDescriptor({
  text,
  language,
  imageFingerprint,
  translationHash,
  settings,
}) {
  return {
    version: 1,
    text,
    language: normalizeLanguageCode(language),
    imageFingerprint: String(imageFingerprint || "").trim(),
    translationHash: String(translationHash || "").trim(),
    voiceId: settings.voiceId,
    modelId: settings.modelId,
    outputFormat: settings.outputFormat,
    stability: settings.stability,
    similarityBoost: settings.similarityBoost,
    style: settings.style,
    speed: settings.speed,
  };
}

export async function loadElevenLabsVoices(rawSettings = {}, { signal } = {}) {
  const settings = normalizeElevenLabsSettings(rawSettings);
  ensureConfigured(settings, { requireVoiceId: false });

  const response = await fetchWithTimeout("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    signal,
    headers: {
      "xi-api-key": settings.apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(parseErrorResponse(response));
  }

  const responseBody = response.json;

  return (responseBody?.voices || [])
    .map((voice) => ({
      voiceId: voice?.voice_id || voice?.voiceId || "",
      name: voice?.name || "Unnamed voice",
      category: voice?.category || "",
    }))
    .filter((voice) => voice.voiceId)
    .sort((leftVoice, rightVoice) => leftVoice.name.localeCompare(rightVoice.name));
}

/*
 * Called by the content script after every translation. Records the
 * current translation for the image (in memory) and drops any cached clip
 * that voiced an older translation. Writes nothing when the image has no
 * clips, so translating hundreds of images leaves the index untouched.
 */
export async function syncReadAloudTranslation({
  imageFingerprint,
  translationHash,
}) {
  if (!imageFingerprint || !translationHash) {
    return { invalidatedCount: 0 };
  }

  rememberLatestTranslation(imageFingerprint, translationHash);

  return mutateCacheState((cache, index) => {
    if (!index[imageFingerprint]) {
      return { invalidatedCount: 0, skipWrite: true };
    }
    const invalidatedCount = invalidateStaleAudio(cache, index, imageFingerprint, translationHash);
    return { invalidatedCount, skipWrite: invalidatedCount === 0 };
  });
}

export async function generateReadAloudAudio({
  text,
  language,
  imageFingerprint,
  translationHash,
  settings: rawSettings = {},
  cacheAudio = true,
  signal,
}) {
  signal?.throwIfAborted();
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw new Error("No translated text was available for read aloud.");
  }

  const settings = normalizeElevenLabsSettings(rawSettings);
  ensureConfigured(settings);

  const normalizedFingerprint = String(imageFingerprint || "").trim();
  const normalizedTranslationHash =
    String(translationHash || "").trim() || (await sha256Hex(normalizedText));

  const descriptor = buildCacheDescriptor({
    text: normalizedText,
    language,
    imageFingerprint: normalizedFingerprint,
    translationHash: normalizedTranslationHash,
    settings,
  });
  const cacheKey = await sha256Hex(JSON.stringify(descriptor));

  if (cacheAudio) {
    const hit = await mutateCacheState((cache, index) => {
      signal?.throwIfAborted();
      invalidateStaleAudio(cache, index, normalizedFingerprint, normalizedTranslationHash);
      const cachedEntry = cache[cacheKey];
      if (!cachedEntry?.audioDataUrl) {
        return { skipWrite: true, entry: null };
      }
      cachedEntry.lastAccessedAt = Date.now();
      registerCacheKey(index, normalizedFingerprint, normalizedTranslationHash, cacheKey);
      return { entry: cachedEntry };
    });

    if (hit.entry) {
      signal?.throwIfAborted();
      return {
        audioDataUrl: hit.entry.audioDataUrl,
        cacheKey,
        fromCache: true,
        contentType: hit.entry.contentType,
      };
    }
  }

  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      settings.voiceId
    )}?output_format=${encodeURIComponent(settings.outputFormat)}`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": settings.apiKey,
        Accept: "*/*",
      },
      body: JSON.stringify({
        text: normalizedText,
        model_id: settings.modelId,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
          style: settings.style,
          speed: settings.speed,
        },
      }),
    },
    { maxResponseBytes: MAX_AUDIO_RESPONSE_BYTES, as: 'bytes' }
  );

  if (!response.ok) {
    throw new Error(parseErrorResponse(response));
  }

  const audioBytes = response.bytes;
  const contentType = inferContentType(
    response.headers.get("content-type"),
    settings.outputFormat
  );
  const audioDataUrl = `data:${contentType};base64,${base64FromBytes(audioBytes)}`;

  if (cacheAudio) {
    const stored = await mutateCacheState((cache, index) => {
      signal?.throwIfAborted();
      /*
       * While the provider was working the content script may have synced
       * a newer translation for this image. Storing this clip would
       * resurrect audio for text that is no longer on the page.
       */
      if (isTranslationSuperseded(normalizedFingerprint, normalizedTranslationHash)) {
        return { skipWrite: true, stale: true };
      }

      cache[cacheKey] = {
        audioDataUrl,
        contentType,
        byteLength: estimateByteLength(audioDataUrl),
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      registerCacheKey(index, normalizedFingerprint, normalizedTranslationHash, cacheKey);
      return { stale: false };
    });

    if (stored.stale) {
      console.warn("[VisionTranslate] Discarded read-aloud audio generated for a translation that has since changed.");
    }
  }

  return {
    audioDataUrl,
    cacheKey,
    fromCache: false,
    contentType,
  };
}

// Test-only: exposes the storage keys and limits so a suite can inspect the
// persisted shape without duplicating the constants.
export const READ_ALOUD_CACHE_INTERNALS = Object.freeze({
  AUDIO_CACHE_STORAGE_KEY,
  AUDIO_INDEX_STORAGE_KEY,
  MAX_CACHE_ENTRIES,
  MAX_CACHE_BYTES,
});
