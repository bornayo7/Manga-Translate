// Requests are scoped to a sending document. One frame cannot cancel another
// frame's work, and an obsolete completion cannot retire its successor.
export function createRequestRegistry() {
  const active = new Map();
  const scope = sender => `${sender?.tab?.id ?? 'extension'}:${sender?.documentId ?? sender?.frameId ?? 0}`;
  const key = (sender, id) => `${scope(sender)}:${id}`;
  const cancel = (entry, message) => entry.controller.abort(new DOMException(message, 'AbortError'));
  return {
    async run(sender, requestId, work) {
      const id = key(sender, requestId || crypto.randomUUID());
      if (active.has(id)) cancel(active.get(id), 'Request superseded.');
      const entry = { controller: new AbortController(), tabId: sender?.tab?.id };
      active.set(id, entry);
      try {
        const result = await work(entry.controller.signal);
        entry.controller.signal.throwIfAborted();
        return result;
      } finally {
        if (active.get(id) === entry) active.delete(id);
      }
    },
    cancel(sender, requestIds) {
      let cancelled = 0;
      for (const id of Array.isArray(requestIds) ? requestIds : []) {
        const entry = active.get(key(sender, id));
        if (entry) { cancel(entry, 'Request cancelled.'); active.delete(key(sender, id)); cancelled++; }
      }
      return cancelled;
    },
    cancelTab(tabId) {
      for (const [id, entry] of active) if (entry.tabId === tabId) {
        cancel(entry, 'Tab navigated or closed.'); active.delete(id);
      }
    }
  };
}
