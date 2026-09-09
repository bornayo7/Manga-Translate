// One DOM occurrence owns one revision at a time. Preparation sharing is a
// different responsibility: prepare() may share pixels, but view never does.
export function preparationSettingsKey(settings = {}) {
  const keys = ['preparationRevision', 'ocrEngine', 'translationProvider', 'allowThirdPartyFallback',
    'sourceLanguage', 'targetLanguage', 'backendUrl', 'customOcrUrl', 'customBaseUrl',
    'customModelName', 'llmModel'];
  return JSON.stringify(keys.map((key) => settings[key] ?? null));
}

export function createImageSession({ target, queue, prepare, view, readSource, settings: initialSettings }) {
  let settings = initialSettings;
  let source = readSource();
  let sequence = 0;
  let current = null;
  let disposed = false;
  let outcome = { status: 'idle' };

  function retire(clearDisplay) {
    sequence += 1;
    current?.controller.abort();
    current = null;
    queue.drop(target);
    if (clearDisplay) {
      view.clear();
      outcome = { status: 'idle' };
      view.status(outcome);
    }
  }

  function accepts(job) {
    return !disposed && current === job && !job.controller.signal.aborted &&
      view.connected() && source.key === readSource().key;
  }

  async function execute(job) {
    const cancelled = { status: 'cancelled' };
    try {
      if (!accepts(job)) return cancelled;
      const result = await prepare(job.source, job.settings, job.controller.signal);
      if (!accepts(job)) return cancelled;
      // Only the bounded cache retains image bytes. A target's outcome and
      // settled queue promise must not pin a second, unbounded copy.
      let next = result.status === 'prepared' ? { status: 'prepared' } : result;
      if (result.status === 'prepared' && job.render) {
        next = await view.render(result.prepared, {
          signal: job.controller.signal,
          accepts: () => accepts(job),
          preserveVisibility: job.preserveVisibility
        });
      }
      if (!accepts(job)) return cancelled;
      outcome = next;
      if (job.render) view.status(next);
      return next;
    } catch (error) {
      if (!accepts(job) || error?.name === 'AbortError') return cancelled;
      outcome = { status: 'failed', reason: 'translation-failed', message: error?.message || String(error) };
      if (job.render) view.status(outcome);
      return outcome;
    } finally {
      job.done = true;
    }
  }

  function request(mode = 'render', { redraw = false } = {}) {
    if (disposed || !target.isConnected) return Promise.resolve({ status: 'cancelled' });
    const live = readSource();
    if (live.key !== source.key || (live.type === 'canvas' && mode === 'render' && current?.done && !redraw)) {
      source = live;
      retire(true);
    }
    if (current && !current.done) {
      if (mode === 'render') {
        current.render = true;
        view.status({ status: 'working' });
      }
      return queue.schedule(current.id, target, current.render ? 2 : 1, () => execute(current))
        .then((result) => result || { status: 'cancelled' });
    }
    if (!redraw && outcome.status === 'rendered') {
      if (mode === 'render') view.reveal();
      return Promise.resolve(outcome);
    }
    retire(false);
    const job = {
      id: sequence,
      controller: new AbortController(),
      source: { ...source },
      settings: { ...settings },
      render: mode === 'render',
      preserveVisibility: redraw,
      done: false
    };
    current = job;
    if (job.render && !redraw) view.status({ status: 'working' });
    return queue.schedule(job.id, target, job.render ? 2 : 1, () => execute(job))
      .then((result) => result || { status: 'cancelled' });
  }

  return {
    request,
    update(nextSettings) {
      if (disposed) return Promise.resolve({ status: 'cancelled' });
      const nextSource = readSource();
      const changed = nextSource.key !== source.key ||
        preparationSettingsKey(settings) !== preparationSettingsKey(nextSettings);
      const visualChanged = ['overlayFontFamily', 'overlayMinFontSize', 'overlayTextAlign', 'showConfidenceBorders']
        .some((key) => settings[key] !== nextSettings[key]);
      settings = nextSettings;
      source = nextSource;
      view.settings(settings);
      if (changed) retire(true);
      else if (visualChanged && (outcome.status === 'rendered' || current?.render)) {
        retire(false);
        return request('render', { redraw: true });
      }
      return Promise.resolve(outcome);
    },
    redraw() {
      if (outcome.status !== 'rendered') return Promise.resolve(outcome);
      retire(false);
      return request('render', { redraw: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retire(false);
      view.dispose();
    },
    get outcome() { return outcome; },
    get attached() { return view.connected(); },
    get pending() { return Boolean(current && !current.done); }
  };
}
