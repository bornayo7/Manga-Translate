import { recognize } from '../ocr/tesseract.js';

const OFFSCREEN_TESSERACT_TARGET = 'offscreen-tesseract';

function toErrorMessage(error, fallback = 'Unknown error') {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TESSERACT_TARGET || message?.action !== 'RUN_TESSERACT_OCR') {
    return false;
  }

  (async () => {
    const payload = message?.payload ?? {};

    try {
      const blocks = await recognize(payload.imageBase64, payload.sourceLang || 'auto');
      sendResponse({
        ok: true,
        body: { blocks }
      });
    } catch (error) {
      console.error('[VisionTranslate Offscreen OCR] Tesseract failed:', error);
      sendResponse({
        ok: false,
        body: { error: toErrorMessage(error, 'Bundled Tesseract OCR failed.') }
      });
    }
  })();

  return true;
});
