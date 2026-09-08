// Settings persistence for the popup.
//
// Two rules, both learned the hard way:
//
//   1. A resolved SAVE_SETTINGS message is not a saved setting. The
//      background answers { success: false, error } when storage refuses
//      the write, and a transport failure resolves to undefined in some
//      paths. Only { success: true } counts; anything else is an error the
//      caller must show and must not build on (no translating with settings
//      that were never stored, no closing the popup as if they were).
//
//   2. Do not debounce with a timer. The popup is a document Chrome tears
//      down the instant it loses focus; a pending 180 ms timer simply never
//      fires, so the last change is lost. Changes are sent as small patches
//      merged within the current task (a microtask flush), which completes
//      before the document can unload. The background merges patches into
//      the stored object and serialises the writes, so rapid changes land in
//      order and a full snapshot never overwrites a newer patch.
//
// Pure module: the message transport is injected so it can be tested.

export function assertSaveSettingsResponse(response) {
  if (response === null || response === undefined) {
    throw new Error('The extension did not answer the save request.');
  }
  if (typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('The extension answered the save request with an unexpected value.');
  }
  if (response.success !== true) {
    const detail = typeof response.error === 'string' && response.error.trim()
      ? response.error.trim()
      : 'Settings could not be saved.';
    throw new Error(detail);
  }
  return response;
}

export function createSettingsPersister({ sendMessage, onError = () => {}, onSaved = () => {} }) {
  if (typeof sendMessage !== 'function') {
    throw new TypeError('createSettingsPersister needs a sendMessage function.');
  }

  let pendingPatch = null;
  let flushScheduled = false;
  let chain = Promise.resolve();
  let lastError = null;
  let saveCount = 0;

  function send(patch) {
    const run = chain
      .then(() => sendMessage({ action: 'SAVE_SETTINGS', payload: { settings: patch } }))
      .then(assertSaveSettingsResponse)
      .then((response) => {
        lastError = null;
        saveCount += 1;
        onSaved(response, patch);
        return response;
      });
    chain = run.catch((error) => {
      lastError = error;
      onError(error, patch);
    });
    return run;
  }

  function flush() {
    flushScheduled = false;
    const patch = pendingPatch;
    pendingPatch = null;
    if (!patch) {
      return chain;
    }
    return send(patch);
  }

  return {
    /*
     * Records a change; every patch queued in the same task is merged and
     * sent as one message at the end of that task.
     */
    queuePatch(patch) {
      if (!patch || typeof patch !== 'object') {
        return;
      }
      pendingPatch = { ...(pendingPatch || {}), ...patch };
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => {
          flush().catch(() => undefined);
        });
      }
    },

    /*
     * Sends everything pending plus `settings` now and resolves only when
     * the background confirmed the write. Rejects otherwise.
     */
    saveNow(settings = {}) {
      pendingPatch = { ...(pendingPatch || {}), ...settings };
      flushScheduled = false;
      return flush();
    },

    /*
     * Resolves once every queued save has been answered (success or not).
     * A patch queued in this same task has not been flushed yet, so flush
     * it first; otherwise the caller would observe the state before the
     * latest change was even sent.
     */
    async whenIdle() {
      if (pendingPatch) {
        await flush().catch(() => undefined);
      }
      await chain;
    },

    get lastError() {
      return lastError;
    },

    get saveCount() {
      return saveCount;
    },

    get hasPending() {
      return pendingPatch !== null;
    }
  };
}
