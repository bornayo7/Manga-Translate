export const OFFSCREEN_TARGET = 'offscreen-tesseract';
const DOCUMENT_PATH = 'offscreen/ocr.html';

// Lifecycle operations share a queue. Idle close cannot interleave with a
// recognition dispatch, and the offscreen document remains the idle authority
// across service-worker restarts.
export function createOffscreenOcr(browser, fallbackClients = globalThis.clients) {
  let chain = Promise.resolve();
  const serialized = work => {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  };
  const exists = async () => {
    const url = browser.runtime.getURL(DOCUMENT_PATH);
    if (browser.runtime.getContexts) return (await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0;
    return (await fallbackClients.matchAll()).some(client => client.url === url);
  };
  const send = (action, payload = {}) => browser.runtime.sendMessage({ target: OFFSCREEN_TARGET, action, payload });
  return {
    recognize: (imageBase64, sourceLang, { signal } = {}) => serialized(async () => {
      signal?.throwIfAborted();
      if (!browser.offscreen?.createDocument) throw new Error('Bundled OCR requires Chrome offscreen documents.');
      if (!await exists()) await browser.offscreen.createDocument({ url: DOCUMENT_PATH, reasons: ['WORKERS'], justification: 'Run bundled OCR workers outside host-page CSP.' });
      const result = await send('RUN_TESSERACT_OCR', { imageBase64, sourceLang });
      signal?.throwIfAborted();
      if (!result?.ok) throw new Error(result?.body?.error || 'Bundled Tesseract OCR failed.');
      return result.body.blocks;
    }),
    closeIfIdle: () => serialized(async () => {
      if (!await exists()) return false;
      const status = await send('TESSERACT_STATUS');
      if (!status?.idle) return false;
      await browser.offscreen.closeDocument();
      return true;
    })
  };
}
