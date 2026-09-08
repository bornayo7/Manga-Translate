/**
 * =============================================================================
 * MYMEMORY — Free Public Translation
 * =============================================================================
 *
 * Free translation without an API key. This is the default provider for
 * users who have not configured an LLM, and the opt-in fallback for other
 * providers when the user explicitly enables public-provider fallback.
 *
 * MyMemory Translation API (https://mymemory.translated.net/doc/spec.php)
 *    - URL: https://api.mymemory.translated.net/get
 *    - No API key needed; 5,000 chars/day anonymous
 *    - `q` is limited to 500 UTF-8 *bytes* per request, so text is chunked
 *      by byte size (a 200-character CJK string is already 600 bytes)
 *    - `langpair` must name the source language; the spec offers no
 *      auto-detect value, so "auto" is resolved from the text's script or
 *      stop words and an undecidable text is reported back to the user
 *    - No batch API: one request per text, paced globally at ~10/s
 * =============================================================================
 */

import { chunkTextByBytes } from '../shared/text-chunking.js';
import { fetchWithTimeout } from '../shared/fetch-with-timeout.js';
import {
  MYMEMORY_BYTE_LIMIT,
  assertMyMemoryStatus,
  buildMyMemoryLangPair,
  ensureTranslatedText,
  exceedsMyMemoryLimit,
  resolveMyMemorySourceLanguage
} from '../shared/mymemory.js';

/**
 * Minimum spacing between MyMemory requests, enforced across *every* caller
 * in this worker. A per-job delay does not bound aggregate traffic: five
 * images translating in parallel would each pace themselves and together
 * send 50 requests a second. Anonymous access allows roughly 10/s.
 */
const REQUEST_DELAY_MS = 100;
const MYMEMORY_RESPONSE_LIMIT_BYTES = 256 * 1024;

let requestChain = Promise.resolve();
let lastRequestStartedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Serialises MyMemory requests so no two overlap and consecutive requests are
// at least REQUEST_DELAY_MS apart, whichever image or job they belong to.
function paceRequest(task, signal) {
  const run = requestChain.then(async () => {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Request was cancelled.', 'AbortError');
    }
    const wait = lastRequestStartedAt + REQUEST_DELAY_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestStartedAt = Date.now();
    return task();
  });
  requestChain = run.catch(() => undefined);
  return run;
}

/**
 * Translate an array of text strings using MyMemory.
 *
 * @param {string[]} texts      — Array of strings to translate
 * @param {string}   sourceLang — Source language code ("auto", "ja", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @param {Object}   [options]  — { signal?: AbortSignal }
 * @returns {Promise<Object>}   — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateWithMyMemory(texts, sourceLang, targetLang, options = {}) {
  const signal = options.signal || undefined;
  try {
    const translations = [];
    const unresolvedBlocks = [];
    let resolvedSourceLang = sourceLang;

    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];
      let source;
      try {
        source = resolveMyMemorySourceLanguage(sourceLang, text);
      } catch (resolveError) {
        /*
         * One block whose language cannot be told (a kanji-only sign, a
         * two-letter Latin fragment) must not sink the rest of the page:
         * it comes back empty, which translate-manager reports as a failed
         * block, and only a page with no decidable block at all fails whole.
         */
        unresolvedBlocks.push({ index, error: resolveError });
        translations.push('');
        continue;
      }

      resolvedSourceLang = source.detected && texts.length === 1 ? source.language : resolvedSourceLang;
      translations.push(
        exceedsMyMemoryLimit(text)
          ? await translateLongText(text, source.language, targetLang, signal)
          : await myMemorySingleRequest(text, source.language, targetLang, signal)
      );
    }

    if (unresolvedBlocks.length === texts.length) {
      throw unresolvedBlocks[0].error;
    }

    if (unresolvedBlocks.length > 0) {
      console.warn('[VisionTranslate Translation] MyMemory skipped blocks with an undecidable source language', {
        indices: unresolvedBlocks.map((entry) => entry.index),
        reason: unresolvedBlocks[0].error.message
      });
    }

    return {
      translations,
      sourceLang: resolvedSourceLang,
      targetLang,
      provider: 'mymemory',
      unresolvedIndices: unresolvedBlocks.map((entry) => entry.index)
    };
  } catch (myMemoryError) {
    if (signal?.aborted || myMemoryError?.name === 'AbortError') {
      throw myMemoryError;
    }
    throw new Error(`MyMemory translation failed: ${myMemoryError.message}`);
  }
}

/**
 * Make a single MyMemory translation request for one segment that is
 * already within MYMEMORY_BYTE_LIMIT.
 */
async function myMemorySingleRequest(text, sourceLanguage, targetLang, signal) {
  const params = new URLSearchParams({
    q: text,
    langpair: buildMyMemoryLangPair(sourceLanguage, targetLang)
  });

  console.log('[VisionTranslate Translation] MyMemory request', {
    provider: 'mymemory',
    sourceLang: sourceLanguage,
    targetLang,
    characterCount: text.length
  });

  return paceRequest(async () => {
    const response = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?${params.toString()}`,
      { signal },
      { maxResponseBytes: MYMEMORY_RESPONSE_LIMIT_BYTES }
    );

    if (!response.ok) {
      throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
    }

    const data = response.json;

    /*
     * MyMemory returns 200 even for errors and quota exhaustion; the shared
     * helpers read the body for the real outcome.
     */
    assertMyMemoryStatus(data);

    return ensureTranslatedText(data.responseData?.translatedText, text, 'MyMemory');
  }, signal);
}

/**
 * Handle texts larger than MyMemory's 500-byte limit by splitting at
 * sentence/word/grapheme boundaries and translating each chunk in order.
 */
async function translateLongText(text, sourceLanguage, targetLang, signal) {
  const chunks = chunkTextByBytes(text, MYMEMORY_BYTE_LIMIT);
  const translatedChunks = [];

  for (const chunk of chunks) {
    translatedChunks.push(await myMemorySingleRequest(chunk, sourceLanguage, targetLang, signal));
  }

  return translatedChunks.join(' ');
}
