// Small text/error helpers shared by the extension's ES-module contexts
// (service worker, offscreen document, provider clients).
//
// content.js deliberately keeps its own copies: it is registered as a classic
// content script, so it cannot use static imports, and pulling these in over
// dynamic import() would mean widening web_accessible_resources for a handful
// of one-liners.

// Collapses whitespace and case so two renderings of the same sentence compare
// equal. NFKC folds full-width CJK punctuation onto its ASCII equivalent, which
// OCR output mixes freely.
export function normalizeForComparison(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// True when a provider handed back the source text unchanged — usually a sign
// the language pair was wrong or the text was already in the target language.
export function isEffectivelyIdenticalTranslation(sourceText, translatedText) {
  return normalizeForComparison(sourceText) === normalizeForComparison(translatedText);
}

// Turns "data:image/png;base64,AAAA" into "AAAA". Backends want the payload
// only; passing a data URL through makes base64 decoding fail server-side.
export function stripDataUrlPrefix(imageBase64) {
  if (!imageBase64 || !imageBase64.startsWith('data:')) {
    return imageBase64;
  }

  const commaIndex = imageBase64.indexOf(',');
  return commaIndex === -1 ? imageBase64 : imageBase64.slice(commaIndex + 1);
}

// Rejected values reach us as Error, string, or DOMException depending on the
// layer that threw, so normalise before showing anything to the user.
export function toErrorMessage(error, fallback = 'Unknown error') {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
