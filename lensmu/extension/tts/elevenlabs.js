const AUDIO_CACHE_STORAGE_KEY = "vt_elevenlabs_audio_cache";
const AUDIO_INDEX_STORAGE_KEY = "vt_elevenlabs_audio_index";
const MAX_CACHE_ENTRIES = 12;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

const DEFAULT_ELEVENLABS_SETTINGS = {
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "",
  elevenLabsModelId: "eleven_flash_v2_5",
  elevenLabsOutputFormat: "mp3_44100_128",
  elevenLabsStability: 0.5,
  elevenLabsSimilarityBoost: 0.75,
  elevenLabsStyle: 0,
  elevenLabsSpeed: 1,
};

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

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

  const removedKeys = new Set();

  while (
    sortedEntries.length > MAX_CACHE_ENTRIES ||
    totalBytes > MAX_CACHE_BYTES
  ) {
    const [cacheKey, entry] = sortedEntries.shift();
    totalBytes -= Number(entry.byteLength || 0);
    delete cache[cacheKey];
    removedKeys.add(cacheKey);
  }

  if (!removedKeys.size) {
    return;
  }

  for (const imageFingerprint of Object.keys(index)) {
    const indexEntry = index[imageFingerprint];
    const nextCacheKeys = (indexEntry?.cacheKeys || []).filter(
      (cacheKey) => !removedKeys.has(cacheKey)
    );

    index[imageFingerprint] = {
      translationHash: indexEntry?.translationHash || "",
      cacheKeys: nextCacheKeys,
    };
  }
}

async function ensureImageCacheIndex(cache, index, imageFingerprint, translationHash) {
  if (!imageFingerprint || !translationHash) {
    return { invalidatedCount: 0 };
  }

  const existingEntry = index[imageFingerprint];

  if (!existingEntry) {
    index[imageFingerprint] = {
      translationHash,
      cacheKeys: [],
    };
    return { invalidatedCount: 0 };
  }

  if (existingEntry.translationHash === translationHash) {
    return { invalidatedCount: 0 };
  }

  const invalidatedCount = removeCacheKeys(cache, existingEntry.cacheKeys);

  index[imageFingerprint] = {
    translationHash,
    cacheKeys: [],
  };

  return { invalidatedCount };
}

function registerCacheKey(index, imageFingerprint, translationHash, cacheKey) {
  if (!imageFingerprint || !translationHash || !cacheKey) {
    return;
  }

  const existingEntry = index[imageFingerprint] || {
    translationHash,
    cacheKeys: [],
  };

  const nextCacheKeys = new Set(existingEntry.cacheKeys || []);
  nextCacheKeys.add(cacheKey);

  index[imageFingerprint] = {
    translationHash,
    cacheKeys: [...nextCacheKeys],
  };
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const jsonBody = await response.json().catch(() => null);
    return (
      jsonBody?.detail?.message ||
      jsonBody?.detail ||
      jsonBody?.message ||
      `HTTP ${response.status}`
    );
  }

  const textBody = await response.text().catch(() => "");
  return textBody || `HTTP ${response.status}`;
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

export async function loadElevenLabsVoices(rawSettings = {}) {
  const settings = normalizeElevenLabsSettings(rawSettings);
  ensureConfigured(settings, { requireVoiceId: false });

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: {
      "xi-api-key": settings.apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const responseBody = await response.json();

  return (responseBody?.voices || [])
    .map((voice) => ({
      voiceId: voice?.voice_id || voice?.voiceId || "",
      name: voice?.name || "Unnamed voice",
      category: voice?.category || "",
    }))
    .filter((voice) => voice.voiceId)
    .sort((leftVoice, rightVoice) => leftVoice.name.localeCompare(rightVoice.name));
}

export async function syncReadAloudTranslation({
  imageFingerprint,
  translationHash,
}) {
  if (!imageFingerprint || !translationHash) {
    return { invalidatedCount: 0 };
  }

  const { cache, index } = await readCacheState();
  const { invalidatedCount } = await ensureImageCacheIndex(
    cache,
    index,
    imageFingerprint,
    translationHash
  );

  pruneCache(cache, index);
  await writeCacheState(cache, index);

  return { invalidatedCount };
}

export async function generateReadAloudAudio({
  text,
  language,
  imageFingerprint,
  translationHash,
  settings: rawSettings = {},
  cacheAudio = true,
}) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    throw new Error("No translated text was available for read aloud.");
  }

  const settings = normalizeElevenLabsSettings(rawSettings);
  ensureConfigured(settings);

  const normalizedTranslationHash =
    String(translationHash || "").trim() || (await sha256Hex(normalizedText));

  const descriptor = buildCacheDescriptor({
    text: normalizedText,
    language,
    imageFingerprint,
    translationHash: normalizedTranslationHash,
    settings,
  });
  const cacheKey = await sha256Hex(JSON.stringify(descriptor));

  let cache = {};
  let index = {};

  if (cacheAudio) {
    const cacheState = await readCacheState();
    cache = cacheState.cache;
    index = cacheState.index;

    await ensureImageCacheIndex(
      cache,
      index,
      imageFingerprint,
      normalizedTranslationHash
    );

    const cachedEntry = cache[cacheKey];

    if (cachedEntry?.audioDataUrl) {
      cachedEntry.lastAccessedAt = Date.now();
      cache[cacheKey] = cachedEntry;
      registerCacheKey(index, imageFingerprint, normalizedTranslationHash, cacheKey);
      await writeCacheState(cache, index);

      return {
        audioDataUrl: cachedEntry.audioDataUrl,
        cacheKey,
        fromCache: true,
        contentType: cachedEntry.contentType,
      };
    }
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      settings.voiceId
    )}?output_format=${encodeURIComponent(settings.outputFormat)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": settings.apiKey,
        Accept: "audio/mpeg",
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
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const audioBuffer = await response.arrayBuffer();
  const audioBytes = new Uint8Array(audioBuffer);
  const contentType = inferContentType(
    response.headers.get("content-type"),
    settings.outputFormat
  );
  const audioDataUrl = `data:${contentType};base64,${base64FromBytes(audioBytes)}`;

  if (cacheAudio) {
    cache[cacheKey] = {
      audioDataUrl,
      contentType,
      byteLength: estimateByteLength(audioDataUrl),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    registerCacheKey(index, imageFingerprint, normalizedTranslationHash, cacheKey);
    pruneCache(cache, index);
    await writeCacheState(cache, index);
  }

  return {
    audioDataUrl,
    cacheKey,
    fromCache: false,
    contentType,
  };
}
