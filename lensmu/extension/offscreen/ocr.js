import { recognize, terminateWorker } from '../ocr/tesseract.js';
import { createRecognitionSession } from './recognition-session.js';
import { toErrorMessage } from '../shared/text.js';

const OFFSCREEN_TESSERACT_TARGET = 'offscreen-tesseract';
const session = createRecognitionSession({ recognize, terminate: terminateWorker,
  notifyIdle: () => chrome.runtime.sendMessage({ action: 'OFFSCREEN_IDLE' }) });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TESSERACT_TARGET) {
    return false;
  }
  if (message.action === 'TESSERACT_STATUS') { sendResponse(session.status()); return false; }
  if (message.action !== 'RUN_TESSERACT_OCR') return false;

  (async () => {
    const payload = message?.payload ?? {};

    try {
      const blocks = await session.recognize(payload.imageBase64, payload.sourceLang || 'auto');
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
