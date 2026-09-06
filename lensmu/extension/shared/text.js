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

// Turns a failed HTTP response into one sentence a user can act on. FastAPI
// puts its message under "detail" (a string, or a list of field errors for
// 422s); other services use "error" or "message"; some only send HTML. The
// content script shows body.error verbatim, so this is what the user reads.
export function describeHttpFailure(status, statusText, body) {
  const fallback = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;

  if (typeof body === 'string') {
    const text = body.trim();
    return text && text.length <= 200 && !text.startsWith('<') ? text : fallback;
  }

  if (!body || typeof body !== 'object') {
    return fallback;
  }

  const detail = body.detail ?? body.error ?? body.message;

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    const location = Array.isArray(first?.loc)
      ? first.loc.filter((part) => part !== 'body').join('.')
      : '';
    const message = typeof first?.msg === 'string' ? first.msg.trim() : '';
    if (message) {
      return location ? `${location}: ${message}` : message;
    }
  }

  return fallback;
}
