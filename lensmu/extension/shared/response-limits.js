export class ResponseTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Response exceeds the ${maxBytes}-byte limit.`);
    this.name = 'ResponseTooLargeError';
    this.maxBytes = maxBytes;
  }
}

export async function readResponseBytesWithLimit(response, maxBytes, { signal } = {}) {
  const byteLimit = Number(maxBytes);
  if (!Number.isInteger(byteLimit) || byteLimit < 1) {
    throw new RangeError('maxBytes must be a positive integer.');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    response.body?.cancel?.('Response exceeds byte limit.').catch(() => undefined);
    throw new ResponseTooLargeError(byteLimit);
  }

  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > byteLimit) {
      throw new ResponseTooLargeError(byteLimit);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => undefined);
  const onAbort = () => {
    const reason = signal.reason || new DOMException('Request cancelled.', 'AbortError');
    // Only the reader owner can cancel a locked stream. Do not wait for a
    // provider's cancel hook, which may itself never settle.
    reader.cancel(reason).catch(() => undefined);
    rejectAbort(reason);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) {
        reader.cancel('Response exceeds byte limit.').catch(() => undefined);
        throw new ResponseTooLargeError(byteLimit);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
