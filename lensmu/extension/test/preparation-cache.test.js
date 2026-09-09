import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparationCache } from '../shared/preparation-cache.js';
import { createImageWorkQueue } from '../shared/image-work-queue.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const result = (text) => ({ status: 'prepared', prepared: { imageBase64: text } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('one cancelled consumer does not abort preparation needed by another target', async () => {
  const cache = createPreparationCache();
  const gate = deferred(); let signal, calls = 0;
  const produce = (value) => { calls++; signal = value; return gate.promise; };
  const first = new AbortController(), second = new AbortController();
  const a = cache.acquire('same', produce, first.signal);
  const b = cache.acquire('same', produce, second.signal);
  const rejected = assert.rejects(a, { name: 'AbortError' });
  await tick(); first.abort();
  assert.equal(signal.aborted, false);
  gate.resolve(result('pixels'));
  await rejected; assert.deepEqual(await b, result('pixels')); assert.equal(calls, 1);
});

test('the last consumer aborts a producer but its permit stays occupied until actual settlement', async () => {
  const cache = createPreparationCache(); const queue = createImageWorkQueue({ getLimit: () => 1 });
  const gate = deferred(); const controller = new AbortController(); let secondRan = false, producerSignal;
  const first = queue.schedule(1, {}, 1, () => cache.acquire('first', (signal) => {
    producerSignal = signal; return gate.promise;
  }, controller.signal));
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = queue.schedule(1, {}, 1, async () => { secondRan = true; });
  await tick(); controller.abort(); await tick();
  assert.equal(producerSignal.aborted, true); assert.equal(secondRan, false); assert.equal(queue.running, 1);
  gate.resolve(result('pixels')); await rejected; await second;
  assert.equal(secondRan, true);
});

test('completed preparation is bounded by entry count and bytes, with LRU reuse', async () => {
  const cache = createPreparationCache({ maxEntries: 2, maxBytes: 1000 }); let calls = 0;
  const take = (key) => cache.acquire(key, async () => { calls++; return result(key); });
  await take('a'); await take('b'); await take('a'); await take('c');
  assert.equal(calls, 3); assert.equal(cache.size, 2);
  await take('b'); assert.equal(calls, 4, 'least recently used b was evicted');
  await cache.acquire('huge', async () => result('x'.repeat(1000)));
  assert.ok(cache.bytes <= 1000); assert.ok(cache.size <= 2);
});

test('failed and cancelled producers cannot poison a future retry', async () => {
  const cache = createPreparationCache();
  await assert.rejects(cache.acquire('a', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.size, 0);
  assert.deepEqual(await cache.acquire('a', async () => result('fresh')), result('fresh'));
  cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
});
