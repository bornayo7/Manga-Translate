import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal chrome.storage.local double: async, snapshot-copying (like the
// real one), with an optional per-call delay so interleavings can be forced.
const store = {};
let storageDelayMs = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        await wait(storageDelayMs);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, structuredClone(store[key])]));
      },
      async set(values) {
        await wait(storageDelayMs);
        for (const [key, value] of Object.entries(values)) {
          store[key] = structuredClone(value);
        }
      }
    }
  }
};

const { READ_ALOUD_CACHE_INTERNALS, generateReadAloudAudio, syncReadAloudTranslation } = await import('../tts/elevenlabs.js');
const { AUDIO_CACHE_STORAGE_KEY, AUDIO_INDEX_STORAGE_KEY, MAX_CACHE_ENTRIES } = READ_ALOUD_CACHE_INTERNALS;

const SETTINGS = { elevenLabsApiKey: 'test-key', elevenLabsVoiceId: 'voice-1' };

function reset() {
  for (const key of Object.keys(store)) delete store[key];
  storageDelayMs = 0;
}

// fetch double: each call returns a deferred audio response the test releases.
function installDeferredFetch() {
  const pending = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      pending.push(() =>
        resolve(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
      );
    });
  return {
    pending,
    release(index) {
      pending[index]();
    },
    releaseAll() {
      pending.forEach((release) => release());
    },
    restore() {
      globalThis.fetch = original;
    }
  };
}

const cacheEntries = () => Object.keys(store[AUDIO_CACHE_STORAGE_KEY] || {});
const indexEntries = () => store[AUDIO_INDEX_STORAGE_KEY] || {};

test('two generations completing concurrently both keep their entries', async () => {
  reset();
  storageDelayMs = 5;
  const fetchMock = installDeferredFetch();
  try {
    const a = generateReadAloudAudio({ text: 'Hello A', language: 'en', imageFingerprint: 'fp-a', translationHash: 'h-a', settings: SETTINGS });
    const b = generateReadAloudAudio({ text: 'Hello B', language: 'en', imageFingerprint: 'fp-b', translationHash: 'h-b', settings: SETTINGS });
    await wait(60); // both are now waiting on the provider
    assert.equal(fetchMock.pending.length, 2);
    fetchMock.release(1);
    fetchMock.release(0);
    const [resultA, resultB] = await Promise.all([a, b]);
    assert.notEqual(resultA.cacheKey, resultB.cacheKey);
    assert.deepEqual(cacheEntries().sort(), [resultA.cacheKey, resultB.cacheKey].sort());
    assert.deepEqual(indexEntries()['fp-a'].cacheKeys, [resultA.cacheKey]);
    assert.deepEqual(indexEntries()['fp-b'].cacheKeys, [resultB.cacheKey]);
  } finally {
    fetchMock.restore();
  }
});

test('an invalidation that lands during generation wins over the stale completion', async () => {
  reset();
  const fetchMock = installDeferredFetch();
  try {
    // An existing clip for the old translation.
    const first = generateReadAloudAudio({ text: 'Old text', imageFingerprint: 'fp-x', translationHash: 'h-old', settings: SETTINGS });
    await wait(20);
    fetchMock.release(0);
    const firstResult = await first;
    assert.deepEqual(indexEntries()['fp-x'].cacheKeys, [firstResult.cacheKey]);

    // A second clip for the same (old) translation starts generating...
    const second = generateReadAloudAudio({ text: 'Old text, second clip', imageFingerprint: 'fp-x', translationHash: 'h-old', settings: SETTINGS });
    await wait(20);
    // ...and meanwhile the page re-translates the image.
    const sync = await syncReadAloudTranslation({ imageFingerprint: 'fp-x', translationHash: 'h-new' });
    assert.equal(sync.invalidatedCount, 1);
    assert.equal('fp-x' in indexEntries(), false);

    fetchMock.release(1);
    const secondResult = await second;
    assert.equal(secondResult.fromCache, false, 'the caller still gets its audio');
    assert.equal(cacheEntries().includes(secondResult.cacheKey), false, 'but the stale clip is not stored');
    assert.equal('fp-x' in indexEntries(), false);
  } finally {
    fetchMock.restore();
  }
});

