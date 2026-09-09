// Real unpacked MV3 extension, DOM, renderer and service worker. Only the
// external OCR/translation HTTP services are deterministic local fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE)).href : 'playwright');
const extension = fileURLToPath(new URL('../../', import.meta.url));
const fixture = await readFile(new URL('./fixture.html', import.meta.url));
const artifacts = process.env.BROWSER_ARTIFACTS || await mkdtemp(join(tmpdir(), 'lensmu-browser-artifacts-'));
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'lensmu-browser-profile-'));
const requests = { ocr: 0, translate: 0, aborted: 0 };
let mode = 'normal';
const waiting = new Set();
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/fixture') { response.setHeader('Content-Type', 'text/html'); response.end(fixture); return; }
  if (url.pathname === '/image.svg') {
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${url.search ? '#ffffed' : 'white'}"/><rect x="8" y="8" width="284" height="184" fill="none" stroke="#334455"/><text x="20" y="80" font-size="22">こんにちは</text></svg>`);
    return;
  }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { response.writeHead(400); response.end('{}'); return; }
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/ocr') {
    requests.ocr += 1;
    const reply = () => response.end(JSON.stringify({ source_lang: 'ja', blocks: mode === 'empty' ? [] : [{
      text: 'こんにちは', confidence: .98, orientation: 'horizontal',
      bbox: mode === 'tiny' ? { x: 20, y: 40, width: 4, height: 4 } : { x: 20, y: 45, width: 140, height: 50 }
    }] }));
    if (mode === 'hold') {
      waiting.add(reply);
      response.on('close', () => { if (!response.writableEnded) requests.aborted += 1; waiting.delete(reply); });
    } else reply();
    return;
  }
  if (url.pathname === '/v1/chat/completions') {
    requests.translate += 1;
    const input = body.messages.findLast((item) => item.role === 'user')?.content || '';
    const numbers = [...input.matchAll(/^\[(\d+)\]/gm)].map((match) => match[1]);
    response.end(JSON.stringify({ choices: [{ message: { content: numbers.map((n) => `[${n}] Hello!`).join('\n') }, finish_reason: 'stop' }] }));
    return;
  }
  response.writeHead(404); response.end('{}');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  const errors = [];
  popup.on('pageerror', (error) => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/dist/popup/index.html`);
  const message = (action, payload = {}) => popup.evaluate(({ action, payload }) => chrome.runtime.sendMessage({ action, payload }), { action, payload });
  let settings = { autoTranslate: false, ocrEngine: 'custom_ocr', customOcrUrl: origin + '/ocr',
    translationProvider: 'custom', customBaseUrl: origin + '/v1', customModelName: 'fixture', customApiKey: 'local-fixture-only',
    sourceLanguage: 'ja', targetLanguage: 'en', allowThirdPartyFallback: false, enableReadAloud: false,
    prefetchTranslations: false, maxConcurrentImages: 2, overlayMinFontSize: 10 };
  async function save(patch) {
    settings = { ...settings, ...patch };
    const response = await message('SAVE_SETTINGS', { settings: patch });
    assert.equal(response.success, true, JSON.stringify(response));
    return response.settings;
  }
  await save(settings);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/fixture');
  const tabId = await popup.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, origin + '/fixture');
  const sendPage = (action, payload = {}) => popup.evaluate(({ tabId, action, payload }) =>
    chrome.tabs.sendMessage(tabId, { action, payload }), { tabId, action, payload });
  const state = async () => (await message('GET_TAB_STATE', { tabId })).state;
  const toggle = async () => { const response = await message('TOGGLE_TRANSLATION', { tabId }); assert.equal(response.success, true, JSON.stringify(response)); return response; };
  const until = async (predicate, description) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await predicate()) return; await new Promise((done) => setTimeout(done, 40)); }
    throw new Error(`Timed out: ${description}`);
  };
  const count = (selector) => page.locator(selector).count();
  const check = async (name, run) => { await run(); results.push(name); console.log(`PASS ${name}`); };
  await check('activation, duplicate preparation, four independent real painted overlays', async () => {
    await toggle(); await until(async () => (await state()).imageCount === 4, 'four controls');
    const result = await sendPage('TRANSLATE_ALL_IMAGES');
    assert.equal(result.outcomes.filter((outcome) => outcome.status === 'rendered').length, 4, JSON.stringify(result));
    assert.equal(await count('.vt-lensmu-canvas'), 4); assert.equal(requests.ocr, 1); assert.equal(requests.translate, 1);
    assert.equal((await state()).translatedCount, 4);
  });
  await check('contain geometry, border alignment, DPR and resize redraw without new OCR', async () => {
    const readGeometry = () => page.locator('#fit').evaluate((image) => {
      const canvas = image.parentElement.querySelector('.vt-lensmu-canvas');
      const a = image.getBoundingClientRect(), b = canvas.getBoundingClientRect();
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let firstY = canvas.height;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3]) { firstY = Math.min(firstY, y); break; }
      return { image: { x: a.x, y: a.y, width: a.width }, canvas: { x: b.x, y: b.y, width: b.width }, bitmapWidth: canvas.width, firstY };
    });
    const before = await readGeometry();
    assert.deepEqual(before.image, before.canvas); assert.equal(before.bitmapWidth, 600);
    assert.ok(before.firstY >= 100, JSON.stringify(before));
    await page.locator('#fit').evaluate((image) => { image.style.width = '360px'; });
    await until(async () => (await readGeometry()).canvas.width === 360, 'resize redraw');
    assert.equal(requests.ocr, 1);
    await page.screenshot({ path: join(artifacts, 'extension-geometry.png'), fullPage: true });
  });
  await check('source replacement, mixed additions/removals and host reparenting', async () => {
    await page.evaluate(() => {
      document.querySelector('#first').src = '/image.svg?changed';
      document.querySelector('#duplicate').parentElement.remove();
      const image = document.createElement('img'); image.id = 'added'; image.src = '/image.svg'; document.body.append(image);
      document.querySelector('#destination').append(document.querySelector('#fit'));
    });
    await until(async () => (await state()).imageCount === 4 && (await state()).translatedCount === 1, 'reconcile mixed records');
    await sendPage('TRANSLATE_ALL_IMAGES'); assert.equal(await count('.vt-lensmu-canvas'), 4);
    assert.equal(await page.locator('#destination .vt-lensmu-canvas').count(), 1);
  });
  await check('opacity, hidden-original state and font redraw preserve prepared results', async () => {
    const before = requests.ocr;
    await page.locator('#first').locator('..').locator('.vt-lensmu-canvas').click({ position: { x: 150, y: 140 } });
    await save({ overlayFontFamily: 'serif', overlayOpacity: .4 });
    await until(async () => (await state()).pendingCount === 0, 'cosmetic redraw');
    assert.equal(await page.locator('#first').locator('..').locator('.vt-lensmu-canvas').evaluate((canvas) => canvas.style.opacity), '0');
    assert.equal(requests.ocr, before);
  });
  await check('late images, currentSrc replacement and changing canvas pixels', async () => {
    await page.evaluate(() => {
      const group = document.createElement('div'); group.id = 'late-fixtures';
      const image = document.createElement('img'); image.id = 'late-image'; group.append(image);
      const canvas = document.createElement('canvas'); canvas.id = 'changing-canvas'; canvas.width = 300; canvas.height = 200;
      canvas.getContext('2d').fillStyle = 'white'; canvas.getContext('2d').fillRect(0, 0, 300, 200);
      group.append(canvas); document.body.append(group);
    });
    await until(async () => (await state()).imageCount === 5, 'new canvas with unloaded image');
    await page.locator('#late-image').evaluate((image) => { image.src = '/image.svg'; });
    await until(async () => (await state()).imageCount === 6, 'late image load');
    await sendPage('TRANSLATE_ALL_IMAGES');
    const before = requests.ocr;
    await page.locator('#changing-canvas').evaluate((canvas) => { canvas.getContext('2d').fillStyle = '#abcdef'; canvas.getContext('2d').fillRect(0, 0, 20, 20); });
    await page.locator('#changing-canvas').locator('..').locator('.vt-lensmu-translate-icon').click();
    await until(async () => (await state()).pendingCount === 0, 'canvas retry');
    assert.equal(requests.ocr, before + 1);
    await page.locator('#late-image').evaluate((image) => { image.srcset = '/image.svg?responsive 2x'; });
    await until(async () => await page.locator('#late-image').locator('..').locator('.vt-lensmu-canvas').count() === 0, 'currentSrc invalidation');
    await page.locator('#late-fixtures').evaluate((group) => group.remove());
    await until(async () => (await state()).imageCount === 4, 'late fixture removal');
  });
  await check('cancel in-flight OCR, disable domain, restore host DOM and suppress stale paints', async () => {
    mode = 'hold'; await save({ targetLanguage: 'fr' });
    await until(async () => await count('.vt-lensmu-canvas') === 0, 'preparation setting invalidation');
    const batch = sendPage('TRANSLATE_ALL_IMAGES'); await until(() => waiting.size > 0, 'held OCR');
    await toggle(); await batch;
    assert.equal((await state()).active, false); assert.equal(await count('[data-vt-icon-added]'), 0);
    assert.equal(await count('.vt-lensmu-icon-wrapper'), 0); assert.equal(await count('.vt-lensmu-canvas'), 0);
    mode = 'normal'; for (const reply of waiting) reply(); waiting.clear();
    assert.ok(requests.aborted > 0);
    await save({ autoTranslate: true }); await page.reload();
    await page.waitForLoadState('networkidle'); assert.equal((await state()).active, false);
    assert.equal(await page.locator('#first').evaluate((image) => image.getAttribute('style')), null);
  });
  await check('worker restart restores actual page state; popup closes without cancelling page work', async () => {
    await toggle(); await sendPage('TRANSLATE_ALL_IMAGES');
    const before = await state(); assert.equal(before.translatedCount, 4);
    // Playwright deliberately keeps its Worker handle across MV3 restarts.
    // A volatile marker proves the global scope was actually replaced.
    await worker.evaluate(() => { globalThis.acceptanceRestartMarker = true; });
    const cdp = await context.newCDPSession(popup);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    const after = await state(); assert.equal(after.active, true); assert.equal(after.translatedCount, 4);
    assert.equal(await worker.evaluate(() => globalThis.acceptanceRestartMarker), undefined);
    await popup.close(); assert.equal(await count('.vt-lensmu-canvas'), 4);
  });
  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto(`chrome-extension://${id}/dist/popup/index.html`);
  await check('popup sections, keyboard navigation and no horizontal clipping', async () => {
    await reopened.getByRole('tab', { name: 'Translate', exact: true }).waitFor();
    await reopened.setViewportSize({ width: 400, height: 740 });
    for (const name of ['Translate', 'Engines', 'Settings']) {
      await reopened.getByRole('tab', { name, exact: true }).click();
      const dimensions = await reopened.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
      await reopened.screenshot({ path: join(artifacts, `popup-${name.toLowerCase()}.png`), fullPage: true });
      assert.ok(dimensions.scroll <= dimensions.viewport, `${name}: ${JSON.stringify(dimensions)}`);
    }
    await reopened.getByRole('tab', { name: 'Settings', exact: true }).press('Home');
    assert.equal(await reopened.getByRole('tab', { name: 'Translate', exact: true }).getAttribute('aria-selected'), 'true');
    await reopened.screenshot({ path: join(artifacts, 'extension-popup.png'), fullPage: true });
  });
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ browser: context.browser()?.version(), results, requests, errors }, null, 2));
  console.log(`Browser acceptance: ${results.length} checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await context?.pages().find((page) => page.url().startsWith(origin))?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  for (const reply of waiting) reply(); waiting.clear();
  await new Promise((done) => server.close(done));
  // The directory is created by this invocation and verified inside TEMP.
  if (resolve(profile).startsWith(resolve(tmpdir()) + '\\') || resolve(profile).startsWith(resolve(tmpdir()) + '/')) await rm(profile, { recursive: true, force: true });
}
