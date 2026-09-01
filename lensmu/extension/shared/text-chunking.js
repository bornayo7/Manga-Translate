export function chunkText(text, maxLength = 500) {
  const normalizedText = String(text || '');
  const limit = Number(maxLength);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('maxLength must be a positive integer.');
  }

  if (!normalizedText) {
    return [];
  }

  const chunks = [];
  const sentences = normalizedText.match(/[^.!?。！？]+[.!?。！？]*/g) || [normalizedText];
  let currentChunk = '';

  const flushCurrentChunk = () => {
    const value = currentChunk.trim();
    if (value) {
      chunks.push(value);
    }
    currentChunk = '';
  };

  const appendPiece = (piece) => {
    const value = String(piece || '').trim();
    if (!value) {
      return;
    }

    const separator = currentChunk ? ' ' : '';
    if ((currentChunk + separator + value).length <= limit) {
      currentChunk += separator + value;
      return;
    }

    flushCurrentChunk();
    if (value.length <= limit) {
      currentChunk = value;
      return;
    }

    const words = value.match(/\S+\s*/g) || [value];
    for (const wordWithSpacing of words) {
      const word = wordWithSpacing.trim();
      if (!word) {
        continue;
      }

      if (word.length > limit) {
        flushCurrentChunk();
        for (let offset = 0; offset < word.length; offset += limit) {
          chunks.push(word.slice(offset, offset + limit));
        }
        continue;
      }

      const wordSeparator = currentChunk ? ' ' : '';
      if ((currentChunk + wordSeparator + word).length > limit) {
        flushCurrentChunk();
      }
      currentChunk += (currentChunk ? ' ' : '') + word;
    }
  };

  for (const sentence of sentences) {
    appendPiece(sentence);
  }
  flushCurrentChunk();

  return chunks;
}
