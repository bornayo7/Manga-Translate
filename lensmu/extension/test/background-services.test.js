import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestRegistry } from '../background/requests.js';
import { createPreparationPipeline } from '../background/preparation.js';
import { createOcrService } from '../ocr/providers.js';
import { createPageSessions } from '../background/pages.js';
import { createOffscreenOcr } from '../background/offscreen.js';
import { createRecognitionSession } from '../offscreen/recognition-session.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const block = { text: 'こんにちは', bbox: { x: 0, y: 0, width: 100, height: 40 }, confidence: 0.9 };
const settings = { sourceLanguage: 'ja', targetLanguage: 'en', preparationRevision: 'p1', translationProvider: 'custom' };

test('one trusted snapshot owns OCR and translation and ignores page provider overrides', async () => {
  const observations = [];
  const prepare = createPreparationPipeline({ loadSettings: async () => settings,
    recognize: async (_image, snapshot) => { observations.push(snapshot); return { blocks: [block], source_lang: 'ja', warnings: ['One region used detector text.'] }; },
    translate: async (texts, source, target, snapshot) => {
      observations.push(snapshot); assert.deepEqual(texts, ['こんにちは']); assert.equal(source, 'ja'); assert.equal(target, 'en');
      return { translations: ['Hello'], outcomes: [{ status: 'translated' }], provider: 'custom' };
    } });
  const result = await prepare({ imageBase64: 'fixture', preparationRevision: 'p1', targetLang: 'fr', settings: { customApiKey: 'untrusted' } });
  assert.equal(observations[0], observations[1]);
  assert.equal(result.targetLanguage, 'en');
  assert.equal(result.mergedOcrResults.length, 1);
  assert.equal(result.warnings.length, 1);
});

test('a settings change during OCR prevents translation and stale completion', async () => {
  let current = settings, translated = false;
  const prepare = createPreparationPipeline({ loadSettings: async () => current,
    recognize: async () => { current = { ...settings, preparationRevision: 'p2' }; return { blocks: [block] }; },
    translate: async () => { translated = true; } });
  await assert.rejects(prepare({ imageBase64: 'fixture', preparationRevision: 'p1' }), { name: 'AbortError' });
  assert.equal(translated, false);
});

test('visual settings changes preserve current preparation and multi-box grouping works without DOM', async () => {
  let current = settings;
  const prepare = createPreparationPipeline({ loadSettings: async () => current,
    recognize: async () => { current = { ...settings, overlayOpacity: 0.5 }; return { blocks: [block, { ...block, bbox: { ...block.bbox, y: 400 } }] }; },
    translate: async texts => ({ translations: texts.map(() => 'Hello'), outcomes: texts.map(() => ({ status: 'translated' })) }) });
  const result = await prepare({ imageBase64: 'fixture', preparationRevision: 'p1' });
  assert.equal(result.mergedOcrResults.length, 2);
});

test('document-scoped cancellation cannot cancel a different frame with the same request id', async () => {
  const registry = createRequestRegistry(), gate = deferred();
  const one = { tab: { id: 1 }, documentId: 'one' }, two = { tab: { id: 1 }, documentId: 'two' };
  const a = registry.run(one, 'same', async () => gate.promise);
  const b = registry.run(two, 'same', async () => gate.promise);
  assert.equal(registry.cancel(one, ['same']), 1);
  gate.resolve('ready');
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(await b, 'ready');
});

test('obsolete completion cannot retire the replacement request', async () => {
  const registry = createRequestRegistry(), a = deferred(), b = deferred(), sender = { tab: { id: 7 } };
  const old = registry.run(sender, 'image', () => a.promise);
  const fresh = registry.run(sender, 'image', () => b.promise);
  a.resolve(); await assert.rejects(old, { name: 'AbortError' });
  assert.equal(registry.cancel(sender, ['image']), 1);
  b.resolve(); await assert.rejects(fresh, { name: 'AbortError' });
});

test('malformed backend success is rejected by the actual OCR service', async () => {
  const recognize = createOcrService({ post: async () => null });
  await assert.rejects(recognize('fixture', { ocrEngine: 'paddleocr' }), /invalid detection/);
});

test('Manga failures are surfaced while a surviving batch preserves indexed results and warnings', async () => {
  const detections = Array.from({ length: 201 }, (_, i) => ({ text: `source ${i}`, bbox: [0, i * 10, 10, i * 10 + 5] }));
  let batch = 0;
  const recognize = createOcrService({ post: async url => {
    if (url.endsWith('/paddle')) return { detections };
    if (++batch === 1) throw new Error('first batch failed');
    return { detections: [{ text: 'recognized', bbox: detections[200].bbox }] };
  } });
  const result = await recognize('fixture', { ocrEngine: 'mangaocr', sourceLanguage: 'ja' });
  assert.equal(result.blocks.length, 201);
  assert.equal(result.blocks[200].text, 'recognized');
  assert.equal(result.engineStats.fellBack, 200);
  assert.ok(result.warnings.some(warning => warning.includes('200 regions')));
});

