import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageWorkQueue } from '../shared/image-work-queue.js';

const flush = async (rounds = 10) => {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/* A task that finishes only when the test says so. */
function gate(value) {
  let release;
  const promise = new Promise((resolve) => {
    release = () => resolve(value);
  });
  return { promise, release, task: () => promise };
}

test('never runs more than the limit at once', async () => {
  let inFlight = 0;
  let peak = 0;
  const queue = createImageWorkQueue({ getLimit: () => 2 });
  const gates = [gate('a'), gate('b'), gate('c'), gate('d')];

  const results = gates.map((entry, index) =>
    queue.schedule(`k${index}`, {}, 1, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const value = await entry.promise;
      inFlight -= 1;
      return value;
    })
  );

  await flush();
  assert.equal(peak, 2);
  assert.equal(queue.running, 2);
  assert.equal(queue.queued, 2);

  gates.forEach((entry) => entry.release());
  assert.deepEqual(await Promise.all(results), ['a', 'b', 'c', 'd']);
  assert.equal(peak, 2, 'the limit held for the whole batch');
  assert.equal(queue.size, 0, 'bookkeeping returns to zero');
});

test('higher priority jumps the queue', async () => {
  const order = [];
  const queue = createImageWorkQueue({ getLimit: () => 1 });
  const blocker = gate('first');

  const running = queue.schedule('running', {}, 1, blocker.task);
  const low = queue.schedule('low', {}, 1, async () => order.push('low'));
  const high = queue.schedule('high', {}, 2, async () => order.push('high'));

  await flush();
  blocker.release();
  await Promise.all([running, low, high]);

  assert.deepEqual(order, ['high', 'low']);
});

test('the same key is one job, and its callers share the result', async () => {
  let runs = 0;
  const queue = createImageWorkQueue({ getLimit: () => 4 });
  const task = async () => {
    runs += 1;
    return 'once';
  };

  const owner = {};
  const first = queue.schedule('same', owner, 1, task);
  const second = queue.schedule('same', owner, 2, task);
  assert.equal(first, second, 'the same pending promise is handed back');
  assert.deepEqual(await Promise.all([first, second]), ['once', 'once']);
  assert.equal(runs, 1);
});

/*
 * The regression this queue exists for: a click and a prefetch on one
 * element are different work returning different shapes, so they must never
 * share a promise. Deduplicating by element handed the click the prefetch's
 * payload, which the caller then read as a failed outcome.
 */
test('different keys on one element stay separate jobs', async () => {
  const element = { id: 'img' };
  const queue = createImageWorkQueue({ getLimit: () => 4 });

  const prefetch = queue.schedule('prefetch::a', element, 1, async () => ({ prepared: true }));
  const click = queue.schedule('render::a', element, 2, async () => ({ status: 'rendered' }));

  assert.notEqual(prefetch, click);
  assert.deepEqual(await prefetch, { prepared: true });
  assert.deepEqual(await click, { status: 'rendered' });
});

test('the owner explicitly drops obsolete revisions before queueing a new one', async () => {
  const element = { id: 'img' };
  let staleRan = false;
  const queue = createImageWorkQueue({ getLimit: () => 1 });
  const blocker = gate('busy');

  const busy = queue.schedule('busy', {}, 1, blocker.task);
  const stale = queue.schedule('render::sourceA', element, 1, async () => {
    staleRan = true;
  });
  queue.drop(element);
  const fresh = queue.schedule('render::sourceB', element, 1, async () => 'B');

  assert.equal(await stale, null, 'the superseded entry resolves without running');

  blocker.release();
  await busy;
  assert.equal(await fresh, 'B');
  assert.equal(staleRan, false);
});

test('drop() clears queued work without touching what is running', async () => {
  const queue = createImageWorkQueue({ getLimit: () => 1 });
  const blocker = gate('running');
  let queuedRan = false;

  const running = queue.schedule('running', {}, 1, blocker.task);
  const queued = queue.schedule('queued', {}, 1, async () => {
    queuedRan = true;
  });

  await flush();
  queue.drop();
  assert.equal(await queued, null);
  assert.equal(queuedRan, false);

  blocker.release();
  assert.equal(await running, 'running', 'the running job was left alone');
});

test('drop(element) only clears that element', async () => {
  const keep = { id: 'keep' };
  const toss = { id: 'toss' };
  const queue = createImageWorkQueue({ getLimit: () => 1 });
  const blocker = gate('busy');

  const busy = queue.schedule('busy', {}, 1, blocker.task);
  const dropped = queue.schedule('dropped', toss, 1, async () => 'dropped');
  const kept = queue.schedule('kept', keep, 1, async () => 'kept');

  queue.drop(toss);
  assert.equal(await dropped, null);

  blocker.release();
  await busy;
  assert.equal(await kept, 'kept');
});

test('an entry that is no longer runnable resolves null instead of running', async () => {
  let ran = false;
  const queue = createImageWorkQueue({
    getLimit: () => 1,
    isRunnable: (entry) => entry.element.alive
  });

  const result = queue.schedule('gone', { alive: false }, 1, async () => {
    ran = true;
  });

  assert.equal(await result, null);
  assert.equal(ran, false);
  assert.equal(queue.size, 0);
});

test('a failing task rejects its own promise and the queue keeps draining', async () => {
  const queue = createImageWorkQueue({ getLimit: () => 1 });

  const failed = queue.schedule('bad', {}, 1, async () => {
    throw new Error('boom');
  });
  const next = queue.schedule('good', {}, 1, async () => 'fine');

  await assert.rejects(() => failed, /boom/);
  assert.equal(await next, 'fine', 'one failure does not wedge the pump');

  /* Bookkeeping is released in a finally, so it settles a turn later. */
  await flush();
  assert.equal(queue.size, 0);
});

test('a limit that grows mid-flight is picked up on the next pump', async () => {
  let limit = 1;
  const queue = createImageWorkQueue({ getLimit: () => limit });
  const first = gate('first');

  const running = queue.schedule('a', {}, 1, first.task);
  const second = queue.schedule('b', {}, 1, async () => 'b');
  const third = queue.schedule('c', {}, 1, async () => 'c');

  await flush();
  assert.equal(queue.running, 1);

  limit = 3;
  first.release();
  assert.deepEqual(await Promise.all([running, second, third]), ['first', 'b', 'c']);
});
