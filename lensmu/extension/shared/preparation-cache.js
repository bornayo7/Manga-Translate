// Share successful preparation by content/settings, never DOM target.
// Consumer cancellation does not release its queue permit before OCR settles.
export function createPreparationCache({ maxEntries = 24, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let retainedBytes = 0;
  const abortError = () => new DOMException('Preparation cancelled.', 'AbortError');
  function remove(key, entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    retainedBytes -= entry.bytes || 0;
  }
  function trim() {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && retainedBytes <= maxBytes) break;
      if (entry.done) remove(key, entry);
    }
  }
  return {
    async acquire(key, producer, signal) {
      if (signal?.aborted) throw abortError();
      let entry = entries.get(key);
      if (entry?.controller.signal.aborted) {
        remove(key, entry);
        entry = null;
      }
      if (!entry) {
        entry = { controller: new AbortController(), consumers: 0, done: false, bytes: 0 };
        entries.set(key, entry);
        entry.promise = Promise.resolve().then(() => producer(entry.controller.signal)).then((result) => {
          entry.done = true;
          if (entry.controller.signal.aborted || result.status !== 'prepared') {
            remove(key, entry);
          } else if (entries.get(key) === entry) {
            entry.bytes = JSON.stringify(result).length * 2;
            retainedBytes += entry.bytes;
            trim();
          }
          return result;
        }, (error) => {
          entry.done = true;
          remove(key, entry);
          throw error;
        });
      } else {
        entries.delete(key);
        entries.set(key, entry);
      }
      entry.consumers += 1;
      let attached = true;
      const detach = () => {
        if (!attached) return;
        attached = false;
        entry.consumers -= 1;
        if (!entry.consumers && !entry.done) {
          entry.controller.abort();
          remove(key, entry);
        }
      };
      signal?.addEventListener('abort', detach, { once: true });
      try {
        const result = await entry.promise;
        if (signal?.aborted || entry.controller.signal.aborted) throw abortError();
        return result;
      } finally {
        signal?.removeEventListener('abort', detach);
        detach();
      }
    },
    clear() {
      for (const [key, entry] of entries) {
        if (!entry.done) entry.controller.abort();
        remove(key, entry);
      }
    },
    get size() { return entries.size; },
    get bytes() { return retainedBytes; }
  };
}
