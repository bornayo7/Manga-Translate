/**
 * =============================================================================
 * MYMEMORY — Free Public Translation
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * Provides free translation without requiring any API key. This is the
 * default translation provider for users who have not configured an LLM.
 * It is only used as fallback for other providers when the user explicitly
 * enables public-provider fallback.
 *
 * MyMemory Translation API
 *    - URL: https://api.mymemory.translated.net/get
 *    - No API key needed
 *    - Free tier: 5000 chars/day (anonymous), 50000 chars/day (with email)
 *    - Supports most major language pairs
 *    - Uses a combination of machine translation + human translation memory
 *    - Quality: Good for common language pairs, mediocre for rare ones
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
 *   - As an explicitly enabled fallback when the primary provider fails
 *   - Testing the extension before committing to a paid provider
 * =============================================================================
 */

/**
 * MyMemory has a 500-character limit per request segment.
 * Longer texts are split at sentence boundaries.
 */
import { chunkText } from '../shared/text-chunking.js';
import { fetchWithTimeout } from '../shared/fetch-with-timeout.js';

const MYMEMORY_CHAR_LIMIT = 500;

/**
 * Delay between requests to avoid rate limiting (milliseconds).
 * MyMemory allows ~10 requests/second for anonymous users.
 */
const REQUEST_DELAY_MS = 100;

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
      characterCount: String(originalText || '').length
    });
  }

  return cleaned;
}

/**
 * Translate an array of text strings using MyMemory.
 *
 * @param {string[]} texts      — Array of strings to translate
 * @param {string}   sourceLang — Source language code ("auto", "ja", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @returns {Promise<Object>}   — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateWithMyMemory(texts, sourceLang, targetLang) {
  try {
    const translations = await translateEachText(texts, sourceLang, targetLang);
    return {
      translations,
      sourceLang,
      targetLang,
      provider: 'mymemory'
    };
  } catch (myMemoryError) {
    throw new Error(`MyMemory translation failed: ${myMemoryError.message}`);
  }
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
async function translateEachText(texts, sourceLang, targetLang) {
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
    characterCount: text.length
  });

  const response = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

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
  const chunks = chunkText(text, MYMEMORY_CHAR_LIMIT);

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
 * Simple sleep helper using Promises.
 *
 * @param {number} ms — Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
