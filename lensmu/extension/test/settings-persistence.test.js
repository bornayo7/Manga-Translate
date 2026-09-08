import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSaveSettingsResponse, createSettingsPersister } from '../src/popup/settings-persistence.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function backgroundDouble({ failWith = null, malformed = false, reject = false, delayMs = 0 } = {}) {
  const stored = { targetLanguage: 'en', overlayOpacity: 1 };
  const messages = [];
  let chain = Promise.resolve();
  const sendMessage = (message) => {
    messages.push(message);
    const run = chain.then(async () => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (reject) throw new Error('Could not establish connection.');
      if (malformed) return 'ok';
      if (failWith) return { success: false, error: failWith };
      Object.assign(stored, message.payload.settings);
      return { success: true, settings: { ...stored } };
    });
    chain = run.catch(() => undefined);
    return run;
  };
  return { stored, messages, sendMessage };
}

test('assertSaveSettingsResponse accepts only an explicit success', () => {
  assert.deepEqual(assertSaveSettingsResponse({ success: true }), { success: true });
  assert.throws(() => assertSaveSettingsResponse({ success: false, error: 'Storage unavailable' }), /Storage unavailable/);
  assert.throws(() => assertSaveSettingsResponse({ success: false }), /could not be saved/);
  assert.throws(() => assertSaveSettingsResponse(undefined), /did not answer/);
  assert.throws(() => assertSaveSettingsResponse(null), /did not answer/);
  assert.throws(() => assertSaveSettingsResponse('ok'), /unexpected value/);
  assert.throws(() => assertSaveSettingsResponse({}), /could not be saved/);
});

test('a change is sent before the current task ends, so closing the popup right after does not lose it', async () => {
  const background = backgroundDouble();
  const persister = createSettingsPersister({ sendMessage: background.sendMessage });

  persister.queuePatch({ targetLanguage: 'fr' });
  // Nothing dispatched synchronously...
  assert.equal(background.messages.length, 0);
  // ...but a microtask later (still before any timer, unload or next task) it is on the wire.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(background.messages.length, 1);
  assert.deepEqual(background.messages[0].payload.settings, { targetLanguage: 'fr' });
  await persister.whenIdle();
  assert.equal(background.stored.targetLanguage, 'fr');
});

test('rapid changes are merged per task, delivered in order, and the final value wins', async () => {
  const background = backgroundDouble({ delayMs: 2 });
  const persister = createSettingsPersister({ sendMessage: background.sendMessage });

  persister.queuePatch({ overlayOpacity: 0.2 });
  persister.queuePatch({ overlayOpacity: 0.4 });
  persister.queuePatch({ targetLanguage: 'de' });
  await tick();
  persister.queuePatch({ overlayOpacity: 0.9 });
  await tick();
  persister.queuePatch({ overlayOpacity: 0.7 });
  await persister.whenIdle();

  assert.equal(background.messages.length, 3, 'one message per task');
  assert.deepEqual(background.messages[0].payload.settings, { overlayOpacity: 0.4, targetLanguage: 'de' });
  assert.equal(background.stored.overlayOpacity, 0.7);
  assert.equal(background.stored.targetLanguage, 'de');
  assert.equal(persister.saveCount, 3);
});

test('opening and closing without edits writes nothing', async () => {
  const background = backgroundDouble();
  const persister = createSettingsPersister({ sendMessage: background.sendMessage });
  await persister.whenIdle();
  assert.equal(background.messages.length, 0);
  assert.equal(persister.hasPending, false);
});

test('{ success: false } from the background is surfaced and blocks the dependent action', async () => {
  const background = backgroundDouble({ failWith: 'Storage unavailable' });
  const errors = [];
  const persister = createSettingsPersister({ sendMessage: background.sendMessage, onError: (error) => errors.push(error) });

  await assert.rejects(() => persister.saveNow({ targetLanguage: 'ja' }), /Storage unavailable/);
  assert.equal(errors.length, 1);
  assert.match(persister.lastError.message, /Storage unavailable/);
  assert.equal(background.stored.targetLanguage, 'en', 'nothing was stored');
});

test('a transport rejection and a malformed answer are both failures, never silent success', async () => {
  const rejecting = createSettingsPersister({ sendMessage: backgroundDouble({ reject: true }).sendMessage });
  await assert.rejects(() => rejecting.saveNow({ targetLanguage: 'ja' }), /Could not establish connection/);

  const malformed = createSettingsPersister({ sendMessage: backgroundDouble({ malformed: true }).sendMessage });
  await assert.rejects(() => malformed.saveNow({ targetLanguage: 'ja' }), /unexpected value/);

  const silent = createSettingsPersister({ sendMessage: async () => undefined });
  await assert.rejects(() => silent.saveNow({ targetLanguage: 'ja' }), /did not answer/);
});

test('saveNow flushes pending patches first and confirms the combined write', async () => {
  const background = backgroundDouble();
  const persister = createSettingsPersister({ sendMessage: background.sendMessage });
  persister.queuePatch({ targetLanguage: 'es' });
  const response = await persister.saveNow({ overlayOpacity: 0.5 });
  assert.equal(response.success, true);
  assert.equal(background.messages.length, 1);
  assert.deepEqual(background.messages[0].payload.settings, { targetLanguage: 'es', overlayOpacity: 0.5 });
});
