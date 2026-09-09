// fetch() with one deadline that covers the whole exchange — connection,
// headers *and* body — and a cap on how many bytes a response may spend.
//
// A plain fetch() resolves as soon as headers arrive, so a server that
// answers 200 and then stalls the body hangs the caller in `.json()`
// forever. The fix is to read the body here, inside the deadline, and hand
// back a plain object:
//
//   { ok, status, statusText, headers, url, bytes, text, json }
//
// Not a Response. An earlier version returned the real Response with its
// body readers monkey-patched and a manual `release()` the caller had to
// remember on every path, or a timer outlived the request. Reading the body
// up front deletes that whole class of bug: there is nothing left to
// release, no patched platform object, and an error body is already
// available on the failure path where callers want it.
//
// `json` is undefined when the payload did not parse, which is the sentinel
// for "the server said JSON and then sent something else". Pass
// `{ as: 'bytes' }` for binary payloads to skip decoding entirely.
//
// Errors are distinguishable: a caller-initiated abort rethrows the
// caller's reason (an AbortError DOMException by default), the deadline
// throws RequestTimeoutError (name "TimeoutError"), an oversized body
// throws ResponseTooLargeError, and anything else is the network failure
// fetch() produced.

import { ResponseTooLargeError, readResponseBytesWithLimit } from './response-limits.js';

export { ResponseTooLargeError };

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function isTimeoutError(error) {
  return error?.name === 'TimeoutError';
}

function makeAbortReason(upstreamSignal) {
  const reason = upstreamSignal?.reason;
  if (reason instanceof Error || (reason && typeof reason === 'object' && 'name' in reason)) {
    return reason;
  }
  return new DOMException(
    typeof reason === 'string' && reason ? reason : 'Request was cancelled.',
    'AbortError'
  );
}

export async function fetchWithTimeout(input, init = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    Number.isInteger(options.maxResponseBytes) && options.maxResponseBytes > 0
      ? options.maxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const upstreamSignal = init.signal || null;
  let timedOut = false;

  const abortFromUpstream = () => controller.abort(makeAbortReason(upstreamSignal));
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new RequestTimeoutError(timeoutMs));
  }, timeoutMs);

  /* Turns whatever the runtime threw into the error the caller can act on. */
  const translateError = (error) => {
    if (upstreamSignal?.aborted) {
      return makeAbortReason(upstreamSignal);
    }
    if (timedOut) {
      return new RequestTimeoutError(timeoutMs);
    }
    return error;
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
  }

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });

    const bytes = await readResponseBytesWithLimit(response, maxResponseBytes, { signal: controller.signal });

    const result = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      url: response.url,
      bytes,
      text: undefined,
      json: undefined
    };

    /*
     * `as: "bytes"` skips decoding a successful binary payload — but an
     * error body is small, textual, and the only place the provider says
     * what went wrong, so it is always decoded. Without this a failed audio
     * request reported "HTTP 401" instead of the reason.
     */
    if (options.as !== 'bytes' || !response.ok) {
      result.text = new TextDecoder().decode(bytes);
      try {
        result.json = JSON.parse(result.text);
      } catch (_error) {
        /* Left undefined: the sentinel for a body that is not JSON. */
      }
    }

    return result;
  } catch (error) {
    throw translateError(error);
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener?.('abort', abortFromUpstream);
  }
}