test('all Manga batches failing is a failed request and wrong language is rejected before upload', async () => {
  let calls = 0;
  const recognize = createOcrService({ post: async url => {
    calls++; if (url.endsWith('/manga')) throw new Error('model failed');
    return { detections: [{ text: 'source', bbox: [0, 0, 10, 10] }] };
  } });
  await assert.rejects(recognize('fixture', { ocrEngine: 'mangaocr', sourceLanguage: 'fr' }), /reads Japanese/);
  assert.equal(calls, 0);
  await assert.rejects(recognize('fixture', { ocrEngine: 'mangaocr', sourceLanguage: 'ja' }), /model failed/);
});

test('a fresh service-worker page session reads actual live page state', async () => {
  const browser = { tabs: { sendMessage: async (_id, message) => {
    assert.equal(message.action, 'GET_PAGE_STATE'); return { active: true, imageCount: 2, translatedCount: 1 };
  } } };
  assert.equal((await createPageSessions(browser, {}).get(8)).active, true);
});

test('navigation retires a delayed activation before it changes domain preference', async () => {
  const gate = deferred(); let domainWrites = 0;
  const browser = { tabs: { get: async () => ({ url: 'https://example.test' }), sendMessage: async (_id, message) => {
    if (message.action === 'GET_PAGE_STATE') return { active: false };
    return gate.promise;
  } }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } };
  const pages = createPageSessions(browser, { load: async () => settings, setDomainDisabled: async () => { domainWrites++; } });
  const pending = pages.toggle(1);
  await new Promise(resolve => setImmediate(resolve));
  await pages.navigate(1); gate.resolve({ success: true });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(domainWrites, 0);
});

test('offscreen recognition and idle close serialize and reuse a document after worker recreation', async () => {
  const gate = deferred(); let exists = true, closes = 0, running = false;
  const browser = { runtime: { getURL: path => `extension://${path}`, getContexts: async () => exists ? [{}] : [],
    sendMessage: async message => {
      if (message.action === 'TESSERACT_STATUS') return { idle: !running };
      running = true; await gate.promise; running = false; return { ok: true, body: { blocks: [] } };
    } }, offscreen: { createDocument: async () => { exists = true; }, closeDocument: async () => { closes++; exists = false; } } };
  const service = createOffscreenOcr(browser);
  const work = service.recognize('fixture', 'en');
  const close = service.closeIfIdle();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 0);
  gate.resolve(); await work; assert.equal(await close, true); assert.equal(closes, 1);
});

test('offscreen idle cleanup waits for accepted recognition and tears down before notifying', async () => {
  const gate = deferred(); let timer, terminated = 0, notified = 0;
  const session = createRecognitionSession({ recognize: () => gate.promise,
    terminate: async () => { terminated++; }, notifyIdle: async () => { assert.equal(terminated, 1); notified++; },
    schedule: callback => { timer = callback; return 1; }, unschedule: () => {} });
  const work = session.recognize('fixture', 'en'); timer();
  assert.equal(terminated, 0); gate.resolve([]); await work;
  await new Promise(resolve => setImmediate(resolve));
  timer(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.status().idle, true); assert.equal(notified, 1);
});

test('offscreen idle notification cannot deadlock recognition accepted before the worker receives it', async () => {
  const notification = deferred(); let idleTimer, documentExists = true, recognitionCalls = 0, closes = 0;
  let service;
  const session = createRecognitionSession({ recognize: async () => { recognitionCalls++; return []; },
    terminate: async () => {}, notifyIdle: async () => { await notification.promise; return service.closeIfIdle(); },
    schedule: callback => { idleTimer = callback; return 1; }, unschedule: () => {} });
  const browser = { runtime: { getURL: path => `extension://${path}`, getContexts: async () => documentExists ? [{}] : [],
    sendMessage: async message => message.action === 'TESSERACT_STATUS' ? session.status() :
      { ok: true, body: { blocks: await session.recognize('image', 'en') } } },
    offscreen: { createDocument: async () => { documentExists = true; }, closeDocument: async () => { closes++; documentExists = false; } } };
  service = createOffscreenOcr(browser);
  idleTimer();
  await new Promise(resolve => setImmediate(resolve));
  const work = service.recognize('image', 'en');
  notification.resolve();
  let deadline;
  try {
    await Promise.race([work, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('cross-owner deadlock')), 500); })]);
  } finally { clearTimeout(deadline); }
  assert.equal(recognitionCalls, 1);
  assert.equal(closes, 0, 'new work disarms the old idle notification');
});
