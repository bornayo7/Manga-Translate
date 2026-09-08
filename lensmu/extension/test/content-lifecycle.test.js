import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { FakeAudio, deferred, loadContentScript, ocrBlocks, translated } from './helpers/content-harness.js';

test('content cleanup restores the exact original inline style', async () => {
  const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    chrome: {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener() {} }
      }
    },
    console: { log() {}, warn() {}, error() {} },
    WeakMap,
    Map,
    Set,
    AbortController,
    crypto: globalThis.crypto
  });
  vm.runInContext(source, context);

  let styleAttribute = 'display:inline; width:42px';
  const element = {
    isConnected: true,
    getAttribute(name) {
      return name === 'style' ? styleAttribute : null;
    },
    setAttribute(name, value) {
      if (name === 'style') styleAttribute = value;
    },
    removeAttribute(name) {
      if (name === 'style') styleAttribute = null;
    }
  };

  context.rememberOriginalInlineStyle(element);
  styleAttribute = 'display:block; width:100%; height:100%';
  context.restoreOriginalInlineStyles();

  assert.equal(styleAttribute, 'display:inline; width:42px');
});

/* ---- MT-03: deactivation stops the batch ------------------------------ */

test('deactivating during image A stops image B from starting and drops the stale completion', async () => {
  const ocrA = deferred();
  const harness = await loadContentScript({
    settings: { maxConcurrentImages: 1 },
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') {
        return message.payload.imageBase64.includes('a.png') ? ocrA.promise : { ok: true, body: { blocks: ocrBlocks() } };
      }
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  const imgA = harness.addImage({ src: 'http://page.test/a.png' });
  const imgB = harness.addImage({ src: 'http://page.test/b.png' });
  await harness.activate();
  assert.equal(harness.controls().length, 2);

  const batch = harness.evalIn('processAllImages')({ mode: 'render' });
  await harness.settle();
  const ocrRequests = () => harness.sent.filter((m) => m.action === 'OCR_REQUEST');
  assert.equal(ocrRequests().length, 1, 'image A is in flight, B is queued behind the limit of 1');

  harness.deactivate();
  const cancels = harness.sent.filter((m) => m.action === 'CANCEL_REQUESTS');
  assert.ok(cancels.length >= 1, 'the in-flight request was cancelled at the worker');

  ocrA.resolve({ ok: true, body: { blocks: ocrBlocks() } });
  await batch;
  await harness.settle();

  assert.equal(ocrRequests().length, 1, 'image B never began after deactivation');
  assert.equal(harness.sent.filter((m) => m.action === 'TRANSLATE_REQUEST').length, 0, 'the stale OCR result was not translated');
  assert.equal(harness.document.querySelectorAll('.vt-lensmu-canvas').length, 0, 'no overlay appeared');
  assert.equal(harness.controls().length, 0);
  assert.equal(harness.trackedStateCount(), 0);

  // A fresh activation works normally.
  await harness.activate();
  assert.equal(harness.controls().length, 2);
  const control = harness.controlFor(imgB);
  control.icon.dispatch('click');
  await harness.idle();
  assert.equal(ocrRequests().length, 2);
  assert.equal(control.icon.dataset.vtState, 'rendered');
  assert.ok(imgA && imgB);
});

/* ---- MT-07: the control resolves the live source -------------------------- */

test('a control created for source A processes source B after a swap, and A\'s late response never attaches to B', async () => {
  const fetchA = deferred();
  const harness = await loadContentScript({
    origin: 'http://page.test',
    messages: (message) => {
      if (message.action === 'FETCH_IMAGE') {
        if (message.payload.url.endsWith('/a.png')) return fetchA.promise;
        return { ok: true, dataUrl: `data:image/png;base64,${message.payload.url}` };
      }
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  const img = harness.addImage({ src: 'http://cdn.example/a.png' });
  await harness.activate();
  const control = harness.controlFor(img);

  control.icon.dispatch('click');
  await harness.settle();
  assert.equal(harness.sent.filter((m) => m.action === 'FETCH_IMAGE').at(-1).payload.url, 'http://cdn.example/a.png');

  // The page swaps the source (srcset resolution / lazy loader) while A is in flight.
  img.src = 'http://cdn.example/b.png';
  control.icon.dispatch('click');
  await harness.settle();
  const fetches = harness.sent.filter((m) => m.action === 'FETCH_IMAGE').map((m) => m.payload.url);
  assert.deepEqual(fetches, ['http://cdn.example/a.png', 'http://cdn.example/b.png'], 'the original control fetched the live source B');

  // A's response arrives late.
  fetchA.resolve({ ok: true, dataUrl: 'data:image/png;base64,http://cdn.example/a.png' });
  await harness.idle();

  const ocrImages = harness.sent.filter((m) => m.action === 'OCR_REQUEST').map((m) => m.payload.imageBase64);
  assert.equal(ocrImages.some((image) => image.includes('a.png')), false, 'A was never sent to OCR');
  assert.equal(ocrImages.some((image) => image.includes('b.png')), true);
  assert.equal(control.icon.dataset.vtState, 'rendered');
});

/* ---- MT-08: late-loading images ------------------------------------------- */

test('an image that finishes loading after the debounce still gets a control, and a failed load followed by a good source is rediscovered', async () => {
  const harness = await loadContentScript();
  const pending = harness.addImage({ src: 'http://page.test/slow.png', naturalWidth: 0, naturalHeight: 0, complete: false });
  await harness.activate();
  assert.equal(harness.controls().length, 0, 'not loaded yet: no control');
  assert.equal(pending.listenerCount('load'), 1, 'a load listener is waiting');

  // Quiet page: no DOM mutation, just the load event.
  pending.naturalWidth = 400;
  pending.naturalHeight = 300;
  pending.complete = true;
  pending.dispatch('load');
  await harness.timers.advance(500);
  await harness.settle();
  assert.equal(harness.controls().length, 1);
  assert.equal(harness.controlFor(pending) !== null, true);
  assert.equal(pending.listenerCount('load'), 0, 'listener removed once discovered');

  // Failed load, then a src replacement that succeeds.
  const broken = harness.addImage({ src: 'http://page.test/404.png', naturalWidth: 0, naturalHeight: 0, complete: true });
  harness.observer().emit([{ type: 'childList', addedNodes: [broken], removedNodes: [], target: harness.document.body }]);
  await harness.timers.advance(500);
  await harness.settle();
  broken.dispatch('error');
  assert.equal(harness.controls().length, 1);
  assert.equal(broken.listenerCount('load'), 1, 'still watching after the error');

  broken.src = 'http://page.test/fixed.png';
  broken.naturalWidth = 200;
  broken.naturalHeight = 100;
  broken.dispatch('load');
  await harness.timers.advance(500);
  await harness.settle();
  assert.equal(harness.controls().length, 2);

  // The extension's own DOM changes must not schedule another rescan forever.
  const before = harness.timers.pendingCount;
  const wrapper = harness.document.querySelectorAll('.vt-lensmu-icon-wrapper')[0];
  harness.observer().emit([{ type: 'childList', addedNodes: [wrapper], removedNodes: [], target: harness.document.body }]);
  assert.equal(harness.timers.pendingCount, before, 'no refresh scheduled for an extension-made mutation');
});

/* ---- MT-14 / MT-15: control anchoring ------------------------------------- */

test('a canvas in a static container gets a visible control outside the canvas that targets that canvas', async () => {
  const harness = await loadContentScript({
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  const holder = harness.document.createElement('div');
  harness.document.body.appendChild(holder);
  const canvas = harness.document.createElement('canvas');
  holder.appendChild(canvas);
  await harness.activate();

  const control = harness.controlFor(canvas);
  assert.ok(control, 'the canvas has a control');
  assert.equal(canvas.children.length, 0, 'nothing was appended inside <canvas> (fallback content is never rendered)');
  assert.equal(control.iconContainer.parentElement.classList.contains('vt-lensmu-icon-wrapper'), true, 'anchored in a wrapper');
  assert.equal(control.iconContainer.parentElement, canvas.parentElement, 'the wrapper wraps this canvas');
  assert.equal(control.icon.tagName, 'BUTTON', 'a real button: keyboard-focusable and clickable');

  control.icon.dispatch('click');
  await harness.idle();
  const ocr = harness.sent.filter((m) => m.action === 'OCR_REQUEST');
  assert.equal(ocr.length, 1);
  assert.ok(ocr[0].payload.imageBase64.includes(`CANVAS-${canvas.uid}`), 'the click processed the canvas itself');

  harness.deactivate();
  assert.equal(canvas.parentElement, holder, 'cleanup restores the original structure');
  assert.equal(harness.document.querySelectorAll('.vt-lensmu-icon-wrapper').length, 0);
});

test('two images sharing a positioned parent get distinct, independent controls', async () => {
  const harness = await loadContentScript({
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  const gallery = harness.document.createElement('div');
  gallery.style.position = 'relative';
  harness.document.body.appendChild(gallery);
  const first = harness.addImage({ src: 'http://page.test/1.png', parent: gallery });
  const second = harness.addImage({ src: 'http://page.test/2.png', parent: gallery });

  // And a nested positioned container holding a single image.
  const nested = harness.document.createElement('figure');
  nested.style.position = 'absolute';
  gallery.appendChild(nested);
  const third = harness.addImage({ src: 'http://page.test/3.png', parent: nested });

  await harness.activate();
  const controls = [first, second, third].map((img) => harness.controlFor(img));
  assert.ok(controls.every(Boolean));
  assert.equal(new Set(controls.map((control) => control.anchor)).size, 3, 'three distinct anchors');
  assert.equal(controls[0].anchor, first.parentElement);
  assert.equal(controls[1].anchor, second.parentElement);
  assert.notEqual(controls[0].anchor, gallery, 'the shared parent is not used as the anchor');
  assert.equal(controls[2].anchor, nested, 'a positioned parent with a single image is used directly');

  await harness.activate(); // a repeat discovery adds no duplicate wrappers
  assert.equal(harness.document.querySelectorAll('.vt-lensmu-icon-wrapper').length, 2);

  controls[1].icon.dispatch('click');
  await harness.idle();
  const ocr = harness.sent.filter((m) => m.action === 'OCR_REQUEST');
  assert.equal(ocr.length, 1);
  assert.ok(ocr[0].payload.imageBase64.includes('2.png'), 'the second control processed the second image');
});

/* ---- MT-18: read aloud obeys the latest selection -------------------------- */

async function installOverlays(harness, images) {
  const imageOverlays = harness.evalIn('imageOverlays');
  for (const [index, img] of images.entries()) {
    imageOverlays.set(img, {
      canvas: harness.document.createElement('canvas'),
      wrapper: harness.document.createElement('div'),
      translations: ['Hello'],
      showingTranslation: true,
      speechText: `Speech ${index}`,
      imageFingerprint: `fp-${index}`,
      translationHash: `hash-${index}`,
      targetLanguage: 'en',
      readAloud: { state: 'stopped', errorMessage: '', audioDataUrl: '', settingsSignature: '', audio: null }
    });
  }
}

test('read aloud: with A and B pending, only the latest selection plays, whichever resolves first', async () => {
  const generations = new Map();
  const harness = await loadContentScript({
    settings: { enableReadAloud: true, elevenLabsVoiceId: 'v' },
    messages: (message) => {
      if (message.action === 'GENERATE_READ_ALOUD_AUDIO') {
        const entry = deferred();
        generations.set(message.payload.text, entry);
        return entry.promise;
      }
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
    }
  });
  const a = harness.addImage({ src: 'http://page.test/a.png' });
  const b = harness.addImage({ src: 'http://page.test/b.png' });
  await harness.activate();
  await installOverlays(harness, [a, b]);
  harness.evalIn('refreshReadAloudButtons')();

  const handle = harness.evalIn('handleReadAloudClick');
  const clickA = handle(a);
  await harness.settle();
  const clickB = handle(b);
  await harness.settle();
  assert.equal(generations.size, 2);

  // A resolves first, then B.
  generations.get('Speech 0').resolve({ ok: true, body: { audioDataUrl: 'data:audio/mpeg;base64,AAAA', cacheKey: 'ka' } });
  await clickA;
  await harness.settle();
  generations.get('Speech 1').resolve({ ok: true, body: { audioDataUrl: 'data:audio/mpeg;base64,BBBB', cacheKey: 'kb' } });
  await clickB;
  await harness.settle();

  const playing = FakeAudio.instances.filter((audio) => !audio.paused);
  assert.equal(playing.length, 1, 'exactly one clip is audible');
  assert.equal(playing[0].src, 'data:audio/mpeg;base64,BBBB', 'and it is the latest selection');
  assert.equal(harness.evalIn('activeReadAloudSession').imageElement, b);
  assert.equal(harness.evalIn('imageOverlays').get(a).readAloud.state, 'stopped');

  // Stop, then a late completion for a fresh request on A must not resurrect audio.
  const clickA2 = handle(a);
  await harness.settle();
  harness.evalIn('stopActiveReadAloudPlayback')();
  generations.get('Speech 0').resolve({ ok: true, body: { audioDataUrl: 'data:audio/mpeg;base64,AAAA', cacheKey: 'ka' } });
  await clickA2;
  await harness.settle();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.paused).length, 0, 'Stop leaves nothing playing');
  assert.equal(harness.evalIn('activeReadAloudSession'), null);
});

/* ---- MT-20: removed images release their state ---------------------------- */

test('removed images release every tracked record while reparented images keep working', async () => {
  const harness = await loadContentScript({
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  await harness.activate();
  const baseline = harness.trackedStateCount();

  for (let round = 0; round < 5; round++) {
    const img = harness.addImage({ src: `http://page.test/${round}.png` });
    harness.observer().emit([{ type: 'childList', addedNodes: [img], removedNodes: [], target: harness.document.body }]);
    await harness.timers.advance(500);
    await harness.settle();
    const control = harness.controlFor(img);
    assert.ok(control);
    control.icon.dispatch('click');
    await harness.idle();
    assert.equal(control.icon.dataset.vtState, 'rendered');
    assert.ok(harness.trackedStateCount() > baseline);

    // The page removes the (wrapped) image.
    const wrapper = img.parentElement;
    wrapper.remove();
    harness.observer().emit([{ type: 'childList', addedNodes: [], removedNodes: [wrapper], target: harness.document.body }]);
    await harness.timers.advance(500);
    await harness.settle();
    assert.equal(harness.controlFor(img), null);
    assert.equal(harness.trackedStateCount(), baseline, `round ${round}: state returned to baseline`);
    assert.equal(harness.evalIn('imageStates').has(img), false);
  }

  // Temporary reparenting (host moves the wrapper elsewhere) keeps everything.
  const kept = harness.addImage({ src: 'http://page.test/kept.png' });
  harness.observer().emit([{ type: 'childList', addedNodes: [kept], removedNodes: [], target: harness.document.body }]);
  await harness.timers.advance(500);
  await harness.settle();
  const keptControl = harness.controlFor(kept);
  const other = harness.document.createElement('section');
  harness.document.body.appendChild(other);
  const keptWrapper = kept.parentElement;
  keptWrapper.remove();
  other.appendChild(keptWrapper);
  harness.observer().emit([{ type: 'childList', addedNodes: [], removedNodes: [keptWrapper], target: harness.document.body }]);
  await harness.timers.advance(500);
  await harness.settle();
  assert.equal(harness.controlFor(kept), keptControl, 'still tracked');
  keptControl.icon.dispatch('click');
  await harness.idle();
  assert.equal(keptControl.icon.dataset.vtState, 'rendered');
});

/* ---- MT-25: neutral outcomes --------------------------------------------- */

test('already-target-language input and no-text images show neutral states, mixed results keep block indexing', async () => {
  let translateCalls = 0;
  const harness = await loadContentScript({
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') {
        if (message.payload.imageBase64.includes('empty.png')) return { ok: true, body: { blocks: [] } };
        if (message.payload.imageBase64.includes('mixed.png')) {
          return { ok: true, body: { blocks: [
            { text: 'こんにちは', confidence: 0.9, bbox: { x: 10, y: 10, width: 120, height: 40 }, orientation: 'horizontal' },
            { text: 'Already English words here', confidence: 0.9, bbox: { x: 10, y: 300, width: 120, height: 40 }, orientation: 'horizontal' }
          ] } };
        }
        return { ok: true, body: { blocks: ocrBlocks('This is English text') } };
      }
      if (message.action === 'TRANSLATE_REQUEST') {
        translateCalls += 1;
        if (message.payload.texts.length === 2) {
          return translated(['Hello', ''], [{ status: 'translated', reason: '' }, { status: 'skipped', reason: 'already-target-language' }]);
        }
        return translated([''], [{ status: 'skipped', reason: 'already-target-language' }]);
      }
    }
  });
  const english = harness.addImage({ src: 'http://page.test/english.png' });
  const empty = harness.addImage({ src: 'http://page.test/empty.png' });
  const mixed = harness.addImage({ src: 'http://page.test/mixed.png' });
  await harness.activate();

  harness.controlFor(english).icon.dispatch('click');
  await harness.idle();
  assert.equal(harness.controlFor(english).icon.dataset.vtState, 'skipped', 'already in the target language is neutral, not ✗');
  assert.equal(harness.controlFor(english).failureNotice, null, 'no failure notice');

  harness.controlFor(empty).icon.dispatch('click');
  await harness.idle();
  assert.equal(harness.controlFor(empty).icon.dataset.vtState, 'no-text');
  assert.equal(translateCalls, 1, 'nothing was sent to the provider for an image without text');

  harness.controlFor(mixed).icon.dispatch('click');
  await harness.idle();
  assert.equal(harness.controlFor(mixed).icon.dataset.vtState, 'rendered');
  const overlay = harness.evalIn('imageOverlays').get(mixed);
  assert.deepEqual(overlay.translations, ['Hello', '']);
  assert.equal(overlay.ocrResults.length, 2, 'block correspondence preserved: index 1 is the skipped block');
});

test('actual empty provider output where translation was requested remains an error', async () => {
  const harness = await loadContentScript({
    messages: (message) => {
      if (message.action === 'OCR_REQUEST') return { ok: true, body: { blocks: ocrBlocks() } };
      if (message.action === 'TRANSLATE_REQUEST') return translated([''], [{ status: 'failed', reason: 'empty-provider-output' }]);
    }
  });
  const img = harness.addImage();
  await harness.activate();
  harness.controlFor(img).icon.dispatch('click');
  await harness.idle();
  assert.equal(harness.controlFor(img).icon.dataset.vtState, 'failed');
  assert.match(harness.controlFor(img).failureNotice.textContent, /provider returned no translated text/);
});

/* ---- V-05: one scheduler for the whole page ------------------------------- */

test('the parallel-image limit is global across the batch, clicks and prefetch, and clicks jump the queue', async () => {
  const inflight = new Set();
  let peak = 0;
  const order = [];
  const harness = await loadContentScript({
    settings: { maxConcurrentImages: 2 },
    messages: async (message) => {
      if (message.action === 'OCR_REQUEST') {
        const name = message.payload.imageBase64.match(/(\d+)\.png/)[1];
        inflight.add(name);
        order.push(name);
        peak = Math.max(peak, inflight.size);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        inflight.delete(name);
        return { ok: true, body: { blocks: ocrBlocks() } };
      }
      if (message.action === 'TRANSLATE_REQUEST') return translated(['Hello']);
    }
  });
  const images = Array.from({ length: 6 }, (_, index) => harness.addImage({ src: `http://page.test/${index}.png` }));
  await harness.activate();

  const batch = harness.evalIn('processAllImages')({ mode: 'prefetch' });
  const clicked = harness.controlFor(images[5]);
  clicked.icon.dispatch('click');
  await harness.settle();
  await batch;
  await harness.idle();

  assert.equal(peak, 2, `never more than the configured limit in flight (peak ${peak})`);
  assert.ok(order.indexOf('5') < 4, `the clicked image ran ahead of queued prefetch work (order ${order.join(',')})`);
  assert.equal(harness.sent.filter((m) => m.action === 'OCR_REQUEST').length, 6, 'each image was OCR\'d once (deduplicated)');
  assert.equal(clicked.icon.dataset.vtState, 'rendered');
});
