// Real bundled Tesseract/WASM + traineddata download, with no OCR mocks.
// The one-minute idle interval is deliberately exercised at production timing.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE)).href : 'playwright');
const extension = fileURLToPath(new URL('../../', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'lensmu-tesseract-profile-'));
const artifacts = process.env.BROWSER_ARTIFACTS || await mkdtemp(join(tmpdir(), 'lensmu-tesseract-artifacts-'));
await mkdir(artifacts, { recursive: true });
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/dist/popup/index.html`);
  const message = (action, payload = {}, target) => page.evaluate(({ action, payload, target }) =>
    chrome.runtime.sendMessage({ action, payload, target }), { action, payload, target });
  const contexts = () => page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
  const until = async (predicate, description, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return; await new Promise((done) => setTimeout(done, 100)); }
    throw new Error(`Timed out: ${description}`);
  };
  assert.equal((await message('SAVE_SETTINGS', { settings: { ocrEngine: 'tesseract', sourceLanguage: 'en', autoTranslate: false } })).success, true);
  async function pixels(text, rows = 1) {
    return page.evaluate(({ text, rows }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 120 * rows + 80;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111'; ctx.font = '60px Arial'; ctx.textBaseline = 'top';
      for (let row = 0; row < rows; row++) ctx.fillText(text, 40, 40 + row * 120);
      return canvas.toDataURL('image/png');
    }, { text, rows });
  }
  const imageBase64 = await pixels('HELLO ENGLISH TEXT');
  const started = Date.now();
  const first = await message('OCR_REQUEST', { imageBase64, sourceLang: 'en', requestId: 'real-english' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(first.body.blocks.map((block) => block.text).join(' '), /HELLO ENGLISH TEXT/);
  const initial = (await contexts())[0]; assert.ok(initial);
  console.log(`PASS real English recognition and offscreen creation (${Date.now() - started}ms)`);
  const dense = await pixels('READ THIS CLEAR TEXT', 18);
  const cancelled = message('OCR_REQUEST', { imageBase64: dense, sourceLang: 'en', requestId: 'cancel-active' });
  await until(async () => (await message('TESSERACT_STATUS', {}, 'offscreen-tesseract'))?.pending === 1, 'active recognition');
  const queued = message('OCR_REQUEST', { imageBase64, sourceLang: 'en', requestId: 'next-image' });
  await message('CANCEL_REQUESTS', { requestIds: ['cancel-active'] });
  assert.equal((await cancelled).cancelled, true);
  const second = await queued; assert.equal(second.ok, true, JSON.stringify(second));
  assert.match(second.body.blocks.map((block) => block.text).join(' '), /HELLO ENGLISH TEXT/);
  assert.equal((await contexts())[0].documentId, initial.documentId);
  assert.deepEqual(await message('TESSERACT_STATUS', {}, 'offscreen-tesseract'), { pending: 0, idle: false });
  console.log('PASS cancellation suppresses the active result; queued real OCR reuses the same offscreen document');
  console.log('Waiting for the production 60-second idle teardown.');
  await until(async () => (await contexts()).length === 0, 'idle document close', 75000);
  console.log('PASS real idle worker termination and offscreen document close');
  const third = await message('OCR_REQUEST', { imageBase64, sourceLang: 'en', requestId: 'recreate' });
  assert.equal(third.ok, true, JSON.stringify(third));
  assert.match(third.body.blocks.map((block) => block.text).join(' '), /HELLO ENGLISH TEXT/);
  assert.notEqual((await contexts())[0].documentId, initial.documentId);
  console.log('PASS real recognition after offscreen recreation');
  const languageResults = {};
  for (const sourceLang of ['ja', 'auto']) {
    const japanese = await pixels('日本語の文字を読む');
    const result = await message('OCR_REQUEST', { imageBase64: japanese, sourceLang, requestId: `real-${sourceLang}` });
    assert.equal(result.ok, true, JSON.stringify(result));
    const text = result.body.blocks.map((block) => block.text).join(' ');
    assert.match(text.replace(/\s/g, ''), /日本語/);
    languageResults[sourceLang] = text;
    console.log(`PASS real ${sourceLang === 'auto' ? 'default English+Japanese' : 'Japanese'} recognition`);
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ browser: context.browser()?.version(), languages: ['en', 'ja', 'auto'], languageResults,
    recognized: first.body.blocks, queuedCancellation: true, idleClosed: true, recreated: true }, null, 2));
  console.log(`Tesseract acceptance passed. Artifacts: ${artifacts}`);
} finally {
  await context?.close();
  if (resolve(profile).startsWith(resolve(tmpdir()) + '\\') || resolve(profile).startsWith(resolve(tmpdir()) + '/')) await rm(profile, { recursive: true, force: true });
}