test('a cache hit refreshes its timestamp without erasing unrelated entries', async () => {
  reset();
  const fetchMock = installDeferredFetch();
  try {
    const a = generateReadAloudAudio({ text: 'A', imageFingerprint: 'fp-1', translationHash: 'h-1', settings: SETTINGS });
    await wait(10);
    fetchMock.release(0);
    const resultA = await a;
    const b = generateReadAloudAudio({ text: 'B', imageFingerprint: 'fp-2', translationHash: 'h-2', settings: SETTINGS });
    await wait(10);
    fetchMock.release(1);
    const resultB = await b;

    const before = store[AUDIO_CACHE_STORAGE_KEY][resultA.cacheKey].lastAccessedAt;
    await wait(5);
    const hit = await generateReadAloudAudio({ text: 'A', imageFingerprint: 'fp-1', translationHash: 'h-1', settings: SETTINGS });
    assert.equal(hit.fromCache, true);
    assert.equal(fetchMock.pending.length, 2, 'no provider call on a hit');
    assert.ok(store[AUDIO_CACHE_STORAGE_KEY][resultA.cacheKey].lastAccessedAt >= before);
    assert.deepEqual(cacheEntries().sort(), [resultA.cacheKey, resultB.cacheKey].sort());
    assert.deepEqual(indexEntries()['fp-2'].cacheKeys, [resultB.cacheKey]);
  } finally {
    fetchMock.restore();
  }
});

test('hundreds of translated images without audio leave the index empty', async () => {
  reset();
  for (let index = 0; index < 300; index++) {
    await syncReadAloudTranslation({ imageFingerprint: `fp-${index}`, translationHash: `h-${index}` });
  }
  assert.deepEqual(indexEntries(), {});
  assert.equal(AUDIO_INDEX_STORAGE_KEY in store, false, 'nothing was even written');
});

test('audio eviction removes orphan index references and the index stays bounded', async () => {
  reset();
  const fetchMock = installDeferredFetch();
  try {
    const results = [];
    for (let index = 0; index < MAX_CACHE_ENTRIES + 3; index++) {
      const pending = generateReadAloudAudio({ text: `clip ${index}`, imageFingerprint: `img-${index}`, translationHash: `hash-${index}`, settings: SETTINGS });
      await wait(5);
      fetchMock.release(index);
      results.push(await pending);
      await wait(2); // distinct timestamps so eviction order is deterministic
    }
    assert.equal(cacheEntries().length, MAX_CACHE_ENTRIES);
    const index = indexEntries();
    assert.ok(Object.keys(index).length <= MAX_CACHE_ENTRIES);
    for (const entry of Object.values(index)) {
      assert.ok(entry.cacheKeys.length > 0);
      for (const key of entry.cacheKeys) {
        assert.ok(cacheEntries().includes(key), 'index never points at an evicted clip');
      }
    }
    assert.equal('img-0' in index, false, 'the oldest clip and its record are gone');
  } finally {
    fetchMock.restore();
  }
});

test('stale audio is still invalidated when the translation changes, whether or not read-aloud is enabled', async () => {
  reset();
  const fetchMock = installDeferredFetch();
  try {
    const pending = generateReadAloudAudio({ text: 'voice me', imageFingerprint: 'fp-s', translationHash: 'h-1', settings: SETTINGS });
    await wait(5);
    fetchMock.release(0);
    const result = await pending;
    assert.ok(cacheEntries().includes(result.cacheKey));

    // syncReadAloudTranslation takes no settings: the content script calls
    // it after every translation regardless of the read-aloud toggle.
    const sync = await syncReadAloudTranslation({ imageFingerprint: 'fp-s', translationHash: 'h-2' });
    assert.equal(sync.invalidatedCount, 1);
    assert.equal(cacheEntries().includes(result.cacheKey), false);
    assert.equal('fp-s' in indexEntries(), false);

    const unchanged = await syncReadAloudTranslation({ imageFingerprint: 'fp-s', translationHash: 'h-2' });
    assert.equal(unchanged.invalidatedCount, 0);
  } finally {
    fetchMock.restore();
  }
});
