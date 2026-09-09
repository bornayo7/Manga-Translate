import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudio, deferred, loadContentScript, ocrBlocks, prepared } from './helpers/content-harness.js';
const overlays = (h) => h.document.querySelectorAll('.vt-lensmu-canvas');
const preparations = (h) => h.sent.filter((m) => m.action === 'PREPARE_IMAGE');
const click = async (h, target) => { h.controlFor(target).icon.dispatch('click'); await h.idle(); };
const srcRecord = (target) => ({ type: 'attributes', target, attributeName: 'src' });
const childrenRecord = (h, addedNodes = [], removedNodes = []) => ({ type: 'childList', target: h.document.body, addedNodes, removedNodes });

test('identical contents share preparation but render separately per target', async () => {
  const h = await loadContentScript(); h.addImage(); h.addImage();
  await h.activate(); const result = await h.translateAll(); await h.idle();
  assert.equal(preparations(h).length, 1); assert.equal(overlays(h).length, 2);
  assert.equal(result.outcomes.filter((r) => r.status === 'rendered').length, 2);
  assert.equal((await h.state()).translatedCount, 2);
  assert.ok(overlays(h).every((c) => c.getContext('2d').calls.length > 0));
  await h.deactivate();
});

test('same-size canvases have separate content; changed pixels are translated again', async () => {
  const h = await loadContentScript();
  const a = h.document.createElement('canvas'), b = h.document.createElement('canvas');
  h.document.body.appendChild(a); h.document.body.appendChild(b);
  await h.activate(); await h.translateAll(); await h.idle();
  assert.equal(preparations(h).length, 2); assert.equal(overlays(h).length, 2);
  a.pixelRevision = 1; await click(h, a);
  assert.equal(preparations(h).length, 3); assert.equal(overlays(h).length, 2);
  await h.deactivate();
});

test('wrapped source changes invalidate without another click', async () => {
  const h = await loadContentScript(); const a = h.addImage();
  await h.activate(); await click(h, a);
  a.src = 'http://page.test/new.png'; h.observer().emit([srcRecord(a)]); await h.timers.advance(100);
  assert.equal(overlays(h).length, 0); assert.equal(h.controlFor(a).icon.dataset.vtState, 'idle');
  await click(h, a); assert.equal(preparations(h).length, 2); await h.deactivate();
});

test('all records in mixed addition/source/removal delivery are reconciled', async () => {
  const h = await loadContentScript(); const a = h.addImage(), b = h.addImage({ src: 'http://page.test/b.png' });
  await h.activate(); await h.translateAll(); await h.idle();
  const removed = a.parentElement; removed.remove(); b.src = 'http://page.test/changed.png';
  const c = h.addImage({ src: 'http://page.test/c.png' });
  h.observer().emit([childrenRecord(h, [c]), srcRecord(b), childrenRecord(h, [], [removed])]); await h.timers.advance(100);
  assert.equal((await h.state()).imageCount, 2); assert.equal(a.dataset.vtIconAdded, undefined);
  assert.equal(overlays(h).length, 0); await h.deactivate();
});

test('queued clicks survive subsequent prefetch and consume one preparation', async () => {
  const gate = deferred();
  const h = await loadContentScript({ settings: { maxConcurrentImages: 1, prefetchTranslations: true },
    messages: (m) => m.action === 'PREPARE_IMAGE' && m.payload.imageBase64.includes('a.png') ? gate.promise : undefined });
  h.addImage(); const b = h.addImage({ src: 'http://page.test/b.png' });
  await h.activate(); await h.waitFor(() => preparations(h).length === 1, 'active prefetch'); h.controlFor(b).icon.dispatch('click');
  const c = h.addImage({ src: 'http://page.test/c.png' }); h.observer().emit([childrenRecord(h, [c])]); await h.timers.advance(100);
  gate.resolve(prepared()); await h.idle();
  assert.equal(h.controlFor(b).icon.dataset.vtState, 'rendered'); assert.equal(overlays(h).length, 1);
  assert.equal(preparations(h).length, 3); await h.deactivate();
});

test('deactivation drops queued targets and suppresses obsolete completion', async () => {
  const gate = deferred();
  const h = await loadContentScript({ settings: { maxConcurrentImages: 1 }, messages: (m) => m.action === 'PREPARE_IMAGE' ? gate.promise : undefined });
  h.addImage(); h.addImage({ src: 'http://page.test/b.png' }); await h.activate();
  const batch = h.translateAll(); await h.waitFor(() => preparations(h).length === 1, 'first provider request');
  await h.deactivate(); gate.resolve(prepared()); await batch; await h.idle();
  assert.equal(preparations(h).length, 1); assert.equal(overlays(h).length, 0);
  assert.deepEqual(await h.state(), { active: false, imageCount: 0, translatedCount: 0, pendingCount: 0 });
  assert.ok(h.sent.some((m) => m.action === 'CANCEL_REQUESTS'));
});

