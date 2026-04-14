/**
 * =============================================================================
 * LIBRE TRANSLATE / MYMEMORY — Free Translation Fallback
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * Provides free translation without requiring any API key. This is the
 * default translation provider for users who haven't set up Google Cloud
 * or an LLM provider. It's also the automatic fallback when other providers
 * fail (expired key, quota exceeded, etc.).
 *
 * TWO FREE SERVICES:
 * ------------------
 *
 * 1. MyMemory Translation API (primary)
 *    - URL: https://api.mymemory.translated.net/get
 *    - No API key needed
 *    - Free tier: 5000 chars/day (anonymous), 50000 chars/day (with email)
 *    - Supports most major language pairs
 *    - Uses a combination of machine translation + human translation memory
 *    - Quality: Good for common language pairs, mediocre for rare ones
 *
 * 2. LibreTranslate (secondary fallback)
 *    - URL: Varies — many community-hosted instances
 *    - No API key needed on most public instances
 *    - Open source, self-hostable
 *    - Quality: Decent, uses Argos Translate models under the hood
 *    - Some public instances have strict rate limits or go down
 *
 * LIMITATIONS:
 * ------------
 *   - Quality is noticeably lower than Google or LLM translation
 *   - Rate limits can be hit during heavy use (lots of images)
 *   - MyMemory has a 500 char limit per segment, so long text gets split
 *   - CJK → English quality varies (Japanese is decent, Chinese is okay,
 *     Korean is weaker)
 *   - No batch API — we have to translate one text at a time (slower)
 *
 * WHEN TO USE:
 * ------------
 * This provider is ideal for:
 *   - Quick casual translation (browsing, not studying)
 *   - Users who don't want to set up API keys
 *   - As a fallback when the primary provider fails
 *   - Testing the extension before committing to a paid provider
 * =============================================================================
 */

/**
 * MyMemory has a 500-character limit per request segment.
 * Longer texts are split at sentence boundaries.
 */
const MYMEMORY_CHAR_LIMIT = 500;

/**
 * Delay between requests to avoid rate limiting (milliseconds).
 * MyMemory allows ~10 requests/second for anonymous users.
 */
const REQUEST_DELAY_MS = 100;

/**
 * List of public LibreTranslate instances to try as fallback.
 * These are community-hosted and may go down or change.
 * We try them in order until one works.
 */
const LIBRE_INSTANCES = [
  'https://libretranslate.com',
  'https://translate.terraprint.co',
  'https://translate.fedilab.app'
];

