// MyMemory response handling shared by the extension's translation client
// and the website's demo pipeline, so the two cannot drift on how quota
// exhaustion or an error status is reported.

import { isEffectivelyIdenticalTranslation } from './text.js';

// MyMemory rejects segments longer than this; longer text is chunked.
export const MYMEMORY_CHAR_LIMIT = 500;

/*
 * MyMemory answers HTTP 200 for almost everything and reports the real
 * outcome in the body. responseStatus is a number on most replies but a
 * string on some error replies, and once the anonymous daily quota is
 * exhausted quotaFinished flips to true (sometimes with an empty
 * translatedText, sometimes with the warning text handled below).
 */
export function assertMyMemoryStatus(data) {
  const responseStatus = Number(data?.responseStatus ?? 200);
  if (Number.isFinite(responseStatus) && responseStatus !== 200) {
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
  const raw = String(rawTranslatedText || '').trim();
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
