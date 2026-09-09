import { fetchWithTimeout } from '../shared/fetch-with-timeout.js';
import { describeHttpFailure, stripDataUrlPrefix, toContentScriptBlocks, trimTrailingSlashes } from '../shared/text.js';
import { batchMangaBboxes, mergeMangaResults, parseGoogleVisionResponse, decodeBackendOcrResponse } from '../shared/ocr-responses.js';

const LANGUAGES = { auto: 'japan', ja: 'japan', jp: 'japan', zh: 'ch', 'zh-cn': 'ch', 'zh-tw': 'chinese_cht', ko: 'korean' };
const ENGINES = { paddle: 'paddleocr', manga: 'mangaocr', cloudvision: 'google_vision', 'cloud-vision': 'google_vision', custom: 'custom_ocr', customocr: 'custom_ocr' };

async function requestJson(url, payload, { signal, headers = {} } = {}) {
  const response = await fetchWithTimeout(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal
  }, { timeoutMs: 30000, maxResponseBytes: 8 * 1024 * 1024 });
  if (!response.ok) throw new Error(describeHttpFailure(response.status, response.statusText, response.json || response.text));
  if (response.json === undefined) throw new Error('OCR provider returned malformed JSON.');
  return response.json;
}

function customBlocks(body) {
  if (Array.isArray(body?.detections)) return toContentScriptBlocks(decodeBackendOcrResponse(body).detections);
  if (!Array.isArray(body?.blocks)) throw new Error('Custom OCR returned an invalid block response.');
  return body.blocks.map((block, index) => {
    if (Array.isArray(block?.bbox)) return toContentScriptBlocks(decodeBackendOcrResponse({ detections: [block] }).detections)[0];
    const box = block?.bbox;
    if (typeof block?.text !== 'string' || !box || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key])) ||
        box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0) throw new Error(`Custom OCR returned invalid region ${index + 1}.`);
    return { text: block.text, bbox: { ...box }, confidence: Number(block.confidence) || 0,
      orientation: block.orientation === 'vertical' ? 'vertical' : 'horizontal' };
  }).filter(block => block?.text.trim());
}

// This interface owns engine-specific requests and result contracts; callers
// receive one normalized OCR result regardless of the provider or test adapter.
export function createOcrService({ runTesseract, post = requestJson }) {
  return async function recognize(imageBase64, settings, { signal, sourceLanguage = settings.sourceLanguage || 'auto' } = {}) {
    signal?.throwIfAborted();
    const image = stripDataUrlPrefix(imageBase64);
    if (typeof image !== 'string' || !image || image.length > 14 * 1024 * 1024) throw new Error('OCR image is empty or exceeds the input limit.');
    const engine = ENGINES[settings.ocrEngine] || settings.ocrEngine || 'tesseract';
    const base = trimTrailingSlashes(settings.backendUrl) || 'http://localhost:8000';
    if (engine === 'tesseract') {
      const blocks = await runTesseract(image, sourceLanguage, { signal });
      signal?.throwIfAborted();
      return { blocks: toContentScriptBlocks(blocks), source_lang: sourceLanguage, warnings: [] };
    }
    if (engine === 'google_vision') {
      if (!settings.googleCloudApiKey) throw new Error('Google Cloud Vision requires an API key in extension settings.');
      const data = await post(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(settings.googleCloudApiKey)}`,
        { requests: [{ image: { content: image }, features: [{ type: 'TEXT_DETECTION' }] }] }, { signal });
      const result = parseGoogleVisionResponse(data);
      return { blocks: result.blocks, source_lang: result.sourceLang, warnings: [] };
    }
    if (engine === 'custom_ocr') {
      if (!settings.customOcrUrl?.trim()) throw new Error('Custom OCR requires an endpoint URL in extension settings.');
      const body = await post(settings.customOcrUrl.trim(), { image, imageBase64: image, sourceLang: sourceLanguage },
        { signal, headers: settings.customOcrApiKey ? { Authorization: `Bearer ${settings.customOcrApiKey}` } : {} });
      return { blocks: customBlocks(body), source_lang: body.source_lang || body.sourceLang || body.locale || body.language || sourceLanguage, warnings: [] };
    }
    if (!['paddleocr', 'mangaocr'].includes(engine)) throw new Error(`Unsupported OCR engine: ${engine}`);
    if (engine === 'mangaocr' && !['auto', 'ja', 'jp', 'japan'].includes(sourceLanguage)) {
      throw new Error('MangaOCR reads Japanese. Choose Japanese or automatic source language.');
    }
    const lang = engine === 'mangaocr' ? 'japan' : LANGUAGES[sourceLanguage.toLowerCase()] || sourceLanguage;
    const detected = decodeBackendOcrResponse(await post(`${base}/ocr/paddle`, { image, lang }, { signal }));
    if (engine === 'paddleocr' || !detected.detections.length) {
      return { blocks: toContentScriptBlocks(detected.detections), source_lang: engine === 'mangaocr' ? 'ja' : sourceLanguage, warnings: detected.warnings };
    }
    const plan = batchMangaBboxes(detected.detections);
    const responses = [], warnings = [...detected.warnings];
    let firstFailure;
    for (const batch of plan.batches) {
      signal?.throwIfAborted();
      try {
        const result = decodeBackendOcrResponse(await post(`${base}/ocr/manga`, { image, bboxes: batch.bboxes }, { signal }),
          { engine: 'manga', expectedCount: batch.indices.length });
        responses.push(result.detections);
        warnings.push(...result.warnings);
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        firstFailure ||= error;
        responses.push(null);
        warnings.push(error.message);
      }
    }
    if (firstFailure && responses.every(item => item === null)) throw firstFailure;
    const merged = mergeMangaResults(detected.detections, plan.batches, responses);
    if (merged.fellBack) warnings.push(`${merged.fellBack} regions used PaddleOCR text because MangaOCR did not recognize them.`);
    if (merged.dropped) warnings.push(`${merged.dropped} regions could not be recognized by either engine.`);
    return { blocks: toContentScriptBlocks(merged.blocks), source_lang: 'ja', warnings,
      engineStats: { recognized: merged.recognized, fellBack: merged.fellBack, dropped: merged.dropped, batches: plan.batches.length } };
  };
}