function previewText(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function normalizeForComparison(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isEffectivelyIdenticalTranslation(sourceText, translatedText) {
  return normalizeForComparison(sourceText) === normalizeForComparison(translatedText);
}

function ensureTranslatedText(rawTranslatedText, originalText, providerName) {
  const cleaned = String(rawTranslatedText || '')
    .replace(/MYMEMORY WARNING:.*$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error(`${providerName} returned an empty translatedText payload.`);
  }

  if (isEffectivelyIdenticalTranslation(originalText, cleaned)) {
    console.warn('[VisionTranslate Translation] Provider returned text identical to source', {
      provider: providerName,
      sourcePreview: previewText(originalText),
      translatedPreview: previewText(cleaned)
    });
  }

  return cleaned;
}

/**
 * Translate an array of text strings using free translation services.
 *
 * Strategy:
 *   1. Try MyMemory first (more reliable, better quality)
 *   2. If MyMemory fails, try LibreTranslate instances
 *   3. If everything fails, throw an error
 *
 * @param {string[]} texts      — Array of strings to translate
 * @param {string}   sourceLang — Source language code ("auto", "ja", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @returns {Promise<Object>}   — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateWithLibre(texts, sourceLang, targetLang) {
  /*
   * Try MyMemory first — it's generally more reliable and has better
   * translation quality than most LibreTranslate public instances.
   */
  try {
    const translations = await translateWithMyMemory(texts, sourceLang, targetLang);
    return {
      translations,
      sourceLang,
      targetLang,
      provider: 'mymemory'
    };
  } catch (myMemoryError) {
    console.warn(
      '[VisionTranslate] MyMemory failed, trying LibreTranslate:',
      myMemoryError.message
    );
  }

  /*
   * MyMemory failed — try LibreTranslate instances one by one.
   * We iterate through the list until one works.
   */
  for (const instance of LIBRE_INSTANCES) {
    try {
      const translations = await translateWithLibreInstance(texts, sourceLang, targetLang, instance);
      return {
        translations,
        sourceLang,
        targetLang,
        provider: `libretranslate (${new URL(instance).hostname})`
      };
    } catch (libreError) {
      console.warn(
        `[VisionTranslate] LibreTranslate instance ${instance} failed:`,
        libreError.message
      );
      /*
       * Continue to the next instance instead of throwing.
       */
    }
  }

  /*
   * All free services failed. This likely means:
   *   - User is offline
   *   - All services are temporarily down
   *   - Rate limits are exhausted for the day
   */
  throw new Error(
    'All free translation services failed. Check your internet connection, ' +
    'or configure an LLM provider ' +
    'for more reliable translation.'
  );
}

/**
 * =============================================================================
 * MyMemory Translation
 * =============================================================================
 *
 * API docs: https://mymemory.translated.net/doc/spec.php
 *
 * The API is simple — it's a GET request with query parameters:
 *   ?q=text to translate
 *   &langpair=ja|en         (source|target)
 *   &de=email@example.com   (optional, raises daily limit to 50K chars)
 *
 * Response:
 *   {
 *     "responseData": {
 *       "translatedText": "Hello",
 *       "match": 0.95         // confidence (0–1)
 *     },
 *     "responseStatus": 200
 *   }
 */

/**
 * Translate texts using the MyMemory API.
 *
 * Since MyMemory doesn't support batch translation, we translate each
 * text individually. We add a small delay between requests to be polite
 * to the free service.
 *
 * @param {string[]} texts      — Texts to translate
 * @param {string}   sourceLang — Source language code
 * @param {string}   targetLang — Target language code
 * @returns {Promise<string[]>} — Translated texts
 */
async function translateWithMyMemory(texts, sourceLang, targetLang) {
  const translations = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];

    /*
     * MyMemory has a 500-char limit per request. For longer texts,
     * we split at sentence boundaries and translate each chunk.
     */
    let translated;
    if (text.length > MYMEMORY_CHAR_LIMIT) {
      translated = await translateLongText(text, sourceLang, targetLang);
    } else {
      translated = await myMemorySingleRequest(text, sourceLang, targetLang);
    }

    translations.push(translated);

    /*
     * Add a small delay between requests to avoid rate limiting.
     * We skip the delay after the last request (no point waiting).
     */
    if (i < texts.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return translations;
}

/**
 * Make a single MyMemory translation request.
 *
 * @param {string} text       — Text to translate (max 500 chars)
 * @param {string} sourceLang — Source language code
 * @param {string} targetLang — Target language code
 * @returns {Promise<string>} — Translated text
 */
async function myMemorySingleRequest(text, sourceLang, targetLang) {
  /*
   * MyMemory expects the language pair in "source|target" format.
   * When the extension is set to auto-detect, use MyMemory's documented
   * "autodetect" source value instead of forcing a specific language.
   */
  const source = (sourceLang && sourceLang !== 'auto') ? sourceLang : 'autodetect';
  const langPair = `${source}|${targetLang}`;

  const params = new URLSearchParams({
    q: text,
    langpair: langPair
  });

  console.log('[VisionTranslate Translation] MyMemory request', {
    provider: 'mymemory',
    sourceLang: source,
    targetLang,
    sourcePreview: previewText(text)
  });

  const response = await fetch(
    `https://api.mymemory.translated.net/get?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  console.log('[VisionTranslate Translation] MyMemory raw response', {
    provider: 'mymemory',
    sourceLang: source,
    targetLang,
    rawResponse: data
  });

  /*
   * Check for API-level errors. MyMemory returns 200 even for errors,
   * so we need to check responseStatus.
   *
   * Common error statuses:
   *   403 — Daily limit exceeded
   *   429 — Too many requests
   */
  if (data.responseStatus && data.responseStatus !== 200) {
    throw new Error(
      `MyMemory error (${data.responseStatus}): ${data.responseDetails || 'Unknown error'}`
    );
  }

  /*
   * Some responses include "MYMEMORY WARNING" in the translated text
   * when the daily limit is approaching. We strip these warnings.
   */
  return ensureTranslatedText(
    data.responseData?.translatedText,
    text,
    'MyMemory'
  );
}

/**
 * Handle texts longer than MyMemory's 500-char limit by splitting
 * at sentence boundaries.
 *
 * @param {string} text       — Long text to translate
 * @param {string} sourceLang — Source language
 * @param {string} targetLang — Target language
 * @returns {Promise<string>} — Translated text (chunks joined back)
 */
async function translateLongText(text, sourceLang, targetLang) {
  /*
   * Split on sentence-ending punctuation. We keep the punctuation
   * with the sentence (using a lookbehind in the regex).
   *
   * For CJK text, sentences end with 。！？ (fullwidth punctuation).
   * For Latin text, sentences end with . ! ?
   */
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*/g) || [text];
  const chunks = [];
  let currentChunk = '';

  /*
   * Group sentences into chunks that fit within the character limit.
   * We try to send as much text as possible per request to maintain
   * context and reduce the number of API calls.
   */
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > MYMEMORY_CHAR_LIMIT) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  /*
   * Translate each chunk and join the results.
   */
  const translatedChunks = [];
  for (const chunk of chunks) {
    const translated = await myMemorySingleRequest(chunk, sourceLang, targetLang);
    translatedChunks.push(translated);
    await sleep(REQUEST_DELAY_MS);
  }

  return translatedChunks.join(' ');
}

/**
 * =============================================================================
 * LibreTranslate
 * =============================================================================
 *
 * API docs: https://libretranslate.com/docs
 *
 * LibreTranslate has a simple POST API:
 *   POST /translate
 *   {
 *     "q": "text to translate",
 *     "source": "ja",
 *     "target": "en"
 *   }
 *
 * Response:
 *   {
 *     "translatedText": "translated text"
 *   }
 *
 * Some instances require an API key; public ones usually don't.
 */

/**
 * Translate texts using a specific LibreTranslate instance.
 *
 * @param {string[]} texts      — Texts to translate
 * @param {string}   sourceLang — Source language code
 * @param {string}   targetLang — Target language code
 * @param {string}   baseUrl    — LibreTranslate instance URL
 * @returns {Promise<string[]>} — Translated texts
 */
async function translateWithLibreInstance(texts, sourceLang, targetLang, baseUrl) {
  const translations = [];

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];

    const response = await fetch(`${baseUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: text,
        source: (sourceLang && sourceLang !== 'auto') ? sourceLang : 'auto',
        target: targetLang,
        format: 'text'
      })
    });

    if (!response.ok) {
      /*
       * If ANY request fails, abort this instance entirely and let
       * the caller try the next instance. A failing instance is likely
       * to fail for all requests, so there's no point continuing.
       */
      throw new Error(
        `LibreTranslate ${baseUrl} error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    console.log('[VisionTranslate Translation] LibreTranslate raw response', {
      provider: `libretranslate:${new URL(baseUrl).hostname}`,
      sourceLang: (sourceLang && sourceLang !== 'auto') ? sourceLang : 'auto',
      targetLang,
      sourcePreview: previewText(text),
      rawResponse: data
    });

    translations.push(
      ensureTranslatedText(
        data.translatedText,
        text,
        `LibreTranslate (${new URL(baseUrl).hostname})`
      )
    );

    /*
     * Delay between requests to be polite to free public instances.
     */
    if (i < texts.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return translations;
}

/**
 * Simple sleep helper using Promises.
 *
 * @param {number} ms — Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
