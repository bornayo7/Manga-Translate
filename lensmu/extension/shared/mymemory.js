// MyMemory contract shared by the extension's translation client and the
// website's demo pipeline, so the two cannot drift on request sizing, the
// source-language rule, or how quota exhaustion and error statuses are
// reported.
//
// Spec (https://mymemory.translated.net/doc/spec.php, read 2026-09-07):
//   q        "Max 500 bytes", UTF-8
//   langpair "Source and language pair, separated by the | symbol. Use ISO
//            standard names or RFC3066". No automatic-detection value is
//            documented, and community reports say "autodetect" is answered
//            with an invalid-source-language error, so a source language is
//            always sent explicitly here.

import { isEffectivelyIdenticalTranslation } from './text.js';
import { utf8ByteLength } from './text-chunking.js';
import { detectSourceLanguage, normalizeLanguageCode } from './language-detection.js';

// MyMemory rejects segments larger than this many UTF-8 bytes; longer text
// is chunked with chunkTextByBytes().
export const MYMEMORY_BYTE_LIMIT = 500;

export function exceedsMyMemoryLimit(text) {
  return utf8ByteLength(text) > MYMEMORY_BYTE_LIMIT;
}

/*
 * The source language to send for one text. An explicit user choice wins.
 * "auto" is resolved from the text's script or stop words; when that is not
 * decisive the error names the fix (choose a source language) instead of
 * guessing one, because a wrong pair silently yields nonsense.
 */
export function resolveMyMemorySourceLanguage(sourceLang, text) {
  const normalized = normalizeLanguageCode(sourceLang);

  if (normalized && normalized !== 'auto') {
    return { language: normalized, detected: false, reason: 'explicit' };
  }

  const detection = detectSourceLanguage(text);
  if (detection.language) {
    return { language: detection.language, detected: true, reason: detection.reason };
  }

  const hint =
    detection.reason === 'han-only-ambiguous'
      ? 'The text uses only Han characters, which can be Chinese or Japanese.'
      : 'The text does not carry enough evidence of one language.';
  throw new Error(
    `MyMemory needs an explicit source language (it has no auto-detect). ${hint} ` +
      'Choose the source language in the extension settings, or use an LLM provider.'
  );
}

export function buildMyMemoryLangPair(sourceLanguage, targetLang) {
  return `${sourceLanguage}|${String(targetLang || '').trim()}`;
}

/*
 * MyMemory answers HTTP 200 for almost everything and reports the real
 * outcome in the body. responseStatus is a number on most replies but a
 * string on some error replies, and once the anonymous daily quota is
 * exhausted quotaFinished flips to true (sometimes with an empty
 * translatedText, sometimes with the warning text handled below).
 */
export function assertMyMemoryStatus(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('MyMemory returned an invalid response payload.');
  }
  const responseStatus = Number(data?.responseStatus ?? 200);
  if (!Number.isInteger(responseStatus) ||
      (data.responseStatus !== undefined && !['number', 'string'].includes(typeof data.responseStatus))) {
    throw new Error('MyMemory returned an invalid response status.');
  }
  if (responseStatus !== 200) {
    throw new Error(`MyMemory error (${responseStatus}): ${data?.responseDetails || 'Unknown error'}`);
  }

  if (data?.quotaFinished === true && !String(data?.responseData?.translatedText || '').trim()) {
    throw new Error(
      'MyMemory daily quota reached (5,000 characters per day without a key). Try again tomorrow or configure an LLM provider.'
    );
  }
}

/*
 * MyMemory signals quota trouble inside translatedText: either appended to a
 * real translation as the daily limit approaches, or as the *entire* payload
 * ("MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.
 * NEXT AVAILABLE IN 16 HOURS ...") once it is exhausted. The warning is the
 * one message the user needs, so it becomes the error when nothing else came
 * back, and a console warning when a translation did.
 */
export function ensureTranslatedText(rawTranslatedText, originalText, providerName = 'MyMemory') {
  if (typeof rawTranslatedText !== 'string') {
    throw new Error(`${providerName} returned an invalid translatedText payload (expected text).`);
  }
  const raw = rawTranslatedText.trim();
  const warningIndex = raw.search(/MYMEMORY WARNING:/i);
  const cleaned = (warningIndex === -1 ? raw : raw.slice(0, warningIndex)).trim();

  if (warningIndex !== -1) {
    const detail = raw.slice(warningIndex).replace(/^MYMEMORY WARNING:\s*/i, '').trim();
    const readable = detail ? detail.charAt(0) + detail.slice(1).toLowerCase() : 'daily quota reached.';

    if (!cleaned) {
      throw new Error(`${providerName} quota: ${readable}`);
    }

    console.warn(`[VisionTranslate MyMemory] ${providerName} warning: ${readable}`);
  }

  if (!cleaned) {
    throw new Error(`${providerName} returned an empty translatedText payload.`);
  }

  if (isEffectivelyIdenticalTranslation(originalText, cleaned)) {
    console.warn('[VisionTranslate MyMemory] Provider returned text identical to source', {
      provider: providerName,
      characterCount: String(originalText || '').length
    });
  }

  return cleaned;
}
