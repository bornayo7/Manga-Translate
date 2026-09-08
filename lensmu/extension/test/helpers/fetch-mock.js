// Replaces globalThis.fetch for one test with a handler that receives
// (url, init) and returns a Response (or a plain object turned into JSON).
// Records every call so a test can assert on request bodies.

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}

export function installFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = typeof init.body === 'string' ? safeJson(init.body) : null;
    calls.push({ url, init, body });
    const result = await handler({ url, init, body, call: calls.length }, calls);
    if (result instanceof Response) {
      return result;
    }
    return jsonResponse(result);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// A Response whose headers arrive immediately but whose body never ends.
export function stalledResponse(headers = {}) {
  const stream = new ReadableStream({
    start() {
      /* never enqueue, never close */
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

// OpenAI-compatible chat completion body.
export function chatCompletion(content, finishReason = 'stop') {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }] };
}
