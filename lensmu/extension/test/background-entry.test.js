import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the registered Chrome entry point, including the real persistence
// module, rather than evaluating private functions from the worker source.
test('worker registers synchronously, protects settings and acknowledges durable writes independently of page broadcasts', async () => {
  const listeners = {};
  const listen = name => ({ addListener(callback) { listeners[name] = callback; } });
  const values = {};
  let failWrite = false, accessLevel;
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://fixture/${path}`, onMessage: listen('message'), onInstalled: listen('installed') },
    identity: { getRedirectURL: () => 'https://fixture.chromiumapp.org/' },
    commands: { onCommand: listen('command') },
    tabs: { onRemoved: listen('removed'), onUpdated: listen('updated'), query: async () => [] },
    storage: { local: {
      setAccessLevel: async value => { accessLevel = value; },
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]])),
      set: async patch => { if (failWrite) throw new Error('disk full'); Object.assign(values, structuredClone(patch)); },
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
    } }
  };
  try {
    await import('../background.js');
    assert.deepEqual(Object.keys(listeners).sort(), ['command', 'installed', 'message', 'removed', 'updated']);
    assert.equal(accessLevel.accessLevel, 'TRUSTED_CONTEXTS');
    const page = { tab: { id: 7 }, documentId: 'page', url: 'https://example.test/' };
    const popup = { url: 'chrome-extension://fixture/dist/popup/index.html', tab: { id: 9 } };
    const request = (action, payload, sender = popup) => new Promise(resolve => {
      assert.equal(listeners.message({ action, payload }, sender, resolve), true);
    });
    const saved = await request('SAVE_SETTINGS', { settings: { openaiApiKey: 'local-fixture-key', targetLanguage: 'fr' } });
    assert.equal(saved.success, true);
    assert.equal(saved.settings.targetLanguage, 'fr');
    assert.equal((await request('GET_SETTINGS', {}, page)).settings.openaiApiKey, undefined);
    assert.equal((await request('GET_SETTINGS', {})).settings.openaiApiKey, 'local-fixture-key');
    assert.equal((await request('SAVE_SETTINGS', { settings: { targetLanguage: 'de' } }, page)).success, false);
    failWrite = true;
    assert.equal((await request('SAVE_SETTINGS', { settings: { targetLanguage: 'de' } })).success, false);
    failWrite = false;
    assert.equal((await request('GET_SETTINGS', {})).settings.targetLanguage, 'fr');
    assert.equal((await request('AUTH_LOGIN', {}, page)).success, false);
    assert.equal(listeners.message({ target: 'offscreen-tesseract' }, popup, () => assert.fail('offscreen response intercepted')), false);
  } finally { globalThis.chrome = previous; }
});
