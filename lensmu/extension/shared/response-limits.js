export async function readResponseBytesWithLimit(response, maxBytes) {
  const byteLimit = Number(maxBytes);
  if (!Number.isInteger(byteLimit) || byteLimit < 1) {
    throw new RangeError('maxBytes must be a positive integer.');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    throw new Error(`Response exceeds the ${byteLimit}-byte limit.`);
  }

  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > byteLimit) {
      throw new Error(`Response exceeds the ${byteLimit}-byte limit.`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) {
        await reader.cancel('Response exceeds byte limit.');
        throw new Error(`Response exceeds the ${byteLimit}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
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