test('settings retry creates a fresh revision while obsolete producer unwinds', async () => {
  const gate = deferred(); let calls = 0;
  const h = await loadContentScript({ hashDelayMs: 15, messages: (m) => m.action === 'PREPARE_IMAGE'
    ? (++calls === 1 ? gate.promise : prepared({ translations: ['Bonjour'], targetLanguage: 'fr' })) : undefined });
  const a = h.addImage(); await h.activate({ preparationRevision: 'one' }); h.controlFor(a).icon.dispatch('click');
  await h.waitFor(() => calls === 1, 'obsolete provider request to start');
  await h.update({ targetLanguage: 'fr', preparationRevision: 'two' }); h.controlFor(a).icon.dispatch('click');
  await h.waitFor(() => calls === 2, 'replacement provider request to start');
  gate.resolve(prepared()); await h.idle();
  assert.equal(calls, 2); assert.equal(h.controlFor(a).icon.dataset.vtState, 'rendered');
  assert.ok(overlays(h)[0].getContext('2d').calls.some((call) => call.text === 'Bonjour')); await h.deactivate();
});

test('visual redraw cannot recreate an overlay after deactivation', async () => {
  const gate = deferred(); let loads = 0;
  const h = await loadContentScript({ hashDelayMs: 15, imageLoads: () => ++loads === 2 ? gate.promise : undefined });
  const a = h.addImage(); await h.activate(); await click(h, a);
  const update = h.update({ overlayFontFamily: 'serif' }); await h.waitFor(() => loads === 2, 'redraw image decoding');
  await h.deactivate(); gate.resolve(); await update; await h.idle();
  assert.equal(overlays(h).length, 0); assert.equal((await h.state()).active, false);
});

test('deactivation wins over lazy initial activation and later activation works', async () => {
  const h = await loadContentScript(); h.addImage();
  const activation = h.activate(); await h.deactivate();
  assert.equal((await activation).cancelled, true); assert.equal(h.controls().length, 0);
  await h.activate(); assert.equal(h.controls().length, 1); await h.deactivate();
});

test('late loads and recovered image loads are found and listeners released', async () => {
  const h = await loadContentScript(); const img = h.addImage({ naturalWidth: 0, naturalHeight: 0 });
  await h.activate(); assert.equal(h.controls().length, 0);
  img.dispatch('error'); img.naturalWidth = 300; img.naturalHeight = 200;
  img.src = 'http://page.test/retry.png'; img.dispatch('load'); await h.timers.advance(100);
  assert.equal(h.controls().length, 1); await h.deactivate();
  assert.equal(img.listenerCount('load'), 0); assert.equal(img.listenerCount('error'), 0);
});

test('new CSS background targets are discovered without img descendants', async () => {
  const h = await loadContentScript(); await h.activate();
  const target = h.document.createElement('div'); target.style.backgroundImage = 'url("http://page.test/bg.png")';
  h.document.body.appendChild(target); h.observer().emit([childrenRecord(h, [target])]); await h.timers.advance(100);
  assert.ok(h.controlFor(target)); await click(h, target); assert.equal(overlays(h).length, 1);
  await h.deactivate(); assert.equal(target.style.position, '');
});

test('cleanup restores structure while preserving concurrent host style edits', async () => {
  const h = await loadContentScript(); const img = h.addImage(); img.style.cssText = 'display:inline;width:42px';
  const original = img.style.cssText; await h.activate(); await click(h, img); img.style.border = '1px solid red'; await h.deactivate();
  assert.equal(img.parentElement, h.document.body); assert.ok(img.style.cssText.startsWith(original));
  assert.equal(img.style.border, '1px solid red'); assert.equal(h.document.querySelectorAll('.vt-lensmu-icon-wrapper').length, 0);
});

test('no-text, skipped translation, and actual empty output remain distinct', async () => {
  for (const [reply, expected] of [[prepared({ blocks: [] }), 'no-text'],
    [prepared({ translations: [''], outcomes: [{ status: 'skipped', reason: 'already-target-language' }] }), 'skipped'],
    [prepared({ translations: [''], outcomes: [{ status: 'failed', reason: 'empty-provider-output' }] }), 'failed']]) {
    const h = await loadContentScript({ messages: (m) => m.action === 'PREPARE_IMAGE' ? reply : undefined });
    const img = h.addImage(); await h.activate(); await click(h, img);
    assert.equal(h.controlFor(img).icon.dataset.vtState, expected); assert.equal(overlays(h).length, 0); await h.deactivate();
  }
});

test('real rendering rejects all-small and out-of-bounds regions', async () => {
  for (const bbox of [{ x: 10, y: 10, width: 5, height: 5 }, { x: 400, y: 10, width: 80, height: 40 }]) {
    const h = await loadContentScript({ messages: (m) => m.action === 'PREPARE_IMAGE' ? prepared({ blocks: [{ ...ocrBlocks()[0], bbox }] }) : undefined });
    const img = h.addImage(); await h.activate(); await click(h, img);
    assert.equal(h.controlFor(img).icon.dataset.vtState, 'failed'); assert.equal(overlays(h).length, 0);
    assert.match(h.controlFor(img).failureNotice.textContent, /could not be displayed/); await h.deactivate();
  }
});

