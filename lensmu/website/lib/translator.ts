import { validateImageFile, loadImage, readImageBase64 } from './image-input';
import { recognizeImage } from './demo-ocr';
import { translateTexts } from './demo-translation';
import { renderTranslatedImage } from './image-renderer';
import type { TranslateOptions, TranslateResult, ProcessState } from './translator-types';
export type { TranslateOptions, TranslateResult, ProcessState, OcrBlock, OcrEngine } from './translator-types';

// One request lifetime. The UI owns URLs; the pipeline never allocates a URL
// that can escape after unmount. Provider and renderer contracts are shared.
export async function translateImage(options: TranslateOptions): Promise<TranslateResult> {
  const { file, ocrEngine, sourceLang, targetLang, signal, onProgress, backendUrl = 'http://localhost:8000' } = options;
  const progress = (state: ProcessState, detail?: string) => { signal?.throwIfAborted(); onProgress?.(state, detail); };
  signal?.throwIfAborted();
  validateImageFile(file);
  if (sourceLang === targetLang) throw new Error('Choose a target language different from the source language.');
  if (ocrEngine === 'mangaocr' && sourceLang !== 'ja') throw new Error('MangaOCR reads Japanese only. Choose Japanese or use PaddleOCR.');
  progress('uploading', 'Reading your image');
  const image = await loadImage(file, signal);
  try {
    const imageBase64 = await readImageBase64(file, signal);
    progress('scanning', 'Your local backend is reading text regions');
    const { blocks, warnings } = await recognizeImage(imageBase64, ocrEngine, backendUrl, sourceLang, signal);
    if (!blocks.length) throw new Error('No text regions were detected. Check the source language or try another image.');
    progress('translating');
    const translations = await translateTexts(blocks.map((block) => block.text), sourceLang, targetLang, signal, (detail) => progress('translating', detail));
    progress('rendering', 'Fitting translated text into each region');
    const rendered = await renderTranslatedImage(image, blocks, translations, signal);
    const failed = rendered.regions.filter((region) => region.reason === 'translation-failed').length;
    if (failed) warnings.push(`${failed} regions retain their original pixels because the provider returned no usable translation.`);
    const noFit = rendered.skipped - failed;
    if (noFit) warnings.push(`${noFit} regions retain their original pixels because the translation cannot fit. Their translations are available in the transcript.`);
    progress('done', `${rendered.rendered} of ${blocks.length} regions translated`);
    return { sourceLang, targetLang, blob: rendered.blob, blocks, translations, width: image.naturalWidth, height: image.naturalHeight, rendered: rendered.rendered, skipped: rendered.skipped, regions: rendered.regions, warnings };
  } finally { image.src = ''; }
}
