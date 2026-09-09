// The background owns durable write ordering. Transfer edits promptly and retain
// field revisions until acknowledged; unrelated saves must not hide failures.
export function assertSaveSettingsResponse(response) {
  if (response == null) throw new Error('The extension did not answer the save request.');
  if (typeof response !== 'object' || Array.isArray(response)) throw new Error('The extension answered the save request with an unexpected value.');
  if (response.success !== true) throw new Error(typeof response.error === 'string' && response.error.trim() ? response.error.trim() : 'Settings could not be saved.');
  return response;
}

export function createSettingsPersister({ sendMessage, onError = () => {}, onSaved = () => {} }) {
  if (typeof sendMessage !== 'function') throw new TypeError('A message transport is required.');
  const dirty = new Map();
  const inFlight = new Set();
  const listeners = new Set();
  let scheduled = false;
  let revision = 0;
  let saveCount = 0;
  const currentError = () => [...dirty.values()].find((entry) => entry.error)?.error ?? null;
  const state = () => ({ revision, status: currentError() ? 'error' : dirty.size ? 'saving' : 'saved', error: currentError(), pendingKeys: [...dirty.keys()] });
  const notify = () => { for (const listener of listeners) listener(state()); };

  function dispatch(entries) {
    if (!entries.length) return;
    const patch = Object.fromEntries(entries.map(([key, entry]) => [key, entry.value]));
    for (const [, entry] of entries) entry.error = null;
    // Invoke now: a response from another save must never delay transfer to the
    // background, because this document can disappear at the end of any task.
    let response;
    try { response = sendMessage({ action: 'SAVE_SETTINGS', payload: { settings: patch } }); }
    catch (error) { response = Promise.reject(error); }
    const request = Promise.resolve(response).then(assertSaveSettingsResponse).then((answer) => {
      for (const [key, entry] of entries) if (dirty.get(key) === entry) dirty.delete(key);
      saveCount += 1;
      onSaved(answer, patch);
      return answer;
    }).catch((error) => {
      for (const [key, entry] of entries) if (dirty.get(key) === entry) entry.error = error;
      onError(error, patch);
      throw error;
    }).finally(() => {
      inFlight.delete(request);
      for (const [, entry] of entries) if (entry.request === request) entry.request = null;
      notify();
    });
    for (const [, entry] of entries) entry.request = request;
    inFlight.add(request);
    request.catch(() => undefined);
    notify();
  }
  function flush() {
    scheduled = false;
    dispatch([...dirty].filter(([, entry]) => !entry.request && !entry.error));
  }
  function queuePatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) return revision;
    revision += 1;
    for (const [key, value] of Object.entries(patch)) dirty.set(key, { value, revision, request: null, error: null });
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    notify();
    return revision;
  }
  return {
    queuePatch,
    async saveNow(patch) {
      queuePatch(patch);
      // Explicitly retry already failed fields. New failures reject the action.
      for (const entry of dirty.values()) if (!entry.request) entry.error = null;
      flush();
      const required = [...dirty.values()];
      const answers = await Promise.all([...new Set(required.map((entry) => entry.request).filter(Boolean))]);
      const error = required.find((entry) => entry.error)?.error;
      if (error) throw error;
      return answers.at(-1) ?? { success: true };
    },
    async whenIdle() { if (scheduled) flush(); while (inFlight.size) await Promise.allSettled([...inFlight]); },
    subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    get state() { return state(); },
    get lastError() { return currentError(); },
    get hasPending() { return dirty.size > 0 || inFlight.size > 0; },
    get saveCount() { return saveCount; },
  };
}