test('read-aloud is optional and disabling it suppresses late synthesis', async () => {
  const gate = deferred();
  const h = await loadContentScript({ settings: { enableReadAloud: true }, messages: (m) => m.action === 'GENERATE_READ_ALOUD_AUDIO' ? gate.promise : undefined });
  const img = h.addImage(); await h.activate(); await click(h, img);
  assert.equal(h.sent.filter((m) => /READ_ALOUD/.test(m.action)).length, 0);
  h.controlFor(img).readAloudButton.dispatch('click');
  await h.waitFor(() => h.sent.some((m) => m.action === 'GENERATE_READ_ALOUD_AUDIO'), 'speech synthesis dispatch');
  await h.update({ enableReadAloud: false });
  gate.resolve({ ok: true, body: { audioDataUrl: 'data:audio/mpeg;base64,AAAA' } }); await h.flushMicrotasks();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.paused).length, 0); await h.deactivate();
});

test('reparenting a pending host target rejects the detached view before observation catches up', async () => {
  const gate = deferred();
  const h = await loadContentScript({ messages: (m) => m.action === 'PREPARE_IMAGE' ? gate.promise : undefined });
  const img = h.addImage(); await h.activate();
  h.controlFor(img).icon.dispatch('click'); await h.waitFor(() => preparations(h).length === 1, 'provider request before reparenting');
  const destination = h.document.createElement('div'); h.document.body.appendChild(destination); destination.appendChild(img);
  gate.resolve(prepared()); await h.idle();
  assert.equal(overlays(h).length, 0);
  h.observer().emit([childrenRecord(h, [img])]); await h.timers.advance(100);
  await click(h, img); assert.equal(overlays(h).length, 1); assert.equal(preparations(h).length, 1);
  await h.deactivate();
});

test('partial failures and warnings remain visible while echoed source is neither painted nor spoken', async () => {
  const blocks = [ocrBlocks()[0], { ...ocrBlocks('失敗')[0], bbox: { x: 10, y: 100, width: 120, height: 40 } }];
  const response = prepared({ blocks, translations: ['Hello', '失敗'] });
  response.body.warnings = ['One region used the fallback recognizer.'];
  const h = await loadContentScript({ settings: { enableReadAloud: true }, messages: (m) => m.action === 'PREPARE_IMAGE' ? response : undefined });
  const img = h.addImage(); await h.activate(); await click(h, img);
  const painted = overlays(h)[0].getContext('2d').calls.map((call) => call.text);
  assert.deepEqual(painted, ['Hello']);
  assert.match(h.controlFor(img).failureNotice.textContent, /1 region\(s\) could not be displayed/);
  assert.match(h.controlFor(img).failureNotice.textContent, /fallback recognizer/);
  h.controlFor(img).readAloudButton.dispatch('click');
  await h.waitFor(() => h.sent.some((m) => m.action === 'GENERATE_READ_ALOUD_AUDIO'), 'filtered speech dispatch');
  assert.equal(h.sent.find((m) => m.action === 'GENERATE_READ_ALOUD_AUDIO').payload.text, 'Hello');
  await h.deactivate();
});

test('known oversized images fail admission without capture, proxy fallback or provider work', async () => {
  for (const dimensions of [{ naturalWidth: 4001, naturalHeight: 4000 }, { naturalWidth: 16385, naturalHeight: 100 }]) {
    const h = await loadContentScript(); const img = h.addImage(dimensions);
    await h.activate(); await click(h, img);
    assert.equal(preparations(h).length, 0);
    assert.equal(h.sent.filter((message) => message.action === 'FETCH_IMAGE').length, 0);
    assert.match(h.controlFor(img).failureNotice.textContent, /16 megapixel/);
    assert.equal(overlays(h).length, 0); await h.deactivate();
  }
});

test('fetched and background image dimensions are admitted before capture or OCR', async () => {
  for (const url of ['http://page.test/huge.png', 'http://cdn.test/huge.png']) {
    const h = await loadContentScript({ imageLoads: (_url, image) => { image.naturalWidth = 4001; image.naturalHeight = 4000; } });
    const background = h.document.createElement('div'); background.style.backgroundImage = `url("${url}")`;
    h.document.body.appendChild(background); await h.activate(); await click(h, background);
    assert.equal(preparations(h).length, 0);
    assert.equal(h.sent.filter((message) => message.action === 'FETCH_IMAGE').length, url.includes('cdn.test') ? 1 : 0);
    assert.match(h.controlFor(background).failureNotice.textContent, /16 megapixel/);
    assert.equal(overlays(h).length, 0); await h.deactivate();
  }
});
