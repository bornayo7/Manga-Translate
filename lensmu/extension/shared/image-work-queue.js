// One work queue for every per-image job on a page.
//
// "Translate All", a click on a single icon and the observer-triggered
// prefetch used to run their own pools, so the configured parallel-image
// limit was per caller rather than per page. They all go through one queue
// here instead.
//
// IDENTITY. Work is deduplicated by a caller-supplied `key`, never by the
// element alone. The unit of work is (element, source, mode): an element
// whose src was swapped, and the same element queued for a different mode,
// are different jobs that must not share a result. Deduplicating by element
// handed a click the promise of an in-flight prefetch — a different task
// returning a different shape — so the click read a prepared-payload as an
// outcome and reported a successful translation as a failure.
//
// A queued (not yet started) entry for the same element under a *different*
// key is stale by definition and is dropped when the new one arrives.
//
// Nothing here touches the DOM or the extension: `getLimit` and
// `isRunnable` are injected, so this runs unchanged in tests.

export function createImageWorkQueue({ getLimit, isRunnable = () => true }) {
  if (typeof getLimit !== 'function') {
    throw new TypeError('createImageWorkQueue needs a getLimit function.');
  }

  /* Sorted by descending priority; equal priorities keep insertion order. */
  const queue = [];
  const byKey = new Map();
  let running = 0;

  function enqueue(entry) {
    let index = queue.length;
    while (index > 0 && queue[index - 1].priority < entry.priority) {
      index -= 1;
    }
    queue.splice(index, 0, entry);
  }

  function removeQueued(predicate) {
    for (let index = queue.length - 1; index >= 0; index--) {
      const entry = queue[index];
      if (!predicate(entry)) {
        continue;
      }
      queue.splice(index, 1);
      byKey.delete(entry.key);
      entry.resolve(null);
    }
  }

  function pump() {
    while (running < getLimit() && queue.length > 0) {
      const entry = queue.shift();

      if (!isRunnable(entry)) {
        byKey.delete(entry.key);
        entry.resolve(null);
        continue;
      }

      entry.started = true;
      running += 1;
      Promise.resolve()
        .then(() => entry.task())
        .then(entry.resolve, entry.reject)
        .finally(() => {
          running -= 1;
          if (byKey.get(entry.key) === entry) {
            byKey.delete(entry.key);
          }
          pump();
        });
    }
  }

  return {
    /*
     * Queues `task` under `key`. A pending entry with the same key is
     * reused (raising its priority if this caller wants it sooner); a
     * queued entry for the same element under a different key is stale and
     * is dropped in favour of this one.
     */
    schedule(key, element, priority, task) {
      const existing = byKey.get(key);
      if (existing) {
        /*
         * Same key, same work: hand back the pending result. Priority is a
         * function of the mode, and the mode is part of the key, so two
         * entries sharing a key can never disagree about priority — there
         * is nothing to re-rank here.
         */
        return existing.promise;
      }

      if (element) {
        removeQueued((entry) => entry.element === element && entry.key !== key);
      }

      const entry = { key, element, priority, task, started: false };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      byKey.set(key, entry);
      enqueue(entry);
      pump();
      return entry.promise;
    },

    /*
     * Drops queued work: everything when `element` is null, otherwise only
     * that element's entries. Work already running is stopped by its own
     * job's AbortController, not from here.
     */
    drop(element = null) {
      removeQueued((entry) => !element || entry.element === element);
    },

    /* Entries queued or running — the bookkeeping a cleanup must zero. */
    get size() {
      return byKey.size;
    },

    get running() {
      return running;
    },

    get queued() {
      return queue.length;
    }
  };
}
