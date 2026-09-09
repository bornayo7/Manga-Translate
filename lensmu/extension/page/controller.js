import { createImageWorkQueue } from '../shared/image-work-queue.js';
import { createPreparationCache } from '../shared/preparation-cache.js';
import { renderTranslation } from '../overlay.js';
import { createImageSession } from './image-session.js';
import { createPageTransport, createImageReader, createImagePreparation } from './image-preparation.js';
import { createImageDiscovery, readImageSource } from './discovery.js';
import { createOverlaySession } from './overlay-session.js';
import { createReadAloud } from './read-aloud.js';

// The only page-lifetime registry: each value owns all state for its target.
export function createPageController(environment) {
  const { document, window, chrome, crypto } = environment;
  const sessions = new Map();
  let active = false;
  let settings = {};
  let generation = 0;
  const send = createPageTransport(chrome);
  const reader = createImageReader({ ...environment, send });
  const cache = createPreparationCache();
  const prepare = createImagePreparation({ reader, send, cache, crypto });
  const speech = createReadAloud({ ...environment, send });
  const queue = createImageWorkQueue({
    getLimit: () => Math.max(1, Math.min(12, Number(settings.maxConcurrentImages) || 5)),
    isRunnable: ({ element }) => active && element.isConnected
  });
  const viewEnvironment = { ...environment, reader, speech, paint: environment.paint || renderTranslation };

  function reconcile(sources) {
    if (!active) return;
    const found = new Set(sources.map(({ element }) => element));
    for (const [element, session] of sessions) {
      if (!found.has(element) || !session.attached) { session.dispose(); sessions.delete(element); }
    }
    for (const source of sources) {
      const target = source.element;
      let session = sessions.get(target);
      if (!session) {
        const view = createOverlaySession(target, viewEnvironment, {
          translate: () => session.request('render'),
          resize: () => session?.redraw(),
          translateAll: () => api.translateAll()
        });
        session = createImageSession({ target, queue, prepare, view, settings,
          readSource: () => readImageSource(target, window) });
        sessions.set(target, session);
      }
      void session.update(settings);
      if (settings.prefetchTranslations) void session.request('prefetch');
    }
  }

  const discovery = createImageDiscovery({ ...environment, reconcile });
  const resize = () => {
    if (active) for (const session of sessions.values()) void session.redraw();
  };
  const api = {
    activate(nextSettings = {}) {
      settings = { ...nextSettings };
      if (active) return api.updateSettings(settings);
      active = true;
      generation += 1;
      try {
        discovery.start(settings);
        window.addEventListener?.('resize', resize);
      } catch (error) { api.deactivate(); throw error; }
      return { success: true };
    },
    deactivate() {
      active = false;
      generation += 1;
      discovery.stop();
      window.removeEventListener?.('resize', resize);
      speech.stop();
      for (const session of sessions.values()) session.dispose();
      sessions.clear();
      queue.drop();
      cache.clear();
      return { success: true };
    },
    async updateSettings(nextSettings) {
      settings = { ...nextSettings };
      speech.stop();
      if (!active) return { success: true };
      const work = [...sessions.values()].map((session) => session.update(settings));
      discovery.update(settings);
      await Promise.all(work);
      return { success: true };
    },
    async translateAll() {
      if (!active) api.activate(settings);
      discovery.refresh();
      const batchGeneration = generation;
      const batch = [...sessions.values()];
      let completed = 0;
      const progress = () => {
        if (active && generation === batchGeneration) {
          void send('UPDATE_PROGRESS', { total: batch.length, completed }).catch(() => {});
        }
      };
      progress();
      const outcomes = await Promise.all(batch.map(async (session) => {
        const result = await session.request('render');
        completed += 1;
        progress();
        return result;
      }));
      return { success: true, outcomes };
    },
    getState() {
      return { active, imageCount: sessions.size,
        translatedCount: [...sessions.values()].filter((session) => session.outcome.status === 'rendered').length,
        pendingCount: queue.size };
    }
  };
  return api;
}
