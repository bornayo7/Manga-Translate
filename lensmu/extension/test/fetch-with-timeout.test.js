import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RequestTimeoutError,
  ResponseTooLargeError,
  fetchWithTimeout,
  isAbortError,
  isTimeoutError
} from '../shared/fetch-with-timeout.js';
import { installFetchMock, jsonResponse, stalledResponse } from './helpers/fetch-mock.js';

test('a stalled body times out even though the headers arrived immediately', async () => {
  const mock = installFetchMock(() => stalledResponse());
  try {
    const started = Date.now();
    await assert.rejects(
      () => fetchWithTimeout('https://example.test/slow', {}, { timeoutMs: 60 }),
      (error) => {
        assert.ok(error instanceof RequestTimeoutError);
        assert.equal(isTimeoutError(error), true);
        assert.equal(isAbortError(error), false);
        return true;
      }
    );
    assert.ok(Date.now() - started < 2000, 'the deadline, not a hang, ended the read');
  } finally {
    mock.restore();
  }
});

test("cancellation during the body read rejects with the caller's reason", async () => {
  const mock = installFetchMock(() => stalledResponse());
  try {
    const controller = new AbortController();
    const pending = fetchWithTimeout(
      'https://example.test/slow',
      { signal: controller.signal },
      { timeoutMs: 5000 }
    );
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(isAbortError(error), true);
      assert.equal(isTimeoutError(error), false);
      return true;
    });
    /*
     * Nothing to release: the 5 s timer is cleared before the rejection
     * surfaces, so a leak here would keep this process alive and hang the
     * suite rather than pass quietly.
     */
  } finally {
    mock.restore();
  }
});

test('a request cancelled before headers rethrows the cancellation, not a timeout', async () => {
  const mock = installFetchMock(async ({ init }) => {
    await new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  });
  try {
    const controller = new AbortController();
    const pending = fetchWithTimeout(
      'https://example.test/never',
      { signal: controller.signal },
      { timeoutMs: 5000 }
    );
    controller.abort(new DOMException('user cancelled', 'AbortError'));
    await assert.rejects(pending, (error) => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.message, 'user cancelled');
      return true;
    });
  } finally {
    mock.restore();
  }
});

test('a network failure is passed through unchanged', async () => {
  const mock = installFetchMock(() => {
    throw new TypeError('fetch failed');
  });
  try {
    await assert.rejects(
      () => fetchWithTimeout('https://example.test/down', {}, { timeoutMs: 5000 }),
      /fetch failed/
    );
  } finally {
    mock.restore();
  }
});

test('a successful response carries its bytes, text and parsed json', async () => {
  const mock = installFetchMock(() => jsonResponse({ ok: true, value: 'héllo' }));
  try {
    const response = await fetchWithTimeout('https://example.test/json', {}, { timeoutMs: 5000 });
    assert.equal(response.ok, true);
    assert.deepEqual(response.json, { ok: true, value: 'héllo' });
    assert.equal(response.text, JSON.stringify({ ok: true, value: 'héllo' }));
    assert.ok(response.bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(response.bytes), response.text);
  } finally {
    mock.restore();
  }
});

test('json is undefined when the payload is not JSON, and text still holds the body', async () => {
  const mock = installFetchMock(
    () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'application/json' } })
  );
  try {
    const response = await fetchWithTimeout('https://example.test/liar', {}, { timeoutMs: 5000 });
    assert.equal(response.json, undefined, 'the "said JSON, sent junk" sentinel');
    assert.equal(response.text, '<html>nope</html>');
  } finally {
    mock.restore();
  }
});

test('as: "bytes" skips decoding for binary payloads', async () => {
  const mock = installFetchMock(() => new Response(new Uint8Array([0, 1, 2, 253]), { status: 200 }));
  try {
    const response = await fetchWithTimeout('https://example.test/audio', {}, { timeoutMs: 5000, as: 'bytes' });
    assert.deepEqual([...response.bytes], [0, 1, 2, 253]);
    assert.equal(response.text, undefined);
    assert.equal(response.json, undefined);
  } finally {
    mock.restore();
  }
});

test('as: "bytes" still decodes a failure, which is where the reason lives', async () => {
  const mock = installFetchMock(
    () => new Response(JSON.stringify({ detail: { message: 'voice not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    })
  );
  try {
    const response = await fetchWithTimeout('https://example.test/audio', {}, { timeoutMs: 5000, as: 'bytes' });
    assert.equal(response.ok, false);
    assert.equal(response.json.detail.message, 'voice not found');
  } finally {
    mock.restore();
  }
});

test('the body size limit is enforced while the body is read', async () => {
  const mock = installFetchMock(() => new Response('x'.repeat(2048), { status: 200 }));
  try {
    await assert.rejects(
      () => fetchWithTimeout('https://example.test/big', {}, { timeoutMs: 5000, maxResponseBytes: 1024 }),
      (error) => {
        assert.ok(error instanceof ResponseTooLargeError);
        assert.equal(error.maxBytes, 1024);
        return true;
      }
    );

    const within = await fetchWithTimeout('https://example.test/big', {}, { timeoutMs: 5000, maxResponseBytes: 4096 });
    assert.equal(within.text.length, 2048);
  } finally {
    mock.restore();
  }
});

test('an error response carries its body without the caller reading it', async () => {
  const mock = installFetchMock(
    () => new Response(JSON.stringify({ error: { message: 'nope' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    })
  );
  try {
    const response = await fetchWithTimeout('https://example.test/down', {}, { timeoutMs: 5000 });
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(response.json.error.message, 'nope');
  } finally {
    mock.restore();
  }
});
