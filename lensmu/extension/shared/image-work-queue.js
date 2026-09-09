// Capacity belongs to executing tasks until they settle, even after disposal.
// Identity is (owner, revision). Priority may increase but never decreases.
export function createImageWorkQueue({ getLimit, isRunnable = () => true }) {
  if (typeof getLimit !== 'function') throw new TypeError('A getLimit function is required.');
  const owners = new Map();
  const pending = [];
  let running = 0;

  function forget(entry) {
    const entries = owners.get(entry.element);
    if (entries?.get(entry.key) === entry) entries.delete(entry.key);
    if (!entries?.size) owners.delete(entry.element);
  }

  function pump() {
    pending.sort((a, b) => b.priority - a.priority);
    while (running < getLimit() && pending.length) {
      const entry = pending.shift();
      if (!isRunnable(entry)) {
        forget(entry);
        entry.resolve(null);
        continue;
      }
      entry.started = true;
      running += 1;
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
        running -= 1;
        forget(entry);
        pump();
      });
    }
  }

  return {
    schedule(key, element, priority, task) {
      const entries = owners.get(element) || new Map();
      const existing = entries.get(key);
      if (existing) {
        existing.priority = Math.max(existing.priority, priority);
        pump();
        return existing.promise;
      }
      const entry = { key, element, priority, task, started: false };
      entry.promise = new Promise((resolve, reject) => Object.assign(entry, { resolve, reject }));
      entries.set(key, entry);
      owners.set(element, entries);
      pending.push(entry);
      pump();
      return entry.promise;
    },
    drop(element = null) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const entry = pending[index];
        if (element !== null && entry.element !== element) continue;
        pending.splice(index, 1);
        forget(entry);
        entry.resolve(null);
      }
    },
    get size() { return [...owners.values()].reduce((n, entries) => n + entries.size, 0); },
    get running() { return running; },
    get queued() { return pending.length; }
  };
}
