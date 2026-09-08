// Splits long text into provider-sized pieces at sentence, then word, then
// grapheme boundaries. Two public entry points share one algorithm and
// differ only in how a piece is measured:
//
//   chunkText(text, maxLength)      — UTF-16 code units (String.length)
//   chunkTextByBytes(text, maxBytes) — UTF-8 bytes, which is what MyMemory
//                                      limits ("Max 500 bytes", UTF-8)
//
// The input's own characters and whitespace are preserved inside every
// chunk (nothing is inserted, only chunk edges are trimmed), so joining the
// chunks back reproduces the text except for whitespace at the cut points.
// A surrogate pair is never split; the byte-aware variant also keeps
// grapheme clusters (base + combining marks, emoji sequences) together
// unless a single cluster is itself larger than the limit.

export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

// Splits one oversized token into pieces no larger than `limit`, preferring
// grapheme boundaries and falling back to code points only when a single
// grapheme cluster exceeds the limit on its own.
function splitOversizedToken(token, limit, measure) {
  const pieces = [];
  let current = '';

  const push = (unit) => {
    if (current && measure(current + unit) > limit) {
      pieces.push(current);
      current = '';
    }
    current += unit;
  };

  for (const grapheme of splitGraphemes(token)) {
    if (measure(grapheme) <= limit) {
      push(grapheme);
      continue;
    }
    for (const codePoint of Array.from(grapheme)) {
      push(codePoint);
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

function chunkWithMeasure(text, limit, measure) {
  const normalizedText = String(text || '');

  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('The chunk limit must be a positive integer.');
  }

  if (!normalizedText.trim()) {
    return [];
  }

  const chunks = [];
  // Sentences keep their terminal punctuation; the whitespace after it
  // becomes the leading part of the next sentence, so concatenating the
  // pieces reproduces the input byte for byte.
  const sentences = normalizedText.match(/[^.!?。！？]+[.!?。！？]*|[.!?。！？]+/g) || [normalizedText];
  let currentChunk = '';

  const flushCurrentChunk = () => {
    const value = currentChunk.trim();
    if (value) {
      chunks.push(value);
    }
    currentChunk = '';
  };

  const appendUnit = (unit) => {
    if (currentChunk && measure((currentChunk + unit).trim()) > limit) {
      flushCurrentChunk();
    }
    currentChunk += unit;
  };

  for (const sentence of sentences) {
    if (!sentence.trim()) {
      currentChunk += sentence;
      continue;
    }

    if (measure((currentChunk + sentence).trim()) <= limit) {
      currentChunk += sentence;
      continue;
    }

    flushCurrentChunk();
    if (measure(sentence.trim()) <= limit) {
      currentChunk = sentence;
      continue;
    }

    // The sentence alone is over the limit: fall back to words, then to
    // graphemes for a single word that is still too large.
    for (const wordWithSpacing of sentence.match(/\S+\s*|\s+/g) || [sentence]) {
      const word = wordWithSpacing.trim();
      if (!word) {
        currentChunk += wordWithSpacing;
        continue;
      }

      if (measure(word) > limit) {
        flushCurrentChunk();
        const pieces = splitOversizedToken(word, limit, measure);
        for (let index = 0; index < pieces.length - 1; index++) {
          chunks.push(pieces[index]);
        }
        currentChunk = (pieces[pieces.length - 1] || '') + wordWithSpacing.slice(word.length);
        continue;
      }

      appendUnit(wordWithSpacing);
    }
  }
  flushCurrentChunk();

  return chunks;
}

export function chunkText(text, maxLength = 500) {
  return chunkWithMeasure(text, Number(maxLength), (value) => value.length);
}

export function chunkTextByBytes(text, maxBytes = 500) {
  return chunkWithMeasure(text, Number(maxBytes), utf8ByteLength);
}
