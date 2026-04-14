// Routes OCR requests to the configured engine and normalizes results
// into a common format: [{ text, bbox: [x1,y1,x2,y2], confidence, orientation }]

import { recognize as tesseractRecognize } from './tesseract.js';
import { recognize as cloudVisionRecognize } from './cloud-vision.js';
import { recognizePaddle, recognizeManga } from './backend-ocr.js';

export async function performOCR(imageBase64, engine, settings) {
  if (!imageBase64) {
    throw new OCRError('No image data provided. Please capture a screenshot first.', 'INVALID_INPUT');
  }

  if (!engine) {
    throw new OCRError('No OCR engine specified. Please select an engine in extension settings.', 'INVALID_INPUT');
  }

  const rawBase64 = stripDataUrlPrefix(imageBase64);

  try {
    let results;

    switch (engine) {
      case 'tesseract': {
        const language = settings.sourceLanguage || 'eng';
        results = await tesseractRecognize(rawBase64, language);
        break;
      }

      case 'cloud-vision': {
        if (!settings.cloudVisionApiKey) {
          throw new OCRError(
            'Google Cloud Vision API key is not set. Go to Settings > OCR > Cloud Vision and enter your API key. ' +
            'You can get one at https://console.cloud.google.com/apis/credentials',
            'MISSING_API_KEY'
          );
        }
        results = await cloudVisionRecognize(rawBase64, settings.cloudVisionApiKey);
        break;
      }

      case 'paddle': {
        const backendUrl = settings.backendUrl || 'http://localhost:8000';
        results = await recognizePaddle(rawBase64, backendUrl);
        break;
      }

      case 'manga': {
        const backendUrl = settings.backendUrl || 'http://localhost:8000';
        const bboxes = settings.mangaBboxes || [];
        results = await recognizeManga(rawBase64, bboxes, backendUrl);
        break;
      }

      default:
        throw new OCRError(
          `Unknown OCR engine: "${engine}". Valid options are: tesseract, cloud-vision, paddle, manga.`,
          'INVALID_ENGINE'
        );
    }

    return normalizeResults(results, engine);

  } catch (error) {
    if (error instanceof OCRError) {
      throw error;
    }

    console.error(`[OCR Manager] Error with engine "${engine}":`, error);
    throw new OCRError(
      `OCR failed using ${engine}: ${error.message || 'Unknown error'}. ` +
      'Try a different OCR engine or check your settings.',
      'ENGINE_ERROR',
      error
    );
  }
}


// Strip "data:image/...;base64," prefix if present.
function stripDataUrlPrefix(dataUrlOrBase64) {
  if (typeof dataUrlOrBase64 !== 'string') {
    return '';
  }
  if (dataUrlOrBase64.startsWith('data:')) {
    const commaIndex = dataUrlOrBase64.indexOf(',');
    if (commaIndex !== -1) {
      return dataUrlOrBase64.slice(commaIndex + 1);
    }
  }
  return dataUrlOrBase64;
}


// Validate and clean OCR results into standard format.
function normalizeResults(results, engineName) {
  if (!Array.isArray(results) || results.length === 0) {
    console.info(`[OCR Manager] Engine "${engineName}" found no text in the image.`);
    return [];
  }

  return results
    .map((block, index) => {
      if (!block) {
        console.warn(`[OCR Manager] Skipping null result at index ${index} from ${engineName}`);
        return null;
      }

      return {
        text: typeof block.text === 'string' ? block.text.trim() : String(block.text || '').trim(),
        bbox: normalizeBoundingBox(block.bbox),
        confidence: normalizeConfidence(block.confidence),
        orientation: block.orientation === 'vertical' ? 'vertical' : 'horizontal',
      };
    })
    .filter(block => block !== null && block.text.length > 0);
}


// Coerce various bbox formats (Tesseract obj, Cloud Vision vertices, flat array) to [x1,y1,x2,y2].
function normalizeBoundingBox(bbox) {
  if (Array.isArray(bbox) && bbox.length === 4) {
    return bbox.map(val => Math.max(0, Math.round(Number(val) || 0)));
  }

  // Tesseract { x0, y0, x1, y1 }
  if (bbox && typeof bbox === 'object' && 'x0' in bbox) {
    return [
      Math.max(0, Math.round(Number(bbox.x0) || 0)),
      Math.max(0, Math.round(Number(bbox.y0) || 0)),
      Math.max(0, Math.round(Number(bbox.x1) || 0)),
      Math.max(0, Math.round(Number(bbox.y1) || 0)),
    ];
  }

  // Cloud Vision [{ x, y }, ...]
  if (Array.isArray(bbox) && bbox.length >= 2 && typeof bbox[0] === 'object' && 'x' in bbox[0]) {
    const xs = bbox.map(v => Number(v.x) || 0);
    const ys = bbox.map(v => Number(v.y) || 0);
    return [
      Math.max(0, Math.round(Math.min(...xs))),
      Math.max(0, Math.round(Math.min(...ys))),
      Math.max(0, Math.round(Math.max(...xs))),
      Math.max(0, Math.round(Math.max(...ys))),
    ];
  }

  console.warn('[OCR Manager] Could not parse bounding box:', bbox);
  return [0, 0, 0, 0];
}


// Normalize confidence to 0.0-1.0 (handles 0-100 range too).
function normalizeConfidence(confidence) {
  const num = Number(confidence);
  if (isNaN(num)) return 0;
  if (num > 1) return Math.min(1, Math.max(0, num / 100));
  return Math.min(1, Math.max(0, num));
}


export class OCRError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'OCRError';
    this.code = code;
    this.cause = cause;
  }
}
